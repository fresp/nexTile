import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../../mocks/helpers/index.js";

/**
 * Scratchpad tests. They drive the two commands and the shell's
 * minimize/unminimize signals through the real WindowManager wiring.
 */
describe("Scratchpad", () => {
  let ctx;
  let focused = null;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 } },
    });
    ctx.settings.connect = vi.fn(() => 1);
    wm()._bindSignals();
    wm().renderTree = vi.fn();
    wm().move = vi.fn();
    focused = null;
    ctx.display.get_focus_window.mockImplementation(() => focused);
  });
  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;
  const pad = () => wm().scratchpad;
  const MOVE = { name: "ScratchpadMove", x: "center", y: "center", width: 0.65, height: 0.75 };
  const SHOW = { name: "ScratchpadShow" };

  /** A tiled window on workspace 0. Mutter focuses a window it activates. */
  const addWindow = (windowOverrides = {}) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const created = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { workspace: ctx.workspaces[0], ...windowOverrides },
      layout: "HSPLIT",
    });
    const { metaWindow } = created;
    metaWindow.activate = () => {
      focused = metaWindow;
    };
    return created;
  };

  const send = (metaWindow) => {
    focused = metaWindow;
    wm().command(MOVE);
    focused = null; // Mutter moves focus off a minimized window
  };

  describe("move to scratchpad", () => {
    it("floats, hides and sticks the focused window", () => {
      const { metaWindow, nodeWindow } = addWindow();
      send(metaWindow);

      expect(pad().has(metaWindow)).toBe(true);
      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
      expect(wm().isFloatingExempt(metaWindow)).toBe(true);
      expect(metaWindow.minimized).toBe(true);
      expect(metaWindow.is_on_all_workspaces()).toBe(true);
    });

    it("gives a tiled window the default floating size", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      expect(wm().move).toHaveBeenCalledTimes(1);
      expect(wm().move.mock.calls[0][0]).toBe(metaWindow);
    });

    it("leaves a floating window where the user put it", () => {
      const { metaWindow, nodeWindow } = addWindow();
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      send(metaWindow);
      expect(wm().move).not.toHaveBeenCalled();
      expect(metaWindow.minimized).toBe(true);
    });

    it("leaves fullscreen and maximized before hiding", () => {
      const { metaWindow } = addWindow();
      metaWindow.make_fullscreen();
      send(metaWindow);
      expect(metaWindow.is_fullscreen()).toBe(false);
      expect(metaWindow.minimized).toBe(true);
    });

    it("does nothing without a focused window", () => {
      expect(() => wm().command(MOVE)).not.toThrow();
      expect(pad()._members).toHaveLength(0);
    });
  });

  describe("show", () => {
    it("shows the hidden window on the active workspace and focuses it", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      ctx.workspaceManager.get_active_workspace.mockReturnValue(ctx.workspaces[1]);

      wm().command(SHOW);

      expect(metaWindow.minimized).toBe(false);
      expect(metaWindow.is_on_all_workspaces()).toBe(false);
      expect(focused).toBe(metaWindow);
      expect(wm().isFloatingExempt(metaWindow)).toBe(true);
    });

    it("unsticks a window Mutter does not report as always sticky", () => {
      // meta_window_is_always_on_all_workspaces() is the window-type flag, which
      // stick() never sets.
      const { metaWindow } = addWindow();
      metaWindow.is_always_on_all_workspaces = () => false;
      send(metaWindow);
      expect(metaWindow.is_on_all_workspaces()).toBe(true);
      wm().command(SHOW);
      expect(metaWindow.is_on_all_workspaces()).toBe(false);
    });

    it("moves the window to the current monitor", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      ctx.display.get_current_monitor.mockReturnValue(1);
      wm().command(SHOW);
      expect(metaWindow.get_monitor()).toBe(1);
    });

    it("hides the focused scratchpad window", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      wm().command(SHOW);
      wm().command(SHOW);
      expect(metaWindow.minimized).toBe(true);
      expect(metaWindow.is_on_all_workspaces()).toBe(true);
    });

    it("cycles through the hidden windows, longest hidden first", () => {
      const a = addWindow().metaWindow;
      const b = addWindow().metaWindow;
      send(a);
      send(b);

      wm().command(SHOW);
      expect(focused).toBe(a);
      wm().command(SHOW); // hides a
      focused = null;
      wm().command(SHOW);
      expect(focused).toBe(b);
      expect(a.minimized).toBe(true);
    });

    it("brings over a window left showing on another workspace", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      wm().command(SHOW);
      focused = null;
      ctx.workspaceManager.get_active_workspace.mockReturnValue(ctx.workspaces[1]);

      wm().command(SHOW);

      expect(metaWindow.minimized).toBe(false);
      expect(metaWindow.get_workspace()).toBe(ctx.workspaces[1]);
      expect(focused).toBe(metaWindow);
    });

    it("does nothing when the scratchpad is empty", () => {
      const { metaWindow } = addWindow();
      focused = metaWindow;
      wm().command(SHOW);
      expect(metaWindow.minimized).toBe(false);
    });
  });

  describe("leaving the scratchpad", () => {
    it("float toggle on a shown window tiles it again without writing a rule", () => {
      const { metaWindow, nodeWindow } = addWindow();
      send(metaWindow);
      wm().command(SHOW);
      const addOverride = vi.spyOn(wm(), "addTileOverride");

      wm().command({ ...MOVE, name: "FloatToggle" });

      expect(pad().has(metaWindow)).toBe(false);
      expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
      expect(wm().isFloatingExempt(metaWindow)).toBe(false);
      expect(addOverride).not.toHaveBeenCalled();
    });

    it("forgets a closed window", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      const actor = metaWindow.get_compositor_private();
      actor.border = { hide: vi.fn() };
      actor.splitBorder = { hide: vi.fn() };
      wm().windowDestroy(actor);
      expect(pad().has(metaWindow)).toBe(false);
      expect(() => wm().command(SHOW)).not.toThrow();
    });

    it("unsticks the members when NexTile is disabled", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      pad().destroy();
      expect(metaWindow.is_on_all_workspaces()).toBe(false);
      expect(metaWindow.minimized).toBe(true);
      expect(pad().has(metaWindow)).toBe(false);
    });
  });

  describe("minimize and unminimize from outside NexTile", () => {
    const emit = (signal, metaWindow) =>
      global.window_manager.emit(signal, global.window_manager, { meta_window: metaWindow });

    it("unsticks a member the user restores", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      metaWindow.unminimize();
      emit("unminimize", metaWindow);
      expect(metaWindow.is_on_all_workspaces()).toBe(false);
    });

    it("sticks a shown member the user minimizes", () => {
      const { metaWindow } = addWindow();
      send(metaWindow);
      wm().command(SHOW);
      metaWindow.minimize();
      emit("minimize", metaWindow);
      expect(metaWindow.is_on_all_workspaces()).toBe(true);
    });

    it("leaves other windows alone", () => {
      const { metaWindow } = addWindow();
      metaWindow.minimize();
      emit("minimize", metaWindow);
      expect(metaWindow.is_on_all_workspaces()).toBe(false);
    });
  });
});
