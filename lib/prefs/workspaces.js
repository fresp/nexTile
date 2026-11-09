/*
 * This file is part of the NexTile GNOME extension
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import GObject from "gi://GObject";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { EntryRow, PreferencesPage, SpinButtonRow, SwitchRow } from "./widgets.js";
import { intListMap } from "./settings.js";

/**
 * NexTile's first page: where windows land. Launch placement is the feature
 * that sets NexTile apart, so it leads the window instead of sitting inside the
 * tiling behavior list.
 */
export class WorkspacesPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  // aboutButton is only passed as a fallback when prefs.js couldn't place it in
  // the window header bar; normally About lives in the header, not on this page.
  constructor({ settings, aboutButton }) {
    super({ title: _("Workspaces"), icon_name: "view-app-grid-symbolic" });
    this.add_group({
      title: _("Launch placement"),
      description: _("Where a newly launched application window opens"),
      ...(aboutButton && { header_suffix: aboutButton }),
      children: [
        new SwitchRow({
          title: _("Launch windows into a new workspace"),
          subtitle: _(
            "Each newly launched window moves to a fresh workspace and is tiled there, leaving the current workspace untouched"
          ),
          settings,
          bind: "launch-new-workspace-enabled",
        }),
        new SwitchRow({
          title: _("Follow launched windows"),
          subtitle: _("Switch to the new workspace after a window is launched into it"),
          settings,
          bind: "launch-new-workspace-follow",
        }),
        new SpinButtonRow({
          title: _("Launch grouping window"),
          subtitle: _(
            "Milliseconds within which windows from the same application share one new workspace (0 disables grouping)"
          ),
          range: [0, 10000, 100],
          settings,
          bind: "launch-new-workspace-group-timeout",
        }),
      ],
    });
    this.add_group({
      title: _("Non-tiling workspaces"),
      description: _("Disables tiling on specified workspaces. Starts from 0, separated by commas"),
      children: [
        new EntryRow({
          title: _("Example: 0,1,2"),
          settings,
          bind: "workspace-skip-tile",
          map: intListMap,
        }),
      ],
    });
  }
}
