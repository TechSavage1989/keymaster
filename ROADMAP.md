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
- Individually configurable keys: click a key to give it its own shape, size, length, gap, taper and turn, checked and cut at its own size.
- A version label beside the name (from 1.14), so a refresh shows whether an update is live.
- Keys on curved cuts, sized to fit like flat ones; lines that bend too far are cut without keys.
- Curved cuts along a border: with surface regions showing, click a border line that goes all the way round and cut along it, with sealed curved faces.
- Surface regions: colour a model by where its surface turns sharply, like ZBrush polygroups, with an adjustable threshold.
- Keys sized to fit each area by default, within printable limits for resin or filament (keys down to 1 mm on resin), with standard magnet sizes. Tested on 25 to 40 mm miniatures.
- Tested on real figure sculpts (130k to 190k triangles): about 1,700 cuts per sweep, every part sealed. Handles overlapping inner solids, loose specks, microscopic folds and voids.
- Seam editing (1.34): any picked line becomes handles you drag along the surface, with Smooth and snap to region borders, and the pick follows.
- Reduce detail (1.38): a lighter model within 0.02 to 0.1 mm of the original, so dense sculpts paint and cut faster; one undo step.
- Engraved joint numbers (1.37): Number the joints engraves the same number on both faces of each cut, clear of the keys, so the pieces of a big kit pair up; roadmap item 12.
- Inlay cut (1.36): any painted, picked or drawn area becomes a pocket in the body and a matching inlay pulled in by the fit, with a flat floor to print on, for details in another colour.
- Split to fit the bed (1.35): straight cuts across X, Y and Z worked out from the printer's bed size (or set by count), shown in the view, movable, then all cut at once with keys; roadmap item 13.
- Cut at a spot (1.33): click where the cut should go round and Keymaster finds the narrowest cut through that spot for the piece it frees, puts the cut plane there and cuts just that piece.
- Suggested cuts judged by what they free (1.32): narrow points and joins (shoulders, hips, a head under hair) scored by the piece they free and how narrow the cut is for it, each cutting only the areas that free the piece; regions to split off along their outline (an arm, a head, a backpack) suggested too; pins on thumbs, base edges and slices through both legs gone.
- Models with gaps or tangles are repaired as they open (1.31), so region picks and cuts on them work straight away.
- Faster painting, faces by default, explode along the cuts (1.30): a dab updates only the faces it touched, letting go shows the outline at once and the cut runs on Split off painted area; Show faces is the default view; the exploded view moves each piece along the cut that made it.
- Keys sized to the model (1.29): the Largest key follows the model's size when it's opened or scaled (5 mm on a miniature, 15 mm on a 300 mm figure) until set by hand.
- Plugs on the right piece (1.28): on curved cuts the plug or pegs stand on the piece being split off ("This piece" / "Other piece"), plugs on awkward outlines are made shallower instead of refused, key markers show through the model, and several drawn lines cut together.
- Brush polish (1.27): the brush shows as a circle on the surface and starts at a size to suit the model; faces show while painting (and **Show faces** in the view tools any time); turn and scale buttons stay over the view.
- Paint an area to split off (1.26): a brush paints faces like a Meshmixer or ZBrush selection, with grow, shrink, tidy and erase; the painted area always splits off, with the usual keys, plug and sinking.
- Sunk cut faces (1.25): the face across a curved cut is pushed into the other piece with a wall down from the line, as deep as that piece can hold, so the split-off piece keeps its thickness to the edge and seats into a recess.
- Cut lines drawn by hand (1.24): click points on the part and the line runs between them along the surface, then cuts like any border line, with keys or a plug.
- Shift-click picks (1.23): several regions split off as one piece, or several lines cut at once, with a line that doesn't free anything saying to add another.
- Cut anyway (1.22): the too-thin and hooked refusals can be overridden, on flat cuts and region splits, with the warning kept. A line that doesn't free a piece says to click the region beside it instead.
- Smooth curved cut faces (1.21): the face across a curved cut is drawn as a fine grid that follows the line, with the same points on both pieces, instead of a few big facets between the line's own points.
- Regions mode chooses the part first (1.20): a click on a part selects it and shows its key settings; the next click picks a region; settings changes re-run the pick.
- Repair surface (1.19): untangles edges shared by three or more faces, pinch vertices, flipped patches, duplicate faces and slivers, then fills holes, so exports like Ox Bellows (148 tangled edges) can be cut.
- Split off a region (1.18): click any region and it's cut along its whole outline at once, like splitting a group in ZBrush; regions on organic sculpts now follow inward folds, so arms, legs, hands and garments come out as their own regions.
- Plug joints (1.17): the cut face itself, pulled in by the wall, as a plug into a matching pocket, as deep as fits, with sloping sides. On flat and curved cuts.
- Keys on bent curved cuts (1.16): the cut face follows the line, keys stand straight on it at their full length, and each is checked for solid under it.
- Printable, assemblable cuts (1.15): no piece thinner than the printer's wall, no pieces that hook together or get caged, no cuts that only crack the part. Curved cut lines are straightened and capped flat, so their faces no longer fold into tiny teeth.

## Next

1. **Curved cuts along the model's own contours.** The owner chose curved cuts that follow a line, and wants Keymaster to find those lines itself: split the surface into regions by creases, normal changes and contours, the way ZBrush makes polygroups, and cut along a region border, such as an arm off at the sleeve hem. Planned in steps, each its own pull request: (a) show the detected surface regions (done: splits at sharp turns, which suits hard-surface models); (a2) also split organic sculpts by concave folds (done; thickness changes still to try); (b) a sealed curved cut along a chosen border (done: click a border line while regions show); (c) keys on a curved cut face (done, on a face that follows the line however it bends); (d) draw the cut line by hand (done: click points, the line follows the surface between them) or paint the area with a brush (done); (e) split off a region along its whole outline (done).
2. **Curved cuts through hollowed models.** A curved cut only cuts the outer surface; an inner void shell the cap passes through should be cut by the cap too (a hollowed figure's cavity spans both pieces). Today such a cut is refused as a dip.
3. **Limit the cut to a region.** Draw a circle or box on the plane so only what's inside is cut, even where the cut face is one connected area (take off a hand without slicing into a cape behind it).
4. **Per-area key settings.** Choose key type, size and count separately for each area of a cut face.
5. **Locking joints.** Twist-lock (push in and turn) and dovetail slide-in keys that hold pieces together before gluing. Needs test prints from the owner to tune the fit.
6. **Snap-fit pegs.** Split-tip pegs with a barb that clicks into a groove in the socket. Needs test prints from the owner to tune the fit.
7. **Cuts in a background thread.** Move `KMCore` into a Web Worker so the screen never freezes on dense models. Show progress. `core.js` already has no dependencies, so it should move unchanged.
8. **Faster picking and display on huge meshes.** Use a bounding-volume hierarchy for clicks and a lighter display mesh above about 2 million triangles, keeping the full mesh for cutting.
9. **Save and reopen projects.** A `.keymaster` file holding the parts, names, colors and settings.
10. **Seam-hiding cut shapes.** Zigzag, stepped and dovetail cuts so seams are less visible and pieces can't slide.
11. **Hollowing and drain holes.** Shell a part to a chosen wall thickness, with drain holes placed for resin printing.
14. **3MF export** with all parts in one file, already arranged.
15. **Measure tool.** Click two points to read a distance.

## Ideas to weigh later

- Print orientation hints for each piece.
- Desktop wrapper, if very large files need more memory than a browser allows.
