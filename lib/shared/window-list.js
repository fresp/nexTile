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

// The D-Bus contract between the extension (which can see the open windows) and
// the prefs process (which cannot). GNOME Shell owns the bus name; the extension
// exports the object on the shell's session-bus connection.
export const WINDOW_LIST_BUS_NAME = "org.gnome.Shell";
export const WINDOW_LIST_PATH = "/org/gnome/Shell/Extensions/NexTile";
export const WINDOW_LIST_IFACE_NAME = "org.gnome.Shell.Extensions.NexTile";

export const WINDOW_LIST_IFACE = `<node>
  <interface name="${WINDOW_LIST_IFACE_NAME}">
    <method name="ListWindows">
      <arg type="s" direction="out" name="windows"/>
    </method>
  </interface>
</node>`;

/**
 * @typedef {object} OpenWindow
 * @property {string} wmClass
 * @property {string} title
 * @property {boolean} floating
 */

/**
 * Parse a ListWindows reply. The reply crosses a process boundary, so anything
 * that is not a well-formed entry is dropped rather than trusted.
 *
 * @param {unknown} json
 * @returns {OpenWindow[]}
 */
export function parseWindowList(json) {
  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : null;
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.wmClass === "string" &&
        entry.wmClass !== "" &&
        typeof entry.title === "string",
    )
    .map(({ wmClass, title, floating }) => ({ wmClass, title, floating: floating === true }));
}
