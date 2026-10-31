"""Keymaster's compact dark workstation theme and drawn vector-style icons.

All icons are rendered by Qt; no external fonts or asset packages are needed.
"""
from __future__ import annotations

from PySide6 import QtCore, QtGui, QtWidgets

INK = "#e9edf2"
MUTED = "#9ca8b5"
ACCENT = "#c75e58"
COPPER = "#e0ab74"
BLUE = "#83b6ca"

STYLESHEET = """
QWidget {
    background: #181b20;
    color: #e9edf2;
    font-family: "Segoe UI", "Arial", sans-serif;
    font-size: 12px;
}
QMainWindow, QSplitter, QStackedWidget { background: #181b20; }
QFrame#TopBar { background: #1f242b; border-bottom: 1px solid #323943; }
QFrame#Rail { background: #15191e; border-right: 1px solid #303742; }
QFrame#Inspector { background: #20252c; border-left: 1px solid #323943; }
QFrame#ViewportPanel { background: #151a20; }
QLabel#Brand { font-size: 18px; font-weight: 750; letter-spacing: 1px; }
QLabel#PageHeading { font-size: 18px; font-weight: 650; }
QLabel#SectionHeading { font-size: 11px; font-weight: 700; color: #aebcc7; }
QLabel#Muted { color: #9ca8b5; }
QLabel#Hint { color: #a3afba; font-size: 11px; }
QLabel#Filename { color: #b1c2d0; font-size: 12px; }
QLabel#InfoValue { font-weight: 600; }
QLabel#StatusGood { color: #94cbb4; }
QPushButton {
    background: #303841; color: #e9edf2;
    padding: 8px 13px; border: 1px solid #414b56;
    border-radius: 6px; min-height: 17px;
}
QPushButton:hover { background: #3a4551; border-color: #687987; }
QPushButton:pressed { background: #27303a; }
QPushButton:disabled { background: #252c33; color: #72808d; border-color: #303843; }
QPushButton#PrimaryButton {
    background: #b8534e; color: white;
    border-color: #ce6860; font-weight: 650;
}
QPushButton#PrimaryButton:hover { background: #d0645d; }
QToolButton#RailButton {
    background: transparent; border: 0; border-left: 3px solid transparent;
    padding: 9px 2px; color: #a8b5c0; min-height: 64px;
}
QToolButton#RailButton:hover { background: #232b35; color: white; }
QToolButton#RailButton:checked {
    background: #303038; color: #ffffff; border-left: 3px solid #ca655e;
}
QToolButton#ToolbarButton {
    background: #303841; border: 1px solid #414b56;
    border-radius: 6px; padding: 6px 10px;
}
QToolButton#ToolbarButton:hover { background: #3a4551; }
QComboBox, QDoubleSpinBox, QSpinBox {
    background: #151a20; color: #f0f2f5; border: 1px solid #46515d;
    padding: 6px 8px; border-radius: 5px; min-height: 20px;
}
QComboBox:hover, QDoubleSpinBox:hover, QSpinBox:hover { border-color: #778b9b; }
QComboBox::drop-down { border: none; width: 22px; }
QComboBox QAbstractItemView {
    background: #242b34; color: white; border: 1px solid #495561;
    selection-background-color: #4a5b68;
}
QSlider::groove:horizontal {
    background: #404b56; height: 5px; border-radius: 2px;
}
QSlider::sub-page:horizontal { background: #c56760; border-radius: 2px; }
QSlider::handle:horizontal {
    background: #ecb5a3; border: 1px solid #a95853;
    width: 15px; height: 15px; margin: -6px 0; border-radius: 8px;
}
QTableWidget {
    background: #181e24; border: 1px solid #37404a; border-radius: 5px;
    gridline-color: #343f49; alternate-background-color: #202833;
}
QTableWidget::item:selected { background: #4b5868; }
QHeaderView::section {
    background: #2b343e; color: #b9c6d1;
    border: 0; padding: 6px;
}
QScrollArea { background: transparent; border: 0; }
QScrollBar:vertical {
    background: #20252c; width: 9px; margin: 0;
}
QScrollBar::handle:vertical {
    background: #4a5663; border-radius: 4px; min-height: 24px;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QGroupBox {
    border: 1px solid #394550; margin-top: 11px;
    border-radius: 7px; padding: 12px 9px 9px;
}
QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #b3c1cc; }
QCheckBox { color: #d9e3eb; spacing: 7px; }
QStatusBar {
    background: #171b20; color: #aebac5;
    border-top: 1px solid #303944; font-size: 11px;
}
QMenuBar { background: #1f242b; color: #e5ecf2; }
QMenuBar::item:selected { background: #323c47; }
QMenu { background: #222a33; border: 1px solid #414d58; }
QMenu::item:selected { background: #3b4c5d; }
QSplitter::handle { background: #323943; width: 1px; }
"""


