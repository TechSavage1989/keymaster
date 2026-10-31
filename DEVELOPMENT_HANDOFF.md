# Keymaster development handoff

## Baseline
- App: Keymaster, Windows-first portable GUI.
- Version/source: 0.1.0a3 on development/keymaster-alpha3-import-ui, to be merged after checks. Previous published preview: v0.1.0-alpha.2. Preserve all earlier releases.
- Repository: https://github.com/TechSavage1989/keymaster (public at task start).
- Default branch: main. Original commit was 29b7c7baf0bfe9955d8c6146425104d5d197cbf8 with only README.md.
- No previous app, existing icon, license, binary releases, or stable user-confirmed build existed at baseline.
- Update feed: GitHub Releases API at /repos/TechSavage1989/keymaster/releases.
- Stable application name: Keymaster.exe inside the portable Keymaster folder.

## Implementation
- Geometry: triangle mesh input, manifold3d-based plane split, rounded/square keyed CSG, sampled guard perimeter / overlapping keys rejection, export of two closed STL solids.
- Alpha 2 import fix: STL loading now consolidates shared vertex records before validation. OBJ loading behavior remains unchanged. A valid STL from a repaired sculpture previously appeared non-watertight because alpha 1 loaded triangle vertices unprocessed.
- Reproduction with the user-supplied Mewtwo STL (not committed): 131,408 faces, alpha 1 reports 394,224 split vertices and rejects it; processed input has 65,703 vertices, a single watertight component, consistent winding and positive volume. Import acceptance verified locally with Trimesh. Full Keymaster cutting and native Windows interaction have not been tested on that model.
- UI: PySide6 and PyVistaQt for model display, cut-axis/coordinate, per-key settings, manual/picked/auto placement, exploded view and export.
- Alpha 3 bug fix: Trimesh bounds are shape (2, 3). Alpha 2 wrongly used bounds[2], bounds[axis], and bounds.mean(axis=1) in the GUI. After successful STL validation this raised an uncaught IndexError in the Qt slot, leaving "No model loaded". Alpha 3 fixes all three coordinate calculations, suppresses premature signals while initializing the mesh, and makes errors in preview rendering visible.
- Alpha 3 UI regression: headless Qt tests use a fake viewport to exercise importing an actual STL from a file dialog, label updates, generated 3D plane, axis/coordinate changes, and failure messages on both Linux and Windows CI.
- Updater: read-only notification and a browser link. Explicit update installation/rollback has not been implemented.
- Persistence: QSettings INI under QStandardPaths.AppConfigLocation, user scope, separate from the EXE.

## Rebuild and validate
Commands from the repository root:

    python -m pip install -e ".[dev]"
    python -m pytest -q
    python scripts/check_root.py --self-test
    python -m compileall -q src scripts tests
    python -m keymaster

Windows packaging is defined in .github/workflows/ci.yml using Python 3.12 and PyInstaller on windows-latest. Archive format: one Keymaster/ folder with Keymaster.exe inside, plus SHA256SUMS.txt alongside the uploaded ZIP.

## Explicit limitations
- One cut per export, axis-aligned cutting only, round/square keys only.
- No automatic geometry repair, thickness/strength checks, threaded large-mesh processing, or sophisticated packing.
- STL and OBJ only; material/color preservation is not supported; model units are assumed to be mm.
- Automatic placement searches cut triangles and does not fully guarantee wall strength or fit.
- Native Windows GUI, graphics, installer and real printer validation are pending until independently performed.
- Auto update download, hash-verified installation, rollback and restart are not implemented, and must not be misrepresented.
- Windows security signing is not configured; no binary signing claim.
- No license file was present at baseline; do not invent licensing permissions.

## Organization
Root allowlist: README.md, AGENTS.md, DEVELOPMENT_HANDOFF.md, pyproject.toml, .gitignore. Standard directories: .github/, src/, tests/, scripts/, docs/. The scripts/check_root.py guard works both in a Git checkout and a source archive, ignoring documented generated files. Any new root file requires reviewed allowlist expansion.

## Task approvals (history, not standing authorization)
On October 31, 2026, the user explicitly approved source/tests/build assets/documentation upload, public-source publication to this named repository, PR creation and ready-for-review, merge after checks, and tagging/asset release/publication for the initial task. The user subsequently approved publishing the alpha 2 STL import correction, and explicitly requested the alpha 3 import UI fix and release. Each approval applies only to its named change. No standing consent for future releases; CI, repository protections and reviews remain binding.

## Next tasks
1. Verify GitHub hosted CI, alpha 3 tag, release ZIP and checksum, then complete native Windows UI smoke testing using the Mewtwo STL.
2. Smoke test a real sculpt mesh in the native application and verify printed fit.
3. Implement secure user-consented download/install/rollback updater with release manifest and digest verification.
4. Improve cut-plane gizmo, manual key manipulation, non-blocking processing, and robust per-piece multi-cut project history.
