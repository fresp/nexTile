# Portable config

NexTile can mirror its settings to `settings.json` and its keybindings to
`keybindings.json` in `~/.config/nextile/config/`, next to the
[window rules](rules.md) in `windows.json`. The files are plain JSON, so they diff
cleanly in a dotfiles repo. GSettings stays the live source; the files are an
import/export layer.

- **Export:** Preferences → Portability → Export current settings. This also turns
  on **Auto-sync changes**, which rewrites the files whenever a setting changes.
- **Reload:** Preferences → Portability → Import from files, or `Super+Shift+r`,
  which re-reads all three files. It doesn't reload the stylesheet or rebuild the
  tree.
- **On startup** NexTile imports a file only if something else changed it since NexTile
  last wrote or read it, so a file NexTile wrote never reverts newer settings.

**Open config directory** on the same page opens the folder. To move a setup to
another machine, export, copy the `*.json` files to the same
directory there, and import (or log in).

## Launch-to-workspace settings

These live in the **Behavior** group of the Tiling page (and sync through
`settings.json` like any other setting):

| Setting | Default | Effect |
| --- | --- | --- |
| `launch-new-workspace-enabled` | `true` | Move each newly launched window into a fresh workspace and tile it there. The origin workspace keeps its layout and windows. |
| `launch-new-workspace-follow` | `false` | Switch to the new workspace after the window is moved into it. |
| `launch-new-workspace-group-timeout` | `1000` | Milliseconds within which windows from the same application share one new workspace. `0` gives every window its own workspace. |

Windows that NexTile floats anyway — dialogs, transient windows, utility
windows, always-on-visible-workspace pins, and windows matching a
[float rule](rules.md) — are never moved; they behave exactly as before.
