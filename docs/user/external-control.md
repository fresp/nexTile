# Control from other programs

Scripts, gesture tools and launchers can run NexTile actions and read a little of
its state over D-Bus, as `i3-msg` does for i3.

## Turning it on

Preferences → Layout → External control → **Allow other programs to control
NexTile**. It is off by default, and while it is off every call is refused.

Any program running in your session can use it once it is on. The setting
(`external-control-enabled`) is not part of the [portable config](config.md), so
importing a config on another machine does not turn it on there.

## Running an action

An action is named by its keybinding key, the same names
[Preferences → Shortcuts and `keybindings.json`](keybindings.md#customizing) use,
and does exactly what the shortcut does:

```bash
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/NexTile \
  --method org.gnome.Shell.Extensions.NexTile.Control.Run scratchpad-show
```

`window-focus-left`, `window-swap-right`, `con-split-layout-toggle`,
`workspace-monocle-toggle` and the rest work the same way, whether or not a
shortcut is bound to them.

Three actions cannot be run this way, because they start a program or write
files: `prefs-app-launch`, `prefs-lock-screen` and `prefs-config-export`.

A call is refused with one of these errors, each prefixed
`org.gnome.Shell.Extensions.NexTile.Error.`:

| Error | Meaning |
| --- | --- |
| `Disabled` | External control is off. |
| `UnknownAction` | No keybinding key has that name. |
| `NotAllowed` | One of the three actions above. |
| `Unavailable` | The shortcuts are not active: the screen is locked, or the overview or a dialog is open. |

## Reading state

```bash
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/NexTile \
  --method org.gnome.Shell.Extensions.NexTile.Control.GetState
```

returns one JSON string:

```json
{
  "tiling": true,
  "workspace": 0,
  "scratchpad": { "windows": 2, "hidden": 1 },
  "focus": { "wmClass": "org.gnome.Console", "floating": false, "layout": "HSPLIT" }
}
```

`workspace` counts from 0. `focus` is `null` when no window NexTile tracks has the
focus. Window titles are never included.

There is no change signal; poll `GetState` if you need to follow it.
