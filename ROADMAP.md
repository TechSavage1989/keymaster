# Roadmap

Each item is meant to be one focused pull request with tests. Work roughly top to bottom.

## Done in 1.0

- Single-file browser app with live stencil-capped cut preview.
- Slide and tilt gizmo, align to X/Y/Z or the view, flip, position slider.
- Unlimited cuts with a parts list, undo and redo, rename, hide, exploded view.
- Pegs (round, square, tapered), dowels with printable pins, magnet pockets. Auto-placement, manual add, drag and remove.
- Key checks for edge distance, wall thickness, socket breakthrough and overlap.
- Leave selected areas of a cut face joined.
- Area labels in the view: click a label to leave that area joined or cut it again, hover to match an area to its row.
- Hole filling, inside-out repair, quarter turns, scaling, printer bed fit check.
- ZIP export of binary STLs.

## Next

1. **More key shapes.** Hexagon, cross or star, oval and slot, plus one-way shapes (D-shape, notched peg) so a piece only goes on facing the right way.
2. **Confirm on real sculpts.** Test with three or four real figure files (dense ZBrush exports, files with separate shells, files with small defects) and fix whatever comes up. Record timings in the PR.
3. **Limit the cut to a region.** Draw a circle or box on the plane so only what's inside is cut, even where the cut face is one connected area (take off a hand without slicing into a cape behind it).
4. **Per-area key settings.** Choose key type, size and count separately for each area of a cut face.
5. **Finer per-key control.** Size, shape and rotation for individual keys, chamfered socket entrances, and separate peg and socket depths.
6. **Locking joints.** Twist-lock (push in and turn) and dovetail slide-in keys that hold pieces together before gluing. Needs test prints from the owner to tune the fit.
7. **Snap-fit pegs.** Split-tip pegs with a barb that clicks into a groove in the socket. Needs test prints from the owner to tune the fit.
8. **Cuts in a background thread.** Move `KMCore` into a Web Worker so the screen never freezes on dense models. Show progress. `core.js` already has no dependencies, so it should move unchanged.
9. **Faster picking and display on huge meshes.** Use a bounding-volume hierarchy for clicks and a lighter display mesh above about 2 million triangles, keeping the full mesh for cutting.
10. **Save and reopen projects.** A `.keymaster` file holding the parts, names, colors and settings.
11. **Seam-hiding cut shapes.** Zigzag, stepped and dovetail cuts so seams are less visible and pieces can't slide.
12. **Hollowing and drain holes.** Shell a part to a chosen wall thickness, with drain holes placed for resin printing.
13. **Part labels.** Emboss a small part number on a hidden face of each piece.
14. **Split to fit the bed.** Suggest cuts that make every piece fit the printer bed.
15. **3MF export** with all parts in one file, already arranged.
16. **Measure tool.** Click two points to read a distance.

## Ideas to weigh later

- Freeform cuts along a drawn path, such as a collar line or hairline.
- Print orientation hints for each piece.
- Desktop wrapper, if very large files need more memory than a browser allows.
