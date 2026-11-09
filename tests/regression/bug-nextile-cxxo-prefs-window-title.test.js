import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PREFS_TITLE, PREFS_WM_CLASS } from "../../lib/shared/settings.js";
import { findWindowWith } from "../../lib/extension/utils.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * nextile-cxxo: the libadwaita prefs rewrite stopped titling the prefs window, so
 * the extension's prefsTitle (`NexTile <translated Settings> - <version>`) and the
 * bundled `"wmTitle": "NexTile Settings"` float rule never matched it: the prefs
 * window tiled, and PrefsOpen could not find it to refocus. Prefs now sets the
 * fixed PREFS_TITLE, and the extension looks for that same title.
 */
describe("nextile-cxxo: the prefs window title matches prefsTitle and the bundled rule", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("the extension looks for the title prefs sets", () => {
    expect(ctx.windowManager.prefsTitle).toBe(PREFS_TITLE);
  });

  it("the bundled windows.json floats the prefs window", () => {
    const bundled = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/windows.json"), "utf8"),
    );
    ctx.windowManager.windowProps = bundled;
    const prefs = createMockWindow({ wm_class: "org.gnome.Shell.Extensions", title: PREFS_TITLE });

    expect(ctx.windowManager.isFloatingExempt(prefs)).toBe(true);
  });

  // The generic title also appears in other apps (a browser tab "NexTile Settings
  // - GitHub"); PrefsOpen must not focus and centre one of those instead.
  it("PrefsOpen's lookup only matches the prefs app's window", () => {
    const browser = createMockWindow({ wm_class: "firefox", title: "NexTile Settings - GitHub" });
    const prefs = createMockWindow({ wm_class: PREFS_WM_CLASS, title: PREFS_TITLE });
    global.display.get_workspace_manager = () => ({
      get_n_workspaces: () => 1,
      get_workspace_by_index: () => ({}),
    });
    global.display.get_tab_list = () => [browser, prefs];

    expect(findWindowWith(PREFS_TITLE, PREFS_WM_CLASS)).toBe(prefs);
    global.display.get_tab_list = () => [browser];
    expect(findWindowWith(PREFS_TITLE, PREFS_WM_CLASS)).toBeUndefined();
  });
});
