"""
Scratchpad tests for NexTile.

ScratchpadMove hides the focused window, ScratchpadShow brings it back as a
floating window, and a hidden window must not keep an empty workspace alive.
"""

import json

import pytest
from framework.wait import wait_for

MOVE = {"name": "ScratchpadMove", "x": "center", "y": "center", "width": 0.65, "height": 0.75}
SHOW = {"name": "ScratchpadShow"}


def _window_states(shell_proxy):
    """Every window on any workspace, by title: minimized, sticky, workspace, width."""
    # shell_proxy.eval already decodes a JSON object.
    return shell_proxy.eval("""
    (function() {
        const out = {};
        for (const w of global.display.list_all_windows()) {
            const ws = w.get_workspace();
            out[w.get_title()] = {
                minimized: w.minimized,
                sticky: w.is_on_all_workspaces(),
                workspace: ws ? ws.index() : null,
                width: w.get_frame_rect().width,
            };
        }
        return JSON.stringify(out);
    })();
    """)


def _hidden_titles(shell_proxy):
    return [t for t, s in _window_states(shell_proxy).items() if s["minimized"]]


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


class TestScratchpad:
    def test_move_hides_and_show_brings_back_floating(
        self, shell_proxy, window_helper, restore_settings, launch_window
    ):
        """One of two tiled windows goes to the scratchpad and comes back floating."""
        restore_settings.set("launch-new-workspace-enabled", False)
        shell_proxy.wait_for_nextile_settled()
        first = launch_window()
        second = launch_window()
        shell_proxy.wait_for_nextile_settled()
        titles = {first["title"], second["title"]}
        workspace = window_helper.get_workspace_rect()

        shell_proxy.ensure_focus()
        shell_proxy.invoke_nextile_action(MOVE)

        hidden = wait_for(
            lambda: _hidden_titles(shell_proxy),
            predicate=lambda h: len(h) == 1,
            message="ScratchpadMove did not hide exactly one window",
        )[0]
        assert hidden in titles
        (remaining,) = titles - {hidden}
        # The hidden window is on every workspace, and its sibling takes the space.
        wait_for(
            lambda: _window_states(shell_proxy),
            predicate=lambda s: (
                s[hidden]["sticky"] and s[remaining]["width"] > workspace["width"] * 0.9
            ),
            message="hidden window not sticky, or the remaining window did not fill the workspace",
        )

        shell_proxy.invoke_nextile_action(SHOW)

        states = wait_for(
            lambda: _window_states(shell_proxy),
            predicate=lambda s: not s[hidden]["minimized"] and not s[hidden]["sticky"],
            message="ScratchpadShow did not bring the window back",
        )
        shell_proxy.wait_for_layout_landed()
        states = _window_states(shell_proxy)
        # Still floating: it did not take half of the workspace back.
        assert states[remaining]["width"] > workspace["width"] * 0.9
        assert states[hidden]["width"] < workspace["width"] * 0.9

    def test_hidden_window_does_not_keep_its_workspace(
        self, shell_proxy, restore_settings, dynamic_workspaces, launch_window
    ):
        """Hiding a launched workspace's only window lets GNOME remove that workspace."""
        first = launch_window()
        origin = shell_proxy.get_active_workspace_index()
        restore_settings.set("launch-new-workspace-enabled", True)
        restore_settings.set("launch-new-workspace-follow", True)
        restore_settings.set("launch-new-workspace-group-timeout", 0)
        shell_proxy.wait_for_nextile_settled()
        count_before = shell_proxy.get_workspace_count()

        second = launch_window()
        shell_proxy.wait_for_nextile_settled()
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i != origin,
            message="launched window did not get its own workspace",
        )

        shell_proxy.ensure_focus()
        shell_proxy.invoke_nextile_action(MOVE)
        wait_for(
            lambda: _window_states(shell_proxy)[second["title"]],
            predicate=lambda s: s["minimized"] and s["sticky"],
            message="launched window was not hidden",
        )

        shell_proxy.activate_workspace(origin)
        wait_for(
            shell_proxy.get_workspace_count,
            predicate=lambda n: n == count_before,
            message="the emptied workspace stayed alive behind the hidden window",
        )
        assert not _window_states(shell_proxy)[first["title"]]["minimized"]

        # The hidden window is reachable from the origin workspace.
        shell_proxy.invoke_nextile_action(SHOW)
        wait_for(
            lambda: _window_states(shell_proxy)[second["title"]],
            predicate=lambda s: not s["minimized"] and not s["sticky"] and s["workspace"] == origin,
            message="hidden window did not show on the origin workspace",
        )
