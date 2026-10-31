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
- Cut along an adjustable X, Y or Z plane.
- Add round or square integrated pegs with matching recessed sockets.
- Set diameter, insertion depth, radial fit clearance, extra socket depth and minimum edge margin per key.
- Apply resin/FDM fit presets or adjust clearance manually; presets are suggested starting points, not guaranteed printer fits.
- See translucent key markers before generating the closed cut geometry.
- Manually enter key positions in the cut plane, click a model to project a point, or suggest a cut-face location.
- Generate both solid parts, manage their visibility, and inspect an exploded preview.
- Keep orbit/zoom position when moving the plane; very dense models use a display-only simplified mesh, with exact original geometry retained for cutting.
- Export two STL files without overwriting previous exports.
- Reject open/inverted meshes, keys outside the cut face, and overlapping keys.

**Preview limitations:** One cutting plane per operation. Work with an exported piece again to create further cuts. Only integrated round and square keys are supported. STL/OBJ imports lose materials. Models must already be scaled in millimeters. Complex or self-intersecting sculpt meshes may require repair before they can be processed. Automatic placement is a suggestion, not a mechanical fit guarantee.

## Download

Look for a **prerelease** build at the [GitHub releases page](https://github.com/TechSavage1989/keymaster/releases). The primary portable asset, when published, is named **Keymaster_Windows_Portable.zip**. Do not assume a build is published just because source exists.

The current preview is **0.1.0 alpha 4**. There is no production-tested stable release. Alpha 4 modernizes the interface and reduces unnecessary bundled components; prior STL import and UI fixes remain included.

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
5. Use the **Cut** panel to select an X/Y/Z axis and move the position slider or enter a precise coordinate.
6. Use the **Keys** panel to choose a fit preset and place keys by clicking on the model, automatic suggestion, or manual U/V coordinates.
7. Select **Preview cut**, inspect the parts and exploded view in **Parts**, then choose **Export STL**.

To run directly from source:

    python -m venv .venv
    .venv\Scripts\activate
    python -m pip install -e ".[dev]"
    python -m keymaster

## How to use

**Cut plane.** X, Y, or Z sets the plane normal in model coordinates. Move the slider or enter its coordinate; this immediately updates only the visual plane. Choose **Preview cut** when ready to run the more expensive geometry operation. Both pieces are capped along that plane. The negative side gets protruding pegs, while the positive side gets matching recessed sockets.

**Key settings.** Choose a resin or FDM clearance preset, or select Custom to enter your own radial and axial clearances. U and V describe positions on the cutting plane relative to the model's projected bounding-box center; expand **Manual location** to enter them precisely. Click **Click to place** to project a visible point onto the plane, **Suggest** for a proposed location, or **Add at U / V** for manual entry. Existing keys retain their own settings. Click **Remove selected key** to delete a key.

**Preview and export.** Geometry generation is deliberate and can take time on dense sculpts. Changing the plane or key list invalidates the prior export. The Parts panel can hide each generated half and adjust separation. The exploded preview is for inspection only: exported pieces keep their original assembly coordinates. Existing output files are never silently overwritten. Press Ctrl+O to import, Ctrl+G to preview, Ctrl+E to export, or F to frame the model.

**Fit warning.** Clearances are in millimeters and depend on printer, resin/filament, orientation and post-processing. Test on a small sample before printing a large sculpture. Automated edge checks sample the footprint; they are not a complete structural or engineering strength analysis.

## Updates and settings

Keymaster checks the GitHub Releases feed when it opens, about every five minutes while running, and after window activation when a suitable interval has elapsed. It uses conditional requests, enforces a single outstanding request and applies basic rate-limit backoff. Failures do not imply the app is current.

The preview only **notifies** about a newer release and opens that release's page at your request. It never downloads, installs, or restarts automatically. Integrated verified download/install/rollback is **not implemented yet** and is not advertised as complete.

Window geometry is saved under the user's application configuration directory. Nothing is intentionally stored in the extracted executable folder.

## Troubleshooting

- **Import rejected:** Alpha 2 corrected the STL topology import issue; Alpha 3 corrected the UI initialization issue. Alpha 4 retains both fixes. Genuinely open, inverted, or self-intersecting meshes may still require repair.
- **Key does not fit:** Reduce diameter and/or margin, or reposition the key to a wider portion of the cut face.
- **Unusable viewport:** Update the graphics driver or run on a system with supported OpenGL.
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
