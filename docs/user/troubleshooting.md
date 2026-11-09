# Troubleshooting

## First steps

- **Restart GNOME Shell:** log out and back in (on X11, `Alt+F2`, `r`, Enter also
  works).
- **Check what's enabled:** `gnome-extensions list --enabled` should show
  `nextile@fresp.github.io`. If another tiling extension is also enabled, two
  copies are tiling; disable the other one (see the README upgrade section).
- **Reload config files:** `Super+Shift+r` ([what it reloads](config.md)).

## A window won't tile, or won't float

Check, in order: a [window rule](rules.md) for its class or title, tiling being on
(`Super+w`), and whether its monitor or workspace is
[excluded](monitors.md#excluding-monitors-and-workspaces) (`Super+Shift+w` toggles
the workspace).

## A launched window didn't get its own workspace

[Launch placement](layouts.md#launch-placement) only moves windows that would
tile: dialogs, transient windows, floating windows, always-on-visible-workspace
pins and rule-matched float windows stay where they are. An application that
places its own window on a specific workspace is also left alone. Check
`launch-new-workspace-enabled` in Preferences → Workspaces → Launch placement, and note that
windows from the same application opened within the grouping window share one
workspace by design.

## Stacked or tabbed shortcuts do nothing

The mode is turned off in Preferences → Layout.

## Debug logs

Release builds don't log. Build from source with `make dev`
([CONTRIBUTING.md](../../CONTRIBUTING.md)), then:

```bash
gsettings set org.gnome.shell.extensions.nextile logging-enabled true
gsettings set org.gnome.shell.extensions.nextile log-level 5   # DEBUG; 6 TRACE, 7 ALL
journalctl -f -o cat /usr/bin/gnome-shell   # or: make log
```

Set `logging-enabled` back to `false` when done.

GNOME Shell logs JavaScript errors from any build, so the journal is worth checking
either way.

## Known limitations

- Dynamic workspaces are not supported; use a fixed number.
- Portrait monitors are [not fully supported](monitors.md#limitations).

## Reporting a bug

Use the [bug report form](https://github.com/fresp/nextile/issues/new?template=bug_report.yml);
it asks for what's needed.
