<h1 align="center">Keymaster</h1>
<p align="center">Cut 3D-printable sculptures and figures into pieces, with keys that line the pieces up when you glue them.</p>

<p align="center">
  <a href="https://keymaster.techsavage3d.com">Open the app</a> ·
  <a href="#getting-started">Get started</a> ·
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="docs/images/hero.png" alt="Keymaster main window" width="900">
</p>

## Features

- **Sculpt.** Smooth, inflate (or, with Shift, push in) and flatten the surface with a brush, in any size and strength. Each stroke is one undo step, and a painted area keeps the brush inside it.
- **Boolean.** Join a shape to the model, cut it out, or keep only where they overlap: a base under a figure, a socket for a magnet, a slice off a side, a figure trimmed to a box. The result is sealed and ready to cut, in one undo step.
- **Shapes.** Add a cube, ball, tube, cone or ring with sharp, chamfered or rounded edges, size it, turn it and place it with handles or numbers. A shape is a part like any other: cut it, export it, or join it to the model with Boolean.
- **Make room.** Drag the edge of either side panel to resize it (double-click puts it back), and press ? for the list of mouse and keyboard shortcuts.
- **Look from any side, light or dark.** A View from list turns the view to the front, back, a side, the top or the bottom of the part, and a sun button in the top bar switches between light and dark.
- **Your printer, in one pick.** Choose a common printer (Bambu Lab, Prusa, Creality, Elegoo, Anycubic, Phrozen, Formlabs) and the bed size and the filament or resin settings follow; or type your own size. **Start over** brings the model back as it was opened, in one undoable step.
- **One row of cut tools.** Plane, Regions, Paint, Draw, Suggest and Fit bed sit in a row at the top of the right panel, each with its own controls under it; the Joints section folds to a one-line summary when a tool needs the room, and the one yellow button at the foot always does what the tool is ready to do.
- **Live cut preview.** Drag the arrow to slide the cut, and the blue rings or the plane itself to tilt it (Shift for 5° steps or fine control). The toolbar under the view takes an exact position and X, Y and Z angles. Everything fits on one screen, with no scrolling. The cut face appears as a hatched section while you drag, even on dense sculpts.
- **Cut as many times as you need.** Every piece lands in the parts list and can be cut again. Undo and redo cover every step.
- **Keys that fit.** Choose pegs (tapered by any amount, right down to a point, with a hole that matches or stays straight), dowel holes with printable pins, or magnet pockets. Keys come in seven shapes: round, square, hexagon, cross, oval, slot, and a D-shape that only fits one way round. Shaped keys line up with each area's long side, and the fit gap is even all the way round. Keys are placed automatically, and you can click the cut face to add one, drag to move it, or right-click to remove it.
- **Brush modes.** Surface follows connected faces; Sphere reaches layers behind, for clothing over a body; Fill paints a whole region with a click; Snap to borders lands a rough stroke on the regions' edges; [ and ] size the brush.
- **Isolate.** Paint the area you want to work in and press Isolate: the rest of the model leaves the screen and stops catching the brush and clicks, so you can paint a cut on a layered sculpt without touching what's behind it.
- **Projects and export.** Save a project with every part, its joints and your settings, and open it later to carry on. Export the parts as STLs in a ZIP, as one 3MF, or as STLs with an assembly sheet that shows a picture of each piece, the pieces spread apart, and which pieces each joint pairs.
- **Reduce detail.** A dense sculpt can be lightened to a fraction of its triangles while the surface stays within 0.02 mm, so it paints and cuts faster. One undo step puts the detail back.
- **Numbered joints.** Tick Number the joints and every cut engraves the same number on both of its faces, out of the way of the keys, so a kit of many pieces goes together without guessing.
- **Inlay cut.** Paint round an eye, a gem or a badge, choose a depth and a fit, and Keymaster cuts the pocket and the matching inlay, with a flat base to print on, so the detail prints in another colour and presses back into place.
- **Move a seam.** Nudge any picked line in or out along the surface by a distance, or replace it with a flat cut through its plane that cuts only that area.
- **Edit a seam.** Any picked line can be turned into handles: drag one along the surface and the line follows, smooth it, and it snaps to region borders.
- **Split to fit the bed.** Too big for your printer? Keymaster works out the straight cuts across X, Y and Z that make every piece fit, shows them on the model, lets you move them or set the counts, and cuts them all at once with keys.
- **Cut across the view.** Drag a straight line across the model on screen and the cut goes through it, straight into the view, the quickest way to place a flat cut.
- **Suggested cuts.** Press **Find cut spots** and Keymaster looks for natural places to cut: narrow points (wrists, ankles, necks), where a limb or an accessory joins the body, surface regions to split off along their outline (an arm, a head, a backpack), seams and panel lines, and separate pieces. Each is judged by the piece it frees and how narrow the cut is, says what it frees, and appears as a lettered pin on the model; click it to put the cut there. Or press **Cut at a spot** and click where the cut should go round: Keymaster finds the narrowest cut through that spot and cuts just the piece it frees.
- **Keys sized to fit.** By default each area gets the biggest key that fits, between the Largest and Smallest sizes you set, and never more than half the area's width. Choose **Resin** or **Filament** under Printer (with no part selected) for sizes, gaps and walls that print reliably; resin allows keys down to 1 mm for miniatures. Magnets use standard disc sizes.
- **Plugs.** Choose **Plug** and each area of the cut face gets a plug of its own shape: the face itself, pulled in from the edge by the wall, standing out into a matching pocket in the other piece, the way professional kits join large parts. It goes as deep as fits (up to 10 mm), or a depth you set, with gently sloping sides so it seats easily. Works on flat and curved cuts.
- **Cuts that print and go together, unless you say otherwise.** Keymaster refuses a cut that would leave a piece thinner than your printer's wall, or pieces that hook round each other, and says why. If you know better, **Cut anyway** makes the cut against the warning.
- **Customise any key.** Click a key to give it its own shape, size, length, gap, taper or turn. The other keys keep the general settings.
- **Always at hand.** Turn and scale buttons sit over the view whatever you're doing, and **Show faces** in the view tools shows the mesh's faces instead of a smoothed surface.
- **Parts by form.** Regions find the figure's parts by the thickness of the solid under the surface: a head, each arm and leg, a torso, a weapon, each its own region, outlined and ready to split off with one click, with a slider for how different two parts must be. **Folds** is still there for cloth, collars and cuffs.
- **Surface regions.** The regions button above the view outlines the model's parts, by form or, with Folds, split where the surface folds inward (cloth meeting skin, collars, belts, cuffs), like ZBrush polygroups; the part keeps its own colour, the region under the pointer lifts a shade, and a picked region shows in the cut colour. Every piece a cut makes gets a colour of its own. **Click a region**, such as an arm or a hat, and **Split off this region** cuts along its whole outline, however many lines that is, giving sealed pieces with keys or a plug on every cut face. Or click a dark border line that goes all the way round, such as a sleeve hem, and **Cut along this line** cuts there alone. **Shift-click** adds more: several regions come off as one piece (a face, hair and collar as one head), and several lines are cut together (a wrist and where the hand meets what it holds). **Paint an area** with a brush, the way you'd select faces in Meshmixer or ZBrush (the circle on the surface is the brush, faces show while you paint), grow, shrink or tidy it, and **Split off painted area**; a painted area always comes off. **Draw a cut line** and click points on the part to draw your own line along the surface. The cut face is **sunk** into the bigger piece by a millimetre (your choice, 0 turns it off), with a wall down from the line, so the piece you split off keeps its thickness right to its edge and seats into a matching recess, the way kit parts do. Keys go on however much the line bends: each one stands straight on the curved face, sticks its full length into the other piece from the highest point of its base, and is checked for solid under it so it can't snap off. The cut face itself is drawn as a fine, smooth surface that follows the line, not a few big facets, so curved joints look as clean as flat ones.
- **Checked before you cut.** Each key is tested for thin walls and for sockets that would break through the surface. Problem keys turn red and explain why.
- **Every piece prints and goes together.** Keymaster won't make a cut that leaves a sliver thinner than your printer's wall (1.2 mm on filament, 0.8 mm on resin), and says which area is too thin, with a button to leave it joined. It also refuses cuts whose pieces would hook round each other or get caught inside one another, or that would only crack the part without separating it.
- **Leave areas joined.** When a cut crosses several separate areas, each gets a label in the view. Click a label (or untick the area in the side panel) to keep that area attached, and click it again to cut it.
- **Model tools.** Repair a tangled surface (faces stored twice, parts welded along a seam, patches facing the wrong way, loose slivers, holes), fix inside-out models, turn the model a quarter turn, scale it (including inches to millimeters), and see which parts fit your printer bed.
- **Export.** Every part is saved as its own STL, bundled in one ZIP.

