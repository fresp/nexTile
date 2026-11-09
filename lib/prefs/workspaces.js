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

import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { EntryRow, PreferencesPage, RemoveItemRow, SpinButtonRow, SwitchRow } from "./widgets.js";
import { intListMap } from "./settings.js";
import { hasOverride, removeOverride } from "./floating-overrides.js";
import { ConfigManager } from "../shared/settings.js";

// Where a per-app rule can send a window: the windows.json `workspace` values.
const WORKSPACE_CHOICES = ["new", "current", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** @param {"new" | "current" | number} workspace */
function workspaceLabel(workspace) {
  if (workspace === "new") return _("New workspace");
  if (workspace === "current") return _("Current workspace");
  return _("Workspace %d").replace("%d", String(workspace));
}

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
  constructor({ settings, dir, aboutButton }) {
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
        new SwitchRow({
          title: _("Return to origin on close"),
          subtitle: _(
            "When the last window on a launched workspace closes, switch back to the workspace it was launched from"
          ),
          settings,
          bind: "launch-return-to-origin",
        }),
        new SwitchRow({
          title: _("Show app name in the top bar"),
          subtitle: _(
            "On a launched workspace, show the application's name beside the NexTile icon (needs the tray icon)"
          ),
          settings,
          bind: "launch-workspace-label",
        }),
      ],
    });
    this.settings = settings;
    this.configMgr = new ConfigManager({ dir });
    this.ruleClassEntry = new Adw.EntryRow({ title: _("Window Class") });
    this.ruleTitleEntry = new Adw.EntryRow({ title: _("Window Title (optional)") });
    this.ruleWorkspaceRow = new Adw.ComboRow({
      title: _("Opens on"),
      model: Gtk.StringList.new(WORKSPACE_CHOICES.map(workspaceLabel)),
    });
    const addButton = new Gtk.Button({
      label: _("Add"),
      css_classes: ["suggested-action"],
      valign: Gtk.Align.CENTER,
    });
    addButton.connect("clicked", () => this.onAddRule());
    const addButtonRow = new Adw.ActionRow();
    addButtonRow.add_suffix(addButton);
    this.add_group({
      title: _("Per-app placement"),
      description: _(
        "Choose where one application's new windows open. A rule applies even when launching into a new workspace is off. Use xprop WM_CLASS to find window class."
      ),
      children: [this.ruleClassEntry, this.ruleTitleEntry, this.ruleWorkspaceRow, addButtonRow],
    });
    this.ruleRows = [];
    this.ruleGroup = this.add_group({
      title: _("Placement rules"),
      description: _("The first rule that matches a window decides where it opens"),
      children: [],
    });
    this.showRules(this.configMgr.windowProps.launchRules ?? []);

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

  /** @param {Array<{wmClass: string, wmTitle?: string, workspace: "new" | "current" | number}>} rules */
  showRules(rules) {
    for (const row of this.ruleRows) this.ruleGroup.remove(row);
    this.ruleRows = rules.map(
      (rule) =>
        new RemoveItemRow({
          title: rule.wmTitle ?? rule.wmClass,
          subtitle: `${rule.wmClass} · ${workspaceLabel(rule.workspace)}`,
          onRemove: () => this.saveRules(removeOverride(this.currentRules(), rule)),
        })
    );
    for (const row of this.ruleRows) this.ruleGroup.add(row);
  }

  currentRules() {
    return this.configMgr.windowProps.launchRules ?? [];
  }

  onAddRule() {
    const wmClass = this.ruleClassEntry.get_text().trim();
    if (!wmClass) {
      this.ruleClassEntry.add_css_class("error");
      return;
    }
    this.ruleClassEntry.remove_css_class("error");
    const wmTitle = this.ruleTitleEntry.get_text().trim();
    const rule = { wmClass, workspace: WORKSPACE_CHOICES[this.ruleWorkspaceRow.get_selected()] };
    if (wmTitle) rule.wmTitle = wmTitle;
    // One rule per class/title pair: adding the same pair again changes where it opens.
    const rules = this.currentRules();
    const kept = hasOverride(rules, rule) ? removeOverride(rules, rule) : rules;
    this.saveRules([...kept, rule]);
    this.ruleClassEntry.set_text("");
    this.ruleTitleEntry.set_text("");
  }

  saveRules(launchRules) {
    this.configMgr.windowProps = { ...this.configMgr.windowProps, launchRules };
    // The running extension rereads windows.json when this counter changes (see
    // FloatingPage.saveOverrides for why it increments instead of using a timestamp).
    const key = "window-overrides-reload-trigger";
    this.settings.set_uint(key, (this.settings.get_uint(key) + 1) >>> 0);
    this.showRules(launchRules);
  }
}
