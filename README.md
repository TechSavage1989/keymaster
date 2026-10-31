<h1 align="center">Keymaster</h1>
<p align="center">Cut 3D-printable figures and sculptures into keyed, matching parts.</p>
<p align="center">
  <a href="#download">Download</a> |
  <a href="#getting-started">Get started</a> |
  <a href="#features">Features</a> |
  <a href="#updates-and-settings">Updates</a> |
  <a href="#development">Development</a>
</p>

## Features

Keymaster is a Windows-first desktop preview for preparing closed STL and OBJ meshes for printing in separate pieces.

- Import an STL or OBJ by file dialog or drag-and-drop; inspect it in a large rotatable 3D viewport.
- Use contextual Model, Cut, Keys, and Parts tools with a dark workstation interface.
- Drag a position slider to move the visible cut plane without doing a costly solid Boolean operation on every change.
- Recognize shared vertices in standard STL exports before validating mesh watertightness.
- Initialize the model preview and X/Y/Z cutting plane correctly after loading, and report preview errors.
- Cut along an X, Y, or freely rotated plane using on-plane native handles: drag the center sphere or outer frame to translate, and drag the normal arrow to rotate. Choose Move only or Rotate only if needed.
- Inspect the actual intersection curve instead of guessing from a translucent plane.
- Plane interaction uses end-of-drag events and defers all scene modifications until the VTK callback finishes. A handle visibility toggle provides a fallback for unsupported graphics drivers.
- Detect independently detachable positive-side solid sections and check or click which ones to detach; unselected sections stay attached to the retained body.
- Apply an optional mating-face gap for fully selected cuts and independent peg/socket clearances.
- Add round, square or tapered integral pegs and matching sockets; an experimental barbed snap option is provided for fit experimentation on compliant FDM materials.
- Suggest multiple non-overlapping alignment keys automatically on a selected section's actual cut face.
- Set diameter, insertion depth, radial fit clearance, extra socket depth and minimum edge margin per key.
- Apply resin/FDM fit presets or adjust clearance manually; presets are suggested starting points, not guaranteed printer fits.
- See translucent key markers before generating the closed cut geometry.
- Manually enter key positions in the cut plane, click a model to project a point, or suggest a cut-face location.
- Generate two or more printable parts and inspect an exploded preview. Section selections are preserved until the cutting plane changes.
- Choose studio clay, lit solid, shaded edges, X-ray or wireframe rendering to reveal sculpt detail.
- Keep orbit/zoom position when moving the plane; very dense models use a display-only simplified mesh, with exact original geometry retained for cutting.
- Export two or more STL files without overwriting previous exports.
- Reject open/inverted meshes, keys outside the cut face, and overlapping keys.

**Preview limitations:** One cutting plane per operation. Selective detachment works only when the plane produces independently connected solids on its positive-normal side. Regions joined to one another above that cut cannot yet be detached independently. When unselected sections remain attached, face gap must be zero. Tapered and experimental snap shapes are not mechanically validated. STL/OBJ imports lose materials; models must already be scaled in millimeters. No production-grade snap-fit analysis or material simulation.

## Download

