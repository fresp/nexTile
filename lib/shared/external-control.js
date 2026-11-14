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

// The D-Bus contract for controlling NexTile from other programs. It is a second
// interface on the object the extension already exports for prefs (see
// window-list.js); GNOME Shell owns the bus name.
export const CONTROL_PATH = "/org/gnome/Shell/Extensions/NexTile";
export const CONTROL_IFACE_NAME = "org.gnome.Shell.Extensions.NexTile.Control";
export const CONTROL_ERROR_PREFIX = "org.gnome.Shell.Extensions.NexTile.Error";

export const CONTROL_IFACE = `<node>
  <interface name="${CONTROL_IFACE_NAME}">
    <method name="Run">
      <arg type="s" direction="in" name="action"/>
    </method>
    <method name="GetState">
      <arg type="s" direction="out" name="state"/>
    </method>
  </interface>
</node>`;

// Keybinding actions other programs may not run: they start a program or write
// files, and a caller on the session bus should not get either through NexTile.
export const CONTROL_BLOCKED_ACTIONS = Object.freeze([
  "prefs-app-launch",
  "prefs-lock-screen",
  "prefs-config-export",
]);
