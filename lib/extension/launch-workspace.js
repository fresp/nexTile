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
import GLib from "gi://GLib";
import GObject from "gi://GObject";
// App imports
import { Logger } from "../shared/logger.js";

/**
 * Expando marking a Meta.Window that LaunchWorkspaceManager has relocated to a
 * fresh workspace. trackWindow reads it (and clears it) so the window's first
 * tree node is created directly under the destination monitor node instead of
 * the active workspace's — no transient tiling in the origin workspace.
 * @type {string}
 */
export const LAUNCH_TARGET_EXPANDO = "_nextileLaunchWorkspace";

/**
 * Implements NexTile's launch → new workspace → auto-tile behavior.
 *
 * The upstream engine has no notion of a "launch": it only ever reacts
 * to Mutter signals. This manager adds the proactive half — when an eligible
 * window appears, it appends a Mutter workspace, moves the window there, and
 * lets NexTile's existing reactive pipeline (workspace-added scaffolding →
 * trackWindow placement → processFloats tiling) do the rest.
 *
 * Guards against workspace churn:
 * - only untracked, valid, non-float-exempt windows qualify (dialogs,
 *   transients, utilities, sticky and rule-matched float windows never move);
 * - windows that already live on a non-active workspace are left alone;
 * - one relocation per window object (re-entrancy + re-track safe);
 * - same-application bursts within `launch-new-workspace-group-timeout` share
 *   one new workspace instead of spawning one per window.
 */
