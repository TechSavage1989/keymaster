"""UI regressions without relying on a live OpenGL renderer.

The former implementation passed mesh validation but raised IndexError on
bounds[2] before setting the model label. The failures occurred inside Qt
signal callbacks, causing users to see "No model loaded" without a warning.
"""
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import numpy as np
import pytest
import trimesh
from PySide6 import QtCore, QtWidgets

import keymaster.app as app


class FakeInteractor(QtWidgets.QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.added = []
        self.render_count = 0
        self.camera_resets = 0

    def set_background(self, *_args, **_kwargs):
        pass

    def add_axes(self):
        pass

    def clear(self):
        self.added.clear()

    def add_mesh(self, mesh, **kwargs):
        self.added.append((mesh, kwargs))
        return object()

    def reset_camera(self):
        self.camera_resets += 1

    def render(self):
        self.render_count += 1


@pytest.fixture(scope="session")
def qapplication():
    QtCore.QStandardPaths.setTestModeEnabled(True)
    instance = QtWidgets.QApplication.instance()
    if instance is None:
        instance = QtWidgets.QApplication([])
    yield instance


@pytest.fixture
def window(qapplication, monkeypatch):
    monkeypatch.setattr(app, "QtInteractor", FakeInteractor)
    win = app.KeymasterWindow()
    yield win
    win.close()


@pytest.fixture
def source_stl(tmp_path):
    source = tmp_path / "solid_model.stl"
    trimesh.creation.box(extents=(30, 40, 50)).export(source)
    return source


def test_imported_stl_updates_ui_and_preview(window, source_stl, monkeypatch):
    # Negative control: alpha 2's row-based indexing fails for valid XYZ bounds.
    bounds = trimesh.creation.box().bounds
    assert bounds.shape == (2, 3)
    with pytest.raises(IndexError):
        _ = bounds[2].mean()

    monkeypatch.setattr(
        app.QtWidgets.QFileDialog, "getOpenFileName",
        lambda *_args, **_kw: (str(source_stl), ""),
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.import_model()

    assert errors == []
    assert window.model is not None
    assert window.model.is_watertight
    assert window.source == source_stl
    assert source_stl.name in window.model_label.text()
    assert "No model loaded" not in window.model_label.text()
    assert "12" in window.mesh_info.text() and "Triangles" in window.mesh_info.text()
    assert window.axis.currentText() == "Z"
    assert window.coordinate.value() == pytest.approx(0.0)
    assert [options["name"] for _mesh, options in window.view.added] == ["original", "cut_plane"]
    assert window.view.added[0][0].n_cells == len(window.model.faces)


def test_cut_plane_axes_and_coordinate_redraw(window, source_stl, monkeypatch):
    monkeypatch.setattr(
        app.QtWidgets.QFileDialog, "getOpenFileName",
        lambda *_args, **_kw: (str(source_stl), ""),
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.import_model()

    for axis, axis_idx in (("X", 0), ("Y", 1), ("Z", 2)):
        window.axis.setCurrentText(axis)
        assert not errors
        assert window.coordinate.value() == pytest.approx(0.0)
        plane = window._plane()
        assert len(plane.origin) == 3
        assert np.allclose(plane.normal, np.eye(3)[axis_idx])
        assert np.allclose(plane.origin, window.model.bounds.mean(axis=0))
        assert window.view.added[-1][1]["name"] == "cut_plane"

    window.coordinate.setValue(7.5)
    assert not errors
    assert window._plane().origin[2] == pytest.approx(7.5)
    assert window.view.added[-1][0].center[2] == pytest.approx(7.5)


def test_import_failure_reports_error_and_retains_empty_label(window, tmp_path, monkeypatch):
    missing = tmp_path / "not-found.stl"
    monkeypatch.setattr(
        app.QtWidgets.QFileDialog, "getOpenFileName",
        lambda *_args, **_kw: (str(missing), ""),
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.import_model()
    assert len(errors) == 1
    assert window.model is None
    assert window.model_label.text() == "No model loaded"


def test_import_after_axis_change_resets_to_z(window, source_stl, monkeypatch):
    monkeypatch.setattr(
        app.QtWidgets.QFileDialog, "getOpenFileName",
        lambda *_args, **_kw: (str(source_stl), ""),
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.import_model()
    window.axis.setCurrentText("X")
    window.coordinate.setValue(3)
    window.import_model()
    assert not errors
    assert window.axis.currentText() == "Z"
    assert window.coordinate.value() == pytest.approx(0)
    assert window.model_label.text().startswith(source_stl.name)



def test_workstation_navigation_and_stable_controls(window):
    assert set(window.nav_buttons) == {"model", "cut", "keys", "parts"}
    window._show_tool(2)
    assert window.stack.currentIndex() == 2
    assert window.nav_buttons["keys"].isChecked()
    window._show_tool(0)
    assert window.stack.currentIndex() == 0
    assert window.document_name.text() == "No model loaded"
    assert window.export_button.isEnabled() is False


def test_fit_presets_and_custom_clearance(window):
    window.preset.setCurrentText("FDM - easy")
    assert window.radial.value() == pytest.approx(0.40)
    assert window.axial.value() == pytest.approx(0.50)
    window.radial.setValue(0.33)
    assert window.preset.currentText() == "Custom"
    assert window._template().radial_clearance == pytest.approx(0.33)


def test_live_cut_position_slider_keeps_plane_aligned(window, source_stl, monkeypatch):
    monkeypatch.setattr(
        app.QtWidgets.QFileDialog, "getOpenFileName",
        lambda *_args, **_kw: (str(source_stl), ""),
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.import_model()
    window.position_slider.setValue(800)
    assert window.coordinate.value() == pytest.approx(15.0, abs=.1)
    assert window._plane().origin[2] == pytest.approx(15.0, abs=.1)
    assert window.view.added[-1][1]["name"] == "cut_plane"
    assert window.result is None
    assert not errors


def test_direct_path_load_used_by_drop_flow(window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(source_stl)
    assert errors == []
    assert window.model_label.text() == source_stl.name
    assert window.document_name.text() == source_stl.name
    assert "Watertight" in window.mesh_status.text()


def test_drop_event_imports_stl(window, source_stl, monkeypatch):
    from PySide6 import QtGui
    from PySide6.QtCore import QMimeData, QUrl, QPointF
    mime = QMimeData()
    mime.setUrls([QUrl.fromLocalFile(str(source_stl))])
    event = QtGui.QDropEvent(
        QPointF(10.0, 10.0),
        QtCore.Qt.DropAction.CopyAction,
        mime,
        QtCore.Qt.MouseButton.LeftButton,
        QtCore.Qt.KeyboardModifier.NoModifier,
    )
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window.dropEvent(event)
    assert event.isAccepted()
    assert window.model is not None
    assert window.model_label.text() == source_stl.name
    assert not errors