Get the currently published **Windows prerelease** from the [GitHub releases page](https://github.com/TechSavage1989/keymaster/releases) and select **Keymaster_Windows_Portable.zip**. Keep the extracted Keymaster folder together; launch the stable filename **Keymaster.exe**.

The current published prerelease is **0.2.0 alpha 2**, available from the [verified GitHub release](https://github.com/TechSavage1989/keymaster/releases/tag/v0.2.0-alpha.2). Use the Windows portable ZIP published under that tag. This update addresses native plane-click crashes and improves on-plane move/rotate controls. The Windows portable ZIP is 174.4 MB (166.3 MiB). There is no production-tested stable release. This update includes selective section detachment, direct plane manipulation, improved shading, automatic multi-key placement and additional connector prototypes. Previous releases remain available.

## Requirements

- Windows 10 or 11, 64-bit, for the intended portable build (native end-user validation is pending).
- A working OpenGL graphics driver for the 3D viewport.
- No Python installation required for a successfully packaged Windows portable build.
- For source execution: Python 3.11 through 3.13, plus project dependencies. Build workflow uses Python 3.12.

## Getting started

1. Download the verified portable ZIP from [Releases](https://github.com/TechSavage1989/keymaster/releases) when available.
2. Extract the ZIP. Keep the contents of its **Keymaster** folder together.
3. Start **Keymaster.exe** inside the extracted folder. The filename stays stable between updates.
4. Use **Import STL / OBJ** to load a watertight model with dimensions in millimeters.
5. Open **Cut** and drag the 3D plane widget to translate or rotate the cut freely. X/Y/Z reset an axis-aligned orientation. Watch the highlighted mesh-plane intersection.
6. Select **Detect detachable sections**, then uncheck a listed section or use **Click a section in the 3D view** to toggle its separation. Only geometrically independent sections on the selected positive side are listed.
7. Use **Keys** to select a connector shape, fit preset, diameter and automatic connector count. Choose **Auto-place** or place individual keys on the model. Snap latches are experimental.
8. Configure optional **Mating face gap** for a complete cut. Select **Preview cut** to generate and inspect the parts before using **Export STL**.

To run directly from source:

    python -m venv .venv
    .venv\Scripts\activate
    python -m pip install -e ".[dev]"
    python -m keymaster

## How to use

**Cut plane.** With on-plane handles enabled, drag the orange center sphere or outer frame to translate, and drag the normal arrow to rotate. Use the handle-mode control to restrict editing to Move only or Rotate only. Plane updates occur after releasing the mouse to avoid native callback conflicts. Toggle Show interactive plane handles off to use the original slider and numeric fields as a fallback. Drag the 3D plane widget's handle to move it and rotate its normal. The plane becomes **Free** when manipulated directly; the X/Y/Z presets restore axis-aligned cutting. The highlighted orange intersection line shows the mesh region touched by the plane. Live movement updates the guide, not the expensive manifold Boolean. **Detect detachable sections** performs a deliberate analysis and lists positive-side connected solids. Uncheck sections to keep their original connection to the retained body. The opposite normal can be obtained by rotating the widget. A face gap is allowed only when all detected sections are detached; selective detachment with unselected sections uses zero face gap.

**Key settings.** Choose a resin or FDM clearance preset, or select Custom to enter independent radial and axial tolerances. U and V describe local cut-plane positions. **Auto-place** finds a spaced set of keys and, after section detection, scopes them to the first checked section. **Click to place** projects a selected visible point onto the plane. Connector types: round, square, tapered, and experimental snap/barbed latch. Snap hardware must be trial-printed on compliant FDM materials; it is not tested for resin and is not a structural joint. Existing keys retain their own settings.

**Preview and export.** Geometry generation is deliberate and can take time on dense sculpts. Changing the plane or key list invalidates the prior export. A full cut produces two parts; selective analysis may produce additional independently detached parts. The Parts panel separates them in the viewport; exports retain original assembly coordinates. Existing files are never silently overwritten. Press Ctrl+O to import, Ctrl+G to preview, Ctrl+E to export, or F to frame the model.

**Fit warning.** Clearances are in millimeters and depend on printer, resin/filament, orientation and post-processing. Test on a small sample before printing a large sculpture. Automated edge checks sample the footprint; they are not a complete structural or engineering strength analysis.

## Updates and settings

Keymaster checks the GitHub Releases feed when it opens, about every five minutes while running, and after window activation when a suitable interval has elapsed. It uses conditional requests, enforces a single outstanding request and applies basic rate-limit backoff. Failures do not imply the app is current.

The preview only **notifies** about a newer release and opens that release's page at your request. It never downloads, installs, or restarts automatically. Integrated verified download/install/rollback is **not implemented yet** and is not advertised as complete.

Window geometry is saved under the user's application configuration directory. Nothing is intentionally stored in the extracted executable folder.

## Troubleshooting

- **Import rejected:** Alpha 2 corrected the STL topology import issue; Alpha 3 corrected the UI initialization issue. Alpha 4 retains both fixes. Genuinely open, inverted, or self-intersecting meshes may still require repair.
- **Key does not fit:** Reduce diameter and/or margin, or reposition the key to a wider portion of the cut face.
- **Unusable viewport or plane click crash:** Try a version newer than alpha 1. Alpha 2 separates VTK mouse callbacks from scene modifications. As an immediate workaround, turn off **Show interactive plane handles** and use the axis/position slider. For graphic instability, update the GPU driver. Real mouse/GPU validation remains outstanding.
- **Only one detachable section:** Positive-side regions are still connected across this cut. Rotate/move the plane until the intended limbs are separate, then analyze again.
- **Too many keys or snap fit fails:** Reduce key count/size and verify real-material clearance and compliance on a test print. Experimental snap connectors are not guaranteed to engage.
- **Export refused:** Existing files are never replaced. Choose another output folder.
- **Update check failed:** Internet access or GitHub's API may be temporarily unavailable. Use the releases page manually.

## Development

See [AGENTS.md](AGENTS.md) and [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md) before modifying the project.

Source map: `src/keymaster/geometry.py` contains cutting and key operations; `src/keymaster/app.py` contains the Qt and 3D viewport; `src/keymaster/updates.py` only checks releases; tests live under `tests/`; packaging and repository checks are under `scripts/` and `.github/workflows/`.

    python -m pip install -e ".[dev]"
    python -m pytest -q
    python scripts/check_root.py --self-test
    python -m compileall -q src scripts tests

A Windows CI job builds the portable ZIP with PyInstaller using explicit VTK renderer imports, an original icon embedded at compile time, and only the required PySide6 distributions rather than the entire Qt metapackage. It verifies the file presence and produces SHA256SUMS.txt. The release archive size is measured; the size reduction is only claimed when verified against Alpha 3. A successful CI job does not replace hands-on testing on a real Windows computer.

This project has no license file. Public visibility alone does not grant redistribution rights beyond what applicable law permits.
