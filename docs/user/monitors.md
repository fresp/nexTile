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

## Docking and undocking

NexTile remembers the layout of each display setup. When a monitor goes away
(a laptop undocked), its windows move to the remaining one and are tiled there;
when the same setup returns, the windows go back and get the splits, order and
sizes they had. The single-monitor arrangement is remembered the same way for the
next time you undock.

- A setup is told apart by its monitors' sizes and positions, not by which
  physical monitor is attached.
- Windows opened while the setup was away are added after the restored ones.
  Windows that were closed are left out.
- The layouts are kept in memory only: they are gone after you log out or
  disable NexTile.

## Limitations

- Portrait monitors are not fully supported: focus and navigation across a portrait
  secondary monitor can misbehave. Excluding that monitor is the workaround.
- After a change to a display setup NexTile has not seen in this session, if a
  layout looks wrong, disable and re-enable NexTile to rebuild the tree.
