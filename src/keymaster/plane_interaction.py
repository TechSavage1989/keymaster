"""Isolate native plane-widget events from Qt/VTK scene mutations.

A VTK widget callback may run with C++ interaction objects on the stack.
Never create/remove actors, render, or rebuild a widget inside that callback.
Capture coordinates, then apply them on the Qt event loop after it returns.
"""
from __future__ import annotations

from collections.abc import Callable
import numpy as np
from PySide6 import QtCore


class PlaneInteractionBridge(QtCore.QObject):
    """Coalesce plane poses and defer all application work to a Qt timer."""

    def __init__(self, apply_pose: Callable, parent=None):
        super().__init__(parent)
        self._apply_pose = apply_pose
        self._pending: tuple[tuple[float, float, float], tuple[float, float, float]] | None = None
        self._closed = False
        self._timer = QtCore.QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(30)
        self._timer.timeout.connect(self.flush)

    def capture(self, normal, origin) -> None:
        """Only validate/copy the native widget's pose. No render or UI calls."""
        if self._closed:
            return
        try:
            n = np.asarray(normal, dtype=float)
            o = np.asarray(origin, dtype=float)
            if n.shape != (3,) or o.shape != (3,):
                return
            if not np.isfinite(n).all() or not np.isfinite(o).all():
                return
            length = float(np.linalg.norm(n))
            if length < 1e-10:
                return
            n = n / length
            self._pending = tuple(float(x) for x in n), tuple(float(x) for x in o)
        except (TypeError, ValueError, OverflowError):
            return
        # The native interaction callback returns before this timer fires.
        self._timer.start()

    def flush(self) -> None:
        """Apply the last pose at most once after the VTK event returns."""
        self._timer.stop()
        pending, self._pending = self._pending, None
        if pending is not None and not self._closed:
            self._apply_pose(*pending)

    def cancel(self) -> None:
        self._timer.stop()
        self._pending = None

    def shutdown(self) -> None:
        self._closed = True
        self.cancel()

    @property
    def has_pending(self) -> bool:
        return self._pending is not None
