import { describe, it, expect } from "vitest";
import { ConfigManager } from "../../../lib/shared/settings.js";
import { File } from "../../mocks/gnome/Gio.js";

/** A ConfigManager whose user windows.json holds `props`. */
function configWith(props) {
  const configManager = new ConfigManager({ dir: { get_path: () => "/test/extension/path" } });
  const file = new File("/config/windows.json");
  const encoded = new TextEncoder().encode(JSON.stringify(props));
  file.load_contents = () => [true, encoded, null];
  Object.defineProperty(configManager, "windowConfigFile", { get: () => file, configurable: true });
  return configManager;
}

describe("windows.json launchRules", () => {
  it("leaves files written before launchRules existed unchanged", () => {
    expect(configWith({ overrides: [] }).windowProps).toEqual({ overrides: [] });
  });

  it("keeps well-formed rules and drops malformed ones", () => {
    const good = [
      { wmClass: "Chat", workspace: "new" },
      { wmClass: "Editor", wmTitle: "notes", workspace: "current" },
      { wmClass: "Mail", workspace: 3 },
    ];
    const bad = [
      null,
      { workspace: "new" },
      { wmClass: "Chat", workspace: "elsewhere" },
      { wmClass: "Chat", workspace: 0 },
      { wmClass: "Chat", workspace: 1.5 },
      { wmClass: "Chat", wmTitle: 7, workspace: "new" },
    ];
    const props = configWith({ overrides: [], launchRules: [...bad, ...good] }).windowProps;
    expect(props.launchRules).toEqual(good);
  });

  it("treats a non-array launchRules as no rules", () => {
    expect(configWith({ overrides: [], launchRules: "new" }).windowProps.launchRules).toEqual([]);
  });
});
