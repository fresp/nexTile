# Multi-monitor

Each monitor has its own tree per workspace, split to suit its shape: landscape
monitors split horizontally, portrait ones vertically.

## Where new windows open

**New window placement** (`new-window-placement`, Preferences → Layout):

- `pointer` (default): the monitor with the pointer or the active window.
- `window-actual`: the monitor the window opened on, which respects geometry an app
  restores.

If windows open on the wrong monitor, try the other one.

## Excluding monitors and workspaces

**Non-tiling monitors** (`monitor-skip-tile`, Preferences → Layout) and **Non-tiling
workspaces** (`workspace-skip-tile`, Preferences → Workspaces) take comma-separated indices, e.g.
`0,1`. Windows there never tile, which suits a monitor kept for chat or media.
`Super+Shift+w` adds or removes the current workspace.

## Workspaces on the primary monitor only

With GNOME's default `workspaces-only-on-primary`, the other monitors' windows show on
every workspace. NexTile carries those monitors' layouts to the active workspace, so
focus and moves across monitors work everywhere.

## Limitations

- Portrait monitors are not fully supported: focus and navigation across a portrait
  secondary monitor can misbehave. Excluding that monitor is the workaround.
- After a display change, if a layout looks wrong, disable and re-enable NexTile to
  rebuild the tree.
