"""
"Always on Visible Workspace" tests for NexTile.

A window the user pins to all workspaces floats out of the tile grid. Left tiled,
its node follows the active workspace and reshuffles the layout on every switch.
"""

import pytest
from framework.wait import wait_for


def _states(shell_proxy):
    """Every window by title: sticky, floating by rule, frame x and width."""
    return shell_proxy.eval("""
    (function() {
        const wm = Main.extensionManager.lookup('nextile@fresp.github.io').stateObj.extWm;
        const out = {};
        for (const w of global.display.list_all_windows()) {
            const rect = w.get_frame_rect();
            out[w.get_title()] = {
                sticky: w.is_on_all_workspaces(),
                floats: wm.isFloatingExempt(w),
                x: rect.x,
                width: rect.width,
            };
        }
        return JSON.stringify(out);
    })();
    """)


def _set_sticky(shell_proxy, title, sticky):
    """What the window menu's "Always on Visible Workspace" item does."""
    shell_proxy.eval(f"""
    (function() {{
        const w = global.display.list_all_windows().find(w => w.get_title() === {title!r});
        if ({str(sticky).lower()}) w.stick(); else w.unstick();
        Main.extensionManager.lookup('nextile@fresp.github.io').stateObj.extWm
            .renderTree('e2e-sticky-pin', true);
        return 'OK';
    }})();
    """)


@pytest.fixture
def back_on_first_workspace(shell_proxy):
    yield
    shell_proxy.activate_workspace(0)


class TestStickyPin:
    def test_pinned_window_floats_and_layout_survives_a_workspace_switch(
        self, shell_proxy, window_helper, restore_settings, launch_window, back_on_first_workspace
    ):
        restore_settings.set("launch-new-workspace-enabled", False)
        shell_proxy.wait_for_nextile_settled()
        first = launch_window()
        second = launch_window()
        shell_proxy.wait_for_nextile_settled()
        workspace = window_helper.get_workspace_rect()
        pinned, other = second["title"], first["title"]

        _set_sticky(shell_proxy, pinned, True)

        # The pinned window leaves the grid and the other one takes the workspace.
        before = wait_for(
            lambda: _states(shell_proxy),
            predicate=lambda s: (
                s[pinned]["sticky"]
                and s[pinned]["floats"]
                and s[other]["width"] > workspace["width"] * 0.9
            ),
            message="pinned window did not float, or its sibling did not fill the workspace",
        )

        origin = shell_proxy.get_active_workspace_index()
        shell_proxy.activate_workspace(origin + 1)
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == origin + 1,
            message="workspace switch did not happen",
        )
        shell_proxy.wait_for_nextile_settled()
        shell_proxy.activate_workspace(origin)
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == origin,
            message="did not return to the first workspace",
        )
        shell_proxy.wait_for_layout_landed()

        after = _states(shell_proxy)
        assert after[other]["x"] == before[other]["x"]
        assert after[other]["width"] == before[other]["width"]
        assert after[pinned]["floats"]

        # Unpinned, it tiles again beside the other window.
        _set_sticky(shell_proxy, pinned, False)
        wait_for(
            lambda: _states(shell_proxy),
            predicate=lambda s: (
                not s[pinned]["floats"] and s[other]["width"] < workspace["width"] * 0.6
            ),
            message="unpinned window did not tile again",
        )
