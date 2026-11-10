import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { PREFS_TITLE, PREFS_WM_CLASS } from "../../../lib/shared/settings.js";
import {
  WINDOW_LIST_IFACE,
  WINDOW_LIST_PATH,
  parseWindowList,
} from "../../../lib/shared/window-list.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { DBusExportedObject } from "../../mocks/gnome/Gio.js";

/**
 * The prefs Rules page lists the open windows so a float rule can start from
 * one. Prefs cannot see windows; WindowListService answers over D-Bus.
 */
describe("WindowListService", () => {
  let ctx;

  beforeEach(() => {
    DBusExportedObject.exports.clear();
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    DBusExportedObject.exports.clear();
  });

  const service = () => ctx.windowManager.windowList;
  const track = (props, mode = WINDOW_MODES.TILE) => {
    const metaWindow = createMockWindow(props);
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = mode;
    return metaWindow;
  };

  describe("listWindows", () => {
    it("lists tracked windows with class, title and float state", () => {
      track({ wm_class: "microsoft-edge", title: "New Tab - Microsoft Edge" });
      track({ wm_class: "microsoft-edge", title: "Some video - YouTube" }, WINDOW_MODES.FLOAT);

      expect(service().listWindows()).toEqual([
        { wmClass: "microsoft-edge", title: "New Tab - Microsoft Edge", floating: false },
        { wmClass: "microsoft-edge", title: "Some video - YouTube", floating: true },
      ]);
    });

    it("leaves out a window without a class: no rule can name it", () => {
      track({ wm_class: null, title: "Untitled" });

      expect(service().listWindows()).toEqual([]);
    });

    it("leaves out the prefs window", () => {
      track({ wm_class: PREFS_WM_CLASS, title: PREFS_TITLE });

      expect(service().listWindows()).toEqual([]);
    });

    it("lists a window with no title under an empty one", () => {
      track({ wm_class: "foot", title: null });

      expect(service().listWindows()).toEqual([{ wmClass: "foot", title: "", floating: false }]);
    });

    it("skips a window finalized before its node was removed", () => {
      const dead = track({ wm_class: "foot", title: "gone" });
      dead.get_id = () => {
        throw new Error("Object Meta.Window has been already finalized");
      };
      track({ wm_class: "foot", title: "alive" });

      expect(service().listWindows()).toEqual([
        { wmClass: "foot", title: "alive", floating: false },
      ]);
    });
  });

  describe("D-Bus export", () => {
    it("exports the interface on enable", () => {
      expect(DBusExportedObject.exports.has(WINDOW_LIST_PATH)).toBe(false);

      service().enable();

      const exported = DBusExportedObject.exports.get(WINDOW_LIST_PATH);
      expect(exported.interfaceXml).toBe(WINDOW_LIST_IFACE);
      expect(exported.jsObject).toBe(service());
    });

    it("exports once when enabled twice", () => {
      service().enable();

      expect(() => service().enable()).not.toThrow();
    });

    it("is unexported when the window manager is disabled, so a re-enable can export again", () => {
      service().enable();

      ctx.windowManager.disable();

      expect(DBusExportedObject.exports.has(WINDOW_LIST_PATH)).toBe(false);
      expect(() => service().enable()).not.toThrow();
    });

    it("ListWindows replies with JSON the prefs side parses back", () => {
      track({ wm_class: "foot", title: 'a "quoted" title' });

      expect(parseWindowList(service().ListWindows())).toEqual([
        { wmClass: "foot", title: 'a "quoted" title', floating: false },
      ]);
    });
  });
});

describe("parseWindowList", () => {
  it("returns an empty list for a reply that is not a JSON array", () => {
    expect(parseWindowList("not json")).toEqual([]);
    expect(parseWindowList('{"wmClass":"foot"}')).toEqual([]);
    expect(parseWindowList(undefined)).toEqual([]);
  });

  it("drops malformed entries and keeps the well-formed ones", () => {
    const reply = JSON.stringify([
      null,
      "foot",
      { wmClass: "", title: "no class" },
      { wmClass: "foot" },
      { wmClass: "foot", title: "ok", floating: "yes", extra: 1 },
    ]);

    expect(parseWindowList(reply)).toEqual([{ wmClass: "foot", title: "ok", floating: false }]);
  });
});
