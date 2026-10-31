# Keymaster read-first development instructions

Read this file and DEVELOPMENT_HANDOFF.md before any edits.

## Product boundary
- Windows-first portable desktop application for splitting STL/OBJ sculptures, figures, and 3D-printable models.
- Current preview: one X/Y/Z planar cut, round or square integral alignment pegs and sockets with user-selected clearance, preview and STL export.
- Preserve source geometry. Edits must not be applied to imported files in place.
- Reject unsupported/non-manifold geometry rather than silently exporting corrupt shapes.
- STL stores triangle-corner vertices independently. Import with topology processing to consolidate shared coordinates before validation; do not disable integrity checks to work around this.
- Preserve user settings and a stable executable filename: Keymaster.exe.
- The UI is viewport-first: compact rail for Model/Cut/Keys/Parts, contextual inspector, drag-and-drop load, cut position slider and printer-fit presets. Maintain current UI tests and preserve camera orientation during plane edits.
- Trim release dependencies carefully; no blanket VTK/PyVista collect-all without justification. PyInstaller must still bundle VTK OpenGL, Qt viewport, geometry engine and a compile-time embedded ICO resource. Compare release archive size to previous baseline.
- Trimesh bounds are (2, 3) for minimum and maximum XYZ: axis values use bounds[:, axis], bounding-box center uses bounds.mean(axis=0); include a real UI import regression test.
- The 0.2 alpha 2 development fix addresses a real user-reported crash when clicking the native plane widget. Use end-of-interaction events and defer any VTK scene edits through PlaneInteractionBridge; no synchronous VTK modifications inside the callback, including actor removals or rep.BuildRepresentation. Keep the on-plane move center/frame and rotate arrow controls and the handles-disable fallback.
- The 0.2 alpha 1 baseline includes connected-component-aware selective separation via segmentation.py, a VTK plane widget for free-angle manipulation, studio shading, auto connector placement and face tolerances. Do not confuse selective detachable components with arbitrary painted mesh regions. Snap connector is experimental and not guaranteed to function mechanically.
- Do not claim production-grade placement, remeshing, model repair, 3MF support, multicut history or automatic updater installation unless implemented and tested.

## Code map
- src/keymaster/geometry.py: mesh validation, plane basis, CSG, key placement and STL output.
- src/keymaster/segmentation.py: candidate detection and selective rejoining of unselected cut components.
- src/keymaster/app.py: Qt desktop interface and 3D viewport.
- src/keymaster/plane_interaction.py: deferred native widget pose bridge, with a Qt timer. Never update VTK actors or widget representation in a native VTK mouse callback.
- scripts/smoke_plane_widget.py: Windows offscreen real Qt/VTK widget lifecycle smoke. Distinguish this from manual mouse/GPU acceptance testing.
- src/keymaster/theme.py: flat dark Qt stylesheet and drawn tool icons.
- scripts/generate_icon.py: source for the original Windows ICO asset generated before compilation.
- src/keymaster/updates.py: read-only GitHub Releases polling.
- src/keymaster/__main__.py and scripts/launch.py: executable entry points.
- tests/: geometry regression tests.
- scripts/: build entry and repository validation.
- .github/workflows/: CI and release automation.
- docs/releases/: historical notes, with a current concise handoff at repository root.

## Required checks
1. python -m pip install -e ".[dev]"
2. python -m pytest -q
3. python scripts/check_root.py --self-test
4. python -m compileall -q src scripts tests
5. Verify actual Windows zip layout, EXE launch and model export on a native target before declaring production readiness.
6. Review changes for secrets, private files, unwanted binary output, unsafe dependencies and correct release assets.

Tracked root files are restricted to README.md, AGENTS.md, DEVELOPMENT_HANDOFF.md, pyproject.toml and .gitignore. Standard folders: .github/, src/, tests/, scripts/, docs/. The root guard checks these and supports extracted archives without .git. Amend the allowlist only after reviewing the real toolchain need.

## Release and publication rules
- Treat the supplied October 31, 2026 task approvals as applying only to the initial Keymaster alpha change set, not future work.
- Never change repository visibility, invent a license, embed secrets or overrule GitHub protections.
- Create a PR and merge only after required checks/reviews pass.
- A release may only be triggered by an explicitly approved, specially marked merge commit after all CI jobs pass.
- No unconditional automatic publishing on ordinary commits.
- User consent is required to download/install/restart any software update. Never perform it automatically.
- Keep README and DEVELOPMENT_HANDOFF.md synchronized with changed user-facing behavior.
