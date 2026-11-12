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
import GObject from "gi://GObject";
// App imports
import * as Utils from "./utils.js";

/**
 * The i3/sway scratchpad: floating windows that stay hidden until asked for.
 *
 * A member floats (WindowManager.isFloatingExempt asks `has`). It is hidden by
 * minimizing it, which the tree already treats as "not on screen" everywhere.
 * While hidden it is also sticky: a minimized window still belongs to its
 * workspace, so it would keep an otherwise empty workspace alive, and GNOME's
 * workspace tracker skips windows that are on all workspaces. Hidden is read
 * from `minimized`, never stored, so a member the user minimizes or restores
 * from the dock or Alt+Tab stays consistent (`sync`).
 */
export class ScratchpadManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /**
   * Members, the longest-hidden first: `toggle` shows the head and `hide` moves
   * a window to the tail, so repeated toggles cycle through them.
   * @type {import('gi://Meta').default.Window[]}
   */
  _members = [];

  /**
   * @param {import('gi://Meta').default.Window | null | undefined} metaWindow
   * @returns {boolean}
   */
  has(metaWindow) {
    return !!metaWindow && this._members.includes(metaWindow);
  }

  /** @param {import('gi://Meta').default.Window} metaWindow */
  add(metaWindow) {
    if (!this.has(metaWindow)) this._members.push(metaWindow);
  }

  /**
   * Drop a closed window. It is no longer safe to call into.
   * @param {import('gi://Meta').default.Window | null | undefined} metaWindow
   */
  forget(metaWindow) {
    this._members = this._members.filter((w) => w !== metaWindow);
  }

  /**
   * Take a window out of the scratchpad, leaving it where it is shown.
   * @param {import('gi://Meta').default.Window | null | undefined} metaWindow
   * @returns {boolean} whether it was a member
   */
  release(metaWindow) {
    if (!this.has(metaWindow)) return false;
    this.forget(metaWindow);
    this._setSticky(metaWindow, false);
    return true;
  }

  /**
   * Hide a member.
   * @param {import('gi://Meta').default.Window} metaWindow
   */
  hide(metaWindow) {
    if (!this.has(metaWindow) || !Utils.isWindowManaged(metaWindow)) return;
    this.forget(metaWindow);
    this._members.push(metaWindow);
    metaWindow.minimize();
    this.sync(metaWindow);
  }

  /**
   * Bring a member to the active workspace and the current monitor and focus it.
   * @param {import('gi://Meta').default.Window} metaWindow
   */
  show(metaWindow) {
    if (!this.has(metaWindow) || !Utils.isWindowManaged(metaWindow)) return;
    const monitor = global.display.get_current_monitor();
    if (metaWindow.get_monitor() !== monitor) metaWindow.move_to_monitor(monitor);
    // A hidden member is sticky, so it is already on the active workspace; one
    // left showing on another workspace has to be moved.
    const active = global.workspace_manager.get_active_workspace();
    if (!metaWindow.is_on_all_workspaces() && metaWindow.get_workspace() !== active) {
      metaWindow.change_workspace(active);
    }
    if (metaWindow.minimized) metaWindow.unminimize();
    this.sync(metaWindow);
    Utils.safeActivate(metaWindow, global.display.get_current_time());
  }

  /**
   * `scratchpad show`: hide the focused member; otherwise bring over a member
   * that is showing elsewhere, or show the one hidden the longest.
   *
   * @param {import('gi://Meta').default.Window | null | undefined} focusWindow
   */
  toggle(focusWindow) {
    this._members = this._members.filter((w) => Utils.isWindowManaged(w));
    if (focusWindow && this.has(focusWindow) && !focusWindow.minimized) {
      this.hide(focusWindow);
      return;
    }
    const target = this._members.find((w) => !w.minimized) ?? this._members[0];
    if (target) this.show(target);
  }

  /**
   * Make a member sticky exactly while it is hidden. Runs after NexTile hides or
   * shows it and from the shell's minimize/unminimize signals.
   *
   * @param {import('gi://Meta').default.Window | null | undefined} metaWindow
   */
  sync(metaWindow) {
    if (metaWindow && this.has(metaWindow)) this._setSticky(metaWindow, metaWindow.minimized);
  }

  _setSticky(metaWindow, sticky) {
    if (!Utils.isWindowManaged(metaWindow)) return;
    // Both are no-ops in Mutter when the window is already in that state.
    if (sticky) metaWindow.stick();
    else metaWindow.unstick();
  }

  /** Give the members back as ordinary windows. Hidden ones stay minimized. */
  destroy() {
    const members = this._members;
    this._members = [];
    for (const metaWindow of members) this._setSticky(metaWindow, false);
  }
}
