# NexTile E2E Testing Framework
"""
Framework modules for end-to-end testing of the NexTile GNOME Shell extension.
"""

from .constants import NEXTILE_UUID, RetryConfig, Timeout, Timing, Tolerance
from .gsettings import NexTileSettings
from .input_simulator import InputSimulator
from .screenshot import ScreenshotCapture
from .shell_proxy import ShellProxy
from .wait import WaitTimeoutError, retry, wait_for, wait_for_stable, wait_for_window
from .window_helper import WindowHelper

__all__ = [
    # Constants
    "Timing",
    "Tolerance",
    "Timeout",
    "RetryConfig",
    "NEXTILE_UUID",
    # Core classes
    "ShellProxy",
    "InputSimulator",
    "WindowHelper",
    "ScreenshotCapture",
    "NexTileSettings",
    # Wait utilities
    "wait_for",
    "wait_for_window",
    "wait_for_stable",
    "retry",
    "WaitTimeoutError",
]
