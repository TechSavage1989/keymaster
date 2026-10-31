"""Keymaster 0.2.0a1: selective 3D print assembly workstation.

The original manifold cutting engine remains untouched. UI previews never
modify or overwrite the source model; exports remain explicit.
"""
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
    frame, load_model, suggest_key, suggest_keys,
)
from .segmentation import (
    analyze_sections, cut_selected_sections, place_keys_on_cap,
)
from .theme import ACCENT, BLUE, COPPER, MUTED, STYLESHEET, button, icon_for
from .updates import UpdateMonitor


def _spin(value: float, lo: float = -100000.0, hi: float = 100000.0, decimals: int = 2):
    widget = QtWidgets.QDoubleSpinBox()
    widget.setRange(lo, hi)
    widget.setDecimals(decimals)
    widget.setValue(value)
    widget.setSingleStep(0.1 if decimals else 1)
    widget.setSuffix(" mm")
    return widget


def _as_polydata(mesh):
    faces = np.column_stack((np.full(len(mesh.faces), 3), mesh.faces)).ravel()
    return pv.PolyData(np.asarray(mesh.vertices), faces)


def _heading(title: str, hint: str = ""):
    label = QtWidgets.QLabel(title)
    label.setObjectName("PageHeading")
    if hint:
        label.setToolTip(hint)
    return label


def _muted(text: str, name: str = "Muted"):
    label = QtWidgets.QLabel(text)
    label.setObjectName(name)
    label.setWordWrap(True)
    return label


