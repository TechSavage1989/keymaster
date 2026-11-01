# Keymaster

Cut 3D-printable sculptures and figures into pieces, with keys that line the pieces up when you glue them.

Keymaster runs entirely in your browser at **https://keymaster.techsavage3d.com**. Open the page, drop in an STL or OBJ, and nothing is installed or uploaded.

## What it does

- **Live cut preview.** Drag the arrow to slide the cut, or switch to Tilt and drag a ring to angle it. The cut face appears as a hatched section while you drag, even on dense sculpts.
- **Cut as many times as you need.** Every piece lands in the parts list and can be cut again. Undo and redo cover every step.
- **Keys that fit.** Choose pegs (tapered by any amount, right down to a point, with a hole that matches or stays straight), dowel holes with printable pins, or magnet pockets. Keys come in seven shapes: round, square, hexagon, cross, oval, slot, and a D-shape that only fits one way round. Shaped keys line up with each area's long side, and the fit gap is even all the way round. Keys are placed automatically, and you can click the cut face to add one, drag to move it, or right-click to remove it.
- **Checked before you cut.** Each key is tested for thin walls and for sockets that would break through the surface. Problem keys turn red and explain why.
- **Leave areas joined.** When a cut crosses several separate areas, each gets a label in the view. Click a label (or untick the area in the side panel) to keep that area attached, and click it again to cut it.
- **Model tools.** Fill holes, fix inside-out models, turn the model a quarter turn, scale it (including inches to millimeters), and see which parts fit your printer bed.
- **Export.** Every part is saved as its own STL, bundled in one ZIP.

## Using it

1. Open the app and choose **Open STL or OBJ**, or drop a file onto the view. **Try the sample** loads a knot to experiment with.
2. Click a part to select it. The cut plane appears through its middle.
3. Slide or tilt the plane, or use **Align X/Y/Z** and **To view**. **Flip** swaps the solid and clear halves.
4. Pick a key type and size. Choose a fit: Snug (0.1 mm per side), Standard (0.2 mm), or Loose (0.3 mm).
5. Press **Cut part** or Enter. Repeat on any piece.
6. Press **Export parts** to save everything.

Shortcuts: Enter cut, Esc done, W slide, E tilt, X/Y/Z align, F frame, Delete remove key, Ctrl+Z undo, Ctrl+Shift+Z redo.

**Before printing a large piece, print a small test cut.** The right fit depends on your printer, material, orientation and post-processing.

## Running it yourself

The whole app is the single file `index.html`. To host it free on GitHub Pages: open the repository's **Settings**, then **Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The app will be live at `https://<your-username>.github.io/keymaster/`.

## Development

Source lives in `src/`. After changing anything there, rebuild and test:

```
python3 tools/build.py      # writes index.html and tests/test.html
node tests/core.test.js     # geometry tests
python3 tests/ui_test.py    # interface tests (pip install playwright, then python -m playwright install chromium)
```

GitHub Actions runs all three on every pull request. See `CLAUDE.md` for architecture and the rules every change must keep, and `ROADMAP.md` for what's next.

## History

The original Python desktop preview is kept at the `v0.2.0-alpha.2` tag.

This project has no license file yet. Until the owner adds one, the code is all rights reserved.
