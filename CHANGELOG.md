# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); tags are
CalVer (`vYYYY.M.N`, see [RELEASING.md](RELEASING.md)).

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
