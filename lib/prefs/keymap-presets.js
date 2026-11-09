// Pure, GTK-free keymap presets, kept apart from keyboard.js so they are
// unit-testable without GTK/Adw.

/**
 * The NexTile preset: workspace-centric shortcuts on top of the default keymap.
 * It only fills keys whose default is empty, so applying it never moves a
 * default shortcut; Restore Defaults clears it again.
 * @type {Record<string, string[]>}
 */
export const NEXTILE_PRESET = {
  "workspace-monocle-toggle": ["<Super>f"],
  "workspace-return-origin": ["<Super>BackSpace"],
  "prefs-launch-workspace-toggle": ["<Shift><Super>n"],
  "window-golden-ratio": ["<Shift><Super>g"],
};

/**
 * Write a preset's accelerators to the keybindings settings.
 * @param {{ set_strv: (key: string, value: string[]) => void }} settings
 * @param {Record<string, string[]>} preset
 */
export function applyPreset(settings, preset) {
  for (const [key, accels] of Object.entries(preset)) settings.set_strv(key, accels);
}
