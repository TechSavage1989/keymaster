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
    nextColor: 1,
    bed: { w: 220, d: 220, h: 250 },
    cfg: { type: 'peg', shape: 'round', diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper: false, pegSide: 'below', perArea: 2, align: true, turn: 0 },
    cut: { mode: 'translate', keys: [], auto: true, skip: new Set(), hoverArea: -1, labels: [], analysis: null, evals: [], active: -1, stale: true, lo: -1, hi: 1, center: [0, 0, 0], R: 1 },
  };
  const history = { past: [], future: [] };
  let uid = 1;
  let downloads = null;

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved && saved.cfg) Object.assign(state.cfg, saved.cfg);
    if (saved && saved.bed) Object.assign(state.bed, saved.bed);
  } catch (e) { /* storage unavailable */ }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ cfg: state.cfg, bed: state.bed })); } catch (e) { /* ignore */ } }

  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(d => { downloads = d; }).catch(() => { downloads = null; });
  }

  function makePart({ name, color, positions, indices, kind }) {
    return { id: uid++, name, color, positions, indices, bbox: K.bounds(positions), tris: indices.length / 3, volume: K.volume(positions, indices), kind: kind || 'part' };
  }
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
  const gripGroup = new THREE.Group();
  const gripMat = new THREE.MeshBasicMaterial({ color: 0x2a2100 });
  const gripGeom = new THREE.SphereGeometry(1, 16, 12);
  for (let i = 0; i < 4; i++) { const g = new THREE.Mesh(gripGeom, gripMat); g.renderOrder = 6; gripGroup.add(g); }
  gripGroup.visible = false;
  const hinge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2a2100 }));
  hinge.visible = false; hinge.renderOrder = 6;
  planeGroup.add(planeSheet, planeFrame, capMesh, regionGroup, keyGroup, gripGroup, hinge);

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
    if (moved || dirty) { renderer.render(scene, camera); placeAreaTags(); dirty = false; }
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
  setGizmoMode('translate');

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
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.66, metalness: 0, wireframe: state.wire });
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
    }
    applyExplode();
    updatePreview();
    updateGrid();
    renderParts();
    renderInspector();
    updateChrome();
    markDirty();
  }
  function applyExplode() {
    const b = state.parts.length ? modelBounds() : null;
    for (const p of state.parts) {
      const v = views.get(p.id);
      if (!v) continue;
      const k = state.selectedId ? 0 : state.explode * 0.9;
      v.mesh.position.set(
        (p.bbox.center[0] - b.center[0]) * k + v.offset.x,
        (p.bbox.center[1] - b.center[1]) * k + v.offset.y,
        (p.bbox.center[2] - b.center[2]) * k + v.offset.z);
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
    if (!p) { planeGroup.visible = false; tc.detach(); preview.partId = null; return; }
    const v = viewFor(p);
    ghostMat.color.set(p.color).lerp(new THREE.Color(0xffffff), 0.45);
    ghostMat.wireframe = state.wire;
    preview.ghost = new THREE.Mesh(v.geom, ghostMat);
    preview.ghost.renderOrder = 3;
    preview.stencil = makeStencilGroup(v.geom, clipBelow);
    scene.add(preview.ghost, preview.stencil);
    planeGroup.visible = true;
    if (state.cut.mode === 'translate') { if (tc.object !== planeGroup) tc.attach(planeGroup); }
    else tc.detach();
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
    const gr = Math.max(0.6, R * 0.035);
    [[h, 0], [-h, 0], [0, h], [0, -h]].forEach(([x, y], i) => { const g = gripGroup.children[i]; g.position.set(x, y, 0); g.scale.set(gr, gr, gr); });
    planeFrame.geometry.dispose();
    planeFrame.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0)]);
  }
  function setGizmoMode(mode) {
    state.cut.mode = mode;
    tc.setMode('translate');
    tc.showX = false; tc.showY = false; tc.showZ = true;
    if (mode === 'translate' && selectedPart()) { if (tc.object !== planeGroup) tc.attach(planeGroup); }
    else tc.detach();
    planeSheet.material.opacity = mode === 'rotate' ? 0.17 : 0.08;
    gripGroup.visible = mode === 'rotate';
    updateHint();
    markDirty();
  }
  tc.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value) { state.cut.stale = true; renderKeyMarkers(); }
    else {
      computeSliderRange();
      state.cut.skip.clear();
      scheduleAnalysis(40);
      renderInspector();
    }
  });
  tc.addEventListener('objectChange', onPlaneMoved);

  /* ---------------- analysis, keys ---------------- */
  function coreCfg() { return { ...state.cfg }; }
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
    if (state.cut.auto) state.cut.keys = an.base.error ? [] : K.autoPlaceKeys(an, coreCfg(), state.cfg.perArea, state.cut.skip);
    state.cut.active = Math.min(state.cut.active, state.cut.keys.length - 1);
    evaluateKeys();
    renderRegions();
    renderKeyMarkers();
    renderInspector();
    renderAreaTags();
    updateHint();
    markDirty();
  }
  function evaluateKeys() {
    const an = state.cut.analysis;
    state.cut.evals = an && !an.base.error && state.cfg.type !== 'none' ? K.evaluateKeys(an, state.cut.keys, coreCfg(), state.cut.skip) : [];
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
  function areaCount() {
    const an = state.cut.analysis;
    return an && !an.base.error ? an.base.regions.length : 0;
  }
  function updateLabelPoints() {
    if (!state.cut.labels.length) return;
    const avoid = state.cfg.type === 'none' ? 0 : K.keyGeometrySpec(state.cfg).outer + state.cfg.margin;
    const keys = state.cfg.type === 'none' ? [] : state.cut.keys;
    for (const l of state.cut.labels) Object.assign(l, K.pickLabelPoint(l.samples, keys, avoid));
  }
  function renderAreaTags() {
    const n = areaCount();
    tagLayer.innerHTML = n > 1 ? state.cut.labels.map((l, i) => {
      const cut = !state.cut.skip.has(i);
      return `<button class="area-tag${i === state.cut.hoverArea ? ' is-hover' : ''}" data-area-tag="${i}" aria-pressed="${cut}" title="${cut ? `Area ${i + 1} will be cut. Click to leave it joined.` : `Area ${i + 1} stays joined. Click to cut it.`}"><b>${i + 1}</b>${cut ? 'Cut' : 'Joined'}</button>`;
    }).join('') : '';
    updateLabelPoints();
    placeAreaTags();
  }
  function placeAreaTags() {
    const tags = tagLayer.children;
    if (!tags.length) return;
    const show = !!selectedPart() && !state.cut.stale && !ptr.tilt && areaCount() > 1 && cameraOnClearSide();
    tagLayer.hidden = !show;
    if (!show) return;
    planeGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (let i = 0; i < tags.length; i++) {
      const l = state.cut.labels[i], el = tags[i];
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
    for (const li of ins.querySelectorAll('[data-area-row]')) li.classList.toggle('is-hover', +li.dataset.areaRow === i);
    markDirty();
  }
  function toggleArea(i) {
    if (i < 0 || i >= areaCount()) return;
    if (state.cut.skip.has(i)) state.cut.skip.delete(i); else state.cut.skip.add(i);
    if (state.cut.auto) state.cut.keys = K.autoPlaceKeys(state.cut.analysis, coreCfg(), state.cfg.perArea, state.cut.skip);
    state.cut.active = Math.min(state.cut.active, state.cut.keys.length - 1);
    evaluateKeys(); renderRegions(); renderKeyMarkers(); renderInspector(); renderAreaTags();
  }
  tagLayer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area-tag]');
    if (b) toggleArea(+b.dataset.areaTag);
  });
  tagLayer.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-area-tag]'); if (b) setHoverArea(+b.dataset.areaTag); });
  tagLayer.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !tagLayer.contains(e.relatedTarget)) setHoverArea(-1); });
  function renderKeyMarkers() {
    clearGroup(keyGroup);
    updateLabelPoints();
    const cfg = state.cfg;
    if (!selectedPart() || cfg.type === 'none') { markDirty(); return; }
    const spec = K.keyGeometrySpec(cfg);
    const R = state.cut.R;
    const z = Math.max(0.03, R * 0.0009);
    state.cut.keys.forEach((k, i) => {
      const ev = state.cut.evals[i];
      const stale = state.cut.stale;
      const bad = !stale && ev && !ev.ok;
      const active = i === state.cut.active;
      const color = stale ? 0xd5d8dc : bad ? 0xe5484d : 0xfafbfc;
      const g = new THREE.Group();
      g.position.set(k.x, k.y, 0);
      const an = state.cut.analysis, sec = an && !an.base.error ? an.base : null;
      const ang = K.keyAngle(sec || { regions: [] }, sec ? K.regionAt(sec, k.x, k.y) : -1, cfg);
      const prof = (rr, dd) => K.keyProfile(spec.shape, rr, dd, ang, spec.res);
      const disc = new THREE.Mesh(fanGeometry(prof(spec.r, spec.c), 0), new THREE.MeshBasicMaterial({ color: bad ? 0xe5484d : 0x1d1d1b, side: THREE.DoubleSide, transparent: true, opacity: active ? 0.95 : 0.78 }));
      disc.position.z = z; disc.renderOrder = 5;
      g.add(disc);
      let z0, z1, tipR = spec.r;
      if (cfg.type === 'peg') { z0 = 0; z1 = (cfg.pegSide === 'above' ? -1 : 1) * cfg.length; tipR = spec.r * spec.taper; }
      else if (cfg.type === 'dowel') { z0 = -cfg.length / 2; z1 = cfg.length / 2; }
      else { z0 = -cfg.length; z1 = cfg.length; }
      const body = prismGeometry(prof(spec.r, 0), prof(tipR, 0), z0, z1);
      const mesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: active ? 0x4a3a00 : 0x000000 }));
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
  function prismGeometry(p0, p1, z0, z1) {
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
      pos.push(0, 0, z); nor.push(0, 0, nz);
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
  function selectPart(id) {
    if (id === state.selectedId) return;
    state.selectedId = id;
    const p = selectedPart();
    if (p) {
      state.cut.center = p.bbox.center.slice();
      state.cut.R = K.diag(p.bbox) / 2;
      planeGroup.position.set(...p.bbox.center);
      sizePlaneVisuals(state.cut.R);
      const up = new THREE.Vector3(0, 0, 1);
      setPlaneNormal(towardCamera(up));
      state.cut.keys = []; state.cut.auto = true; state.cut.skip = new Set(); state.cut.analysis = null; state.cut.evals = []; state.cut.active = -1;
      setGizmoMode(state.cut.mode);
      scheduleAnalysis(0);
    }
    syncScene();
  }
  /* ---------------- history ---------------- */
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
    if (ext !== 'stl' && ext !== 'obj') { toast('Keymaster opens STL and OBJ files. Export your model in one of those formats, then open it here.', 'error'); return; }
    busy('Opening ' + file.name);
    await nextFrame();
    try {
      const buf = await file.arrayBuffer();
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
  function setModel(name, m) {
    state.model = { name, report: m.report, tris: m.indices.length / 3 };
    state.nextColor = 1;
    state.parts = [makePart({ name, color: PALETTE[0], positions: m.positions, indices: m.indices })];
    history.past = []; history.future = [];
    state.selectedId = null; state.hidden.clear(); state.explode = 0;
    $('#empty').hidden = true;
    syncScene();
    frameAll();
    if (m.report.flipped) toast('The model was inside out, so Keymaster flipped it to print correctly.');
    else if (!m.report.closed) toast('This model has gaps in its surface. Fill holes in the model panel before cutting.', 'warn');
    else if (state.model.tris > 3e6) toast('This is a very dense model. Cuts may take a few seconds.', 'warn');
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
  async function doCut() {
    const p = selectedPart();
    if (!p) return;
    if (state.cut.stale) runAnalysis();
    const an = state.cut.analysis;
    if (!an || an.base.error || !an.base.regions.length) {
      toast(an && an.base.error ? 'The surface is broken where this cut crosses it. Move the cut or repair the model.' : 'The cut plane doesn’t pass through this part. Slide it into the model first.', 'error');
      return;
    }
    if (state.cut.skip.size >= an.base.regions.length) {
      toast('Every area is set to stay joined, so nothing would be cut. Click an area’s label to cut it.', 'error');
      return;
    }
    const bad = state.cut.evals.filter(e => !e.ok).length;
    if (state.cfg.type !== 'none' && bad) {
      toast(`${bad === 1 ? 'One key needs' : bad + ' keys need'} attention before cutting. Drag ${bad === 1 ? 'it' : 'them'} to a better spot or remove ${bad === 1 ? 'it' : 'them'}.`, 'error', { label: 'Remove', fn: removeBadKeys });
      return;
    }
    busy('Cutting ' + p.name);
    await nextFrame();
    let res;
    try {
      res = K.cutMesh(p.positions, p.indices, currentFrame(), { scale: K.diag(p.bbox), cfg: coreCfg(), keys: state.cut.keys, skip: state.cut.skip });
    } catch (err) {
      busy(null);
      toast(err.message, 'error');
      return;
    }
    const groups = { below: [], above: [], both: [] };
    for (const c of res.parts) groups[c.side].push(c);
    const made = [];
    const label = (side, i, count) => side === 'both' ? p.name : `${p.name} ${side === 'below' ? 'A' : 'B'}${count > 1 ? i + 1 : ''}`;
    let first = true;
    for (const side of ['both', 'below', 'above']) {
      groups[side].sort((a, b) => b.volume - a.volume);
      groups[side].forEach((c, i) => {
        made.push(makePart({ name: label(side, i, groups[side].length), color: first ? p.color : nextColor(), positions: c.positions, indices: c.indices }));
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
    toast(`Cut into ${pieces} pieces${res.pins.length ? ` and ${res.pins.length} dowel pins` : ''}. Click a part to keep cutting.`);
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
  }
  function fillAllHoles() {
    let filled = 0;
    const parts = state.parts.map(p => {
      const r = K.fillHoles(p.positions, p.indices);
      filled += r.filled;
      return makePart({ ...p, positions: r.positions, indices: r.indices });
    });
    commit(parts, 'hole filling');
    const rep = K.edgeReport(parts[0].indices);
    state.model.report = { ...state.model.report, ...rep };
    syncScene();
    toast(rep.closed ? `Filled ${filled} ${filled === 1 ? 'hole' : 'holes'}. The model is closed now.` : `Filled ${filled} ${filled === 1 ? 'hole' : 'holes'}. Some gaps are too tangled to fill here; repair them in Blender or Meshmixer.`, rep.closed ? '' : 'warn');
  }

  /* ---------------- export ---------------- */
  function safeName(s) { return (s || 'part').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'part'; }
  async function exportParts(onlyId) {
    const list = onlyId ? state.parts.filter(p => p.id === onlyId) : state.parts;
    if (!list.length) return;
    const used = new Set();
    const files = list.map(p => {
      let n = safeName(p.name), k = 2;
      while (used.has(n)) n = safeName(p.name) + '-' + k++;
      used.add(n);
      return { name: n + '.stl', data: new Uint8Array(K.writeSTL(p.positions, p.indices, p.name)) };
    });
    const zip = K.makeZip(files);
    const filename = safeName(state.model ? state.model.name : 'model') + (onlyId ? '-' + safeName(list[0].name) : '-parts') + '.zip';
    const blob = new Blob([zip], { type: 'application/zip' });
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        toast(`Saved ${filename} with ${files.length} STL ${files.length === 1 ? 'file' : 'files'}.`);
        return;
      } catch (err) {
        if (err && err.code === 'declined') return;
        if (err && err.code === 'rate_limited') { toast('A save is already waiting for your answer.', 'warn'); return; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Saved ${filename} with ${files.length} STL ${files.length === 1 ? 'file' : 'files'}.`);
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
    if (!selectedPart() || state.cfg.type === 'none') return -1;
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
  const ptr = { down: false, x: 0, y: 0, t: 0, dragKey: -1, tilt: null };
  function onSheet(h) { const half = state.cut.R * 1.15; return h && Math.abs(h.x) <= half && Math.abs(h.y) <= half; }
  function toScreen(v) {
    const r = canvas.getBoundingClientRect();
    const q = v.clone().project(camera);
    return [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height];
  }
  function startTilt(h, e) {
    let L = Math.hypot(h.x, h.y);
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
    onPlaneMoved();
  }
  function endTilt() {
    ptr.tilt = null;
    hinge.visible = false;
    orbit.enabled = true;
    canvas.style.cursor = '';
    computeSliderRange();
    state.cut.skip.clear();
    scheduleAnalysis(40);
    renderInspector();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (tc.dragging || tc.axis) return;
    ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = performance.now(); ptr.dragKey = -1; ptr.tilt = null;
    if (selectedPart() && state.cut.mode === 'rotate') {
      const h = planeHit(e);
      if (onSheet(h)) startTilt(h, e);
      return;
    }
    const k = pickKey(e);
    if (k >= 0) {
      ptr.dragKey = k;
      state.cut.active = k;
      orbit.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      renderKeyMarkers();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ptr.tilt) { moveTilt(e); return; }
    if (!ptr.down && selectedPart() && state.cut.mode === 'rotate') { canvas.style.cursor = onSheet(planeHit(e)) ? 'grab' : ''; return; }
    if (ptr.dragKey >= 0) {
      const h = planeHit(e);
      if (!h) return;
      state.cut.keys[ptr.dragKey] = h;
      state.cut.auto = false;
      evaluateKeys(); renderKeyMarkers();
      return;
    }
    if (!ptr.down && selectedPart()) canvas.style.cursor = pickKey(e) >= 0 ? 'grab' : joinedAreaAt(e) >= 0 ? 'pointer' : '';
  });
  function joinedAreaAt(e) {
    if (!state.cut.skip.size || !state.cut.analysis || state.cut.stale || !cameraOnClearSide()) return -1;
    const h = planeHit(e);
    const ri = h ? K.regionAt(state.cut.analysis.base, h.x, h.y) : -1;
    return state.cut.skip.has(ri) ? ri : -1;
  }
  canvas.addEventListener('pointercancel', () => { if (ptr.tilt) endTilt(); if (ptr.dragKey >= 0) { ptr.dragKey = -1; orbit.enabled = true; } ptr.down = false; });
  canvas.addEventListener('pointerup', (e) => {
    if (!ptr.down) return;
    ptr.down = false;
    if (ptr.tilt) { endTilt(); return; }
    if (ptr.dragKey >= 0) {
      ptr.dragKey = -1;
      orbit.enabled = true;
      renderInspector();
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
    const p = selectedPart();
    if (p && state.cut.mode === 'rotate' && onSheet(planeHit(e))) return;
    if (p && cameraOnClearSide() && state.cut.analysis && !state.cut.stale) {
      const h = planeHit(e);
      if (h) {
        const ri = K.regionAt(state.cut.analysis.base, h.x, h.y);
        if (ri >= 0 && state.cut.skip.has(ri)) { toggleArea(ri); return; }
        if (ri >= 0 && state.cfg.type !== 'none') { addKey(h); return; }
      }
    }
    setNdc(e);
    const meshes = state.parts.filter(q => !state.hidden.has(q.id)).map(q => views.get(q.id).mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) selectPart(hits[0].object.userData.partId);
    else if (p) selectPart(null);
  }
  function addKey(h) {
    state.cut.keys.push(h);
    state.cut.auto = false;
    state.cut.active = state.cut.keys.length - 1;
    evaluateKeys(); renderKeyMarkers(); renderInspector();
  }
  function removeKey(i) {
    state.cut.keys.splice(i, 1);
    state.cut.auto = false;
    state.cut.active = -1;
    evaluateKeys(); renderKeyMarkers(); renderInspector();
  }

  // drag and drop
  ['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('dropping'); }));
  ['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && stage.contains(e.relatedTarget)) return; stage.classList.remove('dropping'); }));
  stage.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) loadFile(f); fileInput.value = ''; });

  /* ---------------- keyboard ---------------- */
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); return; }
    if (typing || mod || e.altKey) return;
    const p = selectedPart();
    switch (e.key) {
      case 'Escape': if (p) selectPart(null); break;
      case 'Enter': if (p) { e.preventDefault(); doCut(); } break;
      case 'Delete': case 'Backspace': if (p && state.cut.active >= 0) { e.preventDefault(); removeKey(state.cut.active); } break;
      case 'f': case 'F': frameAll(p || undefined); break;
      case 'w': case 'W': if (p) { setGizmoMode('translate'); renderInspector(); } break;
      case 'e': case 'E': if (p) { setGizmoMode('rotate'); renderInspector(); } break;
      case 'x': case 'X': if (p) alignPlane('x'); break;
      case 'y': case 'Y': if (p) alignPlane('y'); break;
      case 'z': case 'Z': if (p) alignPlane('z'); break;
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
    state.cut.keys = state.cut.keys.map(k => ({ x: k.x, y: -k.y }));
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
    $('#wireBtn').setAttribute('aria-pressed', state.wire ? 'true' : 'false');
    updateHint();
  }
  function updateHint() {
    const el = $('#hint');
    let t = '';
    const p = selectedPart();
    if (!state.parts.length) t = '';
    else if (!p) t = (state.parts.length > 1 ? 'Click a part to cut it. ' : 'Click the model to start cutting it. ') + (coarse ? 'Drag to orbit, pinch to zoom.' : 'Drag to orbit, right-drag to pan.');
    else if (state.cut.mode === 'rotate') t = coarse ? 'Drag the yellow plane to tip it. Tap Slide to move it instead.' : 'Drag the yellow plane to tip it. Hold Shift for fine control. Press W to slide.';
    else if (!cameraOnClearSide()) t = 'Orbit around to the clear side to see the cut face.';
    else if (state.cfg.type === 'none') t = 'Drag the arrow to slide the cut, then press Enter to cut.';
    else t = coarse ? 'Drag the arrow to slide the cut. Tap the cut face to add a key, drag keys to move them.' : 'Drag the arrow to slide the cut. Click the cut face to add a key, drag keys to move them, right-click to remove.';
    el.textContent = t;
    el.hidden = !t;
  }
  let partsSig = '';
  function renderParts() {
    const list = $('#partList');
    const sig = state.parts.map(p => [p.id, p.name, p.color, state.hidden.has(p.id) ? 1 : 0].join(':')).join('|') + '#' + [state.bed.w, state.bed.d, state.bed.h].join(',');
    if (sig === partsSig && state.parts.length) {
      list.querySelectorAll('li[data-id]').forEach(li => li.classList.toggle('is-selected', +li.dataset.id === state.selectedId));
      return;
    }
    partsSig = sig;
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
    round: 'Easiest to fit. Use two or more so the pieces can’t turn.',
    square: 'Stops the pieces turning, even with a single key.',
    hexagon: 'Stops the pieces turning, even with a single key.',
    cross: 'Grips firmly and stops the pieces turning, even with a single key.',
    oval: 'For narrow areas. Half again as long as it is wide, and stops the pieces turning.',
    slot: 'For long, narrow areas. Twice as long as it is wide, and stops the pieces turning.',
    dshape: 'Fits only one way round, so a piece can’t be glued on backwards.',
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
  function shapePicker(c) {
    const shapes = c.type === 'magnet' ? K.MAGNET_SHAPES : K.KEY_SHAPES, cur = K.keyGeometrySpec(c).shape;
    return `<div class="shape-grid${shapes.length < 4 ? ' few' : ''}" role="group" aria-label="Key shape">${shapes.map(s =>
      `<button type="button" data-act="shape" data-value="${s}" aria-pressed="${s === cur}" title="${SHAPE_NAMES[s]}">${shapeIcon(s)}<span>${SHAPE_NAMES[s]}</span></button>`).join('')}</div>`;
  }
  function normTurn(v) { let a = ((Math.round(v) % 360) + 360) % 360; if (a > 180) a -= 360; return a; }
  function numField(field, label, value, opts = {}) {
    return `<label class="num"><span>${label}</span><span class="num-wrap"><input type="number" inputmode="decimal" data-cfg="${field}" value="${value}" step="${opts.step || 0.1}" min="${opts.min || 0}" ${opts.max ? `max="${opts.max}"` : ''}><em>${opts.unit || 'mm'}</em></span></label>`;
  }
  function renderInspector() {
    const el = $('#inspector');
    if (!state.parts.length) {
      el.innerHTML = `<div class="ins-section intro"><h2>Cut sculptures into printable pieces</h2>
        <p>Open a figure or sculpture, slide a cut through it, and Keymaster adds pegs, dowel holes or magnet pockets so the pieces line up when you glue them.</p>
        <p class="muted">Works with closed STL and OBJ meshes in millimeters. Everything runs in your browser; your model isn’t uploaded anywhere.</p></div>`;
      return;
    }
    const p = selectedPart();
    el.innerHTML = p ? cutPanel(p) : modelPanel();
    updatePositionReadout();
  }
  function modelPanel() {
    const b = modelBounds();
    const rep = state.model.report;
    const total = state.parts.reduce((s, p) => s + p.tris, 0);
    const health = rep.closed
      ? `<p class="status ok">${ICONS.check}<span>Closed surface, ready to cut.</span></p>`
      : `<p class="status warn">${ICONS.alert}<span>${fmtInt(rep.openEdges)} open edges${rep.badEdges ? ` and ${fmtInt(rep.badEdges)} tangled ones` : ''}. Cuts that cross a gap can’t be closed.</span></p>
         <button class="btn" data-act="fill-holes">Fill holes</button>`;
    return `<div class="ins-section">
      <h2>${esc(state.model.name)}</h2>
      <dl class="facts">
        <div><dt>Size</dt><dd>${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} mm</dd></div>
        <div><dt>Triangles</dt><dd>${fmtInt(total)}</dd></div>
      </dl>
      ${health}
    </div>
    <div class="ins-section">
      <h3>Orientation</h3>
      <p class="muted small">Turn the whole model a quarter turn if it came in lying down.</p>
      <div class="row">${['x', 'y', 'z'].map(a => `<button class="btn" data-act="rotate" data-value="${a}">Turn on ${a.toUpperCase()}</button>`).join('')}</div>
    </div>
    <div class="ins-section">
      <h3>Scale</h3>
      <div class="row">
        <button class="btn" data-act="scale" data-value="0.1">× 0.1</button>
        <button class="btn" data-act="scale" data-value="10">× 10</button>
        <button class="btn" data-act="scale" data-value="25.4">Inches to mm</button>
      </div>
      <div class="row tight">
        <label class="num grow"><span>Custom</span><span class="num-wrap"><input type="number" id="scalePct" value="100" min="1" step="1"><em>%</em></span></label>
        <button class="btn" data-act="scale-custom">Apply</button>
      </div>
    </div>
    <div class="ins-section">
      <h3>Printer bed</h3>
      <div class="row three">
        ${['w', 'd', 'h'].map(k => `<label class="num"><span>${{ w: 'Width', d: 'Depth', h: 'Height' }[k]}</span><span class="num-wrap"><input type="number" data-bed="${k}" value="${state.bed[k]}" min="10" step="1"><em>mm</em></span></label>`).join('')}
      </div>
    </div>
    ${state.parts.length > 1 ? `<div class="ins-section">
      <h3>Exploded view</h3>
      <input type="range" id="explode" min="0" max="1" step="0.01" value="${state.explode}" aria-label="Spread parts apart">
    </div>` : ''}`;
  }
  function cutPanel(p) {
    const c = state.cfg;
    const an = state.cut.analysis;
    const regions = an && !an.base.error ? an.base.regions : [];
    const evals = state.cut.evals;
    const bad = evals.filter(e => !e.ok);
    const s = p.bbox.size;
    let keyStatus = '';
    if (c.type !== 'none') {
      if (state.cut.stale) keyStatus = `<p class="status muted">Checking key placement…</p>`;
      else if (an && an.base.error) keyStatus = `<p class="status warn">${ICONS.alert}<span>The surface is broken where it crosses this cut, so keys can’t be checked. Move the cut slightly or fill holes first.</span></p>`;
      else if (!regions.length) keyStatus = `<p class="status muted">Slide the cut into the part to see where keys can go.</p>`;
      else if (!state.cut.keys.length) keyStatus = `<p class="status warn">${ICONS.alert}<span>No room for keys at this size. Try smaller keys, or click the cut face to place one yourself.</span></p>`;
      else if (bad.length) {
        const reasons = [...new Set(bad.map(b => b.reason))].join('. ');
        keyStatus = `<p class="status warn">${ICONS.alert}<span>${bad.length === 1 ? 'One key needs' : bad.length + ' keys need'} attention: ${esc(reasons)}.</span></p><button class="btn small" data-act="remove-bad">Remove ${bad.length === 1 ? 'it' : 'them'}</button>`;
      } else keyStatus = `<p class="status ok">${ICONS.check}<span>${state.cut.keys.length} ${state.cut.keys.length === 1 ? 'key' : 'keys'} ready, with walls at least ${c.margin} mm thick.</span></p>`;
    }
    const lenLabel = c.type === 'magnet' ? 'Thickness' : 'Length';
    const shownShape = K.keyGeometrySpec(c).shape;
    return `<div class="ins-section head">
      <div class="head-row"><h2>${esc(p.name)}</h2><button class="btn ghost small" data-act="done">Done</button></div>
      <p class="muted small">${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm, ${fmtInt(p.tris)} triangles</p>
    </div>
    <div class="ins-section">
      <h3>Cut plane</h3>
      ${seg('gizmo', state.cut.mode, [['translate', 'Slide'], ['rotate', 'Tilt']])}
      <p class="muted small mode-help">${state.cut.mode === 'rotate'
        ? 'Drag anywhere on the yellow plane to tip it. The edge you grab rises or falls, like lifting the edge of a tray. Hold Shift for fine control.'
        : 'Drag the arrow to slide the cut through the part, or use the position slider.'}</p>
      <div class="row align">
        <span class="lbl">Align</span>
        ${['x', 'y', 'z'].map(a => `<button class="btn small" data-act="align" data-value="${a}" title="Press ${a.toUpperCase()}">${a.toUpperCase()}</button>`).join('')}
        <button class="btn small" data-act="align" data-value="view">To view</button>
        <button class="btn small" data-act="flip" title="Swap the solid and clear halves">Flip</button>
      </div>
      <label class="slider"><span class="lbl">Position</span>
        <input type="range" id="cutPos" min="${state.cut.lo}" max="${state.cut.hi}" step="${(state.cut.hi - state.cut.lo) / 1000}" value="${planeOffset()}">
        <output id="cutPosOut"></output></label>
      <div class="angle-row"><span class="lbl">Angle</span><output id="tiltOut"></output><button class="btn small" data-act="straighten" title="Snap the cut square to the nearest axis">Straighten</button></div>
      ${regions.length > 1 ? `<div class="areas"><p class="lbl">The cut face has ${regions.length} separate areas. Click an area’s label in the view, or untick it here, to leave it joined.</p>
        <ul>${regions.map((r, i) => `<li data-area-row="${i}"${i === state.cut.hoverArea ? ' class="is-hover"' : ''}><label><input type="checkbox" data-area="${i}" ${state.cut.skip.has(i) ? '' : 'checked'}> Area ${i + 1} <span class="muted">${fmt(r.area)} mm²</span></label></li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="ins-section">
      <h3>Keys</h3>
      ${seg('keytype', c.type, [['peg', 'Pegs'], ['dowel', 'Dowels'], ['magnet', 'Magnets'], ['none', 'None']])}
      ${c.type === 'none' ? '<p class="muted small">The pieces will have flat faces with nothing to line them up.</p>' : `
      <p class="muted small">${{ peg: 'A peg on one piece fits a socket in the other.', dowel: 'Both pieces get holes, and Keymaster adds printable pins. Metal rods work too.', magnet: 'Both pieces get pockets sized for disc magnets.' }[c.type]}</p>
      ${shapePicker(c)}
      <p class="muted small shape-help">${SHAPE_HELP[shownShape]}</p>
      <div class="row two">
        ${numField('diameter', shownShape === 'round' ? 'Diameter' : 'Width', c.diameter, { min: 1, step: 0.5 })}
        ${numField('length', lenLabel, c.length, { min: 0.5, step: 0.5 })}
      </div>
      <div class="field"><span class="lbl">Fit</span>
        ${seg('fit', c.clearance, [['0.1', 'Snug'], ['0.2', 'Standard'], ['0.3', 'Loose']])}
        <div class="row two">${numField('clearance', 'Gap per side', c.clearance, { min: 0, step: 0.05 })}${numField('margin', 'Wall around keys', c.margin, { min: 0.4, step: 0.2 })}</div>
      </div>
      ${shownShape !== 'round' ? `<div class="field direction"><span class="lbl">Direction</span>
        <label class="check"><input type="checkbox" data-cfg="align" ${c.align !== false ? 'checked' : ''}> Line up with each area’s long side</label>
        <div class="row two">${numField('turn', 'Turn by', c.turn || 0, { min: -180, max: 180, step: 15, unit: '°' })}</div></div>` : ''}
      ${c.type === 'peg' ? `<div class="field"><span class="lbl">Pegs go on</span>${seg('pegside', c.pegSide, [['below', 'Solid half'], ['above', 'Clear half']])}
        <label class="check"><input type="checkbox" data-cfg="taper" ${c.taper ? 'checked' : ''}> Taper the pegs for easier fitting</label></div>` : ''}
      <div class="row keyrow">
        <label class="num"><span>Keys per area</span><select data-cfg="perArea">${[1, 2, 3, 4].map(n => `<option ${n === c.perArea ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn" data-act="auto-keys">${state.cut.auto ? 'Re-place keys' : 'Auto-place keys'}</button>
      </div>
      ${keyStatus}
      ${state.cut.active >= 0 && state.cut.keys[state.cut.active] ? `<button class="btn small" data-act="remove-key">Remove selected key</button>` : ''}`}
    </div>
    <div class="ins-section cut-action">
      <button class="btn cut" data-act="cut">${ICONS.cut}<span>Cut part</span><kbd>Enter</kbd></button>
      <button class="btn ghost small" data-act="export-one">Export this part</button>
    </div>`;
  }
  function updatePositionReadout() {
    const out = $('#cutPosOut'), range = $('#cutPos');
    if (!out || !range) return;
    const s = planeOffset();
    if (document.activeElement !== range) { range.min = state.cut.lo; range.max = state.cut.hi; range.value = s; }
    out.textContent = (s >= 0 ? '+' : '') + fmt(s) + ' mm';
    const to = $('#tiltOut');
    if (to) { const t = tiltInfo(); to.textContent = t.deg < 0.05 ? `Square to ${t.axis}` : `${t.deg.toFixed(1)}° off ${t.axis}`; }
  }

  const ins = $('#inspector');
  ins.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, val = b.dataset.value;
    const c = state.cfg;
    switch (act) {
      case 'done': selectPart(null); break;
      case 'gizmo': setGizmoMode(val); renderInspector(); updateHint(); break;
      case 'align': alignPlane(val); break;
      case 'flip': flipPlane(); break;
      case 'straighten': straighten(); break;
      case 'keytype': {
        if (c.type === val) break;
        c.type = val;
        if (K.KEY_DEFAULTS[val]) { c.diameter = K.KEY_DEFAULTS[val].diameter; c.length = K.KEY_DEFAULTS[val].length; }
        state.cut.auto = true; savePrefs(); scheduleAnalysis(0); renderInspector(); updateHint();
        break;
      }
      case 'shape': c.shape = val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'fit': c.clearance = +val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'pegside': c.pegSide = val; savePrefs(); scheduleAnalysis(0); renderInspector(); break;
      case 'auto-keys': state.cut.auto = true; state.cut.active = -1; scheduleAnalysis(0); renderInspector(); break;
      case 'remove-bad': removeBadKeys(); break;
      case 'remove-key': if (state.cut.active >= 0) removeKey(state.cut.active); break;
      case 'cut': doCut(); break;
      case 'export-one': exportParts(state.selectedId); break;
      case 'fill-holes': fillAllHoles(); break;
      case 'rotate': rotateAll(val); break;
      case 'scale': scaleAll(+val); break;
      case 'scale-custom': scaleAll((+$('#scalePct').value || 100) / 100); break;
      default: break;
    }
  });
  ins.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.cfg) {
      const k = t.dataset.cfg;
      if (t.type === 'checkbox') state.cfg[k] = t.checked;
      else {
        const v = parseFloat(t.value);
        if (!isFinite(v) || (v < 0 && k !== 'turn')) { renderInspector(); return; }
        state.cfg[k] = k === 'perArea' ? Math.round(v) : k === 'turn' ? normTurn(v) : v;
      }
      if (k === 'perArea') state.cut.auto = true;
      savePrefs(); scheduleAnalysis(0); renderInspector();
    } else if (t.dataset.bed) {
      const v = parseFloat(t.value);
      if (isFinite(v) && v > 0) { state.bed[t.dataset.bed] = v; savePrefs(); renderParts(); }
    } else if (t.dataset.area !== undefined) {
      const i = +t.dataset.area;
      if (t.checked === state.cut.skip.has(i)) toggleArea(i);
    } else if (t.id === 'cutPos') {
      computeSliderRange(); state.cut.skip.clear(); scheduleAnalysis(0);
    }
  });
  ins.addEventListener('mouseover', (e) => { const r = e.target.closest('[data-area-row]'); if (r) setHoverArea(+r.dataset.areaRow); });
  ins.addEventListener('mouseout', (e) => {
    const r = e.target.closest('[data-area-row]');
    if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) setHoverArea(-1);
  });
  ins.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cutPos') {
      setPlaneOffset(parseFloat(t.value));
      state.cut.stale = true; renderKeyMarkers();
      clearTimeout(analysisTimer);
      analysisTimer = setTimeout(() => { state.cut.skip.clear(); runAnalysis(); }, 220);
    } else if (t.id === 'explode') {
      state.explode = parseFloat(t.value); applyExplode();
    }
  });

  /* ---------------- top bar, empty state, view tools ---------------- */
  $('#openBtn').addEventListener('click', () => fileInput.click());
  $('#emptyOpen').addEventListener('click', () => fileInput.click());
  $('#emptySample').addEventListener('click', loadSample);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#exportBtn').addEventListener('click', () => exportParts(null));
  $('#frameBtn').addEventListener('click', () => frameAll(selectedPart() || undefined));
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