def _form():
    form = QtWidgets.QFormLayout()
    form.setLabelAlignment(QtCore.Qt.AlignmentFlag.AlignLeft)
    form.setFieldGrowthPolicy(QtWidgets.QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
    form.setHorizontalSpacing(12)
    form.setVerticalSpacing(11)
    return form


class KeymasterWindow(QtWidgets.QMainWindow):
    """Viewport-first layout with contextual editing tools."""

    PRESETS = {
        "Resin - snug": (0.15, 0.20),
        "Resin - easy": (0.25, 0.35),
        "FDM - snug": (0.25, 0.30),
        "FDM - easy": (0.40, 0.50),
    }

    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"Keymaster {__version__} - 3D print assembly preparation")
        self.setMinimumSize(920, 620)
        self.resize(1360, 850)
        self.setAcceptDrops(True)
        self.setWindowIcon(icon_for("keys", color=ACCENT, size=48))

        self.model = None
        self.source = None
        self.result = None
        self.keys: list[KeySpec] = []
        self.actors = ()
        self.release_url = None
        self._preview_polydata = None
        self._display_mode = "empty"
        self._key_marker_names: list[str] = []
        self._loading = False
        self._section_candidates = ()
        self._gizmo_widget = None
        self._gizmo_origin = None
        self._gizmo_normal = None
        self._gizmo_callback_active = False

        root = QtWidgets.QWidget()
        root_layout = QtWidgets.QVBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        self.setCentralWidget(root)

        # Flat top bar. The active file is always visible, independent of tool.
        bar = QtWidgets.QFrame()
        bar.setObjectName("TopBar")
        bar_layout = QtWidgets.QHBoxLayout(bar)
        bar_layout.setContentsMargins(17, 9, 17, 9)
        bar_layout.setSpacing(10)
        mark = QtWidgets.QLabel()
        mark.setPixmap(icon_for("keys", ACCENT, 29).pixmap(29, 29))
        bar_layout.addWidget(mark)
        brand = QtWidgets.QLabel("KEYMASTER")
        brand.setObjectName("Brand")
        bar_layout.addWidget(brand)
        bar_layout.addSpacing(12)
        self.document_name = _muted("No model loaded", "Filename")
        self.document_name.setMinimumWidth(120)
        self.document_name.setMaximumWidth(330)
        bar_layout.addWidget(self.document_name)
        bar_layout.addStretch(1)
        self.import_button = button("Import model", icon="open")
        self.import_button.setToolTip("Import a watertight STL or OBJ. Drag-and-drop also works. (Ctrl+O)")
        self.import_button.clicked.connect(self.import_model)
        bar_layout.addWidget(self.import_button)
        self.generate_button = button("Preview cut", primary=True, icon="cut")
        self.generate_button.setToolTip("Generate the two closed parts using the current cut plane and keys (Ctrl+G)")
        self.generate_button.clicked.connect(self.generate)
        bar_layout.addWidget(self.generate_button)
        self.export_button = button("Export STL", icon="export")
        self.export_button.setEnabled(False)
        self.export_button.setToolTip("Export the current pair of parts as separate STL files (Ctrl+E)")
        self.export_button.clicked.connect(self.export)
        bar_layout.addWidget(self.export_button)
        root_layout.addWidget(bar)

        workspace = QtWidgets.QWidget()
        workspace_layout = QtWidgets.QHBoxLayout(workspace)
        workspace_layout.setContentsMargins(0, 0, 0, 0)
        workspace_layout.setSpacing(0)
        root_layout.addWidget(workspace, 1)

        rail = QtWidgets.QFrame()
        rail.setObjectName("Rail")
        rail.setFixedWidth(83)
        rail_layout = QtWidgets.QVBoxLayout(rail)
        rail_layout.setContentsMargins(2, 12, 2, 12)
        rail_layout.setSpacing(4)
        workspace_layout.addWidget(rail)

        self.nav_group = QtWidgets.QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons = {}
        for index, (key, label) in enumerate((
            ("model", "Model"), ("cut", "Cut"), ("keys", "Keys"), ("parts", "Parts"),
        )):
            tool = QtWidgets.QToolButton()
            tool.setObjectName("RailButton")
            tool.setToolButtonStyle(QtCore.Qt.ToolButtonStyle.ToolButtonTextUnderIcon)
            tool.setIcon(icon_for(key, color="#c5d0da", size=27))
            tool.setIconSize(QtCore.QSize(27, 27))
            tool.setText(label)
            tool.setCheckable(True)
            tool.clicked.connect(lambda checked=False, index=index: self._show_tool(index))
            rail_layout.addWidget(tool)
            self.nav_group.addButton(tool)
            self.nav_buttons[key] = tool
        rail_layout.addStretch(1)

        self.splitter = QtWidgets.QSplitter(QtCore.Qt.Orientation.Horizontal)
        self.splitter.setChildrenCollapsible(False)
        workspace_layout.addWidget(self.splitter, 1)

        viewport_panel = QtWidgets.QFrame()
        viewport_panel.setObjectName("ViewportPanel")
        viewport_layout = QtWidgets.QVBoxLayout(viewport_panel)
        viewport_layout.setContentsMargins(8, 8, 8, 4)
        viewport_layout.setSpacing(6)
        viewport_tools = QtWidgets.QHBoxLayout()
        viewport_tools.addWidget(_muted("3D VIEWPORT", "SectionHeading"))
        viewport_tools.addStretch(1)
        reset_button = button("Frame model")
        reset_button.clicked.connect(self._reset_camera)
        reset_button.setToolTip("Reset camera to fit the model (F)")
        viewport_tools.addWidget(reset_button)
        viewport_tools.addSpacing(8)
        viewport_tools.addWidget(_muted("Shading"))
        self.shading_mode = QtWidgets.QComboBox()
        self.shading_mode.addItems(["Studio clay", "Lit solid", "Shaded edges", "X-ray", "Wireframe"])
        self.shading_mode.setToolTip("Choose lighting and edge modes for the sculpt viewport.")
        self.shading_mode.currentIndexChanged.connect(self._refresh_shading)
        viewport_tools.addWidget(self.shading_mode)
        viewport_layout.addLayout(viewport_tools)
        self.view = QtInteractor(viewport_panel)
        self.view.set_background("#151a20")
        self.view.add_axes()
        if hasattr(self.view, "enable_lightkit"):
            try:
                self.view.enable_lightkit()
            except (RuntimeError, AttributeError):
                pass
        viewport_layout.addWidget(self.view, 1)
        self.viewport_hint = _muted(
            "Drop an STL or OBJ here, or select Import model.", "Hint"
        )
        self.viewport_hint.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        viewport_layout.addWidget(self.viewport_hint)
        self.splitter.addWidget(viewport_panel)

        inspector = QtWidgets.QFrame()
        inspector.setObjectName("Inspector")
        inspector.setMinimumWidth(318)
        inspector.setMaximumWidth(420)
        inspector_layout = QtWidgets.QVBoxLayout(inspector)
        inspector_layout.setContentsMargins(0, 0, 0, 0)
        self.scroll = QtWidgets.QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.stack = QtWidgets.QStackedWidget()
        self.scroll.setWidget(self.stack)
        inspector_layout.addWidget(self.scroll)
        self.splitter.addWidget(inspector)
        self.splitter.setSizes([960, 350])

        self._build_model_page()
        self._build_cut_page()
        self._build_keys_page()
        self._build_parts_page()
        self._show_tool(1)

        self.mesh_status = _muted("No model", "Muted")
        self.statusBar().addPermanentWidget(self.mesh_status)
        self.statusBar().showMessage("Ready. Import a watertight model sized in millimeters.")

        self.settings = QtCore.QSettings(
            str(Path(QtCore.QStandardPaths.writableLocation(
                QtCore.QStandardPaths.StandardLocation.AppConfigLocation
            )) / "keymaster.ini"),
            QtCore.QSettings.Format.IniFormat,
        )
        previous = self.settings.value("geometry")
        if previous:
            self.restoreGeometry(previous)
        sizes = self.settings.value("splitter")
        if isinstance(sizes, list) and len(sizes) == 2:
            try:
                self.splitter.setSizes([int(x) for x in sizes])
            except (ValueError, TypeError):
                pass

        self.updates = UpdateMonitor(self)
        self.updates.available.connect(self._update_available)
        self.updates.status_changed.connect(self.statusBar().showMessage)
        QtCore.QTimer.singleShot(100, lambda: self.updates.check(min_interval=0))
        check_action = QtGui.QAction("Check for updates", self)
        check_action.triggered.connect(lambda: self.updates.check(min_interval=30))
        self.menuBar().addMenu("Help").addAction(check_action)
        self._shortcut("Ctrl+O", self.import_model)
        self._shortcut("Ctrl+G", self.generate)
        self._shortcut("Ctrl+E", self.export)
        self._shortcut("F", self._reset_camera)

    def _shortcut(self, key, callback):
        action = QtGui.QAction(self)
        action.setShortcut(QtGui.QKeySequence(key))
        action.triggered.connect(callback)
        self.addAction(action)

    def _page(self, name, explanation):
        widget = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(widget)
        layout.setContentsMargins(20, 22, 20, 20)
        layout.setSpacing(13)
        layout.addWidget(_heading(name))
        layout.addWidget(_muted(explanation, "Hint"))
        self.stack.addWidget(widget)
        return layout

    def _build_model_page(self):
        layout = self._page("Model", "Inspect the source mesh and prepare it for cutting.")
        layout.addWidget(_muted("IMPORTED FILE", "SectionHeading"))
        self.model_label = _muted("No model loaded", "Filename")
        self.model_label.setWordWrap(True)
        layout.addWidget(self.model_label)
        self.mesh_info = _muted("Triangles: -\nDimensions: -", "Muted")
        layout.addWidget(self.mesh_info)
        self.mesh_validation = _muted("Import a model to inspect its topology.", "StatusGood")
        layout.addWidget(self.mesh_validation)
        open_another = button("Choose STL or OBJ", icon="open")
        open_another.clicked.connect(self.import_model)
        layout.addWidget(open_another)
        layout.addWidget(_muted(
            "Your original model remains unchanged. Dimensions use the source file's units, assumed to be millimeters.",
            "Hint",
        ))
        layout.addStretch(1)

    def _build_cut_page(self):
        layout = self._page("Cut", "Move a visible plane through the model, then preview the split.")
        layout.addWidget(_muted("CUT ORIENTATION", "SectionHeading"))
        self.axis = QtWidgets.QComboBox()
        self.axis.addItems(["Z", "X", "Y", "Free"])
        self.axis.setToolTip("Cut along a plane perpendicular to this axis.")
        self.axis.currentIndexChanged.connect(self._axis_changed)
        layout.addWidget(self.axis)
        layout.addWidget(_muted("PLANE POSITION", "SectionHeading"))
        self.coordinate = _spin(0, -100000, 100000, 3)
        self.coordinate.setToolTip("Exact position along the selected model axis.")
        self.coordinate.valueChanged.connect(self._coordinate_changed)
        layout.addWidget(self.coordinate)
        self.position_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.position_slider.setRange(0, 1000)
        self.position_slider.setValue(500)
        self.position_slider.setToolTip("Drag the cutting plane through the model.")
        self.position_slider.valueChanged.connect(self._position_slider_changed)
        layout.addWidget(self.position_slider)
        self.range_hint = _muted("Load a model to enable the range.", "Hint")
        layout.addWidget(self.range_hint)
        layout.addWidget(_muted(
            "Drag the handles on the plane in the 3D view to move or rotate it. "
            "The Free option allows any angle; X/Y/Z restore a straight cut.",
            "Hint",
        ))
        self.face_gap = _spin(0.0, 0.0, 3.0, 3)
        self.face_gap.setSingleStep(.05)
        self.face_gap.valueChanged.connect(self._dirty)
        self.face_gap.setToolTip("Optional gap removed between cut faces; measured in millimeters.")
        layout.addWidget(_muted("MATING FACE GAP", "SectionHeading"))
        layout.addWidget(self.face_gap)
        layout.addWidget(_muted(
            "This removes material from both sides of the plane. For selective "
            "cuts with unselected sections left attached, keep the gap at zero.",
            "Hint",
        ))
        layout.addWidget(_muted("DETACHABLE SECTIONS", "SectionHeading"))
        self.analyze_button = button("Detect detachable sections")
        self.analyze_button.setToolTip(
            "Analyze solids created on the positive-normal side of the cutting plane.")
        self.analyze_button.clicked.connect(self.analyze_sections)
        layout.addWidget(self.analyze_button)
        self.pick_section_button = button("Click a section in the 3D view")
        self.pick_section_button.setToolTip(
            "After detection, click a model section to toggle its separation.")
        self.pick_section_button.clicked.connect(self.start_section_pick)
        layout.addWidget(self.pick_section_button)
        self.section_list = QtWidgets.QListWidget()
        self.section_list.setMinimumHeight(128)
        self.section_list.setMaximumHeight(225)
        self.section_list.itemChanged.connect(self._candidate_checked)
        self.section_list.currentRowChanged.connect(self._highlight_candidate)
        layout.addWidget(self.section_list)
        self.section_hint = _muted(
            "Analyze the cut to identify separate parts. Uncheck sections you want to keep attached.",
            "Hint",
        )
        layout.addWidget(self.section_hint)
        layout.addWidget(_muted(
            "The highlighted section is an actual detachable solid, not an arbitrary "
            "selection of triangles. Regions connected on the chosen side cannot yet be detached independently.",
            "Hint",
        ))
        cut_preview = button("Generate cut preview", primary=True, icon="preview")
        cut_preview.clicked.connect(self.generate)
        layout.addWidget(cut_preview)
        show_keys = button("Configure alignment keys", icon="keys")
        show_keys.clicked.connect(lambda: self._show_tool(2))
        layout.addWidget(show_keys)
        layout.addStretch(1)

    def _build_keys_page(self):
        layout = self._page("Alignment keys", "Add matching pegs and sockets along the selected cut.")
        layout.addWidget(_muted("FIT PRESET", "SectionHeading"))
        self.preset = QtWidgets.QComboBox()
        self.preset.addItems([*self.PRESETS.keys(), "Custom"])
        self.preset.setCurrentText("Resin - easy")
        self.preset.setToolTip("Starting point only. Real-world printer fit must be calibrated.")
        self.preset.currentTextChanged.connect(self._apply_preset)
        layout.addWidget(self.preset)

        form = _form()
        self.shape = QtWidgets.QComboBox()
        self.shape.addItems(["round", "square", "tapered", "snap"])
        self.key_diameter = _spin(5, .2, 1000)
        self.key_depth = _spin(5, .2, 1000)
        self.radial = _spin(.25, 0, 10, 3)
        self.axial = _spin(.35, 0, 10, 3)
        self.margin = _spin(.8, 0, 20, 3)
        form.addRow("Shape", self.shape)
        form.addRow("Peg diameter", self.key_diameter)
        form.addRow("Insertion depth", self.key_depth)
        form.addRow("Radial clearance", self.radial)
        form.addRow("Extra socket depth", self.axial)
        form.addRow("Edge margin", self.margin)
        layout.addLayout(form)
        self.shape.currentTextChanged.connect(self._connector_shape_changed)
        self.snap_warning = _muted(
            "Snap is an experimental barbed latch for compliant FDM materials only. "
            "Print a calibration piece first; resin and brittle materials are not recommended.",
            "Hint",
        )
        self.snap_warning.setVisible(False)
        layout.addWidget(self.snap_warning)
        self.radial.valueChanged.connect(self._mark_custom_preset)
        self.axial.valueChanged.connect(self._mark_custom_preset)
        layout.addWidget(_muted(
            "Radial clearance is per side. A 5 mm peg with 0.25 mm clearance uses a 5.5 mm socket.",
            "Hint",
        ))

        placement = QtWidgets.QGroupBox("Manual location (cut-plane coordinates)")
        placement.setCheckable(True)
        placement.setChecked(False)
        placement_form = _form()
        self.key_u = _spin(0)
        self.key_v = _spin(0)
        placement_form.addRow("U", self.key_u)
        placement_form.addRow("V", self.key_v)
        placement.setLayout(placement_form)
        layout.addWidget(placement)

        action_row = QtWidgets.QHBoxLayout()
        self.pick_button = button("Click to place", primary=True)
        self.pick_button.clicked.connect(self.start_pick)
        self.auto_button = button("Auto-place")
        self.auto_button.setToolTip("Suggest multiple spaced key locations on the selected cut section.")
        self.auto_button.clicked.connect(self.auto_key)
        action_row.addWidget(self.pick_button, 1)
        action_row.addWidget(self.auto_button)
        layout.addLayout(action_row)
        layout.addWidget(_muted("AUTOMATIC CONNECTOR COUNT", "SectionHeading"))
        self.auto_count = QtWidgets.QSpinBox()
        self.auto_count.setRange(1, 8)
        self.auto_count.setValue(2)
        layout.addWidget(self.auto_count)
        self.add_button = button("Add at U / V")
        self.add_button.clicked.connect(self.add_key)
        layout.addWidget(self.add_button)

        layout.addWidget(_muted("PLANNED KEYS", "SectionHeading"))
        self.table = QtWidgets.QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["U", "V", "Ø", "Type"])
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QtWidgets.QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.ResizeMode.Stretch)
        self.table.setAlternatingRowColors(True)
        self.table.setMinimumHeight(150)
        layout.addWidget(self.table)
        remove_button = button("Remove selected key")
        remove_button.clicked.connect(self.remove_key)
        layout.addWidget(remove_button)
        layout.addWidget(_muted(
            "Pick a point on the model and Keymaster projects it onto the cut plane. Keys are checked when generating the cut.",
            "Hint",
        ))
        layout.addStretch(1)

    def _build_parts_page(self):
        layout = self._page("Parts", "Inspect the separated pieces and export printable solids.")
        self.parts_label = _muted("Generate a cut preview to create two parts.", "Muted")
        layout.addWidget(self.parts_label)
        layout.addWidget(_muted("EXPLODED VIEW", "SectionHeading"))
        self.explode = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.explode.setRange(0, 100)
        self.explode.setValue(25)
        self.explode.valueChanged.connect(self._separate)
        layout.addWidget(self.explode)
        self.part_a_visible = QtWidgets.QCheckBox("Show peg-side part")
        self.part_b_visible = QtWidgets.QCheckBox("Show socket-side part")
        self.part_a_visible.setChecked(True)
        self.part_b_visible.setChecked(True)
        self.part_a_visible.toggled.connect(self._part_visibility_changed)
        self.part_b_visible.toggled.connect(self._part_visibility_changed)
        layout.addWidget(self.part_a_visible)
        layout.addWidget(self.part_b_visible)
        export_here = button("Export printable STL parts", primary=True, icon="export")
        export_here.clicked.connect(self.export)
        layout.addWidget(export_here)
        layout.addWidget(_muted(
            "Both exported parts retain their original assembled positions. The exploded view affects only the viewport.",
            "Hint",
        ))
        layout.addStretch(1)

    def _show_tool(self, index: int):
        self.stack.setCurrentIndex(index)
        keys = ["model", "cut", "keys", "parts"]
        self.nav_buttons[keys[index]].setChecked(True)

    def _error(self, error):
        QtWidgets.QMessageBox.warning(self, "Keymaster", str(error))
        self.statusBar().showMessage(str(error), 10000)

    def _dirty(self, *_):
        self.result = None
        self.export_button.setEnabled(False)
        if hasattr(self, "parts_label"):
            self.parts_label.setText("Settings changed. Preview the cut again to update the parts.")

    def _axis_index(self):
        return {"X": 0, "Y": 1, "Z": 2}.get(self.axis.currentText(), 2)

    def _plane(self):
        if self.model is None:
            raise GeometryError("Import a model first.")
        if self.axis.currentText() == "Free" and self._gizmo_origin is not None:
            return CutPlane(self._gizmo_origin, self._gizmo_normal)
        index = self._axis_index()
        origin = np.array(self.model.bounds.mean(axis=0), dtype=float)
        origin[index] = self.coordinate.value()
        normal = np.eye(3)[index]
        return CutPlane(tuple(origin), tuple(normal))

    def _update_plane_slider(self):
        if self.model is None:
            return
        if self.axis.currentText() == "Free":
            self.position_slider.setEnabled(False)
            self.coordinate.setEnabled(False)
            self.range_hint.setText("Free plane. Drag its handles to move or rotate.")
            return
        self.position_slider.setEnabled(True)
        self.coordinate.setEnabled(True)
        lo, hi = (float(x) for x in self.model.bounds[:, self._axis_index()])
        self.range_hint.setText(f"Model extent: {lo:.2f} to {hi:.2f} mm")
        relative = (self.coordinate.value() - lo) / max(hi - lo, 1e-12)
        with QtCore.QSignalBlocker(self.position_slider):
            self.position_slider.setValue(int(np.clip(relative, 0, 1) * 1000))

    def _coordinate_changed(self, *_):
        self._dirty()
        self._invalidate_analysis()
        if self.model is not None:
            try:
                self._update_plane_slider()
                self._draw_original()
            except Exception as exc:
                self._error(f"Could not update cut plane preview: {exc}")

    def _position_slider_changed(self, value):
        if self.model is None or self.axis.currentText() == "Free":
            return
        lo, hi = (float(x) for x in self.model.bounds[:, self._axis_index()])
        with QtCore.QSignalBlocker(self.coordinate):
            self.coordinate.setValue(lo + (hi - lo) * value / 1000.0)
        self._dirty()
        self._invalidate_analysis()
        try:
            self._draw_original()
        except Exception as exc:
            self._error(f"Could not update cut plane: {exc}")

    def _axis_changed(self, *_):
        self._dirty()
        self._invalidate_analysis()
        if self.model is not None:
            try:
                if self.axis.currentText() != "Free":
                    self._gizmo_origin = None
                    self._gizmo_normal = None
                    with QtCore.QSignalBlocker(self.coordinate):
                        self.coordinate.setValue(
                            float(self.model.bounds[:, self._axis_index()].mean())
                        )
                elif self._gizmo_origin is None:
                    origin, normal, _, _ = frame(CutPlane(
                        tuple(self.model.bounds.mean(axis=0)), (0, 0, 1)
                    ))
                    self._gizmo_origin, self._gizmo_normal = tuple(origin), tuple(normal)
                self._update_plane_slider()
                self._draw_original()
                self._enable_gizmo(reset=True)
            except Exception as exc:
                self._error(f"Could not change cut plane axis: {exc}")

    def _apply_preset(self, name):
        values = self.PRESETS.get(name)
        if values is None:
            return
        with QtCore.QSignalBlocker(self.radial), QtCore.QSignalBlocker(self.axial):
            self.radial.setValue(values[0])
            self.axial.setValue(values[1])

    def _mark_custom_preset(self, *_):
        if self.preset.currentText() != "Custom":
            with QtCore.QSignalBlocker(self.preset):
                self.preset.setCurrentText("Custom")


    def _invalidate_analysis(self):
        self._section_candidates = ()
        if hasattr(self, "section_list"):
            with QtCore.QSignalBlocker(self.section_list):
                self.section_list.clear()
            self.section_hint.setText("Cut changed. Detect detachable sections again.")
        if hasattr(self, "view") and hasattr(self.view, "remove_actor"):
            self.view.remove_actor("candidate_highlight", reset_camera=False)

    def _connector_shape_changed(self, name):
        self.snap_warning.setVisible(name == "snap")

    def _refresh_shading(self, *_):
        if self.model is not None:
            try:
                if self._display_mode == "parts" and self.result is not None:
                    # Avoid discarding a computed cut just to change lighting.
                    for actor in self.actors:
                        try:
                            actor.GetProperty().SetInterpolationToPhong()
                            actor.GetProperty().SetSpecular(.38)
                            actor.GetProperty().SetSpecularPower(30)
                        except AttributeError:
                            pass
                    self.view.render()
                else:
                    self._draw_original()
            except Exception as exc:
                self._error(f"Could not change viewport shading: {exc}")

    def _material_options(self, *, part=False):
        mode = self.shading_mode.currentText()
        settings = dict(
            smooth_shading=(mode != "Wireframe"),
            lighting=(mode != "Wireframe"),
            ambient=.22, diffuse=.80, specular=.36, specular_power=38,
        )
        if mode == "Shaded edges":
            settings.update(show_edges=True, edge_color="#53616d")
        elif mode == "Wireframe":
            settings.update(style="wireframe", line_width=1.3)
        elif mode == "X-ray":
            settings.update(opacity=.48)
        return settings

    def _clear_gizmo(self):
        self._gizmo_widget = None
        if hasattr(self.view, "clear_plane_widgets"):
            try:
                self.view.clear_plane_widgets()
            except (AttributeError, RuntimeError):
                pass

    def _enable_gizmo(self, *, reset=False):
        """VTK interactive move/rotate plane handles; skip in headless tests."""
        if self.model is None or not hasattr(self.view, "add_plane_widget"):
            return
        if self._gizmo_widget is not None and not reset:
            try:
                rep = self._gizmo_widget.GetRepresentation()
                if not self._gizmo_callback_active:
                    p = self._plane()
                    rep.SetOrigin(*p.origin)
                    rep.SetNormal(*p.normal)
                    rep.BuildRepresentation()
                return
            except (AttributeError, RuntimeError):
                self._clear_gizmo()
        self._clear_gizmo()
        p = self._plane()
        bounds = self.model.bounds
        pv_bounds = (float(bounds[0, 0]), float(bounds[1, 0]),
                     float(bounds[0, 1]), float(bounds[1, 1]),
                     float(bounds[0, 2]), float(bounds[1, 2]))
        try:
            self._gizmo_widget = self.view.add_plane_widget(
                self._on_gizmo_move, normal=p.normal, origin=p.origin,
                bounds=pv_bounds, color=COPPER, normal_rotation=True,
                interaction_event="always", test_callback=False,
            )
        except Exception as exc:
            self._gizmo_widget = None
            self.statusBar().showMessage(f"Plane gizmo unavailable: {exc}", 10000)

    def _on_gizmo_move(self, normal, origin):
        if self.model is None or self._gizmo_callback_active:
            return
        try:
            normal = np.asarray(normal, dtype=float)
            origin = np.asarray(origin, dtype=float)
            if not np.all(np.isfinite(origin)) or not np.all(np.isfinite(normal)):
                return
            normal /= np.linalg.norm(normal)
            self._gizmo_origin = tuple(float(x) for x in origin)
            self._gizmo_normal = tuple(float(x) for x in normal)
            self._gizmo_callback_active = True
            with QtCore.QSignalBlocker(self.axis):
                self.axis.setCurrentText("Free")
            self._update_plane_slider()
            self._dirty()
            self._invalidate_analysis()
            self._draw_original()
        except Exception as exc:
            self.statusBar().showMessage(f"Plane manipulation failed: {exc}", 10000)
        finally:
            self._gizmo_callback_active = False

    def analyze_sections(self):
        if self.model is None:
            return self._error("Import a model first.")
        if self._loading:
            return
        QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.CursorShape.WaitCursor)
        self.analyze_button.setEnabled(False)
        try:
            candidates = analyze_sections(self.model, self._plane())
            self._section_candidates = candidates
            with QtCore.QSignalBlocker(self.section_list):
                self.section_list.clear()
                for c in candidates:
                    item = QtWidgets.QListWidgetItem(
                        f"Section {c.index + 1} | {c.volume:.1f} mm³")
                    item.setData(QtCore.Qt.ItemDataRole.UserRole, c.index)
                    item.setFlags(item.flags() | QtCore.Qt.ItemFlag.ItemIsUserCheckable)
                    item.setCheckState(QtCore.Qt.CheckState.Checked)
                    item.setToolTip(
                        f"Center {tuple(round(n,1) for n in c.centroid)}\n"
                        f"Cut face area {c.surface_area:.1f} mm²")
                    self.section_list.addItem(item)
            self.section_hint.setText(
                f"{len(candidates)} detachable section(s) found. "
                "Uncheck any that should remain attached to the body.")
            self.section_list.setCurrentRow(0)
            self.statusBar().showMessage(
                f"Detected {len(candidates)} detachable sections. Select which to detach.")
        except Exception as exc:
            self._invalidate_analysis()
            self._error(exc)
        finally:
            self.analyze_button.setEnabled(True)
            QtWidgets.QApplication.restoreOverrideCursor()

    def start_section_pick(self):
        if not self._section_candidates:
            return self._error("First select Detect detachable sections.")
        if not hasattr(self.view, "enable_surface_point_picking"):
            return self._error("Viewport point picking is not available.")
        self._clear_gizmo()
        self.statusBar().showMessage(
            "Click a section on the positive side of the plane to toggle separation.")
        try:
            self.view.enable_surface_point_picking(
                callback=self._picked_section, show_message=False, left_clicking=True)
        except Exception as exc:
            self._enable_gizmo(reset=True)
            self._error(f"Section selection is unavailable: {exc}")

    def _picked_section(self, position):
        try:
            if position is None or not self._section_candidates:
                return
            xyz = np.asarray(position, dtype=float)
            origin, normal, _, _ = frame(self._plane())
            if float((xyz - origin) @ normal) < -max(.01, float(max(self.model.extents)) * .005):
                self.statusBar().showMessage(
                    "Choose geometry on the positive-normal side of the plane.", 7000)
                return
            scores = []
            for row, candidate in enumerate(self._section_candidates):
                bounds = candidate.mesh.bounds
                outside = np.maximum(bounds[0] - xyz, 0) + np.maximum(xyz - bounds[1], 0)
                vertices = candidate.mesh.vertices
                stride = max(1, len(vertices) // 6000)
                nearest = float(np.min(np.linalg.norm(vertices[::stride] - xyz, axis=1)))
                scores.append((float(np.linalg.norm(outside)), nearest, row))
            _, nearest_distance, row = min(scores)
            if nearest_distance > max(6.0, float(max(self.model.extents)) * .06):
                self.statusBar().showMessage(
                    "That position is not near a detachable section.", 7000)
                return
            item = self.section_list.item(row)
            item.setCheckState(
                QtCore.Qt.CheckState.Unchecked
                if item.checkState() == QtCore.Qt.CheckState.Checked
                else QtCore.Qt.CheckState.Checked
            )
            self.section_list.setCurrentRow(row)
            state = "Detach" if item.checkState() == QtCore.Qt.CheckState.Checked else "Keep attached"
            self.statusBar().showMessage(f"Section {row + 1}: {state}")
        finally:
            if hasattr(self.view, "disable_picking"):
                self.view.disable_picking()
            self._enable_gizmo(reset=True)

    def _selected_sections(self):
        return tuple(
            int(self.section_list.item(i).data(QtCore.Qt.ItemDataRole.UserRole))
            for i in range(self.section_list.count())
            if self.section_list.item(i).checkState() == QtCore.Qt.CheckState.Checked
        )

    def _candidate_checked(self, *_):
        self._dirty()

    def _highlight_candidate(self, row):
        if self.model is None or not hasattr(self.view, "remove_actor"):
            return
        try:
            self.view.remove_actor("candidate_highlight", reset_camera=False)
            if self._display_mode != "original" or row < 0:
                return
            candidate = self._section_candidates[row]
            self.view.add_mesh(
                _as_polydata(candidate.mesh), name="candidate_highlight",
                color="#f3b56b", opacity=.40, lighting=True, pickable=False,
            )
        except (IndexError, ValueError):
            return

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
        if filename:
            self._load_path(filename)

    def _load_path(self, filename: str | Path):
        if self._loading:
            return
        self._loading = True
        try:
            mesh = load_model(filename)
            preview_poly = _as_polydata(mesh)
            if len(mesh.faces) > 250000:
                try:
                    # Display-only decimation. All geometry operations always use
                    # the exact original mesh, never this accelerated display.
                    preview_poly = preview_poly.decimate_pro(0.55, preserve_topology=True)
                except Exception:
                    pass
        except Exception as exc:
            self._error(exc)
            self._loading = False
            return
        self.model, self.source = mesh, Path(filename)
        self._preview_polydata = preview_poly
        self._gizmo_origin = None
        self._gizmo_normal = None
        self._invalidate_analysis()
        try:
            self.keys.clear()
            self._refresh_table()
            self._dirty()
            with QtCore.QSignalBlocker(self.axis), QtCore.QSignalBlocker(self.coordinate):
                self.axis.setCurrentText("Z")
                self.coordinate.setValue(float(mesh.bounds[:, 2].mean()))
            self._update_plane_slider()
            dimensions = " x ".join(f"{size:.1f}" for size in mesh.extents)
            self.model_label.setText(self.source.name)
            self.mesh_info.setText(
                f"Triangles: {len(mesh.faces):,}\n"
                f"Vertices: {len(mesh.vertices):,}\n"
                f"Dimensions: {dimensions} mm"
            )
            self.mesh_validation.setText("Closed mesh | Consistent winding | Positive volume")
            self.document_name.setText(self.source.name)
            self.document_name.setToolTip(str(self.source))
            self.mesh_status.setText(f"{len(mesh.faces):,} triangles | Watertight")
            self.viewport_hint.setText("Drag to orbit | Scroll to zoom | Select Cut or Keys to edit")
            self._clear_gizmo()
            self._draw_original(reset_camera=True)
            self._enable_gizmo(reset=True)
            self._show_tool(1)
            self.statusBar().showMessage("Model imported. Move the cut plane or add keys.")
        except Exception as exc:
            self._error(f"Model was loaded but its preview could not be initialized: {exc}")
        finally:
            self._loading = False

    def _draw_original(self, reset_camera=False):
        if self.model is None:
            return
        can_reuse = (
            self._display_mode == "original"
            and not reset_camera
            and hasattr(self.view, "remove_actor")
        )
        if can_reuse:
            for name in ("cut_plane", "cut_intersection", *self._key_marker_names):
                self.view.remove_actor(name, reset_camera=False)
        else:
            camera = getattr(self.view, "camera_position", None) if not reset_camera else None
            self.view.clear()
            self.view.add_axes()
            self.view.add_mesh(
                self._preview_polydata if self._preview_polydata is not None else _as_polydata(self.model),
                name="original",
                color=("#becbd6" if self.shading_mode.currentText() == "Lit solid" else "#a7b6c4"),
                **self._material_options(),
            )
            if camera is not None:
                self.view.camera_position = camera
        plane = self._plane()
        origin, normal, u, v = frame(plane)
        scale = max(float(max(self.model.extents)) * 1.2, 1)
        self.view.add_mesh(
            pv.Plane(center=origin, direction=normal, i_size=scale, j_size=scale),
            color=COPPER, opacity=0.24, name="cut_plane", pickable=False,
        )
        # Mark the true mesh-plane intersection in a contrasting bright color.
        if hasattr(self.view, "add_plane_widget") and self._preview_polydata is not None:
            try:
                outline = self._preview_polydata.slice(normal=normal, origin=origin)
                if outline.n_cells:
                    self.view.add_mesh(outline, name="cut_intersection",
                        color="#f8c482", line_width=3.5,
                        lighting=False, pickable=False)
            except Exception:
                pass
        self._key_marker_names.clear()
        for i, key in enumerate(self.keys):
            name = f"key_marker_{i}"
            self.view.add_mesh(
                pv.Cylinder(
                    center=origin + u * key.u + v * key.v + normal * (key.depth / 2),
                    direction=normal, radius=key.diameter / 2,
                    height=key.depth, resolution=24,
                ),
                name=name, color=BLUE, opacity=0.65, pickable=False,
            )
            self._key_marker_names.append(name)
        if reset_camera:
            self.view.reset_camera()
        self._display_mode = "original"
        self.actors = ()
        self._enable_gizmo()
        if self._section_candidates and hasattr(self.view, "remove_actor"):
            self._highlight_candidate(self.section_list.currentRow())

    def _refresh_table(self):
        self.table.setRowCount(len(self.keys))
        for row, key in enumerate(self.keys):
            for column, value in enumerate((f"{key.u:.1f}", f"{key.v:.1f}", f"{key.diameter:.1f}", key.shape)):
                self.table.setItem(row, column, QtWidgets.QTableWidgetItem(str(value)))

    def add_key(self):
        if self.model is None:
            return self._error("Import a model first.")
        self.keys.append(self._template())
        self._refresh_table()
        self._dirty()
        try:
            self._draw_original()
            self.statusBar().showMessage("Key placed. Preview the cut to validate its fit.")
        except Exception as exc:
            self._error(exc)

    def auto_key(self):
        if self.model is None:
            return self._error("Import a model first.")
        try:
            count = self.auto_count.value()
            if self._section_candidates:
                selected = self._selected_sections()
                if not selected:
                    raise GeometryError("Choose a section before placing connectors.")
                cap = next(c.cap for c in self._section_candidates if c.index == selected[0])
                keys = place_keys_on_cap(cap, self._template(), count, self.keys)
            else:
                keys = suggest_keys(self.model, self._plane(), self._template(), count, self.keys)
            self.keys.extend(keys)
            self._refresh_table()
            self._dirty()
            self._draw_original()
            self.statusBar().showMessage(
                f"Placed {len(keys)} suggested connectors. Preview the cut to check fit.")
        except Exception as exc:
            self._error(exc)

    def start_pick(self):
        if self.model is None:
            return self._error("Import a model first.")
        try:
            self._draw_original()
            self._clear_gizmo()
            self.statusBar().showMessage("Click on the model to place a key on the cut plane.")
            self.view.enable_surface_point_picking(
                callback=self._picked, show_message=False, left_clicking=True,
            )
        except Exception as exc:
            self._enable_gizmo(reset=True)
            self._error(exc)

    def _picked(self, position):
        try:
            if position is None:
                return
            origin, _, u, v = frame(self._plane())
            relative = np.asarray(position) - origin
            self.key_u.setValue(float(relative @ u))
            self.key_v.setValue(float(relative @ v))
            self.add_key()
        finally:
            if hasattr(self.view, "disable_picking"):
                self.view.disable_picking()
            self._enable_gizmo(reset=True)

    def remove_key(self):
        rows = sorted({index.row() for index in self.table.selectedIndexes()}, reverse=True)
        for index in rows:
            del self.keys[index]
        if rows:
            self._refresh_table()
            self._dirty()
            try:
                self._draw_original()
            except Exception as exc:
                self._error(exc)

    def generate(self):
        if self.model is None:
            return self._error("Import a model first.")
        QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.CursorShape.WaitCursor)
        self.generate_button.setEnabled(False)
        try:
            self._clear_gizmo()
            if self._section_candidates:
                result = cut_selected_sections(
                    self.model, self._plane(), self._selected_sections(),
                    self.keys, self.face_gap.value(),
                )
            else:
                result = cut_and_key(
                    self.model, self._plane(), self.keys, self.face_gap.value(),
                )
            self.view.clear()
            self.view.add_axes()
            colors = (COPPER, BLUE, "#a99bd4", "#87bf9a", "#d68ba8")
            actors = []
            for index, part in enumerate(result.parts):
                actor = self.view.add_mesh(
                    _as_polydata(part), color=colors[index % len(colors)],
                    name=f"print_part_{index+1}", **self._material_options(part=True))
                actors.append(actor)
            self.result = result
            self.actors = tuple(actors)
            self._display_mode = "parts"
            self._separate()
            self.view.reset_camera()
            self.export_button.setEnabled(True)
            self.parts_label.setText(
                f"{len(result.parts)} printable closed part(s) generated.\n"
                + "\n".join(
                    f"Part {i+1}: {len(part.faces):,} faces"
                    for i, part in enumerate(result.parts)
                )
                + f"\nAlignment connectors: {len(self.keys)}"
            )
            self._show_tool(3)
            self.statusBar().showMessage(
                f"{len(result.parts)} closed parts generated. Inspect and export.")
        except Exception as exc:
            self._dirty()
            self._error(exc)
            if self.model is not None:
                try:
                    self._draw_original()
                except Exception:
                    pass
        finally:
            self.generate_button.setEnabled(True)
            QtWidgets.QApplication.restoreOverrideCursor()

    def _separate(self, *_):
        if self.model is None or not self.actors:
            return
        _, normal, _, _ = frame(self._plane())
        distance = max(float(max(self.model.extents)), 0.1) * self.explode.value() / 400
        center = (len(self.actors) - 1) / 2
        for index, actor in enumerate(self.actors):
            actor.SetPosition(*(normal * distance * (index - center) * 2))
        self.view.render()

    def _part_visibility_changed(self, *_):
        if self.actors:
            controls = (self.part_a_visible.isChecked(), self.part_b_visible.isChecked())
            for i, actor in enumerate(self.actors):
                actor.SetVisibility(controls[i] if i < 2 else True)
            self.view.render()

    def export(self):
        if self.result is None or self.source is None:
            return self._error("Generate a cut preview before exporting.")
        folder = QtWidgets.QFileDialog.getExistingDirectory(self, "Choose STL export folder")
        if not folder:
            return
        try:
            paths = export_stl(self.result, folder, self.source.stem)
            self.statusBar().showMessage(f"Saved {len(paths)} printable part(s).")
            QtWidgets.QMessageBox.information(self, "Export complete",
                "Saved:\n" + "\n".join(str(path) for path in paths))
        except Exception as exc:
            self._error(exc)

    def _reset_camera(self):
        if self.model is not None:
            self.view.reset_camera()

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls() and any(
            url.isLocalFile() and Path(url.toLocalFile()).suffix.lower() in (".stl", ".obj")
            for url in event.mimeData().urls()
        ):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event):
        for url in event.mimeData().urls():
            if url.isLocalFile() and Path(url.toLocalFile()).suffix.lower() in (".stl", ".obj"):
                self._load_path(url.toLocalFile())
                event.acceptProposedAction()
                return
        event.ignore()

    def _update_available(self, version, url, notes):
        self.release_url = url
        self.statusBar().showMessage(f"New Keymaster release {version}. Open Help to view details.")
        menu = self.menuBar().findChildren(QtWidgets.QMenu)
        if menu:
            existing = [a for a in menu[0].actions() if a.text().startswith("Open release")]
            for action in existing:
                menu[0].removeAction(action)
            release_action = QtGui.QAction(f"Open release {version}", self)
            release_action.triggered.connect(self._open_release)
            menu[0].addAction(release_action)

    def _open_release(self):
        if self.release_url:
            QtGui.QDesktopServices.openUrl(QtCore.QUrl(self.release_url))

    def event(self, event):
        if event.type() == QtCore.QEvent.Type.WindowActivate and hasattr(self, "updates"):
            self.updates.check(min_interval=120)
        return super().event(event)

    def closeEvent(self, event):
        self._clear_gizmo()
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.setValue("splitter", self.splitter.sizes())
        self.settings.sync()
        self.view.close()
        super().closeEvent(event)


def main():
    application = QtWidgets.QApplication(sys.argv)
    application.setApplicationName("Keymaster")
    application.setOrganizationName("TechSavage3D")
    application.setStyle("Fusion")
    application.setStyleSheet(STYLESHEET)
    window = KeymasterWindow()
    window.show()
    return application.exec()


if __name__ == "__main__":
    raise SystemExit(main())
