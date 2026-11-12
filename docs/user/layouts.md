# Layouts

NexTile keeps each workspace's windows in a tree of containers, as i3 and sway do.
Each container lays out its children in one layout. Shortcuts below are defaults;
see [keybindings](keybindings.md).

## Splits

A container is a horizontal split (left to right) or a vertical split (top to
bottom). New windows join the focused container.

- `Super+g` flips the focused container's direction.
- `Super+v` / `Super+z` split the focused window vertically / horizontally. Splits
  nest, which is how complex layouts are built.
- **Quarter tiling** (`auto-split-enabled`, off) picks the direction from the
  focused window's shape instead. A direction chosen with `Super+v` / `Super+z`
  still wins.
- **Auto re-orient on close** (`auto-reorient-on-close`, off) flips a split to match
  its shape when a child closes. It overrides directions you set by hand.

## Stacked and tabbed

The container shows one child at a time, with a title bar per child: stacked
(`Super+Shift+s`) lists them vertically, tabbed (`Super+Shift+t`) as a tab strip.

- Each mode can be turned off in Preferences → Layout; its shortcut then does
  nothing.
- **Auto exit tabbed tiling** (on) returns a container to a split when one tab is left.
- **Default layout for new windows** (`default-window-layout`) sets the layout of a
  container a split creates.
- Tab bar position and height are in Preferences → Look. `Ctrl+Alt+y` hides
  the bars; switch children with focus navigation.

## Monocle

Gathers the tiled windows on the workspace's first monitor into one tabbed
container; toggling again leaves them in one flat split. Unbound by default
(`workspace-monocle-toggle`).

## Snapping

`Ctrl+Alt` chords float the focused window and place it on a third, two thirds or
the center of the screen. `Super+c` tiles it again.

## Golden ratio

Resizes the focused window against its neighbour at about 1.618:1, keeping the tree
as is. `Super+=` evens them out again. Unbound by default (`window-golden-ratio`).

## Floating

`Super+c` floats the focused window, `Super+Shift+c` its whole app. A floating
window keeps its place in the tree and returns there when tiled again. Some windows
float automatically; [window rules](rules.md) control which.

## Scratchpad

The scratchpad keeps windows out of sight until you ask for them, as in i3 and
sway: a terminal, a music player, notes.

- `Super+Shift+-` sends the focused window to the scratchpad. It becomes a
  floating window and disappears.
- `Super+-` shows a scratchpad window on the current workspace and monitor.
  Pressed while that window has the focus, it hides it again. With several
  windows in the scratchpad, each press shows the one hidden the longest. A
  scratchpad window left showing on another workspace is brought over first.
- `Super+c` on a scratchpad window takes it out of the scratchpad and tiles it.

A hidden window is minimized and set to show on all workspaces, so it does not
keep an empty workspace open. It therefore still appears, as a minimized
window, in `Alt+Tab` and the overview; picking it there shows it. The scratchpad
is not saved: after you log out, or disable NexTile, its windows are ordinary
windows again, and the hidden ones stay minimized.

## Drag to tile

Drag a window over another and a preview shows where it will land (left, right, top,
bottom or center); drop to tile it there. A center drop makes a tabbed or stacked
container (**Drag-and-drop behavior**, `dnd-center-layout`).

**Drag-and-drop modifier key** (Preferences → Shortcuts, `mod-mask-mouse-tile`)
makes tiling happen only while that key is held. The default, `None`, tiles every
drag. `preview-hint-enabled` turns the preview off.
## Launch placement
By default NexTile does not tile a newly launched window into the workspace you
are looking at. Instead it creates a new workspace, moves the window there, and
tiles it — the current workspace keeps its layout and windows. Launch another
application and it gets its own new workspace the same way. Windows from the
same application opened within a second share one new workspace.

- Turn the behavior off, make NexTile switch to the new workspace, or change the
  grouping window in Preferences → Workspaces → Launch placement
  (`launch-new-workspace-enabled`, `launch-new-workspace-follow`,
  `launch-new-workspace-group-timeout`; see [config](config.md#launch-to-workspace-settings)).
- Dialogs, transient windows, floating windows and rule-matched windows are never
  moved; they open where they always did.
- Moving a window between workspaces by hand works as before: the destination
  workspace tiles it according to its own layout.