## Screenshots

### Cutting and keys

<table>
<tr><td width="50%" valign="top"><b>Plugs: each area of the cut face stands out into a matching pocket</b><br><img src="docs/images/plugs.png" alt="Plugs: each area of the cut face stands out into a matching pocket" width="440"></td><td width="50%" valign="top"><b>Customise any key: one key turned into a hexagon dowel</b><br><img src="docs/images/customise-a-key.png" alt="Customise any key: one key turned into a hexagon dowel" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>Checked before you cut: a cut that would leave a sliver is held back, with Cut anyway</b><br><img src="docs/images/too-thin-warning.png" alt="Checked before you cut: a cut that would leave a sliver is held back, with Cut anyway" width="440"></td><td width="50%" valign="top"><b>Cut pieces with their joints, spread apart in the exploded view</b><br><img src="docs/images/exploded-parts.png" alt="Cut pieces with their joints, spread apart in the exploded view" width="440"></td></tr>
</table>

### Suggested cuts

<table>
<tr><td width="50%" valign="top"><b>Suggest: lettered pins and a list of what each cut frees</b><br><img src="docs/images/suggested-cuts.png" alt="Suggest: lettered pins and a list of what each cut frees" width="440"></td><td width="50%" valign="top"><b>Cut at a spot: the narrowest cut through a clicked point</b><br><img src="docs/images/cut-at-a-spot.png" alt="Cut at a spot: the narrowest cut through a clicked point" width="440"></td></tr>
</table>

