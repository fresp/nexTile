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
import GLib from "gi://GLib";
// App imports
import {
  CONTROL_BLOCKED_ACTIONS,
  CONTROL_ERROR_PREFIX,
  CONTROL_IFACE,
  CONTROL_PATH,
} from "../shared/external-control.js";
import * as Utils from "./utils.js";

/** A refusal with the D-Bus error name it is reported under. */
export class ControlError extends Error {
  /**
   * @param {"Disabled" | "UnknownAction" | "NotAllowed" | "Unavailable"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Lets other programs run NexTile actions and read a little state over D-Bus,
 * as i3-msg does for i3. Off unless the user turns on external-control-enabled.
 *
 * An action is named by its keybinding key and runs that key's own callback, so
 * it behaves exactly like the shortcut and honors the same settings.
 */
export class ExternalControlService {
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
    this._dbus = Gio.DBusExportedObject.wrapJSObject(CONTROL_IFACE, this);
    this._dbus.export(Gio.DBus.session, CONTROL_PATH);
  }

  destroy() {
    this._dbus?.unexport();
    this._dbus = null;
  }

  /** D-Bus method Run(s). */
  RunAsync([action], invocation) {
    this._reply(invocation, () => {
      this.run(action);
      return null;
    });
  }

  /** D-Bus method GetState() -> s. */
  GetStateAsync(_params, invocation) {
    this._reply(invocation, () => new GLib.Variant("(s)", [JSON.stringify(this.state())]));
  }

  _reply(invocation, call) {
    try {
      invocation.return_value(call());
    } catch (e) {
      const code = e instanceof ControlError ? e.code : "Failed";
      invocation.return_dbus_error(`${CONTROL_ERROR_PREFIX}.${code}`, e.message);
    }
  }

  /**
   * Run the action bound to a keybinding key.
   * @param {string} action
   */
  run(action) {
    this._requireEnabled();
    if (CONTROL_BLOCKED_ACTIONS.includes(action)) {
      throw new ControlError("NotAllowed", `"${action}" cannot be run by other programs`);
    }
    const keybindings = this._extWm.ext?.keybindings;
    if (!keybindings?.has(action)) {
      throw new ControlError("UnknownAction", `No action named "${action}"`);
    }
    if (!keybindings.run(action)) {
      throw new ControlError("Unavailable", "NexTile shortcuts are not active right now");
    }
  }

  /**
   * What a script or bar needs to decide what to do. No window titles: any
   * program on the session bus can ask.
   */
  state() {
    this._requireEnabled();
    const wm = this._extWm;
    const focus = wm.focusMetaWindow;
    const node = Utils.isWindowAlive(focus) ? wm.findNodeWindow(focus) : null;
    return {
      tiling: wm.ext.settings?.get_boolean("tiling-mode-enabled") ?? false,
      workspace: global.workspace_manager.get_active_workspace_index(),
      scratchpad: wm.scratchpad.summary(),
      focus: node
        ? {
            wmClass: focus.get_wm_class() ?? "",
            floating: node.isFloat(),
            layout: node.parentNode?.layout ?? null,
          }
        : null,
    };
  }

  _requireEnabled() {
    if (!this._extWm.ext?.settings?.get_boolean("external-control-enabled")) {
      throw new ControlError("Disabled", "External control is turned off in NexTile preferences");
    }
  }
}
