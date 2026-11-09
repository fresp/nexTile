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


def _set_launch_rules(shell_proxy, rules):
    """Write windows.json launchRules and make the running extension reload them."""
    shell_proxy.eval(f"""
    (function() {{
        const ext = Main.extensionManager.lookup('nextile@fresp.github.io').stateObj;
        const props = ext.configMgr.windowProps;
        props.launchRules = {json.dumps(rules)};
        ext.configMgr.windowProps = props;
        ext.extWm.reloadWindowOverrides(false);
        return 'OK';
    }})();
    """)


@pytest.fixture
def launch_rules(shell_proxy):
    """Set launchRules for one test, then clear them."""
    yield lambda rules: _set_launch_rules(shell_proxy, rules)
    _set_launch_rules(shell_proxy, [])


def _close_window(shell_proxy, title):
    shell_proxy.eval(f"""
    (function() {{
        const w = global.display.list_all_windows().find(w => w.get_title() === {json.dumps(title)});
        if (w) w.delete(global.display.get_current_time_roundtrip());
        return 'OK';
    }})();
    """)


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

    def test_current_rule_keeps_window_on_origin(
        self, shell_proxy, restore_settings, launch_window, launch_rules
    ):
        """A "current" launch rule tiles the app where it was launched."""
        restore_settings.set("launch-new-workspace-enabled", True)
        shell_proxy.wait_for_nextile_settled()
        origin = shell_proxy.get_active_workspace_index()
        launch_rules([{"wmClass": "nextile-test-window", "workspace": "current"}])

        window = launch_window()
        shell_proxy.wait_for_nextile_settled()

        assert _window_workspace(shell_proxy, window["title"]) == origin
        assert shell_proxy.get_active_workspace_index() == origin

    def test_numbered_rule_pins_window(
        self, shell_proxy, restore_settings, launch_window, launch_rules
    ):
        """A numbered launch rule sends the app to that workspace, switch off or not."""
        restore_settings.set("launch-new-workspace-enabled", False)
        restore_settings.set("launch-new-workspace-follow", True)
        shell_proxy.wait_for_nextile_settled()
        launch_rules([{"wmClass": "nextile-test-window", "workspace": 2}])

        window = launch_window()
        shell_proxy.wait_for_nextile_settled()

        wait_for(
            lambda: _window_workspace(shell_proxy, window["title"]),
            predicate=lambda i: i == 1,
            message="window did not move to workspace 2",
        )

    def test_closing_launched_window_returns_to_origin(
        self, shell_proxy, restore_settings, launch_window
    ):
        """Closing the last window on a launched workspace switches back to the origin."""
        restore_settings.set("launch-new-workspace-enabled", True)
        restore_settings.set("launch-new-workspace-follow", True)
        restore_settings.set("launch-new-workspace-group-timeout", 0)
        shell_proxy.wait_for_nextile_settled()
        origin = shell_proxy.get_active_workspace_index()

        window = launch_window()
        shell_proxy.wait_for_nextile_settled()
        assert shell_proxy.get_active_workspace_index() != origin

        _close_window(shell_proxy, window["title"])
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == origin,
            message="did not return to the origin workspace",
        )