export class LaunchWorkspaceManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }
  /** @type {import('./window.js').WindowManager} */
  _extWm;
  /**
   * Windows with a relocation in flight. Prevents a second pass over the same
   * object (window-created can fire again for re-parented Wayland surfaces) and
   * makes the whole decision idempotent per window.
   * @type {Set<import('gi://Meta').default.Window>}
   */
  _relocating = new Set();
  /**
   * Active launch group: { key, wsIndex, sourceId }. Windows from the same
   * application inside the group timeout reuse wsIndex.
   * @type {{ key: string, wsIndex: number, sourceId: number } | null}
   */
  _group = null;

  /**
   * @param {import('./window.js').WindowManager} extWm
   */
  constructor(extWm) {
    super();
    this._extWm = extWm;
  }

  /**
   * Entry point, wired to the display `window-created` signal ahead of
   * trackWindow. Decides whether this window should be relocated to a fresh
   * workspace and performs the Mutter-side move when it should.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   */
  handleWindowCreated(metaWindow) {
    try {
      if (!this._shouldRelocate(metaWindow)) return;
      const targetIndex = this._resolveTargetWorkspace(metaWindow);
      if (targetIndex === null) return;
      this._moveToWorkspace(metaWindow, targetIndex);
    } catch (e) {
      // A failed relocation must never break window tracking: the window then
      // simply tiles in the current workspace, which is NexTile's default.
      Logger.warn(`launch-workspace: relocation skipped: ${e}`);
    }
  }

  /**
   * The workspace index a relocated window was assigned to, or null. Called by
   * trackWindow; consuming clears the expando so a later re-track of the same
   * window (reload) homes it by its live workspace instead.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @returns {number | null}
   */
  takeLaunchTarget(metaWindow) {
    const target = metaWindow?.[LAUNCH_TARGET_EXPANDO];
    if (typeof target === "number") {
      delete metaWindow[LAUNCH_TARGET_EXPANDO];
      return target;
    }
    return null;
  }

  /**
   * Eligibility gate. Every condition here either preserves existing
   * behavior (floats, dialogs, exclusions) or prevents workspace churn.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @returns {boolean}
   */
  _shouldRelocate(metaWindow) {
    const settings = this._extWm.ext?.settings;
    if (!settings?.get_boolean("launch-new-workspace-enabled")) return false;
    if (!metaWindow) return false;
    // Re-entrancy / re-track: one relocation per window object.
    if (this._relocating.has(metaWindow)) return false;
    // Already tracked (reload path): the window keeps its existing home.
    if (this._extWm.tree?.findNode(metaWindow)) return false;
    // Window-type and wm-class exclusions (UTILITY, POPUP_MENU, TOOLTIP, …).
    if (!this._extWm._validWindow(metaWindow)) return false;
    // Floating-exempt windows (dialogs, transients, always-on-top, sticky,
    // fixed-size, float-rule matches) never trigger or receive a move; they
    // keep NexTile's existing placement and float behavior.
    if (this._extWm.isFloatingExempt(metaWindow)) return false;
    // The window already chose a non-active workspace (app-side placement):
    // respect it.
    const liveWs = metaWindow.get_workspace?.();
    if (liveWs) {
      const activeIndex = global.workspace_manager?.get_active_workspace_index?.() ?? 0;
      if (liveWs.index() !== activeIndex) return false;
    }
    return true;
  }

  /**
   * Resolve the destination workspace index, creating a workspace when needed.
   * Returns null when no relocation should happen.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @returns {number | null}
   */
  _resolveTargetWorkspace(metaWindow) {
    const wsm = global.workspace_manager;
    if (!wsm) return null;
    const groupTimeout =
      this._extWm.ext?.settings?.get_uint("launch-new-workspace-group-timeout") ?? 0;
    // Same-application burst: reuse the group's workspace.
    const group = this._group;
    if (group && groupTimeout > 0 && group.key === this._appKey(metaWindow)) {
      if (wsm.get_workspace_by_index(group.wsIndex)) return group.wsIndex;
      this._clearGroup();
    }
    // Append a fresh workspace at the end. Mutter emits workspace-added
    // synchronously, which drives the tree scaffolding (ws{n} + mo{m}ws{n}).
    const before = wsm.get_n_workspaces();
    wsm.append_new_workspace(false, global.display?.get_current_time?.() ?? 0);
    const after = wsm.get_n_workspaces();
    if (after <= before) return null;
    const targetIndex = after - 1;
    // Belt-and-susandards: if workspace-added did not scaffold the tree node
    // (older Mutter, or a mock), add it directly. addWorkspace is idempotent.
    if (!this._extWm.tree?.findNode(`ws${targetIndex}`)) {
      this._extWm.tree?.addWorkspace(targetIndex);
    }
    if (groupTimeout > 0) this._setGroup(this._appKey(metaWindow), targetIndex, groupTimeout);
    return targetIndex;
  }

  /**
   * Move the window Mutter-side and mark it for trackWindow.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @param {number} targetIndex
   */
  _moveToWorkspace(metaWindow, targetIndex) {
    const wsm = global.workspace_manager;
    const target = wsm.get_workspace_by_index(targetIndex);
    if (!target) return;
    this._relocating.add(metaWindow);
    // Mark BEFORE the move: change_workspace emits workspace-changed
    // synchronously, and trackWindow (via window-created → _awaitFirstFrame)
    // may run inside that emission on some Mutter versions.
    metaWindow[LAUNCH_TARGET_EXPANDO] = targetIndex;
    metaWindow.change_workspace(target);
    // "Activate automatic tiling in the destination workspace": the new index
    // cannot be in workspace-skip-tile, but strip it defensively so a broad
    // user rule can't silently disable tiling on arrival.
    this._ensureWorkspaceTiled(targetIndex);
    if (this._extWm.ext?.settings?.get_boolean("launch-new-workspace-follow")) {
      // Workspace.activate(), not Meta.Window.activate(): the lint rule bans the
      // raw window call because a window can be unmanaged; a Workspace cannot.
      // eslint-disable-next-line local/no-raw-window-activation -- receiver is a Meta.Workspace, which has no unmanaged state.
      target.activate(global.display?.get_current_time?.() ?? 0);
    }
    Logger.debug(`launch-workspace: moved ${metaWindow.get_id()} to ws${targetIndex}`);
  }

  /**
   * Remove wsIndex from the workspace-skip-tile list if present.
   * @param {number} wsIndex
   */
  _ensureWorkspaceTiled(wsIndex) {
    const settings = this._extWm.ext?.settings;
    if (!settings) return;
    const current = settings.get_string("workspace-skip-tile") ?? "";
    const kept = current
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "" && item !== `${wsIndex}`);
    if (kept.length !== current.split(",").filter((i) => i.trim() !== "").length) {
      settings.set_string("workspace-skip-tile", kept.join(","));
    }
  }

  /**
   * Stable per-application key for burst grouping. pid is the only identity
   * available at window-created time on Wayland (wm_class arrives later via
   * notify::wm-class); fall back to wm_class, then the window id.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @returns {string}
   */
  _appKey(metaWindow) {
    try {
      const pid = metaWindow.get_pid?.();
      if (pid) return `pid:${pid}`;
    } catch (e) {
      // finalized wrapper — fall through
    }
    return `class:${metaWindow.get_wm_class?.() ?? metaWindow.get_id?.() ?? "unknown"}`;
  }

  /**
   * @param {string} key
   * @param {number} wsIndex
   * @param {number} timeoutMs
   */
  _setGroup(key, wsIndex, timeoutMs) {
    this._clearGroup();
    this._group = {
      key,
      wsIndex,
      sourceId: GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        this._group = null;
        return false;
      }),
    };
  }

  _clearGroup() {
    if (this._group) {
      if (this._group.sourceId) GLib.Source.remove(this._group.sourceId);
      this._group = null;
    }
  }

  /**
   * Release per-window marks and the group timer. Called from
   * WindowManager.disable(); signal handlers are owned by WindowManager.
   */
  destroy() {
    this._clearGroup();
    this._relocating.clear();
  }
}
