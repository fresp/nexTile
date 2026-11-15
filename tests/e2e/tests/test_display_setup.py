"""Display setup round trip (multi-monitor lane).

Removing a monitor and attaching it again, as undocking and docking a laptop
does, must bring back the layout the monitor had. Requires two virtual monitors
(NEXTILE_E2E_VIRTUAL_MONITORS=2); self-skips otherwise.
"""

import pytest
from framework.wait import wait_for
from gi.repository import Gio, GLib

pytestmark = pytest.mark.multimonitor

DISPLAY_CONFIG = ("org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig")
TEMPORARY = 1


def _call(method, params=None):
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    name, path = DISPLAY_CONFIG
    return bus.call_sync(
        name, path, name, method, params, None, Gio.DBusCallFlags.NONE, 10000, None
    ).unpack()


def _apply_monitors(count):
    """Enable the first `count` monitors side by side, each in its current mode."""
    serial, monitors, _logical, _props = _call("GetCurrentState")
    logical = []
    x = 0
    for index, (spec, modes, _monitor_props) in enumerate(monitors[:count]):
        mode = next((m for m in modes if m[6].get("is-current")), None) or next(
            m for m in modes if m[6].get("is-preferred")
        )
        logical.append((x, 0, 1.0, 0, index == 0, [(spec[0], mode[0], {})]))
        x += mode[1]
    _call(
        "ApplyMonitorsConfig",
        GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (serial, TEMPORARY, logical, {})),
    )


def _monitor_one_windows(shell_proxy):
    """Windows on monitor 1, top to bottom: [title, x, y, width, height]."""
    return shell_proxy.eval("""
    (function() {
        return JSON.stringify(global.display.list_all_windows()
            .filter(w => w.get_monitor() === 1)
            .map(w => { const r = w.get_frame_rect(); return [w.get_title(), r.x, r.y, r.width, r.height]; })
            .sort((a, b) => a[2] - b[2]));
    })();
    """)


@pytest.fixture
def both_monitors_afterwards(shell_proxy):
    """Leave the session with its two monitors whatever the test did."""
    started_with = shell_proxy.get_monitor_count()
    yield
    if started_with >= 2 and shell_proxy.get_monitor_count() < 2:
        _apply_monitors(2)
        wait_for(
            shell_proxy.get_monitor_count,
            predicate=lambda n: n == 2,
            message="could not re-enable the second monitor",
        )
    shell_proxy.wait_for_nextile_settled()


class TestDisplaySetupRoundTrip:
    def test_layout_returns_with_the_monitor(
        self, shell_proxy, three_windows, both_monitors_afterwards
    ):
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (NEXTILE_E2E_VIRTUAL_MONITORS=2)")

        # Two of the three windows go to monitor 1 and are split top/bottom there.
        shell_proxy.eval("""
        (function() {
            global.display.list_all_windows()
                .filter(w => w.get_window_type() === Meta.WindowType.NORMAL)
                .sort((a, b) => a.get_id() - b.get_id())
                .slice(1).forEach(w => w.move_to_monitor(1));
            return 'OK';
        })();
        """)
        wait_for(
            lambda: _monitor_one_windows(shell_proxy),
            predicate=lambda wins: len(wins) == 2,
            message="two windows did not arrive on monitor 1",
        )
        shell_proxy.wait_for_nextile_settled()
        shell_proxy.eval("""
        (function() {
            const wm = Main.extensionManager.lookup('nextile@fresp.github.io').stateObj.extWm;
            const monitor = wm.tree.findNode('mo1ws' + global.workspace_manager.get_active_workspace_index());
            monitor.layout = 'VSPLIT';
            monitor.childNodes[0].percent = 0.7;
            monitor.childNodes[1].percent = 0.3;
            wm.renderTree('e2e-display-setup', true);
            return 'OK';
        })();
        """)
        before = wait_for(
            lambda: _monitor_one_windows(shell_proxy),
            predicate=lambda wins: len(wins) == 2 and wins[0][4] > wins[1][4] * 1.5,
            message="monitor 1 did not take the 70/30 top/bottom split",
        )
        shell_proxy.wait_for_layout_landed()
        before = _monitor_one_windows(shell_proxy)

        _apply_monitors(1)
        wait_for(
            shell_proxy.get_monitor_count,
            predicate=lambda n: n == 1,
            message="the second monitor was not removed",
        )
        shell_proxy.wait_for_nextile_settled()

        _apply_monitors(2)
        wait_for(
            shell_proxy.get_monitor_count,
            predicate=lambda n: n == 2,
            message="the second monitor did not come back",
        )

        # Same windows, same order, same sizes as before the monitor went away.
        wait_for(
            lambda: _monitor_one_windows(shell_proxy),
            predicate=lambda wins: wins == before,
            message=f"monitor 1 did not get its layout back; it was {before}",
        )
