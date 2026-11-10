/*
 * This file is part of the NexTile extension for GNOME
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
// Gnome imports
import Gio from "gi://Gio";
// App imports
import { PREFS_TITLE, PREFS_WM_CLASS } from "../shared/settings.js";
import { WINDOW_LIST_IFACE, WINDOW_LIST_PATH } from "../shared/window-list.js";
import { NODE_TYPES } from "./tree.js";
import * as Utils from "./utils.js";

/**
 * Tells the prefs process which windows are open, so its Rules page can offer
 * them as the starting point of a float rule. Prefs runs outside the shell and
 * cannot enumerate windows itself.
 *
 * Answered on request over D-Bus rather than mirrored into GSettings: window
 * titles (documents, browser tabs) must not be written to the user's dconf.
 */
export class WindowListService {
  /** @type {import('./window.js').WindowManager} */
  _extWm;
  /** @type {Gio.DBusExportedObject | null} */
  _dbus = null;

  /**
   * @param {import('./window.js').WindowManager} extWm
   */
  constructor(extWm) {
    this._extWm = extWm;
  }

  enable() {
    if (this._dbus) return;
    this._dbus = Gio.DBusExportedObject.wrapJSObject(WINDOW_LIST_IFACE, this);
    this._dbus.export(Gio.DBus.session, WINDOW_LIST_PATH);
  }

  destroy() {
    this._dbus?.unexport();
    this._dbus = null;
  }

  /**
   * D-Bus method: the open windows as a JSON array of OpenWindow.
   * @returns {string}
   */
  ListWindows() {
    return JSON.stringify(this.listWindows());
  }

  /**
   * The windows NexTile tracks, across all workspaces. A window without a class
   * is left out: a rule cannot name it. So is the prefs window asking.
   *
   * @returns {import('../shared/window-list.js').OpenWindow[]}
   */
  listWindows() {
    const nodes = this._extWm.tree?.getNodeByType(NODE_TYPES.WINDOW) ?? [];
    const windows = [];
    for (const node of nodes) {
      const metaWindow = node.nodeValue;
      // A window can be finalized between its close and its node's removal.
      if (!Utils.isWindowAlive(metaWindow)) continue;
      const wmClass = metaWindow.get_wm_class();
      if (!wmClass) continue;
      const title = metaWindow.get_title() ?? "";
      if (wmClass === PREFS_WM_CLASS && title === PREFS_TITLE) continue;
      // The name GNOME shows for the application, e.g. "Microsoft Edge".
      const appName = node.app?.get_name() ?? "";
      windows.push({ wmClass, title, appName, floating: node.isFloat() });
    }
    return windows;
  }
}
