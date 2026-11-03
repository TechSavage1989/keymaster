(() => {
  'use strict';
  const K = KMCore;
  const $ = (s, el = document) => el.querySelector(s);
  const PALETTE = ['#CFC8BD', '#8FB096', '#8DA2C0', '#C98F86', '#A99CC6', '#79AFB0', '#C6AE8F', '#B5BB7C', '#D2A1B8', '#9AA3AB'];
  const PIN_COLOR = '#B8BCC2';
  const PREFS_KEY = 'keymaster.prefs.v1';
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICONS = {
    eye: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>',
    eyeOff: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/><path d="M3 17L17 3" stroke="currentColor" stroke-width="1.6"/></svg>',
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l8.5 15h-17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4.2M10 14.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    cut: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 12h16" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><path d="M5 9V4h10v5M5 15v1h10v-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };

  /* ---------------- state ---------------- */
  const state = {
    model: null,
    parts: [],
    selectedId: null,
    hidden: new Set(),
    explode: 0,
    wire: false,
    flat: true, // show faces: flat shading, so every face of the mesh shows (the owner wants this by default)
    nextColor: 1,
    bed: { w: 220, d: 220, h: 250 },
    cfg: { type: 'peg', shape: 'round', diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper: 0, taperSocket: true, sizeMode: 'auto', sizeMin: 2.5, printer: 'fdm', pegSide: 'below', perArea: 2, align: true, turn: 0, plugSlope: 5, plugDepthMode: 'auto', plugDepth: 5, sink: 1, numberJoints: false },
    cut: { keys: [], plugs: [], auto: true, skip: new Set(), thin: [], hoverArea: -1, labels: [], analysis: null, evals: [], active: -1, stale: true, lo: -1, hi: 1, center: [0, 0, 0], R: 1 },
  };
  state.regions = { on: false, angle: 60, fold: 15 };
  state.tool = 'plane'; // the cut tool in the right panel: plane, regions, paint, draw, suggest or bed; or shape (editing the model)
  state.shapeMode = 'move'; // what the gizmo does to a chosen shape: move, turn or size
  state.bool = { shapeId: null, op: 'difference' }; // the Boolean tool: which shape works on the chosen part, and how
  state.ui = { model: null, joints: null }; // which panel sections are open; null means it follows the tool (open with the plane, folded for the rest)
  state.here = { on: false };
  state.across = { on: false }; // Cut across the view: the next drag on the screen is a line the cut plane goes through
  state.joint = 1; // the next joint number to engrave, when Number the joints is on
  state.cutId = 0; // every cut gets an id, so the assembly sheet can pair the pieces it made
  state.reduce = 0.02; // Reduce detail: the surface may move this far (mm)
  state.split = { planes: null, counts: [null, null, null] }; // split to fit the bed: the planned planes ({axis, pos}), and counts set by hand // Cut at a spot: the next click on the part finds the narrowest cut through it
  state.draw = { on: false, points: [] }; // a cut line drawn by hand: points clicked on the chosen part
  state.edit = null; // the picked lines as draggable handles: { partId, loops: [{ pts, base }], smooth, snap }
  state.paint = { on: false, partId: null, sel: null, erase: false, size: 3, sized: false, iso: null, mode: 'surface', fill: false }; // a painted selection to split off, like a face selection in Meshmixer; iso: the triangles shown while the rest is hidden
  const history = { past: [], future: [] };
  let uid = 1;
  let downloads = null;

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved && saved.cfg) Object.assign(state.cfg, saved.cfg);
    if (saved && saved.bed) Object.assign(state.bed, saved.bed);
    if (saved && typeof saved.bedPreset === 'string') state.bedPreset = saved.bedPreset;
  } catch (e) { /* storage unavailable */ }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ cfg: state.cfg, bed: state.bed, bedPreset: state.bedPreset || '' })); } catch (e) { /* ignore */ } }
  // Common printers and the build volumes their makers quote (width × depth × height, mm), as a shortcut for the
  // bed size and the printer type; the owner's own printer is "Custom size".
  const BED_PRESETS = [
    ['Filament (FDM)', [
      ['Bambu Lab A1 mini', 180, 180, 180], ['Bambu Lab A1, P1P, P1S, X1C', 256, 256, 256],
      ['Prusa MINI', 180, 180, 180], ['Prusa MK3S, MK4, MK4S', 250, 210, 220], ['Prusa XL', 360, 360, 360],
      ['Creality Ender 3 family', 220, 220, 250], ['Creality K1', 220, 220, 250], ['Creality K1 Max', 300, 300, 300],
      ['Elegoo Neptune 4', 225, 225, 265], ['Anycubic Kobra 2', 220, 220, 250]]],
    ['Resin', [
      ['Elegoo Mars 4 Ultra, Mars 5 Ultra', 153, 78, 165], ['Elegoo Saturn 3 Ultra', 219, 123, 260], ['Elegoo Saturn 4 Ultra', 219, 123, 220],
      ['Anycubic Photon Mono 4 Ultra', 153, 87, 165], ['Anycubic Photon Mono M5s', 218, 123, 200],
      ['Phrozen Sonic Mini 8K', 165, 72, 180], ['Phrozen Sonic Mighty 8K', 218, 123, 235],
      ['Formlabs Form 3', 145, 145, 185], ['Formlabs Form 4', 200, 125, 210]]],
  ];
  function bedPresetHTML() {
    const cur = state.bedPreset || '';
    return `<select id="bedPreset" class="sel" aria-label="Printer" title="Pick your printer to set the bed size and the printer type; the sizes are the makers' quoted build volumes, so check yours">
      <option value="" ${cur ? '' : 'selected'}>Custom size</option>
      ${BED_PRESETS.map(([group, list]) => `<optgroup label="${group}">${list.map(([name, w, d, h]) => `<option value="${esc(name)}" ${name === cur ? 'selected' : ''}>${esc(name)} (${w} × ${d} × ${h} mm)</option>`).join('')}</optgroup>`).join('')}
    </select>`;
  }
  function applyBedPreset(name) {
    state.bedPreset = name || '';
    for (const [group, list] of BED_PRESETS) for (const [n, w, d, h] of list) if (n === name) {
      state.bed = { w, d, h };
      const type = group === 'Resin' ? 'resin' : 'fdm';
      if (state.cfg.printer !== type) { const pr = K.PRINTERS[type]; state.cfg.printer = type; state.cfg.sizeMin = pr.min; state.cfg.clearance = pr.gap; state.cfg.margin = pr.wall; }
      toast(`${n}: a ${w} × ${d} × ${h} mm bed, set up for ${type === 'resin' ? 'resin' : 'filament'}.`);
    }
    savePrefs(); renderParts(); renderInspector();
  }

  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(d => { downloads = d; }).catch(() => { downloads = null; });
  }

  function makePart({ name, color, positions, indices, kind, pull, joints, shape }) {
    return { id: uid++, name, color, positions, indices, bbox: K.bounds(positions), tris: indices.length / 3, volume: K.volume(positions, indices), kind: kind || 'part', pull: pull || null, joints: joints || [], shape: shape || null };
  }
  // The joints a cut made, kept on each piece for the assembly sheet: { id, type, keys, number }
  function jointOf(p, extra) { return [...(p.joints || []), { id: ++state.cutId, ...extra }]; }
  const selectedPart = () => state.parts.find(p => p.id === state.selectedId) || null;
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
  const fmtInt = (n) => n.toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function nextColor() { const c = PALETTE[state.nextColor % PALETTE.length]; state.nextColor++; return c; }
  function fitsBed(p) {
    const d = p.bbox.size.slice().sort((a, b) => a - b);
    const b = [state.bed.w, state.bed.d, state.bed.h].sort((a, b) => a - b);
    return d[0] <= b[0] && d[1] <= b[1] && d[2] <= b[2];
  }

  /* ---------------- three.js setup ---------------- */
  const stage = $('#stage');
  if (typeof THREE === 'undefined' || !THREE.OrbitControls || !THREE.TransformControls) {
    $('#fatal').hidden = false;
    return;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  stage.prepend(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '3D view of the model');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(160, -260, 150);
  const orbit = new THREE.OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5f66, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  const fillLight = new THREE.DirectionalLight(0xe4ecff, 0.32);
  const rimLight = new THREE.DirectionalLight(0xfff4e0, 0.28);
  scene.add(keyLight, fillLight, rimLight);
  function placeLights(c, R) {
    keyLight.position.set(c[0] + R * 1.2, c[1] - R * 1.6, c[2] + R * 2.2);
    fillLight.position.set(c[0] - R * 2, c[1] + R * 0.6, c[2] + R * 0.4);
    rimLight.position.set(c[0] + R * 0.4, c[1] + R * 2.2, c[2] + R * 1.2);
  }
  placeLights([0, 0, 0], 100);

  let grid = null;
  function updateGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    if (!state.parts.length) return;
    const b = modelBounds();
    const span = Math.max(b.size[0], b.size[1]) * 1.8 + 40;
    const step = span > 600 ? 50 : 10;
    const size = Math.ceil(span / step) * step;
    grid = new THREE.GridHelper(size, size / step, 0x6f757c, 0x8e949a);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(b.center[0], b.center[1], b.min[2] - 0.01);
    grid.material.transparent = true; grid.material.opacity = 0.38; grid.material.depthWrite = false;
    scene.add(grid);
  }
  function modelBounds() {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of state.parts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.bbox.min[i]); mx[i] = Math.max(mx[i], p.bbox.max[i]); }
    return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] };
  }

  const partsGroup = new THREE.Group();
  scene.add(partsGroup);

  // cut plane rig
  const planeGroup = new THREE.Group();
  planeGroup.visible = false;
  scene.add(planeGroup);
  const hatch = makeHatch();
  const planeFrame = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.95 }));
  const planeSheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  const capMat = new THREE.MeshBasicMaterial({
    map: hatch, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  });
  const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMat);
  capMesh.renderOrder = 1.1;
  capMesh.onAfterRender = (r) => r.clearStencil();
  const regionGroup = new THREE.Group();
  const keyGroup = new THREE.Group();
  // Tilt rings: one turns the plane about its own x axis, the other about its y axis, like a 3D app's rotate tool.
  // They are drawn on top of everything so they can always be grabbed.
  const RING_COLOR = 0x3d7be0, RING_HOVER = 0x8fb8ff;
  const rings = { x: null, y: null };
  const ringGroup = new THREE.Group();
  for (const ax of ['x', 'y']) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: RING_COLOR, depthTest: false, transparent: true, opacity: 0.92 }));
    m.renderOrder = 7;
    rings[ax] = m;
    ringGroup.add(m);
  }
  // Tilt mode: drag anywhere on the plane to tip it like the edge of a tray. Grips mark the edges; the hinge
  // line shows what it pivots about while dragging.
  const gripGroup = new THREE.Group();
  const gripMat = new THREE.MeshBasicMaterial({ color: 0x2a2100 });
  const gripGeom = new THREE.SphereGeometry(1, 16, 12);
  for (let i = 0; i < 4; i++) { const g = new THREE.Mesh(gripGeom, gripMat); g.renderOrder = 6; gripGroup.add(g); }
  gripGroup.visible = false;
  const hinge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2a2100 }));
  hinge.visible = false; hinge.renderOrder = 6;
  planeGroup.add(planeSheet, planeFrame, capMesh, regionGroup, keyGroup, ringGroup, gripGroup, hinge);

  const clipBelow = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const clipAbove = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.24, depthWrite: false, roughness: 0.7, clippingPlanes: [clipAbove] });
  const preview = { ghost: null, stencil: null, partId: null };

  const tc = new THREE.TransformControls(camera, canvas);
  tc.setSpace('local');
  tc.setSize(0.95);
  scene.add(tc);

  function makeHatch() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#F2B705'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#A87700'; g.lineWidth = 3.2;
    for (let i = -64; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i - 64, 64); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function makeStencilGroup(geometry, plane) {
    const group = new THREE.Group();
    const base = new THREE.MeshBasicMaterial();
    base.depthWrite = false; base.depthTest = false; base.colorWrite = false;
    base.stencilWrite = true; base.stencilFunc = THREE.AlwaysStencilFunc;
    const back = base.clone(); back.side = THREE.BackSide; back.clippingPlanes = [plane];
    back.stencilFail = back.stencilZFail = back.stencilZPass = THREE.IncrementWrapStencilOp;
    const front = base.clone(); front.side = THREE.FrontSide; front.clippingPlanes = [plane];
    front.stencilFail = front.stencilZFail = front.stencilZPass = THREE.DecrementWrapStencilOp;
    const m0 = new THREE.Mesh(geometry, back); m0.renderOrder = 1;
    const m1 = new THREE.Mesh(geometry, front); m1.renderOrder = 1;
    group.add(m0, m1);
    return group;
  }

  /* ---------------- render loop ---------------- */
  let dirty = true;
  const anims = [];
  const markDirty = () => { dirty = true; };
  orbit.addEventListener('change', markDirty);
  tc.addEventListener('change', markDirty);
  function loop(now) {
    requestAnimationFrame(loop);
    const moved = orbit.update();
    if (anims.length) {
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        const k = Math.min(1, (now - a.t0) / a.dur);
        a.step(1 - Math.pow(1 - k, 3));
        if (k >= 1) anims.splice(i, 1);
      }
      dirty = true;
    }
    if (moved || dirty) { renderer.render(scene, camera); placeAreaTags(); placeSuggestPins(); dirty = false; }
  }
  function animate(dur, step) {
    if (reduceMotion) { step(1); markDirty(); return; }
    anims.push({ t0: performance.now(), dur, step });
  }
  new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    markDirty();
  }).observe(stage);
  requestAnimationFrame(loop);
  attachGizmo();

  /* ---------------- display meshes ---------------- */
  const views = new Map();
  function viewFor(p) {
    let v = views.get(p.id);
    if (v) return v;
    const arr = K.creasedArrays(p.positions, p.indices, 38);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr.pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(arr.nor, 3));
    geom.computeBoundingSphere(); geom.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.66, metalness: 0, wireframe: state.wire, flatShading: state.flat });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.partId = p.id;
    v = { geom, mesh, mat, offset: new THREE.Vector3() };
    views.set(p.id, v);
    return v;
  }
  function syncScene() {
    const ids = new Set(state.parts.map(p => p.id));
    for (const [id, v] of views) if (!ids.has(id)) { partsGroup.remove(v.mesh); v.geom.dispose(); v.mat.dispose(); views.delete(id); }
    for (const id of [...state.hidden]) if (!ids.has(id)) state.hidden.delete(id);
    if (state.selectedId && !ids.has(state.selectedId)) state.selectedId = null;
    for (const p of state.parts) {
      const v = viewFor(p);
      if (!v.mesh.parent) partsGroup.add(v.mesh);
      v.mesh.visible = !state.hidden.has(p.id);
      v.mat.color.set(p.color);
      v.mat.wireframe = state.wire;
      if (v.mat.flatShading !== state.flat) { v.mat.flatShading = state.flat; v.mat.needsUpdate = true; }
    }
    applyExplode();
    if (state.regions.on) applyRegions();
    updatePreview();
    updateGrid();
    renderParts();
    renderInspector();
    updateChrome();
    markDirty();
  }
  // The exploded view moves each piece along the cut that made it (its pull direction, away from the piece across
  // the cut), the way the pieces come apart; a piece with no cut of its own moves out from the middle.
  // Where a piece goes at explode amount k: along its pull by a quarter of the model's diagonal, plus how far its
  // middle already lies out that way, so pieces of a chain of cuts (a head, a neck, a body) open up between
  // themselves instead of travelling together; a piece with no pull moves out from the model's middle.
  function explodeOffset(p, k, b, D) {
    if (!p.pull) return p.bbox.center.map((x, i) => (x - b.center[i]) * k * 0.9);
    const out = Math.max(0, p.pull.reduce((s, x, i) => s + x * (p.bbox.center[i] - b.center[i]), 0));
    return p.pull.map(x => x * k * (0.25 * D + 0.9 * out));
  }
  function applyExplode() {
    const b = state.parts.length ? modelBounds() : null, D = b ? Math.hypot(...b.size) : 1;
    for (const p of state.parts) {
      const v = views.get(p.id);
      if (!v) continue;
      const k = state.selectedId ? 0 : state.explode, at = explodeOffset(p, k, b, D);
      v.mesh.position.set(at[0] + v.offset.x, at[1] + v.offset.y, at[2] + v.offset.z);
    }
    markDirty();
  }

  /* ---------------- cut preview ---------------- */
  function updatePreview() {
    if (preview.ghost) { scene.remove(preview.ghost); preview.ghost = null; }
    if (preview.stencil) { scene.remove(preview.stencil); preview.stencil.children.forEach(m => m.material.dispose()); preview.stencil = null; }
    for (const [id, v] of views) {
      const want = id === state.selectedId ? 1 : 0;
      const has = v.mat.clippingPlanes ? v.mat.clippingPlanes.length : 0;
      if (want !== has) { v.mat.clippingPlanes = want ? [clipBelow] : null; v.mat.needsUpdate = true; }
      v.mesh.renderOrder = want ? 2 : 0;
    }
    const p = selectedPart();
    if (!planeShown()) { // nothing to cut, or the surface regions or the bed planes are on show: no cut preview
      for (const v of views.values()) if (v.mat.clippingPlanes) { v.mat.clippingPlanes = null; v.mat.needsUpdate = true; }
      planeGroup.visible = false; if (tc.object === planeGroup) tc.detach(); preview.partId = null; return;
    }
    const v = viewFor(p);
    ghostMat.color.set(p.color).lerp(new THREE.Color(0xffffff), 0.45);
    ghostMat.wireframe = state.wire;
    preview.ghost = new THREE.Mesh(v.geom, ghostMat);
    preview.ghost.renderOrder = 3;
    preview.stencil = makeStencilGroup(v.geom, clipBelow);
    scene.add(preview.ghost, preview.stencil);
    planeGroup.visible = true;
    if (tc.object !== planeGroup) tc.attach(planeGroup);
    preview.partId = p.id;
  }

  function currentFrame() {
    planeGroup.updateMatrixWorld(true);
    const e = planeGroup.matrixWorld.elements;
    const nz = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    return { o: [planeGroup.position.x, planeGroup.position.y, planeGroup.position.z], u: nz(e[0], e[1], e[2]), v: nz(e[4], e[5], e[6]), n: nz(e[8], e[9], e[10]) };
  }
  function planeNormal() { return new THREE.Vector3(0, 0, 1).applyQuaternion(planeGroup.quaternion).normalize(); }
  function onPlaneMoved() {
    const n = planeNormal(), o = planeGroup.position;
    clipBelow.set(n.clone().negate(), n.dot(o));
    clipAbove.set(n.clone(), -n.dot(o));
    updatePositionReadout();
    updateHint();
    markDirty();
  }
  function setPlaneNormal(n) {
    planeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
    computeSliderRange();
    onPlaneMoved();
  }
  function towardCamera(axis) {
    const toCam = camera.position.clone().sub(planeGroup.position);
    return axis.clone().multiplyScalar(axis.dot(toCam) >= 0 ? 1 : -1);
  }
  function computeSliderRange() {
    const p = selectedPart();
    if (!p) return;
    const n = planeNormal();
    const c = state.cut.center, b = p.bbox;
    let lo = Infinity, hi = -Infinity;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      const d = (x - c[0]) * n.x + (y - c[1]) * n.y + (z - c[2]) * n.z;
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    state.cut.lo = lo; state.cut.hi = hi;
  }
  function planeOffset() {
    const n = planeNormal(), c = state.cut.center, o = planeGroup.position;
    return (o.x - c[0]) * n.x + (o.y - c[1]) * n.y + (o.z - c[2]) * n.z;
  }
  function tiltInfo() {
    const n = planeNormal();
    const c = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const i = c.indexOf(Math.max(...c));
    const deg = Math.acos(Math.min(1, c[i])) * 180 / Math.PI;
    return { deg, axis: 'XYZ'[i], index: i, sign: [n.x, n.y, n.z][i] >= 0 ? 1 : -1 };
  }
  /* The plane's orientation as three turns in degrees, like a 3D app: about X, then Y, then Z, all about the
     world axes, starting from a level cut (normal +Z). X tips it forward or back, Y side to side, and Z swings
     the direction of the tip around. */
  function planeAngles() {
    const q = planeGroup.quaternion;
    const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(q), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(q), ez = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const sy = Math.max(-1, Math.min(1, -ex.z));
    const y = Math.asin(sy);
    let x, z;
    if (Math.abs(sy) < 0.99999) { x = Math.atan2(ey.z, ez.z); z = Math.atan2(ex.y, ex.x); }
    else { x = 0; z = Math.atan2(-ey.x, ey.y); }
    const d = (r) => { const v = r * 180 / Math.PI; return Math.abs(v) < 5e-4 ? 0 : v; };
    return { x: d(x), y: d(y), z: d(z) };
  }
  function setPlaneAngles(a) {
    const r = (v) => (v * Math.PI) / 180;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r(a.z))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r(a.y)))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r(a.x)));
    planeGroup.quaternion.copy(q);
    computeSliderRange();
    onPlaneMoved();
  }
  function fmtAngle(v) { const s = (Math.round(v * 10) / 10).toFixed(1); return s === '-0.0' ? '0.0' : s; }
  function straighten() {
    const t = tiltInfo();
    const a = new THREE.Vector3(t.index === 0 ? t.sign : 0, t.index === 1 ? t.sign : 0, t.index === 2 ? t.sign : 0);
    setPlaneNormal(a);
    state.cut.skip.clear();
    scheduleAnalysis(0);
    renderInspector();
  }
  function setPlaneOffset(s) {
    const n = planeNormal(), c = state.cut.center;
    planeGroup.position.set(c[0] + n.x * s, c[1] + n.y * s, c[2] + n.z * s);
    onPlaneMoved();
  }
  function sizePlaneVisuals(R) {
    const s = R * 2.3;
    planeSheet.scale.set(s, s, 1);
    capMesh.scale.set(R * 3.2, R * 3.2, 1);
    const tile = Math.max(3, R / 9);
    hatch.repeat.set((R * 3.2) / tile, (R * 3.2) / tile);
    const h = s / 2;
    const gr = Math.max(0.45, R * 0.02);
    [[h, 0], [-h, 0], [0, h], [0, -h]].forEach(([x, y], i) => { const g = gripGroup.children[i]; g.position.set(x, y, 0); g.scale.set(gr, gr, gr); });
    const ringR = ringRadius(), tube = Math.max(0.18, R * 0.011);
    for (const ax of ['x', 'y']) {
      rings[ax].geometry.dispose();
      const g = new THREE.TorusGeometry(ringR, tube, 8, 96);
      if (ax === 'x') g.rotateY(Math.PI / 2); else g.rotateX(Math.PI / 2); // x ring lies across the plane's y axis, y ring across its x axis
      rings[ax].geometry = g;
    }
    planeFrame.geometry.dispose();
    planeFrame.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0)]);
  }
  function ringRadius() { return state.cut.R * 0.62; }
  // The arrow slides the plane. The rings, or a drag anywhere on the plane, tilt it; the grips mark its edges.
  function attachGizmo() {
    const p = selectedPart(), v = p && views.get(p.id);
    if (p && p.shape && state.tool === 'shape' && v) { // the gizmo moves, turns or sizes the shape about its own middle
      centreShapeView(p, v);
      tc.setMode(state.shapeMode === 'turn' ? 'rotate' : state.shapeMode === 'size' ? 'scale' : 'translate');
      tc.showX = true; tc.showY = true; tc.showZ = true;
      if (tc.object !== v.mesh) tc.attach(v.mesh);
      gripGroup.visible = false; updateHint(); markDirty();
      return;
    }
    tc.setMode('translate');
    tc.showX = false; tc.showY = false; tc.showZ = true;
    if (p) { if (tc.object !== planeGroup) tc.attach(planeGroup); }
    else tc.detach();
    planeSheet.material.opacity = 0.12;
    gripGroup.visible = !!selectedPart();
    updateHint();
    markDirty();
  }
  tc.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (tc.object !== planeGroup) { if (!e.value) bakeShapeDrag(); return; } // a shape being moved, turned or sized
    if (e.value) { state.cut.stale = true; renderKeyMarkers(); }
    else {
      computeSliderRange();
      state.cut.skip.clear();
      scheduleAnalysis(40);
      renderInspector();
    }
  });
  tc.addEventListener('objectChange', () => { if (tc.object === planeGroup) onPlaneMoved(); else markDirty(); });

  /* ---------------- analysis, keys ---------------- */
  function coreCfg() { return { ...state.cfg, sizeMax: state.cfg.diameter }; }
  // Pegs, dowels and magnets are keys placed at points; a plug is the area's own shape, one per area.
  function pointKeys() { return ['peg', 'dowel', 'magnet'].includes(state.cfg.type); }
  function plugsShown() { const shown = new Set(shownAreas()); return state.cut.plugs.filter(q => shown.has(q.region) && !state.cut.skip.has(q.region)); }
  // The thinnest a piece may be: the Wall setting, and never more than the printer handles reliably.
  function minWall() {
    const pr = K.PRINTERS[state.cfg.printer === 'resin' ? 'resin' : 'fdm'].wall;
    return state.cfg.margin > 0 ? Math.min(state.cfg.margin, pr) : pr;
  }
  // Areas that would leave a sliver too thin to print, among those listed and set to be cut.
  function thinShown() {
    const shown = new Set(shownAreas());
    return state.cut.stale ? [] : state.cut.thin.filter(q => shown.has(q.region) && !state.cut.skip.has(q.region));
  }
  function joinThin() {
    for (const q of thinShown()) state.cut.skip.add(q.region);
    if (state.cut.auto) { state.cut.keys = placeKeys(state.cut.analysis); state.cut.why = whyMap(state.cut.keys); }
    state.cut.active = Math.min(state.cut.active, state.cut.keys.length - 1);
    evaluateKeys(); renderRegions(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }
  // Keys for the current cut: sized to fit each area (the default), or all at the size set in the panel.
  function placeKeys(an) {
    if (!an || an.base.error || !pointKeys()) return [];
    return state.cfg.sizeMode === 'set' ? K.autoPlaceKeys(an, coreCfg(), state.cfg.perArea, state.cut.skip) : K.autoFitKeys(an, coreCfg(), state.cfg.perArea, state.cut.skip);
  }
  let analysisTimer = 0;
  function scheduleAnalysis(delay = 140) {
    state.cut.stale = true;
    clearTimeout(analysisTimer);
    analysisTimer = setTimeout(runAnalysis, delay);
    renderKeyMarkers();
  }
  function runAnalysis() {
    const p = selectedPart();
    if (!p) return;
    const f = currentFrame();
    const an = K.analyzePlane(p.positions, p.indices, f, coreCfg(), K.diag(p.bbox));
    state.cut.analysis = an;
    state.cut.stale = false;
    state.cut.hoverArea = -1;
    state.cut.labels = an.base.error ? [] : an.base.regions.map((r, ri) => ({ samples: K.regionSamples(an.base, ri), x: 0, y: 0 }));
    state.cut.thin = an.base.error ? [] : K.thinAreas(an, minWall());
    state.cut.plugs = an.base.error || state.cfg.type !== 'plug' ? [] : K.planPlugs(an, coreCfg());
    if (state.cut.focus && !an.base.error) { // a narrow-point suggestion: cut just the areas that free the piece, leave the rest joined
      planeGroup.updateMatrixWorld(true);
      const keep = new Set();
      for (const f of state.cut.focus) { const l = planeGroup.worldToLocal(f.clone()); const ri = K.regionAt(an.base, l.x, l.y); if (ri >= 0) keep.add(ri); }
      const shown = shownAreas();
      if (keep.size && shown.length > keep.size) {
        for (const j of shown) if (!keep.has(j)) state.cut.skip.add(j);
        toast(keep.size === 1 ? 'Only the narrow part will be cut. Tick other areas to cut them too.' : `Only the ${keep.size} areas that free the piece will be cut. Tick other areas to cut them too.`);
      }
      state.cut.focus = null;
    }
    if (state.cut.auto) { state.cut.keys = placeKeys(an); state.cut.why = whyMap(state.cut.keys); }
    state.cut.active = Math.min(state.cut.active, state.cut.keys.length - 1);
    evaluateKeys();
    if (state.regions.on && state.regions.last && state.regions.last.partId === p.id) replayPick(p); // the pick follows the key settings
    renderRegions();
    renderKeyMarkers();
    renderInspector();
    renderAreaTags();
    updateHint();
    markDirty();
  }
  function evaluateKeys() {
    const an = state.cut.analysis;
    state.cut.evals = an && !an.base.error && pointKeys() ? K.evaluateKeys(an, state.cut.keys, coreCfg(), state.cut.skip) : [];
  }
  function clearGroup(g) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }
  function renderRegions() {
    clearGroup(regionGroup);
    const an = state.cut.analysis;
    if (!an || an.base.error) return;
    const R = state.cut.R;
    const z = Math.max(0.02, R * 0.0006);
    an.base.regions.forEach((reg, ri) => {
      const skipped = state.cut.skip.has(ri);
      const g = new THREE.Group();
      g.userData.region = ri;
      for (const li of [reg.outer, ...reg.holes]) {
        const xy = an.base.loops[li].xy;
        const pts = [];
        for (let i = 0; i < xy.length; i += 2) pts.push(new THREE.Vector3(xy[i], xy[i + 1], z));
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: skipped ? 0x5c6168 : 0x2a2100 }));
        line.renderOrder = 4;
        g.add(line);
      }
      const hover = ri === state.cut.hoverArea;
      if (skipped || hover) {
        const flat = [], holes = [];
        const rings = [reg.outer, ...reg.holes];
        rings.forEach((li, k) => { if (k) holes.push(flat.length / 2); flat.push(...an.base.loops[li].xy); });
        const tri = K.earcut(flat, holes);
        const geom = new THREE.BufferGeometry();
        const pos = new Float32Array(flat.length / 2 * 3);
        for (let i = 0; i < flat.length / 2; i++) { pos[3 * i] = flat[2 * i]; pos[3 * i + 1] = flat[2 * i + 1]; pos[3 * i + 2] = z * 0.6; }
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setIndex(tri);
        // joined areas are flat grey; the hovered area brightens so it can be matched to its label
        const mat = skipped
          ? new THREE.MeshBasicMaterial({ color: hover ? 0xc4c8cc : 0x9ea4aa, side: THREE.DoubleSide })
          : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
        const fill = new THREE.Mesh(geom, mat);
        fill.renderOrder = 4;
        g.add(fill);
      }
      regionGroup.add(g);
    });
  }
  /* ---------------- area labels in the view ---------------- */
  const tagLayer = $('#areaTags');
  // Areas worth showing: real sculpts give cut faces with specks (a fraction of a square millimetre, or a
  // microscopic void touching the surface). Those are still cut and capped, just not listed or labelled.
  function shownAreas() {
    const an = state.cut.analysis;
    if (!an || an.base.error) return [];
    return K.shownRegions(an.base.regions);
  }
  function areaCount() { return shownAreas().length; }
  function whyMap(keys) { const m = new Map(); for (const e of keys.empty || []) m.set(e.region, e.reason); return m; }
  // Areas that will be cut but have no key in them, so the panel and the labels can say so.
  function areasWithoutKeys() {
    const an = state.cut.analysis;
    if (state.cfg.type === 'none' || !an || an.base.error || state.cut.stale) return [];
    const has = new Set(state.cfg.type === 'plug' ? state.cut.plugs.filter(q => q.ok).map(q => q.region) : state.cut.keys.map(k => K.regionAt(an.base, k.x, k.y)));
    return shownAreas().filter(i => !state.cut.skip.has(i) && !has.has(i));
  }
  function noKeyMessage(list, everywhere) {
    const shown = shownAreas(), num = (i) => shown.indexOf(i) + 1;
    const nums = list.map(num), names = nums.length === 1 ? `area ${nums[0]}` : `areas ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
    const why = state.cut.why || new Map();
    const said = { 'Too close to the edge': 'too narrow for keys this size', 'Area too small': 'too small for keys this size', 'Wall around the socket is too thin': `the walls would be thinner than ${state.cfg.margin} mm`, 'Socket would break through the surface': 'the socket would break through the surface', 'Socket would break through the side': 'the socket would break through the side' };
    const reasons = [...new Set(list.map(i => said[why.get(i)]).filter(Boolean))];
    const because = reasons.length === 1 ? `: ${reasons[0]}` : '';
    const head = everywhere ? 'No room for keys on this cut' : `No room for a key in ${names}`;
    if (state.cfg.sizeMode !== 'set' && state.cfg.type !== 'magnet') {
      const tip = state.cfg.printer === 'resin' ? 'Try a smaller Smallest size or a thinner wall' : 'For smaller keys, choose Resin under Printer (click Done), or a smaller Smallest size';
      return `${head}${because}, even at ${fmt(state.cfg.sizeMin)} mm. ${tip}.`;
    }
    return `${head}${because}. Try smaller keys or a thinner wall, or click the cut face to place one.`;
  }
  function updateLabelPoints() {
    if (!state.cut.labels.length) return;
    const avoid = !pointKeys() ? 0 : K.keyGeometrySpec(state.cfg).outer + state.cfg.margin;
    const keys = !pointKeys() ? [] : state.cut.keys;
    for (const l of state.cut.labels) Object.assign(l, K.pickLabelPoint(l.samples, keys, avoid));
  }
  function renderAreaTags() {
    const shown = shownAreas(), noKey = new Set(areasWithoutKeys()), thin = new Set(thinShown().map(q => q.region));
    tagLayer.innerHTML = shown.length > 1 ? shown.map((i, k) => {
      const cut = !state.cut.skip.has(i);
      return `<button class="area-tag${i === state.cut.hoverArea ? ' is-hover' : ''}" data-area-tag="${i}" aria-pressed="${cut}" title="${cut ? `Area ${k + 1} will be cut. Click to leave it joined.` : `Area ${k + 1} stays joined. Click to cut it.`}"><b>${k + 1}</b>${cut ? 'Cut' : 'Joined'}${cut && thin.has(i) ? '<i>too thin</i>' : cut && noKey.has(i) ? `<i>no ${state.cfg.type === 'plug' ? 'plug' : 'key'}</i>` : ''}</button>`;
    }).join('') : '';
    updateLabelPoints();
    placeAreaTags();
  }
  function placeAreaTags() {
    const tags = tagLayer.children;
    if (!tags.length) return;
    const show = planeShown() && !state.cut.stale && !ptr.ring && !ptr.tilt && areaCount() > 1 && cameraOnClearSide();
    tagLayer.hidden = !show;
    if (!show) return;
    planeGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const el of tags) {
      const l = state.cut.labels[+el.dataset.areaTag];
      if (!l) continue;
      const q = planeGroup.localToWorld(new THREE.Vector3(l.x, l.y, 0)).project(camera);
      const off = q.z > 1 || q.x < -1.05 || q.x > 1.05 || q.y < -1.05 || q.y > 1.05;
      el.style.visibility = off ? 'hidden' : '';
      if (off) continue;
      const x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H;
      el.style.transform = `translate(${Math.round(x - el.offsetWidth / 2)}px, ${Math.round(y - el.offsetHeight / 2)}px)`;
    }
  }
  function setHoverArea(i) {
    if (state.cut.hoverArea === i) return;
    state.cut.hoverArea = i;
    renderRegions();
    for (const el of tagLayer.children) el.classList.toggle('is-hover', +el.dataset.areaTag === i);
    for (const li of document.querySelectorAll('[data-area-row]')) li.classList.toggle('is-hover', +li.dataset.areaRow === i);
    markDirty();
  }
  function toggleArea(i) {
    if (!shownAreas().includes(i)) return;
    if (state.cut.skip.has(i)) state.cut.skip.delete(i); else state.cut.skip.add(i);
    if (state.cut.auto) { state.cut.keys = placeKeys(state.cut.analysis); state.cut.why = whyMap(state.cut.keys); }
    state.cut.active = Math.min(state.cut.active, state.cut.keys.length - 1);
    evaluateKeys(); renderRegions(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }
  tagLayer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area-tag]');
    if (b) toggleArea(+b.dataset.areaTag);
  });
  tagLayer.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-area-tag]'); if (b) setHoverArea(+b.dataset.areaTag); });
  tagLayer.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !tagLayer.contains(e.relatedTarget)) setHoverArea(-1); });
  function renderPlugMarkers() {
    const R = state.cut.R, z = Math.max(0.03, R * 0.0009);
    for (const q of plugsShown()) {
      if (!q.ok || state.cut.stale) continue;
      const g = new THREE.Group();
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q.base.map(([x, y]) => new THREE.Vector3(x, y, z))), new THREE.LineBasicMaterial({ color: 0x1d1d1b }));
      line.renderOrder = 6;
      const body = new THREE.Mesh(prismGeometry(q.base, q.top, 0, q.side * q.depth, [q.x, q.y]), new THREE.MeshStandardMaterial({ color: 0xfafbfc, roughness: 0.5, transparent: true, opacity: 0.55, depthWrite: false }));
      body.renderOrder = 5;
      g.add(line, body);
      keyGroup.add(g);
    }
    markDirty();
  }
  function renderKeyMarkers() {
    clearGroup(keyGroup);
    updateLabelPoints();
    const cfg = state.cfg;
    if (!selectedPart() || cfg.type === 'none') { markDirty(); return; }
    if (cfg.type === 'plug') { renderPlugMarkers(); return; }
    const spec = K.keyGeometrySpec(cfg);
    const R = state.cut.R;
    const z = Math.max(0.03, R * 0.0009);
    state.cut.keys.forEach((k, i) => {
      const kc = K.keyCfg(cfg, k), ks = k.o ? K.keyGeometrySpec(kc) : spec;
      const ev = state.cut.evals[i];
      const stale = state.cut.stale;
      const bad = !stale && ev && !ev.ok;
      const active = i === state.cut.active;
      const color = stale ? 0xd5d8dc : bad ? 0xe5484d : 0xfafbfc;
      const g = new THREE.Group();
      g.position.set(k.x, k.y, 0);
      const an = state.cut.analysis, sec = an && !an.base.error ? an.base : null;
      const ang = K.keyAngle(sec || { regions: [] }, sec ? K.regionAt(sec, k.x, k.y) : -1, kc);
      const prof = (rr, dd) => K.keyProfile(ks.shape, rr, dd, ang, ks.res);
      const disc = new THREE.Mesh(fanGeometry(prof(ks.r, ks.cs), 0), new THREE.MeshBasicMaterial({ color: bad ? 0xe5484d : active ? 0x2a5fb8 : k.o ? 0x2b3a4d : 0x1d1d1b, side: THREE.DoubleSide, transparent: true, opacity: active ? 0.95 : 0.78 }));
      disc.position.z = z; disc.renderOrder = 5;
      g.add(disc);
      let z0, z1, tipR = ks.r;
      if (cfg.type === 'peg') { z0 = 0; z1 = (cfg.pegSide === 'above' ? -1 : 1) * kc.length; tipR = ks.r * ks.taper; }
      else if (cfg.type === 'dowel') { z0 = -kc.length / 2; z1 = kc.length / 2; }
      else { z0 = -kc.length; z1 = kc.length; }
      const body = prismGeometry(prof(ks.r, 0), prof(tipR, 0), z0, z1);
      const mesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: active ? 0x16325e : 0x000000 }));
      mesh.renderOrder = 5;
      g.add(mesh);
      keyGroup.add(g);
    });
    markDirty();
  }

  // Flat outline of a key's footprint, as a fan from its centre (every key shape is star-shaped around it).
  function fanGeometry(prof, z) {
    const pos = [0, 0, z], idx = [];
    prof.forEach(([x, y], i) => { pos.push(x, y, z); idx.push(0, 1 + i, 1 + (i + 1) % prof.length); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    return g;
  }
  // A key body: outline p0 at z0 rising to outline p1 at z1, with smooth sides on curves and sharp edges at corners.
  // The end caps fan from `centre` (the ring's middle by default, which is the key's own origin for a key outline;
  // a plug's rings are in plane coordinates, so its centre is passed in: fanning them from the plane's origin drew
  // a wedge from every plug to the middle of the cut).
  function prismGeometry(p0, p1, z0, z1, centre) {
    const n = p0.length, pos = [], nor = [], idx = [];
    const up = z1 > z0;
    const en = p0.map((a, i) => { const b = p0[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; });
    const vn = (i, e) => { // normal at vertex i for edge e: averaged with the neighbour edge when the turn is gentle
      const o = e === i ? en[(i - 1 + n) % n] : en[(i + 1) % n], m = en[e];
      if (m[0] * o[0] + m[1] * o[1] < Math.cos(Math.PI / 5)) return m;
      const sx = m[0] + o[0], sy = m[1] + o[1], l = Math.hypot(sx, sy) || 1;
      return [sx / l, sy / l];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ni = vn(i, i), nj = vn(j, i), b = pos.length / 3;
      pos.push(p0[i][0], p0[i][1], z0, p0[j][0], p0[j][1], z0, p1[j][0], p1[j][1], z1, p1[i][0], p1[i][1], z1);
      nor.push(ni[0], ni[1], 0, nj[0], nj[1], 0, nj[0], nj[1], 0, ni[0], ni[1], 0);
      if (up) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    for (const [ring, z, top] of [[p1, z1, true], [p0, z0, false]]) {
      const c = pos.length / 3, nz = (top === up) ? 1 : -1;
      let cx = 0, cy = 0; if (centre) { cx = centre[0]; cy = centre[1]; } else { for (const [x, y] of ring) { cx += x; cy += y; } cx /= ring.length || 1; cy /= ring.length || 1; }
      pos.push(cx, cy, z); nor.push(0, 0, nz);
      ring.forEach(([x, y]) => { pos.push(x, y, z); nor.push(0, 0, nz); });
      for (let i = 0; i < n; i++) { const a = c + 1 + i, b = c + 1 + (i + 1) % n; if (nz > 0) idx.push(c, a, b); else idx.push(c, b, a); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setIndex(idx);
    return g;
  }

  /* ---------------- selection ---------------- */
  function selectPartSplitPreview() { splitGroup.visible = !state.selectedId || state.tool === 'bed'; markDirty(); }
  function selectPart(id) {
    if (id === state.selectedId) return;
    state.selectedId = id;
    if (id && state.tool === 'bed') state.tool = 'plane'; // the bed tool works on the whole model; a chosen part is cut on its own
    const was = selectedPart(); if (was && was.shape && state.tool === 'shape') refreshView(was.id); // the shape just let go stands on its own positions again
    if (id && state.tool === 'shape') { const np = state.parts.find(q => q.id === id); if (np && !np.shape) state.tool = 'plane'; }
    if (id && state.tool === 'boolean' && state.bool.shapeId === id) { const other = state.parts.find(q => q.shape && q.id !== id && !state.hidden.has(q.id)); state.bool.shapeId = other ? other.id : null; } // the part chosen can't be the shape as well
    selectPartSplitPreview();
    const p = selectedPart();
    if (p) {
      state.cut.center = p.bbox.center.slice();
      state.cut.R = K.diag(p.bbox) / 2;
      planeGroup.position.set(...p.bbox.center);
      sizePlaneVisuals(state.cut.R);
      const up = new THREE.Vector3(0, 0, 1);
      setPlaneNormal(towardCamera(up));
      state.cut.keys = []; state.cut.auto = true; state.cut.skip = new Set(); state.cut.analysis = null; state.cut.evals = []; state.cut.active = -1; state.cut.focus = null;
      state.suggest = suggestCache.get(p.id) || null;
      attachGizmo();
      scheduleAnalysis(0);
    }
    syncScene();
    renderSuggestPins();
  }

  /* ---------------- shapes ----------------
     A cube, a ball, a tube, a cone or a ring, added as a part of its own (the guide's Shapes tool): material to
     add, or a shape to cut with. The shape's settings live in part.shape ({ kind, w, d, h, inner, edge, edgeSize,
     pos, rot }); its positions are the shape built by core, turned (X, then Y, then Z, as three.js's XYZ order) and
     moved, so cutting, export and the rest see a plain closed part. */
  const SOLID_NAMES = { cube: 'Cube', ball: 'Ball', tube: 'Tube', cone: 'Cone', ring: 'Ring' };
  function rotXYZ(deg) { // the same matrix three.js builds for an XYZ Euler, so a turn by the gizmo and by the fields agree
    const [x, y, z] = deg.map(v => (v * Math.PI) / 180), a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
    return [[c * e, -c * f, d], [a * f + b * e * d, a * e - b * f * d, -b * c], [b * f - a * e * d, b * e + a * f * d, a * c]];
  }
  function shapePositions(sp) {
    const m = K.shapeMesh(sp), R = rotXYZ(sp.rot), o = sp.pos;
    const positions = K.transformPositions(m.positions, (x, y, z) => [R[0][0] * x + R[0][1] * y + R[0][2] * z + o[0], R[1][0] * x + R[1][1] * y + R[1][2] * z + o[1], R[2][0] * x + R[2][1] * y + R[2][2] * z + o[2]]);
    return { positions, indices: m.indices };
  }
  function shapeDefaults(kind) {
    const b = state.parts.length ? modelBounds() : null, L = b ? Math.max(...b.size) : 40;
    const s = Math.max(1, Math.round(L * 0.3 * 2) / 2);
    const sp = { kind, w: s, d: s, h: s, inner: Math.round(s * 0.6 * 2) / 2, edge: 'sharp', edgeSize: Math.max(0.5, Math.round(s * 0.1 * 2) / 2), pos: b ? b.center.slice() : [0, 0, s / 2], rot: [0, 0, 0] };
    if (kind === 'cone') sp.d = Math.round(s * 0.4 * 2) / 2;
    if (kind === 'ring') sp.h = Math.round(s * 0.3 * 2) / 2;
    return sp;
  }
  function remakeShape(p, sp, label) {
    const m = shapePositions(sp);
    const q = { ...p, shape: sp, positions: m.positions, indices: m.indices, bbox: K.bounds(m.positions), tris: m.indices.length / 3, volume: K.volume(m.positions, m.indices) };
    const idx = state.parts.indexOf(p);
    commit(state.parts.slice(0, idx).concat([q], state.parts.slice(idx + 1)), label || 'the shape change');
    refreshView(q.id);
    syncScene(); attachGizmo();
    return q;
  }
  function refreshView(id) { const v = views.get(id); if (v) { partsGroup.remove(v.mesh); if (tc.object === v.mesh) tc.detach(); v.geom.dispose(); v.mat.dispose(); views.delete(id); } }
  // While a shape is being edited its mesh is centred on the shape's middle, so the gizmo turns and sizes it about
  // that middle; the part's positions stay in model coordinates throughout.
  function centreShapeView(p, v) {
    if (v.centred) return;
    const o = p.shape.pos;
    v.geom.translate(-o[0], -o[1], -o[2]); v.geom.computeBoundingSphere(); v.geom.computeBoundingBox();
    v.offset.set(o[0], o[1], o[2]); v.mesh.position.set(o[0], o[1], o[2]); v.centred = true;
  }
  function addShape(kind) {
    const sp = shapeDefaults(kind), m = shapePositions(sp);
    const n = state.parts.filter(q => q.shape && q.shape.kind === kind).length + 1;
    const part = makePart({ name: `${SOLID_NAMES[kind]}${n > 1 ? ' ' + n : ''}`, color: nextColor(), positions: m.positions, indices: m.indices, shape: sp });
    commit(state.parts.concat([part]), 'adding a shape');
    if (state.regions.on) setRegions(false);
    state.tool = 'shape'; state.shapeMode = 'move';
    $('#empty').hidden = true;
    if (!state.model) state.model = { name: part.name, report: { closed: true, openEdges: 0, badEdges: 0 }, tris: part.tris };
    state.selectedId = null; selectPart(part.id);
    syncScene(); attachGizmo(); updateChrome();
    toast(`Added a ${SOLID_NAMES[kind].toLowerCase()}. Drag the arrows to move it, or set its size and place in the panel.`);
    return part;
  }
  function setShape(fields, label) {
    const p = selectedPart();
    if (!p || !p.shape) return null;
    const sp = { ...p.shape, ...fields, pos: fields.pos || p.shape.pos.slice(), rot: fields.rot || p.shape.rot.slice() };
    for (const k of ['w', 'd', 'h', 'inner', 'edgeSize']) if (!(sp[k] >= 0) || !isFinite(sp[k])) sp[k] = p.shape[k];
    for (const k of ['w', 'h']) sp[k] = Math.max(0.2, sp[k]);
    return remakeShape(p, sp, label);
  }
  // The gizmo's drag, baked into the shape: where it moved to, how it turned (on top of its turn so far) and how it
  // was sized; the mesh goes back to standing on the part's own positions.
  function bakeShapeDrag() {
    const p = selectedPart(), v = p && views.get(p.id);
    if (!p || !p.shape || !v || !v.centred) return;
    const sp = { ...p.shape, pos: [v.mesh.position.x, v.mesh.position.y, v.mesh.position.z], rot: p.shape.rot.slice() };
    if (THREE.Euler && THREE.Quaternion) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.mesh.rotation.x, v.mesh.rotation.y, v.mesh.rotation.z, 'XYZ'));
      const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...sp.rot.map(a => (a * Math.PI) / 180), 'XYZ'));
      const e = new THREE.Euler().setFromQuaternion(q.multiply(q0), 'XYZ');
      sp.rot = [e.x, e.y, e.z].map(a => Math.round((a * 180) / Math.PI * 10) / 10);
    }
    const s = v.mesh.scale, sxy = (Math.abs(s.x) + Math.abs(s.y)) / 2;
    if (sp.kind === 'cube') { sp.w *= Math.abs(s.x); sp.d *= Math.abs(s.y); } else { sp.w *= sxy; if (sp.kind === 'cone') sp.d *= sxy; if (sp.kind === 'ring') sp.inner *= sxy; }
    sp.h *= Math.abs(s.z);
    for (const k of ['w', 'd', 'h', 'inner']) sp[k] = Math.round(sp[k] * 100) / 100;
    v.mesh.rotation.x = 0; v.mesh.rotation.y = 0; v.mesh.rotation.z = 0; v.mesh.scale.set(1, 1, 1);
    remakeShape(p, sp, state.shapeMode === 'turn' ? 'turning the shape' : state.shapeMode === 'size' ? 'sizing the shape' : 'moving the shape');
  }
  /* ---------------- booleans ----------------
     modelsplitter's Boolean tool: a shape joined to a part (union), cut out of it (difference), or only the overlap
     kept (intersect), through core's booleanShape. The part chosen in the view is the part; the shape is one of the
     shape parts (the one chosen when the tool was opened, or the one clicked). The result takes the part's place and
     the shape goes, as one undo step. */
  const BOOL_LABELS = { union: 'Add the shape', difference: 'Cut the shape out', intersect: 'Keep the overlap' };
  const BOOL_VERBS = { union: 'Add', difference: 'Cut out', intersect: 'Keep the overlap of' };
  function booleanShape() { const s = state.bool.shapeId !== null ? state.parts.find(q => q.id === state.bool.shapeId && q.shape) : null; return s && s.id !== state.selectedId ? s : null; }
  function enterBoolean() { // the shape and the part it works on, from what is chosen
    const p = selectedPart(), vis = state.parts.filter(q => !state.hidden.has(q.id));
    if (p && p.shape) { state.bool.shapeId = p.id; const target = vis.find(q => !q.shape) || vis.find(q => q.id !== p.id); state.selectedId = target ? target.id : null; }
    else {
      if (!p) { const target = vis.find(q => !q.shape) || vis[0]; state.selectedId = target ? target.id : null; }
      const cur = state.parts.find(q => q.id === state.bool.shapeId && q.shape && q.id !== state.selectedId);
      if (!cur) { const shapes = vis.filter(q => q.shape && q.id !== state.selectedId); state.bool.shapeId = shapes.length ? shapes[shapes.length - 1].id : null; }
    }
    syncScene();
  }
  function booleanPanelHTML() {
    const p = selectedPart(), shapes = state.parts.filter(q => q.shape && !state.hidden.has(q.id) && q.id !== (p ? p.id : null)), sh = booleanShape();
    const kinds = `<div class="kinds">${Object.entries(SOLID_NAMES).map(([k, n]) => `<button class="btn small" data-act="shape-add" data-value="${k}" title="Add a ${n.toLowerCase()}">${n}</button>`).join('')}</div>`;
    const note = { union: 'The shape becomes part of the part: a base under a figure, a peg, a handle.', difference: 'The shape is taken out of the part: a hole, a socket, a slice off the side.', intersect: 'Only what lies inside both is kept: the part trimmed to the shape.' }[state.bool.op];
    return `<div class="bool-panel">
      ${shapes.length ? `<label class="inline"><span class="lbl">Shape</span><select class="sel" data-bool="shape" aria-label="Shape">${shapes.map(q => `<option value="${q.id}"${sh && q.id === sh.id ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}</select></label>` : `<p class="muted small">Add a shape first, then place it where it should join or cut the part.</p>${kinds}`}
      <div class="inline part-pick"><span class="lbl">Part</span><span>${p ? `<strong>${esc(p.name)}</strong> <span class="muted">(click another part to change)</span>` : '<span class="muted">Click a part in the view</span>'}</span></div>
      <div class="inline"><span class="lbl">Do</span>${seg('bool-op', state.bool.op, [['union', 'Add'], ['difference', 'Cut out'], ['intersect', 'Keep overlap']])}</div>
      <p class="muted small">${note}</p>
    </div>`;
  }
  async function doBoolean() {
    const p = selectedPart(), sh = booleanShape();
    if (!p || !sh) { toast(sh ? 'Click the part the shape should work on.' : 'Add a shape first, with the Shapes tool.'); return null; }
    const op = state.bool.op;
    busy(op === 'union' ? 'Adding the shape' : op === 'difference' ? 'Cutting the shape out' : 'Keeping the overlap');
    await nextFrame();
    let out = null;
    try {
      const t0 = performance.now();
      const r = K.booleanShape(p.positions, p.indices, sh.shape, op);
      const part = makePart({ name: p.name, color: p.color, positions: r.positions, indices: r.indices, kind: p.kind, pull: null });
      const idx = state.parts.indexOf(p);
      commit(state.parts.slice(0, idx).concat([part], state.parts.slice(idx + 1)).filter(q => q !== sh), op === 'union' ? 'adding the shape' : op === 'difference' ? 'cutting the shape out' : 'keeping the overlap');
      if (state.regions.on) setRegions(false);
      regionCache.delete(p.id);
      state.selectedId = part.id; state.bool.shapeId = null;
      state.tool = 'plane';
      syncScene(); attachGizmo(); updateChrome();
      const ms = Math.round(performance.now() - t0);
      toast(`${op === 'union' ? `Added the ${sh.name.toLowerCase()} to` : op === 'difference' ? `Cut the ${sh.name.toLowerCase()} out of` : `Kept the overlap of the ${sh.name.toLowerCase()} and`} ${p.name}: ${fmtInt(part.tris)} triangles${ms > 500 ? `, ${(ms / 1000).toFixed(1)} s` : ''}. Ctrl+Z undoes it.`);
      out = part;
    } catch (e) {
      toast(e.message || 'The boolean failed.', 'warn');
    }
    busy(null);
    return out;
  }
  function removeShape() {
    const p = selectedPart();
    if (!p || !p.shape) return;
    commit(state.parts.filter(q => q !== p), 'removing the shape');
    state.selectedId = null; syncScene(); attachGizmo();
    toast(`Removed the ${p.name}. Ctrl+Z puts it back.`);
  }
  function shapePanelHTML() {
    const p = selectedPart(), sp = p && p.shape;
    const kinds = `<div class="kinds">${Object.entries(SOLID_NAMES).map(([k, n]) => `<button class="btn small" data-act="shape-add" data-value="${k}" title="Add a ${n.toLowerCase()}">${n}</button>`).join('')}</div>`;
    if (!sp) return `<div class="shape-panel"><p class="muted small">Add a shape to the model: material to add, or a shape to cut with. It becomes a part of its own, so you can cut it, export it, or join it to the model with Boolean.</p>${kinds}</div>`;
    const f = (field, label, value, opts = {}) => `<label class="numi"><span>${label}</span><span class="num-wrap"><input type="number" inputmode="decimal" data-shape="${field}" value="${value}" step="${opts.step || 0.5}" min="${opts.min === undefined ? 0 : opts.min}" aria-label="${label}"><em>${opts.unit || 'mm'}</em></span></label>`;
    const sizes = sp.kind === 'cube' ? [f('w', 'Width', sp.w), f('d', 'Depth', sp.d), f('h', 'Height', sp.h)]
      : sp.kind === 'ball' ? [f('w', 'Diameter', sp.w)]
      : sp.kind === 'tube' ? [f('w', 'Diameter', sp.w), f('h', 'Height', sp.h)]
      : sp.kind === 'cone' ? [f('w', 'Bottom', sp.w), f('d', 'Top', sp.d), f('h', 'Height', sp.h)]
      : [f('w', 'Outer', sp.w), f('inner', 'Hole', sp.inner), f('h', 'Height', sp.h)];
    return `<div class="shape-panel">
      <div class="inline"><span class="lbl">Shape</span>${seg('shape-kind', sp.kind, Object.entries(SOLID_NAMES))}</div>
      <div class="grid3">${sizes.join('')}</div>
      ${sp.kind === 'ball' ? '' : `<div class="inline"><span class="lbl">Edges</span>${seg('shape-edge', sp.edge, [['sharp', 'Sharp'], ['chamfer', 'Chamfer'], ['round', 'Round']])}</div>
      ${sp.edge !== 'sharp' ? `<div class="grid3">${f('edgeSize', sp.edge === 'round' ? 'Radius' : 'Chamfer', sp.edgeSize, { step: 0.5, min: 0.1 })}</div>` : ''}`}
      <div class="inline"><span class="lbl">Handles</span>${seg('shape-mode', state.shapeMode, [['move', 'Move'], ['turn', 'Turn'], ['size', 'Size']])}</div>
      <div class="grid3">${['x', 'y', 'z'].map((a, i) => f(`pos${i}`, `At ${a.toUpperCase()}`, Math.round(sp.pos[i] * 100) / 100, { step: 1, min: -1e6 })).join('')}</div>
      <div class="grid3">${['x', 'y', 'z'].map((a, i) => f(`rot${i}`, `Turn ${a.toUpperCase()}`, sp.rot[i], { step: 5, min: -360, unit: '°' })).join('')}</div>
      <div class="btn-row"><button class="btn small" data-act="shape-centre" title="Put the shape at the middle of the model">Centre on model</button><button class="btn small" data-act="shape-ground" title="Stand the shape on the model’s lowest point">Stand on the ground</button><button class="btn small" data-act="shape-remove" title="Remove this shape (Delete)">Remove</button><button class="btn small" data-act="done" title="Keep the shape and let it go (Esc)">Done</button></div>
      <p class="muted small">${sp.kind === 'ring' ? 'A ring is a tube with a hole.' : ''} Add another: </p>${kinds}
    </div>`;
  }
  /* ---------------- cut suggestions ---------------- */
  // Narrow points (wrists, ankles, necks), seams and panel lines, and separate pieces, found from the model's
  // shape. The search runs a direction at a time between frames so the screen keeps moving, and its results
  // are kept for each part.
  const suggestCache = new Map();
  let suggestRun = null;
  const pinLayer = $('#suggestPins');
  async function findSuggestions() {
    const p = selectedPart();
    if (!p) return;
    const token = {};
    suggestRun = token;
    state.suggest = { partId: p.id, status: 'running', progress: 0, items: [], active: -1 };
    renderInspector(); renderSuggestPins();
    const still = async (frac) => {
      if (suggestRun !== token || state.selectedId !== p.id) return false;
      state.suggest.progress = frac;
      const bar = $('#suggestBar'); if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
      await nextFrame();
      return suggestRun === token && state.selectedId === p.id;
    };
    const scale = K.diag(p.bbox), dirs = K.sweepDirections(p.positions), steps = dirs.length + 4;
    let found = [];
    if (!(await still(0.02))) return;
    for (let i = 0; i < dirs.length; i++) {
      found = found.concat(K.neckSweep(p.positions, p.indices, dirs[i], scale));
      if (!(await still((i + 1) / steps))) return;
    }
    const necks = K.refineNecks(p.positions, p.indices, found, scale);
    if (!(await still((dirs.length + 1) / steps))) return;
    const creases = K.creasePlanes(p.positions, p.indices, dirs, scale, K.creaseEdges(p.positions, p.indices));
    if (!(await still((dirs.length + 2) / steps))) return;
    // regions worth splitting off along their outline (an arm, a head, a backpack), with the regions settings in use
    const regions = K.regionCuts(p.positions, p.indices, regionsFor(p)).map(r => ({ ...r, fold: state.regions.fold, angle: state.regions.angle }));
    if (!(await still((dirs.length + 3) / steps))) return;
    const shells = K.separateShells(p.positions, p.indices);
    const items = [];
    if (shells.length) items.push({ kind: 'shells', count: shells.length });
    items.push(...necks.concat(creases, regions).sort((a, b) => b.score - a.score).slice(0, 9));
    state.suggest = { partId: p.id, status: 'done', progress: 1, items, active: -1 };
    suggestCache.set(p.id, state.suggest);
    suggestRun = null;
    renderInspector(); renderSuggestPins();
  }
  // Suggestions are lettered (A, B, C…) so they can't be mixed up with the numbered areas of a cut face.
  function suggestMark(s, i) { const off = s.items[0] && s.items[0].kind === 'shells' ? 1 : 0; return s.items[i].kind === 'shells' ? '✂' : String.fromCharCode(65 + i - off); }
  function suggestText(it) {
    const frees = it.freed ? `, frees a piece of ${fmtVol(it.freed)}` : '';
    if (it.kind === 'shells') return ['Split into separate pieces', `${it.count} pieces that don’t touch, so no cut is needed`];
    if (it.kind === 'neck') return ['Narrow point', `About ${fmt(it.width)} mm across${frees}`];
    if (it.kind === 'join') return ['Where a part joins', `About ${fmt(it.width)} mm across${frees}`];
    if (it.kind === 'here') return ['Cut at the spot you clicked', `About ${fmt(it.width)} mm across${frees}`];
    if (it.kind === 'region') return ['Split off a region', `Along its outline (${it.loops === 1 ? 'one line' : `${it.loops} lines`}, ${fmt(it.length)} mm)${frees}`];
    return ['Seam or panel line', `Runs along creases for ${Math.round(it.coverage * 100)}% of the cut${frees}`];
  }
  function fmtVol(v) { return v >= 1000 ? `${fmt(v / 1000)} cm³` : `${Math.round(v)} mm³`; }
  function suggestSection() {
    const s = state.suggest;
    let body;
    const here = `<p class="muted small">Or click where the cut should go round: Keymaster finds the narrowest cut through that spot and cuts just the piece it frees.</p>
      <button class="btn" data-act="cut-here" aria-pressed="${state.here.on}">${state.here.on ? 'Click a spot on the model…' : 'Cut at a spot'}</button>
      <button class="btn" data-act="cut-across" aria-pressed="${state.across.on}" title="Drag a straight line across the model and the cut goes through it, straight into the view">${state.across.on ? 'Drag a line across the model…' : 'Cut across the view'}</button>`;
    if (!s) body = `<p class="muted small">Keymaster looks for natural places to cut: narrow points like wrists, ankles and necks, where a limb or an accessory joins, regions to split off along their outline, seams, and separate pieces.</p>
      <button class="btn" data-act="find-cuts">Find cut spots</button>${here}`;
    else if (s.status === 'running') body = `<div class="progress" role="progressbar" aria-label="Looking for cut spots"><span id="suggestBar" style="width:${Math.round(s.progress * 100)}%"></span></div>
      <p class="muted small">Looking at the shape of the model…</p>`;
    else if (!s.items.length) body = `<p class="muted small">No clear break points on this part. Place the cut yourself, or try another part.</p>`;
    else body = `<p class="muted small">Click one to move the cut there. The letters match the pins on the model.</p>
      <ol class="suggest-list">${s.items.map((it, i) => { const [a, b] = suggestText(it); return `<li><button type="button" data-act="suggest" data-value="${i}" aria-pressed="${i === s.active}"><b>${suggestMark(s, i)}</b><span><strong>${a}</strong><em>${esc(b)}</em></span></button></li>`; }).join('')}</ol>${here}`;
    return `<div class="ins-section suggest">${body}</div>`;
  }
  function renderSuggestPins() {
    const s = state.suggest, p = selectedPart();
    if (!pinLayer) return;
    if (!s || s.status !== 'done' || !p || s.partId !== p.id) { pinLayer.innerHTML = ''; return; }
    pinLayer.innerHTML = s.items.map((it, i) => it.kind === 'shells' ? '' :
      `<button type="button" class="suggest-pin${i === s.active ? ' is-active' : ''}" data-pin="${i}" title="${suggestText(it).join(': ')}">${suggestMark(s, i)}</button>`).join('');
    placeSuggestPins();
  }
  function placeSuggestPins() {
    if (!pinLayer || !pinLayer.children.length) return;
    const s = state.suggest;
    const show = s && !ptr.ring && !ptr.tilt && !tc.dragging;
    pinLayer.hidden = !show;
    if (!show) return;
    camera.updateMatrixWorld();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const el of pinLayer.children) {
      const it = s.items[+el.dataset.pin];
      const q = new THREE.Vector3(...it.point).project(camera);
      const offscreen = q.z > 1 || Math.abs(q.x) > 1.05 || Math.abs(q.y) > 1.05;
      el.style.visibility = offscreen ? 'hidden' : '';
      if (!offscreen) el.style.transform = `translate(${Math.round((q.x + 1) / 2 * W - 12)}px, ${Math.round((1 - q.y) / 2 * H - 12)}px)`;
    }
  }
  function applySuggestion(i) {
    const s = state.suggest, it = s && s.items[i];
    if (!it) return;
    s.active = i;
    if (it.kind === 'shells') { splitShells(); return; }
    if (it.kind === 'region') { // a curved cut: show the regions and pick this one, as a click on it would
      const p = selectedPart();
      if (!p) return;
      if (it.fold !== undefined) { state.regions.fold = it.fold; state.regions.angle = it.angle; const sl = $('#regionsAngle'); if (sl) { sl.value = it.fold; $('#regionsAngleOut').textContent = `${it.fold}°`; } }
      if (!state.regions.on) { setRegions(true); } else if (state.paint.on) setPainting(false);
      if (state.draw.on) setDrawing(false);
      state.regions.last = { partId: p.id, clicks: [it.point] };
      pickCutLine(p, it.point, false);
      renderInspector(); renderSuggestPins();
      return;
    }
    placeFlatCut(it);
    renderInspector(); renderSuggestPins();
  }
  // Put the cut plane where a flat suggestion says, cutting only the areas that free its piece (the limb, plus a
  // strap over it) and leaving the rest joined.
  function placeFlatCut(it) {
    if (state.regions.on) setRegions(false);
    const pt = new THREE.Vector3(...it.point), n = new THREE.Vector3(...it.normal).normalize();
    if (n.dot(camera.position.clone().sub(pt)) < 0) n.negate(); // keep the clear side facing you
    planeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    planeGroup.position.set(pt.x, pt.y, pt.z);
    computeSliderRange();
    onPlaneMoved();
    state.cut.auto = true; state.cut.skip.clear(); state.cut.active = -1;
    state.cut.focus = it.areas && it.areas.length ? it.areas.map(a => new THREE.Vector3(...a)) : null;
    scheduleAnalysis(0);
  }
  // Cut at a spot: the next click on the chosen part finds the narrowest flat cut through that spot (the cleanest
  // for the piece it frees) and puts the cut plane there, as a suggestion does. It joins the suggestions list so
  // the pin and the text stay.
  function setHere(on) {
    state.here.on = on;
    if (on && state.across.on) state.across.on = false;
    canvas.classList.toggle('is-aiming', on || state.across.on);
    renderInspector(); updateHint();
  }
  function addHereSuggestion(part, it) { // the spot's cut joins the part's suggestions as the active one (one such at a time)
    const s = state.suggest && state.suggest.partId === part.id && state.suggest.status === 'done' ? state.suggest : { partId: part.id, status: 'done', progress: 1, items: [], active: -1 };
    s.items = s.items.filter(x => x.kind !== 'here').slice(0, 8);
    s.items.push(it);
    s.active = s.items.length - 1;
    state.suggest = s; suggestCache.set(part.id, s);
    placeFlatCut(it);
    renderInspector(); renderSuggestPins();
  }
  function cutHereAt(part, point) {
    setHere(false);
    if (part.id !== state.selectedId) selectPart(part.id);
    busy('Finding the narrowest cut through that spot');
    setTimeout(() => {
      let it = null;
      try { it = K.cutHere(part.positions, part.indices, point, K.diag(part.bbox)); } catch (err) { it = null; }
      busy(null);
      if (!it) { toast('No cut goes round that spot and frees a piece. Try a spot on a limb, a neck or an accessory.', 'error'); return; }
      addHereSuggestion(part, it);
      toast(`The narrowest cut through that spot is about ${fmt(it.width)} mm across and frees a piece of ${fmtVol(it.freed)}. Enter cuts it.`);
    }, 30);
  }
  function splitShells() {
    const p = selectedPart();
    if (!p) return;
    const shells = K.separateShells(p.positions, p.indices);
    if (shells.length < 2) { toast('This part is all one piece now, so there is nothing to split.'); return; }
    shells.sort((a, b) => b.volume - a.volume);
    const made = shells.map((sh, i) => makePart({ name: `${p.name} ${i + 1}`, color: i ? nextColor() : p.color, positions: sh.positions, indices: sh.indices }));
    const idx = state.parts.indexOf(p);
    commit(state.parts.slice(0, idx).concat(made, state.parts.slice(idx + 1)), 'the split');
    state.selectedId = null;
    syncScene();
    renderSuggestPins();
    toast(`Split into ${made.length} pieces. Click a piece to cut it.`);
  }
  if (pinLayer) pinLayer.addEventListener('click', (e) => { const b = e.target.closest('[data-pin]'); if (b) applySuggestion(+b.dataset.pin); });
  /* ---------------- history ---------------- */
  // Start over: the parts as the model was opened (or repaired, or the project saved), kept apart from any later
  // change, so one step brings the whole model back; the step can itself be undone.
  function snapshot(parts) { return parts.map(p => ({ ...p, positions: p.positions.slice(), indices: p.indices.slice(), joints: [] })); }
  function startOver() {
    if (!state.start) return;
    if (state.regions.on) setRegions(false);
    commit(snapshot(state.start).map(p => makePart({ name: p.name, color: p.color, positions: p.positions, indices: p.indices, kind: p.kind, pull: null })), 'starting over');
    state.selectedId = null; state.hidden.clear(); state.explode = 0; state.split.planes = null; state.joint = 1; state.cutId = 0;
    syncScene(); frameAll(); renderSplitPlanes();
    toast('Back to the model as it was opened. Ctrl+Z brings the cuts back.');
  }
  function commit(parts, label) {
    history.past.push({ parts: state.parts, label });
    if (history.past.length > 60) history.past.shift();
    history.future = [];
    state.parts = parts;
  }
  function undo() {
    if (!history.past.length) return;
    const h = history.past.pop();
    history.future.push({ parts: state.parts, label: h.label });
    state.parts = h.parts; state.selectedId = null;
    syncScene();
    toast('Undid ' + h.label + '.');
  }
  function redo() {
    if (!history.future.length) return;
    const h = history.future.pop();
    history.past.push({ parts: state.parts, label: h.label });
    state.parts = h.parts; state.selectedId = null;
    syncScene();
    toast('Redid ' + h.label + '.');
  }

  /* ---------------- loading ---------------- */
  const fileInput = $('#fileInput');
  function busy(msg) {
    const el = $('#busy');
    if (msg) { el.querySelector('span').textContent = msg; el.hidden = false; }
    else el.hidden = true;
  }
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));
  async function loadFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'stl' && ext !== 'obj' && ext !== 'zip') { toast('Keymaster opens STL and OBJ files, and its own saved projects (.keymaster.zip). Export your model in one of those formats, then open it here.', 'error'); return; }
    busy('Opening ' + file.name);
    await nextFrame();
    try {
      const buf = await file.arrayBuffer();
      if (ext === 'zip') { openProject(buf, file.name); return; }
      const raw = ext === 'stl' ? K.parseSTL(buf) : K.parseOBJ(new TextDecoder().decode(buf));
      setModel(file.name.replace(/\.[^.]+$/, ''), K.prepareMesh(raw));
    } catch (err) {
      toast(err.message || 'This file couldn’t be read.', 'error');
    } finally { busy(null); }
  }
  async function loadSample() {
    busy('Building the sample');
    await nextFrame();
    setModel('Sample knot', K.prepareMesh(K.torusKnot()));
    busy(null);
  }
  // The Largest key follows the model's size (about 3.5% of its longest side, 5 to 15 mm, as kits of that size use)
  // when a model is opened or scaled, until it's set by hand: on a figure scaled to 300 mm a 5 mm peg was a dot.
  function fitKeySizeToModel() {
    if (state.cfg.sizeByHand || !state.parts.length) return;
    const h = Math.max(...modelBounds().size), d = Math.min(15, Math.max(5, Math.round(h * 0.035 * 2) / 2));
    if (d === state.cfg.diameter) return;
    state.cfg.diameter = d;
    state.cfg.length = Math.max(1, Math.round(d * 1.2 * 2) / 2);
    savePrefs();
  }
  function setModel(name, m) {
    state.model = { name, report: m.report, tris: m.indices.length / 3 };
    state.nextColor = 1; state.joint = 1; state.cutId = 0;
    state.parts = [makePart({ name, color: PALETTE[0], positions: m.positions, indices: m.indices })];
    history.past = []; history.future = [];
    state.selectedId = null; state.hidden.clear(); state.explode = 0; state.split.planes = null;
    state.tool = 'plane'; state.ui.joints = null;
    $('#empty').hidden = true;
    fitKeySizeToModel();
    syncScene();
    frameAll();
    state.start = snapshot(state.parts);
    const specks = m.report.specks ? ` Removed ${m.report.specks} loose ${m.report.specks === 1 ? 'speck' : 'specks'} too small to print.` : '';
    if (!m.report.closed) { // a surface with gaps or tangles can't be cut: repair it now, rather than refuse later
      repairSurface(`This model’s surface had ${m.report.badEdges ? 'tangles' : 'gaps'}, so Keymaster repaired it.`);
      history.past = []; history.future = []; updateChrome();
      state.start = snapshot(state.parts); // the repaired model is the one to start over from
      return;
    }
    if (m.report.flipped) toast('The model was inside out, so Keymaster flipped it to print correctly.' + specks);
    else if (state.model.tris > 3e6) toast('This is a very dense model. Cuts may take a few seconds.' + specks, 'warn');
    else if (specks) toast(specks.trim());
  }
  function frameAll(target) {
    const b = target ? target.bbox : modelBounds();
    const c = new THREE.Vector3(...b.center);
    const R = Math.max(1, Math.hypot(...b.size) / 2);
    const dist = R / Math.sin((camera.fov * Math.PI) / 360) * 1.08;
    const dir = camera.position.clone().sub(orbit.target);
    if (dir.lengthSq() < 1e-9 || !target) dir.set(0.75, -1.25, 0.8);
    dir.normalize();
    camera.near = Math.max(0.05, R / 200); camera.far = R * 60; camera.updateProjectionMatrix();
    const fromPos = camera.position.clone(), fromTarget = orbit.target.clone();
    const toPos = c.clone().add(dir.multiplyScalar(dist));
    placeLights(b.center, R);
    animate(380, (k) => { camera.position.lerpVectors(fromPos, toPos, k); orbit.target.lerpVectors(fromTarget, c, k); });
  }

  /* ---------------- cutting ---------------- */
  async function doCut(force = false) { // force: the owner's "cut anyway", past the printability warnings
    const p = selectedPart();
    if (!p) return;
    if (state.regions.on) setRegions(false);
    if (state.cut.stale) runAnalysis();
    const an = state.cut.analysis;
    if (!an || an.base.error || !an.base.regions.length) {
      toast(an && an.base.error ? 'The surface is broken where this cut crosses it. Move the cut or repair the model.' : 'The cut plane doesn’t pass through this part. Slide it into the model first.', 'error');
      return;
    }
    const shownNow = shownAreas();
    if (shownNow.length && shownNow.every(i => state.cut.skip.has(i))) {
      toast('Every area is set to stay joined, so nothing would be cut. Click an area’s label to cut it.', 'error');
      return;
    }
    const thin = thinShown();
    if (thin.length && !force) {
      toast(K.thinMessage(an.base.regions, thin, minWall()), 'error', { label: 'Cut anyway', fn: () => doCut(true) });
      return;
    }
    const bad = state.cut.evals.filter(e => !e.ok).length;
    if (pointKeys() && bad) {
      toast(`${bad === 1 ? 'One key needs' : bad + ' keys need'} attention before cutting. Drag ${bad === 1 ? 'it' : 'them'} to a better spot or remove ${bad === 1 ? 'it' : 'them'}.`, 'error', { label: 'Remove', fn: removeBadKeys });
      return;
    }
    busy('Cutting ' + p.name);
    await nextFrame();
    let res;
    const F = currentFrame(), nrm = F.n;
    // joint numbers: the same number engraved on both faces of each area cut, clear of its keys
    const marks = [], numbered = [];
    if (state.cfg.numberJoints) {
      let num = state.joint;
      for (const ri of shownNow) {
        if (state.cut.skip.has(ri)) continue;
        const hasPlug = state.cfg.type === 'plug' && state.cut.plugs.some(q => q.ok && q.region === ri);
        const jm = hasPlug ? null : K.jointMarks(an.base, ri, pointKeys() ? state.cut.keys.filter(k => K.regionAt(an.base, k.x, k.y) === ri) : [], coreCfg(), num, { mirror: true });
        if (jm) { marks.push(...jm.marks); numbered.push(num); }
        num++;
      }
    }
    let unmarked = false;
    const cutWith = (mk) => K.cutMesh(p.positions, p.indices, F, { scale: K.diag(p.bbox), cfg: coreCfg(), keys: pointKeys() ? state.cut.keys : [], plugs: state.cfg.type === 'plug' ? state.cut.plugs.filter(q => q.ok && !state.cut.skip.has(q.region)) : [], skip: state.cut.skip, minThickness: minWall(), force, marks: mk });
    try { // pieces below pull along -n, above along +n (the exploded view)
      try { res = cutWith(marks); } catch (err) { if (!marks.length || err.code) throw err; res = cutWith([]); unmarked = true; } // the numbers didn't seal here: cut without them
    } catch (err) {
      busy(null);
      toast(err.message, 'error', err.code === 'locked' ? { label: 'Cut anyway', fn: () => doCut(true) } : undefined);
      return;
    }
    if (numbered.length && !unmarked) state.joint += shownNow.filter(ri => !state.cut.skip.has(ri)).length;
    const groups = { below: [], above: [], both: [] };
    for (const c of res.parts) groups[c.side].push(c);
    const made = [];
    const label = (side, i, count) => side === 'both' ? p.name : `${p.name} ${side === 'below' ? 'A' : 'B'}${count > 1 ? i + 1 : ''}`;
    let first = true;
    const joints = jointOf(p, { type: state.cfg.type, keys: res.keysUsed || 0, number: numbered.length && !unmarked ? numbered[0] : null });
    for (const side of ['both', 'below', 'above']) {
      groups[side].sort((a, b) => b.volume - a.volume);
      groups[side].forEach((c, i) => {
        made.push(makePart({ name: label(side, i, groups[side].length), color: first ? p.color : nextColor(), positions: c.positions, indices: c.indices, pull: side === 'below' ? [-nrm[0], -nrm[1], -nrm[2]] : side === 'above' ? nrm.slice() : null, joints }));
        first = false;
      });
    }
    res.pins.forEach((pin, i) => made.push(makePart({ name: `${p.name} pin ${i + 1}`, color: PIN_COLOR, positions: pin.positions, indices: pin.indices, kind: 'pin' })));
    const idx = state.parts.indexOf(p);
    const parts = state.parts.slice(0, idx).concat(made, state.parts.slice(idx + 1));
    commit(parts, 'the cut');
    const n = planeNormal();
    state.selectedId = null;
    busy(null);
    syncScene();
    // pieces spring apart briefly so the cut reads clearly
    const gap = state.cut.R * 0.12;
    made.forEach(mp => {
      const v = views.get(mp.id);
      if (!v) return;
      const c = mp.bbox.center, o = planeGroup.position;
      const s = (c[0] - o.x) * n.x + (c[1] - o.y) * n.y + (c[2] - o.z) * n.z >= 0 ? 1 : -1;
      const dir = n.clone().multiplyScalar(s * gap);
      animate(900, (k) => { const w = Math.sin(k * Math.PI) * (1 - k * 0.3); v.offset.copy(dir).multiplyScalar(w); applyExplode(); });
    });
    const pieces = made.filter(m => m.kind !== 'pin').length;
    if (res.warnings && res.warnings.length) toast(`Cut made anyway, into ${pieces} pieces. ${res.warnings.map(w => w.message).join(' ')}`, 'warn');
    else toast(`Cut into ${pieces} pieces${res.pins.length ? ` and ${res.pins.length} dowel pins` : ''}${numbered.length && !unmarked ? `, ${numbered.length === 1 ? `joint numbered ${numbered[0]}` : `joints numbered ${numbered.join(', ')}`}` : ''}.${unmarked ? ' The joint numbers didn’t fit here, so this cut has none.' : ''} Click a part to keep cutting.`);
  }
  function removeBadKeys() {
    state.cut.keys = state.cut.keys.filter((k, i) => state.cut.evals[i] && state.cut.evals[i].ok);
    state.cut.auto = false; state.cut.active = -1;
    evaluateKeys(); renderKeyMarkers(); renderInspector();
  }

  /* ---------------- model operations ---------------- */
  function transformAll(fn, label) {
    const parts = state.parts.map(p => makePart({ ...p, positions: K.transformPositions(p.positions, fn) }));
    commit(parts, label);
    state.selectedId = null;
    syncScene();
    frameAll();
  }
  function rotateAll(axis) {
    const c = modelBounds().center;
    const fn = axis === 'x' ? (x, y, z) => [x, c[1] - (z - c[2]), c[2] + (y - c[1])]
      : axis === 'y' ? (x, y, z) => [c[0] + (z - c[2]), y, c[2] - (x - c[0])]
        : (x, y, z) => [c[0] - (y - c[1]), c[1] + (x - c[0]), z];
    transformAll(fn, 'the turn');
  }
  function scaleAll(f) {
    if (!(f > 0) || !isFinite(f)) return;
    transformAll((x, y, z) => [x * f, y * f, z * f], 'the scale change');
    fitKeySizeToModel();
    renderInspector();
  }
  // Repair every part's surface: faces stored twice, parts welded along a seam, patches facing the wrong way,
  // loose slivers, pinched vertices and holes, in that order. Says what it did, and what it couldn't.
  function repairSurface(lead = '') {
    const sum = { duplicates: 0, untangled: 0, pinched: 0, flipped: 0, slivers: 0, filled: 0 };
    let open = 0, bad = 0;
    const parts = state.parts.map(p => {
      const r = K.repairMesh(p.positions, p.indices);
      for (const k of Object.keys(sum)) sum[k] += r[k];
      open += r.report.openEdges; bad += r.report.badEdges;
      return makePart({ ...p, positions: r.positions, indices: r.indices });
    });
    commit(parts, 'the repair');
    state.model.report = { ...state.model.report, openEdges: open, badEdges: bad, closed: open === 0 && bad === 0 };
    syncScene();
    const did = [];
    if (sum.untangled) did.push(`untangled ${sum.untangled} ${sum.untangled === 1 ? 'edge' : 'edges'} where surfaces were welded together`);
    if (sum.pinched) did.push(`separated ${sum.pinched} ${sum.pinched === 1 ? 'point' : 'points'} where surfaces touched`);
    if (sum.flipped) did.push(`turned ${sum.flipped} ${sum.flipped === 1 ? 'face' : 'faces'} the right way`);
    if (sum.duplicates) did.push(`removed ${sum.duplicates} ${sum.duplicates === 1 ? 'face' : 'faces'} stored twice`);
    if (sum.slivers) did.push(`dropped ${sum.slivers} loose ${sum.slivers === 1 ? 'sliver' : 'slivers'}`);
    if (sum.filled) did.push(`filled ${sum.filled} ${sum.filled === 1 ? 'hole' : 'holes'}`);
    const what = did.length ? did[0].charAt(0).toUpperCase() + did[0].slice(1) + (did.length > 1 ? ', ' + did.slice(1).join(', ') : '') + '.' : 'Nothing needed repairing.';
    const closed = open === 0 && bad === 0;
    const head = lead ? lead + ' ' : '';
    toast(closed ? `${head}${what} The model is closed now.` : `${head}${what} ${fmtInt(open + bad)} ${open + bad === 1 ? 'edge is' : 'edges are'} still open or tangled; that needs Blender or Meshmixer. Cuts away from them still work.`, closed ? '' : 'warn');
  }

  // Reduce detail: every part collapsed to fewer triangles within the chosen tolerance (quadric edge collapse in
  // core), one undo step, so dense sculpts paint and cut faster. The parts keep their names, colours and pulls.
  async function reduceModel() {
    const tol = Math.max(0.005, parseFloat(($('#reduceLevel') || {}).value) || state.reduce);
    state.reduce = tol;
    busy('Reducing the detail');
    await nextFrame();
    const before = state.parts.reduce((s, p) => s + p.tris, 0), parts = [];
    for (const p of state.parts) {
      if (p.kind === 'pin') { parts.push(p); continue; }
      const r = K.reduceMesh(p.positions, p.indices, { tolerance: tol });
      parts.push(r.removed ? makePart({ ...p, positions: r.positions, indices: r.indices }) : p);
      await nextFrame();
    }
    const after = parts.reduce((s, p) => s + p.tris, 0);
    busy(null);
    if (after >= before) { toast('Nothing to take out at this setting: the model is already as light as it gets within that tolerance. Try Strong.'); return; }
    commit(parts, 'the reduction');
    state.selectedId = null; endSeamEdit(); clearPick(); state.regions.last = null;
    regionCache.clear(); lineCache.clear();
    syncScene(); renderPick(); updateHint();
    toast(`Reduced from ${fmtInt(before)} to ${fmtInt(after)} triangles (${Math.round(100 - 100 * after / before)}% fewer), keeping the surface within ${tol} mm. Ctrl+Z puts the detail back.`);
  }
  /* ---------------- export ---------------- */
  // Pictures for the assembly sheet, drawn off screen with the view's renderer: each part alone, and all the parts
  // spread apart along their cuts, lit as in the view and seen from the front and a little above, as PNG data URLs.
  // Null where the renderer can't draw to a target (the test harness without a graphics card).
  function picture(items, w, h) {
    if (!THREE.WebGLRenderTarget || typeof renderer.readRenderTargetPixels !== 'function' || !items.length) return null;
    const sc = new THREE.Scene();
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const meshes = [];
    for (const { p, at } of items) {
      const v = views.get(p.id);
      if (!v) continue;
      const m = new THREE.Mesh(v.geom, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75, metalness: 0, flatShading: state.flat }));
      m.position.set(at[0], at[1], at[2]);
      sc.add(m); meshes.push(m);
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.bbox.min[i] + at[i]); mx[i] = Math.max(mx[i], p.bbox.max[i] + at[i]); }
    }
    if (!meshes.length) return null;
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], R = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 || 1;
    sc.add(new THREE.HemisphereLight(0xffffff, 0x5a5f66, 0.85));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.85); l1.position.set(c[0] + R * 1.2, c[1] - R * 1.6, c[2] + R * 2.2);
    const l2 = new THREE.DirectionalLight(0xe4ecff, 0.32); l2.position.set(c[0] - R * 2, c[1] + R * 0.6, c[2] + R * 0.4);
    sc.add(l1, l2);
    const cam = new THREE.PerspectiveCamera(30, w / h, R / 50, R * 20);
    cam.up.set(0, 0, 1);
    const d = R / Math.sin(cam.fov / 2 * Math.PI / 180) * 1.05, dir = new THREE.Vector3(0.55, -1, 0.5).normalize();
    cam.position.set(c[0] + dir.x * d, c[1] + dir.y * d, c[2] + dir.z * d); cam.lookAt(new THREE.Vector3(c[0], c[1], c[2])); cam.updateProjectionMatrix();
    const target = new THREE.WebGLRenderTarget(w, h), prev = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    const clip = renderer.localClippingEnabled; renderer.localClippingEnabled = false;
    renderer.setRenderTarget(target); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(sc, cam);
    const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
    renderer.setRenderTarget(prev); renderer.setClearColor(0x000000, 0); renderer.localClippingEnabled = clip;
    target.dispose(); for (const m of meshes) m.material.dispose();
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // the target's rows run bottom up
    ctx.putImageData(img, 0, 0);
    markDirty();
    return cv.toDataURL('image/png');
  }
  function partPicture(p) { return picture([{ p, at: [0, 0, 0] }], 320, 240); }
  // The exploded model, as the exploded view at a little over half way
  function assemblyPicture(list) {
    const b = modelBounds(), D = Math.hypot(...b.size);
    const items = list.map(p => ({ p, at: explodeOffset(p, 0.6, b, D) }));
    return picture(items, 800, 560);
  }
  function safeName(s) { return (s || 'part').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'part'; }
  // Export: every part as an STL in a ZIP (the default), all parts in one 3MF, or the STLs with an assembly sheet.
  async function exportParts(onlyId, format) {
    const list = onlyId ? state.parts.filter(p => p.id === onlyId) : state.parts;
    if (!list.length) return;
    const fmt3 = format || ($('#exportFormat') ? $('#exportFormat').value : 'zip');
    const base = safeName(state.model ? state.model.name : 'model') + (onlyId ? '-' + safeName(list[0].name) : '-parts');
    if (fmt3 === '3mf') {
      const data = K.make3MF(list), filename = base + '.3mf';
      if (await saveFile(filename, new Blob([data], { type: 'model/3mf' }), false)) toast(`Saved ${filename} with ${list.length} ${list.length === 1 ? 'part' : 'parts'} in one file.`);
      return;
    }
    const used = new Set();
    const files = list.map(p => {
      let n = safeName(p.name), k = 2;
      while (used.has(n)) n = safeName(p.name) + '-' + k++;
      used.add(n);
      return { name: n + '.stl', data: new Uint8Array(K.writeSTL(p.positions, p.indices, p.name)) };
    });
    if (fmt3 === 'sheet') {
      const pictured = list.map(p => ({ ...p, image: partPicture(p) })); // the sheet shows each part and the pieces spread apart
      files.push({ name: 'assembly.html', data: new TextEncoder().encode(K.assemblySheet(pictured, { name: state.model ? state.model.name : 'Model', bed: state.bed, date: new Date().toLocaleDateString(), image: list.length > 1 ? assemblyPicture(list) : null })) });
    }
    const zip = K.makeZip(files), filename = base + '.zip';
    if (await saveFile(filename, new Blob([zip], { type: 'application/zip' }), true)) toast(`Saved ${filename} with ${list.length} STL ${list.length === 1 ? 'file' : 'files'}${fmt3 === 'sheet' ? ' and the assembly sheet' : ''}.`);
  }
  // Save a file: through the downloads capability when it's there and the kind is allowed (ZIP), else a plain link
  async function saveFile(filename, blob, allowed) {
    if (downloads && allowed) {
      try { await downloads.save({ filename, data: blob }); return true; } catch (err) {
        if (err && err.code === 'declined') return false;
        if (err && err.code === 'rate_limited') { toast('A save is already waiting for your answer.', 'warn'); return false; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  // Projects: every part with its name, colour, pull and joints, plus the settings, in one ZIP to open later.
  async function saveProject() {
    if (!state.parts.length) return;
    const name = state.model ? state.model.name : 'model';
    const data = K.packProject(state.parts, { name, bed: state.bed, cfg: state.cfg, joint: state.joint, cutId: state.cutId, reduce: state.reduce, saved: new Date().toISOString() });
    const filename = safeName(name) + '.keymaster.zip';
    if (await saveFile(filename, new Blob([data], { type: 'application/zip' }), true)) toast(`Saved the project as ${filename}: ${state.parts.length} ${state.parts.length === 1 ? 'part' : 'parts'} and your settings. Open it here any time to carry on.`);
  }
  function openProject(buf, filename) {
    const pr = K.unpackProject(buf);
    const parts = pr.parts.map(q => makePart({ name: q.name, color: q.color || nextColor(), positions: q.positions, indices: q.indices, kind: q.kind, pull: q.pull, joints: q.joints }));
    const open = pr.parts.reduce((s, q) => s + (q.report ? q.report.openEdges + q.report.badEdges : 0), 0);
    state.model = { name: pr.name || filename.replace(/\.keymaster\.zip$|\.zip$/i, ''), report: { closed: open === 0, openEdges: open, badEdges: 0 }, tris: parts.reduce((s, q) => s + q.tris, 0) };
    state.nextColor = parts.length + 1;
    state.parts = parts;
    if (pr.bed) Object.assign(state.bed, pr.bed);
    if (pr.cfg) Object.assign(state.cfg, pr.cfg);
    state.joint = pr.joint || 1; state.cutId = pr.cutId || 0; if (pr.reduce) state.reduce = pr.reduce;
    history.past = []; history.future = [];
    state.selectedId = null; state.hidden.clear(); state.explode = 0; state.split.planes = null;
    $('#empty').hidden = true;
    savePrefs();
    syncScene(); frameAll(); updateChrome();
    state.start = snapshot(state.parts);
    toast(`Opened the project: ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}, with the settings as saved.`);
  }

  /* ---------------- pointer interaction ---------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function planeHit(e) {
    setNdc(e);
    const n = planeNormal();
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, planeGroup.position);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(pl, hit)) return null;
    planeGroup.updateMatrixWorld(true);
    const local = planeGroup.worldToLocal(hit.clone());
    return { x: local.x, y: local.y };
  }
  function pickKey(e) {
    if (!selectedPart() || !pointKeys()) return -1;
    const r = canvas.getBoundingClientRect();
    planeGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    let best = -1, bestD = coarse ? 26 : 16;
    state.cut.keys.forEach((k, i) => {
      const w = planeGroup.localToWorld(new THREE.Vector3(k.x, k.y, 0)).project(camera);
      const sx = (w.x + 1) / 2 * r.width + r.left, sy = (1 - w.y) / 2 * r.height + r.top;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function cameraOnClearSide() {
    const n = planeNormal();
    return n.dot(camera.position.clone().sub(planeGroup.position)) > 0;
  }
  const ptr = { down: false, x: 0, y: 0, t: 0, dragKey: -1, ring: null, hoverRing: null, tilt: null, sheet: null, handle: null, across: null };
  function toScreen(v) {
    const r = canvas.getBoundingClientRect();
    const q = v.clone().project(camera);
    return [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height];
  }
  // A point on a tilt ring, in the plane's local space: the x ring sweeps through local y and z, the y ring through x and z.
  function ringLocal(ax, a) { const R = ringRadius(); return ax === 'x' ? new THREE.Vector3(0, R * Math.cos(a), R * Math.sin(a)) : new THREE.Vector3(R * Math.cos(a), 0, R * Math.sin(a)); }
  function pickRing(e) {
    if (!selectedPart()) return null;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    planeGroup.updateMatrixWorld(true); camera.updateMatrixWorld();
    let best = null, bestD = coarse ? 22 : 11;
    for (const ax of ['x', 'y']) {
      let prev = null;
      for (let i = 0; i <= 96; i++) {
        const w = planeGroup.localToWorld(ringLocal(ax, (i / 96) * Math.PI * 2));
        const q = w.clone().project(camera);
        const s = q.z > 1 ? null : [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height];
        if (s && prev) {
          const dx = s[0] - prev[0], dy = s[1] - prev[1], L = dx * dx + dy * dy;
          let k = L > 0 ? ((mx - prev[0]) * dx + (my - prev[1]) * dy) / L : 0; k = Math.max(0, Math.min(1, k));
          const d = Math.hypot(prev[0] + k * dx - mx, prev[1] + k * dy - my);
          if (d < bestD) { bestD = d; best = { ax, a: ((i - 1 + k) / 96) * Math.PI * 2 }; }
        }
        prev = s;
      }
    }
    return best;
  }
  function setRingHover(ax) {
    if (ptr.hoverRing === ax) return;
    ptr.hoverRing = ax;
    for (const k of ['x', 'y']) rings[k].material.color.set(k === ax ? RING_HOVER : RING_COLOR);
    markDirty();
  }
  function ringAxisWorld(ax) { return new THREE.Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, 0).applyQuaternion(planeGroup.quaternion).normalize(); }
  function angleOnRing(e, d) { // where the pointer is around the ring, when the ring faces the camera well enough
    setNdc(e);
    if (Math.abs(raycaster.ray.direction.dot(d.axis)) < 0.22) return null;
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(d.axis, d.center), hit)) return null;
    const v = hit.sub(d.center);
    return Math.atan2(v.dot(d.b2), v.dot(d.b1));
  }
  function startRing(hit, e) {
    const axis = ringAxisWorld(hit.ax), center = planeGroup.position.clone();
    const b1 = planeGroup.localToWorld(ringLocal(hit.ax, hit.a)).sub(center).normalize();
    const b2 = new THREE.Vector3().crossVectors(axis, b1).normalize();
    ptr.ring = { ax: hit.ax, axis, center, b1, b2, q0: planeGroup.quaternion.clone(), raw: 0, grab: 0, last: null, lx: e.clientX, ly: e.clientY };
    ptr.ring.last = angleOnRing(e, ptr.ring);
    orbit.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    state.cut.stale = true;
    renderKeyMarkers();
  }
  function moveRing(e) {
    const d = ptr.ring;
    const a = angleOnRing(e, d);
    let dA;
    if (a !== null && d.last !== null) { dA = a - d.last; if (dA > Math.PI) dA -= 2 * Math.PI; if (dA < -Math.PI) dA += 2 * Math.PI; }
    else { // seen edge-on: turn the ring by however far the pointer moves along it on screen
      const p = d.center.clone().add(d.b1.clone().multiplyScalar(Math.cos(d.grab) * ringRadius())).add(d.b2.clone().multiplyScalar(Math.sin(d.grab) * ringRadius()));
      const tng = new THREE.Vector3().crossVectors(d.axis, p.clone().sub(d.center));
      const s0 = toScreen(p), s1 = toScreen(p.clone().add(tng.multiplyScalar(0.01)));
      const tx = (s1[0] - s0[0]) / 0.01, ty = (s1[1] - s0[1]) / 0.01, L2 = Math.max(tx * tx + ty * ty, 400);
      dA = ((e.clientX - d.lx) * tx + (e.clientY - d.ly) * ty) / L2;
    }
    d.last = a; d.lx = e.clientX; d.ly = e.clientY; d.grab += dA;
    d.raw += dA;
    const step = Math.PI / 36; // Shift snaps to 5°
    d.applied = e.shiftKey ? Math.round(d.raw / step) * step : d.raw;
    planeGroup.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(d.axis, d.applied).multiply(d.q0));
    showDragChip(e, `${d.applied >= 0 ? '+' : '−'}${Math.abs(d.applied * 180 / Math.PI).toFixed(e.shiftKey ? 0 : 1)}°`);
    onPlaneMoved();
  }
  function endRing() {
    ptr.ring = null;
    orbit.enabled = true;
    canvas.style.cursor = '';
    showDragChip(null);
    computeSliderRange();
    state.cut.skip.clear();
    scheduleAnalysis(40);
    renderInspector();
  }
  const dragChip = $('#dragChip');
  function showDragChip(e, text) {
    if (!dragChip) return;
    if (!e) { dragChip.hidden = true; return; }
    const r = stage.getBoundingClientRect();
    dragChip.textContent = text;
    dragChip.hidden = false;
    dragChip.style.transform = `translate(${Math.round(e.clientX - r.left + 16)}px, ${Math.round(e.clientY - r.top - 34)}px)`;
  }
  // For the interface tests: where a tilt ring is on screen.
  window.KeymasterDebug = { markerBounds() { const out = []; for (const g of keyGroup.children) for (const m of g.children) { if (!m.geometry || !m.geometry.attributes.position) continue; const a = m.geometry.attributes.position.array, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); } out.push({ kind: m instanceof THREE.Mesh ? 'Mesh' : 'Line', min: [min[0] + g.position.x, min[1] + g.position.y, min[2]], max: [max[0] + g.position.x, max[1] + g.position.y, max[2]] }); } return out; }, plugRings() { return plugsShown().filter(q => q.ok).map(q => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of q.base) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x: q.x, y: q.y, min: [x0, y0], max: [x1, y1], depth: q.depth }; }); }, async boolean(op) { if (op) state.bool.op = op; if (state.tool !== 'boolean') setTool('boolean'); const sh = booleanShape(); const part = await doBoolean(); return part ? { name: part.name, tris: part.tris, volume: part.volume, closed: K.edgeReport(part.indices).closed, parts: state.parts.length, tool: state.tool, shape: sh ? sh.name : null } : { error: $('#toast').innerText, parts: state.parts.length, tool: state.tool, shape: sh ? sh.name : null }; }, addShape(kind) { const p = addShape(kind); return { id: p.id, name: p.name, size: p.bbox.size, tris: p.tris }; }, setShape(fields) { const p = setShape(fields); return p ? { size: p.bbox.size, center: p.bbox.center, tris: p.tris, volume: p.volume, closed: K.edgeReport(p.indices).closed } : null; }, shapeMode(m) { state.shapeMode = m; attachGizmo(); renderInspector(); return tc.mode; }, panelWidths, setPanelWidth(side, px) { setPanelWidth(side, px); savePanels(); renderInspector(); return panelWidths(); }, cameraDir() { const d = camera.position.clone().sub(orbit.target).normalize(); return [d.x, d.y, d.z]; }, setTool(t) { setTool(t); return state.tool; }, tool() { return state.tool; }, cutAcross(x0, y0, x1, y1) { const r = canvas.getBoundingClientRect(); setAcross(true); const out = cutAcross(r.left + x0, r.top + y0, r.left + x1, r.top + y1); return out ? { ...out, selected: !!selectedPart(), regions: state.regions.on } : null; }, movePick(dir, mm) { if (mm) { state.moveBy = mm; const i = $('#moveLineBy'); if (i) i.value = mm; } movePick(dir); const pk = state.regions.pick; return pk ? { ok: !!pk.result, error: pk.error || '', loops: pk.loops.length, length: pk.loops.reduce((s, l) => s + l.length, 0) } : null; }, flatHere() { flatFromPick(); return { regions: state.regions.on, focus: state.cut.focus ? state.cut.focus.length : 0 }; }, paintMode(mode) { state.paint.mode = mode; renderPaintTools(); updateHint(); return state.paint.mode; }, paintFill(on) { state.paint.fill = !!on; renderPaintTools(); updateHint(); return state.paint.fill; }, regionTriangles(partIndex, point) { const part = state.parts[partIndex], seg = regionsFor(part), g = seg.groupOf[K.nearestTriangle(part.positions, part.indices, point)]; let n = 0; for (const x of seg.groupOf) if (x === g) n++; return n; }, paintIsolate() { paintEdit('paint-isolate'); const p = selectedPart(), v = p && views.get(p.id); return { shown: v && v.isoMap ? v.isoMap.length : 0, isolated: !!state.paint.iso }; }, paintShowAll() { paintEdit('paint-show'); const p = selectedPart(), v = p && views.get(p.id); return { indexed: !!(v && v.geom.index), isolated: !!state.paint.iso }; }, inlayCut() { inlayFromPick(); return true; }, splitPlan() { planSplit(null); const b = modelBounds(); return state.split.planes ? { planes: state.split.planes.map(q => [q.axis, +q.pos.toFixed(2)]), ...K.bedFit(b, state.split.planes, state.bed, SPLIT_MARGIN) } : null; }, seamEdit() { startSeamEdit(); return state.edit ? state.edit.loops.map(l => l.pts.length) : null; }, seamDrag(li, i, point) { moveHandle(li, i, point); ptr.handle = { li, i }; endHandle(); const pk = state.regions.pick; return pk ? { ok: !!pk.result, error: pk.error || '', length: pk.loops.reduce((s, l) => s + l.length, 0), handle: state.edit.loops[li].pts[i] } : null; }, seamSmooth(passes) { smoothSeam(passes); const pk = state.regions.pick; return pk ? { ok: !!pk.result, length: pk.loops.reduce((s, l) => s + l.length, 0) } : null; }, cutHereAt(partIndex, point) { const part = state.parts[partIndex]; const it = K.cutHere(part.positions, part.indices, point, K.diag(part.bbox)); if (!it) return null; addHereSuggestion(part, it); return { width: it.width, freed: it.freed, areas: it.areas.length, normal: it.normal }; }, explodeOffsets() { return state.parts.map(p => { const v = views.get(p.id); return { pull: p.pull, at: v ? [v.mesh.position.x - v.offset.x, v.mesh.position.y - v.offset.y, v.mesh.position.z - v.offset.z] : null }; }); }, regionClick(partIndex, point) { regionClick(state.parts[partIndex], point); return { selected: state.selectedId === state.parts[partIndex].id, picked: !!state.regions.pick }; }, sizeByHand(flag) { state.cfg.sizeByHand = !!flag; if (!flag) fitKeySizeToModel(); renderInspector(); return state.cfg.diameter; }, paintAt(partIndex, point, erase = false) { const part = state.parts[partIndex]; if (!state.paint.on) setPainting(true); paintDab(part, point, -1, erase); return paintCount(); }, paintLetGo() { previewPainted(); const pk = state.regions.pick; return pk ? { preview: !!pk.preview, loops: pk.loops.length, error: pk.error || '' } : null; }, paintDone() { pickPainted(); const pk = state.regions.pick; return pk ? { ok: !!pk.result, error: pk.error || '', loops: pk.loops.length, pieces: pk.result ? pk.result.parts.length : 0, painted: !!pk.painted, count: paintCount() } : { count: paintCount() }; }, paintEdit(act) { paintEdit(act); return paintCount(); }, drawPoint(partIndex, point) { const part = state.parts[partIndex]; if (!state.draw.on) setDrawing(true); addDrawPoint(part, point); return state.draw.points.length; }, closeDrawing() { closeDrawing(); const pk = state.regions.pick; return pk ? { ok: !!pk.result, error: pk.error || '', loops: pk.loops.length, pieces: pk.result ? pk.result.parts.length : 0, drawing: state.draw.on } : { drawing: state.draw.on }; }, pickCutLineAt(partIndex, point, add = false) { const part = state.parts[partIndex]; if (add && state.regions.last && state.regions.last.partId === part.id) state.regions.last.clicks.push(point); else state.regions.last = { partId: part.id, clicks: [point] }; pickCutLine(part, point, add); const pk = state.regions.pick; return pk ? { closed: pk.loop ? pk.loop.closed : false, ok: !!pk.result, error: pk.error || '', region: pk.region, regions: pk.regions ? pk.regions.length : 0, loops: pk.loops.length, pieces: pk.result ? pk.result.parts.length : 0, forced: !!pk.forced } : null; }, keyScreenPoint(i) { const k = state.cut.keys[i]; if (!k) return null; planeGroup.updateMatrixWorld(true); camera.updateMatrixWorld(); const r = canvas.getBoundingClientRect(), s = toScreen(planeGroup.localToWorld(new THREE.Vector3(k.x, k.y, 0))); return [s[0] + r.left, s[1] + r.top]; }, keyCount() { return state.cut.keys.length; }, sheetScreenPoint(fx, fy) { planeGroup.updateMatrixWorld(true); camera.updateMatrixWorld(); const r = canvas.getBoundingClientRect(), s = toScreen(planeGroup.localToWorld(new THREE.Vector3(fx * state.cut.R, fy * state.cut.R, 0))); return [s[0] + r.left, s[1] + r.top]; }, ringScreenPoint(ax, deg) { planeGroup.updateMatrixWorld(true); camera.updateMatrixWorld(); const r = canvas.getBoundingClientRect(), s = toScreen(planeGroup.localToWorld(ringLocal(ax, deg * Math.PI / 180))); return [s[0] + r.left, s[1] + r.top]; } };
  function onSheet(h) { const half = state.cut.R * 1.15; return h && Math.abs(h.x) <= half && Math.abs(h.y) <= half; }
  function startTilt(h, e) {
    const L = Math.hypot(h.x, h.y);
    const dir = L > 1e-6 ? { x: h.x / L, y: h.y / L } : { x: 1, y: 0 };
    ptr.tilt = { dir, lever: Math.max(L, state.cut.R * 0.35), lastX: e.clientX, lastY: e.clientY };
    orbit.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    const half = state.cut.R * 1.15, z = Math.max(0.03, state.cut.R * 0.0009);
    hinge.geometry.dispose();
    hinge.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(dir.y * half, -dir.x * half, z), new THREE.Vector3(-dir.y * half, dir.x * half, z)]);
    hinge.visible = true;
    state.cut.stale = true;
    renderKeyMarkers();
  }
  function moveTilt(e) {
    const t = ptr.tilt;
    const dx = e.clientX - t.lastX, dy = e.clientY - t.lastY;
    t.lastX = e.clientX; t.lastY = e.clientY;
    if (!dx && !dy) return;
    planeGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const n = planeNormal();
    const pw = planeGroup.localToWorld(new THREE.Vector3(t.dir.x * t.lever, t.dir.y * t.lever, 0));
    const eps = t.lever * 0.05;
    const a = toScreen(pw), b = toScreen(pw.clone().add(n.clone().multiplyScalar(eps)));
    const sx = (b[0] - a[0]) / eps, sy = (b[1] - a[1]) / eps; // screen pixels per mm along the normal
    const view = pw.clone().sub(camera.position).normalize();
    let perp = new THREE.Vector3().crossVectors(view, n);
    if (perp.lengthSq() < 1e-6) perp = new THREE.Vector3().crossVectors(view, new THREE.Vector3(1, 0, 0));
    perp.normalize();
    const c = toScreen(pw.clone().add(perp.multiplyScalar(eps)));
    const pxPerMm = Math.max(1e-6, Math.hypot(c[0] - a[0], c[1] - a[1]) / eps);
    const s2 = sx * sx + sy * sy;
    // Move the grabbed edge along the normal by however far the mouse moved in that direction on screen.
    const lift = s2 > Math.pow(pxPerMm * 0.25, 2) ? (dx * sx + dy * sy) / s2 : -dy / pxPerMm;
    const theta = Math.atan2(lift, t.lever) * (e.shiftKey ? 0.25 : 1);
    planeGroup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(t.dir.y, -t.dir.x, 0), theta));
    const ti = tiltInfo();
    showDragChip(e, ti.deg < 0.05 ? `Square to ${ti.axis}` : `${ti.deg.toFixed(1)}° off ${ti.axis}`);
    onPlaneMoved();
  }
  function endTilt() {
    ptr.tilt = null;
    hinge.visible = false;
    orbit.enabled = true;
    canvas.style.cursor = '';
    showDragChip(null);
    computeSliderRange();
    state.cut.skip.clear();
    scheduleAnalysis(40);
    renderInspector();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (tc.dragging || tc.axis) return;
    ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = performance.now(); ptr.dragKey = -1; ptr.ring = null; ptr.tilt = null; ptr.sheet = null;
    if (e.altKey) return; // Alt-drag always orbits
    if (state.tool === 'bed' || state.tool === 'shape' || state.tool === 'boolean') return; // the bed planes, the shapes and the booleans are worked from the panel and the gizmo: drags orbit
    if (state.across.on) { ptr.across = { x: e.clientX, y: e.clientY }; orbit.enabled = false; canvas.setPointerCapture(e.pointerId); showAcrossLine(e.clientX, e.clientY, e.clientX, e.clientY); return; }
    if (state.regions.on) { // the cut plane is hidden while surface regions show: drags orbit, clicks pick lines, or paint
      if (state.paint.on && paintAt(e, e.shiftKey)) { ptr.paint = true; orbit.enabled = false; canvas.setPointerCapture(e.pointerId); return; }
      const hd = handleAt(e);
      if (hd) { ptr.handle = hd; orbit.enabled = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; }
      return;
    }
    const ring = pickRing(e);
    if (ring) { startRing(ring, e); return; }
    const k = pickKey(e);
    if (k >= 0) {
      ptr.dragKey = k;
      state.cut.active = k;
      orbit.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      renderKeyMarkers();
      return;
    }
    // On the plane: a drag tips it like the edge of a tray, a plain click falls through to adding a key
    const h = selectedPart() ? planeHit(e) : null;
    if (onSheet(h)) { ptr.sheet = { h, id: e.pointerId }; orbit.enabled = false; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ptr.ring) { moveRing(e); return; }
    if (ptr.tilt) { moveTilt(e); return; }
    if (ptr.sheet && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 4) {
      const s = ptr.sheet; ptr.sheet = null;
      startTilt(s.h, { clientX: ptr.x, clientY: ptr.y, pointerId: s.id });
      moveTilt(e);
      return;
    }
    if (ptr.paint) { paintAt(e, e.shiftKey); return; }
    if (ptr.handle) { dragHandle(e); return; }
    if (ptr.across) { showAcrossLine(ptr.across.x, ptr.across.y, e.clientX, e.clientY); return; }
    if (state.tool === 'bed' || state.tool === 'shape' || state.tool === 'boolean') { if (!ptr.down) canvas.style.cursor = ''; return; }
    if (state.regions.on) { if (!ptr.down) { canvas.style.cursor = state.paint.on ? 'crosshair' : handleAt(e) ? 'grab' : ''; if (state.paint.on) hoverBrush(e); } return; } // nothing on the hidden plane to grab
    if (!ptr.down && selectedPart() && !tc.dragging) {
      const ring = tc.axis ? null : pickRing(e);
      setRingHover(ring ? ring.ax : null);
      if (ring) { canvas.style.cursor = 'grab'; return; }
    }
    if (ptr.dragKey >= 0) {
      const h = planeHit(e);
      if (!h) return;
      Object.assign(state.cut.keys[ptr.dragKey], { x: h.x, y: h.y }); // keeps the key's own settings
      state.cut.auto = false;
      evaluateKeys(); renderKeyMarkers();
      return;
    }
    if (!ptr.down && selectedPart()) canvas.style.cursor = pickKey(e) >= 0 ? 'grab' : joinedAreaAt(e) >= 0 ? 'pointer' : e.altKey ? '' : onSheet(planeHit(e)) ? 'grab' : '';
  });
  function joinedAreaAt(e) {
    if (!state.cut.skip.size || !state.cut.analysis || state.cut.stale || !cameraOnClearSide()) return -1;
    const h = planeHit(e);
    const ri = h ? K.regionAt(state.cut.analysis.base, h.x, h.y) : -1;
    return state.cut.skip.has(ri) ? ri : -1;
  }
  // Cut across the view (modelsplitter's Line tool): drag a straight line across the model on screen, and the cut
  // plane is set through it along the line of sight, so what you see cut is what gets cut (turn the model to check
  // the back). The plane holds the two rays from the eye through the line's ends; it sits where the middle of the
  // line meets the model, or at the model's middle if the line misses it.
  function setAcross(on) {
    state.across.on = on;
    if (on && state.here.on) setHere(false);
    canvas.classList.toggle('is-aiming', on || state.here.on);
    renderInspector(); updateHint();
  }
  const acrossLine = $('#acrossLine');
  function showAcrossLine(x0, y0, x1, y1) {
    if (!acrossLine) return;
    if (x0 === null) { acrossLine.hidden = true; return; }
    const r = canvas.getBoundingClientRect(), ln = acrossLine.querySelector('line');
    ln.setAttribute('x1', x0 - r.left); ln.setAttribute('y1', y0 - r.top); ln.setAttribute('x2', x1 - r.left); ln.setAttribute('y2', y1 - r.top);
    acrossLine.hidden = false;
  }
  function cutAcross(x0, y0, x1, y1) {
    setAcross(false);
    const r = canvas.getBoundingClientRect();
    const rayAt = (x, y) => { ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); raycaster.setFromCamera(ndc, camera); return raycaster.ray.direction.clone(); };
    const d0 = rayAt(x0, y0), d1 = rayAt(x1, y1), n = new THREE.Vector3().crossVectors(d0, d1);
    if (n.lengthSq() < 1e-12) { toast('Drag a longer line across the model.', 'warn'); return null; }
    n.normalize();
    // where the plane sits: the model under the line's middle, or the model's middle brought onto the plane
    ndc.set((((x0 + x1) / 2 - r.left) / r.width) * 2 - 1, -(((y0 + y1) / 2 - r.top) / r.height) * 2 + 1); raycaster.setFromCamera(ndc, camera);
    const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh), hit = raycaster.intersectObjects(meshes, false)[0];
    let p = selectedPart();
    if (hit) { const part = state.parts.find(q => q.id === hit.object.userData.partId); if (part && part.id !== state.selectedId) { if (state.regions.on) setRegions(false); selectPart(part.id); p = part; } }
    if (!p) { if (state.parts.length === 1) { selectPart(state.parts[0].id); p = state.parts[0]; } else { toast('Click a part to choose it, then drag the line across it.', 'warn'); return null; } }
    let point;
    if (hit) point = [hit.point.x, hit.point.y, hit.point.z];
    else { const v = views.get(p.id), c = new THREE.Vector3(...p.bbox.center).add(v.mesh.position), cam = camera.position, d = c.clone().sub(cam).dot(n); point = [c.x - n.x * d, c.y - n.y * d, c.z - n.z * d]; }
    placeFlatCut({ normal: [n.x, n.y, n.z], point, areas: null });
    renderInspector();
    toast('The cut is set along the line you drew, straight into the view. Turn the model to check where it comes out the back. Enter cuts.');
    return { normal: [n.x, n.y, n.z], point };
  }
  canvas.addEventListener('pointercancel', () => { if (ptr.ring) endRing(); if (ptr.tilt) endTilt(); if (ptr.sheet) { ptr.sheet = null; orbit.enabled = true; } if (ptr.dragKey >= 0) { ptr.dragKey = -1; orbit.enabled = true; } if (ptr.paint) endPaint(); if (ptr.handle) endHandle(); ptr.down = false; });
  canvas.addEventListener('pointerup', (e) => {
    if (!ptr.down) return;
    ptr.down = false;
    if (ptr.paint) { endPaint(); return; }
    if (ptr.handle) { endHandle(); return; }
    if (ptr.across) { const a = ptr.across; ptr.across = null; orbit.enabled = true; showAcrossLine(null); if (Math.hypot(e.clientX - a.x, e.clientY - a.y) >= 10) cutAcross(a.x, a.y, e.clientX, e.clientY); return; }
    if (ptr.ring) { endRing(); return; }
    if (ptr.tilt) { endTilt(); return; }
    if (ptr.sheet) { ptr.sheet = null; orbit.enabled = true; }
    if (ptr.dragKey >= 0) {
      ptr.dragKey = -1;
      orbit.enabled = true;
      renderInspector(); renderAreaTags();
      return;
    }
    const moved = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
    if (moved < 5 && performance.now() - ptr.t < 700) handleClick(e);
  });
  canvas.addEventListener('contextmenu', (e) => {
    const k = pickKey(e);
    if (k >= 0) { e.preventDefault(); removeKey(k); }
  });
  function handleClick(e) {
    if (state.here.on) {
      setNdc(e);
      const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) { setHere(false); return; }
      const part = state.parts.find(q => q.id === hit.object.userData.partId);
      const local = hit.point.clone().sub(hit.object.position);
      cutHereAt(part, [local.x, local.y, local.z]);
      return;
    }
    if (state.tool === 'bed') return;
    if (state.tool === 'shape' || state.tool === 'boolean') { // a click chooses the part under it (for a boolean, a shape clicked is the shape to use)
      setNdc(e);
      const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (hit) {
        const part = state.parts.find(q => q.id === hit.object.userData.partId);
        if (part && state.tool === 'boolean' && part.shape && part.id !== state.selectedId) { state.bool.shapeId = part.id; renderInspector(); updateHint(); }
        else if (part && part.id !== state.selectedId) { selectPart(part.id); attachGizmo(); }
      }
      return;
    }
    if (state.regions.on) {
      setNdc(e);
      const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) { clearPick(); renderPick(); markDirty(); return; }
      const part = state.parts.find(q => q.id === hit.object.userData.partId);
      const local = hit.point.clone().sub(hit.object.position); // undo the exploded-view offset
      if (state.draw.on && part.id === state.selectedId) { addDrawPoint(part, [local.x, local.y, local.z]); return; }
      regionClick(part, [local.x, local.y, local.z], e.shiftKey);
      return;
    }
    const p = selectedPart();
    if (p && cameraOnClearSide() && state.cut.analysis && !state.cut.stale) {
      const h = planeHit(e);
      if (h) {
        const ri = K.regionAt(state.cut.analysis.base, h.x, h.y);
        if (ri >= 0 && state.cut.skip.has(ri)) { toggleArea(ri); return; }
        if (ri >= 0 && pointKeys()) { addKey(h); return; }
      }
    }
    setNdc(e);
    const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) selectPart(hits[0].object.userData.partId);
    else if (p) selectPart(null);
  }
  // A click on a part while regions show: the first click on a part chooses it, so its key settings show on the
  // right; a click on the chosen part picks a region or a line on it.
  // A plain click picks afresh; a shift-click adds to the pick (another line to cut along, or another region to
  // split off with the first). The clicks are kept so the pick can be replayed when the key settings change.
  function regionClick(part, point, add = false) {
    if (part.id !== state.selectedId) { if (state.paint.on) setPainting(false); clearPick(); selectPart(part.id); renderPick(); updateHint(); return; }
    const last = state.regions.last;
    if (add && last && last.partId === part.id && state.regions.pick) last.clicks.push(point);
    else { endSeamEdit(); state.regions.last = { partId: part.id, clicks: [point] }; }
    replayPick(part);
  }
  // Seam editing: the picked lines become handles along the surface. Drag one and the line is re-routed through it
  // (along the surface, as a drawn line is), Smooth eases them, and a handle dragged near a region border snaps to
  // it. The pick re-runs when a handle is let go, so keys, plug, sinking and the checks follow the new line.
  function startSeamEdit() {
    const p = selectedPart(), pick = state.regions.pick;
    if (!p || !pick || !pick.loops.length) return;
    const n = Math.max(6, Math.min(40, Math.round(pick.loops.reduce((s, l) => s + l.length, 0) / (K.diag(p.bbox) * 0.03) / pick.loops.length)));
    const loops = pick.loops.map(l => { const pts = K.loopHandles(p.positions, l, n); return { pts, base: pts.map(q => q.slice()) }; });
    state.edit = { partId: p.id, loops, smooth: 0, snap: true };
    if (state.draw.on) setDrawing(false);
    state.regions.last = { partId: p.id, clicks: [], drawn: [] };
    rebuildSeam();
    const sl = $('#seamSmooth'); if (sl) { sl.value = 0; $('#seamSmoothOut').textContent = '0'; }
    updateHint();
  }
  function endSeamEdit() {
    if (!state.edit) return;
    state.edit = null;
    for (const v of views.values()) if (v.editDots) { v.mesh.remove(v.editDots); clearGroup(v.editDots); v.editDots = null; }
    const tools = $('#seamTools'); if (tools) tools.hidden = true;
    markDirty();
  }
  // Rebuild every edited line through its handles and re-run the pick
  function rebuildSeam() {
    const ed = state.edit, p = ed && state.parts.find(q => q.id === ed.partId);
    if (!p) return;
    const drawn = [];
    for (const l of ed.loops) { const loop = K.drawnLoop(p.positions, p.indices, l.pts); if (loop) { loop.edited = true; drawn.push(loop); } }
    if (!drawn.length) { toast('Those handles can’t be joined along the surface. Drag them back onto one piece of it.', 'error'); return; }
    state.regions.last = { partId: p.id, clicks: [], drawn };
    replayPick(p);
    renderSeamHandles();
    const tools = $('#seamTools'); if (tools) tools.hidden = false;
  }
  function renderSeamHandles() {
    for (const v of views.values()) if (v.editDots) { v.mesh.remove(v.editDots); clearGroup(v.editDots); v.editDots = null; }
    const ed = state.edit, p = ed && selectedPart(), v = p && p.id === ed.partId && views.get(p.id);
    if (!v) return;
    const g = new THREE.Group();
    const all = ed.loops.flatMap(l => l.pts).map(q => new THREE.Vector3(q[0], q[1], q[2]));
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(all), new THREE.PointsMaterial({ color: 0xffffff, size: 10, sizeAttenuation: false, depthTest: false }));
    dots.renderOrder = 10; g.add(dots);
    const inner = new THREE.Points(new THREE.BufferGeometry().setFromPoints(all), new THREE.PointsMaterial({ color: 0x2f6fe0, size: 6, sizeAttenuation: false, depthTest: false }));
    inner.renderOrder = 11; g.add(inner);
    v.editDots = g; v.mesh.add(g);
    markDirty();
  }
  // The handle under the pointer, if any: the nearest within 12 px on screen
  function handleAt(e) {
    const ed = state.edit, p = ed && selectedPart(), v = p && p.id === ed.partId && views.get(p.id);
    if (!v || state.paint.on || state.draw.on) return null;
    camera.updateMatrixWorld(); v.mesh.updateMatrixWorld(true);
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 12;
    ed.loops.forEach((l, li) => l.pts.forEach((q, i) => { const s = toScreen(v.mesh.localToWorld(new THREE.Vector3(q[0], q[1], q[2]))); const d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = { li, i }; } }));
    return best;
  }
  function dragHandle(e) {
    const ed = state.edit, p = selectedPart(), v = p && views.get(p.id);
    if (!ed || !v) return;
    setNdc(e);
    const hit = raycaster.intersectObjects([v.mesh], false)[0];
    if (!hit) return;
    const local = hit.point.clone().sub(hit.object.position);
    moveHandle(ptr.handle.li, ptr.handle.i, [local.x, local.y, local.z]);
  }
  // Put a handle at a point on the part (snapped to a region border when close), and redraw its two legs
  function moveHandle(li, i, point) {
    const ed = state.edit, p = selectedPart();
    if (!ed || !p || !ed.loops[li]) return;
    let q = point.slice();
    if (ed.snap) { const nb = K.nearestBorderPoint(p.positions, regionsFor(p), q); if (nb && nb.distance < K.diag(p.bbox) * 0.015) q = nb.point; }
    const vtx = K.nearestVertex(p.positions, q);
    ed.loops[li].pts[i] = [p.positions[3 * vtx], p.positions[3 * vtx + 1], p.positions[3 * vtx + 2]];
    renderSeamHandles();
    previewLegs(li, i);
  }
  // While a handle is dragged, only its two legs are redrawn (the full pick waits for the pointer to be let go)
  function previewLegs(li, i) {
    const ed = state.edit, p = selectedPart(), v = p && views.get(p.id);
    if (!v) return;
    if (v.legLine) { v.mesh.remove(v.legLine); clearGroup(v.legLine); v.legLine = null; }
    const pts = ed.loops[li].pts, n = pts.length, line = [];
    for (const [a, b] of [[(i + n - 1) % n, i], [i, (i + 1) % n]]) {
      const path = K.surfacePath(p.positions, p.indices, K.nearestVertex(p.positions, pts[a]), K.nearestVertex(p.positions, pts[b])) || [];
      for (const w of path) line.push(new THREE.Vector3(p.positions[3 * w], p.positions[3 * w + 1], p.positions[3 * w + 2]));
    }
    const g = new THREE.Group();
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: 0xf2b705, depthTest: false })); l.renderOrder = 10; g.add(l);
    v.legLine = g; v.mesh.add(g);
    markDirty();
  }
  function endHandle() {
    const h = ptr.handle; ptr.handle = null;
    orbit.enabled = true; canvas.style.cursor = '';
    const ed = state.edit, p = selectedPart(), v = p && views.get(p.id);
    if (v && v.legLine) { v.mesh.remove(v.legLine); clearGroup(v.legLine); v.legLine = null; }
    if (!ed || !h) return;
    ed.loops.forEach(l => { l.base = l.pts.map(q => q.slice()); });
    ed.smooth = 0; const sl = $('#seamSmooth'); if (sl) { sl.value = 0; $('#seamSmoothOut').textContent = '0'; }
    rebuildSeam();
  }
  function smoothSeam(passes) {
    const ed = state.edit, p = selectedPart();
    if (!ed || !p) return;
    ed.smooth = passes;
    for (const l of ed.loops) l.pts = passes ? K.smoothHandles(p.positions, l.base, passes) : l.base.map(q => q.slice());
    rebuildSeam();
  }
  function replayPick(part) {
    const last = state.regions.last, clicks = last ? last.clicks : [];
    if (last && last.painted) { pickPainted(); return; }
    if (last && last.drawn && last.drawn.length) pickLoops(part, last.drawn.slice(), { lines: true });
    clicks.forEach((pt, i) => pickCutLine(part, pt, i > 0 || !!(last && last.drawn && last.drawn.length)));
  }
  // Drawing a cut line by hand: each click adds a point, the line runs between them along the surface, and
  // closing it (Enter, the button, or a click by the first point) picks it like any other line.
  function setDrawing(on) {
    state.draw.on = on; state.draw.points = [];
    if (on) endSeamEdit();
    if (on) { if (state.paint.on) setPainting(false); if (state.regions.pick && (state.regions.pick.regions || state.regions.pick.painted)) { clearPick(); state.regions.last = null; } } // lines already picked stay: the next line adds to them
    renderDraw(); renderPick(); updateHint();
    syncTool();
    markDirty();
  }
  function addDrawPoint(p, point) {
    const pts = state.draw.points;
    if (pts.length >= 3 && Math.hypot(point[0] - pts[0][0], point[1] - pts[0][1], point[2] - pts[0][2]) < K.diag(p.bbox) * 0.02) { closeDrawing(); return; }
    pts.push(point);
    renderDraw(); renderPick(); updateHint(); markDirty();
  }
  function closeDrawing() {
    const p = selectedPart();
    if (!p || state.draw.points.length < 3) { toast('Click at least three points on the part first.'); return; }
    const loop = K.drawnLoop(p.positions, p.indices, state.draw.points);
    if (!loop) { toast('Those points can’t be joined along the surface. Keep them on one piece of it.', 'error'); return; }
    state.draw.on = false; state.draw.points = [];
    syncTool();
    renderDraw();
    const last = state.regions.last && state.regions.last.partId === p.id && !state.regions.last.painted && state.regions.pick && !state.regions.pick.regions ? state.regions.last : { partId: p.id, clicks: [] };
    last.drawn = [...(last.drawn || []), loop]; // several drawn lines cut together, like shift-clicked ones
    state.regions.last = last;
    replayPick(p);
    updateHint();
  }
  // Painting an area to split off: a brush paints triangles on the chosen part (across the surface from the one
  // under the pointer, so a thin hand's far side stays clean), with grow, shrink, tidy and clear; letting go of
  // the pointer picks the painted area like a region, with the usual keys, plug, sinking and "cut anyway".
  function setPainting(on) {
    state.paint.on = on;
    if (on) { endSeamEdit(); clearPick(); state.regions.last = null; if (state.draw.on) setDrawing(false); }
    const p = selectedPart();
    if (on && p && state.paint.partId !== p.id) { state.paint.partId = p.id; state.paint.sel = new Uint8Array(p.indices.length / 3); }
    if (on && p && !state.paint.sized) { state.paint.size = Math.max(0.5, Math.round(K.diag(p.bbox) * 0.03 * 2) / 2); const inp = $('#brushSize'); if (inp) inp.value = state.paint.size; } // a brush to suit the model's size until it's set by hand
    if (!on) { const q = state.parts.find(x => x.id === state.paint.partId); state.paint.sel = null; state.paint.partId = null; if (state.paint.iso) { state.paint.iso = null; if (q) applyIsolation(q); } }
    // faces show while painting, so the brush is seen to pick faces
    if (on && !state.flat) { state.flatAuto = true; setFlat(true); } else if (!on && state.flatAuto) { state.flatAuto = false; setFlat(false); }
    brushRing.visible = false;
    renderPaint(); renderPick(); updateHint();
    syncTool();
    const tools = $('#paintTools'); if (tools) tools.hidden = !on;
    renderPaintTools();
    canvas.style.cursor = on ? 'crosshair' : '';
    markDirty();
  }
  let lastBrush = 0;
  function paintAt(e, erase) {
    const p = selectedPart(), v = p && views.get(p.id);
    if (!v) return false;
    if (e.type === 'pointermove' && performance.now() - lastBrush < 20) return true; // a dab every 20 ms is plenty; the raycast is the cost
    lastBrush = performance.now();
    if (state.paint.partId !== p.id || !state.paint.sel || state.paint.sel.length !== p.indices.length / 3) { state.paint.partId = p.id; state.paint.sel = new Uint8Array(p.indices.length / 3); if (state.paint.iso) { state.paint.iso = null; applyIsolation(p); } } // the part changed under the brush (scaled, or another chosen)
    setNdc(e);
    const hit = raycaster.intersectObjects([v.mesh], false)[0];
    moveBrushRing(hit);
    if (!hit) return false;
    const local = hit.point.clone().sub(v.mesh.position);
    paintDab(p, [local.x, local.y, local.z], v.isoMap ? v.isoMap[hit.faceIndex] : hit.faceIndex, erase || state.paint.erase);
    return true;
  }
  // The brush shown on the surface: a circle the brush's size, lying on the face under the pointer
  const brushRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([...Array(48).keys()].map(i => new THREE.Vector3(Math.cos(i / 48 * 2 * Math.PI), Math.sin(i / 48 * 2 * Math.PI), 0))), new THREE.LineBasicMaterial({ color: 0x2f6fe0, depthTest: false, transparent: true, opacity: 0.9 }));
  brushRing.renderOrder = 10; brushRing.visible = false; scene.add(brushRing);
  function moveBrushRing(hit) {
    if (!hit || !state.paint.on) { if (brushRing.visible) { brushRing.visible = false; markDirty(); } return; }
    brushRing.position.copy(hit.point);
    const nrm = hit.face && hit.face.normal ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    brushRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
    brushRing.scale.set(state.paint.size, state.paint.size, state.paint.size);
    brushRing.visible = true;
    markDirty();
  }
  function hoverBrush(e) {
    const p = selectedPart(), v = p && views.get(p.id);
    if (!v) { moveBrushRing(null); return; }
    if (performance.now() - lastBrush < 30) return;
    lastBrush = performance.now();
    setNdc(e);
    moveBrushRing(raycaster.intersectObjects([v.mesh], false)[0]);
  }
  function paintDab(p, point, face, erase) {
    const start = face !== undefined && face !== null && face >= 0 ? face : K.nearestTriangle(p.positions, p.indices, point, K.diag(p.bbox) * 0.05);
    if (start < 0) return;
    const sel = state.paint.sel, iso = state.paint.iso;
    // the surface brush floods from the face under the pointer; the sphere brush takes every face within reach,
    // layers behind included; fill takes the whole surface region under the pointer
    let hit;
    if (state.paint.fill) { const seg = regionsFor(p), g = seg.groupOf[start]; hit = []; for (let t = 0; t < seg.groupOf.length; t++) if (seg.groupOf[t] === g) hit.push(t); }
    else hit = state.paint.mode === 'sphere' ? K.sphereTriangles(p.positions, p.indices, point, state.paint.size) : K.brushTriangles(p.positions, p.indices, start, point, state.paint.size);
    hit = hit.filter(t => !iso || iso[t]); // the brush never reaches the hidden part of the model
    for (const t of hit) sel[t] = erase ? 0 : 1;
    renderPaint(hit); // just the faces the dab touched
  }
  // Letting go shows the painted area's outline at once (a few tens of milliseconds); the full cut, with its keys
  // and checks, runs when Split off painted area is pressed, so painting never waits on it
  function endPaint() {
    ptr.paint = false; orbit.enabled = true;
    previewPainted();
  }
  function previewPainted() {
    const p = selectedPart();
    if (!p || !state.paint.sel) return;
    clearPick();
    state.regions.last = null;
    if (!paintCount()) { renderPick(); updateHint(); markDirty(); return; }
    let loops = [], error = '';
    try { const seg = K.selectionSeg(p.positions, p.indices, state.paint.sel); loops = K.groupLoops(p.positions, p.indices, seg, [1]); } catch (err) { error = err.message; }
    state.regions.pick = { partId: p.id, loops, error, painted: true, preview: true, keys: [], plugs: [], perLoop: [] };
    const v = views.get(p.id);
    if (v && loops.length) {
      const g = new THREE.Group();
      for (const loop of loops) { const pts = loop.verts.map(i => new THREE.Vector3(p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2])); const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2f6fe0, depthTest: false })); line.renderOrder = 9; g.add(line); }
      v.pickLine = g; v.mesh.add(g);
    }
    renderPick(); updateHint(); markDirty();
  }
  // Split off painted area: the full pick (keys, plug, sinking, checks), then the cut if it passed; a refusal shows
  // with Split it off anyway
  function splitPainted() {
    pickPainted();
    const pick = state.regions.pick;
    if (pick && pick.result && !pick.forced) cutAlongPick();
  }
  function paintCount() { let n = 0; if (state.paint.sel) for (const v of state.paint.sel) n += v; return n; }
  function paintEdit(act) {
    const p = selectedPart();
    if (!p || !state.paint.sel) return;
    const r = Math.max(0.2, state.paint.size);
    if (act === 'paint-grow') state.paint.sel = K.growSelection(p.positions, p.indices, state.paint.sel, r);
    else if (act === 'paint-shrink') state.paint.sel = K.shrinkSelection(p.positions, p.indices, state.paint.sel, r);
    else if (act === 'paint-tidy') state.paint.sel = K.tidySelection(p.positions, p.indices, state.paint.sel, r / 2);
    else if (act === 'paint-clear') state.paint.sel = new Uint8Array(p.indices.length / 3);
    else if (act === 'paint-snap') { state.paint.sel = K.snapSelectionToRegions(p.positions, p.indices, state.paint.sel, regionsFor(p)); if (state.paint.iso) for (let t = 0; t < state.paint.sel.length; t++) if (!state.paint.iso[t]) state.paint.sel[t] = 0; }
    else if (act === 'paint-fill') { state.paint.fill = !state.paint.fill; renderPaintTools(); updateHint(); return; }
    else if (act === 'paint-mode') { state.paint.mode = state.paint.mode === 'sphere' ? 'surface' : 'sphere'; renderPaintTools(); updateHint(); return; }
    else if (act === 'paint-isolate') { if (!paintCount()) { toast('Paint the area you want to work in first, then isolate it.'); return; } state.paint.iso = state.paint.sel.slice(); applyIsolation(p); renderPaintTools(); updateHint(); return; }
    else if (act === 'paint-show') { state.paint.iso = null; applyIsolation(p); renderPaintTools(); updateHint(); return; }
    renderPaint();
    previewPainted();
  }
  // Isolation (the owner's Mask tool, as modelsplitter has): only the isolated triangles are drawn and raycast,
  // through an index on the part's (otherwise unindexed) geometry, so the rest of the model leaves the screen and
  // stops catching strokes and clicks. The cut still uses the whole model.
  function applyIsolation(p) {
    const v = views.get(p.id);
    if (!v) return;
    const iso = state.paint.partId === p.id ? state.paint.iso : null;
    if (!iso) { v.geom.setIndex(null); v.isoMap = null; markDirty(); return; }
    let n = 0; for (let t = 0; t < iso.length; t++) if (iso[t]) n++;
    const idx = new Uint32Array(3 * n), map = new Int32Array(n); let j = 0;
    for (let t = 0; t < iso.length; t++) if (iso[t]) { map[j] = t; idx[3 * j] = 3 * t; idx[3 * j + 1] = 3 * t + 1; idx[3 * j + 2] = 3 * t + 2; j++; }
    v.geom.setIndex(new THREE.BufferAttribute(idx, 1)); v.isoMap = map;
    markDirty();
  }
  function renderPaintTools() {
    const b = $('#isolateBtn'); if (b) { b.textContent = state.paint.iso ? 'Show whole model' : 'Isolate'; b.dataset.act = state.paint.iso ? 'paint-show' : 'paint-isolate'; b.setAttribute('aria-pressed', state.paint.iso ? 'true' : 'false'); }
    const m = $('#brushModeBtn'); if (m) { m.textContent = state.paint.mode === 'sphere' ? 'Sphere' : 'Surface'; m.setAttribute('aria-pressed', state.paint.mode === 'sphere' ? 'true' : 'false'); }
    const f = $('#fillBtn'); if (f) f.setAttribute('aria-pressed', state.paint.fill ? 'true' : 'false');
  }
  function setBrushSize(size) {
    state.paint.size = Math.max(0.2, Math.round(size * 10) / 10); state.paint.sized = true;
    const inp = $('#brushSize'); if (inp) inp.value = state.paint.size;
    brushRing.scale.set(state.paint.size, state.paint.size, state.paint.size); updateHint(); markDirty();
  }
  // The painted area as a pick: its outline is always closed, so it always separates
  function pickPainted() {
    const p = selectedPart();
    if (!p || !state.paint.sel) return;
    clearPick();
    if (!paintCount()) { state.regions.last = null; renderPick(); updateHint(); markDirty(); return; }
    state.regions.last = { partId: p.id, painted: true, clicks: [] };
    try {
      const seg = K.selectionSeg(p.positions, p.indices, state.paint.sel);
      pickLoops(p, K.groupLoops(p.positions, p.indices, seg, [1]), { regions: [1], seg, painted: true });
    } catch (err) { state.regions.pick = { partId: p.id, loops: [], error: err.message, painted: true, keys: [], plugs: [], perLoop: [] }; renderPick(); }
    updateHint();
  }
  // The painted triangles shown in blue over the region colours
  // The painted triangles shown in blue over the region colours. With a list of triangles only those are written
  // and only their span is sent to the graphics card; without one, every triangle (grow, shrink, clear, stop).
  function renderPaint(only) {
    const p = selectedPart(), v = p && views.get(p.id);
    if (!v || !v.geom.attributes.color) return;
    const attr = v.geom.attributes.color, col = attr.array, base = v.regionColors;
    if (!base) return;
    const sel = state.paint.on && state.paint.partId === p.id ? state.paint.sel : null, hi = [0.18, 0.44, 0.88];
    const paintOne = (t) => { const on = sel && sel[t]; for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) col[9 * t + 3 * k + c] = on ? hi[c] : base[9 * t + 3 * k + c]; };
    if (only && only.length) {
      let lo = Infinity, hi2 = -1;
      for (const t of only) { paintOne(t); if (t < lo) lo = t; if (t > hi2) hi2 = t; }
      attr.updateRange = { offset: 9 * lo, count: 9 * (hi2 - lo + 1) };
    } else {
      for (let t = 0; t < p.indices.length / 3; t++) paintOne(t);
      attr.updateRange = { offset: 0, count: -1 };
    }
    attr.needsUpdate = true;
    markDirty();
  }
  // The line so far: the points as dots, joined along the surface.
  function renderDraw() {
    for (const v of views.values()) if (v.drawLine) { v.mesh.remove(v.drawLine); clearGroup(v.drawLine); v.drawLine = null; }
    const p = selectedPart(), v = p && views.get(p.id), pts = state.draw.points;
    if (!v || !state.draw.on || !pts.length) return;
    const g = new THREE.Group();
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], q[2]))), new THREE.PointsMaterial({ color: 0x2f6fe0, size: 7, sizeAttenuation: false, depthTest: false })); // small dots the same size at any zoom
    dots.renderOrder = 9; g.add(dots);
    if (pts.length > 1) {
      const vs = pts.map(q => K.nearestVertex(p.positions, q)), line = [];
      for (let i = 0; i + 1 < vs.length; i++) { const path = K.surfacePath(p.positions, p.indices, vs[i], vs[i + 1]) || []; for (const w of path) line.push(new THREE.Vector3(p.positions[3 * w], p.positions[3 * w + 1], p.positions[3 * w + 2])); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: 0x2f6fe0, depthTest: false })); l.renderOrder = 9; g.add(l);
    }
    v.drawLine = g; v.mesh.add(g);
  }
  function addKey(h) {
    state.cut.keys.push(h);
    state.cut.auto = false;
    state.cut.active = state.cut.keys.length - 1;
    evaluateKeys(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }
  function removeKey(i) {
    state.cut.keys.splice(i, 1);
    state.cut.auto = false;
    state.cut.active = -1;
    evaluateKeys(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }

  // drag and drop
  ['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('dropping'); }));
  ['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && stage.contains(e.relatedTarget)) return; stage.classList.remove('dropping'); }));
  stage.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) loadFile(f); fileInput.value = ''; });

  /* ---------------- keyboard ---------------- */
  // The keyboard reference: the ? button or key opens it, Esc or Close shuts it
  const keysDialog = $('#keysDialog');
  function showKeys(on) { if (!keysDialog) return; if (on && !keysDialog.open) keysDialog.showModal(); else if (!on && keysDialog.open) keysDialog.close(); }
  $('#keysBtn').addEventListener('click', () => showKeys(true));
  $('#keysClose').addEventListener('click', () => showKeys(false));
  keysDialog.addEventListener('click', (e) => { if (e.target === keysDialog) showKeys(false); }); // a click on the backdrop
  // The side panels' edges can be dragged (the guide's "drag the divider"): the widths live in CSS variables on the
  // layout, within limits that keep the settings readable, and are kept for next time; a double-click resets one.
  const layout = document.querySelector('.layout'), PANELS_KEY = 'keymaster.panels', PANEL_LIMITS = { left: [180, 440], right: [300, 560] };
  function setPanelWidth(side, px) {
    if (px === null) { layout.style.removeProperty(side === 'left' ? '--left-w' : '--right-w'); return; }
    const [lo, hi] = PANEL_LIMITS[side], w = Math.round(Math.max(lo, Math.min(hi, px)));
    layout.style.setProperty(side === 'left' ? '--left-w' : '--right-w', `${w}px`);
  }
  function panelWidths() { return { left: parseFloat(layout.style.getPropertyValue('--left-w')) || null, right: parseFloat(layout.style.getPropertyValue('--right-w')) || null }; }
  function savePanels() { try { localStorage.setItem(PANELS_KEY, JSON.stringify(panelWidths())); } catch (e) { /* ignore */ } }
  try { const pw = JSON.parse(localStorage.getItem(PANELS_KEY) || 'null'); if (pw) { if (pw.left) setPanelWidth('left', pw.left); if (pw.right) setPanelWidth('right', pw.right); } } catch (e) { /* storage unavailable */ }
  for (const side of ['left', 'right']) {
    const el = $(side === 'left' ? '#dividerLeft' : '#dividerRight');
    if (!el) continue;
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      const panel = document.querySelector(side === 'left' ? '.parts-panel' : '.inspector');
      start = { x: e.clientX, w: panel.getBoundingClientRect().width };
      el.setPointerCapture(e.pointerId); el.classList.add('is-dragging'); document.body.classList.add('is-resizing');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (!start) return; setPanelWidth(side, start.w + (side === 'left' ? e.clientX - start.x : start.x - e.clientX)); });
    const stop = () => { if (!start) return; start = null; el.classList.remove('is-dragging'); document.body.classList.remove('is-resizing'); savePanels(); renderInspector(); };
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    el.addEventListener('dblclick', () => { setPanelWidth(side, null); savePanels(); renderInspector(); });
  }
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (keysDialog && keysDialog.open) return; // the reference is up: Esc closes it on its own
    if (e.key === '?' && !typing) { e.preventDefault(); showKeys(true); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); return; }
    if (typing || mod || e.altKey) return;
    const p = selectedPart();
    switch (e.key) {
      case '[': if (state.regions.on && state.paint.on) { e.preventDefault(); setBrushSize(state.paint.size / 1.25); } break;
      case ']': if (state.regions.on && state.paint.on) { e.preventDefault(); setBrushSize(state.paint.size * 1.25); } break;
      case 'Escape': if (state.across.on) setAcross(false); else if (state.here.on) setHere(false); else if (state.regions.on && state.paint.on) setPainting(false); else if (state.regions.on && state.draw.on) setDrawing(false); else if (state.regions.on && state.regions.pick) { endSeamEdit(); clearPick(); state.regions.last = null; renderPick(); updateHint(); markDirty(); } else if (p && state.cut.active >= 0) { state.cut.active = -1; renderKeyMarkers(); renderInspector(); } else if (p) selectPart(null); break;
      case 'Backspace': if (state.regions.on && state.draw.on && state.draw.points.length) { e.preventDefault(); state.draw.points.pop(); renderDraw(); renderPick(); updateHint(); markDirty(); } break;
      case 'Enter': if (state.tool === 'boolean') { e.preventDefault(); doBoolean(); } else if (state.regions.on && state.draw.on) { e.preventDefault(); closeDrawing(); } else if (state.regions.on && state.regions.pick && state.regions.pick.result) { e.preventDefault(); cutAlongPick(); } else if (state.regions.on && p) { e.preventDefault(); toast(state.paint.on ? 'Paint an area to split off first.' : 'Pick a region or a line first, or choose the Plane tool for a flat cut.'); } else if (p && planeShown()) { e.preventDefault(); doCut(); } break;
      case 'Delete': case 'Backspace': if (p && state.cut.active >= 0) { e.preventDefault(); removeKey(state.cut.active); } else if (p && p.shape && state.tool === 'shape') { e.preventDefault(); removeShape(); } break;
      case 'f': case 'F': frameAll(p || undefined); break;
      case 'x': case 'X': if (planeShown()) alignPlane('x'); break;
      case 'y': case 'Y': if (planeShown()) alignPlane('y'); break;
      case 'z': case 'Z': if (planeShown()) alignPlane('z'); break;
      default: break;
    }
  });
  function alignPlane(which) {
    let axis;
    if (which === 'view') axis = camera.position.clone().sub(orbit.target).normalize();
    else axis = towardCamera(new THREE.Vector3(which === 'x' ? 1 : 0, which === 'y' ? 1 : 0, which === 'z' ? 1 : 0));
    setPlaneNormal(axis);
    state.cut.auto = true; state.cut.skip.clear();
    scheduleAnalysis(0);
  }
  function flipPlane() {
    planeGroup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    state.cut.keys = state.cut.keys.map(k => ({ ...k, y: -k.y }));
    computeSliderRange();
    onPlaneMoved();
    state.cut.skip.clear();
    scheduleAnalysis(0);
  }

  /* ---------------- UI: chrome, parts list ---------------- */
  function updateChrome() {
    $('#undoBtn').disabled = !history.past.length;
    $('#redoBtn').disabled = !history.future.length;
    $('#exportBtn').disabled = !state.parts.length;
    $('#viewTools').hidden = !state.parts.length;
    $('#modelTools').hidden = !state.parts.length;
    $('#flatBtn').setAttribute('aria-pressed', state.flat ? 'true' : 'false');
    $('#wireBtn').setAttribute('aria-pressed', state.wire ? 'true' : 'false');
    updateHint();
  }
  function updateHint() {
    const el = $('#hint');
    let t = '';
    const p = selectedPart();
    if (!state.parts.length) t = '';
    else if (state.tool === 'shape') t = p && p.shape ? `Drag the handles to ${state.shapeMode === 'turn' ? 'turn' : state.shapeMode === 'size' ? 'size' : 'move'} the ${p.name.toLowerCase()}, or set its size and place in the panel. Click another part to choose it.` : 'Add a shape from the panel, or click a shape to edit it.';
    else if (state.tool === 'bed') t = 'The yellow sheets are the planned cuts. Change how many, or where each one sits, in the panel, then cut.';
    else if (state.tool === 'boolean') t = booleanShape() && p ? `${BOOL_VERBS[state.bool.op]} the ${booleanShape().name.toLowerCase()} ${state.bool.op === 'union' ? 'to' : state.bool.op === 'difference' ? 'of' : 'and'} ${p.name}. Click another part to change which, or move the shape first with the Shapes tool.` : 'A boolean needs a shape and a part: add a shape with the Shapes tool, then click the part it should join or cut.';
    else if (state.across.on) t = 'Drag a straight line across the model where the cut should go. The cut goes through it, straight into the view. Esc to stop.';
    else if (state.here.on) t = 'Click where the cut should go round, on a limb, a neck or an accessory. Keymaster finds the narrowest cut through that spot. Esc to stop.';
    else if (state.regions.on && state.paint.on && state.paint.iso) t = 'Only the painted area shows: the rest of the model is out of the way of the brush and clicks. Paint inside it, then split it off. Show whole model brings the rest back.';
    else if (state.regions.on && state.paint.on && state.paint.fill) t = 'Fill is on: a click paints the whole surface region under the brush (Shift-click clears it). Press Fill again for the brush.';
    else if (state.regions.on && state.paint.on) t = `Drag over the part to paint the area to split off (Shift-drag erases). The circle is the ${state.paint.mode === 'sphere' ? 'sphere brush, which reaches layers behind too' : 'brush'}, ${fmt(state.paint.size)} mm wide; [ and ] resize it. Let go to see the split. Esc stops painting.`;
    else if (state.regions.on && state.edit && !state.paint.on && !state.draw.on) t = 'Drag a handle to move the line along the surface; it snaps to a region border when close. Smooth eases the line. Enter cuts, Esc picks again.';
    else if (state.regions.on && state.draw.on) t = `Click points on the part to draw the cut line${state.draw.points.length >= 3 ? '. Enter or a click by the first point closes it' : ' (at least three)'}. Backspace takes the last point back, Esc stops drawing.`;
    else if (state.regions.on) t = !p ? 'Click a part to choose it. Its key settings appear on the right.' : 'Click a region to split it off, or a dark border line to cut along it. Shift-click adds to the pick. Enter cuts, Esc picks again.';
    else if (!p) t = (state.parts.length > 1 ? 'Click a part to cut it. ' : 'Click the model to start cutting it. ') + (coarse ? 'Drag to orbit, pinch to zoom.' : 'Drag to orbit, right-drag to pan.');
    else if (!cameraOnClearSide()) t = 'Orbit around to the clear side to see the cut face.';
    else if (state.cfg.type === 'plug') t = coarse ? 'Drag the arrow to slide the cut, the plane or a ring to tilt it. Each area gets a plug of its own shape.' : 'Drag the arrow to slide the cut, the plane or a ring to tilt it (Shift for fine steps). Each area gets a plug of its own shape. Alt-drag to orbit.';
    else if (state.cfg.type === 'none') t = coarse ? 'Drag the arrow to slide the cut, the plane or a ring to tilt it. Drag outside the plane to orbit.' : 'Drag the arrow to slide the cut, the plane or a ring to tilt it (Shift for fine steps). Drag outside the plane, or hold Alt, to orbit.';
    else t = coarse ? 'Drag the arrow to slide, the plane or a ring to tilt. Tap the cut face to add a key. Drag outside the plane to orbit.' : 'Drag the arrow to slide, the plane or a ring to tilt. Click the cut face to add a key, or a key to set it up on its own. Alt-drag to orbit.';
    el.textContent = t;
    el.hidden = !t;
  }
  let partsSig = '';
  function renderParts() {
    const list = $('#partList');
    const sig = state.parts.map(p => [p.id, p.name, p.color, state.hidden.has(p.id) ? 1 : 0, p.tris, Math.round(p.bbox.size[0] * 10), Math.round(p.bbox.size[2] * 10)].join(':')).join('|') + '#' + [state.bed.w, state.bed.d, state.bed.h].join(',');
    if (sig === partsSig && state.parts.length) {
      list.querySelectorAll('li[data-id]').forEach(li => li.classList.toggle('is-selected', +li.dataset.id === state.selectedId));
      return;
    }
    partsSig = sig;
    const review = $('#reviewPanel'); if (review) { review.hidden = state.parts.length < 2; const ex = $('#explode'); if (ex && document.activeElement !== ex) ex.value = state.explode; const eo = $('#explodeOut'); if (eo) eo.textContent = `${Math.round(state.explode * 100)}%`; }
    if (!state.parts.length) { list.innerHTML = '<li class="parts-empty">Parts you cut will appear here.</li>'; $('#partsMeta').textContent = ''; return; }
    const bad = state.parts.filter(p => !fitsBed(p)).length;
    $('#partsMeta').textContent = `${state.parts.length} ${state.parts.length === 1 ? 'part' : 'parts'}${bad ? `, ${bad} too big for your bed` : ''}`;
    list.innerHTML = state.parts.map(p => {
      const s = p.bbox.size;
      const fit = fitsBed(p);
      const hidden = state.hidden.has(p.id);
      return `<li class="part${p.id === state.selectedId ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}" data-id="${p.id}">
        <button class="part-main" data-act="select" title="Select ${esc(p.name)}">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="part-text"><span class="part-name">${esc(p.name)}</span>
          <span class="part-dims">${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm</span></span>
          ${fit ? '' : '<span class="fit no" title="Bigger than your printer bed">Too big</span>'}
        </button>
        <button class="icon-btn eye" data-act="toggle-vis" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(p.name)}" aria-pressed="${hidden ? 'false' : 'true'}">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
      </li>`;
    }).join('');
  }
  $('#partList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = +li.dataset.id;
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    if (act === 'toggle-vis') {
      if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
      if (state.hidden.has(id) && state.selectedId === id) state.selectedId = null;
      syncScene();
    } else if (act === 'select') selectPart(state.selectedId === id ? null : id);
  });
  $('#partList').addEventListener('dblclick', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || e.target.closest('[data-act="toggle-vis"]')) return;
    const p = state.parts.find(q => q.id === +li.dataset.id);
    if (!p) return;
    const nameEl = li.querySelector('.part-name');
    const input = document.createElement('input');
    input.className = 'rename'; input.value = p.name; input.setAttribute('aria-label', 'Part name');
    nameEl.replaceWith(input);
    input.focus(); input.select();
    let finished = false;
    const done = (save) => { if (finished) return; finished = true; if (save && input.value.trim()) p.name = input.value.trim(); partsSig = ''; renderParts(); renderInspector(); };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
  });

  /* ---------------- UI: inspector ---------------- */
  function seg(name, value, options) {
    return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([v, label]) =>
      `<button type="button" data-act="${name}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}</div>`;
  }
  const SHAPE_NAMES = { round: 'Round', square: 'Square', hexagon: 'Hexagon', cross: 'Cross', oval: 'Oval', slot: 'Slot', dshape: 'D-shape' };
  const SHAPE_HELP = {
    round: 'Easiest to fit. Use two so pieces can’t turn.',
    square: 'Stops pieces turning, even on its own.',
    hexagon: 'Stops pieces turning, even on its own.',
    cross: 'Grips firmly. Stops pieces turning.',
    oval: 'For narrow areas: 1.5× as long as wide.',
    slot: 'For long, narrow areas: 2× as long as wide.',
    dshape: 'Fits only one way round, so no mix-ups.',
  };
  const shapeIcons = {};
  function shapeIcon(s) {
    if (!shapeIcons[s]) {
      const prof = K.keyProfile(s, 1, 0, 0, 36);
      const half = Math.max(...prof.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) * 1.12; // each icon fills its box
      const pts = prof.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join(' ');
      shapeIcons[s] = `<svg viewBox="${-half} ${-half} ${2 * half} ${2 * half}" aria-hidden="true"><polygon points="${pts}" fill="currentColor"/></svg>`;
    }
    return shapeIcons[s];
  }
  function shapePicker(c, act = 'shape') {
    const shapes = c.type === 'magnet' ? K.MAGNET_SHAPES : K.KEY_SHAPES, cur = K.keyGeometrySpec(c).shape;
    return `<div class="shape-grid${shapes.length < 4 ? ' few' : ''}" role="group" aria-label="Key shape">${shapes.map(s =>
      `<button type="button" data-act="${act}" data-value="${s}" aria-pressed="${s === cur}" title="${SHAPE_NAMES[s]}: ${SHAPE_HELP[s]}">${shapeIcon(s)}<span>${SHAPE_NAMES[s]}</span></button>`).join('')}</div>`;
  }
  // Settings for one key, in the space the general key settings use, so the panel never needs to scroll.
  function keyEditor(i) {
    const c = state.cfg, k = state.cut.keys[i], kc = K.keyCfg(c, k), spec = K.keyGeometrySpec(kc), ev = state.cut.evals[i];
    const status = state.cut.stale ? '' : ev && !ev.ok ? `<p class="status warn">${ICONS.alert}<span>This key needs attention: ${esc(ev.reason)}.</span></p>` : ev ? `<p class="status ok">${ICONS.check}<span>This key fits, with walls at least ${c.margin} mm thick.</span></p>` : '';
    const lenLabel = c.type === 'magnet' ? 'Thickness' : 'Length';
    const f = (field, label, value, opts) => inlineField(field, label, value, opts).replace('data-cfg=', 'data-kcfg=');
    return `<div class="ins-section keys key-edit" aria-label="Selected key">
      <div class="head-row"><h3>Key ${i + 1}, ${SHAPE_NAMES[spec.shape].toLowerCase()}${k.o ? ' <span class="badge">own settings</span>' : ''}</h3><button class="btn ghost small" data-act="key-done" title="Esc">Back to all keys</button></div>
      <p class="muted small">${k.a && !(k.o && k.o.diameter !== undefined) ? `Sized to fit this area: ${fmt(k.a.diameter)} mm. ` : ''}Changes here apply to this key only.</p>
      ${shapePicker(kc, 'kshape')}
      <p class="muted small shape-help"><span class="shape-name">${SHAPE_NAMES[spec.shape]}.</span> ${SHAPE_HELP[spec.shape]}</p>
      <div class="grid2">${f('diameter', spec.shape === 'round' ? 'Diameter' : 'Width', kc.diameter, { min: 1, step: 0.5 })}${f('length', lenLabel, kc.length, { min: 0.5, step: 0.5 })}</div>
      <div class="grid2">${f('clearance', 'Gap', kc.clearance, { min: 0, step: 0.05, aria: 'Gap per side' })}${spec.shape !== 'round' ? f('turn', 'Turn', kc.turn || 0, { min: -180, max: 180, step: 15, unit: '°', aria: 'Turn by' }) : ''}</div>
      ${c.type === 'peg' ? `<div class="taper"><div class="slider"><span class="lbl">Taper</span>
        <input type="range" id="keyTaper" data-kcfg="taper" min="0" max="100" step="5" value="${spec.taperPct}" aria-label="Taper of this key">
        <output id="keyTaperOut">${spec.taperPct}%</output></div>
        ${spec.taperPct > 0 ? `<label class="check"><input type="checkbox" data-kcfg="taperSocket" ${kc.taperSocket !== false ? 'checked' : ''}> Match the hole to the taper</label>` : ''}</div>` : ''}
      <div class="key-own-status">${status}</div>
      <div class="row"><button class="btn small" data-act="key-reset" ${k.o ? '' : 'disabled'}>Use general settings</button><button class="btn small" data-act="remove-key">Remove key</button></div>
    </div>`;
  }
  function setKeyOwn(field, value) {
    const k = state.cut.keys[state.cut.active];
    if (!k) return;
    k.o = { ...(k.o || {}), [field]: value };
    state.cut.auto = false; // the keys are now placed and set by hand
    evaluateKeys(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }
  function taperField(c) {
    const spec = K.keyGeometrySpec(c), pct = spec.taperPct;
    const point = { round: 'a cone', square: 'a four-sided pyramid', hexagon: 'a six-sided pyramid', cross: 'a cross-shaped point', oval: 'an oval cone', slot: 'a wedge-like point', dshape: 'a cone with a flat side' }[spec.shape];
    const desc = pct === 0 ? 'Straight sides.' : pct >= 100 ? `Comes to a point, like ${point}.` : `The tip is ${100 - pct}% of the base width.`;
    const hole = pct > 0 ? (c.taperSocket !== false ? ' Hole narrows to match.' : ' The hole stays straight, with play.') : ' A taper helps pegs find their way in.';
    return `<div class="taper"><div class="slider"><span class="lbl">Taper</span>
        <input type="range" id="taperPct" data-cfg="taper" min="0" max="100" step="5" value="${pct}" aria-label="Taper" aria-describedby="taperDesc">
        <output id="taperOut">${pct}%</output></div>
      ${pct > 0 ? `<label class="check"><input type="checkbox" data-cfg="taperSocket" ${c.taperSocket !== false ? 'checked' : ''}> Match the hole to the taper</label>` : ''}
      <p class="muted small" id="taperDesc">${desc}${hole}</p></div>`;
  }
  function normTurn(v) { let a = ((Math.round(v) % 360) + 360) % 360; if (a > 180) a -= 360; return a; }
  // A number box with its label beside it, to keep the panel short enough to need no scrolling.
  function inlineField(field, label, value, opts = {}) {
    return `<label class="numi"><span>${label}</span><span class="num-wrap"><input type="number" inputmode="decimal" data-cfg="${field}" value="${value}" step="${opts.step || 0.1}" min="${opts.min || 0}" ${opts.max ? `max="${opts.max}"` : ''} aria-label="${opts.aria || label}"><em>${opts.unit || 'mm'}</em></span></label>`;
  }
  function numField(field, label, value, opts = {}) {
    return `<label class="num"><span>${label}</span><span class="num-wrap"><input type="number" inputmode="decimal" data-cfg="${field}" value="${value}" step="${opts.step || 0.1}" min="${opts.min || 0}" ${opts.max ? `max="${opts.max}"` : ''}><em>${opts.unit || 'mm'}</em></span></label>`;
  }
  function renderInspector() {
    const el = $('#inspector');
    if (!state.parts.length) {
      $('#toolHolder').appendChild(toolPanel);
      el.innerHTML = `<div class="ins-section intro"><h2>Cut sculptures into printable pieces</h2>
        <p>Open a figure or sculpture, slide a cut through it, and Keymaster adds pegs, dowel holes or magnet pockets so the pieces line up when you glue them.</p>
        <p class="muted">Works with closed STL and OBJ meshes in millimeters. Everything runs in your browser; your model isn’t uploaded anywhere.</p></div>`;
      return;
    }
    const p = selectedPart();
    el.innerHTML = p ? cutPanel(p) : modelPanel();
    $('#toolSlot').appendChild(toolPanel); // the tool chooser and its controls are one block that keeps its listeners
    renderToolGrid();
    const shown = planeShown();
    planeBar.hidden = !shown; // it works the cut plane, which steps aside while regions or the bed planes show
    planeBar.innerHTML = shown ? planeBarHTML() : '';
    stage.style.setProperty('--bar-h', shown ? `${planeBar.offsetHeight}px` : '0px');
    updatePositionReadout();
  }
  // The flat cut plane is shown, and its bar under the view, while a part is chosen and neither the surface regions
  // nor the bed planes are in its place.
  function planeShown() { return !!selectedPart() && !state.regions.on && state.tool !== 'bed' && state.tool !== 'shape' && state.tool !== 'boolean'; }
  /* ---------------- the cut tool ----------------
     One chooser for every way of cutting (as the guide's Cut Tool): Plane (a flat cut, placed with the bar under the
     view), Regions (cut along the surface's own borders), Paint and Draw (an area painted or a line drawn by hand),
     Suggest (cuts Keymaster finds, a cut at a spot, a line across the view) and Fit bed (sections that fit the
     printer). The regions, paint and draw tools show the surface regions; the others don't. */
  const toolPanel = $('#toolPanel');
  function toolHelp() {
    const p = selectedPart();
    if (!p && state.tool !== 'bed') return state.parts.length > 1 ? 'Click a part in the view or the list, then choose how to cut it.' : '';
    return '';
  }
  function renderToolGrid() {
    for (const b of toolPanel.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === state.tool ? 'true' : 'false');
    const help = toolHelp(), hp = $('#toolHelp'); hp.textContent = help; hp.hidden = !help;
    const p = selectedPart();
    const sp = $('#suggestPanel'); sp.hidden = state.tool !== 'suggest' || !p; sp.innerHTML = sp.hidden ? '' : suggestSection();
    const bp = $('#bedPanel'); bp.hidden = state.tool !== 'bed'; bp.innerHTML = bp.hidden ? '' : splitSection(modelBounds());
    const shp = $('#shapePanel'); shp.hidden = state.tool !== 'shape'; shp.innerHTML = shp.hidden ? '' : shapePanelHTML();
    const blp = $('#booleanPanel'); blp.hidden = state.tool !== 'boolean'; blp.innerHTML = blp.hidden ? '' : booleanPanelHTML();
    $('#regionsPanel').hidden = !state.regions.on;
    const sum = document.querySelector('.tool-sec .sec-sum'); if (sum) sum.textContent = TOOL_NAMES[state.tool];
  }
  // The tool follows what is on: painting means Paint, drawing Draw, the regions alone Regions (unless the
  // suggestions are in use, which keep showing while a region suggestion is picked), none of them Plane.
  function syncTool() {
    const was = state.tool;
    const sg = state.suggest, regionSuggested = sg && sg.partId === state.selectedId && sg.active >= 0 && sg.items[sg.active] && sg.items[sg.active].kind === 'region';
    if (state.regions.on) { if (state.paint.on) state.tool = 'paint'; else if (state.draw.on) state.tool = 'draw'; else if (!(was === 'suggest' && regionSuggested)) state.tool = 'regions'; }
    else if (was === 'regions' || was === 'paint' || was === 'draw') state.tool = 'plane';
    renderToolGrid();
    if (state.tool !== was) renderInspector();
  }
  function setTool(tool) {
    if (!TOOL_NAMES[tool]) return;
    let p = selectedPart();
    if (!p && tool !== 'bed' && tool !== 'shape' && tool !== 'boolean') { // a tool needs a part: with one part it's the one, otherwise say so
      const vis = state.parts.filter(q => !state.hidden.has(q.id));
      if (vis.length === 1) { selectPart(vis[0].id); p = vis[0]; } else { toast('Click a part to choose it first.'); return; }
    }
    if (state.here.on) setHere(false);
    if (state.across.on) setAcross(false);
    if (state.tool === tool && tool !== 'paint' && tool !== 'draw') return;
    if (state.tool === 'shape' && tool !== 'shape' && p && p.shape) refreshView(p.id); // the shape's mesh goes back to the part's own positions
    state.tool = tool;
    if (tool === 'boolean') enterBoolean();
    const go = () => {
      if (tool === 'regions' || tool === 'paint' || tool === 'draw') {
        if (!state.regions.on) setRegions(true);
        if (tool === 'paint') { if (state.draw.on) setDrawing(false); if (!state.paint.on) setPainting(true); }
        else if (tool === 'draw') { if (state.paint.on) setPainting(false); if (!state.draw.on) setDrawing(true); }
        else { if (state.paint.on) setPainting(false); if (state.draw.on) setDrawing(false); }
      } else if (state.regions.on) setRegions(false);
      state.tool = tool;
      selectPartSplitPreview(); updatePreview(); attachGizmo(); placeAreaTags(); renderInspector(); updateHint(); markDirty();
    };
    if ((tool === 'regions' || tool === 'paint' || tool === 'draw') && !state.regions.on) { busy('Finding surface regions'); setTimeout(() => { go(); busy(null); }, 30); }
    else go();
  }
  toolPanel.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tool]');
    if (tb) { setTool(tb.dataset.tool); return; }
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    if (act === 'inlay-cut') inlayFromPick();
    else if (act === 'move-in') movePick(-1);
    else if (act === 'move-out') movePick(1);
    else if (act === 'flat-here') flatFromPick();
    else if (act === 'edit-seam') startSeamEdit();
    else if (act === 'seam-done') { endSeamEdit(); renderPick(); updateHint(); }
    else if (act && act.startsWith('paint-')) paintEdit(act);
    else if (e.target.closest('#eraseBtn')) { state.paint.erase = !state.paint.erase; $('#eraseBtn').setAttribute('aria-pressed', state.paint.erase ? 'true' : 'false'); }
  });
  // The cut plane's controls, in a toolbar along the bottom of the view.
  function planeBarHTML() {
    const ang = planeAngles();
    return `<div class="pb-group" role="group" aria-label="Align the cut">
        ${['x', 'y', 'z'].map(a => `<button class="btn small" data-act="align" data-value="${a}" title="Cut square to ${a.toUpperCase()} (press ${a.toUpperCase()})">${a.toUpperCase()}</button>`).join('')}
        <button class="btn small" data-act="align" data-value="view" title="Cut square to the view">View</button>
        <button class="btn small" data-act="flip" title="Swap the solid and clear halves">Flip</button>
        <button class="btn small" data-act="straighten" title="Snap the cut square to the nearest axis">Straighten</button>
      </div>
      <div class="pb-group pb-pos"><span class="lbl">Position</span>
        <input type="range" id="cutPos" aria-label="Position" min="${state.cut.lo}" max="${state.cut.hi}" step="${(state.cut.hi - state.cut.lo) / 1000}" value="${planeOffset()}">
        <span class="num-wrap"><input type="number" id="cutPosNum" inputmode="decimal" step="0.5" aria-label="Position in millimeters" value="${planeOffset().toFixed(1)}"><em>mm</em></span></div>
      <div class="pb-group pb-angles"><span class="lbl">Angle</span>
        ${['x', 'y', 'z'].map(a => `<label class="pb-angle"><span>${a.toUpperCase()}</span><span class="num-wrap"><input type="number" inputmode="decimal" step="1" data-angle="${a}" aria-label="Turn about ${a.toUpperCase()}" value="${fmtAngle(ang[a])}"><em>°</em></span></label>`).join('')}
        <output id="tiltOut"></output></div>
      ${(() => { const shown = shownAreas(); return shown.length > 1 ? `<div class="pb-group pb-areas" role="group" aria-label="Areas on the cut face"><span class="lbl" title="Untick an area, or click its label in the view, to leave it joined">Areas</span>
        ${shown.map((i, k) => `<label class="area-chip${i === state.cut.hoverArea ? ' is-hover' : ''}" data-area-row="${i}" title="Area ${k + 1}, ${fmt(state.cut.analysis.base.regions[i].area)} mm². Untick to leave it joined."><input type="checkbox" data-area="${i}" ${state.cut.skip.has(i) ? '' : 'checked'}>${k + 1}</label>`).join('')}</div>` : ''; })()}`;
  }
  function modelPanel() {
    const b = modelBounds();
    const rep = state.model.report;
    const total = state.parts.reduce((s, p) => s + p.tris, 0);
    const tooBig = state.parts.filter(p => p.kind !== 'pin' && !fitsBed(p)).length;
    const health = rep.closed
      ? `<p class="status ok">${ICONS.check}<span>Closed surface, ready to cut.</span></p>`
      : `<p class="status warn">${ICONS.alert}<span>${rep.openEdges ? `${fmtInt(rep.openEdges)} open ${rep.openEdges === 1 ? 'edge' : 'edges'}` : ''}${rep.openEdges && rep.badEdges ? ' and ' : ''}${rep.badEdges ? `${fmtInt(rep.badEdges)} tangled ${rep.badEdges === 1 ? 'edge' : 'edges'}` : ''}. Cuts that cross ${rep.openEdges + rep.badEdges === 1 ? 'it' : 'them'} can’t be closed.</span></p>
         <button class="btn small" data-act="fill-holes">Repair surface</button>`;
    const fit = tooBig && state.tool !== 'bed' ? `<p class="status warn">${ICONS.alert}<span>${tooBig === 1 ? 'A part is' : `${tooBig} parts are`} too big for the bed.</span></p><button class="btn small" data-act="tool" data-value="bed">Cut to fit the bed</button>` : '';
    return `<div class="ins-section head model-head">
      <h2>${esc(state.model.name)}</h2>
      <dl class="facts">
        <div><dt>Size</dt><dd>${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} mm</dd></div>
        <div><dt>Triangles</dt><dd>${fmtInt(total)}</dd></div>
      </dl>
      ${health}${fit}
      ${state.start && (state.parts.length > 1 || history.past.length) ? '<button class="btn small" data-act="start-over" title="Back to the model as it was opened, in one piece; the cuts can be undone back">Start over</button>' : ''}
    </div>
    <details class="sec" data-sec="model"${(state.ui.model !== null ? state.ui.model : state.tool === 'plane') ? ' open' : ''}><summary>Model<span class="sec-sum">Orientation, scale, printer, detail, project</span></summary>
    <div class="sec-body">
    <div class="ins-section">
      <h3>Orientation and scale</h3>
      <div class="row">${['x', 'y', 'z'].map(a => `<button class="btn small" data-act="rotate" data-value="${a}" title="Turn the whole model a quarter turn about ${a.toUpperCase()}">Turn on ${a.toUpperCase()}</button>`).join('')}</div>
      <div class="row">
        <button class="btn small" data-act="scale" data-value="0.1">× 0.1</button>
        <button class="btn small" data-act="scale" data-value="10">× 10</button>
        <button class="btn small" data-act="scale" data-value="25.4">Inches to mm</button>
        <label class="inline-num"><input type="number" id="scalePct" value="100" min="1" step="1" aria-label="Scale the whole model to this percentage"><span class="unit">%</span></label>
        <button class="btn small" data-act="scale-custom">Apply</button>
      </div>
    </div>
    <div class="ins-section">
      <h3>Printer</h3>
      ${bedPresetHTML()}
      ${seg('printer', state.cfg.printer === 'resin' ? 'resin' : 'fdm', [['fdm', 'Filament (FDM)'], ['resin', 'Resin']])}
      <p class="muted small printer-help">Sets the smallest keys, gap and walls that print well.</p>
      <div class="row three">
        ${['w', 'd', 'h'].map(k => `<label class="num"><span>Bed ${{ w: 'width', d: 'depth', h: 'height' }[k]}</span><span class="num-wrap"><input type="number" data-bed="${k}" value="${state.bed[k]}" min="10" step="1"><em>mm</em></span></label>`).join('')}
      </div>
    </div>
    <div class="ins-section">
      <h3>Reduce detail</h3>
      <div class="row tight" title="A lighter model paints and cuts faster; the shape and the volume stay. Ctrl+Z puts the detail back.">
        <select id="reduceLevel" class="sel grow" aria-label="How much detail to keep">${[['0.02', 'Light (within 0.02 mm)'], ['0.05', 'Balanced (within 0.05 mm)'], ['0.1', 'Strong (within 0.1 mm)']].map(([v, l]) => `<option value="${v}" ${v === String(state.reduce) ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" data-act="reduce">Reduce</button>
      </div>
    </div>
    <div class="ins-section">
      <h3>Project</h3>
      <div class="row tight" title="The parts, their names and colours, the joints and your settings in one file, to carry on later"><button class="btn" data-act="save-project">Save project</button><button class="btn" data-act="open-project">Open project</button></div>
    </div>
    </div>
    </details>
    <div class="sec tool-sec"><div class="sec-head">Cut tool<span class="sec-sum">${TOOL_NAMES[state.tool]}</span></div><div id="toolSlot"></div></div>`;
  }
  // Split to fit the bed: flat cuts across X, Y and Z that make every piece fit the printer, worked out from the bed
  // size (or set by count), each plane shown in the view and movable by its position, then all cut at once with the
  // keys from the settings.
  function splitSection(b) {
    const tooBig = state.parts.filter(p => !fitsBed(p)).length, sp = state.split;
    const plan = sp.planes ? K.bedFit(b, sp.planes, state.bed, SPLIT_MARGIN) : null;
    const axisName = ['X', 'Y', 'Z'];
    let body;
    if (!sp.planes) {
      body = `<p class="muted small">${tooBig ? `${tooBig === 1 ? 'A part is' : `${tooBig} parts are`} too big for the bed. Keymaster can work out the straight cuts that make every piece fit, keeping ${SPLIT_MARGIN} mm clear at each edge.` : 'Every part fits the bed. You can still cut the model into even sections across X, Y and Z.'}</p>
        <div class="row tight"><button class="btn" data-act="split-plan">${tooBig ? 'Work out the cuts' : 'Cut into sections'}</button></div>`;
    } else {
      const counts = [0, 1, 2].map(ax => sp.planes.filter(q => q.axis === ax).length);
      const list = sp.planes.map((q, i) => `<label class="num"><span>${axisName[q.axis]} at</span><span class="num-wrap"><input type="number" data-split-pos="${i}" value="${fmt(q.pos)}" step="1"><em>mm</em></span></label>`).join('');
      body = `<div class="row three">${[0, 1, 2].map(ax => `<label class="num"><span>Across ${axisName[ax]}</span><span class="num-wrap"><input type="number" data-split-count="${ax}" value="${counts[ax]}" min="0" max="20" step="1"><em>cuts</em></span></label>`).join('')}</div>
        ${sp.planes.length ? `<div class="row three split-list">${list}</div>` : ''}
        <p class="status ${plan.fits ? 'ok' : 'warn'}">${plan.fits ? ICONS.check : ICONS.alert}<span>${sp.planes.length ? `${sp.planes.length === 1 ? 'One cut' : `${sp.planes.length} cuts`}, ${plan.pieces} pieces, the biggest ${plan.biggest.map(v => fmt(v)).join(' × ')} mm${plan.fits ? ': every piece fits the bed.' : ': too big for the bed. Add a cut.'}` : 'No cuts: the model stays as it is.'}</span></p>
        <div class="row tight"><button class="btn cut" data-act="split-cut" ${sp.planes.length ? '' : 'disabled'}>${ICONS.cut}<span>Cut into ${plan.pieces} pieces</span></button><button class="btn" data-act="split-clear">Clear</button></div>`;
    }
    return `<div class="ins-section split">${body}</div>`;
  }
  const SPLIT_MARGIN = 5;
  function planSplit(counts) {
    const b = modelBounds();
    const plan = K.planBedCuts(b, state.bed, SPLIT_MARGIN, counts);
    state.split.planes = plan.planes;
    renderInspector(); renderSplitPlanes();
  }
  function clearSplit() { state.split.planes = null; state.split.counts = [null, null, null]; renderInspector(); renderSplitPlanes(); }
  const splitGroup = new THREE.Group();
  scene.add(splitGroup);
  function renderSplitPlanes() {
    clearGroup(splitGroup);
    const planes = state.split.planes;
    if (!planes || !planes.length || !state.parts.length) { markDirty(); return; }
    const b = modelBounds(), pad = 1.08;
    for (const q of planes) {
      const size = [0, 1, 2].filter(a => a !== q.axis).map(a => b.size[a] * pad);
      const geo = new THREE.PlaneGeometry(size[0], size[1]);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      const c = b.center.slice(); c[q.axis] = q.pos;
      m.position.set(c[0], c[1], c[2]);
      if (q.axis === 0) m.rotation.y = Math.PI / 2; else if (q.axis === 1) m.rotation.x = Math.PI / 2;
      splitGroup.add(m);
      // its outline, so the sheet reads as a cut even where it's seen edge on
      const [a1, a2] = [0, 1, 2].filter(a => a !== q.axis), corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, u]) => { const v = c.slice(); v[a1] += s * size[0] / 2; v[a2] += u * size[1] / 2; return new THREE.Vector3(v[0], v[1], v[2]); });
      splitGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0xf2b705 })));
    }
    markDirty();
  }
  // Cut every part the planned planes cross, plane by plane, with keys from the settings; thin areas are cut anyway
  // (the piece has to fit the bed). One undo step for the lot.
  async function cutToFit() {
    const planes = state.split.planes;
    if (!planes || !planes.length) return;
    busy('Cutting to fit the bed');
    await nextFrame();
    let parts = state.parts.slice(), keys = 0, warnings = 0, cuts = 0;
    const originals = new Map(parts.map(p => [p.id, p.name]));
    const baseOf = new Map(parts.map(p => [p.id, p.name]));
    for (const q of planes) {
      const next = [];
      for (const p of parts) {
        if (p.kind === 'pin' || !(q.pos > p.bbox.min[q.axis] + 0.5 && q.pos < p.bbox.max[q.axis] - 0.5)) { next.push(p); continue; }
        const n = [0, 0, 0]; n[q.axis] = 1;
        const o = p.bbox.center.slice(); o[q.axis] = q.pos;
        const F = K.frameFromNormal(n, o), cfg = coreCfg(), scale = K.diag(p.bbox);
        let res = null;
        try {
          const an = K.analyzePlane(p.positions, p.indices, F, cfg, scale);
          if (an.base.error || !an.base.regions.length) { next.push(p); continue; }
          const ks = pointKeys() ? (state.cfg.sizeMode === 'set' ? K.autoPlaceKeys(an, cfg, state.cfg.perArea, new Set()) : K.autoFitKeys(an, cfg, state.cfg.perArea, new Set())) : [];
          const plugs = state.cfg.type === 'plug' ? K.planPlugs(an, cfg).filter(x => x.ok) : [];
          res = K.cutMesh(p.positions, p.indices, F, { scale, cfg, keys: ks, plugs, skip: new Set(), minThickness: minWall(), force: true });
          keys += ks.length + plugs.length;
          warnings += (res.warnings || []).length;
        } catch (err) { next.push(p); continue; } // a cut that only cracks the part, or can't seal: the part stays whole here
        cuts++;
        const base = baseOf.get(p.id) || p.name;
        const joints = jointOf(p, { type: state.cfg.type, keys: res.keysUsed || 0, number: null });
        for (const c of res.parts) { const np = makePart({ name: base, color: p.color, positions: c.positions, indices: c.indices, pull: c.side === 'below' ? [-n[0], -n[1], -n[2]] : c.side === 'above' ? n.slice() : null, joints }); baseOf.set(np.id, base); next.push(np); }
        for (const pin of res.pins || []) next.push(makePart({ name: `${base} pin`, color: PIN_COLOR, positions: pin.positions, indices: pin.indices, kind: 'pin' }));
        await nextFrame();
      }
      parts = next;
    }
    // number the pieces of each original part
    const counter = new Map();
    for (const p of parts) { if (originals.has(p.id)) continue; const base = baseOf.get(p.id) || p.name; if (p.kind === 'pin') continue; const k = (counter.get(base) || 0) + 1; counter.set(base, k); p.name = `${base} ${k}`; }
    const pieces = parts.filter(p => p.kind !== 'pin').length, fit = parts.filter(p => p.kind !== 'pin' && fitsBed(p)).length;
    commit(parts, 'the split to fit the bed');
    state.split.planes = null; state.selectedId = null;
    busy(null);
    syncScene(); renderSplitPlanes();
    toast(cuts ? `Cut into ${pieces} pieces${fit === pieces ? ', all of which fit the bed' : `, ${fit} of which fit the bed`}${keys ? `, with ${keys} keys` : ''}.${warnings ? ` ${warnings === 1 ? 'One cut' : `${warnings} cuts`} left a thin piece; check ${warnings === 1 ? 'it' : 'them'} before printing.` : ''}` : 'None of the planned cuts could be made. Move them and try again.', cuts ? '' : 'error');
  }
  // The key status that sits above Cut part: are the keys or plugs placed and sound, is any area too thin.
  function keyStatusHTML() {
    const c = state.cfg;
    const an = state.cut.analysis;
    const regions = an && !an.base.error ? an.base.regions : [];
    const shown = shownAreas();
    const evals = state.cut.evals;
    const bad = evals.filter(e => !e.ok);
    let keyStatus = '';
    if (c.type === 'plug') {
      const pl = plugsShown(), ok = pl.filter(q => q.ok), no = pl.filter(q => !q.ok), many = shown.length > 1, num = (i) => shown.indexOf(i) + 1;
      if (state.cut.stale) keyStatus = `<p class="status muted">Fitting plugs…</p>`;
      else if (an && an.base.error) keyStatus = `<p class="status warn">${ICONS.alert}<span>The surface is broken where it crosses this cut, so plugs can’t be checked. Move the cut slightly or fill holes first.</span></p>`;
      else if (!regions.length) keyStatus = `<p class="status muted">Slide the cut into the part to see the plugs.</p>`;
      else {
        if (ok.length) {
          const ds = ok.map(q => q.depth), lo = Math.min(...ds), hi = Math.max(...ds), deep = lo.toFixed(1) === hi.toFixed(1) ? `${fmt(lo)} mm deep` : `${fmt(lo)} to ${fmt(hi)} mm deep`;
          keyStatus = `<p class="status ok">${ICONS.check}<span>${ok.length === 1 ? (many ? `A plug in area ${num(ok[0].region)}` : 'A plug') : `Plugs in ${ok.length} areas`} ${deep}, with walls at least ${c.margin} mm thick${ok.some(q => q.short) ? ' (shallower where the other piece is thin)' : ''}.</span></p>`;
        }
        if (no.length) {
          const said = { 'Area too small for a plug': 'too small', 'Area has a hole through it': 'it has a hole through it', 'The other piece is too thin here for a plug': 'the other piece is too thin', 'A pocket would break out of the other piece here': 'the pocket would break out of the other piece', 'Area too irregular for a plug': 'its shape is too irregular' };
          const why = [...new Set(no.map(q => said[q.reason] || q.reason))].join(', or ');
          const where = many ? (no.length === 1 ? `area ${num(no[0].region)}` : `areas ${no.map(q => num(q.region)).sort((a, b) => a - b).join(', ')}`) : '';
          keyStatus += `<p class="status warn no-key">${ICONS.alert}<span>${ok.length ? `No plug in ${where}` : many ? `No plug in ${where}` : 'No room for a plug on this cut'}: ${esc(why)}. Try a thinner wall, pegs, or a different cut.</span></p>`;
        }
      }
    } else if (c.type !== 'none') {
      if (state.cut.stale) keyStatus = `<p class="status muted">Checking key placement…</p>`;
      else if (an && an.base.error) keyStatus = `<p class="status warn">${ICONS.alert}<span>The surface is broken where it crosses this cut, so keys can’t be checked. Move the cut slightly or fill holes first.</span></p>`;
      else if (!regions.length) keyStatus = `<p class="status muted">Slide the cut into the part to see where keys can go.</p>`;
      else if (!state.cut.keys.length) keyStatus = `<p class="status warn">${ICONS.alert}<span>${esc(noKeyMessage(areasWithoutKeys().length ? areasWithoutKeys() : shown, true))}</span></p>`;
      else if (bad.length) {
        const reasons = [...new Set(bad.map(b => b.reason))].join('. ');
        keyStatus = `<p class="status warn">${ICONS.alert}<span>${bad.length === 1 ? 'One key needs' : bad.length + ' keys need'} attention: ${esc(reasons)}.</span></p><button class="btn small" data-act="remove-bad">Remove ${bad.length === 1 ? 'it' : 'them'}</button>`;
      } else keyStatus = `<p class="status ok">${ICONS.check}<span>${state.cut.keys.length} ${state.cut.keys.length === 1 ? 'key' : 'keys'} ready, with walls at least ${c.margin} mm thick.</span></p>`;
      const missing = state.cut.keys.length ? areasWithoutKeys() : [];
      if (missing.length && shown.length > 1) keyStatus += `<p class="status warn no-key">${ICONS.alert}<span>${esc(noKeyMessage(missing))}</span></p>`;
    }
    const thin = thinShown();
    if (thin.length) { // ahead of everything else: this cut can't be made as it stands
      const many = shown.length > 1;
      keyStatus = `<p class="status warn thin">${ICONS.alert}<span>${esc(K.thinMessage(regions, thin, minWall()))}</span></p><div class="btn-row">${many ? `<button class="btn small" data-act="join-thin">Leave ${new Set(thin.map(q => q.region)).size === 1 ? 'it' : 'them'} joined</button>` : ''}<button class="btn small" data-act="cut-anyway" title="Make the cut against the warning">Cut anyway</button></div>`;
    }
    return keyStatus;
  }
  const TOOL_NAMES = { plane: 'Plane', regions: 'Regions', paint: 'Paint', draw: 'Draw', suggest: 'Suggest', bed: 'Fit bed', shape: 'Shapes', boolean: 'Boolean' };
  const TYPE_NAMES = { peg: 'Pegs', dowel: 'Dowels', magnet: 'Magnets', plug: 'Plug', none: 'None' };
  function jointSummary(c) {
    if (c.type === 'none') return 'None';
    if (c.type === 'plug') return `Plug${c.plugDepthMode === 'set' ? `, ${fmt(c.plugDepth || 5)} mm deep` : ''}`;
    return `${TYPE_NAMES[c.type]} · ${SHAPE_NAMES[K.keyGeometrySpec(c).shape]} · ${c.sizeMode === 'set' ? `${fmt(c.diameter)} mm` : 'sized to fit'}`;
  }
  function cutPanel(p) {
    const c = state.cfg, s = p.bbox.size;
    const lenLabel = c.type === 'magnet' ? 'Thickness' : 'Length';
    const shownShape = K.keyGeometrySpec(c).shape;
    const typeLine = { peg: 'A peg on one piece fits a socket in the other.', dowel: 'Holes in both pieces, with printable pins. Metal rods work too.', magnet: 'Pockets in both pieces, sized for disc magnets.', plug: 'The cut face itself, pulled in from the edge, stands out into a matching pocket in the other piece.' }[c.type];
    const plugPanel = () => `<p class="muted small type-line">${typeLine}</p>
      <div class="inline"><span class="lbl">Depth</span>${seg('plugdepth', c.plugDepthMode === 'set' ? 'set' : 'auto', [['auto', 'As deep as fits'], ['set', 'Set']])}</div>
      <div class="grid2">${c.plugDepthMode === 'set' ? inlineField('plugDepth', 'Depth', c.plugDepth || 5, { min: 1, step: 0.5, aria: 'Plug depth' }) : '<span class="muted small size-note">Up to 10 mm</span>'}${inlineField('plugSlope', 'Slope', c.plugSlope === undefined ? 5 : c.plugSlope, { min: 0, max: 30, step: 1, unit: '°', aria: 'Slope of the plug’s sides' })}</div>
      <div class="inline"><span class="lbl">Fit</span>${seg('fit', c.clearance, [['0.1', 'Snug'], ['0.2', 'Standard'], ['0.3', 'Loose']])}</div>
      <div class="grid2">${inlineField('clearance', 'Gap', c.clearance, { min: 0, step: 0.05, aria: 'Gap per side' })}${inlineField('margin', 'Wall', c.margin, { min: 0.4, step: 0.2, aria: 'Wall round the plug' })}</div>
      <div class="inline"><span class="lbl">Plug on</span>${seg('pegside', c.pegSide, state.regions.on ? [['below', 'This piece'], ['above', 'Other piece']] : [['below', 'Solid half'], ['above', 'Clear half']])}</div>`;
    const editing = state.cut.active >= 0 && state.cut.keys[state.cut.active] && pointKeys();
    const jointsOpen = editing || (state.ui.joints !== null ? state.ui.joints : state.tool === 'plane'); // open with the plane; the other tools need their room, and the summary line says what the joints are
    return `<div class="ins-section head">
      <div class="head-row"><h2 title="${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm, ${fmtInt(p.tris)} triangles">${esc(p.name)}</h2><span><button class="btn ghost small" data-act="export-one" title="Export this part on its own">Export</button><button class="btn ghost small" data-act="done" title="Back to the model (Esc)">Done</button></span></div>
    </div>
    <div class="sec tool-sec"><div id="toolSlot"></div></div>
    <details class="sec" data-sec="joints"${jointsOpen ? ' open' : ''}><summary>Joints<span class="sec-sum">${esc(jointSummary(c))}</span></summary>
    ${editing ? keyEditor(state.cut.active) : `<div class="ins-section keys" aria-label="Keys">
      ${seg('keytype', c.type, [['peg', 'Pegs'], ['dowel', 'Dowels'], ['magnet', 'Magnets'], ['plug', 'Plug'], ['none', 'None']]).replace(/data-value="(\w+)"/g, (m, v) => `${m} title="${({ peg: 'A peg on one piece fits a socket in the other', dowel: 'Holes in both pieces, with printable pins. Metal rods work too', magnet: 'Pockets in both pieces, sized for disc magnets', plug: 'The cut face itself stands out into a matching pocket', none: 'No keys: flat faces' })[v]}"`)}
      ${c.type === 'none' ? '<p class="muted small">The pieces will have flat faces with nothing to line them up.</p>' : c.type === 'plug' ? plugPanel() : `
      ${c.type !== 'peg' ? `<p class="muted small type-line">${typeLine}</p>` : ''}
      ${shapePicker(c)}
      <p class="muted small shape-help" title="${esc(SHAPE_HELP[shownShape])}"><span class="shape-name">${SHAPE_NAMES[shownShape]}.</span> ${SHAPE_HELP[shownShape]}</p>
      <div class="inline"><span class="lbl" title="${esc(SHAPE_NAMES[shownShape])}: ${esc(SHAPE_HELP[shownShape])}">Size</span>${seg('sizemode', c.sizeMode === 'set' ? 'set' : 'auto', [['auto', 'Fit each area'], ['set', 'One size']])}</div>
      <div class="grid2">${c.sizeMode === 'set'
        ? `${inlineField('diameter', shownShape === 'round' ? 'Diameter' : 'Width', c.diameter, { min: 1, step: 0.5 })}${inlineField('length', lenLabel, c.length, { min: 0.5, step: 0.5 })}`
        : c.type === 'magnet' ? `${inlineField('diameter', 'Largest', c.diameter, { min: 2, step: 1, aria: 'Largest magnet' })}<span class="muted small size-note">Standard magnet sizes</span>`
        : `${inlineField('diameter', 'Largest', c.diameter, { min: 1, step: 0.5, aria: 'Largest key width' })}${inlineField('sizeMin', 'Smallest', c.sizeMin, { min: 0.5, step: 0.5, aria: 'Smallest key width' })}`}</div>
      <div class="inline"><span class="lbl">Fit</span>${seg('fit', c.clearance, [['0.1', 'Snug'], ['0.2', 'Standard'], ['0.3', 'Loose']])}</div>
      <div class="grid2">${inlineField('clearance', 'Gap', c.clearance, { min: 0, step: 0.05, aria: 'Gap per side' })}${inlineField('margin', 'Wall', c.margin, { min: 0.4, step: 0.2, aria: 'Wall around keys' })}</div>
      ${shownShape !== 'round' ? `<div class="grid2 direction"><label class="check"><input type="checkbox" data-cfg="align" ${c.align !== false ? 'checked' : ''}> Line up with area</label>
        ${inlineField('turn', 'Turn', c.turn || 0, { min: -180, max: 180, step: 15, unit: '°', aria: 'Turn by' })}</div>` : ''}
      ${c.type === 'peg' ? `<div class="inline"><span class="lbl">Pegs on</span>${seg('pegside', c.pegSide, state.regions.on ? [['below', 'This piece'], ['above', 'Other piece']] : [['below', 'Solid half'], ['above', 'Clear half']])}</div>
        ${taperField(c)}` : ''}
      <div class="row keyrow">
        <label class="numi"><span>Keys per area</span><select data-cfg="perArea" aria-label="Keys per area">${[1, 2, 3, 4].map(n => `<option ${n === c.perArea ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn small" data-act="auto-keys">${state.cut.auto ? 'Re-place keys' : 'Auto-place keys'}</button>
      </div>
      <label class="check" title="Engrave the same number on both faces of each cut, 0.6 mm deep, so the pieces of a big kit pair up"><input type="checkbox" data-cfg="numberJoints" ${c.numberJoints ? 'checked' : ''}> Number the joints</label>
`}
    </div>`}
    </details>
    <div class="ins-section cut-action" id="cutAction">${actionHTML(p)}</div>`;
  }
  // The one yellow button at the foot of the panel does what the chosen tool is ready to do: cut the part along the
  // plane, split off the picked region or painted area, cut along the picked lines, or close the line being drawn.
  function pickButtonLabel(pick) {
    const region = !!pick.regions, nr = region ? pick.regions.length : 0, nl = pick.loops.length, painted = !!pick.painted;
    return pick.forced ? (region ? `Split ${painted || nr === 1 ? 'it' : 'them'} off anyway` : `Cut along ${nl === 1 ? 'it' : 'them'} anyway`) : painted ? 'Split off painted area' : region ? `Split off ${nr === 1 ? 'this region' : 'these regions'}` : `Cut along ${nl === 1 ? 'this line' : 'these lines'}`;
  }
  function actionHTML(p) {
    if (!p || state.tool === 'bed' || state.tool === 'shape') return '';
    const cutBtn = (act, label, key = 'Enter') => `<button class="btn cut" data-act="${act}">${ICONS.cut}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    const waitBtn = (label) => `<button class="btn cut" disabled>${ICONS.cut}<span>${label}</span></button>`;
    if (state.tool === 'boolean') { const sh = booleanShape(); return sh ? cutBtn('boolean', BOOL_LABELS[state.bool.op]) : waitBtn('Add a shape first'); }
    if (state.regions.on) {
      const pick = state.regions.pick;
      if (state.draw.on) { const n = state.draw.points.length; return n >= 3 ? cutBtn('close-draw', 'Close the line') : waitBtn(`Click ${3 - n} more point${3 - n === 1 ? '' : 's'} on the part`); }
      if (pick && pick.preview) return cutBtn('split-painted', 'Split off painted area', '');
      if (pick && pick.result) return cutBtn('cut-line', pickButtonLabel(pick));
      return waitBtn(pick && pick.error ? 'Can’t cut here' : state.paint.on ? 'Paint an area to split off' : 'Pick a region or a line');
    }
    return `<div class="key-status" id="keyStatus">${keyStatusHTML()}</div>${cutBtn('cut', 'Cut part')}`;
  }
  function renderAction() {
    const el = $('#cutAction'); if (!el) return;
    const h = actionHTML(selectedPart());
    el.innerHTML = h; el.hidden = !h;
  }
  function updatePositionReadout() {
    const out = $('#cutPosOut'), range = $('#cutPos');
    if (!range) return;
    const s = planeOffset();
    if (document.activeElement !== range) { range.min = state.cut.lo; range.max = state.cut.hi; range.value = s; }
    if (out) out.textContent = (s >= 0 ? '+' : '') + fmt(s) + ' mm';
    const num = $('#cutPosNum');
    if (num && document.activeElement !== num) num.value = s.toFixed(1);
    const ang = planeAngles();
    for (const el of document.querySelectorAll('[data-angle]')) if (document.activeElement !== el) el.value = fmtAngle(ang[el.dataset.angle]);
    const to = $('#tiltOut');
    if (to) { const t = tiltInfo(); to.textContent = t.deg < 0.05 ? `Square to ${t.axis}` : `${t.deg.toFixed(1)}° off ${t.axis}`; }
  }

  const ins = $('#inspector');
  function onPanelClick(e) {
    const sm = e.target.closest('summary');
    if (sm && sm.parentElement.dataset.sec) { state.ui[sm.parentElement.dataset.sec] = !sm.parentElement.open; return; } // the click opens or closes it next
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, val = b.dataset.value;
    const c = state.cfg;
    switch (act) {
      case 'done': selectPart(null); break;
      case 'align': alignPlane(val); break;
      case 'flip': flipPlane(); break;
      case 'straighten': straighten(); break;
      case 'find-cuts': findSuggestions(); break;
      case 'cut-here': setHere(!state.here.on); break;
      case 'cut-across': setAcross(!state.across.on); break;
      case 'key-done': state.cut.active = -1; renderKeyMarkers(); renderInspector(); break;
      case 'kshape': setKeyOwn('shape', val); break;
      case 'key-reset': { const k = state.cut.keys[state.cut.active]; if (k) { delete k.o; evaluateKeys(); renderKeyMarkers(); renderInspector(); renderAreaTags(); } break; }
      case 'suggest': applySuggestion(+val); break;
      case 'keytype': {
        if (c.type === val) break;
        c.type = val;
        if (K.KEY_DEFAULTS[val]) { c.diameter = K.KEY_DEFAULTS[val].diameter; c.length = K.KEY_DEFAULTS[val].length; }
        state.cut.auto = true; savePrefs(); scheduleAnalysis(0); renderInspector(); updateHint();
        break;
      }
      case 'shape': c.shape = val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'fit': c.clearance = +val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'plugdepth': c.plugDepthMode = val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'sizemode': c.sizeMode = val; state.cut.auto = true; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'printer': {
        const pr = K.PRINTERS[val];
        c.printer = val; c.sizeMin = pr.min; c.clearance = pr.gap; c.margin = pr.wall;
        savePrefs(); renderInspector();
        toast(val === 'resin' ? 'Set up for resin: keys down to 1 mm, 0.1 mm gap, 0.8 mm walls.' : 'Set up for filament: keys down to 2.5 mm, 0.2 mm gap, 1.2 mm walls.');
        break;
      }
      case 'pegside': c.pegSide = val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'auto-keys': state.cut.auto = true; state.cut.active = -1; scheduleAnalysis(0); renderInspector(); break;
      case 'remove-bad': removeBadKeys(); break;
      case 'join-thin': joinThin(); break;
      case 'cut-anyway': doCut(true); break;
      case 'remove-key': if (state.cut.active >= 0) removeKey(state.cut.active); break;
      case 'cut': doCut(); break;
      case 'cut-line': cutAlongPick(); break;
      case 'split-painted': splitPainted(); break;
      case 'close-draw': closeDrawing(); break;
      case 'tool': setTool(val); break;
      case 'shape-add': addShape(val); break;
      case 'shape-kind': setShape({ kind: val }, 'the shape change'); break;
      case 'shape-edge': setShape({ edge: val }, 'the edge change'); break;
      case 'shape-mode': state.shapeMode = val; attachGizmo(); renderInspector(); updateHint(); break;
      case 'shape-centre': { const b = modelBounds(); setShape({ pos: b.center.slice() }, 'moving the shape'); break; }
      case 'shape-ground': { const p = selectedPart(); if (p && p.shape) { const others = state.parts.filter(q => q !== p); const b = others.length ? K.bounds(K.mergeMeshes(others).positions) : modelBounds(); const sp = p.shape; setShape({ pos: [sp.pos[0], sp.pos[1], b.min[2] + p.shape.h / 2] }, 'moving the shape'); } break; }
      case 'shape-remove': removeShape(); break;
      case 'bool-op': state.bool.op = val; renderInspector(); updateHint(); break;
      case 'boolean': doBoolean(); break;
      case 'export-one': exportParts(state.selectedId); break;
      case 'fill-holes': busy('Repairing the surface'); setTimeout(() => { repairSurface(); busy(null); }, 30); break;
      case 'reduce': reduceModel(); break;
      case 'start-over': startOver(); break;
      case 'save-project': saveProject(); break;
      case 'open-project': fileInput.click(); break;
      case 'split-plan': planSplit(null); break;
      case 'split-cut': cutToFit(); break;
      case 'split-clear': clearSplit(); break;
      case 'rotate': rotateAll(val); break;
      case 'scale': scaleAll(+val); break;
      case 'scale-custom': scaleAll((+$('#scalePct').value || 100) / 100); break;
      default: break;
    }
  }
  function onPanelChange(e) {
    const t = e.target;
    if (t.dataset.kcfg) {
      const f = t.dataset.kcfg;
      if (t.type === 'checkbox') { setKeyOwn(f, t.checked); return; }
      const v = parseFloat(t.value);
      if (!isFinite(v) || (v < 0 && f !== 'turn') || (f === 'diameter' && v < 1) || (f === 'length' && v < 0.5)) { renderInspector(); return; }
      setKeyOwn(f, f === 'turn' ? normTurn(v) : v);
      return;
    }
    if (t.dataset.bool === 'shape') { const sh = state.parts.find(q => String(q.id) === t.value); state.bool.shapeId = sh ? sh.id : null; renderInspector(); updateHint(); return; }
    if (t.dataset.shape) {
      const k = t.dataset.shape, v = parseFloat(t.value), p = selectedPart();
      if (!isFinite(v) || !p || !p.shape) { renderInspector(); return; }
      if (/^pos\d$/.test(k)) { const pos = p.shape.pos.slice(); pos[+k[3]] = v; setShape({ pos }, 'moving the shape'); }
      else if (/^rot\d$/.test(k)) { const rot = p.shape.rot.slice(); rot[+k[3]] = v; setShape({ rot }, 'turning the shape'); }
      else setShape({ [k]: v }, 'the shape change');
      return;
    }
    if (t.dataset.cfg) {
      const k = t.dataset.cfg;
      if (k === 'diameter' || k === 'length') state.cfg.sizeByHand = true; // the owner's own size stays, whatever the model's size
      if (t.type === 'checkbox') state.cfg[k] = t.checked;
      else {
        const v = parseFloat(t.value);
        if (!isFinite(v) || (v < 0 && k !== 'turn')) { renderInspector(); return; }
        state.cfg[k] = k === 'perArea' ? Math.round(v) : k === 'turn' ? normTurn(v) : v;
      }
      if (k === 'perArea') state.cut.auto = true;
      savePrefs(); scheduleAnalysis(0); renderInspector();
    } else if (t.id === 'bedPreset') {
      applyBedPreset(t.value);
    } else if (t.dataset.bed) {
      const v = parseFloat(t.value);
      if (isFinite(v) && v > 0) { state.bed[t.dataset.bed] = v; state.bedPreset = ''; savePrefs(); renderParts(); if (!selectedPart()) renderInspector(); }
    } else if (t.dataset.splitCount !== undefined) {
      const ax = +t.dataset.splitCount, v = Math.max(0, Math.min(20, Math.round(parseFloat(t.value) || 0)));
      const counts = [0, 1, 2].map(a => (a === ax ? v : state.split.planes.filter(q => q.axis === a).length));
      planSplit(counts);
    } else if (t.dataset.splitPos !== undefined) {
      const i = +t.dataset.splitPos, v = parseFloat(t.value);
      if (isFinite(v) && state.split.planes && state.split.planes[i]) { state.split.planes[i].pos = v; renderInspector(); renderSplitPlanes(); }
    } else if (t.dataset.area !== undefined) {
      const i = +t.dataset.area;
      if (t.checked === state.cut.skip.has(i)) toggleArea(i);
    } else if (t.id === 'cutPos') {
      computeSliderRange(); state.cut.skip.clear(); scheduleAnalysis(0);
    } else if (t.id === 'moveLineBy') {
      state.moveBy = Math.max(0.1, parseFloat(t.value) || 1);
    } else if (t.id === 'cutPosNum') {
      const v = parseFloat(t.value);
      if (isFinite(v)) { setPlaneOffset(v); state.cut.skip.clear(); scheduleAnalysis(0); }
      renderInspector();
    } else if (t.dataset.angle) {
      const v = parseFloat(t.value);
      if (isFinite(v)) {
        const a = planeAngles();
        a[t.dataset.angle] = v;
        setPlaneAngles(a);
        state.cut.skip.clear(); scheduleAnalysis(0);
      }
      renderInspector();
    }
  }
  for (const el of [ins, $('#planeBar')]) {
    el.addEventListener('mouseover', (e) => { const r = e.target.closest('[data-area-row]'); if (r) setHoverArea(+r.dataset.areaRow); });
    el.addEventListener('mouseout', (e) => {
      const r = e.target.closest('[data-area-row]');
      if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) setHoverArea(-1);
    });
  }
  function onPanelInput(e) {
    const t = e.target;
    if (t.id === 'keyTaper') { // live preview of one key's taper
      const k = state.cut.keys[state.cut.active];
      if (k) { k.o = { ...(k.o || {}), taper: parseFloat(t.value) }; const out = $('#keyTaperOut'); if (out) out.textContent = `${Math.round(k.o.taper)}%`; renderKeyMarkers(); }
      return;
    }
    if (t.id === 'cutPos') {
      setPlaneOffset(parseFloat(t.value));
      state.cut.stale = true; renderKeyMarkers();
      clearTimeout(analysisTimer);
      analysisTimer = setTimeout(() => { state.cut.skip.clear(); runAnalysis(); }, 220);
    } else if (t.id === 'taperPct') { // live preview while dragging; the change event re-checks the keys
      state.cfg.taper = parseFloat(t.value);
      const out = $('#taperOut'); if (out) out.textContent = `${Math.round(state.cfg.taper)}%`;
      renderKeyMarkers();
    }
  }

  // The right panel, the cut toolbar along the bottom of the view and the suggestions in the left panel share these.
  const planeBar = $('#planeBar');
  for (const el of [ins, planeBar]) {
    el.addEventListener('click', onPanelClick);
    el.addEventListener('change', onPanelChange);
    el.addEventListener('input', onPanelInput);
  }

  /* ---------------- top bar, empty state, view tools ---------------- */
  $('#openBtn').addEventListener('click', () => fileInput.click());
  $('#emptyOpen').addEventListener('click', () => fileInput.click());
  $('#emptySample').addEventListener('click', loadSample);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#exportBtn').addEventListener('click', () => exportParts(null));
  $('#frameBtn').addEventListener('click', () => frameAll(selectedPart() || undefined));
  // Look from a side, the top or the bottom (the guide's axis widget): the camera swings round the chosen part, or
  // the whole model, to that side at framing distance; the list goes back to its label so it can be used again.
  const VIEW_DIRS = { front: [0, -1, 0.02], back: [0, 1, 0.02], left: [-1, 0, 0.02], right: [1, 0, 0.02], top: [0.0001, -0.02, 1], bottom: [0.0001, -0.02, -1] };
  function viewFrom(which) {
    const d = VIEW_DIRS[which];
    if (!d || !state.parts.length) return;
    const p = selectedPart(), b = p ? p.bbox : modelBounds();
    const c = new THREE.Vector3(...b.center), R = Math.max(1, Math.hypot(...b.size) / 2);
    const dist = R / Math.sin((camera.fov * Math.PI) / 360) * 1.08;
    const toPos = c.clone().add(new THREE.Vector3(...d).normalize().multiplyScalar(dist));
    const fromPos = camera.position.clone(), fromTarget = orbit.target.clone();
    camera.near = Math.max(0.05, R / 200); camera.far = R * 60; camera.updateProjectionMatrix();
    placeLights(b.center, R);
    animate(380, (k) => { camera.position.lerpVectors(fromPos, toPos, k); orbit.target.lerpVectors(fromTarget, c, k); });
  }
  $('#viewFrom').addEventListener('change', (e) => { viewFrom(e.target.value); e.target.value = ''; e.target.blur(); });
  // Light or dark: the system's choice until the button is pressed, then the choice is kept
  const THEME_KEY = 'keymaster.theme';
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    const dark = theme ? theme === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const b = $('#themeBtn'); if (b) { b.setAttribute('aria-pressed', dark ? 'true' : 'false'); b.title = dark ? 'Switch to light' : 'Switch to dark'; }
    return dark;
  }
  let theme = '';
  try { theme = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* storage unavailable */ }
  applyTheme(theme);
  $('#themeBtn').addEventListener('click', () => {
    const dark = applyTheme(theme);
    theme = dark ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  });
  /* ---------------- surface regions ----------------
     Colour each part by the regions its surface splits into where it turns sharply (like ZBrush polygroups),
     with dark lines on the borders. The cut preview steps aside while they show; results are kept per part
     and threshold. */
  const regionCache = new Map();
  const REGION_HUES = (() => { const out = []; let h = 205; while (out.length < 64) { h = (h + 137.508) % 360; if (h < 35 || h > 75) out.push(h); } return out; })(); // never yellow: that means cutting
  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }
  function regionsFor(p) {
    const key = `${p.id}:${state.regions.angle}:${state.regions.fold}`;
    if (!regionCache.has(key)) regionCache.set(key, K.segmentSurface(p.positions, p.indices, { angle: state.regions.angle, fold: state.regions.fold }));
    return regionCache.get(key);
  }
  // Cut lines: each part's closed region borders and outlines, worked out with its regions.
  const lineCache = new Map();
  function linesFor(p) {
    const key = `${p.id}:${state.regions.angle}:${state.regions.fold}`;
    if (!lineCache.has(key)) lineCache.set(key, K.cutLines(p.positions, p.indices, regionsFor(p)));
    return lineCache.get(key);
  }
  // Pick the cut line nearest a point on a part (in the part's own coordinates), try the cut straight away, and
  // show the line and what the cut would do.
  function pickCutLine(p, point, add = false) {
    const prev = add && state.regions.pick && state.regions.pick.partId === p.id ? state.regions.pick : null;
    clearPick();
    const seg = regionsFor(p), near = K.borderLoopNear(p.positions, seg, linesFor(p), point);
    const sameLoop = (a, b) => a === b || (a.verts.length === b.verts.length && a.verts[0] === b.verts[0] && a.verts[1] === b.verts[1]);
    if (near && near.distance <= K.diag(p.bbox) * 0.015) {
      if (prev && prev.regions) { toast('Shift-click adds lines to lines, or regions to regions. Click to start again.', 'warn'); pickLoops(p, prev.loops, { regions: prev.regions, seg }); return; }
      const loops = prev ? prev.loops.filter(l => !sameLoop(l, near.loop)) : []; // a line already in the pick comes out again
      if (!prev || loops.length === prev.loops.length) loops.push(near.loop);
      pickLoops(p, loops, { lines: true });
      return;
    }
    const g = K.regionAtPoint(p.positions, p.indices, seg, point);
    if (g < 0) { toast('Click a region to split it off, or a dark border line to cut along it.'); if (prev) pickLoops(p, prev.loops, prev.regions ? { regions: prev.regions, seg } : { lines: true }); else renderPick(); return; }
    if (prev && !prev.regions) { toast('Shift-click adds lines to lines, or regions to regions. Click to start again.', 'warn'); pickLoops(p, prev.loops, { lines: true }); return; }
    let regions = prev ? prev.regions.filter(x => x !== g) : []; // a region already in the pick comes out again
    if (!prev || regions.length === prev.regions.length) regions.push(g);
    if (!regions.length) { renderPick(); return; }
    pickLoops(p, K.groupLoops(p.positions, p.indices, seg, regions), { regions, seg });
  }
  // Try the cut along one line, or round a whole region (all its outline loops at once), with keys or a plug on
  // each line from the key settings, and show the lines and what the cut would do.
  function pickLoops(p, loops, info) {
    if (state.selectedId !== p.id) selectPart(p.id); // the pick's part is the chosen one, so its panel and its cut button show
    // lines picked by hand are turned to agree first (the smaller side is side 1), so keys are planned in the frames
    // the cut will use; a region's outline already agrees
    if (!info.regions && loops.length && loops.every(l => l.closed)) { try { loops = K.orientLoops(p.positions, p.indices, loops, { what: 'lines' }).loops; } catch (err) { /* the cut will say why */ } }
    const pick = { partId: p.id, loops, loop: loops[0], regions: info.regions, region: info.regions ? info.regions[0] : undefined, painted: !!info.painted, keys: [], plugs: [], perLoop: [], frames: [], ans: [] };
    const cfg = coreCfg(), minThickness = minWall(), D = K.diag(p.bbox);
    const closed = loops.length > 0 && loops.every(l => l.closed);
    // On a curved cut "Pegs on" means the piece being split off (this piece) or the other piece, whichever way
    // each line happens to face: the side is worked out per line from the analysis (curvedSide), so a plug stands
    // on the arm and its pocket goes into the body, not the other way round.
    if (closed && cfg.type !== 'none') {
      for (const loop of loops) {
        const per = { keys: [], plugs: [] };
        try {
          const an0 = K.analyzeLoop(p.positions, p.indices, loop, cfg, D), side = curvedSide(cfg.pegSide, an0.curved.into2), lcfg = { ...cfg, pegSide: side };
          const an = side === cfg.pegSide ? an0 : K.analyzeLoop(p.positions, p.indices, loop, lcfg, D);
          per.pegSide = side; per.cfg = lcfg;
          pick.frames.push(an.frame); pick.ans.push(an);
          if (cfg.type === 'plug') {
            const pl = K.planPlugs(an, lcfg);
            per.plugs = pl.filter(q => q.ok);
            if (!per.plugs.length && !pick.noKeys) { const why = (pl[0] || {}).reason || 'no room'; pick.noKeys = `No plug inside ${loops.length > 1 ? 'one of its lines' : 'this line'} (${why.charAt(0).toLowerCase() + why.slice(1)}), so that line will be cut without one.`; }
          } else {
            const keys = state.cfg.sizeMode === 'set' ? K.autoPlaceKeys(an, lcfg, state.cfg.perArea, new Set()) : K.autoFitKeys(an, lcfg, state.cfg.perArea, new Set());
            const ok = K.evaluateKeys(an, keys, lcfg, new Set());
            per.keys = keys.filter((k, i) => ok[i].ok);
            if (!per.keys.length && !pick.noKeys) pick.noKeys = `No room for keys inside ${loops.length > 1 ? 'one of its lines' : 'this line'} at these settings, so that line will be cut without them.`;
          }
        } catch (err) { pick.frames.push(null); pick.ans.push(null); if (!pick.noKeys) pick.noKeys = 'Keys couldn’t be placed on this line, so it will be cut without them.'; }
        if (state.cfg.numberJoints && !per.plugs.length && pick.ans[pick.ans.length - 1]) { const jm = K.jointMarks(pick.ans[pick.ans.length - 1].base, 0, per.keys, per.cfg || cfg, state.joint + pick.perLoop.length, { mirror: false }); per.marks = jm ? jm.marks : []; }
        pick.perLoop.push(per); pick.keys.push(...per.keys); pick.plugs.push(...per.plugs);
      }
    } else pick.perLoop = loops.map(() => ({ keys: [], plugs: [] }));
    const run = (withJoints, force) => {
      const o = { cfg, minThickness, force, sink: Math.max(0, +state.cfg.sink || 0), perLoop: withJoints ? pick.perLoop : loops.map((l, i) => ({ keys: [], plugs: [], pegSide: pick.perLoop[i] && pick.perLoop[i].pegSide })) };
      return info.regions ? K.splitRegions(p.positions, p.indices, info.seg, info.regions, o) : loops.length > 1 ? K.cutAlongLoops(p.positions, p.indices, loops, { ...o, what: 'lines' }) : K.cutAlongLoop(p.positions, p.indices, loops[0], { ...o, cfg: o.perLoop[0].pegSide ? { ...cfg, pegSide: o.perLoop[0].pegSide } : cfg, keys: o.perLoop[0].keys, plugs: o.perLoop[0].plugs });
    };
    try { pick.result = run(true); }
    catch (err) {
      let failed = err, joints = true;
      const what = pick.plugs.length ? 'A plug' : 'Keys', it = pick.plugs.length ? 'one' : 'them';
      const dropJoints = () => { pick.keys = []; pick.plugs = []; pick.perLoop = loops.map(() => ({ keys: [], plugs: [] })); pick.noKeys = err.code === 'locked' ? `${what} would make the pieces slide straight apart, and here they’d catch on each other, so it will be cut without ${it}.` : `${what} didn’t fit cleanly here, so it will be cut without ${it}.`; };
      if ((pick.keys.length || pick.plugs.length) && err.code !== 'thin') { // still offer the cut, without keys
        joints = false;
        try { pick.result = run(false); dropJoints(); failed = null; } catch (e2) { failed = e2; }
      }
      // a printability refusal (too thin, or pieces that hook) can be overridden: the cut is offered anyway, with the warning
      if (failed && (failed.code === 'thin' || failed.code === 'locked')) {
        try { pick.result = run(joints, true); if (!joints) dropJoints(); pick.forced = failed.message; } catch (e3) { failed = e3; }
      }
      if (failed && !pick.result) pick.error = failed.message;
    }
    state.regions.pick = pick;
    const v = views.get(p.id);
    if (v) {
      const g = new THREE.Group(), markers = new THREE.Group();
      loops.forEach((loop, li) => {
        const pts = loop.verts.map(i => new THREE.Vector3(p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2]));
        const line = loop.closed ? new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: pick.error ? 0xe5484d : 0x2f6fe0, depthTest: false }))
          : new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe5484d, depthTest: false }));
        line.renderOrder = 9;
        g.add(line);
        const per = pick.perLoop[li], F = pick.frames[li], an = pick.ans[li];
        if (per && F && an && per.keys.length) markers.add(curvedKeyMarkers(per.keys, F, an, per.cfg || state.cfg));
        if (per && F && an && per.plugs.length) markers.add(curvedPlugMarkers(per.plugs, F, an));
      });
      v.pickLine = g; v.mesh.add(g);
      if (markers.children.length) { v.pickKeys = markers; v.mesh.add(markers); }
    }
    renderPick();
    markDirty();
  }
  // Keys on a curved cut, drawn where they'll be: based on the face that follows the line, and as long as they'll be.
  // "Pegs on: this piece" is the piece being split off (side 1, whose material lies at -into2 along the line's frame
  // normal), whatever way the line faces; 'below' names it, 'above' the other piece.
  function curvedSide(pref, into2) { return (pref === 'below') === (into2 > 0) ? 'below' : 'above'; }
  function curvedKeyMarkers(keys, F, an, cfg = state.cfg) {
    const g = new THREE.Group();
    const world = (geom) => { // plane coordinates (u, v, n) to the part's coordinates
      for (const name of ['position', 'normal']) {
        const att = geom.attributes[name];
        if (!att) continue;
        const a = att.array, o = name === 'position' ? F.o : [0, 0, 0];
        for (let i = 0; i < a.length; i += 3) { const x = a[i], y = a[i + 1], z = a[i + 2]; for (let k = 0; k < 3; k++) a[i + k] = o[k] + F.u[k] * x + F.v[k] * y + F.n[k] * z; }
      }
      return geom;
    };
    const sec = { regions: [] };
    for (const k of keys) {
      const kc = K.keyCfg(cfg, k), ks = K.keyGeometrySpec(kc), ang = an ? K.keyAngle(an.base, 0, kc) : K.keyAngle(sec, -1, kc);
      const prof = (rr, dd) => K.keyProfile(ks.shape, rr, dd, k.angle !== undefined ? k.angle : ang, ks.res).map(([x, y]) => [x + k.x, y + k.y]);
      const lv = an ? K.keyLevels(an, cfg, k) : { lo: 0, hi: 0, mid: 0, tip: (cfg.pegSide === 'above' ? -1 : 1) * kc.length, pin: [-kc.length / 2, kc.length / 2] };
      let z0, z1, tipR = ks.r;
      if (cfg.type === 'peg') { z0 = lv.mid; z1 = lv.tip; tipR = ks.r * ks.taper; }
      else if (cfg.type === 'dowel') { [z0, z1] = lv.pin; }
      else { z0 = lv.lo - kc.length; z1 = lv.hi + kc.length; }
      const dg = fanGeometry(prof(ks.r, ks.cs), lv.mid + 0.02);
      dg.attributes.position.array[0] = k.x; dg.attributes.position.array[1] = k.y; // the fan's middle is the key's
      const disc = new THREE.Mesh(world(dg), new THREE.MeshBasicMaterial({ color: 0x1d1d1b, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }));
      const body = new THREE.Mesh(world(prismGeometry(prof(ks.r, 0), prof(tipR, 0), z0, z1)), new THREE.MeshStandardMaterial({ color: 0xfafbfc, roughness: 0.4, transparent: true, opacity: 0.85, depthTest: false })); // seen through the model, like the plug
      disc.renderOrder = 8; body.renderOrder = 8;
      g.add(disc, body);
    }
    return g;
  }
  // A plug on a curved cut, drawn standing on the face that follows the line, as deep as it will be.
  function curvedPlugMarkers(plugs, F, an) {
    const g = new THREE.Group(), H = an.curved.heightAt;
    for (const q of plugs) {
      let lo = Infinity, hi = -Infinity; for (const [x, y] of q.mouth) { const z = H(x, y); lo = Math.min(lo, z); hi = Math.max(hi, z); }
      const tip = (q.side > 0 ? hi : lo) + q.side * q.depth, z0 = q.side > 0 ? lo : hi;
      const geom = prismGeometry(q.base, q.top, z0, tip);
      for (const name of ['position', 'normal']) {
        const att = geom.attributes[name]; if (!att) continue;
        const a = att.array, o = name === 'position' ? F.o : [0, 0, 0];
        for (let i = 0; i < a.length; i += 3) { const x = a[i], y = a[i + 1], z = a[i + 2]; for (let k = 0; k < 3; k++) a[i + k] = o[k] + F.u[k] * x + F.v[k] * y + F.n[k] * z; }
      }
      const body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xfafbfc, roughness: 0.5, transparent: true, opacity: 0.6, depthTest: false }));
      body.renderOrder = 8;
      g.add(body);
    }
    return g;
  }
  function clearPick() {
    for (const v of views.values()) {
      if (v.pickLine) { v.mesh.remove(v.pickLine); clearGroup(v.pickLine); v.pickLine = null; }
      if (v.pickKeys) { v.mesh.remove(v.pickKeys); clearGroup(v.pickKeys); v.pickKeys = null; }
    }
    state.regions.pick = null;
  }
  function renderPick() {
    const el = $('#cutLineInfo'), pick = state.regions.pick;
    if (!el) return;
    const inlayTools = $('#inlayTools'); if (inlayTools) inlayTools.hidden = !(pick && pick.loops && pick.loops.length && pick.loops.every(l => l.closed) && !state.draw.on);
    if (state.paint.on && !pick) {
      const n = paintCount();
      el.innerHTML = `<p class="status muted">${n ? 'Let go to see the outline.' : 'Drag over the part to paint the area to split off. Shift-drag erases. Then Grow, Shrink or Tidy edge as you like.'}</p>`;
      renderAction();
      return;
    }
    if (state.draw.on) {
      const n = state.draw.points.length;
      const more = pick && pick.loops && pick.loops.length ? ` It will be cut together with the ${pick.loops.length === 1 ? 'line' : `${pick.loops.length} lines`} already picked.` : '';
      el.innerHTML = `<p class="status muted">${n ? `${n} point${n === 1 ? '' : 's'} so far. ` : ''}${n >= 3 ? 'Close the line to see what the cut would do.' : `Click ${n ? 'more points' : 'points'} on the part; the line follows the surface between them.`}${more}</p>`;
      renderAction();
      return;
    }
    if (!pick) { el.innerHTML = `<p class="muted small">${selectedPart() ? 'Click a region to split it off, or a dark border line to cut along it. Shift-click adds another region or line. Keys follow the Joints settings.' : 'Click a part to choose it, then a region on it to split off.'}</p>`; renderAction(); return; }
    const region = !!pick.regions, nr = region ? pick.regions.length : 0, nl = pick.loops.length, painted = !!pick.painted;
    const len = `${fmt(pick.loops.reduce((s, l) => s + l.length, 0))} mm`;
    const addHint = '<p class="muted small">Shift-click adds another line, or another region to split off with this one.</p>';
    if (pick.error) { el.innerHTML = `<p class="status warn">${ICONS.alert}<span>${esc(pick.error)}</span></p>${painted ? '' : addHint}`; renderAction(); return; }
    if (pick.preview) {
      el.innerHTML = `<p class="status ok">${ICONS.check}<span>Painted area with ${nl === 1 ? 'an outline' : `an outline of ${nl} lines`}, ${len} in all. Keep painting, or split it off: keys and checks run then.</span></p>`;
      renderAction();
      return;
    }
    const cm3 = (v) => (v / 1000 >= 10 ? Math.round(v / 1000) : (v / 1000).toFixed(1));
    const nk = pick.keys.length, np = pick.plugs.length, kind = { peg: 'peg', dowel: 'dowel', magnet: 'magnet pocket' }[state.cfg.type] || 'key';
    const keyLine = np ? ` With ${np === 1 ? `a plug ${fmt(pick.plugs[0].depth)} mm deep` : `${np} plugs`}.` : nk ? ` With ${nk} ${kind}${nk === 1 ? '' : 's'}${state.cfg.sizeMode === 'set' ? '' : ' sized to fit'}.` : '';
    const vols = pick.result.parts.map(q => cm3(q.volume));
    const sinks = (pick.result.sinks || []).filter(s => s > 0.05), sunkLine = sinks.length ? ` The face is sunk ${fmt(Math.max(...sinks))} mm into the other piece${sinks.length < nl ? ' on ' + (sinks.length === 1 ? 'one line' : `${sinks.length} lines`) : ''}, so this piece keeps its thickness to the edge.` : state.cfg.sink > 0 ? ' There’s no room to sink the face here.' : '';
    const what = region ? `${painted ? 'The painted area’s' : nr === 1 ? 'This region’s' : `These ${nr} regions’`} outline is ${nl === 1 ? 'one line' : `${nl} lines`}, ${len} in all. Splitting ${painted || nr === 1 ? 'it' : 'them'} off gives a piece of ${vols[0]} cm³ and leaves ${vols.length === 2 ? `${vols[1]} cm³` : `${vols.length - 1} pieces of ${vols.slice(1).join(', ')} cm³`}.`
      : nl === 1 ? `A ${len} line all the way round. It splits the part into pieces of ${vols[0]} and ${vols[1]} cm³.`
      : `${nl} lines, ${len} in all. Cutting along them gives ${vols.length} pieces of ${vols.join(', ')} cm³.`;
    el.innerHTML = `${pick.forced ? `<p class="status warn">${ICONS.alert}<span>${esc(pick.forced)}</span></p><p class="status muted">${what}${keyLine}${sunkLine}</p>` : `<p class="status ok">${ICONS.check}<span>${what}${keyLine}${sunkLine}</span></p>`}
      ${pick.noKeys ? `<p class="status warn">${ICONS.alert}<span>${esc(pick.noKeys)}</span></p>` : ''}
      <div class="btn-row move-line">${state.edit ? '' : `<button class="btn small" data-act="edit-seam" title="Turn the line into handles you can drag along the surface">Edit ${nl === 1 ? 'the line' : 'the lines'}</button>`}<span class="lbl">Move</span><button class="btn small" data-act="move-in" title="Move the line into the piece being split off, along the surface">In</button><button class="btn small" data-act="move-out" title="Move the line outward, along the surface">Out</button><label class="inline-num"><span class="lbl">by</span><input type="number" id="moveLineBy" min="0.1" step="0.5" value="${state.moveBy || 1}" aria-label="Move the line by this much"><span class="unit">mm</span></label><button class="btn small" data-act="flat-here" title="A flat cut through the line’s plane instead, cutting only this area">Flat cut here</button></div>${painted || state.edit ? '' : addHint}`;
    renderAction();
  }
  // Inlay cut: the picked area (painted, a region, or inside a line) becomes a pocket in the body and an inlay to
  // print in another colour, with the depth, fit and floor from the regions panel.
  // The area a pick bounds, as a triangle selection: the paint, the picked regions' triangles, or the smaller side
  // of the picked lines
  function pickSelection(p, pick) {
    if (pick.painted && state.paint.sel) return state.paint.sel;
    if (pick.regions) { const seg = regionsFor(p), set = new Set(pick.regions), sel = new Uint8Array(p.indices.length / 3); for (let t = 0; t < sel.length; t++) if (set.has(seg.groupOf[t])) sel[t] = 1; return sel; }
    return K.loopSelection(p.positions, p.indices, pick.loops);
  }
  // Move the picked line in or out along the surface by a distance (modelsplitter's "Lower the cut line"): the
  // area it bounds is shrunk or grown by that much and its new outline picked as drawn lines, so keys, plug and
  // sinking follow. "In" moves the line into the piece being split off (the area gets smaller).
  function movePick(dir) {
    const pick = state.regions.pick, p = pick && state.parts.find(q => q.id === pick.partId);
    if (!p || !pick.loops || !pick.loops.length) return;
    const mm = Math.max(0.1, parseFloat(($('#moveLineBy') || {}).value) || 1);
    let sel;
    try { sel = pickSelection(p, pick); } catch (err) { toast(err.message, 'error'); return; }
    const moved = dir < 0 ? K.shrinkSelection(p.positions, p.indices, sel, mm) : K.growSelection(p.positions, p.indices, sel, mm);
    let n = 0; for (const v of moved) n += v;
    if (!n || n >= moved.length) { toast(dir < 0 ? 'Moving the line that far in leaves nothing to split off.' : 'Moving the line that far out covers the whole part.', 'error'); return; }
    let loops;
    try { loops = K.groupLoops(p.positions, p.indices, K.selectionSeg(p.positions, p.indices, moved), [1]).map(l => ({ ...l, drawn: true })); } catch (err) { toast(err.message, 'error'); return; }
    if (!loops.length || loops.some(l => !l.closed)) { toast('The moved line doesn’t close cleanly. Try a smaller distance.', 'error'); return; }
    endSeamEdit();
    if (state.paint.on) { state.paint.sel = moved; renderPaint(); }
    state.regions.last = pick.painted ? { partId: p.id, clicks: [], painted: true } : { partId: p.id, clicks: [], drawn: loops };
    if (pick.painted) pickPainted(); else pickLoops(p, loops, { lines: true });
  }
  // A flat cut in place of the picked seam (modelsplitter's "Flat plane replaces the seam"): the cut plane goes
  // through the line's best-fit plane, cutting only the area the line bounds.
  function flatFromPick() {
    const pick = state.regions.pick, p = pick && state.parts.find(q => q.id === pick.partId);
    if (!p || !pick.loops || !pick.loops.length) return;
    const lf = K.loopFrame(p.positions, pick.loops[0].verts), v = views.get(p.id), off = v ? v.mesh.position : { x: 0, y: 0, z: 0 };
    const centre = [lf.centre[0] + off.x, lf.centre[1] + off.y, lf.centre[2] + off.z];
    placeFlatCut({ normal: lf.F.n.slice(), point: centre, areas: [centre] });
    renderInspector();
    toast(`A flat cut through the line’s plane, cutting only the area it bounds${lf.dev > 1 ? `; the line strays ${fmt(lf.dev)} mm from flat, so the seam moves a little` : ''}. Enter cuts.`);
  }
  function inlayFromPick() {
    const pick = state.regions.pick, p = pick && state.parts.find(q => q.id === pick.partId);
    if (!p || !pick.loops || !pick.loops.length) return;
    let sel = null;
    try { sel = pickSelection(p, pick); } catch (err) { toast(err.message, 'error'); return; }
    const depth = Math.max(0.5, parseFloat($('#inlayDepth').value) || 3), fit = Math.max(0, parseFloat($('#inlayFit').value) || 0), flat = $('#inlayFlat').checked;
    busy('Cutting the inlay');
    setTimeout(() => {
      let r;
      try { r = K.inlayCut(p.positions, p.indices, sel, { depth, fit, flat, wall: minWall() }); } catch (err) { busy(null); toast(err.message, 'error'); return; }
      const body = makePart({ name: p.name, color: p.color, positions: r.body.positions, indices: r.body.indices });
      const inlay = makePart({ name: `${p.name} inlay`, color: nextColor(), positions: r.inlay.positions, indices: r.inlay.indices, pull: pick.frames && pick.frames[0] ? pick.frames[0].n.slice() : null });
      const idx = state.parts.indexOf(p);
      commit(state.parts.slice(0, idx).concat([body, inlay], state.parts.slice(idx + 1)), 'the inlay cut');
      endSeamEdit(); if (state.paint.on) setPainting(false); clearPick(); state.regions.last = null; state.selectedId = null;
      busy(null);
      syncScene(); renderPick(); updateHint();
      toast(`Cut a pocket ${fmt(r.depth)} mm deep and the inlay that fits it${r.flat ? ', with a flat base to print on' : ''}. Print the inlay in another colour; it presses back into place.`);
    }, 30);
  }
  function cutAlongPick() {
    const pick = state.regions.pick, p = pick && state.parts.find(q => q.id === pick.partId);
    if (!p || !pick.result) return;
    const numberedHere = pick.perLoop.some(per => per.marks && per.marks.length) ? state.joint : null;
    const joints = jointOf(p, { type: state.cfg.type, keys: pick.keys.length + pick.plugs.length, number: numberedHere });
    const made = pick.result.parts.map((c, i) => makePart({ name: `${p.name} ${String.fromCharCode(65 + i)}`, color: i ? nextColor() : p.color, positions: c.positions, indices: c.indices, pull: c.pull || null, joints }));
    (pick.result.pins || []).forEach((pin, i) => made.push(makePart({ name: `${p.name} pin ${i + 1}`, color: PIN_COLOR, positions: pin.positions, indices: pin.indices, kind: 'pin' })));
    const idx = state.parts.indexOf(p);
    clearPick();
    commit(state.parts.slice(0, idx).concat(made, state.parts.slice(idx + 1)), 'the curved cut');
    if (state.selectedId === p.id) state.selectedId = null;
    syncScene();
    renderPick();
    const pinsMade = (pick.result.pins || []).length;
    const n = pick.result.parts.length;
    const numbered = pick.perLoop.filter(per => per.marks && per.marks.length).length; // joint numbers engraved on these lines
    const numberLine = numbered ? ` ${numbered === 1 ? `The joint is numbered ${state.joint}` : `The joints are numbered ${state.joint} to ${state.joint + numbered - 1}`}.` : '';
    if (numbered) state.joint += pick.perLoop.length;
    if (pick.painted) setPainting(false);
    toast(`${pick.painted ? `Split off the painted area: ${n} pieces` : pick.regions ? `Split off the ${pick.regions.length === 1 ? 'region' : 'regions'}: ${n} pieces` : `Cut along the ${pick.loops.length === 1 ? 'line' : 'lines'} into ${n} pieces`}${pinsMade ? ` and ${pinsMade} dowel pins` : ''}${pick.forced ? ', against the warning' : ''}.${numberLine} Click another region or line to keep cutting.`, pick.forced ? 'warn' : '');
  }
  $('#seamSmooth').addEventListener('input', (e) => { $('#seamSmoothOut').textContent = e.target.value; });
  $('#seamSmooth').addEventListener('change', (e) => { smoothSeam(+e.target.value); });
  $('#seamSnap').addEventListener('change', (e) => { if (state.edit) state.edit.snap = e.target.checked; });
  $('#explode').addEventListener('input', (e) => { state.explode = parseFloat(e.target.value); $('#explodeOut').textContent = `${Math.round(state.explode * 100)}%`; applyExplode(); });
  $('#brushSize').addEventListener('change', (e) => { state.paint.size = Math.max(0.2, +e.target.value || 3); e.target.value = state.paint.size; state.paint.sized = true; brushRing.scale.set(state.paint.size, state.paint.size, state.paint.size); markDirty(); });
  function applyRegions() {
    const on = state.regions.on;
    let count = 0;
    for (const p of state.parts) {
      const v = views.get(p.id);
      if (!v) continue;
      if (v.borders) { v.mesh.remove(v.borders); v.borders.geometry.dispose(); v.borders.material.dispose(); v.borders = null; }
      if (!on) { if (v.mat.vertexColors) { v.mat.vertexColors = false; v.mat.needsUpdate = true; } v.mat.color.set(p.color); continue; }
      const seg = regionsFor(p);
      count += seg.count;
      const col = new Float32Array(p.indices.length * 3);
      const rgb = REGION_HUES.map((h, i) => hslToRgb(h, 0.42, i % 2 ? 0.66 : 0.58));
      for (let t = 0; t < p.indices.length / 3; t++) { const c = rgb[seg.groupOf[t] % rgb.length]; for (let k = 0; k < 3; k++) col.set(c, 9 * t + 3 * k); }
      v.regionColors = col.slice(); // the colours under any paint
      v.geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
      v.mat.vertexColors = true; v.mat.color.set(0xffffff); v.mat.needsUpdate = true;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(K.regionBorderLines(p.positions, p.indices, seg, K.diag(p.bbox) * 0.0012), 3));
      v.borders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1d1d1b }));
      v.mesh.add(v.borders);
    }
    $('#regionsPanel').hidden = !on;
    if (!on) clearPick();
    renderPick();
    $('#regionsBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    const out = $('#regionsCount');
    if (out) out.textContent = on ? `${count} ${count === 1 ? 'region' : 'regions'}` : '';
    markDirty();
  }
  function setRegions(on) {
    if (state.regions.on === on) return;
    state.regions.on = on;
    if (on && !selectedPart() && state.parts.filter(q => !state.hidden.has(q.id)).length === 1) selectPart(state.parts.find(q => !state.hidden.has(q.id)).id); // one part: it's the one
    if (!on) { endSeamEdit(); state.regions.last = null; if (state.draw.on) setDrawing(false); if (state.paint.on) setPainting(false); }
    applyRegions();
    syncTool();
    updatePreview();
    placeAreaTags(); placeSuggestPins(); updateHint(); renderInspector();
    markDirty();
  }
  $('#regionsBtn').addEventListener('click', () => {
    if (!state.regions.on) { busy('Finding surface regions'); setTimeout(() => { setRegions(true); busy(null); }, 30); }
    else setRegions(false);
  });
  $('#regionsAngle').addEventListener('input', (e) => { $('#regionsAngleOut').textContent = `${e.target.value}°`; });
  $('#sinkDepth').addEventListener('change', (e) => {
    state.cfg.sink = Math.max(0, +e.target.value || 0); e.target.value = state.cfg.sink;
    const p = selectedPart(); if (p && state.regions.last && state.regions.last.partId === p.id) replayPick(p);
  });
  $('#regionsAngle').addEventListener('change', (e) => {
    state.regions.fold = +e.target.value;
    clearPick();
    busy('Finding surface regions'); setTimeout(() => { applyRegions(); busy(null); }, 30);
  });

  function setFlat(on) {
    state.flat = on;
    for (const v of views.values()) if (v.mat.flatShading !== on) { v.mat.flatShading = on; v.mat.needsUpdate = true; }
    updateChrome(); markDirty();
  }
  $('#flatBtn').addEventListener('click', () => { state.flatAuto = false; setFlat(!state.flat); });
  $('#modelTools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'rotate') rotateAll(b.dataset.value);
    else if (b.dataset.act === 'scale') scaleAll(+b.dataset.value);
    else if (b.dataset.act === 'scale-quick') { scaleAll((+$('#quickScale').value || 100) / 100); $('#quickScale').value = 100; }
  });
  $('#wireBtn').addEventListener('click', () => {
    state.wire = !state.wire;
    for (const v of views.values()) v.mat.wireframe = state.wire;
    ghostMat.wireframe = state.wire;
    updateChrome(); markDirty();
  });

  /* ---------------- toast ---------------- */
  let toastTimer = 0;
  function toast(msg, kind = '', action) {
    const el = $('#toast');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn small">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { action.fn(); el.hidden = true; });
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 7000 : 4200);
  }


  syncScene();
  renderInspector();
})();
