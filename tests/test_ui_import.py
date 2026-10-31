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


class FakeActor:
    def __init__(self):
        self.position = None
        self.visibility = True

    def SetPosition(self, *args):
        self.position = tuple(args)

    def SetVisibility(self, visible):
        self.visibility = bool(visible)


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
        return FakeActor()

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



def test_free_plane_widget_callback_and_coordinate_lock(window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(source_stl)
    window._on_gizmo_move((1, 1, 0), (2, 3, 4))
    # Old test assumed immediate VTK/Qt redraw inside a native mouse event.
    # The crash fix intentionally applies the plane only after the event returns.
    assert window.axis.currentText() == "Z"
    assert window._plane_bridge.has_pending
    window._plane_bridge.flush()
    assert not errors
    assert window.axis.currentText() == "Free"
    assert window.position_slider.isEnabled() is False
    assert np.allclose(window._plane().origin, (2, 3, 4))
    assert np.allclose(window._plane().normal, (2**-.5, 2**-.5, 0))
    window.axis.setCurrentText("Z")
    assert window.position_slider.isEnabled()


def test_shading_modes_render_material_options(window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(source_stl)
    for name in ("Studio clay", "Lit solid", "Shaded edges", "X-ray", "Wireframe"):
        window.shading_mode.setCurrentText(name)
        assert window.view.added
        assert not errors
    assert window._material_options()["style"] == "wireframe"
    window.shading_mode.setCurrentText("Shaded edges")
    assert window._material_options()["show_edges"] is True
    assert window._material_options()["specular"] > 0


def _build_branched_stl(tmp_path):
    from keymaster.geometry import _as_manifold, _as_trimesh
    base = trimesh.creation.box(extents=(44, 16, 10))
    base.apply_translation((0, 0, -7))
    a = trimesh.creation.box(extents=(10, 12, 23))
    a.apply_translation((-12, 0, 1))
    b = trimesh.creation.box(extents=(10, 12, 23))
    b.apply_translation((12, 0, 1))
    mesh = _as_trimesh(_as_manifold(base) + _as_manifold(a) + _as_manifold(b))
    path = tmp_path / "branched_sculpt.stl"
    mesh.export(path)
    return path


def test_analyze_selective_components_and_preview(window, tmp_path, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    path = _build_branched_stl(tmp_path)
    window._load_path(path)
    window.coordinate.setValue(0)
    window.analyze_sections()
    assert len(window._section_candidates) == 2
    assert window.section_list.count() == 2
    first = window.section_list.item(0)
    first.setCheckState(QtCore.Qt.CheckState.Unchecked)
    assert len(window._selected_sections()) == 1
    window.generate()
    assert not errors
    assert len(window.result.parts) == 2
    assert all(part.is_watertight for part in window.result.parts)
    assert window.stack.currentIndex() == 3
    assert window.export_button.isEnabled()


def test_automatic_keys_are_scoped_to_selected_section(window, tmp_path, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(_build_branched_stl(tmp_path))
    window.coordinate.setValue(0)
    window.analyze_sections()
    window.section_list.item(1).setCheckState(QtCore.Qt.CheckState.Unchecked)
    window.key_diameter.setValue(2)
    window.key_depth.setValue(3)
    window.auto_count.setValue(1)
    window.auto_key()
    assert not errors
    assert len(window.keys) == 1
    assert window._section_candidates[0].cap is not None
    window.generate()
    assert not errors
    assert len(window.result.parts) == 2


def test_face_gap_edited_and_invalidates_export(window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(source_stl)
    window.face_gap.setValue(.2)
    assert window.result is None
    window.generate()
    assert not errors
    assert window.export_button.isEnabled()
    window.face_gap.setValue(.3)
    assert not window.export_button.isEnabled()
    assert window.result is None



def test_click_to_select_one_detachable_section(window, tmp_path, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(_build_branched_stl(tmp_path))
    window.coordinate.setValue(0)
    window.analyze_sections()
    assert len(window._selected_sections()) == 2
    surface_point = window._section_candidates[0].mesh.vertices[0]
    window._picked_section(surface_point)
    assert not errors
    assert window._selected_sections() == (1,)
    window._picked_section(surface_point)
    assert set(window._selected_sections()) == {0, 1}



def test_key_point_selection_restores_cut_controls(window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(window, "_error", errors.append)
    window._load_path(source_stl)
    window.key_diameter.setValue(3)
    window._picked((0, 0, 1))
    assert not errors
    assert len(window.keys) == 1
    assert window.keys[0].u == pytest.approx(0)
    assert window.keys[0].v == pytest.approx(0)



class SpyPlaneRepresentation:
    def __init__(self, view):
        self.view = view
        self.origins = []
        self.normals = []
        self.builds = 0

    def SetOrigin(self, *origin):
        self.view.ensure_not_in_native_callback()
        self.origins.append(tuple(origin))

    def SetNormal(self, *normal):
        self.view.ensure_not_in_native_callback()
        self.normals.append(tuple(normal))

    def BuildRepresentation(self):
        self.view.ensure_not_in_native_callback()
        self.builds += 1


class SpyPlaneWidget:
    def __init__(self, view, callback, options):
        self.view = view
        self.callback = callback
        self.options = options
        self.representation = SpyPlaneRepresentation(view)

    def GetRepresentation(self):
        self.view.ensure_not_in_native_callback()
        return self.representation

    def invoke_release(self, normal, origin):
        """Simulate a native event with an active widget on the C++ stack."""
        self.view.in_native_callback = True
        try:
            self.callback(normal, origin)
        finally:
            self.view.in_native_callback = False


class SpyPlaneInteractor(FakeInteractor):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.native_mutations = []
        self.in_native_callback = False
        self.native_widget = None
        self.widgets_created = []
        self.removed_actors = []

    def ensure_not_in_native_callback(self):
        if self.in_native_callback:
            raise AssertionError("UI modified VTK while its mouse callback was active")

    def add_plane_widget(self, callback, **kwargs):
        self.ensure_not_in_native_callback()
        widget = SpyPlaneWidget(self, callback, kwargs)
        self.native_widget = widget
        self.widgets_created.append(widget)
        return widget

    def clear_plane_widgets(self):
        self.ensure_not_in_native_callback()
        self.native_widget = None
        self.native_mutations.append("clear_plane_widgets")

    def remove_actor(self, name, **kwargs):
        self.ensure_not_in_native_callback()
        self.removed_actors.append(name)

    def add_mesh(self, mesh, **kwargs):
        self.ensure_not_in_native_callback()
        return super().add_mesh(mesh, **kwargs)

    def clear(self):
        self.ensure_not_in_native_callback()
        return super().clear()


@pytest.fixture
def plane_window(qapplication, monkeypatch):
    monkeypatch.setattr(app, "QtInteractor", SpyPlaneInteractor)
    win = app.KeymasterWindow()
    yield win
    win.close()


def test_plane_callback_does_not_mutate_vtk_during_a_click(plane_window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(plane_window, "_error", errors.append)
    plane_window._load_path(source_stl)
    widget = plane_window.view.native_widget
    assert widget is not None
    assert widget.options["interaction_event"] == "end"
    assert widget.options["normal_rotation"] is True
    assert widget.options["origin_translation"] is True
    assert widget.options["tubing"] is True
    assert widget.options["test_callback"] is False
    native_mutations = list(plane_window.view.native_mutations)
    added = len(plane_window.view.added)
    widget.invoke_release((0, 0, 1), (0, 0, 0))
    assert plane_window._plane_bridge.has_pending
    assert plane_window.axis.currentText() == "Z"
    assert plane_window.view.native_mutations == native_mutations
    assert len(plane_window.view.added) == added
    plane_window._plane_bridge.flush()
    assert not errors
    assert len(plane_window.view.added) == added
    assert plane_window.view.native_widget is widget


def test_plane_move_rotate_defers_scene_update_until_event_returns(plane_window, source_stl, monkeypatch):
    errors = []
    monkeypatch.setattr(plane_window, "_error", errors.append)
    plane_window._load_path(source_stl)
    widget = plane_window.view.native_widget
    prior = len(plane_window.view.added)
    widget.invoke_release((0, 1, 0), (2, 3, 4))
    assert plane_window.axis.currentText() == "Z"
    assert plane_window._gizmo_origin is None
    assert len(plane_window.view.added) == prior
    plane_window._plane_bridge.flush()
    assert not errors
    assert plane_window.axis.currentText() == "Free"
    assert np.allclose(plane_window._plane().origin, (2, 3, 4))
    assert np.allclose(plane_window._plane().normal, (0, 1, 0))
    assert plane_window.view.native_widget is widget
    assert len(plane_window.view.added) > prior


def test_plane_widget_mode_explicitly_rebuilds_handles_outside_vtk(plane_window, source_stl):
    plane_window._load_path(source_stl)
    initial = plane_window.view.native_widget
    plane_window.plane_handle_mode.setCurrentText("Move only")
    move = plane_window.view.native_widget
    assert move is not initial
    assert move.options["origin_translation"] is True
    assert move.options["normal_rotation"] is False
    plane_window.plane_handle_mode.setCurrentText("Rotate only")
    rotate = plane_window.view.native_widget
    assert rotate is not move
    assert rotate.options["origin_translation"] is False
    assert rotate.options["normal_rotation"] is True


def test_disabled_widget_keeps_slider_and_ignores_stale_native_events(plane_window, source_stl):
    plane_window._load_path(source_stl)
    original = plane_window.view.native_widget
    plane_window.plane_handles_enabled.setChecked(False)
    assert plane_window.view.native_widget is None
    original.invoke_release((0, 1, 0), (1, 2, 3))
    assert not plane_window._plane_bridge.has_pending
    plane_window.position_slider.setValue(800)
    assert plane_window.coordinate.value() == pytest.approx(15.0, abs=.1)
    assert plane_window.view.native_widget is None
    plane_window.plane_handles_enabled.setChecked(True)
    assert plane_window.view.native_widget is not None


def test_numeric_plane_changes_sync_without_widget_recreation(plane_window, source_stl):
    plane_window._load_path(source_stl)
    widget = plane_window.view.native_widget
    plane_window.coordinate.setValue(5.0)
    assert plane_window.view.native_widget is widget
    assert widget.representation.origins
    assert widget.representation.builds >= 1
    assert widget.representation.origins[-1][2] == pytest.approx(5.0)


def test_plane_bridge_coalesces_multiple_native_poses_and_rejects_nan(qapplication):
    from keymaster.plane_interaction import PlaneInteractionBridge

    applied = []
    bridge = PlaneInteractionBridge(lambda normal, origin: applied.append((normal, origin)))
    bridge.capture((0, 0, 1), (0, 0, 0))
    bridge.capture((0, 2, 0), (3, 4, 5))
    bridge.capture((float("nan"), 0, 1), (10, 10, 10))
    assert not applied
    bridge.flush()
    assert len(applied) == 1
    assert np.allclose(applied[0][0], (0, 1, 0))
    assert np.allclose(applied[0][1], (3, 4, 5))
    bridge.capture((1, 0, 0), (7, 8, 9))
    bridge.cancel()
    bridge.flush()
    assert len(applied) == 1
    bridge.shutdown()
    bridge.capture((1, 0, 0), (2, 3, 4))
    bridge.flush()
    assert len(applied) == 1
