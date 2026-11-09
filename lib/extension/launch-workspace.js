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
import Shell from "gi://Shell";
// App imports
import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";
import { NODE_TYPES } from "./tree.js";

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
   * Pending whenDescribed idle sources, removed on destroy().
   * @type {Set<number>}
   */
  _describeSources = new Set();
  /**
   * The workspace each launch destination was launched from. Keyed by the
   * Meta.Workspace objects, not indices, so GNOME removing or renumbering
   * workspaces can't send a return to the wrong one.
   * @type {Map<import('gi://Meta').default.Workspace, import('gi://Meta').default.Workspace>}
   */
  _origins = new Map();
  /**
   * The application name each launch destination was created for, shown by the
   * NexTile indicator. Same keying as _origins.
   * @type {Map<import('gi://Meta').default.Workspace, string>}
   */
  _labels = new Map();

  /**
   * @param {import('./window.js').WindowManager} extWm
   */
  constructor(extWm) {
    super();
    this._extWm = extWm;
  }

  /**
   * Run `track` once the window describes itself. A Wayland window is created at
   * xdg_surface.get_toplevel, before the client's set_app_id / set_title /
   * set_parent, so at `window-created` its wm_class and title are null and
   * isFloatingExempt floats it by role — no Wayland window was ever relocated.
   * Those requests arrive in the same client flush, so a DEFAULT-priority idle
   * sees them applied, and it still runs before the redraw source paints the
   * window's first frame. Only deferred while the feature is on or a per-app
   * launch rule exists; otherwise `track` runs synchronously exactly as before.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @param {() => void} track
   */
  whenDescribed(metaWindow, track) {
    const enabled = this._extWm.ext?.settings?.get_boolean("launch-new-workspace-enabled");
    if ((!enabled && this._launchRules().length === 0) || metaWindow?.get_wm_class() !== null) {
      track();
      return;
    }
    let sourceId = 0;
    sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._describeSources.delete(sourceId);
      if (Utils.isWindowManaged(metaWindow)) track();
      return GLib.SOURCE_REMOVE;
    });
    if (sourceId) this._describeSources.add(sourceId);
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
      const rule = metaWindow ? this._launchRuleFor(metaWindow) : null;
      if (!this._shouldRelocate(metaWindow, rule)) return;
      const targetIndex =
        typeof rule?.workspace === "number"
          ? this._resolvePinnedWorkspace(rule.workspace - 1)
          : this._resolveTargetWorkspace(metaWindow);
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

  /** @returns {Array<{wmClass: string, wmTitle?: string, workspace: "new" | "current" | number}>} */
  _launchRules() {
    return this._extWm.windowProps?.launchRules ?? [];
  }

  /**
   * The first windows.json launch rule matching this window, or null. Rules use
   * the same class/title matching as float rules (comma lists, `!` negation).
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   */
  _launchRuleFor(metaWindow) {
    return (
      this._launchRules().find((rule) => this._extWm._matchesFloatRule(rule, metaWindow)) ?? null
    );
  }

  /**
   * Eligibility gate. Every condition here either preserves existing
   * behavior (floats, dialogs, exclusions) or prevents workspace churn.
   *
   * @param {import('gi://Meta').default.Window} metaWindow
   * @param {ReturnType<LaunchWorkspaceManager["_launchRuleFor"]>} [rule]
   * @returns {boolean}
   */
  _shouldRelocate(metaWindow, rule = null) {
    const settings = this._extWm.ext?.settings;
    if (!settings) return false;
    // A per-app rule decides on its own, even with the global switch off;
    // without one, the switch does.
    if (rule?.workspace === "current") return false;
    if (!rule && !settings.get_boolean("launch-new-workspace-enabled")) return false;
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
    const targetIndex = this._appendWorkspace();
    if (targetIndex === null) return null;
    if (groupTimeout > 0) this._setGroup(this._appKey(metaWindow), targetIndex, groupTimeout);
    return targetIndex;
  }

  /**
   * Destination for a rule that pins an app to a workspace index. A pin to the
   * active workspace is no move. A workspace that does not exist yet becomes a
   * new one at the end: appending the missing ones in between would leave empty
   * workspaces that dynamic workspaces removes again, shifting the index anyway.
   * Burst grouping does not apply; every window goes to the pinned workspace.
   *
   * @param {number} index - zero-based
   * @returns {number | null}
   */
  _resolvePinnedWorkspace(index) {
    const wsm = global.workspace_manager;
    if (!wsm) return null;
    if (index === wsm.get_active_workspace_index()) return null;
    if (wsm.get_workspace_by_index(index)) return index;
    return this._appendWorkspace();
  }

  /**
   * Append a workspace at the end and return its index, or null if Mutter
   * refused. Mutter emits workspace-added synchronously, which drives the tree
   * scaffolding (ws{n} + mo{m}ws{n}).
   *
   * @returns {number | null}
   */
  _appendWorkspace() {
    const wsm = global.workspace_manager;
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
    const origin = wsm.get_active_workspace();
    if (origin && origin !== target && !this._origins.has(target))
      this._origins.set(target, origin);
    // Label before the follow switch below, so the indicator shows it on arrival.
    if (!this._labels.has(target)) {
      this._labels.set(target, this._appName(metaWindow));
      this._labelsChanged();
    }
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
   * Switch to the workspace the active one was launched from.
   * @returns {boolean} whether there was a live origin to switch to
   */
  activateOrigin() {
    const active = global.workspace_manager?.get_active_workspace();
    const origin = active ? this._origins.get(active) : null;
    if (!origin || !this._isLiveWorkspace(origin)) return false;
    // eslint-disable-next-line local/no-raw-window-activation -- receiver is a Meta.Workspace, which has no unmanaged state.
    origin.activate(global.display?.get_current_time?.() ?? 0);
    return true;
  }

  /**
   * Called after a tracked window on workspace node `wsName` ("ws{n}") closed.
   * When that was the last window on the active launch destination, go back to
   * where it was launched from. NexTile never removes the workspace itself:
   * dynamic workspaces drop it once empty, and a static one is the user's.
   *
   * @param {string} wsName
   */
  handleWindowClosed(wsName) {
    const wsm = global.workspace_manager;
    if (!wsm) return;
    const wsNode = this._extWm.tree?.findNode(wsName);
    if (wsNode && wsNode.getNodeByType(NODE_TYPES.WINDOW).length > 0) return;
    // The workspace is empty: it no longer belongs to the app it was made for.
    const closedOn = wsm.get_workspace_by_index(Number(wsName.slice(2)));
    if (closedOn && this._labels.delete(closedOn)) this._labelsChanged();
    if (!this._extWm.ext?.settings?.get_boolean("launch-return-to-origin")) return;
    if (wsName !== `ws${wsm.get_active_workspace_index()}`) return;
    const active = wsm.get_active_workspace();
    if (!this._origins.has(active)) return;
    this.activateOrigin();
    this._origins.delete(active);
  }

  /** Forget origins and labels of workspaces GNOME removed. */
  forgetRemovedWorkspaces() {
    for (const [target, origin] of this._origins) {
      if (!this._isLiveWorkspace(target) || !this._isLiveWorkspace(origin)) {
        this._origins.delete(target);
      }
    }
    let labelsChanged = false;
    for (const workspace of this._labels.keys()) {
      if (!this._isLiveWorkspace(workspace)) labelsChanged = this._labels.delete(workspace);
    }
    if (labelsChanged) this._labelsChanged();
  }

  /**
   * The application name for a launch destination, or "" for any other
   * workspace or when launch-workspace-label is off.
   *
   * @param {import('gi://Meta').default.Workspace | null} workspace
   * @returns {string}
   */
  labelFor(workspace) {
    if (!workspace || !this._extWm.ext?.settings?.get_boolean("launch-workspace-label")) return "";
    return this._labels.get(workspace) ?? "";
  }

  _labelsChanged() {
    this._extWm.ext?.indicator?.updateWorkspaceLabel?.();
  }

  /**
   * The name GNOME shows for the window's application, falling back to its class.
   * @param {import('gi://Meta').default.Window} metaWindow
   * @returns {string}
   */
  _appName(metaWindow) {
    const name = Shell.WindowTracker.get_default().get_window_app(metaWindow)?.get_name();
    return name || metaWindow.get_wm_class() || "";
  }

  /** @param {import('gi://Meta').default.Workspace} workspace */
  _isLiveWorkspace(workspace) {
    const wsm = global.workspace_manager;
    if (!wsm) return false;
    for (let i = 0; i < wsm.get_n_workspaces(); i++) {
      if (wsm.get_workspace_by_index(i) === workspace) return true;
    }
    return false;
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
    for (const sourceId of this._describeSources) GLib.Source.remove(sourceId);
    this._describeSources.clear();
    this._origins.clear();
    this._labels.clear();
    this._relocating.clear();
  }
}
