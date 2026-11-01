# Keymaster

A browser app that cuts 3D-printable sculptures and figures into pieces and adds alignment keys (pegs, dowel holes, magnet pockets) so the pieces line up when glued. Users are artists and hobbyists, not engineers. The bar is "feels like a polished tool," not "technically works."

## Layout

- `src/core.js`: geometry engine. Pure JavaScript, **no dependencies, no DOM, no three.js**. Parsing, welding, plane sections, capping, keys, connected components, STL and ZIP writing.
- `src/app.js`: the interface. three.js r147 (UMD builds from jsDelivr), viewport, cut gizmo, live preview, parts list, inspector, undo, export.
- `src/template.html`: markup and all CSS.
- `tools/build.py`: inlines `core.js` and `app.js` into `template.html` to produce `index.html` (the shipped single file) and `tests/test.html`.
- `tests/core.test.js`: geometry tests (Node). `tests/ui_test.py`: interface tests (Playwright, using `tests/mock-three.js` as a three.js stand-in).
- `tools/sculpt_check.js`: sweeps hundreds of cuts through real model files and reports any part that isn't sealed.

## Commands

```
node tests/core.test.js        # geometry
python3 tools/build.py         # rebuild index.html after any change in src/
python3 tests/ui_test.py       # interface (needs: pip install playwright && python -m playwright install chromium)
```

Always rebuild and commit `index.html` with any `src/` change. CI fails if it is stale.

## Rules that must not break

1. **Every exported part is a closed, correctly oriented solid.** Any change to cutting, capping, keys or repair needs a test in `core.test.js` that checks `edgeReport(...).closed` and positive volume, plus a volume-conservation check where it applies.
2. **Units are millimeters** everywhere. Clearances are per side.
3. **`core.js` stays dependency-free** so it can move into a Web Worker unchanged.
4. **Models never leave the browser.** No uploads, analytics, or network calls besides the pinned script and font CDNs.
5. The published page has a strict content policy: scripts only from cdnjs, `cdn.jsdelivr.net/npm`, `cdn.tailwindcss.com` and `code.jquery.com`, pinned to exact versions at least two weeks old. No other network requests.
6. File saving goes through the `downloads` capability when present (ZIP only; STL alone is not an allowed extension there), with a plain link fallback.

## How the cut works (read before touching `cutMesh`)

The plane is a frame `{o, n, u, v}` with `u × v = n`. Key positions are 2D `(x, y)` in that frame, which is the same as the cut plane object's local space in the app. `computeSection` nudges the plane by a tiny amount if any vertex sits on it, chains crossing segments into loops, and `buildRegions` nests loops into areas (outer plus holes). Each side gets its own copy of the section vertices; caps are triangulated with the built-in earcut and then `fixTJunctions` re-inserts any ring points earcut dropped, so cap edges always match the side walls. Skipped areas leave their crossing triangles whole, which is how "leave this area joined" works. Shells the cut never touched (eyes, inner voids) are merged into the piece that contains them.

**Real sculpts are messy, so the cap has several safety layers** (each found on real figure files, each with a test):
- `prepareMesh` drops loose specks (`removeSpecks`: shells under 0.001 mm³ and 0.5 mm, such as a triangle stored back to back with itself).
- `buildSection` moves the plane, by a few microns at most, to the middle of the widest gap among nearby vertices, so no section points crowd together beyond float32 precision.
- `buildRegions` nests by direction, not just depth. An opposite-running loop inside an outline is a hole. A same-running one is an overlapping inner solid (`nested`: its own cap, an obstacle for keys, never keyed). A lone backwards loop is a void speck (`inverted`: capped facing the other way, never shown or keyed).
- `untangledRing` snips microscopic self-crossing folds out of the outline before earcut. Microscopic holes skip earcut entirely.
- `fixTJunctions`, `splitThroughPoints` and `patchCap` then make the cap meet every ring edge exactly. `patchCap` orients by topology, because the leftovers are often zero-width slivers.
- `cutMesh` checks that every part is closed and, if not, retries a hundredth of a millimetre or so either side (`cutOnce`). If every retry fails it throws a plain-language error rather than export an open part.

Before merging any change to sectioning, capping or keys, run `node tools/sculpt_check.js <model files>` on real sculpts as well as the tests. Never commit model files; they are usually someone else's work. `tests/fixtures/sculpt-outlines.json` holds just a few 2D cut outlines that once failed.

Key outlines come from `keyProfile(shape, r, d, angle, res)`. A socket is the peg outline grown by the clearance `d` (never scaled), and the vertex count depends only on `shape` and `res`, so tapered top and bottom rings pair up. **Every key shape must be star-shaped around its centre**: the cap fans and the wall orientation in `cutMesh` and `makePin` rely on it, and `core.test.js` checks it. Fit checks for non-round shapes use `footprintClear`, which follows the real outline. `splitThroughPoints` repairs cap edges that earcut runs straight past ring points, which happens when straight socket sides line up.

## Interface conventions

- Copy: sentence case, plain verbs, say what a button does ("Cut part", "Export parts"). Errors say what happened and how to fix it, without apologizing.
- Yellow (`--cut`, `#F2B705`) means cutting: the hatched section face and the cut button. Do not use it for anything else.
- Font: Barlow with tabular numbers. Colors come from CSS variables with light and dark values.
- Each part gets a muted filament-like color from `PALETTE`. Pins are grey.
- Keyboard: Enter cut, Esc done, W slide, E tilt, X/Y/Z align, F frame, Delete remove key, Ctrl+Z / Ctrl+Shift+Z.

## Working style

- Small, focused pull requests, one roadmap item each, with tests.
- When a change is visual, describe what to look at in the PR so the owner can check it on the live page.
- See `ROADMAP.md` for what's next.
