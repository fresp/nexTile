import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { NEXTILE_PRESET, applyPreset } from "../../../lib/prefs/keymap-presets.js";

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/org.gnome.shell.extensions.nextile.gschema.xml",
);

/** Keybinding-schema `as` defaults, as { key: [accels] }. */
function keybindingDefaults() {
  const xml = readFileSync(schemaPath, "utf8");
  const kbSchema = xml.slice(xml.indexOf('id="org.gnome.shell.extensions.nextile.keybindings"'));
  const defaults = {};
  for (const [, key, body] of kbSchema.matchAll(
    /<key type="as" name="([^"]+)">\s*<default><!\[CDATA\[(.*?)\]\]><\/default>/gs,
  )) {
    defaults[key] = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  }
  return defaults;
}

const normalize = (accel) =>
  [...accel.matchAll(/<([^>]+)>/g)]
    .map((m) => m[1].toLowerCase())
    .sort()
    .join("+") +
  "+" +
  accel.replace(/<[^>]+>/g, "").toLowerCase();

describe("NexTile keymap preset", () => {
  const defaults = keybindingDefaults();

  it("only fills keybindings that exist and have no default", () => {
    for (const key of Object.keys(NEXTILE_PRESET)) {
      expect(defaults[key], key).toEqual([]);
    }
  });

  it("uses no accelerator a default shortcut already holds", () => {
    const taken = new Set(Object.values(defaults).flat().map(normalize));
    for (const accel of Object.values(NEXTILE_PRESET).flat()) {
      expect(taken.has(normalize(accel)), accel).toBe(false);
    }
  });

  it("writes each preset key and nothing else", () => {
    const settings = { set_strv: vi.fn() };
    applyPreset(settings, NEXTILE_PRESET);
    expect(settings.set_strv).toHaveBeenCalledTimes(Object.keys(NEXTILE_PRESET).length);
    expect(settings.set_strv).toHaveBeenCalledWith("workspace-return-origin", ["<Super>BackSpace"]);
  });
});
