# Architecture

NexTile organizes a workspace's windows as a **tree** (like i3/sway) and reconciles
that tree onto the screen. Three tiers:

1. **Tree data model** (`lib/extension/tree.js`) — the in-memory layout.
2. **Window manager** (`lib/extension/window.js`) — the event hub that reacts to
   GNOME signals, mutates the tree, and renders it.
3. **GNOME integration** — keybindings, quick-settings indicator, preferences,
   theming, and the Mutter-version shims.

See [rendering.md](rendering.md) for the render pipeline and [compat.md](compat.md)
for Mutter API drift.

## Entry point & lifecycle

`extension.js` is the `NexTileExtension` (a GNOME `Extension` subclass).

- **`enable()`**: loads both GSettings schemas and applies the GNOME overrides in
  `SETTINGS_OVERRIDES` (`lib/shared/gnome-overrides.js`). The originals go into the
  `gnome-overrides-snapshot` key first, so an exit that skips `disable()` can't lose
  them; the next `enable()` reuses the snapshot. Then it constructs `ConfigManager`
  → `ConfigSync` → theme → `WindowManager` → `Keybindings` → `Cheatsheet`, and calls
  `extWm.enable()`.
- **`disable()`**: restores the GNOME settings, clears the snapshot once all of them
  are back, then tears down
  the subsystems and nulls every reference.
- **Session modes** (`_onSessionModeChanged`): on the lock screen NexTile keeps the
  tree in memory but drops keybindings and the indicator, and restores them in the
  `user` session. The tree is never serialized, so locking must not lose it.

## The tiling tree

Defined in `tree.js`. Node types (`NODE_TYPES`, `tree.js`):

```
ROOT ─ WORKSPACE ─ MONITOR ─┬─ WINDOW
                            └─ CON ─┬─ WINDOW
                                    └─ CON ─ …      (containers nest)
```

- **`Node`** (`tree.js`) — one monitor, workspace, container (`CON`), or window.
- **`Tree`** (`tree.js`) `extends Node`; its constructor calls
  `super(NODE_TYPES.ROOT, …)` (`tree.js`), so **the `Tree` instance *is* the
  root node** — there is no `tree.root` property. Walk from `tree` itself.
- **Layouts** (`LAYOUT_TYPES`, `tree.js`): `HSPLIT`, `VSPLIT`, `STACKED`,
  `TABBED`, `PRESET` (+ `ROOT`). A container's layout decides how its children are
  arranged.
- **Window modes** (`WINDOW_MODES` in `tree.js`): `TILE`, `FLOAT`, `GRAB_TILE`
  (being dragged), `DEFAULT`. Float state is the node's `mode`, **not** tree
  membership — a floating window keeps its node.

## Subsystems

| Module | Responsibility |
| --- | --- |
| `window.js` `WindowManager` | Event hub: binds GNOME signals, tracks windows, owns `renderTree`/`move`, focus, grab/drag. |
| `command.js` `CommandHandler` | Turns a user action into tree mutations. |
| `focus.js` `FocusManager` | Focus tracking and the active-window signal lifecycle. |
| `decoration.js` `DecorationManager` | Stacked/tabbed decorations and their actors. |
| `keybindings.js` `Keybindings` | Registers shell keybindings → `CommandHandler`; drag modifier mask. |
| `workspace.js` `WorkspaceManager` | Workspace nodes + per-workspace signal lifecycle + renumbering. |
| `launch-workspace.js` `LaunchWorkspaceManager` | Launch → new workspace → auto-tile relocation (NexTile feature). |
| `monitor.js` `MonitorManager` | Monitor-per-workspace nodes; split orientation per monitor geometry. |
| `cheatsheet.js` `Cheatsheet` | In-shell keybinding overlay (`Super+Shift+/`). |
| `indicator.js` | Quick-settings panel toggle. |
| `lib/shared/settings.js` `ConfigManager` | GSettings + JSON config (`windows.json` overrides). |
| `lib/shared/config-sync.js` `ConfigSync` | Mirrors GSettings ⇄ `settings.json`/`keybindings.json`. |
| `lib/shared/theme.js` + `lib/css/` | Stylesheet parsing/customization (see rendering.md). |

## Command dispatch flow

```
key chord ─▶ Main.wm.addKeybinding (keybindings.js) ─▶ callback
          ─▶ CommandHandler.execute(action) (command.js, switch on action.name)
          ─▶ WindowManager / Tree mutation ─▶ wm.renderTree(...)
```