def icon_for(name: str, color: str = INK, size: int = 28) -> QtGui.QIcon:
    """Draw simple scalable tool icons into a high-resolution QPixmap."""
    pix = QtGui.QPixmap(size * 2, size * 2)
    pix.fill(QtCore.Qt.GlobalColor.transparent)
    p = QtGui.QPainter(pix)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
    p.scale(size / 24.0 * 2, size / 24.0 * 2)
    pen = QtGui.QPen(QtGui.QColor(color), 1.8)
    pen.setCapStyle(QtCore.Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(QtCore.Qt.PenJoinStyle.RoundJoin)
    p.setPen(pen)
    p.setBrush(QtCore.Qt.BrushStyle.NoBrush)
    if name == "model":
        p.drawPolygon(QtGui.QPolygonF([
            QtCore.QPointF(12, 2), QtCore.QPointF(21, 7),
            QtCore.QPointF(21, 17), QtCore.QPointF(12, 22),
            QtCore.QPointF(3, 17), QtCore.QPointF(3, 7),
        ]))
        p.drawLine(3, 7, 12, 12); p.drawLine(21, 7, 12, 12)
        p.drawLine(12, 12, 12, 22)
    elif name == "cut":
        p.drawLine(3, 19, 21, 5)
        p.drawLine(3, 5, 21, 19)
        p.drawEllipse(QtCore.QRectF(1.5, 1.5, 5, 5))
        p.drawEllipse(QtCore.QRectF(1.5, 17.5, 5, 5))
    elif name == "keys":
        p.drawEllipse(QtCore.QRectF(3, 3, 9, 9))
        p.drawLine(10, 10, 21, 21)
        p.drawLine(15, 15, 18, 12)
        p.drawLine(18, 18, 21, 15)
    elif name == "parts":
        p.drawRect(QtCore.QRectF(3, 3, 7, 7))
        p.drawRect(QtCore.QRectF(14, 3, 7, 7))
        p.drawRect(QtCore.QRectF(3, 14, 7, 7))
        p.drawRect(QtCore.QRectF(14, 14, 7, 7))
    elif name == "open":
        p.drawRoundedRect(QtCore.QRectF(2, 7, 20, 14), 2, 2)
        p.drawLine(3, 7, 9, 3); p.drawLine(9, 3, 15, 3)
    elif name == "preview":
        p.drawEllipse(QtCore.QRectF(2, 7, 20, 11))
        p.drawEllipse(QtCore.QRectF(9, 10, 6, 6))
    elif name == "export":
        p.drawLine(12, 2, 12, 15)
        p.drawLine(7, 10, 12, 15); p.drawLine(17, 10, 12, 15)
        p.drawLine(4, 18, 4, 21); p.drawLine(4, 21, 20, 21); p.drawLine(20, 21, 20, 18)
    else:
        p.drawEllipse(QtCore.QRectF(4, 4, 16, 16))
    p.end()
    return QtGui.QIcon(pix)


def button(text: str, *, primary: bool = False, icon: str | None = None) -> QtWidgets.QPushButton:
    control = QtWidgets.QPushButton(text)
    if primary:
        control.setObjectName("PrimaryButton")
    if icon:
        control.setIcon(icon_for(icon, size=20))
    control.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    return control