### Surface regions and curved cuts

<table>
<tr><td width="50%" valign="top"><b>Surface regions: click the head to split it off along its outline, with a peg</b><br><img src="docs/images/surface-regions.png" alt="Surface regions: click the head to split it off along its outline, with a peg" width="440"></td><td width="50%" valign="top"><b>Shift-click adds the neck, so both regions come off as one piece</b><br><img src="docs/images/regions-shift-click.png" alt="Shift-click adds the neck, so both regions come off as one piece" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>Draw a cut line: clicked points joined along the surface, keys on the curved face</b><br><img src="docs/images/drawn-cut-line.png" alt="Draw a cut line: clicked points joined along the surface, keys on the curved face" width="440"></td><td width="50%" valign="top"><b>Edit a seam: the picked line turned into handles to drag and smooth</b><br><img src="docs/images/seam-edit.png" alt="Edit a seam: the picked line turned into handles to drag and smooth" width="440"></td></tr>
</table>

### Painting and inlays

<table>
<tr><td width="50%" valign="top"><b>Paint an area with the brush, then split off the painted area</b><br><img src="docs/images/painted-area.png" alt="Paint an area with the brush, then split off the painted area" width="440"></td><td width="50%" valign="top"><b>Inlay cut: a pocket in the head and the matching inlay, to print in another colour</b><br><img src="docs/images/inlay-cut.png" alt="Inlay cut: a pocket in the head and the matching inlay, to print in another colour" width="440"></td></tr>
</table>

### Numbered joints, export and assembly

