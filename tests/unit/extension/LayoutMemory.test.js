import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LAYOUT_TYPES, NODE_TYPES } from "../../../lib/extension/tree.js";
import { LayoutMemory } from "../../../lib/extension/layout-memory.js";
import {
  createContainerNode,
  createWindowManagerFixture,
  createWindowNode,
} from "../../mocks/helpers/index.js";

/**
 * A display setup's layout is remembered and restored when that setup returns
 * (laptop undocked, then docked again). The tests use the real Tree and
 * WindowManager; the display mock's monitor count stands in for the dock.
 */
describe("LayoutMemory", () => {
  let ctx;
  let monitors;

  beforeEach(() => {
    monitors = 2;
    ctx = createWindowManagerFixture({
      globals: {
        display: { monitorCount: 2 },
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 },
      },
    });
    ctx.display.get_n_monitors.mockImplementation(() => monitors);
  });

  afterEach(() => ctx.cleanup());

  const tree = () => ctx.tree;
  const mon = (m, ws) => tree().findNode(`mo${m}ws${ws}`);
  const addWindow = (parent, id, monitor = 0) =>
    createWindowNode(tree(), parent, {
      windowOverrides: { id, monitor, workspace: ctx.workspaces[0] },
    }).nodeWindow;

  /** `[layout share child child]` for containers, `id@share` for windows. */
  const shape = (node) =>
    node.isWindow()
      ? `${node.nodeValue.id}@${node.percent}`
      : `[${node.layout}${node.isMonitor() ? "" : `@${node.percent}`} ${node.childNodes.map(shape).join(" ")}]`;

  /** What a reload leaves: every window flat under its monitor, shares unset. */
  const flatten = (monitor, order) => {
    const windows = monitor.getNodeByType(NODE_TYPES.WINDOW);
    const byId = new Map(windows.map((node) => [node.nodeValue.id, node]));
    order.forEach((id) => {
      const node = byId.get(id);
      node.percent = 0;
      monitor.appendChild(node);
    });
    monitor.childNodes.filter((node) => node.isCon()).forEach((con) => monitor.removeChild(con));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
  };

  /** monitor 1: [HSPLIT 1@0.4 [VSPLIT@0.6 2@0.7 3@0.3]] */
  const buildNested = () => {
    const monitor = mon(1, 0);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = addWindow(monitor, 1, 1);
    const con = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT);
    const b = addWindow(con, 2, 1);
    const c = addWindow(con, 3, 1);
    a.percent = 0.4;
    con.percent = 0.6;
    b.percent = 0.7;
    c.percent = 0.3;
    return { monitor, a, b, c, con };
  };

  describe("Tree.snapshotLayout / restoreLayout", () => {
    it("brings back nesting, order, layouts and shares", () => {
      const { monitor } = buildNested();
      const before = shape(monitor);
      const snapshot = tree().snapshotLayout();

      flatten(monitor, [3, 1, 2]);
      expect(shape(monitor)).toBe("[HSPLIT 3@0 1@0 2@0]");

      tree().restoreLayout(snapshot);
      expect(shape(monitor)).toBe(before);
      expect(before).toBe("[HSPLIT 1@0.4 [VSPLIT@0.6 2@0.7 3@0.3]]");
    });

    it("restores a stacked group with the window it showed", () => {
      const monitor = mon(0, 0);
      const con = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);
      const a = addWindow(con, 1);
      const b = addWindow(con, 2);
      con.layout = LAYOUT_TYPES.STACKED;
      con.lastTabFocus = b.nodeValue;
      addWindow(monitor, 3);
      const snapshot = tree().snapshotLayout();

      flatten(monitor, [1, 2, 3]);
      tree().restoreLayout(snapshot);

      const group = monitor.childNodes[0];
      expect(group.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(group.splitLayout).toBe(LAYOUT_TYPES.HSPLIT);
      expect(group.childNodes).toEqual([a, b]);
      expect(group.lastTabFocus).toBe(b.nodeValue);
    });

    it("leaves out a window that closed and puts new windows last", () => {
      const { monitor, c } = buildNested();
      const snapshot = tree().snapshotLayout();

      flatten(monitor, [1, 2, 3]);
      tree().removeNode(c);
      addWindow(monitor, 9, 1);
      // The newcomer sits first in the flat tree; the restored ones go ahead of it.
      monitor.insertBefore(monitor.lastChild, monitor.firstChild);

      tree().restoreLayout(snapshot);
      // The container of 2 and 3 collapsed to 2, which takes its 0.6 share.
      expect(shape(monitor)).toBe("[HSPLIT 1@0.4 2@0.6 9@0]");
    });

    it("restores onto the workspace the monitor's windows are on now", () => {
      const { monitor } = buildNested();
      const snapshot = tree().snapshotLayout();
      // A secondary monitor's windows follow the active workspace.
      const other = mon(1, 1);
      flatten(monitor, [3, 2, 1]);
      [...monitor.childNodes].forEach((node) => other.appendChild(node));

      tree().restoreLayout(snapshot);
      expect(shape(other)).toBe("[HSPLIT 1@0.4 [VSPLIT@0.6 2@0.7 3@0.3]]");
    });

    it("does nothing for windows that are on another monitor now", () => {
      const { monitor } = buildNested();
      const snapshot = tree().snapshotLayout();
      const primary = mon(0, 0);
      flatten(monitor, [3, 2, 1]);
      [...monitor.childNodes].forEach((node) => primary.appendChild(node));

      tree().restoreLayout(snapshot);
      expect(shape(primary)).toBe("[HSPLIT 3@0 2@0 1@0]");
    });
  });

  describe("track", () => {
    let memory;
    beforeEach(() => {
      memory = new LayoutMemory();
    });

    it("fingerprints the monitor geometries", () => {
      expect(memory.fingerprint()).toBe("1920x1080+0+0,1920x1080+1920+0");
      monitors = 1;
      expect(memory.fingerprint()).toBe("1920x1080+0+0");
      monitors = 0;
      expect(memory.fingerprint()).toBeNull();
    });

    it("hands back a setup's own layout when the setup returns", () => {
      const { monitor } = buildNested();
      expect(memory.track(tree())).toBe(false);

      // Undocked: by the first render the windows are merged onto monitor 0.
      monitors = 1;
      flatten(monitor, [1, 2, 3]);
      [...monitor.childNodes].forEach((node) => mon(0, 0).appendChild(node));
      expect(memory.track(tree())).toBe(false);
      expect(memory.takePending()).toBeNull();

      // Docked again: Mutter has moved the windows back.
      monitors = 2;
      [...mon(0, 0).childNodes].forEach((node) => monitor.appendChild(node));
      expect(memory.track(tree())).toBe(true);

      tree().restoreLayout(memory.takePending());
      expect(shape(monitor)).toBe("[HSPLIT 1@0.4 [VSPLIT@0.6 2@0.7 3@0.3]]");
      expect(memory.takePending()).toBeNull();
    });

    it("keeps asking for the restore, and records nothing, until it is taken", () => {
      buildNested();
      memory.track(tree());
      monitors = 1;
      memory.track(tree());
      monitors = 2;
      expect(memory.track(tree())).toBe(true);
      const remembered = memory._layouts.get(memory.fingerprint());

      expect(memory.track(tree())).toBe(true);
      expect(memory._layouts.get(memory.fingerprint())).toBe(remembered);

      memory.takePending();
      expect(memory.track(tree())).toBe(false);
    });

    it("does not restore on the first render of a session", () => {
      buildNested();
      memory._layouts.set(memory.fingerprint(), tree().snapshotLayout());
      expect(memory.track(tree())).toBe(false);
    });

    it("ignores the moment without any monitor", () => {
      buildNested();
      memory.track(tree());
      monitors = 0;
      expect(memory.track(tree())).toBe(false);
      monitors = 2;
      expect(memory.track(tree())).toBe(false);
    });

    it("forgets everything when cleared", () => {
      buildNested();
      memory.track(tree());
      memory.clear();
      expect(memory._layouts.size).toBe(0);
      expect(memory.takePending()).toBeNull();
    });
  });
});
