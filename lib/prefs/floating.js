// Gtk imports
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";

// Gnome imports
import {
  gettext as _,
  ngettext,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Extension imports
import { PreferencesPage, RemoveItemRow, ResetButton } from "./widgets.js";
import { ConfigManager } from "../shared/settings.js";
import { Logger } from "../shared/logger.js";
import {
  WINDOW_LIST_BUS_NAME,
  WINDOW_LIST_IFACE_NAME,
  WINDOW_LIST_PATH,
  parseWindowList,
} from "../shared/window-list.js";
import {
  PREVIEW_KINDS,
  RULE_SCOPES,
  buildFloatRule,
  previewKind,
  previewRule,
  suggestScope,
  suggestTitleText,
} from "./open-windows.js";
import {
  hasOverride,
  removeOverride,
  sortFloatOverrides,
  floatRowSubtitle,
} from "./floating-overrides.js";

export class FloatingPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  constructor({ settings, dir }) {
    super({ title: _("Rules"), icon_name: "view-list-symbolic" });

    this.settings = settings;
    this.configMgr = new ConfigManager({ dir });

    // Open windows, as a starting point for a rule
    const refreshButton = new Gtk.Button({
      icon_name: "view-refresh-symbolic",
      tooltip_text: _("Refresh"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    refreshButton.connect("clicked", () => this.refreshOpenWindows());
    /** @type {Adw.ActionRow[]} */
    this.openWindowRows = [];
    this.openWindowsGroup = this.add_group({
      title: _("Open Windows"),
      description: _("Windows open right now. Pick one to float windows like it."),
      header_suffix: refreshButton,
      children: [],
    });
    this.refreshOpenWindows();

    // Add Rule section
    this.wmClassEntry = new Adw.EntryRow({ title: _("Window Class") });
    this.wmTitleEntry = new Adw.EntryRow({ title: _("Window Title (optional)") });

    const addButton = new Gtk.Button({
      label: _("Add"),
      css_classes: ["suggested-action"],
      valign: Gtk.Align.CENTER,
    });
    addButton.connect("clicked", () => this.onAddHandler());

    const addButtonRow = new Adw.ActionRow();
    addButtonRow.add_suffix(addButton);

    this.add_group({
      title: _("Add Floating Window"),
      description: _(
        "Add a rule to exclude windows from tiling. Use xprop WM_CLASS to find window class.",
      ),
      children: [this.wmClassEntry, this.wmTitleEntry, addButtonRow],
    });

    this.searchEntry = new Gtk.SearchEntry({
      placeholder_text: _("Search windows..."),
      hexpand: true,
      margin_start: 12,
      margin_end: 12,
      margin_top: 8,
      margin_bottom: 8,
    });
    this.searchEntry.connect("search-changed", () => this.onSearchChanged());

    const searchRow = new Adw.PreferencesRow({
      child: this.searchEntry,
      activatable: false,
      selectable: false,
    });

    // Existing floating windows list (sorted)
    let overrides = this.configMgr.windowProps.overrides;
    this.rows = this.loadItemsFromConfig(overrides);

    this.floatingWindowGroup = this.add_group({
      title: _("Floating Windows"),
      description: _("Windows that will not be tiled"),
      header_suffix: new ResetButton({ onReset: () => this.onResetHandler() }),
      children: [searchRow, ...this.rows],
    });
  }

  onSearchChanged() {
    const searchText = this.searchEntry.get_text().toLowerCase();
    for (const row of this.rows) {
      const title = row.get_title()?.toLowerCase() || "";
      const subtitle = row.get_subtitle()?.toLowerCase() || "";
      const visible = !searchText || title.includes(searchText) || subtitle.includes(searchText);
      row.set_visible(visible);
    }
  }

  loadItemsFromConfig(overrides) {
    // Filter to float mode and sort by display key (handles classless rules).
    const floatOverrides = sortFloatOverrides(overrides);

    return floatOverrides.map((override) => {
      return new RemoveItemRow({
        title: override.wmTitle ?? override.wmClass,
        subtitle: floatRowSubtitle(override, _("Title-only rule")),
        // Close over this specific override so removal targets exactly this rule,
        // not every override sharing the same wmClass.
        onRemove: (item, parent) => this.onRemoveHandler(override, parent),
      });
    });
  }

  onAddHandler() {
    const wmClass = this.wmClassEntry.get_text().trim();
    const wmTitle = this.wmTitleEntry.get_text().trim();

    if (!wmClass) {
      this.wmClassEntry.add_css_class("error");
      return;
    }

    const newOverride = { wmClass, mode: "float" };
    if (wmTitle) newOverride.wmTitle = wmTitle;

    if (!this.addOverride(newOverride)) {
      this.wmClassEntry.add_css_class("error");
      return;
    }
    this.wmClassEntry.remove_css_class("error");
    this.wmClassEntry.set_text("");
    this.wmTitleEntry.set_text("");
  }

  /**
   * Save a float rule and show its row.
   *
   * @param {{ wmClass: string, wmTitle?: string, mode: string }} newOverride
   * @returns {boolean} false when the rule already exists
   */
  addOverride(newOverride) {
    const { wmClass, wmTitle } = newOverride;
    const existing = this.configMgr.windowProps.overrides;
    // nextile-eryk: removeOverride is remove-ALL by structural identity (that is
    // what keeps same-class siblings safe, nextile-fov0), so a duplicate row would
    // make trashing either one delete both while the other stayed on screen.
    if (hasOverride(existing, newOverride)) return false;
    existing.push(newOverride);
    this.saveOverrides(existing);

    const itemRow = new RemoveItemRow({
      title: wmTitle || wmClass,
      subtitle: wmClass,
      // Close over the freshly-added override so this row removes exactly itself.
      onRemove: (item, parent) => this.onRemoveHandler(newOverride, parent),
    });

    const insertIndex = this.rows.findIndex(
      (row) => (row.get_subtitle() ?? "").localeCompare(wmClass) > 0,
    );
    if (insertIndex === -1) {
      this.rows.push(itemRow);
      this.floatingWindowGroup.add(itemRow);
    } else {
      // Adw.PreferencesGroup has no insert: take the rows out, then put them back
      // in order. Out first — removing the new row before it was ever added is a
      // libadwaita critical ("tried to remove non-child").
      for (const row of this.rows) this.floatingWindowGroup.remove(row);
      this.rows.splice(insertIndex, 0, itemRow);
      for (const row of this.rows) this.floatingWindowGroup.add(row);
    }

    this.searchEntry.set_text("");
    return true;
  }

  /**
   * Ask the running extension which windows are open. Prefs is its own process
   * and cannot enumerate them; see lib/shared/window-list.js.
   */
  refreshOpenWindows() {
    Gio.DBus.session.call(
      WINDOW_LIST_BUS_NAME,
      WINDOW_LIST_PATH,
      WINDOW_LIST_IFACE_NAME,
      "ListWindows",
      null,
      new GLib.VariantType("(s)"),
      Gio.DBusCallFlags.NONE,
      2000,
      null,
      (connection, result) => {
        let windows = null;
        try {
          const [json] = /** @type {[string]} */ (connection.call_finish(result).deepUnpack());
          windows = parseWindowList(json);
        } catch (e) {
          // No reply: NexTile is disabled, or an older version is still loaded.
          Logger.warn(`Rules: could not list the open windows: ${e}`);
        }
        this.showOpenWindows(windows);
      },
    );
  }

  /**
   * @param {import('../shared/window-list.js').OpenWindow[] | null} windows
   *   null when the extension did not answer
   */
  showOpenWindows(windows) {
    for (const row of this.openWindowRows) this.openWindowsGroup.remove(row);

    if (windows === null) {
      this.openWindowRows = [
        new Adw.ActionRow({
          title: _("The open windows are not available"),
          subtitle: _("Turn NexTile on, or log out and back in after an update."),
        }),
      ];
    } else if (windows.length === 0) {
      this.openWindowRows = [new Adw.ActionRow({ title: _("No open windows") })];
    } else {
      this.openWindowRows = windows.map((window) => this.makeOpenWindowRow(window, windows));
    }
    for (const row of this.openWindowRows) this.openWindowsGroup.add(row);
  }

  /**
   * @param {import('../shared/window-list.js').OpenWindow} window
   * @param {import('../shared/window-list.js').OpenWindow[]} windows
   */
  makeOpenWindowRow(window, windows) {
    // A window title is arbitrary text, not markup: turn markup off before the
    // title is set, or GTK parses it once and warns on a stray "&" or "<".
    const row = new Adw.ActionRow({ use_markup: false, title_lines: 1 });
    row.title = window.title || _("Untitled window");
    row.subtitle = window.wmClass;
    row.add_suffix(
      new Gtk.Label({
        label: window.floating ? _("Floating") : _("Tiled"),
        css_classes: ["caption", "dim-label"],
        valign: Gtk.Align.CENTER,
      }),
    );
    const floatButton = new Gtk.Button({
      label: _("Float…"),
      valign: Gtk.Align.CENTER,
      sensitive: !window.floating,
    });
    floatButton.connect("clicked", () => this.openFloatDialog(window, windows));
    row.add_suffix(floatButton);
    return row;
  }

  /**
   * "Float Windows Like This": choose how wide the rule made from `window`
   * reaches, with a preview against the windows open now.
   *
   * @param {import('../shared/window-list.js').OpenWindow} window
   * @param {import('../shared/window-list.js').OpenWindow[]} windows
   */
  openFloatDialog(window, windows) {
    const dialog = new Adw.MessageDialog({
      transient_for: /** @type {Gtk.Window} */ (this.get_root()),
      modal: true,
      heading: _("Float Windows Like This"),
      body: `${window.title || _("Untitled window")}\n${window.wmClass}`,
    });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("add", _("Add Rule"));
    dialog.set_response_appearance("add", Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response("add");
    dialog.set_close_response("cancel");

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
    const makeEntry = (scope) =>
      new Gtk.Entry({
        text: suggestTitleText(window, scope),
        margin_start: 30,
        activates_default: true,
      });

    const appRadio = new Gtk.CheckButton({ label: _("Every window of this app") });
    const containsRadio = new Gtk.CheckButton({
      label: _("Windows of this app whose title contains"),
      group: appRadio,
    });
    const containsEntry = makeEntry(RULE_SCOPES.CONTAINS);
    const excludesRadio = new Gtk.CheckButton({
      label: _("Windows of this app whose title does not contain"),
      group: appRadio,
    });
    const excludesEntry = makeEntry(RULE_SCOPES.EXCLUDES);

    const previewLabel = new Gtk.Label({
      wrap: true,
      xalign: 0,
      margin_top: 12,
      css_classes: ["dim-label"],
    });
    const ruleLabel = new Gtk.Label({
      wrap: true,
      xalign: 0,
      selectable: true,
      css_classes: ["caption", "monospace", "dim-label"],
    });

    for (const widget of [
      appRadio,
      containsRadio,
      containsEntry,
      excludesRadio,
      excludesEntry,
      previewLabel,
      ruleLabel,
    ]) {
      box.append(widget);
    }
    dialog.set_extra_child(box);

    /** @type {ReturnType<typeof buildFloatRule>} */
    let rule = null;
    const update = () => {
      /** @type {string} */
      let scope = RULE_SCOPES.APP;
      let text = "";
      if (containsRadio.active) {
        scope = RULE_SCOPES.CONTAINS;
        text = containsEntry.get_text();
      } else if (excludesRadio.active) {
        scope = RULE_SCOPES.EXCLUDES;
        text = excludesEntry.get_text();
      }
      containsEntry.sensitive = containsRadio.active;
      excludesEntry.sensitive = excludesRadio.active;

      rule = buildFloatRule(window, scope, text);
      const duplicate = rule !== null && hasOverride(this.configMgr.windowProps.overrides, rule);
      dialog.set_response_enabled("add", rule !== null && !duplicate);
      ruleLabel.label = rule ? JSON.stringify(rule) : "";
      if (rule === null) {
        previewLabel.label = text.trim()
          ? _("Use plain text: a comma or a leading ! has a special meaning in a rule.")
          : _("Enter the text to look for.");
      } else if (duplicate) {
        previewLabel.label = _("This rule already exists.");
      } else {
        previewLabel.label = this.describePreview(previewRule(rule, window, windows));
      }
    };

    const initial = suggestScope(window, windows);
    (initial === RULE_SCOPES.CONTAINS ? containsRadio : appRadio).active = true;
    for (const radio of [appRadio, containsRadio, excludesRadio]) {
      radio.connect("toggled", update);
    }
    for (const entry of [containsEntry, excludesEntry]) entry.connect("changed", update);
    update();

    dialog.connect("response", (_dialog, response) => {
      if (response === "add" && rule) this.addOverride(rule);
    });
    dialog.present();
  }

  /**
   * @param {ReturnType<typeof previewRule>} preview
   * @returns {string}
   */
  describePreview(preview) {
    const { otherMatches, otherTotal } = preview;
    switch (previewKind(preview)) {
      case PREVIEW_KINDS.MISSES_WINDOW:
        return _("This rule would not match this window.");
      case PREVIEW_KINDS.ONLY_WINDOW:
        return _("Matches this window.");
      case PREVIEW_KINDS.SPARES_OTHERS:
        return ngettext(
          "Matches this window, but not the %d other open window of this app.",
          "Matches this window, but not the %d other open windows of this app.",
          otherTotal,
        ).replace("%d", `${otherTotal}`);
      case PREVIEW_KINDS.ALL_OTHERS:
        return ngettext(
          "Matches this window and the %d other open window of this app.",
          "Matches this window and the %d other open windows of this app.",
          otherTotal,
        ).replace("%d", `${otherTotal}`);
      default:
        return _("Matches this window and %d of the %d other open windows of this app.")
          .replace("%d", `${otherMatches}`)
          .replace("%d", `${otherTotal}`);
    }
  }

  onRemoveHandler(override, parent) {
    this.floatingWindowGroup.remove(parent);
    this.rows = this.rows.filter((row) => row != parent);
    const existing = this.configMgr.windowProps.overrides;
    const modified = removeOverride(existing, override);
    this.saveOverrides(modified);
  }

  saveOverrides(modified) {
    if (modified) {
      // Spread the current props so launchRules (and anything else) survive.
      this.configMgr.windowProps = {
        ...this.configMgr.windowProps,
        overrides: modified,
      };
      // Signal the main extension to reload floating overrides.
      //
      // nextile-0w71: this was Math.floor(Date.now() / 1000). Writing an identical
      // value to a dconf-backed key emits no "changed" signal, so two edits in
      // the same second only ever notified once — and this is the ONLY channel
      // from prefs to the running extension (there is no file monitor on
      // windows.json), so the second edit never reached the live session.
      // Read-then-increment always changes, and is immune to clock jumps. The
      // gschema type is "u" (uint32), so wrap rather than overflow.
      const key = "window-overrides-reload-trigger";
      this.settings.set_uint(key, (this.settings.get_uint(key) + 1) >>> 0);
    }
  }

  onResetHandler() {
    const defaultWindowProps = this.configMgr.loadDefaultWindowConfigContents();
    const original = defaultWindowProps.overrides;
    this.saveOverrides(original);

    for (const child of this.rows) {
      this.floatingWindowGroup.remove(child);
    }

    this.rows = this.loadItemsFromConfig(original);
    for (const item of this.rows) {
      this.floatingWindowGroup.add(item);
    }

    this.searchEntry.set_text("");
  }
}
