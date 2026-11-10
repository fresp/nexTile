# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); tags are
CalVer (`vYYYY.M.N`, see [RELEASING.md](RELEASING.md)).

## [Unreleased]

### Fixed

- **Picture-in-Picture in Edge, Chrome, Brave and Chromium.** These browsers
  title the window "Picture in picture", which the default rule for Firefox's
  "Picture-in-Picture" did not match, so the window tiled and, with launching
  into a new workspace on, moved to a new workspace. A default rule now floats
  it. An existing `~/.config/nextile/config/windows.json` keeps its own rules:
  add `{ "wmTitle": "Picture in picture", "mode": "float" }` there, or reset the
  rules in Preferences.

## [2026.11.2] — 2026-11-09

The first release that publishes a download. The release workflow failed for
2026.11.0 and 2026.11.1, so neither got a GitHub Release; this one ships
everything listed under both.

### Fixed

- **Release builds.** `make build` never generated `lib/prefs/metadata.js`, so
  `make dist` stopped at its own check ("zip is missing lib/prefs/metadata.js")
  and no release zip was published. The build and the type check now generate it.

### Changed

- Development tooling follows the dev-dependency updates: Prettier 3 (the code
  is reformatted), ESLint 10, Vitest 5, husky 9 and lint-staged 17. TypeScript
  stays on 5 and the GNOME typings on GNOME 45, and Dependabot no longer bundles
  their major updates into the weekly group.

## [2026.11.1] — 2026-11-09

Launch placement now works on Wayland and grows into NexTile's own
workspace-first workflow: per-app rules, a way back to where you launched from,
and the app's name in the top bar. Preferences lead with it.

### Added

- **Per-app placement.** Preferences → Workspaces → Per-app placement sends one
  application's new windows to a new workspace, keeps them on the current one, or
  pins them to a workspace number. A matching rule applies even when the global
  switch is off. Rules are stored as `launchRules` in `windows.json`; files
  without them load unchanged.
- **Return to origin.** When the last window on a launched workspace closes,
  NexTile switches back to the workspace it was launched from
  (`launch-return-to-origin`, default on). `workspace-return-origin` does the same
  on demand.
- **App name in the top bar.** On a launched workspace, the application's name
  shows beside the NexTile icon (`launch-workspace-label`, default on; needs the
  tray icon). GNOME's own workspace names are not touched.
- **NexTile keymap preset.** Preferences → Shortcuts → Presets → Apply binds
  `Super+f` monocle, `Super+BackSpace` back to the origin workspace,
  `Super+Shift+n` launch-to-workspace on/off (new `prefs-launch-workspace-toggle`)
  and `Super+Shift+g` golden ratio. Default shortcuts are unchanged; Restore
  Defaults removes the preset.
- Screenshots of tiling and launch-to-workspace in the README.

### Changed

- **Preferences lead with Workspaces.** A new first page holds launch placement,
  per-app rules and non-tiling workspaces. The other pages are renamed: Tiling →
  Layout, Appearance → Look, Keyboard → Shortcuts, Windows → Rules, Portability →
  Backup. Settings keys are unchanged.
- **NexTile palette** for new installs: red tiled borders and previews, gold split
  hints, violet stacked, teal tabbed and slate floating windows. An existing
  stylesheet keeps its colors; see [theming](docs/user/theming.md) to start over
  from the new palette.
- The README credits Forge by name as the engine NexTile is forked from.

### Fixed

- **Launching into a new workspace did nothing on Wayland.** Mutter creates a
  Wayland window before the app sends its class and title, so NexTile treated
  every new Wayland window as a floating one and never moved it. The decision now
  waits one main-loop turn, until the window has described itself and before its
  first frame is drawn.
- Saving a float rule in Preferences no longer drops other keys from
  `windows.json`.
- A window placed on workspace 1 by a launch rule no longer auto-splits the
  focused window on the workspace it was launched from.

### Upgrade notes

- Log out and back in after updating; on Wayland GNOME Shell only loads the new
  code at login.
- Return to origin is on by default. Turn it off in Preferences → Workspaces if
  you prefer to stay on an emptied workspace.

## [2026.11.0] — 2026-11-09

First NexTile release.

### Added

- **Launch → new workspace → auto-tile.** A newly launched window no longer
  tiles into the current workspace: NexTile appends a fresh workspace, moves the
  window there, and tiles it, leaving the origin workspace's layout and windows
  untouched. Each subsequent launch from a workspace gets its own new workspace
  the same way.
  - `launch-new-workspace-enabled` (default on) — master switch.
  - `launch-new-workspace-follow` (default off) — also switch to the new
    workspace when a window is launched into it.
  - `launch-new-workspace-group-timeout` (default 1000 ms) — windows from the
    same application opened within the window share one new workspace, so
    session restores and multi-window apps do not spawn a workspace per window.
  - Dialogs, transient windows, utility windows, always-on-visible-workspace
    pins and float-rule matches are never moved; they behave exactly as they did
    under plain tiling.
  - Manual moves between workspaces keep working as before — the destination
    workspace tiles the window according to its own layout.
  - Implementation: `lib/extension/launch-workspace.js`
    (`LaunchWorkspaceManager`), wired ahead of `trackWindow` in the
    `window-created` handler. The feature adds no tree code — workspace
    creation, re-homing and tiling all reuse the existing reactive pipeline.
    Race safety: one relocation per window object, workspace appended at the
    end (no renumbering churn), the group timer and relocation marks are
    cleared on `disable()`.
- Preferences UI rows for the three settings (Tiling → Behavior).
- Portable-config sync for the three settings (`settings.json`).

### Changed

- Fork identity: the tiling engine ships as **NexTile** — new UUID
  (`nextile@fresp.github.io`), settings schema
  (`org.gnome.shell.extensions.nextile`), gettext domain, config directory
  (`~/.config/nextile`), stylesheet profile, icon, log prefix and docs. The GPL
  license and per-file copyright notices are preserved.
- Portable-config schema (`config/*.schema.json`) covers the new settings.

### Preserved

The full tiling-engine feature set, unchanged in behavior and configuration
surface: tree-based tiling with nested splits, stacked/tabbed containers,
monocle mode, per-monitor and per-workspace layouts, floating windows with
per-app rules (`windows.json`), keyboard navigation and cheatsheet
(`Super+Shift+/`), drag-and-drop tiling, golden ratio, GNOME settings overrides
with restore-on-disable, portable JSON config, and theming with custom CSS.

### Compatibility

- GNOME Shell 45–51, X11 and Wayland (tested against GNOME 50.4 on CachyOS).
- Settings and config files from the previous identity are not migrated
  automatically; copy `windows.json` / `settings.json` / `keybindings.json`
  into `~/.config/nextile/config/` and import from Preferences → Portability.
