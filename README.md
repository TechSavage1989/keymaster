# Keymaster

Cut 3D-printable sculptures and figures into pieces, with keys that line the pieces up when you glue them.

Keymaster runs entirely in your browser at **https://keymaster.techsavage3d.com**. Open the page, drop in an STL or OBJ, and nothing is installed or uploaded.

## What it does

- **Live cut preview.** Drag the arrow to slide the cut, and the blue rings or the plane itself to tilt it (Shift for 5° steps or fine control). The toolbar under the view takes an exact position and X, Y and Z angles. Everything fits on one screen, with no scrolling. The cut face appears as a hatched section while you drag, even on dense sculpts.
- **Cut as many times as you need.** Every piece lands in the parts list and can be cut again. Undo and redo cover every step.
- **Keys that fit.** Choose pegs (tapered by any amount, right down to a point, with a hole that matches or stays straight), dowel holes with printable pins, or magnet pockets. Keys come in seven shapes: round, square, hexagon, cross, oval, slot, and a D-shape that only fits one way round. Shaped keys line up with each area's long side, and the fit gap is even all the way round. Keys are placed automatically, and you can click the cut face to add one, drag to move it, or right-click to remove it.
- **Suggested cuts.** Press **Find cut spots** and Keymaster looks for narrow points (wrists, ankles, necks), seams and panel lines, and separate pieces. Each one appears as a lettered pin on the model; click it to move the cut there.
- **Keys sized to fit.** By default each area gets the biggest key that fits, between the Largest and Smallest sizes you set, and never more than half the area's width. Choose **Resin** or **Filament** under Printer (with no part selected) for sizes, gaps and walls that print reliably; resin allows keys down to 1 mm for miniatures. Magnets use standard disc sizes.
- **Customise any key.** Click a key to give it its own shape, size, length, gap, taper or turn. The other keys keep the general settings.
- **Surface regions.** The regions button above the view colours the model by where its surface turns sharply, like ZBrush polygroups. Click a border line that goes all the way round, such as a sleeve hem, and **Cut along this line** splits the part along it with a curved, sealed cut face, with keys from your key settings (a line that bends too far out of flat is cut without keys).
- **Checked before you cut.** Each key is tested for thin walls and for sockets that would break through the surface. Problem keys turn red and explain why.
- **Every piece prints and goes together.** Keymaster won't make a cut that leaves a sliver thinner than your printer's wall (1.2 mm on filament, 0.8 mm on resin), and says which area is too thin, with a button to leave it joined. It also refuses cuts whose pieces would hook round each other or get caught inside one another, or that would only crack the part without separating it.
- **Leave areas joined.** When a cut crosses several separate areas, each gets a label in the view. Click a label (or untick the area in the side panel) to keep that area attached, and click it again to cut it.
- **Model tools.** Fill holes, fix inside-out models, turn the model a quarter turn, scale it (including inches to millimeters), and see which parts fit your printer bed.
- **Export.** Every part is saved as its own STL, bundled in one ZIP.

## Using it

1. Open the app and choose **Open STL or OBJ**, or drop a file onto the view. **Try the sample** loads a knot to experiment with.
2. Click a part to select it. The cut plane appears through its middle.
3. Drag the arrow to slide the plane and a ring to tilt it, type exact values, or use **Align X/Y/Z** and **To view**. **Flip** swaps the solid and clear halves.
4. Pick a key type and size. Choose a fit: Snug (0.1 mm per side), Standard (0.2 mm), or Loose (0.3 mm).
5. Press **Cut part** or Enter. Repeat on any piece.
6. Press **Export parts** to save everything.

Shortcuts: Enter cut, Esc done, X/Y/Z align, F frame, Delete remove key, Ctrl+Z undo, Ctrl+Shift+Z redo.

**Before printing a large piece, print a small test cut.** The right fit depends on your printer, material, orientation and post-processing.

The version shows beside the name at the top left (for example **v1.14 · 2c6ad6**). After an update, refresh the page: if the label changed, the new version is live.

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
