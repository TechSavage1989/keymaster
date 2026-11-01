# Keymaster

A browser app that cuts 3D-printable sculptures and figures into pieces and adds alignment keys (pegs, dowel holes, magnet pockets) so the pieces line up when glued. Users are artists and hobbyists, not engineers. The bar is "feels like a polished tool," not "technically works."

## Layout

- `src/core.js`: geometry engine. Pure JavaScript, **no dependencies, no DOM, no three.js**. Parsing, welding, plane sections, capping, keys, connected components, STL and ZIP writing.
- `src/app.js`: the interface. three.js r147 (UMD builds from jsDelivr), viewport, cut gizmo, live preview, parts list, inspector, undo, export.
- `src/template.html`: markup and all CSS.
- `tools/build.py`: inlines `core.js` and `app.js` into `template.html` to produce `index.html` (the shipped single file) and `tests/test.html`.
- `tests/core.test.js`: geometry tests (Node). `tests/ui_test.py`: interface tests (Playwright, using `tests/mock-three.js` as a three.js stand-in).

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
