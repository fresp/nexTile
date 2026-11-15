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

// App imports
import * as Utils from "./utils.js";

// Display setups remembered at once. A laptop sees two or three (undocked, one
// dock, another); the cap only bounds what a long session can pile up.
const MAX_SETUPS = 8;

/**
 * Remembers the tiling layout of each display setup, so that docking a laptop
 * again brings back the splits, order and sizes it had.
 *
 * When a monitor goes, Mutter moves its windows to another one and NexTile
 * merges them into that monitor's tree; when it returns, Mutter moves the windows
 * back but the structure they had is gone. Mutter has no "displays are about to
 * change" signal, and by the time monitors-changed fires the tree has already
 * been merged. So the layout is recorded continuously instead: before every
 * render, under a fingerprint of the monitor geometries at that moment. NexTile
 * only reshuffles the tree after the geometry has changed, so what is stored
 * under the old fingerprint is always that setup's own layout.
 *
 * Kept in memory and keyed by live Meta.Window objects: it lasts until NexTile is
 * disabled or the session ends.
 */
export class LayoutMemory {
  /** @type {Map<string, object[]>} fingerprint -> Tree.snapshotLayout(), oldest first */
  _layouts = new Map();
  /** @type {string | null} */
  _current = null;
  /** @type {object[] | null} */
  _pending = null;

  /**
   * The monitors' geometries, in index order. Not their physical identity: the
   * same dock with a different cable still gets its layout back.
   *
   * @returns {string | null} null while there is no monitor (lock, KVM switch)
   */
  fingerprint() {
    const count = global.display.get_n_monitors();
    const parts = [];
    for (let i = 0; i < count; i++) {
      const rect = Utils.getMonitorGeometrySafe(i);
      if (!rect) return null;
      parts.push(`${rect.width}x${rect.height}+${rect.x}+${rect.y}`);
    }
    return parts.length ? parts.join(",") : null;
  }

  /**
   * Called before each render. Records the tree under the current display setup,
   * or, on the first render after the setup changed to one seen before, hands
   * its layout over through `takePending`.
   *
   * While a layout waits to be restored the tree still has the previous setup's
   * shape, and rendering it would drag windows back to where that setup had
   * them (off a monitor that just returned). So the caller must not render until
   * the layout has been taken.
   *
   * @param {import('./tree.js').Tree} tree
   * @returns {boolean} whether a remembered layout is waiting to be restored
   */
  track(tree) {
    if (this._pending) return true;
    const fingerprint = this.fingerprint();
    if (!fingerprint) return false;
    if (fingerprint !== this._current) {
      const started = this._current === null;
      this._current = fingerprint;
      const remembered = this._layouts.get(fingerprint);
      if (!started && remembered) {
        this._pending = remembered;
        return true;
      }
    }
    this._layouts.delete(fingerprint);
    this._layouts.set(fingerprint, tree.snapshotLayout());
    if (this._layouts.size > MAX_SETUPS) {
      this._layouts.delete(this._layouts.keys().next().value);
    }
    return false;
  }

  /** The layout to restore, once. */
  takePending() {
    const pending = this._pending;
    this._pending = null;
    return pending;
  }

  clear() {
    this._layouts.clear();
    this._current = null;
    this._pending = null;
  }
}
