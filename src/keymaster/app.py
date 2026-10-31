"""Keymaster Windows GUI: import, plane cut, key, preview and STL export."""
from __future__ import annotations

import sys
from pathlib import Path
import numpy as np
import pyvista as pv
from pyvistaqt import QtInteractor
from PySide6 import QtCore, QtGui, QtWidgets

from . import __version__
from .geometry import (
    CutPlane, GeometryError, KeySpec, cut_and_key, export_stl,
    frame, load_model, suggest_key,
)
from .updates import UpdateMonitor


def _spin(value: float, lo: float = -100000.0, hi: float = 100000.0, decimals: int = 2):
    widget = QtWidgets.QDoubleSpinBox()
    widget.setRange(lo, hi)
    widget.setDecimals(decimals)
    widget.setValue(value)
    widget.setSingleStep(0.1 if decimals else 1)
    return widget


def _as_polydata(mesh):
    faces = np.column_stack((np.full(len(mesh.faces), 3), mesh.faces)).ravel()
    return pv.PolyData(np.asarray(mesh.vertices), faces)


class KeymasterWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"Keymaster {__version__} - Cut and key for 3D printing")
        self.resize(1350, 820)
        self.model = None
        self.source = None
        self.result = None
        self.keys: list[KeySpec] = []
        self.actors = ()
        self.release_url = None

        shell = QtWidgets.QSplitter(QtCore.Qt.Orientation.Horizontal)
        self.setCentralWidget(shell)
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setMinimumWidth(320)
        scroll.setMaximumWidth(450)
        panel = QtWidgets.QWidget()
        scroll.setWidget(panel)
        left = QtWidgets.QVBoxLayout(panel)
        shell.addWidget(scroll)

        self.view = QtInteractor(shell)
        self.view.set_background("#181b20")
        self.view.add_axes()
        shell.addWidget(self.view)
        shell.setSizes([380, 970])

        title = QtWidgets.QLabel("KEYMASTER")
        title.setStyleSheet("font-size: 23px; font-weight: 700;")
        left.addWidget(title)
        subtitle = QtWidgets.QLabel("Plane cutting and alignment keys")
        left.addWidget(subtitle)

        self.import_button = QtWidgets.QPushButton("Import STL / OBJ")
        self.import_button.clicked.connect(self.import_model)
        left.addWidget(self.import_button)
        self.model_label = QtWidgets.QLabel("No model loaded")
        self.model_label.setWordWrap(True)
        left.addWidget(self.model_label)

        cut_box = QtWidgets.QGroupBox("1. Cut plane")
        cut_layout = QtWidgets.QFormLayout(cut_box)
        self.axis = QtWidgets.QComboBox()
        self.axis.addItems(["Z", "X", "Y"])
        self.axis.currentIndexChanged.connect(self._axis_changed)
        self.coordinate = _spin(0, -100000, 100000, 3)
        self.coordinate.valueChanged.connect(self._dirty)
        cut_layout.addRow("Plane normal", self.axis)
        cut_layout.addRow("Coordinate (mm)", self.coordinate)
        left.addWidget(cut_box)

        key_box = QtWidgets.QGroupBox("2. Create alignment keys")
        key_layout = QtWidgets.QFormLayout(key_box)
        self.key_u = _spin(0, decimals=2)
        self.key_v = _spin(0, decimals=2)
        self.key_diameter = _spin(5, .2, 1000)
        self.key_depth = _spin(5, .2, 1000)
        self.radial = _spin(.2, 0, 10, 3)
        self.axial = _spin(.3, 0, 10, 3)
        self.margin = _spin(.8, 0, 20, 3)
        self.shape = QtWidgets.QComboBox()
        self.shape.addItems(["round", "square"])
        for label, widget in (
            ("Cut-plane U (mm)", self.key_u),
            ("Cut-plane V (mm)", self.key_v),
            ("Peg diameter (mm)", self.key_diameter),
            ("Insertion depth (mm)", self.key_depth),
            ("Radial clearance / side (mm)", self.radial),
            ("Extra socket depth (mm)", self.axial),
            ("Min. edge margin (mm)", self.margin),
            ("Shape", self.shape),
        ):
            key_layout.addRow(label, widget)
        left.addWidget(key_box)

        key_actions = QtWidgets.QHBoxLayout()
        self.add_button = QtWidgets.QPushButton("Add key")
        self.add_button.clicked.connect(self.add_key)
        self.auto_button = QtWidgets.QPushButton("Auto place")
        self.auto_button.clicked.connect(self.auto_key)
        self.pick_button = QtWidgets.QPushButton("Pick on model")
        self.pick_button.setToolTip("Select a visible point; it is projected to the cut plane.")
        self.pick_button.clicked.connect(self.start_pick)
        for button in (self.add_button, self.auto_button, self.pick_button):
            key_actions.addWidget(button)
        left.addLayout(key_actions)

        self.table = QtWidgets.QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["U", "V", "Diameter", "Shape"])
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QtWidgets.QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.ResizeMode.Stretch)
        self.table.setMaximumHeight(130)
        left.addWidget(self.table)
        remove_button = QtWidgets.QPushButton("Remove selected key")
        remove_button.clicked.connect(self.remove_key)
        left.addWidget(remove_button)

        preview_box = QtWidgets.QGroupBox("3. Preview and export")
        preview_layout = QtWidgets.QVBoxLayout(preview_box)
        self.generate_button = QtWidgets.QPushButton("Generate cut + keys")
        self.generate_button.clicked.connect(self.generate)
        self.export_button = QtWidgets.QPushButton("Export both STL pieces")
        self.export_button.setEnabled(False)
        self.export_button.clicked.connect(self.export)
        preview_layout.addWidget(self.generate_button)
        preview_layout.addWidget(self.export_button)
        preview_layout.addWidget(QtWidgets.QLabel("Explode preview"))
        self.explode = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.explode.setRange(0, 100)
        self.explode.setValue(30)
        self.explode.valueChanged.connect(self._separate)
        preview_layout.addWidget(self.explode)
        left.addWidget(preview_box)

        self.update_frame = QtWidgets.QFrame()
        self.update_frame.setVisible(False)
        update_row = QtWidgets.QVBoxLayout(self.update_frame)
        self.update_label = QtWidgets.QLabel("")
        self.update_label.setWordWrap(True)
        update_row.addWidget(self.update_label)
        self.update_button = QtWidgets.QPushButton("View release / download")
        self.update_button.clicked.connect(self._open_release)
        update_row.addWidget(self.update_button)
        left.addWidget(self.update_frame)
        left.addStretch()
        notice = QtWidgets.QLabel("Source mesh is unchanged. Verify fit and scale before printing.")
        notice.setWordWrap(True)
        left.addWidget(notice)

        self.settings = QtCore.QSettings(
            str(Path(QtCore.QStandardPaths.writableLocation(
                QtCore.QStandardPaths.StandardLocation.AppConfigLocation
            )) / "keymaster.ini"),
            QtCore.QSettings.Format.IniFormat,
        )
        previous = self.settings.value("geometry")
        if previous:
            self.restoreGeometry(previous)

        self.updates = UpdateMonitor(self)
        self.updates.available.connect(self._update_available)
        self.updates.status_changed.connect(self.statusBar().showMessage)
        QtCore.QTimer.singleShot(100, lambda: self.updates.check(min_interval=0))
        check_action = QtGui.QAction("Check for updates", self)
        check_action.triggered.connect(lambda: self.updates.check(min_interval=30))
        self.menuBar().addMenu("Help").addAction(check_action)
        self.statusBar().showMessage("Import a watertight model sized in millimeters.")

    def _error(self, error):
        QtWidgets.QMessageBox.warning(self, "Keymaster", str(error))
        self.statusBar().showMessage(str(error), 10000)

    def _dirty(self, *_):
        self.result = None
        self.export_button.setEnabled(False)

    def _axis_index(self):
        return {"X": 0, "Y": 1, "Z": 2}[self.axis.currentText()]

    def _axis_changed(self, *_):
        if self.model is not None:
            self.coordinate.setValue(float(self.model.bounds[self._axis_index()].mean()))
        self._dirty()
        if self.model is not None:
            self._draw_original()

    def _plane(self):
        if self.model is None:
            raise GeometryError("Import a model first.")
        index = self._axis_index()
        origin = np.array(self.model.bounds.mean(axis=1), dtype=float)
        origin[index] = self.coordinate.value()
        normal = np.eye(3)[index]
        return CutPlane(tuple(origin), tuple(normal))

    def _template(self):
        return KeySpec(
            self.key_u.value(), self.key_v.value(), self.key_diameter.value(),
            self.key_depth.value(), self.radial.value(), self.axial.value(),
            self.margin.value(), self.shape.currentText(),
        )

    def import_model(self):
        filename, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Open printable mesh", "", "Mesh models (*.stl *.obj)"
        )
        if not filename:
            return
        try:
            mesh = load_model(filename)
        except Exception as exc:
            self._error(exc)
            return
        self.model, self.source = mesh, Path(filename)
        self.keys.clear()
        self._refresh_table()
        self._dirty()
        self.coordinate.setValue(float(mesh.bounds[2].mean()))
        self.axis.setCurrentText("Z")
        self.model_label.setText(
            f"{self.source.name}\n{len(mesh.faces):,} triangles | "
            f"{mesh.extents[0]:.1f} x {mesh.extents[1]:.1f} x {mesh.extents[2]:.1f} model units"
        )
        self._draw_original()
        self.statusBar().showMessage("Model imported. Move the cut plane and add keys.")

    def _draw_original(self):
        self.view.clear()
        self.view.add_axes()
        self.view.add_mesh(_as_polydata(self.model), color="#b5bfc9", smooth_shading=True, name="original")
        plane = self._plane()
        origin, n, _, _ = frame(plane)
        scale = float(max(self.model.extents)) * 1.2
        self.view.add_mesh(pv.Plane(center=origin, direction=n, i_size=scale,
                                    j_size=scale), color="#e0ac70", opacity=0.25,
                           name="cut_plane", pickable=False)
        self.view.reset_camera()
        self.actors = ()

    def add_key(self):
        if self.model is None:
            return self._error("Import a model first.")
        self.keys.append(self._template())
        self._refresh_table()
        self._dirty()

    def auto_key(self):
        if self.model is None:
            return self._error("Import a model first.")
        try:
            key = suggest_key(self.model, self._plane(), self._template(), self.keys)
            self.keys.append(key)
            self._refresh_table()
            self._dirty()
        except Exception as exc:
            self._error(exc)

    def start_pick(self):
        if self.model is None:
            return self._error("Import a model first.")
        self.statusBar().showMessage("Click the mesh near the desired cut-face position.")
        try:
            self.view.enable_surface_point_picking(
                callback=self._picked, show_message=False, left_clicking=True,
            )
        except Exception as exc:
            self._error(exc)

    def _picked(self, position):
        if position is None:
            return
        try:
            origin, _, u, v = frame(self._plane())
            relative = np.asarray(position) - origin
            self.key_u.setValue(float(relative @ u))
            self.key_v.setValue(float(relative @ v))
            self.add_key()
        finally:
            self.view.disable_picking()

    def remove_key(self):
        rows = sorted({index.row() for index in self.table.selectedIndexes()}, reverse=True)
        for i in rows:
            del self.keys[i]
        if rows:
            self._refresh_table()
            self._dirty()

    def _refresh_table(self):
        self.table.setRowCount(len(self.keys))
        for row, key in enumerate(self.keys):
            for col, value in enumerate((key.u, key.v, key.diameter, key.shape)):
                self.table.setItem(row, col, QtWidgets.QTableWidgetItem(str(value)))

    def generate(self):
        if self.model is None:
            return self._error("Import a model first.")
        QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.CursorShape.WaitCursor)
        self.generate_button.setEnabled(False)
        try:
            result = cut_and_key(self.model, self._plane(), self.keys)
            self.view.clear()
            self.view.add_axes()
            a = self.view.add_mesh(_as_polydata(result.peg_side), color="#e4b16b",
                                   name="peg_piece", smooth_shading=True)
            b = self.view.add_mesh(_as_polydata(result.socket_side), color="#7fa8cd",
                                   name="socket_piece", smooth_shading=True)
            self.result = result
            self.actors = (a, b)
            self._separate()
            self.view.reset_camera()
            self.export_button.setEnabled(True)
            self.statusBar().showMessage("Both solid pieces generated. Inspect before exporting.")
        except Exception as exc:
            self._dirty()
            self._error(exc)
        finally:
            self.generate_button.setEnabled(True)
            QtWidgets.QApplication.restoreOverrideCursor()

    def _separate(self):
        if self.model is None or not self.actors:
            return
        _, n, _, _ = frame(self._plane())
        delta = max(self.model.extents) * self.explode.value() / 400
        for actor, sign in zip(self.actors, (-1, +1)):
            actor.SetPosition(*(n * delta * sign))
        self.view.render()

    def export(self):
        if self.result is None or self.source is None:
            return self._error("Generate the pieces first.")
        folder = QtWidgets.QFileDialog.getExistingDirectory(self, "Choose STL export folder")
        if not folder:
            return
        try:
            paths = export_stl(self.result, folder, self.source.stem)
            self.statusBar().showMessage(f"Saved {paths[0].name} and {paths[1].name}.")
            QtWidgets.QMessageBox.information(self, "Export complete",
                "Saved:\n" + "\n".join(str(path) for path in paths))
        except Exception as exc:
            self._error(exc)

    def _update_available(self, version, url, notes):
        self.release_url = url
        text = f"New Keymaster release: {version}"
        if notes:
            text += "\n" + notes
        self.update_label.setText(text)
        self.update_frame.setVisible(True)

    def _open_release(self):
        if self.release_url:
            QtGui.QDesktopServices.openUrl(QtCore.QUrl(self.release_url))

    def event(self, event):
        if event.type() == QtCore.QEvent.Type.WindowActivate and hasattr(self, "updates"):
            self.updates.check(min_interval=120)
        return super().event(event)

    def closeEvent(self, event):
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.sync()
        self.view.close()
        super().closeEvent(event)


def main():
    application = QtWidgets.QApplication(sys.argv)
    application.setApplicationName("Keymaster")
    application.setOrganizationName("TechSavage3D")
    application.setStyle("Fusion")
    window = KeymasterWindow()
    window.show()
    return application.exec()
