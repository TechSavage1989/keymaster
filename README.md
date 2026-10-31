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

- Import an STL or OBJ model and inspect it in a rotatable 3D viewport.
- Cut along an adjustable X, Y or Z plane.
- Add round or square integrated pegs with matching recessed sockets.
- Set diameter, insertion depth, radial fit clearance, extra socket depth and minimum edge margin per key.
- Manually enter key positions in the cut plane, click a model to project a point, or suggest a cut-face location.
- Generate both solid parts and inspect an exploded preview.
- Export two STL files without overwriting previous exports.
- Reject open/inverted meshes, keys outside the cut face, and overlapping keys.

**Preview limitations:** One cutting plane per operation. Work with an exported piece again to create further cuts. Only integrated round and square keys are supported. STL/OBJ imports lose materials. Models must already be scaled in millimeters. Complex or self-intersecting sculpt meshes may require repair before they can be processed. Automatic placement is a suggestion, not a mechanical fit guarantee.

## Download

Look for a **prerelease** build at the [GitHub releases page](https://github.com/TechSavage1989/keymaster/releases). The primary portable asset, when published, is named **Keymaster_Windows_Portable.zip**. Do not assume a build is published just because source exists.

This project begins with no production-tested stable release.

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
5. Choose the plane axis and coordinate; add one or more keys and set the desired fit.
6. Select **Generate cut + keys**, inspect both pieces, then choose **Export both STL pieces**.

To run directly from source:

    python -m venv .venv
    .venv\Scripts\activate
    python -m pip install -e ".[dev]"
    python -m keymaster

## How to use

**Cut plane.** X, Y, or Z sets the plane normal in model coordinates. The coordinate is its position in model units. Both pieces are capped along that plane. The negative side gets protruding pegs, while the positive side gets matching recessed sockets.

**Key settings.** U and V describe positions on the cutting plane, relative to the model's bounding-box center projected onto that plane. Set the peg diameter, insertion depth, radial clearance on each side, extra socket depth, minimum edge margin, and round/square shape before adding a key. Each added key retains its own settings. Click **Auto place** for a suggested location, or **Pick on model** to project a visible clicked location onto the plane. Click **Remove selected key** to delete an existing key.

**Preview and export.** Generate is a deliberate operation for performance. Changing the plane or key list invalidates the prior export. The exploded preview is for inspection only: the exported pieces keep their original assembly coordinates. The app refuses to silently replace STL files already present in the destination.

**Fit warning.** Clearances are in millimeters and depend on printer, resin/filament, orientation and post-processing. Test on a small sample before printing a large sculpture. Automated edge checks sample the footprint; they are not a complete structural or engineering strength analysis.

## Updates and settings

Keymaster checks the GitHub Releases feed when it opens, about every five minutes while running, and after window activation when a suitable interval has elapsed. It uses conditional requests, enforces a single outstanding request and applies basic rate-limit backoff. Failures do not imply the app is current.

The preview only **notifies** about a newer release and opens that release's page at your request. It never downloads, installs, or restarts automatically. Integrated verified download/install/rollback is **not implemented yet** and is not advertised as complete.

Window geometry is saved under the user's application configuration directory. Nothing is intentionally stored in the extracted executable folder.

## Troubleshooting

- **Import rejected:** Repair the mesh so it is watertight, consistently oriented and positive-volume. Complex sculpt shells may need Boolean union or mesh repair in an external tool.
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

A Windows CI job builds the portable ZIP with PyInstaller, verifies the file presence and produces SHA256SUMS.txt. A successful CI job does not replace hands-on testing on a real Windows computer.

This project has no license file. Public visibility alone does not grant redistribution rights beyond what applicable law permits.
