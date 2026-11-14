import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keybindings } from "../../../lib/extension/keybindings.js";
import { ControlError } from "../../../lib/extension/external-control.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  CONTROL_BLOCKED_ACTIONS,
  CONTROL_IFACE,
  CONTROL_PATH,
} from "../../../lib/shared/external-control.js";
import {
  createWindowManagerFixture,
  createWindowNode,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { DBusExportedObject } from "../../mocks/gnome/Gio.js";

/**
 * External control: other programs run NexTile actions over D-Bus. The tests
 * drive the service with the real Keybindings and WindowManager behind it.
 */
describe("ExternalControlService", () => {
  let ctx;
  let focused = null;

  beforeEach(() => {
    DBusExportedObject.exports.clear();
    ctx = createWindowManagerFixture({ settings: { "external-control-enabled": true } });
    ctx.extension.extWm = wm();
    ctx.extension.kbdSettings = { get_strv: vi.fn(() => []) };
    ctx.extension.keybindings = new Keybindings(ctx.extension);
    ctx.extension.keybindings.enable();
    wm().renderTree = vi.fn();
    wm().move = vi.fn();
    focused = null;
    ctx.display.get_focus_window.mockImplementation(() => focused);
  });

  afterEach(() => {
    delete globalThis.__mockActionMode;
    ctx.cleanup();
    DBusExportedObject.exports.clear();
  });

  const wm = () => ctx.windowManager;
  const control = () => wm().externalControl;
  const codeOf = (call) => {
    try {
      call();
    } catch (e) {
      expect(e).toBeInstanceOf(ControlError);
      return e.code;
    }
    return null;
  };
  const addWindow = () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    return createWindowNode(ctx.tree, monitor, {
      windowOverrides: { wm_class: "Editor", workspace: ctx.workspaces[0] },
      layout: "HSPLIT",
    });
  };

  describe("run", () => {
    it("runs the action its keybinding runs", () => {
      const { metaWindow } = addWindow();
      focused = metaWindow;

      control().run("scratchpad-move");

      expect(wm().scratchpad.has(metaWindow)).toBe(true);
      expect(metaWindow.minimized).toBe(true);
    });

    it("refuses everything while the setting is off", () => {
      ctx.settings.set_boolean("external-control-enabled", false);
      const { metaWindow } = addWindow();
      focused = metaWindow;

      expect(codeOf(() => control().run("scratchpad-move"))).toBe("Disabled");
      expect(codeOf(() => control().state())).toBe("Disabled");
      expect(wm().scratchpad.has(metaWindow)).toBe(false);
    });

    it("refuses a name that is not a keybinding key", () => {
      expect(codeOf(() => control().run("ScratchpadMove"))).toBe("UnknownAction");
      expect(codeOf(() => control().run("constructor"))).toBe("UnknownAction");
    });

    it.each(CONTROL_BLOCKED_ACTIONS)("does not run %s", (action) => {
      const keybindings = ctx.extension.keybindings;
      const run = vi.spyOn(keybindings, "run");
      expect(keybindings.has(action)).toBe(true);
      expect(codeOf(() => control().run(action))).toBe("NotAllowed");
      expect(run).not.toHaveBeenCalled();
    });

    it("refuses while the shortcuts are off, as on the lock screen", () => {
      const { metaWindow } = addWindow();
      focused = metaWindow;
      ctx.extension.keybindings.disable();

      expect(codeOf(() => control().run("scratchpad-move"))).toBe("Unavailable");
      expect(wm().scratchpad.has(metaWindow)).toBe(false);
    });

    it("refuses while the shell is not in its normal mode", () => {
      const { metaWindow } = addWindow();
      focused = metaWindow;
      globalThis.__mockActionMode = 2; // Shell.ActionMode.OVERVIEW

      expect(codeOf(() => control().run("scratchpad-move"))).toBe("Unavailable");
      expect(wm().scratchpad.has(metaWindow)).toBe(false);
    });
  });

  describe("state", () => {
    it("reports tiling, the workspace, the scratchpad and the focused window", () => {
      const { metaWindow, nodeWindow } = addWindow();
      const hidden = addWindow().metaWindow;
      focused = hidden;
      control().run("scratchpad-move");
      focused = metaWindow;
      nodeWindow.mode = WINDOW_MODES.TILE;

      expect(control().state()).toEqual({
        tiling: true,
        workspace: 0,
        scratchpad: { windows: 1, hidden: 1 },
        focus: { wmClass: "Editor", floating: false, layout: "HSPLIT" },
      });
    });

    it("reports no focus when no tracked window has it, and never a title", () => {
      addWindow();
      const state = control().state();
      expect(state.focus).toBeNull();
      expect(JSON.stringify(state)).not.toContain("Mock Window");
    });
  });

  describe("D-Bus", () => {
    const invocation = () => ({ return_value: vi.fn(), return_dbus_error: vi.fn() });

    it("exports the interface while NexTile is enabled", () => {
      control().enable();
      const exported = DBusExportedObject.exports.get(CONTROL_PATH);
      expect(exported.jsObject).toBe(control());
      expect(exported.interfaceXml).toBe(CONTROL_IFACE);
      control().destroy();
      expect(DBusExportedObject.exports.has(CONTROL_PATH)).toBe(false);
    });

    it("Run replies, and reports a refusal as a named D-Bus error", () => {
      const ok = invocation();
      control().RunAsync(["scratchpad-show"], ok);
      expect(ok.return_value).toHaveBeenCalledWith(null);

      const refused = invocation();
      control().RunAsync(["prefs-app-launch"], refused);
      expect(refused.return_value).not.toHaveBeenCalled();
      expect(refused.return_dbus_error).toHaveBeenCalledWith(
        "org.gnome.Shell.Extensions.NexTile.Error.NotAllowed",
        expect.any(String),
      );
    });

    it("GetState replies with the state as JSON", () => {
      const reply = invocation();
      control().GetStateAsync([], reply);
      const [variant] = reply.return_value.mock.calls[0];
      expect(JSON.parse(variant.deepUnpack()[0])).toEqual(control().state());
    });
  });
});
