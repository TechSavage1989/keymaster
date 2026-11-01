# Roadmap

Each item is meant to be one focused pull request with tests. Work roughly top to bottom.

## Done in 1.0

- Single-file browser app with live stencil-capped cut preview.
- Cut plane controls with no modes: an arrow to slide, rings or a drag on the plane to tilt, and a toolbar under the view with typed position, X/Y/Z angles, align, flip, straighten and area chips. Every setting fits on one screen without scrolling (1280×800 and up), and warnings sit by the Cut button.
- Unlimited cuts with a parts list, undo and redo, rename, hide, exploded view.
- Pegs (round, square, tapered), dowels with printable pins, magnet pockets. Auto-placement, manual add, drag and remove.
- Seven key shapes: round, square, hexagon, cross, oval, slot and a one-way D-shape, with an even fit gap on every side. Shaped keys line up with each area's long side, with an adjustable turn.
- Key checks for edge distance, wall thickness, socket breakthrough and overlap.
- Leave selected areas of a cut face joined.
- Area labels in the view: click a label to leave that area joined or cut it again, hover to match an area to its row.
- Hole filling, inside-out repair, quarter turns, scaling, printer bed fit check.
- ZIP export of binary STLs.
- Adjustable peg taper on every shape, from straight to a point (cone or pyramid), with a matching or straight hole. The fit gap is kept at right angles to sloping walls.
- Cut suggestions: narrow points (wrists, ankles, necks), seams and panel lines, and separate pieces, found from the model's shape, shown as lettered pins and a list. Picking a narrow point cuts just that limb.
- Tested on real figure sculpts (130k to 190k triangles): about 1,700 cuts per sweep, every part sealed. Handles overlapping inner solids, loose specks, microscopic folds and voids.

## Next

1. **Curved cuts along the model's own contours.** The owner chose curved cuts that follow a line, and wants Keymaster to find those lines itself: split the surface into regions by creases, normal changes and contours, the way ZBrush makes polygroups, and cut along a region border, such as an arm off at the sleeve hem. Planned in steps, each its own pull request: (a) show the detected surface regions; (b) a sealed curved cut along a chosen border; (c) keys on a curved cut face; (d) paint or adjust the cut line by hand.
2. **Limit the cut to a region.** Draw a circle or box on the plane so only what's inside is cut, even where the cut face is one connected area (take off a hand without slicing into a cape behind it).
3. **Per-area key settings.** Choose key type, size and count separately for each area of a cut face.
4. **Finer per-key control.** Size, shape and rotation for individual keys, chamfered socket entrances, and separate peg and socket depths.
5. **Locking joints.** Twist-lock (push in and turn) and dovetail slide-in keys that hold pieces together before gluing. Needs test prints from the owner to tune the fit.
6. **Snap-fit pegs.** Split-tip pegs with a barb that clicks into a groove in the socket. Needs test prints from the owner to tune the fit.
7. **Cuts in a background thread.** Move `KMCore` into a Web Worker so the screen never freezes on dense models. Show progress. `core.js` already has no dependencies, so it should move unchanged.
8. **Faster picking and display on huge meshes.** Use a bounding-volume hierarchy for clicks and a lighter display mesh above about 2 million triangles, keeping the full mesh for cutting.
9. **Save and reopen projects.** A `.keymaster` file holding the parts, names, colors and settings.
10. **Seam-hiding cut shapes.** Zigzag, stepped and dovetail cuts so seams are less visible and pieces can't slide.
11. **Hollowing and drain holes.** Shell a part to a chosen wall thickness, with drain holes placed for resin printing.
12. **Part labels.** Emboss a small part number on a hidden face of each piece.
13. **Split to fit the bed.** Suggest cuts that make every piece fit the printer bed.
14. **3MF export** with all parts in one file, already arranged.
15. **Measure tool.** Click two points to read a distance.

## Ideas to weigh later

- Print orientation hints for each piece.
- Desktop wrapper, if very large files need more memory than a browser allows.
