# Keymaster read-first development instructions

Read this file and DEVELOPMENT_HANDOFF.md before any edits.

## Product boundary
- Windows-first portable desktop application for splitting STL/OBJ sculptures, figures, and 3D-printable models.
- Current preview: one X/Y/Z planar cut, round or square integral alignment pegs and sockets with user-selected clearance, preview and STL export.
- Preserve source geometry. Edits must not be applied to imported files in place.
- Reject unsupported/non-manifold geometry rather than silently exporting corrupt shapes.
- Preserve user settings and a stable executable filename: Keymaster.exe.
- Do not claim advanced automatic placement, remeshing, model repair, 3MF support, multicut history or automatic updater installation unless implemented and tested.

## Code map
- src/keymaster/geometry.py: mesh validation, plane basis, CSG, key placement and STL output.
- src/keymaster/app.py: Qt desktop interface and 3D viewport.
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
