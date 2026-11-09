"""
Launch → new workspace tests for NexTile.

With launch-new-workspace-enabled, a newly launched window must land on a fresh
workspace instead of tiling next to the windows on the workspace it was
launched from.
"""

import json

import pytest
from framework.wait import wait_for


def _window_workspace(shell_proxy, title):
    """Workspace index of the window titled `title` on any workspace, or None."""
    return json.loads(
        shell_proxy.eval(f"""
    (function() {{
        const w = global.display.list_all_windows().find(w => w.get_title() === {json.dumps(title)});
        const ws = w ? w.get_workspace() : null;
        return JSON.stringify(ws ? ws.index() : null);
    }})();
    """)
    )


@pytest.fixture
def dynamic_workspaces(shell_proxy):
    """Run with Mutter's dynamic workspaces on (GNOME's default), then restore."""

    def _set(value):
        return shell_proxy.eval(f"""
        (function() {{
            const s = new (imports.gi.Gio.Settings)({{schema_id: 'org.gnome.mutter'}});
            const old = s.get_boolean('dynamic-workspaces');
            s.set_boolean('dynamic-workspaces', {str(value).lower()});
            return JSON.stringify(old);
        }})();
        """)

    old = json.loads(_set(True))
    yield
    _set(old)


class TestLaunchWorkspace:
    def test_launched_window_gets_own_workspace(
        self, shell_proxy, restore_settings, dynamic_workspaces, launch_window
    ):
        """A second window must not tile beside the first; it moves to a new workspace."""
        first = launch_window()
        origin = shell_proxy.get_active_workspace_index()

        restore_settings.set("launch-new-workspace-enabled", True)
        restore_settings.set("launch-new-workspace-follow", True)
        restore_settings.set("launch-new-workspace-group-timeout", 0)
        shell_proxy.wait_for_nextile_settled()

        second = launch_window()
        shell_proxy.wait_for_nextile_settled()

        second_ws = wait_for(
            lambda: _window_workspace(shell_proxy, second["title"]),
            predicate=lambda i: i is not None and i != origin,
            message="launched window stayed on the origin workspace",
        )
        assert _window_workspace(shell_proxy, first["title"]) == origin
        assert shell_proxy.get_active_workspace_index() == second_ws