<table>
<tr><td width="50%" valign="top"><b>Number the joints: ticked in the Joints section before a cut</b><br><img src="docs/images/number-the-joints.png" alt="Number the joints: ticked in the Joints section before a cut" width="440"></td><td width="50%" valign="top"><b>The joint number engraved on the cut face</b><br><img src="docs/images/numbered-joints.png" alt="The joint number engraved on the cut face" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>STLs + assembly sheet: a picture of each part, the pieces spread apart, and the parts each joint pairs</b><br><img src="docs/images/assembly-sheet.png" alt="STLs + assembly sheet: a picture of each part, the pieces spread apart, and the parts each joint pairs" width="440"></td><td width="50%" valign="top"><b>Split to fit the bed: the straight cuts that make every piece fit your printer</b><br><img src="docs/images/split-to-fit-bed.png" alt="Split to fit the bed: the straight cuts that make every piece fit your printer" width="440"></td></tr>
</table>

### Model tools

<table>
<tr><td width="50%" valign="top"><b>Shapes: a rounded cube added as a base under the pawn, sized and placed from the panel</b><br><img src="docs/images/shapes-cube.png" alt="Shapes: a rounded cube added as a base under the pawn, sized and placed from the panel" width="440"></td><td width="50%" valign="top"><b>A ring on top, with the handles set to turn it</b><br><img src="docs/images/shapes-ring.png" alt="A ring on top, with the handles set to turn it" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>Sculpt: an Inflate stroke raising a bump on the pawn's head</b><br><img src="docs/images/sculpt-inflate.png" alt="Sculpt: an Inflate stroke raising a bump on the pawn's head" width="440"></td><td width="50%" valign="top"><b>Flatten pressing the side of the pawn's base flat</b><br><img src="docs/images/sculpt-flatten.png" alt="Flatten pressing the side of the pawn's base flat" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>Boolean: a ball placed against the pawn's head, ready to be cut out</b><br><img src="docs/images/boolean-tool.png" alt="Boolean: a ball placed against the pawn's head, ready to be cut out" width="440"></td><td width="50%" valign="top"><b>The ball cut out: a sealed hollow in the head, in one undo step</b><br><img src="docs/images/boolean-cut.png" alt="The ball cut out: a sealed hollow in the head, in one undo step" width="440"></td></tr>
<tr><td width="50%" valign="top"><b>Repair: a tangled model is untangled as it opens</b><br><img src="docs/images/repair-surface.png" alt="Repair: a tangled model is untangled as it opens" width="440"></td><td width="50%" valign="top"><b>Reduce detail: the pawn at an eighth of its triangles, still within 0.1 mm</b><br><img src="docs/images/reduce-detail.png" alt="Reduce detail: the pawn at an eighth of its triangles, still within 0.1 mm" width="440"></td></tr>
</table>

## Getting started

Keymaster runs entirely in your browser at **https://keymaster.techsavage3d.com**. Open the page, drop in an STL or OBJ, and nothing is installed or uploaded.

1. Open the app and choose **Open STL or OBJ**, or drop a file onto the view. **Try the sample** loads a knot to experiment with.
2. Click a part to select it. The cut plane appears through its middle.
3. Drag the arrow to slide the plane and a ring to tilt it, type exact values, or use **Align X/Y/Z** and **To view**. **Flip** swaps the solid and clear halves.
4. Pick a key type and size. Choose a fit: Snug (0.1 mm per side), Standard (0.2 mm), or Loose (0.3 mm).
5. Press **Cut part** or Enter. Repeat on any piece.
6. Press **Export parts** to save everything.

## How to use

Shortcuts: Enter cut, Esc done, X/Y/Z align, F frame, Delete remove key, Ctrl+Z undo, Ctrl+Shift+Z redo.

**Before printing a large piece, print a small test cut.** The right fit depends on your printer, material, orientation and post-processing.

## Running it yourself

The whole app is the single file `index.html`. To host it free on GitHub Pages: open the repository's **Settings**, then **Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The app will be live at `https://<your-username>.github.io/keymaster/`.

## Updates and settings

The version shows beside the name at the top left (for example **v1.14 · 2c6ad6**). After an update, refresh the page: if the label changed, the new version is live.

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
