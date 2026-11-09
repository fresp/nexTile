import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import { LAUNCH_TARGET_EXPANDO } from "../../../lib/extension/launch-workspace.js";
import { Logger } from "../../../lib/shared/logger.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Workspace, WindowType } from "../../mocks/gnome/Meta.js";

/**
 * NexTile launch → new workspace → auto-tile tests.
 *
 * The production entry is the display `window-created` handler, which calls
 * LaunchWorkspaceManager.handleWindowCreated() before trackWindow. These tests
 * drive that handler directly (the same call the signal makes) plus the
 * trackWindow integration that consumes the relocation mark.
 */
describe("LaunchWorkspaceManager - launch to new workspace", () => {
  let ctx;
  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: {
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 },
      },
    });
    // Bind the real signal surface (window-created, workspace-added, …) the
    // same way enable() does. The settings mock needs connect() for the
    // settings-signal part of _bindSignals.
    ctx.settings.connect = vi.fn(() => 1);
    ctx.windowManager._bindSignals();
  });
  afterEach(() => {
    ctx.cleanup();
  });
  const wm = () => ctx.windowManager;
  const launch = () => wm().launchWorkspace;

  /** Emit window-created exactly as the bound display handler does. */
  const emitWindowCreated = (metaWindow) => {
    ctx.display.emit("window-created", ctx.display, metaWindow);
  };

  /** The workspace object at an index in the (possibly grown) mock manager. */
  const wsAt = (index) => ctx.workspaceManager.get_workspace_by_index(index);

  describe("eligibility", () => {
    it("relocates a normal window to a new workspace", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      // A third workspace was appended and the window moved to it.
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(3);
      expect(metaWindow.get_workspace()).toBe(wsAt(2));
      // The origin workspace's tree is untouched: no node for this window there.
      const origin = ctx.tree.findNode("ws0");
      expect(origin.getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(0);
      // The window is tracked under the destination workspace's monitor node.
      const dest = ctx.tree.findNode("ws2");
      expect(dest.getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(1);
      expect(metaWindow[LAUNCH_TARGET_EXPANDO]).toBeUndefined(); // consumed
    });

    it("does not relocate when the setting is disabled", () => {
      ctx.settings.set_boolean("launch-new-workspace-enabled", false);
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(metaWindow.get_workspace()).toBe(ctx.workspaces[0]);
      // Default placement: tracked on the active workspace.
      const node = ctx.tree.findNode(metaWindow);
      expect(node).toBeTruthy();
      expect(ctx.tree.findNode("ws0").contains(node)).toBe(true);
    });

    it("does not relocate dialogs or transient windows", () => {
      const dialog = createMockWindow({
        window_type: WindowType.DIALOG,
        workspace: ctx.workspaces[0],
      });
      const transient = createMockWindow({
        transient_for: createMockWindow(),
        workspace: ctx.workspaces[0],
      });
      emitWindowCreated(dialog);
      emitWindowCreated(transient);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(dialog.get_workspace()).toBe(ctx.workspaces[0]);
      expect(transient.get_workspace()).toBe(ctx.workspaces[0]);
      // Both still tracked (floating) on the origin workspace.
      expect(ctx.tree.findNode("ws0").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(2);
    });

    it("does not relocate utility windows or invalid types", () => {
      const utility = createMockWindow({
        window_type: WindowType.UTILITY,
        workspace: ctx.workspaces[0],
      });
      emitWindowCreated(utility);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(ctx.tree.findNode(utility)).toBeFalsy();
    });

    it("does not relocate a window already tracked (reload re-track)", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      emitWindowCreated(metaWindow);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
    });

    it("respects a window that already lives on a non-active workspace", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[1] });
      emitWindowCreated(metaWindow);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(metaWindow.get_workspace()).toBe(ctx.workspaces[1]);
    });

    it("does not relocate sticky (all-workspaces) windows", () => {
      const sticky = createMockWindow({
        always_on_all_workspaces: true,
        workspace: ctx.workspaces[0],
      });
      emitWindowCreated(sticky);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(sticky.get_workspace()).toBe(ctx.workspaces[0]);
    });

    it("relocates a Wayland window that is undescribed at window-created", () => {
      // Mutter creates a Wayland window before set_app_id / set_title arrive, so
      // it would float by role then. Defer to an idle; describe it before it runs.
      let idle = null;
      const idleSpy = vi.spyOn(GLib, "idle_add").mockImplementation((_p, cb) => {
        idle = cb;
        return 42;
      });
      const metaWindow = createMockWindow({
        wm_class: null,
        title: null,
        workspace: ctx.workspaces[0],
      });
      emitWindowCreated(metaWindow);
      idleSpy.mockRestore();
      metaWindow.set_wm_class("MockApp");
      metaWindow.title = "Mock Window";
      idle();
      expect(metaWindow.get_workspace()).toBe(wsAt(2));
      expect(ctx.tree.findNode("ws2").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(1);
      expect(ctx.tree.findNode("ws0").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(0);
    });

    it("is idempotent per window object", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      emitWindowCreated(metaWindow);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(3);
    });
  });

  describe("burst grouping", () => {
    it("shares one new workspace for same-pid windows inside the timeout", () => {
      const first = createMockWindow({ pid: 4242, workspace: ctx.workspaces[0] });
      const second = createMockWindow({ pid: 4242, workspace: ctx.workspaces[0] });
      emitWindowCreated(first);
      emitWindowCreated(second);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(3);
      expect(first.get_workspace()).toBe(wsAt(2));
      expect(second.get_workspace()).toBe(wsAt(2));
      expect(ctx.tree.findNode("ws2").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(2);
    });

    it("creates separate workspaces for different applications", () => {
      const a = createMockWindow({ pid: 1, workspace: ctx.workspaces[0] });
      const b = createMockWindow({ pid: 2, workspace: ctx.workspaces[0] });
      emitWindowCreated(a);
      emitWindowCreated(b);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(4);
      expect(a.get_workspace()).toBe(wsAt(2));
      expect(b.get_workspace()).toBe(wsAt(3));
    });

    it("does not group when the timeout is 0", () => {
      ctx.settings.set_uint("launch-new-workspace-group-timeout", 0);
      const first = createMockWindow({ pid: 4242, workspace: ctx.workspaces[0] });
      const second = createMockWindow({ pid: 4242, workspace: ctx.workspaces[0] });
      emitWindowCreated(first);
      emitWindowCreated(second);
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(4);
    });
  });

  describe("tiling on the destination workspace", () => {
    it("tiles the window on the fresh workspace", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      const node = ctx.tree.findNode(metaWindow);
      expect(node).toBeTruthy();
      // processFloats runs in the render pipeline; the queued window-create
      // event fires it. Drive the queue the same way renderTree would.
      wm().renderTree("test");
      expect(node.mode).toBe(WINDOW_MODES.TILE);
      // Sole window on the destination: gets the full work area.
      const rect = node.renderRect;
      expect(rect).toBeTruthy();
    });

    it("keeps the destination workspace tiled even if skip-tile listed the index", () => {
      // Simulate a stale/broad skip rule naming the future index.
      ctx.settings.set_string("workspace-skip-tile", "2");
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(ctx.settings.get_string("workspace-skip-tile")).toBe("");
      wm().renderTree("test");
      expect(ctx.tree.findNode(metaWindow).mode).toBe(WINDOW_MODES.TILE);
    });

    it("leaves existing windows on the origin workspace untouched", () => {
      const existing = createMockWindow({ workspace: ctx.workspaces[0] });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const existingNode = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        existing,
        WINDOW_MODES.TILE
      );
      wm().renderTree("test");
      const beforeRect = { ...existingNode.renderRect };
      const launched = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(launched);
      wm().renderTree("test");
      // Same node, same parent, same geometry.
      expect(ctx.tree.findNode(existing)).toBe(existingNode);
      expect(existingNode.parentNode).toBe(monitor);
      expect(existingNode.renderRect).toEqual(beforeRect);
      expect(existingNode.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("follow setting", () => {
    it("activates the new workspace when follow is enabled", () => {
      ctx.settings.set_boolean("launch-new-workspace-follow", true);
      const activateSpy = vi.spyOn(Workspace.prototype, "activate");
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(activateSpy).toHaveBeenCalledTimes(1);
      activateSpy.mockRestore();
    });

    it("does not activate the new workspace by default", () => {
      const activateSpy = vi.spyOn(Workspace.prototype, "activate");
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(activateSpy).not.toHaveBeenCalled();
      activateSpy.mockRestore();
    });
  });

  describe("auto-split interaction", () => {
    it("does not auto-split the origin workspace when a window is relocated", () => {
      ctx.settings.set_boolean("auto-split-enabled", true);
      const focused = createMockWindow({ workspace: ctx.workspaces[0] });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const focusNode = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        focused,
        WINDOW_MODES.TILE
      );
      ctx.display.get_focus_window.mockReturnValue(focused);
      wm().renderTree("test");
      const parentBefore = focusNode.parentNode;
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      // The focused window's container is unchanged (no phantom CON wrap).
      expect(focusNode.parentNode).toBe(parentBefore);
      expect(focusNode.parentNode.nodeType).not.toBe(NODE_TYPES.CON);
    });
  });

  describe("manual moves after relocation", () => {
    it("re-homes a manually moved window to its live workspace", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(ctx.tree.findNode("ws2").contains(ctx.tree.findNode(metaWindow))).toBe(true);
      // User drags the window back to workspace 0.
      metaWindow.change_workspace(ctx.workspaces[0]);
      metaWindow.emit("workspace-changed", metaWindow);
      const node = ctx.tree.findNode(metaWindow);
      expect(ctx.tree.findNode("ws0").contains(node)).toBe(true);
      expect(ctx.tree.findNode("ws2").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(0);
    });
  });

  describe("teardown", () => {
    it("destroy clears the group timer and relocation marks", () => {
      const metaWindow = createMockWindow({ pid: 7, workspace: ctx.workspaces[0] });
      emitWindowCreated(metaWindow);
      expect(launch()._group).toBeTruthy();
      launch().destroy();
      expect(launch()._group).toBeNull();
      expect(launch()._relocating.size).toBe(0);
    });

    it("falls back to wm_class grouping when get_pid throws", () => {
      const first = createMockWindow({ workspace: ctx.workspaces[0] });
      first.get_pid = () => {
        throw new Error("finalized");
      };
      const second = createMockWindow({ workspace: ctx.workspaces[0] });
      second.get_pid = () => {
        throw new Error("finalized");
      };
      emitWindowCreated(first);
      emitWindowCreated(second);
      // Same wm_class (both "TestApp") → one shared workspace.
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(3);
      expect(second.get_workspace()).toBe(wsAt(2));
    });

    it("expires the group after the timeout", () => {
      // Capture the group timer's callback the way GLib would hold it.
      const realTimeoutAdd = GLib.timeout_add;
      const pending = [];
      GLib.timeout_add = (priority, interval, cb) => {
        pending.push(cb);
        return pending.length;
      };
      try {
        const first = createMockWindow({ pid: 99, workspace: ctx.workspaces[0] });
        emitWindowCreated(first);
        expect(launch()._group).not.toBeNull();
        // The timeout fires: the group is dropped.
        pending.forEach((cb) => cb());
        expect(launch()._group).toBeNull();
        const second = createMockWindow({ pid: 99, workspace: ctx.workspaces[0] });
        emitWindowCreated(second);
        // Group was expired → a new workspace.
        expect(ctx.workspaceManager.get_n_workspaces()).toBe(4);
      } finally {
        GLib.timeout_add = realTimeoutAdd;
      }
    });

    it("drops a stale group whose workspace disappeared", () => {
      const realTimeoutAdd = GLib.timeout_add;
      GLib.timeout_add = () => 1;
      try {
        const first = createMockWindow({ pid: 55, workspace: ctx.workspaces[0] });
        emitWindowCreated(first);
        expect(launch()._group.wsIndex).toBe(2);
        // The grouped workspace vanished (user closed it); the next same-pid
        // window must not be sent to a dead index.
        ctx.workspaceManager.get_workspace_by_index = vi.fn((i) =>
          i === 2 ? null : ctx.workspaces[i] ?? null
        );
        const second = createMockWindow({ pid: 55, workspace: ctx.workspaces[0] });
        emitWindowCreated(second);
        // Group cleared, fresh workspace appended (index 3).
        expect(ctx.workspaceManager.get_n_workspaces()).toBe(4);
        expect(launch()._group.wsIndex).toBe(3);
      } finally {
        GLib.timeout_add = realTimeoutAdd;
      }
    });

    it("keeps tracking when the relocation itself throws", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
      vi.spyOn(launch(), "_resolveTargetWorkspace").mockImplementation(() => {
        throw new Error("boom");
      });
      const warnSpy = vi.spyOn(Logger, "warn");
      emitWindowCreated(metaWindow);
      // No workspace created, no crash, and the window still tiles normally.
      expect(ctx.workspaceManager.get_n_workspaces()).toBe(2);
      expect(warnSpy).toHaveBeenCalled();
      expect(ctx.tree.findNode("ws0").getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(1);
      warnSpy.mockRestore();
    });
  });
});
