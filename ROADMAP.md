# Roadmap

Each item is meant to be one focused pull request with tests. Work roughly top to bottom.

## Done in 1.0

- Single-file browser app with live stencil-capped cut preview.
- Slide and tilt gizmo, align to X/Y/Z or the view, flip, position slider.
- Unlimited cuts with a parts list, undo and redo, rename, hide, exploded view.
- Pegs (round, square, tapered), dowels with printable pins, magnet pockets. Auto-placement, manual add, drag and remove.
- Seven key shapes: round, square, hexagon, cross, oval, slot and a one-way D-shape, with an even fit gap on every side. Shaped keys line up with each area's long side, with an adjustable turn.
- Key checks for edge distance, wall thickness, socket breakthrough and overlap.
- Leave selected areas of a cut face joined.
- Area labels in the view: click a label to leave that area joined or cut it again, hover to match an area to its row.
- Hole filling, inside-out repair, quarter turns, scaling, printer bed fit check.
- ZIP export of binary STLs.
- Adjustable peg taper on every shape, from straight to a point (cone or pyramid), with a matching or straight hole. The fit gap is kept at right angles to sloping walls.
- Tested on real figure sculpts (130k to 190k triangles): about 1,700 cuts per sweep, every part sealed. Handles overlapping inner solids, loose specks, microscopic folds and voids.

## Next

1. **Easier slide and tilt, with exact angles.** Clearer handles, a rotation dial or rings like 3D apps, and typed angles around each axis for precise tilts.
2. **Cut suggestions from the model's shape.** Detect natural break points (narrow necks such as wrists and ankles, separate parts, sharp creases and panel lines) and offer them as one-click cut positions.
3. **Paint a cut.** Brush along the surface to mark where the seam should go, and cut there.
4. **Limit the cut to a region.** Draw a circle or box on the plane so only what's inside is cut, even where the cut face is one connected area (take off a hand without slicing into a cape behind it).
5. **Per-area key settings.** Choose key type, size and count separately for each area of a cut face.
6. **Finer per-key control.** Size, shape and rotation for individual keys, chamfered socket entrances, and separate peg and socket depths.
7. **Locking joints.** Twist-lock (push in and turn) and dovetail slide-in keys that hold pieces together before gluing. Needs test prints from the owner to tune the fit.
8. **Snap-fit pegs.** Split-tip pegs with a barb that clicks into a groove in the socket. Needs test prints from the owner to tune the fit.
9. **Cuts in a background thread.** Move `KMCore` into a Web Worker so the screen never freezes on dense models. Show progress. `core.js` already has no dependencies, so it should move unchanged.
10. **Faster picking and display on huge meshes.** Use a bounding-volume hierarchy for clicks and a lighter display mesh above about 2 million triangles, keeping the full mesh for cutting.
11. **Save and reopen projects.** A `.keymaster` file holding the parts, names, colors and settings.
12. **Seam-hiding cut shapes.** Zigzag, stepped and dovetail cuts so seams are less visible and pieces can't slide.
13. **Hollowing and drain holes.** Shell a part to a chosen wall thickness, with drain holes placed for resin printing.
14. **Part labels.** Emboss a small part number on a hidden face of each piece.
15. **Split to fit the bed.** Suggest cuts that make every piece fit the printer bed.
16. **3MF export** with all parts in one file, already arranged.
17. **Measure tool.** Click two points to read a distance.

## Ideas to weigh later

- Print orientation hints for each piece.
- Desktop wrapper, if very large files need more memory than a browser allows.