`Keybindings.enable()` (`keybindings.js`) registers every entry of `this._bindings`;
each callback dispatches an `action` object into the `execute` switch. Drag-to-tile
is gated by the modifier mask in `allowDragDropTile()` (`keybindings.js`).

## Launch → new workspace → auto-tile

NexTile's placement feature lives in `launch-workspace.js`
(`LaunchWorkspaceManager`), wired ahead of `trackWindow` in the `window-created`
handler (`window.js`):

```
display::window-created ─▶ LaunchWorkspaceManager.whenDescribed (Wayland: one idle, see below)
                        ─▶ LaunchWorkspaceManager.handleWindowCreated (launch-workspace.js)
    eligible? ─▶ workspace_manager.append_new_workspace   ─▶ workspace-added (existing handler)
                                                              └▶ tree scaffolding ws{n} + mo{m}ws{n}
              ─▶ metaWindow.change_workspace(target)       ─▶ workspace-changed (existing reconcile)
              ─▶ mark metaWindow._nextileLaunchWorkspace
                       ─▶ trackWindow homes the node under the DESTINATION monitor node
                       ─▶ processFloats tiles it (destination not in workspace-skip-tile)
```

Design notes:

- **The feature adds no tree code.** It only performs the Mutter-side move before
  tracking; every downstream step (scaffolding, re-homing, tiling) is NexTile's
  existing reactive pipeline.
- **Eligibility** (`_shouldRelocate`): setting on, window untracked, `_validWindow`,
  not `isFloatingExempt` (dialogs, transients, utilities, sticky, fixed-size,
  float-rule matches all keep NexTile's behavior), and not already on a non-active
  workspace. One relocation per window object (`_relocating`).
- **Wayland timing** (`whenDescribed`): Mutter creates a Wayland window at
  `xdg_surface.get_toplevel`, before `set_app_id`/`set_title`/`set_parent`, so at
  `window-created` its class and title are null and `isFloatingExempt` floats it
  by role. While the feature is on, an undescribed window's relocate-then-track
  runs in one `PRIORITY_DEFAULT` idle: the client's same-flush requests are
  applied by then, and the redraw source has not yet painted its first frame.
- **Burst grouping** (`launch-new-workspace-group-timeout`): windows from the
  same pid inside the timeout share one new workspace, so a session restore or a
  multi-window app doesn't spawn one workspace per window.
- **Auto-split is skipped** for relocated windows: the split would mutate the
  origin workspace's focused container, which the feature promises to leave
  untouched.
- **Tiling on arrival** is guaranteed by `_ensureWorkspaceTiled`, which strips
  the new index from `workspace-skip-tile` defensively.
- **Manual moves** need no special handling: Mutter's `workspace-changed` drives
  the existing `_queueWindowHomeReconcile` pipeline.
- **Loop safety**: the handler runs only on `window-created` for untracked
  windows, never on workspace `window-added`; `append_new_workspace` appends at
  the end, so no renumbering churn; the destination workspace holds the moved
  window, so GNOME's dynamic-workspace cleanup won't remove it while in use.

## GObject lifecycle discipline

Core classes are GObjects registered with `static { GObject.registerClass(this); }`.
Every subsystem **tracks its signal IDs and disconnects them on teardown**: GNOME
Shell reloads extensions in-process, so a leaked handler outlives `disable()` and
crashes later.

- `WindowManager._bindSignals()` / `_removeSignals()` own the display,
  workspace-manager and per-window signals. The disconnect tolerates
  already-finalized objects.
- Managers own their signals, e.g. `WorkspaceManager._workspaceSignals`, unbound in
  `removeWorkspace`/`destroy`.
- Idle and timeout source IDs are cleared in a `finally`, so one throw can't wedge
  them ([rendering.md](rendering.md#rendertreefrom-force--windowjs)).

[hazards.md](hazards.md) lists the guardrails that enforce this.

## Configuration sources

Two layers, reconciled by `ConfigManager` + `ConfigSync`:

- **GSettings** (`org.gnome.shell.extensions.nextile` and `.keybindings`): the runtime
  source of truth.
- **`windows.json`**: window rules, owned by `ConfigManager` (`lib/shared/settings.js`).
- **`settings.json` / `keybindings.json`**: a portable mirror of GSettings, owned by
  `ConfigSync` (`config-sync.js`; its `SETTINGS_KEYS` and `KEYBINDING_KEYS` say what
  syncs). User-facing behavior: [config.md](../user/config.md).
