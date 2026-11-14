"""
External control tests for NexTile.

Other programs run NexTile actions and read its state over D-Bus, on the
org.gnome.Shell.Extensions.NexTile.Control interface. Off unless the user turns
external-control-enabled on.
"""

import json

import pytest
from framework.wait import wait_for
from gi.repository import Gio, GLib

BUS_NAME = "org.gnome.Shell"
PATH = "/org/gnome/Shell/Extensions/NexTile"
IFACE = "org.gnome.Shell.Extensions.NexTile.Control"
ERROR = "org.gnome.Shell.Extensions.NexTile.Error"


@pytest.fixture(scope="module")
def control():
    """Call a Control method as an outside program would: over the session bus."""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(method, *args):
        params = GLib.Variant("(" + "s" * len(args) + ")", args) if args else None
        reply = bus.call_sync(
            BUS_NAME, PATH, IFACE, method, params, None, Gio.DBusCallFlags.NONE, 5000, None
        )
        return reply.unpack()

    return call


def _refusal(call):
    """The message a call is refused with; GDBus puts the error name in front."""
    with pytest.raises(GLib.Error) as raised:
        call()
    return raised.value.message


def _minimized_titles(shell_proxy):
    return shell_proxy.eval("""
    (function() {
        return JSON.stringify(global.display.list_all_windows()
            .filter(w => w.minimized).map(w => w.get_title()));
    })();
    """)


class TestExternalControl:
    def test_refused_while_the_setting_is_off(
        self, shell_proxy, control, restore_settings, launch_window
    ):
        restore_settings.set("external-control-enabled", False)
        shell_proxy.wait_for_nextile_settled()
        launch_window()

        assert f"{ERROR}.Disabled" in _refusal(lambda: control("Run", "scratchpad-move"))
        assert f"{ERROR}.Disabled" in _refusal(lambda: control("GetState"))
        assert _minimized_titles(shell_proxy) == []

    def test_runs_actions_and_reports_state(
        self, shell_proxy, control, restore_settings, launch_window
    ):
        restore_settings.set("launch-new-workspace-enabled", False)
        restore_settings.set("external-control-enabled", True)
        shell_proxy.wait_for_nextile_settled()
        window = launch_window()
        shell_proxy.ensure_focus()

        (state,) = control("GetState")
        assert json.loads(state)["scratchpad"] == {"windows": 0, "hidden": 0}

        control("Run", "scratchpad-move")
        wait_for(
            lambda: _minimized_titles(shell_proxy),
            predicate=lambda titles: titles == [window["title"]],
            message="Run scratchpad-move did not hide the focused window",
        )
        (state,) = control("GetState")
        assert json.loads(state)["scratchpad"] == {"windows": 1, "hidden": 1}

        control("Run", "scratchpad-show")
        wait_for(
            lambda: _minimized_titles(shell_proxy),
            predicate=lambda titles: titles == [],
            message="Run scratchpad-show did not show the window",
        )

        # Leave the scratchpad empty for the next test.
        shell_proxy.invoke_nextile_action({"name": "FloatToggle"})
        shell_proxy.wait_for_nextile_settled()

    def test_refuses_actions_that_start_programs_and_unknown_names(
        self, shell_proxy, control, restore_settings
    ):
        restore_settings.set("external-control-enabled", True)
        shell_proxy.wait_for_nextile_settled()

        assert f"{ERROR}.NotAllowed" in _refusal(lambda: control("Run", "prefs-app-launch"))
        assert f"{ERROR}.UnknownAction" in _refusal(lambda: control("Run", "no-such-action"))
