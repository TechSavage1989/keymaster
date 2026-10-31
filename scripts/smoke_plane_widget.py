"""Exercise a real PyVista/VTK plane widget on the Windows CI runner.

This tests widget creation, EndInteractionEvent dispatch, deferred Qt
updates, programmatic representation sync, disable/close, and subprocess
exit without a segmentation fault. It is NOT a human mouse/GPU test.
"""
from __future__ import annotations

import faulthandler
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("PYVISTA_OFF_SCREEN", "true")
faulthandler.enable()

import pyvista as pv
from pyvistaqt import QtInteractor
from PySide6 import QtWidgets

from keymaster.plane_interaction import PlaneInteractionBridge


def main() -> int:
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    # The real VTK interactor/widget is intentionally used, not a fake.
    viewport = QtInteractor(off_screen=True)
    viewport.set_background("#151a20")
    viewport.add_mesh(pv.Cube(), color="#b9cad4", smooth_shading=True)
    applied = []
    bridge = PlaneInteractionBridge(lambda n, o: applied.append((n, o)))
    widget = viewport.add_plane_widget(
        bridge.capture,
        origin=(0, 0, 0),
        normal=(0, 0, 1),
        bounds=(-1, 1, -1, 1, -1, 1),
        color="#e0ab74",
        normal_rotation=True,
        origin_translation=True,
        outline_translation=True,
        tubing=True,
        outline_opacity=.45,
        implicit=True,
        interaction_event="end",
        test_callback=False,
    )
    if widget is None:
        raise RuntimeError("Plane widget did not initialize")
    # VTK fires the same native end-of-interaction observer used after a drag.
    widget.InvokeEvent("EndInteractionEvent")
    app.processEvents()
    if not bridge.has_pending:
        raise RuntimeError("Native EndInteractionEvent did not reach deferred bridge")
    bridge.flush()
    if len(applied) != 1:
        raise RuntimeError("Native event did not apply exactly one Qt pose update")
    viewport.clear_plane_widgets()
    bridge.shutdown()
    viewport.close()
    app.processEvents()
    print("Real VTK plane widget lifecycle smoke passed (offscreen, no mouse drag).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
