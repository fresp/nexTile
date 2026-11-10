import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Chromium-based browsers (Edge, Chrome, Brave, Chromium) title their video
 * Picture-in-Picture window "Picture in picture", with spaces. The bundled float
 * rule only carried Firefox's hyphenated "Picture-in-Picture", so the window was
 * not float-exempt: it tiled, and with launch-new-workspace-enabled it was moved
 * to a new workspace like a newly launched application.
 */
describe("the bundled windows.json floats a Chromium Picture-in-Picture window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.windowManager.windowProps = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/windows.json"), "utf8"),
    );
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const pipWindow = (wmClass) =>
    createMockWindow({
      wm_class: wmClass,
      title: "Picture in picture",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });

  it.each(["Microsoft-edge", "Google-chrome", "Brave-browser", "chromium"])(
    "floats the %s PiP window",
    (wmClass) => {
      expect(ctx.windowManager.isFloatingExempt(pipWindow(wmClass))).toBe(true);
    },
  );

  it("does not move it to a new workspace", () => {
    ctx.settings.set_boolean("launch-new-workspace-enabled", true);
    const pip = pipWindow("Microsoft-edge");

    expect(ctx.windowManager.launchWorkspace._shouldRelocate(pip)).toBe(false);
  });

  // A Document Picture-in-Picture window (YouTube's auto-PiP in Edge) is a NORMAL,
  // resizable window of the browser's class, titled after the page: unlike every
  // browser window, its title has no " - Microsoft Edge" suffix.
  describe.each(["microsoft-edge", "Microsoft-edge"])("Edge Document PiP (%s)", (wmClass) => {
    const documentPip = () =>
      createMockWindow({
        wm_class: wmClass,
        title: "(275) Some video - YouTube",
        window_type: WindowType.NORMAL,
        allows_resize: true,
      });

    it("floats", () => {
      expect(ctx.windowManager.isFloatingExempt(documentPip())).toBe(true);
    });

    it("is not moved to a new workspace", () => {
      ctx.settings.set_boolean("launch-new-workspace-enabled", true);

      expect(ctx.windowManager.launchWorkspace._shouldRelocate(documentPip())).toBe(false);
    });

    it("still tiles a browser window", () => {
      const main = createMockWindow({
        wm_class: wmClass,
        title: "New Tab and 1 more page - Profile 1 - Microsoft Edge",
        window_type: WindowType.NORMAL,
        allows_resize: true,
      });

      expect(ctx.windowManager.isFloatingExempt(main)).toBe(false);
    });
  });

  it("still tiles the browser's main window", () => {
    const main = createMockWindow({
      wm_class: "Microsoft-edge",
      title: "YouTube - Microsoft Edge",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });

    expect(ctx.windowManager.isFloatingExempt(main)).toBe(false);
  });
});
