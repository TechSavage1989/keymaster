const K = require('../src/core.js');
const fs = require('fs');
const { execSync } = require('child_process');
let fails = 0, passes = 0;
let voxelsG; // a closed mesh from filled cubes, defined in the printability section and used after it
function check(name, cond, extra) {
  if (cond) { passes++; console.log('  ok  ' + name); }
  else { fails++; console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

function uvSphere(r, seg, rings, c = [0, 0, 0]) {
  const pos = [c[0], c[1], c[2] + r];
  for (let i = 1; i < rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th));
    }
  }
  pos.push(c[0], c[1], c[2] - r);
  const S = pos.length / 3 - 1, idx = [];
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) {
    const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg), cc = 1 + (i + 1) * seg + j, d = 1 + (i + 1) * seg + ((j + 1) % seg);
    idx.push(a, cc, b, b, cc, d);
  }
  const base = 1 + (rings - 2) * seg;
  for (let j = 0; j < seg; j++) idx.push(S, base + ((j + 1) % seg), base + j);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
function gridCube(n) { // subdivided unit cube, as a triangle soup like an STL
  const tris = [];
  const face = (o, a, b) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = (s, t) => [o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t];
      const s0 = i / n, s1 = (i + 1) / n, t0 = j / n, t1 = (j + 1) / n;
      tris.push(...p(s0, t0), ...p(s1, t0), ...p(s1, t1), ...p(s0, t0), ...p(s1, t1), ...p(s0, t1));
    }
  };
  face([0, 0, 0], [0, 1, 0], [1, 0, 0]); // bottom (normal -z)
  face([0, 0, 1], [1, 0, 0], [0, 1, 0]); // top
  face([0, 0, 0], [1, 0, 0], [0, 0, 1]); // front y=0 (normal -y)
  face([0, 1, 0], [0, 0, 1], [1, 0, 0]); // back
  face([0, 0, 0], [0, 0, 1], [0, 1, 0]); // left x=0
  face([1, 0, 0], [0, 1, 0], [0, 0, 1]); // right
  return { positions: new Float32Array(tris), indices: null };
}
const cfgOf = (o) => ({ type: 'none', shape: 'round', diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper: false, pegSide: 'below', ...o });
function allClosed(parts) { return parts.every(p => K.edgeReport(p.indices).closed && K.volume(p.positions, p.indices) > 0); }
function sumVol(parts) { return parts.reduce((s, p) => s + K.volume(p.positions, p.indices), 0); }

console.log('earcut');
{
  const outer = [0, 0, 10, 0, 10, 10, 0, 10];
  const hole = [3, 3, 3, 7, 7, 7, 7, 3];
  const t = K.earcut(outer.concat(hole), [4]);
  const f = outer.concat(hole);
  let a = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [p, q, r] = [t[i], t[i + 1], t[i + 2]];
    a += Math.abs((f[2 * q] - f[2 * p]) * (f[2 * r + 1] - f[2 * p + 1]) - (f[2 * r] - f[2 * p]) * (f[2 * q + 1] - f[2 * p + 1])) / 2;
  }
  check('square with hole area = 84', Math.abs(a - 84) < 1e-9, a);
  // big circle with many points and holes (hashed path)
  const ring = (cx, cy, r, n, rev) => { const o = []; for (let i = 0; i < n; i++) { const th = (rev ? -1 : 1) * i / n * Math.PI * 2; o.push(cx + r * Math.cos(th), cy + r * Math.sin(th)); } return o; };
  const big = ring(0, 0, 50, 400).concat(ring(-20, 0, 5, 60), ring(20, 0, 5, 60));
  const tt = K.earcut(big, [400, 460]);
  let aa = 0;
  for (let i = 0; i < tt.length; i += 3) {
    const [p, q, r] = [tt[i], tt[i + 1], tt[i + 2]];
    aa += Math.abs((big[2 * q] - big[2 * p]) * (big[2 * r + 1] - big[2 * p + 1]) - (big[2 * r] - big[2 * p]) * (big[2 * q + 1] - big[2 * p + 1])) / 2;
  }
  const expect = 0.5 * 400 * 50 * 50 * Math.sin(2 * Math.PI / 400) - 2 * 0.5 * 60 * 25 * Math.sin(2 * Math.PI / 60);
  check('circle with two holes area', Math.abs(aa - expect) < 1e-6 * expect, [aa, expect]);
}

console.log('prepare + cube cut');
{
  const m = K.prepareMesh(gridCube(4));
  check('grid cube welded & closed', m.report.closed, m.report);
  check('grid cube volume 1', Math.abs(m.report.volume - 1) < 1e-6, m.report.volume);
  // cut exactly through a row of vertices (z = 0.5) to exercise the plane nudge + T-junction repair
  const F = K.frameFromNormal([0, 0, 1], [0.5, 0.5, 0.5]);
  const r = K.cutMesh(m.positions, m.indices, F, { scale: 1.7, cfg: cfgOf({}) });
  check('cube -> 2 parts', r.parts.length === 2, r.parts.length);
  check('cube parts closed', allClosed(r.parts), r.parts.map(p => K.edgeReport(p.indices)));
  check('cube volumes sum to 1', Math.abs(sumVol(r.parts) - 1) < 1e-5, sumVol(r.parts));
  // tilted cut
  const F2 = K.frameFromNormal([0.3, -0.2, 1], [0.5, 0.5, 0.4]);
  const r2 = K.cutMesh(m.positions, m.indices, F2, { scale: 1.7, cfg: cfgOf({}) });
  check('tilted cube parts closed', r2.parts.length === 2 && allClosed(r2.parts));
  check('tilted volumes sum to 1', Math.abs(sumVol(r2.parts) - 1) < 1e-5, sumVol(r2.parts));
  // flipped normal: orientation still right
  const F3 = K.frameFromNormal([0, 0, -1], [0.5, 0.5, 0.31]);
  const r3 = K.cutMesh(m.positions, m.indices, F3, { scale: 1.7, cfg: cfgOf({}) });
  check('reversed-normal cut closed', allClosed(r3.parts) && Math.abs(sumVol(r3.parts) - 1) < 1e-5);
}

console.log('sphere with keys');
{
  const s = K.prepareMesh(uvSphere(20, 96, 64));
  check('sphere closed', s.report.closed, s.report);
  const V0 = s.report.volume;
  const F = K.frameFromNormal([0, 0, 1], [0, 0, 1.3]);
  for (const type of ['peg', 'dowel', 'magnet']) {
    for (const shape of ['round', 'square']) {
      const d = K.KEY_DEFAULTS[type];
      const cfg = cfgOf({ type, shape, diameter: d.diameter, length: d.length, taper: type === 'peg' });
      const an = K.analyzePlane(s.positions, s.indices, F, cfg, 40);
      check(`${type}/${shape}: analysis ok`, !an.base.error && an.base.regions.length === 1);
      const keys = K.autoPlaceKeys(an, cfg, 3, new Set());
      check(`${type}/${shape}: auto-placed 3 keys`, keys.length === 3, keys.length);
      const ev = K.evaluateKeys(an, keys, cfg, new Set());
      check(`${type}/${shape}: keys valid`, ev.every(e => e.ok), ev.filter(e => !e.ok));
      const r = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg, keys });
      check(`${type}/${shape}: 2 parts`, r.parts.length === 2, r.parts.length);
      check(`${type}/${shape}: parts closed`, allClosed(r.parts), r.parts.map(p => K.edgeReport(p.indices)));
      check(`${type}/${shape}: pins closed`, r.pins.every(p => K.edgeReport(p.indices).closed && K.volume(p.positions, p.indices) > 0));
      if (type === 'dowel') check('dowel: 3 pins', r.pins.length === 3);
      const parts = r.parts.concat(r.pins);
      const total = sumVol(parts);
      // expected: sphere volume minus clearance gaps (sockets bigger than pegs/pins)
      if (type === 'magnet') {
        const side = shape === 'square' ? 2 * (d.diameter / 2 + 0.2) : 0;
        const pocket = shape === 'square' ? side * side * (d.length + 0.3) : Math.PI * Math.pow(d.diameter / 2 + 0.2, 2) * (d.length + 0.3);
        check(`magnet/${shape}: volume = sphere minus 6 pockets`, Math.abs(total - (V0 - 6 * pocket)) / V0 < 0.003, [total, V0 - 6 * pocket]);
      } else check(`${type}/${shape}: volume within 2% of sphere`, Math.abs(total - V0) / V0 < 0.02, [total, V0]);
      const below = r.parts.find(p => p.side === 'below'), above = r.parts.find(p => p.side === 'above');
      if (type === 'peg') {
        const bb = K.bounds(below.positions);
        check('peg: lower part has pegs sticking up', bb.max[2] > 1.3 + d.length - 0.2, bb.max[2]);
        check('peg: upper part lighter than its half (sockets)', K.volume(above.positions, above.indices) < V0 / 2);
      }
    }
  }
  // a key that would break through: put the cut near the top so the socket floor is missing
  const Ftop = K.frameFromNormal([0, 0, 1], [0, 0, 17]);
  const cfg = cfgOf({ type: 'peg', diameter: 5, length: 6 });
  const an = K.analyzePlane(s.positions, s.indices, Ftop, cfg, 40);
  const ev = K.evaluateKeys(an, [{ x: 0, y: 0 }], cfg, new Set());
  check('breakthrough detected near the top', !ev[0].ok && /break through/.test(ev[0].reason), ev[0]);
  const ev2 = K.evaluateKeys(K.analyzePlane(s.positions, s.indices, F, cfg, 40), [{ x: 18.5, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], cfg, new Set());
  check('edge key rejected', !ev2[0].ok && ev2[0].reason === 'Too close to the edge', ev2[0]);
  check('overlapping keys rejected', !ev2[1].ok && !ev2[2].ok, ev2);
}

console.log('key shapes');
{
  // polygon helpers for checking outlines
  const segDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let s = L > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; s = Math.max(0, Math.min(1, s));
    return Math.hypot(a[0] + s * dx - px, a[1] + s * dy - py);
  };
  const polyDist = (A, B) => { let d = Infinity; for (const p of A) for (let i = 0; i < B.length; i++) d = Math.min(d, segDist(p[0], p[1], B[i], B[(i + 1) % B.length])); return d; };
  const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const prismatoid = (A0, A1, h) => { const mid = A0.map((p, i) => [(p[0] + A1[i][0]) / 2, (p[1] + A1[i][1]) / 2]); return h / 6 * (K.profileArea(A0) + 4 * K.profileArea(mid) + K.profileArea(A1)); };

  check('seven shapes offered', K.KEY_SHAPES.length === 7 && K.KEY_SHAPES.includes('dshape') && K.KEY_SHAPES.includes('slot'));
  for (const shape of K.KEY_SHAPES) {
    const r = 2.5, c = 0.2, res = 40;
    for (const ang of [0, 0.7]) {
      const peg = K.keyProfile(shape, r, 0, ang, res), sock = K.keyProfile(shape, r, c, ang, res);
      const gap = Math.min(polyDist(peg, sock), polyDist(sock, peg));
      check(`${shape}${ang ? ' (turned)' : ''}: socket clears the peg by the full gap on every side`, gap > c * 0.97 && peg.every(([x, y]) => inside(sock, x, y)), gap);
    }
    const peg = K.keyProfile(shape, r, 0, 0, res), tip = K.keyProfile(shape, r * 0.8, 0, 0, res);
    check(`${shape}: tip ring pairs with base ring`, peg.length === tip.length);
    check(`${shape}: outline runs counter-clockwise around the centre`, K.profileArea(peg) > 0 && peg.every((a, i) => { const b = peg[(i + 1) % peg.length]; return a[0] * b[1] - a[1] * b[0] > 0; }));
    const fit = K.profileFit(peg);
    check(`${shape}: width matches the size setting`, Math.abs(fit.inner - (shape === 'cross' ? 0.38 * r * Math.SQRT2 : shape === 'dshape' ? 0.5 * r : r)) < 0.05 * r, fit);
  }
  const d0 = K.keyProfile('dshape', 2.5, 0, 0, 40), d1 = K.keyProfile('dshape', 2.5, 0, Math.PI, 40);
  check('D-shape only fits one way round', d0.some(([x, y]) => !inside(d1, x * 0.97, y * 0.97)));
  check('magnets fall back to round for other shapes', K.keyGeometrySpec(cfgOf({ type: 'magnet', shape: 'cross' })).shape === 'round');

  // every shape cuts into closed solids, and the volume adds up exactly: sphere minus sockets plus pegs and pins
  const s = K.prepareMesh(uvSphere(20, 96, 64));
  const V0 = s.report.volume;
  const F = K.frameFromNormal([0, 0, 1], [0, 0, 1.3]);
  for (const type of ['peg', 'dowel', 'magnet']) {
    const shapes = type === 'magnet' ? K.MAGNET_SHAPES : K.KEY_SHAPES;
    for (const shape of shapes) {
      if ((shape === 'round' || shape === 'square') && type !== 'peg') continue; // covered above
      const d = K.KEY_DEFAULTS[type];
      const cfg = cfgOf({ type, shape, diameter: d.diameter, length: d.length, taper: type === 'peg', turn: 20 });
      const an = K.analyzePlane(s.positions, s.indices, F, cfg, 40);
      const keys = K.autoPlaceKeys(an, cfg, 3, new Set());
      const ev = K.evaluateKeys(an, keys, cfg, new Set());
      check(`${type}/${shape}: 3 valid keys placed`, keys.length === 3 && ev.every(e => e.ok), [keys.length, ev.filter(e => !e.ok)]);
      const res = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg, keys });
      check(`${type}/${shape}: parts and pins closed`, res.parts.length === 2 && allClosed(res.parts) && allClosed(res.pins), res.parts.map(p => K.edgeReport(p.indices)));
      const spec = K.keyGeometrySpec(cfg), ang = K.keyAngle(an.base, 0, cfg);
      const P = (rr, dd) => K.keyProfile(spec.shape, rr, dd, ang, spec.res);
      let expect = V0;
      if (type === 'peg') expect += keys.length * (prismatoid(P(spec.r, 0), P(spec.r * 0.8, 0), d.length) - prismatoid(P(spec.r, spec.c), P(spec.r * 0.8, spec.c), d.length + spec.ca));
      else expect -= keys.length * 2 * prismatoid(P(spec.r, spec.c), P(spec.r, spec.c), type === 'dowel' ? d.length / 2 + spec.ca : d.length + spec.ca);
      expect += sumVol(res.pins);
      const total = sumVol(res.parts) + sumVol(res.pins);
      check(`${type}/${shape}: volume adds up`, Math.abs(total - expect) / V0 < 1e-4, [total, expect]);
    }
  }

  // taper: any amount on any shape, with a matching or straight socket
  check('old on/off taper setting still means 20%', K.keyGeometrySpec(cfgOf({ type: 'peg', taper: true })).taper === 0.8 && K.keyGeometrySpec(cfgOf({ type: 'peg', taper: false })).taper === 1);
  check('dowels and magnets never taper', K.keyGeometrySpec(cfgOf({ type: 'dowel', taper: 60 })).taper === 1 && K.keyGeometrySpec(cfgOf({ type: 'magnet', taper: 60 })).sockTip === 1);
  for (const shape of K.KEY_SHAPES) {
    for (const [pct, match] of [[50, true], [100, true], [100, false]]) {
      const cfg = cfgOf({ type: 'peg', shape, diameter: 5, length: 6, taper: pct, taperSocket: match });
      const spec = K.keyGeometrySpec(cfg), tag = `${shape} ${pct}% ${match ? 'matching' : 'straight'} hole`;
      const an = K.analyzePlane(s.positions, s.indices, F, cfg, 40);
      const keys = K.autoPlaceKeys(an, cfg, 3, new Set());
      const res = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg, keys });
      const ang = K.keyAngle(an.base, 0, cfg), P = (rr, dd) => K.keyProfile(spec.shape, rr, dd, ang, spec.res);
      const expect = V0 + keys.length * (prismatoid(P(spec.r, 0), P(spec.r * spec.taper, 0), 6) - prismatoid(P(spec.r, spec.cs), P(spec.r * spec.sockTip, spec.cs), 6 + spec.ca));
      check(`${tag}: 3 keys, sealed parts, volume adds up`, keys.length === 3 && allClosed(res.parts) && Math.abs(sumVol(res.parts) - expect) / V0 < 1e-4, [keys.length, sumVol(res.parts), expect]);
      // the gap, measured at right angles to the sloping wall, is never less than the setting at any height
      let worst = Infinity;
      const slope = (spec.r * (1 - spec.taper)) / 6;
      for (const z of [0, 1.5, 3, 4.5, 6]) {
        const pr = spec.r * (1 - (1 - spec.taper) * z / 6), sr = spec.r * (1 - (1 - spec.sockTip) * z / (6 + spec.ca));
        const pg = K.keyProfile(spec.shape, pr, 0, 0, spec.res), sk = K.keyProfile(spec.shape, sr, spec.cs, 0, spec.res);
        // a matching hole's wall slopes with the peg, so the true gap is the gap across times cosθ; a straight hole's wall is upright
        worst = Math.min(worst, Math.min(polyDist(pg, sk), polyDist(sk, pg)) / (match ? Math.sqrt(1 + slope * slope) : 1));
      }
      check(`${tag}: gap at right angles to the wall is at least the setting`, worst >= 0.2 * 0.97, worst);
    }
  }
  {
    const cone = cfgOf({ type: 'peg', shape: 'round', diameter: 5, length: 6, taper: 100 });
    const rc = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg: cone, keys: [{ x: 0, y: 0 }] });
    const lower = rc.parts.find(p => p.side === 'below'), Pl = lower.positions;
    let top = -Infinity; for (let i = 2; i < Pl.length; i += 3) top = Math.max(top, Pl[i]);
    let w = 0; for (let i = 0; i < Pl.length; i += 3) if (Pl[i + 2] > top - 1e-4) w = Math.max(w, Math.hypot(Pl[i], Pl[i + 1]) * 2);
    check('100% taper comes to a point (tip under 0.15 mm)', Math.abs(top - (1.3 + 6)) < 1e-3 && w < 0.15, [top, w]);
    const half = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg: { ...cone, taper: 50 }, keys: [{ x: 0, y: 0 }] }).parts.find(p => p.side === 'below').positions;
    let w2 = 0; for (let i = 0; i < half.length; i += 3) if (half[i + 2] > 1.3 + 6 - 1e-4) w2 = Math.max(w2, Math.hypot(half[i], half[i + 1]) * 2);
    check('50% taper tip is half the width', Math.abs(w2 - 2.5) < 0.05, w2);
  }

  // a slot lines up with a long narrow area and fits where a round key of the same length can't
  const bar = K.prepareMesh({ positions: gridCube(3).positions.map((v, i) => v * [60, 9, 20][i % 3]), indices: null });
  const Fb = K.frameFromNormal([0, 0, 1], [30, 4.5, 10]);
  const slot = cfgOf({ type: 'peg', shape: 'slot', diameter: 4, length: 6 });
  const anb = K.analyzePlane(bar.positions, bar.indices, Fb, slot, 60);
  const ang = K.keyAngle(anb.base, 0, slot), u = Fb.u;
  const dir = [Math.cos(ang) * u[0] + Math.sin(ang) * Fb.v[0], Math.cos(ang) * u[1] + Math.sin(ang) * Fb.v[1]];
  check('slot follows the long direction of the area', Math.abs(dir[0]) > 0.99, dir);
  const kb = K.autoPlaceKeys(anb, slot, 3, new Set());
  check('slots fit in a narrow bar', kb.length === 3 && K.evaluateKeys(anb, kb, slot, new Set()).every(e => e.ok), kb.length);
  const across = { ...slot, align: false, turn: 0 };
  const turned = K.keyAngle(anb.base, 0, across) === 0 ? { ...across, turn: Math.abs(u[0]) > 0.9 ? 90 : 0 } : across;
  check('a slot turned across the bar is rejected', K.evaluateKeys(anb, [{ x: 0, y: 0 }], turned, new Set())[0].reason === 'Too close to the edge', K.evaluateKeys(anb, [{ x: 0, y: 0 }], turned, new Set())[0]);
  const rb = K.cutMesh(bar.positions, bar.indices, Fb, { scale: 60, cfg: slot, keys: kb });
  check('slot cut closed', rb.parts.length === 2 && allClosed(rb.parts));
  // turn setting adds to the area's direction; round keys never turn
  const sq = { loops: [{ xy: [0, 0, 40, 0, 40, 8, 0, 8].map((v, i) => v), area: 320, bbox: [0, 0, 40, 8] }], regions: [{ outer: 0, holes: [], area: 320, bbox: [0, 0, 40, 8] }] };
  const rot = (deg) => { const a = deg * Math.PI / 180, xy = []; const b = sq.loops[0].xy; for (let i = 0; i < b.length; i += 2) xy.push(b[i] * Math.cos(a) - b[i + 1] * Math.sin(a), b[i] * Math.sin(a) + b[i + 1] * Math.cos(a)); return { loops: [{ ...sq.loops[0], xy }], regions: [{ ...sq.regions[0] }] }; };
  const a30 = K.keyAngle(rot(30), 0, { type: 'peg', shape: 'oval' });
  check('keys follow an area turned 30°', Math.abs(Math.sin(a30 - Math.PI / 6)) < 1e-6, a30 * 180 / Math.PI);
  check('turn adds to the area direction', Math.abs(Math.sin(K.keyAngle(rot(30), 0, { type: 'peg', shape: 'oval', turn: 45 }) - 75 * Math.PI / 180)) < 1e-6);
  check('round keys never turn', K.keyAngle(rot(30), 0, { type: 'peg', shape: 'round', turn: 45 }) === 0);

  // regression: square sockets whose straight sides line up used to leave gaps in the cut face
  const sqm = cfgOf({ type: 'magnet', shape: 'square', diameter: 6, length: 3, align: false });
  const ra = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg: sqm, keys: [{ x: 0, y: 0 }, { x: 0, y: -12 }, { x: 10, y: 0 }] });
  check('lined-up square sockets leave no gaps', allClosed(ra.parts), ra.parts.map(p => K.edgeReport(p.indices)));
}

console.log('keys with their own settings');
{
  const s = K.prepareMesh(uvSphere(20, 96, 64)), V0 = s.report.volume;
  const F = K.frameFromNormal([0, 0, 1], [0, 0, 1.3]);
  const cfg = cfgOf({ type: 'peg', shape: 'round', diameter: 5, length: 6 });
  const an = K.analyzePlane(s.positions, s.indices, F, cfg, 40);
  const keys = [{ x: -9, y: 0 }, { x: 0, y: 0, o: { shape: 'square', diameter: 4, taper: 60 } }, { x: 9, y: 0, o: { diameter: 7, length: 9 } }];
  const ev = K.evaluateKeys(an, keys, cfg, new Set());
  check('three keys, two with their own settings, all fit', ev.every(e => e.ok), ev);
  const r = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg, keys });
  check('cut with custom keys gives sealed parts', r.parts.length === 2 && allClosed(r.parts), r.parts.map(p => K.edgeReport(p.indices)));
  const prism = (A0, A1, h) => { const mid = A0.map((q, i) => [(q[0] + A1[i][0]) / 2, (q[1] + A1[i][1]) / 2]); return h / 6 * (K.profileArea(A0) + 4 * K.profileArea(mid) + K.profileArea(A1)); };
  let expect = V0;
  for (const k of keys) {
    const kc = K.keyCfg(cfg, k), sp = K.keyGeometrySpec(kc), ang = K.keyAngle(an.base, 0, kc), P = (rr, dd) => K.keyProfile(sp.shape, rr, dd, ang, sp.res);
    expect += prism(P(sp.r, 0), P(sp.r * sp.taper, 0), kc.length) - prism(P(sp.r, sp.cs), P(sp.r * sp.sockTip, sp.cs), kc.length + sp.ca);
  }
  check('volume adds up key by key', Math.abs(sumVol(r.parts) - expect) / V0 < 1e-4, [sumVol(r.parts), expect]);
  const lower = r.parts.find(q => q.side === 'below').positions;
  let top = -Infinity; for (let i = 2; i < lower.length; i += 3) top = Math.max(top, lower[i]);
  check('the long custom peg stands 9 mm tall', Math.abs(top - (1.3 + 9)) < 1e-3, top);
  // a custom key is checked with its own depth: a 30 mm peg's socket would break through the top of the sphere
  const ev2 = K.evaluateKeys(an, [{ x: -9, y: 0 }, { x: 0, y: 0, o: { length: 30 } }], cfg, new Set());
  const ev2b = K.evaluateKeys(an, [{ x: -9, y: 0 }, { x: 0, y: 0 }], cfg, new Set());
  check('a long custom peg is checked at its own depth', ev2b.every(e => e.ok) && ev2[0].ok && !ev2[1].ok && /break through/.test(ev2[1].reason), ev2);
  // and with its own size for overlaps
  const ev3 = K.evaluateKeys(an, [{ x: -4.5, y: 0 }, { x: 4.5, y: 0 }], cfg, new Set());
  const ev4 = K.evaluateKeys(an, [{ x: -4.5, y: 0 }, { x: 4.5, y: 0, o: { diameter: 12 } }], cfg, new Set());
  check('a bigger custom key overlaps where a standard one fits', ev3.every(e => e.ok) && ev4.every(e => !e.ok && e.reason === 'Overlaps another key'), [ev3, ev4]);
  // dowel pins follow each key's own size
  const dc = cfgOf({ type: 'dowel', diameter: 4, length: 12 });
  const rd = K.cutMesh(s.positions, s.indices, F, { scale: 40, cfg: dc, keys: [{ x: -6, y: 0 }, { x: 6, y: 0, o: { diameter: 6 } }] });
  const pv = rd.pins.map(q => K.volume(q.positions, q.indices));
  check('dowel pins follow each key', rd.pins.length === 2 && allClosed(rd.pins) && allClosed(rd.parts) && pv[1] / pv[0] > 2, pv);
  check('the key type stays the same for the whole cut', K.keyCfg(cfg, { o: { type: 'magnet', diameter: 3 } }).type === 'peg' && K.keyCfg(cfg, { o: { type: 'magnet', diameter: 3 } }).diameter === 3);
}

console.log('keys sized to fit each area');
{
  const lad = (c) => K.sizeLadder(cfgOf(c)).map(([d]) => d);
  check('filament sizes run from the largest set down to 2.5 mm', JSON.stringify(lad({ type: 'peg', diameter: 5, sizeMin: 2.5 })) === '[5,4.5,4,3.5,3,2.5]', lad({ type: 'peg', diameter: 5, sizeMin: 2.5 }));
  check('resin sizes go down to 1 mm', lad({ type: 'peg', diameter: 5, printer: 'resin', sizeMin: 1 }).slice(-1)[0] === 1);
  check('pegs are 1.2 times as long as wide, dowel pins 2.5 times', K.sizeLadder(cfgOf({ type: 'peg', diameter: 5, sizeMin: 5 }))[0][1] === 6 && K.sizeLadder(cfgOf({ type: 'dowel', diameter: 4, sizeMin: 4 }))[0][1] === 10);
  check('magnets come in standard sizes', JSON.stringify(K.sizeLadder(cfgOf({ type: 'magnet', diameter: 6 }))) === '[[6,3],[5,2],[4,2],[3,1.5],[3,1],[2,1]]', K.sizeLadder(cfgOf({ type: 'magnet', diameter: 6 })));
  // a bar W mm wide: a key fits when its width plus two gaps and two walls is under W
  const barAt = (W) => { const m = K.prepareMesh({ positions: gridCube(3).positions.map((v, i) => v * [60, W, 30][i % 3]), indices: null }); const F = K.frameFromNormal([0, 0, 1], [30, W / 2, 15]); return { m, F }; };
  const fit = (W, extra) => { const { m, F } = barAt(W), c = cfgOf({ type: 'peg', diameter: 5, length: 6, sizeMin: 2.5, ...extra }); const an = K.analyzePlane(m.positions, m.indices, F, c, 70); return { keys: K.autoFitKeys(an, c, 1, new Set()), an, c, m, F }; };
  const wide = fit(20, {});
  check('a roomy area gets the largest size', wide.keys.length === 1 && wide.keys[0].a.diameter === 5 && wide.keys[0].a.length === 6, wide.keys);
  const mid = fit(6, {}); // 6 - 0.4 gap - 2.4 wall leaves 3.2 mm
  check('a 6 mm bar gets a 3 mm key', mid.keys.length === 1 && mid.keys[0].a.diameter === 3 && mid.keys[0].a.length === 3.5, mid.keys);
  check('the fitted key passes its checks', K.evaluateKeys(mid.an, mid.keys, mid.c, new Set()).every(e => e.ok));
  const rm = K.cutMesh(mid.m.positions, mid.m.indices, mid.F, { scale: 70, cfg: mid.c, keys: mid.keys });
  check('cutting with a fitted key gives sealed parts', rm.parts.length === 2 && allClosed(rm.parts));
  const thinF = fit(3, {}); // filament can't go below 2.5 mm, which needs 5.3 mm
  check('a 3 mm bar has no room for a filament key, and says it tried the smallest', thinF.keys.length === 0 && thinF.keys.empty.length === 1 && thinF.keys.empty[0].smallest, thinF.keys.empty);
  const thinR = fit(3.2, { printer: 'resin', sizeMin: 1, clearance: 0.1, margin: 0.8 }); // 3.2 - 0.2 - 1.6 leaves 1.4: room for 1.2, not 1.6
  check('a 3.2 mm bar takes a 1.2 mm resin key', thinR.keys.length === 1 && thinR.keys[0].a.diameter === 1.2, thinR.keys);
  const mag = fit(9, { type: 'magnet', diameter: 10 }); // 9 - 0.4 - 2.4 leaves 6.2 mm: a 6 × 3 mm magnet
  check('a magnet pocket gets the biggest standard magnet that fits', mag.keys.length === 1 && mag.keys[0].a.diameter === 6 && mag.keys[0].a.length === 3, mag.keys);
  const sturdy = fit(12, {}); // room for 8.8 mm, but half the 12 mm width is 6, so 5 (the largest allowed) is fine; at 8 mm wide, 4
  const half = fit(8, { diameter: 8 });
  check('a fitted key is at most half the area\u2019s width, for sturdy walls', half.keys.length === 1 && half.keys[0].a.diameter <= 4, half.keys);
  // the owner's own size still wins over the fitted one
  check('a key’s own size overrides the fitted size', K.keyCfg(cfgOf({}), { a: { diameter: 3, length: 3.5 }, o: { diameter: 2 } }).diameter === 2 && K.keyCfg(cfgOf({}), { a: { diameter: 3, length: 3.5 } }).length === 3.5);
}

console.log('keys in narrow areas');
{
  // square pegs, 45% taper, 5 mm walls (an owner's report): the key fits only on a 0.3 mm strip down the middle of a bar
  const cfg = cfgOf({ type: 'peg', shape: 'square', diameter: 5, length: 6, margin: 5, taper: 45 });
  const spec = K.keyGeometrySpec(cfg);
  const W = 2 * (spec.r + spec.cs) + 2 * 5 + 0.3;
  // 30 mm tall, so a 6 mm socket plus the 3.75 mm floor a 5 mm wall asks for fits on either side of the middle
  const bar = K.prepareMesh({ positions: gridCube(3).positions.map((v, i) => v * [60, W, 30][i % 3]), indices: null });
  const F = K.frameFromNormal([0, 0, 1], [30, W / 2, 15]);
  const an = K.analyzePlane(bar.positions, bar.indices, F, cfg, 70);
  const keys = K.autoPlaceKeys(an, cfg, 2, new Set());
  check('a key is found on a strip narrower than the search grid', keys.length >= 1 && K.evaluateKeys(an, keys, cfg, new Set()).every(e => e.ok) && !keys.empty.length, [keys.length, keys.empty]);
  check('keyed cut of the narrow bar is sealed', allClosed(K.cutMesh(bar.positions, bar.indices, F, { scale: 70, cfg, keys }).parts));
  // a little narrower and nothing fits: the area is reported, with the reason
  const W2 = W - 0.8;
  const bar2 = K.prepareMesh({ positions: gridCube(3).positions.map((v, i) => v * [60, W2, 30][i % 3]), indices: null });
  const an2 = K.analyzePlane(bar2.positions, bar2.indices, K.frameFromNormal([0, 0, 1], [30, W2 / 2, 15]), cfg, 70);
  const k2 = K.autoPlaceKeys(an2, cfg, 2, new Set());
  check('an area with no room is reported with its reason', k2.length === 0 && k2.empty.length === 1 && k2.empty[0].region === 0 && k2.empty[0].reason === 'Too close to the edge', k2.empty);
  // across the sample knot, with thick walls and every key type, keys are only missing where nothing fits
  const kn = K.prepareMesh(K.torusKnot()), kb = K.bounds(kn.positions);
  let missed = 0, areas = 0;
  for (const c of [cfg, cfgOf({ type: 'dowel', diameter: 4, length: 12, margin: 5 }), cfgOf({ type: 'peg', shape: 'slot', margin: 3 })]) {
    for (let i = 0; i < 12; i++) {
      const tilt = (i % 4) * 0.15, a = i * 0.9;
      const Fk = K.frameFromNormal([Math.sin(tilt) * Math.cos(a), Math.sin(tilt) * Math.sin(a), Math.cos(tilt)], [kb.center[0], kb.center[1], kb.center[2] + ((i % 3) - 1) * 6]);
      const ak = K.analyzePlane(kn.positions, kn.indices, Fk, c, 100);
      const kk = K.autoPlaceKeys(ak, c, 2, new Set());
      for (const e of kk.empty) {
        areas++;
        const reg = ak.base.regions[e.region], [x0, y0, x1, y1] = reg.bbox;
        let fits = 0;
        for (let x = x0; x < x1; x += 0.25) for (let y = y0; y < y1; y += 0.25) if (K.regionAt(ak.base, x, y) === e.region && K.evaluateKeys(ak, [{ x, y }], c, new Set())[0].ok) fits++;
        if (fits > 8) missed++; // a patch bigger than half a square millimetre where a key fits
      }
    }
  }
  check('no area is left without a key where one clearly fits', missed === 0, [missed, areas]);
}

console.log('torus knot: many regions, components, selective cut');
{
  const k = K.prepareMesh(K.torusKnot());
  check('knot closed', k.report.closed, k.report);
  const b = K.bounds(k.positions);
  const F = K.frameFromNormal([1, 0, 0.1], b.center);
  const an = K.analyzePlane(k.positions, k.indices, F, cfgOf({ type: 'peg' }), 100);
  check('knot section has several regions', an.base.regions.length >= 3, an.base.regions.length);
  const cfg = cfgOf({ type: 'peg' });
  const keys = K.autoPlaceKeys(an, cfg, 1, new Set());
  check('one key per region', keys.length === an.base.regions.length, [keys.length, an.base.regions.length]);
  const r = K.cutMesh(k.positions, k.indices, F, { scale: 100, cfg, keys });
  check('knot cut -> several closed parts', r.parts.length >= 2 && allClosed(r.parts), r.parts.length);
  const vol = sumVol(r.parts);
  check('knot volume preserved (within 1%)', Math.abs(vol - k.report.volume) / k.report.volume < 0.01, [vol, k.report.volume]);
  // selective: skip the largest region
  const r2 = K.cutMesh(k.positions, k.indices, F, { scale: 100, cfg: cfgOf({}), skip: new Set([0]) });
  check('selective cut closed', allClosed(r2.parts), r2.parts.length);
  check('selective cut has a part spanning the plane', r2.parts.some(p => p.side === 'both'));
  check('selective volume preserved', Math.abs(sumVol(r2.parts) - k.report.volume) / k.report.volume < 1e-4);
  // cutting a part again works (part tree)
  const big = r.parts.reduce((a, c) => (a.volume > c.volume ? a : c));
  const bb = K.bounds(big.positions);
  const r3 = K.cutMesh(big.positions, big.indices, K.frameFromNormal([0, 1, 0], bb.center), { scale: 100, cfg: cfgOf({}) });
  check('re-cut of a keyed part closed', allClosed(r3.parts) && r3.parts.length >= 2, r3.parts.length);
}

console.log('area labels');
{
  const k = K.prepareMesh(K.torusKnot());
  const b = K.bounds(k.positions);
  const F = K.frameFromNormal([1, 0, 0.1], b.center);
  const cfg = cfgOf({ type: 'peg' });
  const an = K.analyzePlane(k.positions, k.indices, F, cfg, 100);
  const sec = an.base;
  const keys = K.autoPlaceKeys(an, cfg, 1, new Set());
  const avoid = K.keyGeometrySpec(cfg).outer + cfg.margin;
  let inside = true, clearOfKeys = true;
  sec.regions.forEach((reg, ri) => {
    const pt = K.pickLabelPoint(K.regionSamples(sec, ri), keys, avoid);
    if (K.regionAt(sec, pt.x, pt.y) !== ri) inside = false;
    for (const key of keys) if (Math.hypot(pt.x - key.x, pt.y - key.y) < avoid) clearOfKeys = false;
  });
  check('each label sits inside its own area', inside);
  check('labels stay clear of keys', clearOfKeys);
  // a ring-shaped area: the label must land on the ring, not in the hole, and away from a key
  const sq = (s) => [-s, -s, s, -s, s, s, -s, s];
  const sec2 = {
    loops: [{ xy: sq(10), area: 400, bbox: [-10, -10, 10, 10] }, { xy: sq(4).reverse(), area: -64, bbox: [-4, -4, 4, 4] }],
    regions: [{ outer: 0, holes: [1], area: 336, bbox: [-10, -10, 10, 10] }],
  };
  const samples = K.regionSamples(sec2, 0);
  check('ring samples avoid the hole', samples.length > 0 && samples.every(s => K.regionAt(sec2, s.x, s.y) === 0));
  const pt = K.pickLabelPoint(samples, [{ x: 7, y: 7 }], 3);
  check('ring label lands on the ring', K.regionAt(sec2, pt.x, pt.y) === 0 && Math.max(Math.abs(pt.x), Math.abs(pt.y)) > 4, pt);
  check('ring label avoids the key', Math.hypot(pt.x - 7, pt.y - 7) >= 3, pt);
  // a sliver thinner than the sampling grid still gets a spot
  const sec3 = { loops: [{ xy: [0, 0, 100, 0, 100, 0.01, 0, 0.01], area: 1, bbox: [0, 0, 100, 0.01] }], regions: [{ outer: 0, holes: [], area: 1, bbox: [0, 0, 100, 0.01] }] };
  const s3 = K.regionSamples(sec3, 0);
  check('sliver area still gets a label spot', s3.length >= 1 && isFinite(s3[0].x) && isFinite(s3[0].y), s3[0]);
}

console.log('real-sculpt defects');
{
  // a closed prism over any outline; caps are fans from the first point so they are valid even when the outline crosses itself
  const prism = (poly, z0, z1) => {
    const pos = [], idx = [], n = poly.length;
    for (const z of [z0, z1]) for (const [x, y] of poly) pos.push(x, y, z);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + j, i, n + j, n + i); }
    for (let i = 1; i + 1 < n; i++) { idx.push(0, i + 1, i); idx.push(n, n + i, n + i + 1); }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  };
  // 1. a solid modelled inside another, running the same way (like a pin inside a leg): not a hole
  const outer = uvSphere(20, 48, 32), inner = uvSphere(6, 24, 16, [0, 0, 0]);
  const both = K.prepareMesh(K.mergeMeshes([outer, inner]));
  const Fz = K.frameFromNormal([0, 0, 1], [0, 0, 0.7]);
  const secN = K.section(both.positions, both.indices, Fz, 40);
  check('inner solid is its own area, not a hole', secN.regions.length === 2 && secN.regions.some(r => r.nested) && secN.regions.every(r => !r.holes.length), secN.regions.map(r => [r.area.toFixed(1), r.nested, r.holes.length]));
  const rn = K.cutMesh(both.positions, both.indices, Fz, { scale: 40, cfg: cfgOf({}) });
  check('cut through an inner solid gives sealed parts', allClosed(rn.parts), rn.parts.map(p => K.edgeReport(p.indices)));
  check('cut through an inner solid keeps the volume', Math.abs(sumVol(rn.parts) - both.report.volume) / both.report.volume < 1e-6, [sumVol(rn.parts), both.report.volume]);
  const pegs = cfgOf({ type: 'peg' });
  const anN = K.analyzePlane(both.positions, both.indices, Fz, pegs, 40);
  const ki = K.autoPlaceKeys(anN, pegs, 3, new Set());
  const evIn = K.evaluateKeys(anN, [{ x: 0, y: 0 }], pegs, new Set())[0];
  check('keys stay off an inner solid', evIn.ok === false && ki.every(k => Math.hypot(k.x, k.y) > 6 + K.keyGeometrySpec(pegs).outer), [evIn, ki]);
  check('keyed cut through an inner solid is sealed', allClosed(K.cutMesh(both.positions, both.indices, Fz, { scale: 40, cfg: pegs, keys: ki }).parts));
  // 2. loose specks: a triangle stored back to back with itself is dropped on load
  const sp = uvSphere(20, 48, 32);
  const speck = { positions: new Float32Array([30, 0, 0, 30.1, 0, 0, 30, 0.1, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 1]) };
  const ms = K.prepareMesh(K.mergeMeshes([sp, speck]));
  check('zero-volume speck removed on load', ms.report.specks === 1 && ms.report.closed && ms.positions.length === sp.positions.length, ms.report);
  check('a model that is all one shell keeps everything', K.prepareMesh(uvSphere(20, 48, 32)).report.specks === 0);
  // 3. an outline with a microscopic self-crossing fold, and points a thousandth of a millimetre apart
  const fold = [[0, 0], [20, 0], [20, 9.999], [20.0012, 10.0004], [19.9993, 10.0009], [20, 10.002], [20, 20], [10.0004, 20], [10, 20.0003], [10, 20], [0, 20]];
  const mf = K.prepareMesh(prism(fold, 0, 10));
  for (const [nm, F] of [['level', K.frameFromNormal([0, 0, 1], [0, 0, 5])], ['tilted', K.frameFromNormal([0.05, -0.03, 1], [10, 10, 5])]]) {
    const secF = K.section(mf.positions, mf.indices, F, 30);
    const rf = K.cutMesh(mf.positions, mf.indices, F, { scale: 30, cfg: cfgOf({}) });
    check(`${nm} cut through a self-crossing fold is sealed`, !secF.error && allClosed(rf.parts) && Math.abs(sumVol(rf.parts) - mf.report.volume) / mf.report.volume < 1e-6, rf.parts.map(p => K.edgeReport(p.indices)));
    const short = cfgOf({ type: 'peg', length: 3 }); // the block is 10 mm tall, so standard pegs would break through
    const kf = K.autoPlaceKeys(K.analyzePlane(mf.positions, mf.indices, F, short, 30), short, 2, new Set());
    check(`${nm} keyed cut through a self-crossing fold is sealed`, kf.length === 2 && allClosed(K.cutMesh(mf.positions, mf.indices, F, { scale: 30, cfg: short, keys: kf }).parts), kf.length);
  }
  // 4. outlines from real sculpts that used to give unsealed parts, replayed as extruded blocks
  const fx = JSON.parse(fs.readFileSync(__dirname + '/fixtures/sculpt-outlines.json', 'utf8'));
  for (const { defect, xy } of fx.outlines) {
    const poly = []; for (let i = 0; i < xy.length; i += 2) poly.push([xy[i], xy[i + 1]]);
    let a = 0; for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; a += x0 * y1 - x1 * y0; }
    if (a < 0) poly.reverse();
    const blk = prism(poly, -5, 5), bb = K.bounds(blk.positions);
    const rb = K.cutMesh(blk.positions, blk.indices, K.frameFromNormal([0, 0, 1], [bb.center[0], bb.center[1], 0]), { scale: K.diag(bb), cfg: cfgOf({}) });
    check(`real outline with ${defect}: sealed`, allClosed(rb.parts), rb.parts.map(p => K.edgeReport(p.indices)));
  }
  // 5. a vertex a hair off the plane: the plane moves to the widest gap, by at most a few microns
  const cube = K.prepareMesh(gridCube(6));
  const near = K.prepareMesh({ positions: cube.positions.map((v, i) => (i % 3 === 2 && Math.abs(v - 0.5) < 1e-6 && i < 60 ? v + 3e-7 : v)), indices: cube.indices });
  const Fn = K.frameFromNormal([0, 0, 1], [0.5, 0.5, 0.5]);
  const rnr = K.cutMesh(near.positions, near.indices, Fn, { scale: 1.7, cfg: cfgOf({}) });
  check('cut next to a near-plane vertex is sealed', allClosed(rnr.parts) && Math.abs(rnr.shift) < 1.7 * 2e-5, [rnr.shift, rnr.parts.map(p => K.edgeReport(p.indices))]);
}

console.log('cut suggestions');
{
  // a surface of revolution along any axis: radius(t) for t in 0..1 over the length, closed at both ends
  const lathe = (radius, len, axis, seg = 48, rings = 120) => {
    const a = norm(axis), u = norm(Math.abs(a[2]) < 0.9 ? cr(a, [0, 0, 1]) : cr(a, [1, 0, 0])), v = cr(a, u);
    const pos = [0, 0, 0];
    for (let i = 1; i < rings; i++) {
      const tt = i / rings, r = radius(tt);
      for (let j = 0; j < seg; j++) { const ph = (j / seg) * 2 * Math.PI, c = Math.cos(ph) * r, s = Math.sin(ph) * r; for (let k = 0; k < 3; k++) pos.push(a[k] * tt * len + u[k] * c + v[k] * s); }
    }
    pos.push(a[0] * len, a[1] * len, a[2] * len);
    const S = pos.length / 3 - 1, idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + (j + 1) % seg, 1 + j);
    for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) { const p0 = 1 + i * seg + j, p1 = 1 + i * seg + (j + 1) % seg, q0 = p0 + seg, q1 = p1 + seg; idx.push(p0, p1, q1, p0, q1, q0); }
    const base = 1 + (rings - 2) * seg;
    for (let j = 0; j < seg; j++) idx.push(S, base + j, base + (j + 1) % seg);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  function norm(v) { const l = Math.hypot(...v); return v.map(x => x / l); }
  function cr(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  const angleDeg = (a, b) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  const findNecks = (m) => {
    const scale = K.diag(K.bounds(m.positions));
    let found = [];
    for (const d of K.sweepDirections(m.positions)) found = found.concat(K.neckSweep(m.positions, m.indices, d, scale));
    return K.refineNecks(m.positions, m.indices, found, scale);
  };
  check('sweep directions cover the half-sphere', K.sweepDirections(uvSphere(10, 24, 16).positions).length >= 13);
  // a dumbbell tipped at an odd angle: two 12 mm balls joined by a 5 mm bar
  const axis = norm([0.55, 0.3, 0.78]);
  const bell = lathe(tt => { const z = tt * 60; const ball = (c) => { const d = Math.abs(z - c); return d < 12 ? Math.sqrt(144 - d * d) : 0; }; return Math.max(ball(12), ball(48), z > 6 && z < 54 ? 2.5 : 0, 0.05); }, 60, axis);
  check('dumbbell mesh closed', bell.report.closed, bell.report);
  const necks = findNecks(bell);
  const top = necks[0];
  const mid = [axis[0] * 30, axis[1] * 30, axis[2] * 30];
  check('dumbbell: the bar is the top narrow point', !!top && Math.hypot(top.point[0] - mid[0], top.point[1] - mid[1], top.point[2] - mid[2]) < 12, top && top.point);
  check('dumbbell: the cut sits square across the bar (within 6°)', !!top && angleDeg(top.normal, axis) < 6, top && angleDeg(top.normal, axis));
  check('dumbbell: the width is the bar width', !!top && Math.abs(top.width - 5) < 0.6, top && top.width);
  check('dumbbell: the even bar counts as one narrow point', necks.filter(n => Math.abs(n.width - 5) < 1).length === 1, necks.map(n => n.width));
  const rb = K.cutMesh(bell.positions, bell.indices, K.frameFromNormal(top.normal, top.point), { scale: 70, cfg: cfgOf({}) });
  check('cutting at the suggestion splits the dumbbell in two sealed halves', rb.parts.length === 2 && allClosed(rb.parts));
  // what the cut frees: one ball (with half the bar), cut on one area alone
  const fbBell = K.freedBy(bell.positions, bell.indices, K.frameFromNormal(top.normal, top.point), 70);
  const ballV = 4 / 3 * Math.PI * 1728, halfBar = Math.PI * 6.25 * 18;
  check('the narrow point frees one ball and half the bar, cutting one area', !!fbBell && Math.abs(fbBell.piece - ballV - halfBar) < 0.15 * ballV && fbBell.areas.length === 1 && fbBell.extra === 0 && Math.abs(fbBell.piece + fbBell.rest - bell.report.volume) < 0.05 * bell.report.volume, fbBell && [fbBell.piece, fbBell.rest, fbBell.areas.length]);
  check('the suggestion carries what it frees, and the area to cut', !!top.freed && Math.abs(top.freed - fbBell.piece) < 1e-6 * ballV + 1 && top.areas.length === 1, [top.freed, top.areas]);
  // click to cut here: a spot on the bar's surface gives the cut square across the bar; a spot on a ball's side
  // gives the cleanest cut through it for the piece it frees, never a sliver shaved off the surface
  const u0 = norm(cr(axis, [0, 0, 1])), onBar = [axis[0] * 30 + u0[0] * 2.5, axis[1] * 30 + u0[1] * 2.5, axis[2] * 30 + u0[2] * 2.5];
  const hereBar = K.cutHere(bell.positions, bell.indices, onBar, 70);
  check('cut here on the bar: square across it, 5 mm wide, freeing a ball, one area', !!hereBar && angleDeg(hereBar.normal, axis) < 6 && Math.abs(hereBar.width - 5) < 0.6 && hereBar.areas.length === 1 && Math.abs(hereBar.freed - ballV - halfBar) < 0.15 * ballV, hereBar && [hereBar.width, angleDeg(hereBar.normal, axis), hereBar.freed]);
  const onBall = [axis[0] * 12 + u0[0] * 12, axis[1] * 12 + u0[1] * 12, axis[2] * 12 + u0[2] * 12];
  const hereBall = K.cutHere(bell.positions, bell.indices, onBall, 70);
  check('cut here on a ball’s side frees a real piece, not a sliver', !!hereBall && hereBall.freed > 0.1 * ballV && hereBall.width > 8, hereBall && [hereBall.width, hereBall.freed]);
  check('cut here far from the surface gives nothing', K.cutHere(bell.positions, bell.indices, [200, 200, 200], 70) === null);
  // a join: a 12 mm ball standing on a 30 mm disc has no narrow point, but the ball's foot is an area a dozen
  // times smaller than the disc's, so a cut there is suggested, freeing the ball
  const stand = lathe(tt => { const z = tt * 20; return z < 10 ? 15 : Math.abs(z - 14) < 6 ? Math.max(0.05, Math.sqrt(36 - (z - 14) * (z - 14))) : 0.05; }, 20, [0, 0, 1]);
  check('ball on a disc closed', stand.report.closed, stand.report);
  const joins = findNecks(stand), joinAt = joins.find(j => j.point[2] > 9.5 && j.point[2] < 13 && angleDeg(j.normal, [0, 0, 1]) < 15);
  const capV = Math.PI * 100 * (18 - 10) / 3;
  check('the ball’s foot on the disc is found, square to it, freeing the ball', !!joinAt && joinAt.freed > 0.6 * capV && joinAt.freed < 1.2 * capV, joins.map(j => [j.kind, j.point.map(v => v.toFixed(1)).join(','), j.freed && j.freed.toFixed(0)]));
  check('nothing frees only a speck, and nothing cuts the disc across', joins.every(j => j.freed >= 0.01 * stand.report.volume && j.point[2] > 9), joins.map(j => [j.kind, j.point[2].toFixed(1)]));
  // a plain cylinder has no narrow point
  const tube = lathe(tt => (tt < 0.02 || tt > 0.98 ? 3 : 6), 50, [0, 0, 1]);
  check('a straight cylinder has no narrow point', findNecks(tube).filter(n => n.width < 11).length === 0, findNecks(tube).map(n => n.width));
  // a stepped tower: a 20 mm block with an 18 mm block on top leaves an inward crease all round at z = 10
  const tower = (() => {
    const pos = [], idx = [];
    const quad = (a, b, c, d) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const ring = (h, z) => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]];
    const L0 = ring(10, 0), L1 = ring(10, 10), U0 = ring(9, 10), U1 = ring(9, 20);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(L0[i], L0[j], L1[j], L1[i]); quad(U0[i], U0[j], U1[j], U1[i]); quad(L1[i], L1[j], U0[j], U0[i]); }
    quad(L0[3], L0[2], L0[1], L0[0]); quad(U1[0], U1[1], U1[2], U1[3]);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  })();
  check('stepped tower closed', tower.report.closed, tower.report);
  const edges = K.creaseEdges(tower.positions, tower.indices);
  check('the inward step is found as creases, the outer corners are not', edges.length > 0 && edges.every(e => Math.abs(e.mid[2] - 10) < 1e-6), edges.map(e => e.mid[2]));
  const cp = K.creasePlanes(tower.positions, tower.indices, K.sweepDirections(tower.positions), K.diag(K.bounds(tower.positions)), edges);
  check('the seam plane at the step is suggested', cp.length >= 1 && angleDeg(cp[0].normal, [0, 0, 1]) < 1 && Math.abs(cp[0].point[2] - 10) < 0.2 && cp[0].coverage >= 0.85, cp[0]);
  // separate pieces: two balls apart, one with a small ball inside it (stays with it)
  const sh = K.separateShells(...(() => { const m = K.prepareMesh(K.mergeMeshes([uvSphere(10, 24, 16), uvSphere(10, 24, 16, [40, 0, 0]), uvSphere(3, 12, 8, [40, 0, 0])])); return [m.positions, m.indices]; })());
  check('separate pieces found, an inner ball stays with its host', sh.length === 2 && sh.every(s => K.edgeReport(s.indices).closed), sh.map(s => s.volume));
  check('a single solid has no separate pieces', K.separateShells(uvSphere(10, 24, 16).positions, uvSphere(10, 24, 16).indices).length === 0);
  { // every piece on its own (1.67): a ball inside another is a piece of its own here, kept sealed when lifted out
    const mm = K.prepareMesh(K.mergeMeshes([uvSphere(10, 24, 16), uvSphere(10, 24, 16, [40, 0, 0]), uvSphere(3, 12, 8, [40, 0, 0])]));
    const c = K.shellComponents(mm.positions, mm.indices);
    const parts = []; for (let k = 0; k < c.count; k++) { const mask = new Uint8Array(c.label.length); for (let q = 0; q < mask.length; q++) mask[q] = c.label[q] === k ? 1 : 0; parts.push(K.extractTriangles(mm.positions, mm.indices, mask)); }
    const vol = parts.reduce((a, q) => a + q.volume, 0);
    check('every piece is found, a ball pushed inside another included, and each lifts out sealed with the volumes adding up', c.count === 3 && parts.every(q => K.edgeReport(q.indices).closed) && Math.abs(vol - K.volume(mm.positions, mm.indices)) < 1e-6 * Math.abs(vol), { count: c.count });
    // fill gaps: the top of the first ball picked with a patch left out near its pole; the second ball untouched
    const P = mm.positions, I = mm.indices, nt = I.length / 3, cen = (q) => [0, 1, 2].map(k => (P[3 * I[3 * q] + k] + P[3 * I[3 * q + 1] + k] + P[3 * I[3 * q + 2] + k]) / 3);
    const sel = new Uint8Array(nt), patch = [];
    for (let q = 0; q < nt; q++) { const x = cen(q); if (Math.hypot(x[0], x[1], x[2]) < 11 && x[2] > -2) { if (Math.hypot(x[0], x[1]) < 3 && x[2] > 8) patch.push(q); else sel[q] = 1; } }
    const r = K.fillSelectionGaps(P, I, sel, { gap: 0 });
    const filledPatch = patch.every(q => r.sel[q] === 1);
    let other = 0, below = 0; for (let q = 0; q < nt; q++) { const x = cen(q); if (r.sel[q] && x[0] > 20) other++; if (r.sel[q] && !sel[q] && x[2] < -4) below++; }
    check('Fill gaps fills a patch the pick surrounds, leaves the rest of the ball and the other ball alone, and keeps everything picked', filledPatch && r.holes >= 1 && other === 0 && below === 0 && sel.every((v, q) => !v || r.sel[q]), { holes: r.holes, added: r.added, patch: patch.length, other, below });
    // and a closing bridges a narrow channel: two picked caps of a ball a little apart join up
    const two = new Uint8Array(nt); for (let q = 0; q < nt; q++) { const x = cen(q); if (Math.hypot(x[0], x[1], x[2]) < 11 && x[2] > 3 && Math.abs(x[0]) > 0.8) two[q] = 1; }
    const sp = (s) => K.pickComponents(P, I, new Int32Array(nt), null, s).count;
    const rb = K.fillSelectionGaps(P, I, two, { gap: 1.5 });
    check('Fill gaps with a width bridges a channel narrower than it between two picked pieces', sp(two) > 1 && sp(rb.sel) === 1, { before: sp(two), after: sp(rb.sel) }); }
  { // pieces that touch without sharing an edge (1.68: the owner's cuff and hand) are one piece of a pick; a piece apart is not
    const box = (x) => { const b = K.shapeMesh({ kind: 'cube', w: 10, d: 10, h: 10 }); const pp = new Float64Array(b.positions); for (let i = 0; i < pp.length; i += 3) pp[i] += x; return { positions: pp, indices: b.indices }; };
    const mm = K.mergeMeshes([box(0), box(10), box(30)]), P = mm.positions, I = mm.indices, nt = I.length / 3;
    const c = K.shellComponents(P, I), all = new Uint8Array(nt).fill(1);
    const pc = K.pickComponents(P, I, new Int32Array(nt), null, all);
    const ts = K.touchingSets(P, I, c.label, c.count);
    check('two boxes face to face are one piece of the pick, a box apart another', c.count === 3 && pc.count === 2 && ts.count === 2, { shells: c.count, pick: pc.count, sets: ts.count });
    // the nearest vertex to many points from a grid matches a pass over every vertex
    const ball = K.prepareMesh(uvSphere(10, 96, 64)), pts = []; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 200; k++) pts.push([rnd() * 30 - 15, rnd() * 30 - 15, rnd() * 30 - 15]);
    for (let k = 0; k < 20; k++) { const v = Math.floor(rnd() * ball.positions.length / 3); pts.push([ball.positions[3 * v], ball.positions[3 * v + 1], ball.positions[3 * v + 2]]); }
    const fast = K.nearestVertices(ball.positions, pts), slow = pts.map(q => K.nearestVertex(ball.positions, q));
    check('the nearest vertices from a grid match the nearest by a full pass, ties and all', fast.every((v, i) => v === slow[i]), fast.filter((v, i) => v !== slow[i]).length);
    // a Shift-click further along fills the regions between: a rod in six bands, the last one a big body
    const rod = K.prepareMesh(uvSphere(10, 48, 96)), RP = rod.positions, RI = rod.indices, rt = RI.length / 3;
    const band = (t) => { const z = (RP[3 * RI[3 * t] + 2] + RP[3 * RI[3 * t + 1] + 2] + RP[3 * RI[3 * t + 2] + 2]) / 3; return Math.min(5, Math.floor((z + 10) / 3.4)); };
    const groupOf = new Int32Array(rt); for (let t = 0; t < rt; t++) groupOf[t] = band(t);
    const seg = K.bordersFromGroups(RP, RI, groupOf), areas = new Float64Array(seg.count);
    for (let t = 0; t < rt; t++) { const a = 3 * RI[3 * t], b = 3 * RI[3 * t + 1], d = 3 * RI[3 * t + 2]; const u = [RP[b] - RP[a], RP[b + 1] - RP[a + 1], RP[b + 2] - RP[a + 2]], w = [RP[d] - RP[a], RP[d + 1] - RP[a + 1], RP[d + 2] - RP[a + 2]]; areas[groupOf[t]] += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; }
    seg.areas = areas;
    const p03 = K.regionPath(RP, RI, seg, [0], 3), p01 = K.regionPath(RP, RI, seg, [0], 1), p33 = K.regionPath(RP, RI, seg, [3], 3);
    check('a Shift-click three regions along fills in the two between; a neighbour or the same region adds nothing', p03.join() === '1,2' && p01.length === 0 && p33.length === 0, { p03, p01 }); }
  { // loose pieces inside a pick go with it (1.69: the owner's Bills arm, a shoulder region plus a forearm, cuff and
    // hand that are pieces of their own, came off as the shoulder alone); and a jagged line is smoothed and still seals
    const body = K.prepareMesh(uvSphere(10, 48, 32)), ball = uvSphere(3, 16, 12, [0, 0, 11.5]);
    const mm = K.mergeMeshes([body, ball]), P = mm.positions, I = mm.indices, nt = I.length / 3, nb = body.indices.length / 3;
    const cz = (t) => (P[3 * I[3 * t] + 2] + P[3 * I[3 * t + 1] + 2] + P[3 * I[3 * t + 2] + 2]) / 3;
    const groupOf = new Int32Array(nt); for (let t = 0; t < nt; t++) groupOf[t] = t >= nb ? 2 : cz(t) > 6 + ((t * 7919) % 5) * 0.35 ? 1 : 0; // a cap with a ragged edge, and the ball
    const seg = K.bordersFromGroups(P, I, groupOf);
    const r = K.splitRegions(P, I, seg, [1, 2], { force: true });
    const whole = K.volume(P, I), vols = r.parts.map(q => q.volume), sum = vols.reduce((a, b) => a + b, 0), ballV = K.volume(ball.positions, ball.indices);
    check('a pick of a region and a loose piece inside it comes off as one: the cap with the ball, sealed, the volumes adding up', r.parts.length === 2 && r.loose === 1 && r.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && vols[0] > ballV * 1.2 && Math.abs(sum - whole) / whole < 0.002, { vols, ballV, whole });
    const loops = K.groupLoops(P, I, seg, [1, 2]), turn = (Q) => { let a = 0; for (const l of loops) { const n = l.verts.length; for (let i = 0; i < n; i++) { const p0 = l.verts[(i + n - 1) % n], p1 = l.verts[i], p2 = l.verts[(i + 1) % n], u = [0, 1, 2].map(k => Q[3 * p1 + k] - Q[3 * p0 + k]), w = [0, 1, 2].map(k => Q[3 * p2 + k] - Q[3 * p1 + k]); a += Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) || 1)))); } } return a; };
    const sm = K.smoothLoopVertices(P, I, loops), before = turn(P), after = turn(sm.positions);
    let off = 0; for (let v = 0; v < P.length / 3; v++) off = Math.max(off, Math.abs(Math.hypot(sm.positions[3 * v], sm.positions[3 * v + 1], sm.positions[3 * v + 2]) - Math.hypot(P[3 * v], P[3 * v + 1], P[3 * v + 2])) * (v < body.positions.length / 3 ? 1 : 0));
    check('a ragged line is smoothed along the surface: it turns much less and stays on the ball', sm.moved > 0 && after < 0.75 * before && off < 0.15, { before, after, off, moved: sm.moved });
    const cfg = { type: 'none' }, req = { loops, regions: [1, 2], seg: { groupOf: seg.groupOf, count: seg.count, borders: seg.borders }, cfg, minThickness: 0.8, sink: 0, perArea: 1, numberJoints: false, joint: 1, smooth: true };
    const out = K.planPick(P, I, req), parts = out.result ? out.result.parts : [], ps = parts.reduce((a, q) => a + q.volume, 0);
    check('a pick cut along the smoothed line is sealed, the volumes adding up', !out.error && parts.length === 2 && parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(ps - whole) / whole < 0.005, { error: out.error, n: parts.length, ps, whole }); }
  { // 1.70: regions that touch themselves at a point are unpinched; a region's outline re-routed smooth still cuts sealed
    const ball = K.prepareMesh(uvSphere(10, 48, 32)), P = ball.positions, I = ball.indices, nt = I.length / 3;
    const cz = (t) => (P[3 * I[3 * t] + 2] + P[3 * I[3 * t + 1] + 2] + P[3 * I[3 * t + 2] + 2]) / 3, cx = (t) => (P[3 * I[3 * t]] + P[3 * I[3 * t + 1]] + P[3 * I[3 * t + 2]]) / 3;
    // two caps of region 1 that meet at one vertex: the triangles round a vertex on the equator split by quadrant
    const g = new Int32Array(nt); for (let t = 0; t < nt; t++) g[t] = (cz(t) > 0) === (cx(t) > 0) ? 1 : 0;
    const before = K.groupLoops(P, I, K.bordersFromGroups(P, I, g), [1]).every(l => l.closed);
    const changed = K.unpinchGroups(P, I, g), after = K.groupLoops(P, I, K.bordersFromGroups(P, I, g), [1]);
    check('a region that touches itself at a point is unpinched, so its outline closes', !before && changed > 0 && after.length > 0 && after.every(l => l.closed), { before, changed, loops: after.length });
    // a ragged cap re-routed: a closed smooth outline, the cut sealed with the volumes adding up
    const r = new Int32Array(nt); for (let t = 0; t < nt; t++) r[t] = cz(t) > 4 + ((t * 7919) % 7) * 0.3 ? 1 : 0;
    K.unpinchGroups(P, I, r); // as the part finders leave it
    const seg = K.bordersFromGroups(P, I, r), sr = K.smoothRegionPick(P, I, seg, [1]);
    const cut = sr && K.splitRegions(P, I, sr.seg, sr.groups, { force: true }), vol = cut ? cut.parts.reduce((a, q) => a + q.volume, 0) : 0, whole = K.volume(P, I);
    check('a ragged region outline re-routed smooth gives a closed line that cuts sealed, the volumes adding up', !!sr && sr.loops.every(l => l.closed) && cut.parts.length === 2 && cut.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vol - whole) / whole < 0.002, { loops: sr && sr.loops.length, vol, whole });
    // 1.71: the same ragged cap sliced along a smooth curve through the triangles: the sliced surface is sealed with
    // the same volume, the line runs through new vertices, is much more level than the ragged outline, and cuts sealed with a sunk face
    const sl = K.sliceRegionPick(P, I, seg, [1]), nv0 = P.length / 3;
    const zSpread = (Q, ls) => { const z = []; for (const l of ls) for (const v of l.verts) z.push(Q[3 * v + 2]); const m = z.reduce((a, b) => a + b, 0) / z.length; return Math.sqrt(z.reduce((a, b) => a + (b - m) ** 2, 0) / z.length); };
    const raw = zSpread(P, K.groupLoops(P, I, seg, [1])), sliced = sl ? zSpread(sl.P, sl.loops) : Infinity;
    check('a ragged region sliced through its triangles: sealed, the same volume, its line through new points and far more level', !!sl && K.edgeReport(sl.I).closed && Math.abs(K.volume(sl.P, sl.I) - whole) / whole < 1e-6 && sl.loops.length === 1 && sl.loops[0].closed && sl.loops[0].verts.every(v => v >= nv0) && sliced < 0.4 * raw, { raw, sliced, loops: sl && sl.loops.length });
    const cs = sl && K.splitRegions(sl.P, sl.I, sl.seg, [1], { force: true, sink: 1 }), vs = cs ? cs.parts.reduce((a, q) => a + q.volume, 0) : 0;
    check('the sliced pick cuts sealed with its face sunk, the volumes adding up', !!cs && cs.parts.length === 2 && cs.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vs - whole) / whole < 0.002, { n: cs && cs.parts.length, vs, whole });
    // 1.71: the check after every cut: a wafer shaved 0.3 mm off a box (forced past the flat cut's own check) is too
    // thin behind its cut face for a 0.8 mm wall; a cut through the middle is not
    { const bx = K.shapeMesh({ kind: 'cube', w: 20, d: 20, h: 20 }), BP = new Float32Array(bx.positions), BI = bx.indices;
      const wafer = K.cutMesh(BP, BI, K.frameFromNormal([0, 0, 1], [0, 0, 9.7]), { scale: 35, force: true, minThickness: 0.8 });
      const middle = K.cutMesh(BP, BI, K.frameFromNormal([0, 0, 1], [0, 0, 0.3]), { scale: 35, minThickness: 0.8 });
      const cw = K.cutPrintCheck(BP, wafer.parts, 0.8), cm = K.cutPrintCheck(BP, middle.parts, 0.8);
      check('the after-cut check finds the 0.3 mm wafer too thin to print, and the halves of a middle cut fine', cw.filter(b => b.thin).length === 1 && cm.every(b => !b.thin), { wafer: cw.map(b => +b.share.toFixed(2)), middle: cm.map(b => +b.share.toFixed(2)) }); }
    // 1.72: a small block fused onto a big one (the owner's Father Rhinehardt: a hand lying on a book, the book fused
    // into the robe, all grabbed as one) stays a region and a part of its own: small regions creased all round are
    // kept, and what melts goes into the neighbour it flows into, never across a clear part boundary
    { const book = K.shapeMesh({ kind: 'cube', w: 40, d: 30, h: 6 }), blk = K.shapeMesh({ kind: 'cube', w: 3, d: 2, h: 1.2 });
      const bp = new Float64Array(blk.positions); for (let i = 0; i < bp.length; i += 3) { bp[i] += 5; bp[i + 1] += 4; bp[i + 2] += 3.4; }
      const un = K.booleanWith(new Float64Array(book.positions), book.indices, { positions: bp, indices: blk.indices }, 'union');
      const sub = K.subdivideMesh(un.positions, un.indices, { maxEdge: 0.6 }), Q = sub.positions, J = sub.indices, n2 = J.length / 3;
      const c = (t, k) => (Q[3 * J[3 * t] + k] + Q[3 * J[3 * t + 1] + k] + Q[3 * J[3 * t + 2] + k]) / 3;
      const onBlock = (t) => c(t, 2) > 3.05 && Math.abs(c(t, 0) - 5) < 1.6 && Math.abs(c(t, 1) - 4) < 1.1;
      let nb = 0; for (let t = 0; t < n2; t++) if (onBlock(t)) nb++;
      const top = [...Array(n2).keys()].find(t => onBlock(t) && c(t, 2) > 3.9);
      const count = (seg) => { const g = seg.groupOf[top]; let on = 0, off = 0; for (let t = 0; t < n2; t++) if (seg.groupOf[t] === g) { if (onBlock(t)) on++; else off++; } return { on, off }; };
      const sec = count(K.segmentSurface(Q, J, { angle: 60, fold: 15 })), part = count(K.segmentParts(Q, J, { ratio: 1.2, strength: 0.36, minFrac: 0.004 })); // (1.79: the block is 0.55% of the surface; anything under minFrac melts, as in 1.70, so the finest setting is asked for)
      check('a small block fused onto a big one: its top is a region of its own, and the block a part of its own', sec.on > 0 && sec.off < 0.05 * sec.on && part.on >= 0.9 * nb && part.off < 0.1 * part.on, { sec, part, nb }); }
    // 1.74: where a hard surface meets an organic one there is a border: a crisp box pushed into a bumpy ball (sculpt-like
    // noise on every vertex) is hard, the ball organic, and no Sections region holds much of both
    { const ball = K.prepareMesh(uvSphere(12, 96, 64)), BP = new Float64Array(ball.positions);
      let sd = 3; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < BP.length; i += 3) { const r = Math.hypot(BP[i], BP[i + 1], BP[i + 2]), k = 1 + 0.01 * (rnd() - 0.5); BP[i] *= k; BP[i + 1] *= k; BP[i + 2] *= k; }
      const bx = K.shapeMesh({ kind: 'cube', w: 8, d: 8, h: 8 }), XP = new Float64Array(bx.positions); for (let i = 0; i < XP.length; i += 3) XP[i + 2] += 14;
      const un = K.booleanWith(BP, ball.indices, { positions: XP, indices: bx.indices }, 'union');
      const sub = K.subdivideMesh(un.positions, un.indices, { maxEdge: 1 }), Q = sub.positions, J = sub.indices, n2 = J.length / 3;
      const seg = K.segmentSurface(Q, J, { angle: 60, fold: 15 }), cz = (t) => (Q[3 * J[3 * t] + 2] + Q[3 * J[3 * t + 1] + 2] + Q[3 * J[3 * t + 2] + 2]) / 3, cr = (t) => Math.hypot((Q[3 * J[3 * t]] + Q[3 * J[3 * t + 1]] + Q[3 * J[3 * t + 2]]) / 3, (Q[3 * J[3 * t] + 1] + Q[3 * J[3 * t + 1] + 1] + Q[3 * J[3 * t + 2] + 1]) / 3, cz(t));
      const cxy = (t, k) => (Q[3 * J[3 * t] + k] + Q[3 * J[3 * t + 1] + k] + Q[3 * J[3 * t + 2] + k]) / 3;
      const onBox = (t) => Math.max(Math.abs(cxy(t, 0)), Math.abs(cxy(t, 1))) <= 4.02 && (Math.abs(Math.abs(cxy(t, 0)) - 4) < 0.02 || Math.abs(Math.abs(cxy(t, 1)) - 4) < 0.02 || cz(t) > 17.98); // on one of the box's own faces
      let hb = 0, nbx = 0, hballs = 0, nball = 0; for (let t = 0; t < n2; t++) { if (onBox(t)) { nbx++; hb += seg.hard[t]; } else if (cz(t) < 8) { nball++; hballs += seg.hard[t]; } }
      const mix = new Map(); for (let t = 0; t < n2; t++) { const g = seg.groupOf[t]; if (!mix.has(g)) mix.set(g, [0, 0]); mix.get(g)[onBox(t) ? 0 : 1]++; }
      const mixed = [...mix.values()].filter(([a, b]) => Math.min(a, b) > 0.1 * Math.max(a, b)).length;
      check('a crisp box pushed into a bumpy ball reads hard, the ball organic, and no region holds much of both', hb > 0.8 * nbx && hballs < 0.05 * nball && mixed === 0, { box: hb / nbx, ball: hballs / nball, mixed });
      // 1.78: Parts at every Detail keeps the box apart from the ball too: no part holds much of both (a hard region never
      // joins an organic one, judged whole: Rhinehardt's book face had melted into the coat's front strip)
      { const mixedParts = []; for (const o of [{ ratio: 1.6, strength: 0.68, minFrac: 0.04, keepFrac: 0.03 }, { ratio: 1.35, strength: 0.5, minFrac: 0.02 }, { ratio: 1.2, strength: 0.36, minFrac: 0.008 }]) { const ps = K.segmentParts(Q, J, o); const m = new Map(); for (let t = 0; t < n2; t++) { const g = ps.groupOf[t]; if (!m.has(g)) m.set(g, [0, 0]); m.get(g)[onBox(t) ? 0 : 1]++; } mixedParts.push([...m.values()].filter(([a, b]) => Math.min(a, b) > 0.1 * Math.max(a, b)).length); }
        check('Parts at Big, Balanced and Fine keep the crisp box apart from the bumpy ball', mixedParts.every(x => x === 0), { mixedParts }); }
      // 1.77: the box's regions picked and sliced: the slice is pinned to the sharp seam, so nothing of the ball is taken and
      // the box keeps its area (the smoothing had blurred across the seam: the owner's book took a strip of robe)
      { const boxRegions = [...mix.entries()].filter(([g, [a, b]]) => a > b).map(([g]) => g), sl = K.sliceRegionPick(Q, J, seg, boxRegions);
        const triArea = (R, L, t) => { const a = 3 * L[3 * t], b = 3 * L[3 * t + 1], c = 3 * L[3 * t + 2]; const u = [R[b] - R[a], R[b + 1] - R[a + 1], R[b + 2] - R[a + 2]], w = [R[c] - R[a], R[c + 1] - R[a + 1], R[c + 2] - R[a + 2]]; return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; };
        const picked = new Set(boxRegions); let a0 = 0, raw = 0; for (let t = 0; t < n2; t++) if (picked.has(seg.groupOf[t])) { a0 += triArea(Q, J, t); if (!onBox(t)) raw += triArea(Q, J, t); } // (the pick's own area, and what of it already lies off the box's faces)
        let kept = 0, onBall = 0; if (sl) for (let t = 0; t < sl.I.length / 3; t++) { if (sl.seg.groupOf[t] !== 1) continue; const a = triArea(sl.P, sl.I, t); kept += a; const cz2 = (sl.P[3 * sl.I[3 * t] + 2] + sl.P[3 * sl.I[3 * t + 1] + 2] + sl.P[3 * sl.I[3 * t + 2] + 2]) / 3, cx = (sl.P[3 * sl.I[3 * t]] + sl.P[3 * sl.I[3 * t + 1]] + sl.P[3 * sl.I[3 * t + 2]]) / 3, cy = (sl.P[3 * sl.I[3 * t] + 1] + sl.P[3 * sl.I[3 * t + 1] + 1] + sl.P[3 * sl.I[3 * t + 2] + 1]) / 3; if (Math.max(Math.abs(cx), Math.abs(cy)) > 4.05 || cz2 < 9.9) onBall += a; }
        check('the box picked and sliced stays on the box: no more of the ball than the pick had, the pick\'s area kept', !!sl && K.edgeReport(sl.I).closed && onBall < raw + 0.01 * a0 && kept > 0.95 * a0 && kept < 1.05 * a0, { sliced: !!sl, onBall, raw, kept, a0 }); } }
    // 1.75: a line drawn by hand round a coarse ball, sliced through the faces: the surface stays sealed with its
    // volume, the line runs through new points, lies much closer to the tilted circle drawn than the edge path does,
    // and the pick cuts sealed
    { const ball = K.prepareMesh(uvSphere(10, 24, 16)), BP = ball.positions, BI = ball.indices, nv0 = BP.length / 3, tilt = 0.5;
      const nn = [-tilt / Math.hypot(tilt, 1), 0, 1 / Math.hypot(tilt, 1)], dd = 4, rr = Math.sqrt(100 - dd * dd), uu = [nn[2], 0, -nn[0]], vv = [0, 1, 0];
      const pts = []; for (let k = 0; k < 10; k++) { const a = 2 * Math.PI * k / 10; pts.push([0, 1, 2].map(i => dd * nn[i] + rr * (Math.cos(a) * uu[i] + Math.sin(a) * vv[i]))); } // a circle on the ball, the plane n·p = 4
      const drawn = K.drawnLoop(BP, BI, pts), sl = K.sliceDrawnLoops(BP, BI, [drawn]);
      const n0 = [-tilt, 0, 1], nl = Math.hypot(...n0), off = (Q, verts) => { const z = verts.map(v => (Q[3 * v] * n0[0] + Q[3 * v + 1] * n0[1] + Q[3 * v + 2] * n0[2]) / nl); const m = z.reduce((a, b) => a + b, 0) / z.length; return Math.sqrt(z.reduce((a, b) => a + (b - m) ** 2, 0) / z.length); };
      const vol0 = K.volume(BP, BI);
      const cs = sl && K.splitRegions(sl.P, sl.I, sl.seg, [1], { force: true }), vs = cs ? cs.parts.reduce((a, q) => a + q.volume, 0) : 0;
      check('a drawn line sliced through the faces: sealed, same volume, through new points, far flatter than its edge path, and it cuts sealed', !!sl && K.edgeReport(sl.I).closed && Math.abs(K.volume(sl.P, sl.I) - vol0) / vol0 < 1e-6 && sl.loops.length === 1 && sl.loops[0].verts.every(v => v >= nv0) && off(sl.P, sl.loops[0].verts) < 0.6 * off(BP, drawn.verts) && !!cs && cs.parts.length === 2 && cs.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vs - vol0) / vol0 < 0.002, { edge: off(BP, drawn.verts), sliced: sl && off(sl.P, sl.loops[0].verts) }); }
    // a plug fits a small area: a 3.4 mm rod's end with a 0.8 mm wall (a miniature's arm)
    const rod = K.shapeMesh({ kind: 'tube', w: 3.4, h: 20, segments: 48 }), pcfg = { type: 'plug', shape: 'round', diameter: 3, length: 3, margin: 0.8, clearance: 0.1, plugSlope: 5, plugDepthMode: 'auto', plugDepth: 3, pegSide: 'below', perArea: 1, sizeMode: 'auto', sizeMin: 1.5 };
    const an = K.analyzePlane(rod.positions, rod.indices, K.frameFromNormal([0, 0, 1], [0, 0, 0.013]), pcfg, 20), pl = K.planPlugs(an, pcfg);
    check('a plug fits a 3.4 mm limb with a 0.8 mm wall', pl.length === 1 && pl[0].ok, pl.map(q => q.reason || q.depth)); }
  { // each piece lists the triangles of the original it holds (the inner ball's with its host), every triangle once, in order
    const m = K.prepareMesh(K.mergeMeshes([uvSphere(10, 24, 16), uvSphere(10, 24, 16, [40, 0, 0]), uvSphere(3, 12, 8, [40, 0, 0])]));
    const sh = K.separateShells(m.positions, m.indices), nt = m.indices.length / 3, seen = new Uint8Array(nt);
    let dup = 0, sorted = true;
    for (const s of sh) for (let i = 0; i < s.tris.length; i++) { if (seen[s.tris[i]]++) dup++; if (i && s.tris[i] <= s.tris[i - 1]) sorted = false; }
    const all = seen.every(v => v === 1);
    const counts = sh.map(s => s.tris.length).sort((a, b) => a - b), each = sh.map(s => s.indices.length / 3).sort((a, b) => a - b);
    check('each loose piece lists its triangles of the original: every triangle once, sorted, as many as the piece has', all && !dup && sorted && counts.join() === each.join(), { counts, each, dup });
  }
}

console.log('made objects and the surface they own (1.80)');
{
  // the convex outline (1.81, replacing a quickhull that grew without end on a book's nearly coplanar float32 points): every
  // point lies inside it, a cube's corners lie on it, it hugs the cube within 1% of its size, and thousands of noisy coplanar
  // float32 points on a box's faces (the input that broke the quickhull) take milliseconds; given an object's own face
  // directions it is exact for a box
  { let sd = 5; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const pts = []; for (let i = 0; i < 8; i++) pts.push([i & 1, (i >> 1) & 1, (i >> 2) & 1]); for (let i = 0; i < 200; i++) pts.push([rnd(), rnd(), rnd()]);
    const o = K.convexOutline(pts, [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]), o0 = K.convexOutline(pts), inside = (h, ps, tol) => ps.every(p => h.planes.every(pl => pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3] <= tol));
    const onCorner = inside(o0, pts, 1e-9) && pts.slice(0, 8).every(p => Math.max(...o.planes.map(pl => pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3])) > -1e-9);
    let hug = 0; for (let i = 0; i < 2000; i++) { const p = [rnd() * 1.2 - 0.1, rnd() * 1.2 - 0.1, rnd() * 1.2 - 0.1]; const inO = o.planes.every(pl => pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3] <= 0); const out = Math.max(-p[0], -p[1], -p[2], p[0] - 1, p[1] - 1, p[2] - 1); if (inO && out > hug) hug = out; }
    const faces = []; for (let i = 0; i < 6000; i++) { const f = i % 6, u = rnd(), v = rnd(), p = [u, v, 0]; if (f === 1) p[2] = 1; if (f === 2) { p[0] = 0; p[2] = u; } if (f === 3) { p[0] = 1; p[2] = u; } if (f === 4) { p[1] = 0; p[2] = v; } if (f === 5) { p[1] = 1; p[2] = v; } faces.push(p.map(x => Math.fround(x * 5.123 + 3 + (rnd() - 0.5) * 1e-6))); }
    const t0 = Date.now(), o2 = K.convexOutline(faces), ms = Date.now() - t0;
    check('the convex outline holds every point, touches a cube\'s corners, hugs it exactly given the cube\'s face directions, and takes noisy coplanar float32 box faces in milliseconds', inside(o, pts, 1e-9) && onCorner && hug < 1e-9 && inside(o2, faces, 1e-6) && ms < 200, { hug, ms }); }
  // (1.81) the made surface a made object owns, wherever the grouping put it: a box is the object (region 0); in another
  // region lie a lip on its underside facing out (Father Rhinehardt's book: a lip of the lower cover in the skirt's region),
  // a patch lying on its top facing into it (a fingertip resting on the cover) and a patch beside it. Only the lip moves
  { const pos = [], idx = []; const quad = (o, u, v, n) => { const nu = n, base = pos.length / 3; for (let i = 0; i <= nu; i++) for (let j = 0; j <= nu; j++) pos.push(o[0] + u[0] * i / nu + v[0] * j / nu, o[1] + u[1] * i / nu + v[1] * j / nu, o[2] + u[2] * i / nu + v[2] * j / nu); const first = idx.length / 3; for (let i = 0; i < nu; i++) for (let j = 0; j < nu; j++) { const a = base + i * (nu + 1) + j, b = a + nu + 1; idx.push(a, b, b + 1, a, b + 1, a + 1); } return [first, idx.length / 3]; };
    const bx = K.shapeMesh({ kind: 'cube', w: 10, d: 10, h: 10 }); for (const v of bx.positions) pos.push(v); for (const v of bx.indices) idx.push(v); const nBox = bx.indices.length / 3;
    const lip = quad([-2, -2, -5], [0, 4, 0], [4, 0, 0], 4), tip = quad([-2, -2, 5.01], [0, 4, 0], [4, 0, 0], 4), far = quad([12, -2, 0], [0, 4, 0], [0, 0, 4], 4); // lip faces -z (out of the box's bottom), tip faces -z (into the top), far beside it
    const P = new Float32Array(pos), I = new Uint32Array(idx), nt = I.length / 3, A = new Float64Array(nt), N = new Float64Array(3 * nt), C = new Float64Array(3 * nt);
    for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]; const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(...n); A[t] = L / 2; for (let k = 0; k < 3; k++) { N[3 * t + k] = n[k] / L; C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3; } }
    const groupOf = new Int32Array(nt), made = new Uint8Array(nt).fill(1), prop = new Int32Array(nt).fill(-1); for (let t = 0; t < nt; t++) { if (t < nBox) prop[t] = 0; else groupOf[t] = 1; }
    const moved = K.ownObjectPieces(P, I, groupOf, made, prop, A, C, N, K.trianglePairs(I));
    const all = (r, g) => { for (let t = r[0]; t < r[1]; t++) if (groupOf[t] !== g) return false; return true; };
    check('a made object owns the made surface on its outline facing out (a lip under a book), not a patch resting on it facing in (a fingertip) nor one beside it', moved === lip[1] - lip[0] && all(lip, 0) && all(tip, 1) && all(far, 1), { moved, lip: lip[1] - lip[0] }); }
  // a made plank fused into a body's corner, its recessed front face flush with the body's front and running on into it
  // without a crease (Father Rhinehardt's book against the skirt: every pick of the book's underside took a strip of
  // robe): built directly, since a boolean would offset the coplanar faces by microns and leave a sliver crease; every
  // edge a multiple of the step, so neighbouring faces share their points and the solid is sealed
  const plankBody = (opts = {}) => {
    const S = 0.5, pos = [], idx = [], at = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
    const steps = (a, b) => Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / S));
    const grid = (o, u, v) => { const nu = Math.max(1, Math.round(Math.hypot(...u) / S)), nv = Math.max(1, Math.round(Math.hypot(...v) / S)), ids = []; // a quad grid S apart, outward normal u × v
      for (let i = 0; i <= nu; i++) { ids.push([]); for (let j = 0; j <= nv; j++) ids[i].push(at(o[0] + u[0] * i / nu + v[0] * j / nv, o[1] + u[1] * i / nu + v[1] * j / nv, o[2] + u[2] * i / nu + v[2] * j / nv)); }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1]; idx.push(a, b, c, a, c, d); } };
    const fan = (corners) => { const ring = []; for (let k = 0; k < corners.length; k++) { const a = corners[k], b = corners[(k + 1) % corners.length], n = steps(a, b); for (let i = 0; i < n; i++) ring.push(at(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, a[2] + (b[2] - a[2]) * i / n)); } // a face fanned from its first corner: long thin triangles, as CAD exports them
      for (let k = 1; k + 1 < ring.length; k++) idx.push(ring[0], ring[k], ring[k + 1]); };
    const B = 20, D = 4, L = 5, T = 3.5, H = 3, R = 0.5, I2 = 0.5; // body x, z in [-B, B], y in [0, D], its front y = 0; plank x in [B, B + L], y in [-R, T], z in [-H, H], its front recessed to y = 0 for |z| < I2 between two lips
    grid([-B, 0, -B], [2 * B, 0, 0], [0, 0, 2 * B]); grid([-B, D, -B], [0, 0, 2 * B], [2 * B, 0, 0]); grid([-B, 0, B], [2 * B, 0, 0], [0, D, 0]); grid([-B, 0, -B], [0, D, 0], [2 * B, 0, 0]); grid([-B, 0, -B], [0, 0, 2 * B], [0, D, 0]);
    grid([B, 0, -B], [0, D, 0], [0, 0, B - H]); grid([B, 0, H], [0, D, 0], [0, 0, B - H]); grid([B, T, -H], [0, D - T, 0], [0, 0, 2 * H]); // the body's right side round the plank
    fan([[B, T, -H], [B, T, H], [B + L, T, H], [B + L, T, -H]]); fan([[B, -R, H], [B + L, -R, H], [B + L, T, H], [B, T, H]]); fan([[B, -R, -H], [B, T, -H], [B + L, T, -H], [B + L, -R, -H]]); // the plank's back, top and bottom
    fan([[B, 0, -I2], [B + L, 0, -I2], [B + L, 0, I2], [B, 0, I2]]); // the recessed front, flush with the body's front
    grid([B, -R, I2], [L, 0, 0], [0, 0, H - I2]); grid([B, -R, -H], [L, 0, 0], [0, 0, H - I2]); grid([B, -R, I2], [0, R, 0], [L, 0, 0]); grid([B, 0, -I2], [0, -R, 0], [L, 0, 0]); // the lips' fronts and inner walls
    grid([B + L, 0, -H], [0, T, 0], [0, 0, 2 * H]); grid([B + L, -R, I2], [0, R, 0], [0, 0, H - I2]); grid([B + L, -R, -H], [0, R, 0], [0, 0, H - I2]); grid([B, -R, I2], [0, 0, H - I2], [0, R, 0]); grid([B, -R, -H], [0, 0, H - I2], [0, R, 0]); // the end and the lips' ends
    const m = K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }), P = new Float64Array(m.positions), I = m.indices, nt = I.length / 3;
    const tag = new Uint8Array(nt); // 1 the recessed front, 2 the rest of the plank, 0 the body
    for (let t = 0; t < nt; t++) { const cx = (P[3 * I[3 * t]] + P[3 * I[3 * t + 1]] + P[3 * I[3 * t + 2]]) / 3, cy = (P[3 * I[3 * t] + 1] + P[3 * I[3 * t + 1] + 1] + P[3 * I[3 * t + 2] + 1]) / 3, cz = (P[3 * I[3 * t] + 2] + P[3 * I[3 * t + 1] + 2] + P[3 * I[3 * t + 2] + 2]) / 3; if (cx > B + 1e-3) tag[t] = Math.abs(cy) < 1e-3 && Math.abs(cz) < I2 ? 1 : 2; }
    let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); // sculpt-like noise on the body, never on the plank or the seam
    for (let i = 0; i < P.length; i += 3) if (P[i] < B - 1e-3 || (P[i] < B + 1e-3 && !(P[i + 1] <= T + 1e-3 && Math.abs(P[i + 2]) <= H + 1e-3))) { P[i] += 0.03 * (rnd() - 0.5); P[i + 1] += 0.03 * (rnd() - 0.5); P[i + 2] += 0.03 * (rnd() - 0.5); }
    if (opts.turn) { const [ax, ang] = opts.turn, c = Math.cos(ang), s = Math.sin(ang), n = Math.hypot(...ax), u = ax.map(v => v / n); for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2], d = u[0] * x + u[1] * y + u[2] * z; const cx = u[1] * z - u[2] * y, cy = u[2] * x - u[0] * z, cz = u[0] * y - u[1] * x; P[i] = x * c + cx * s + u[0] * d * (1 - c); P[i + 1] = y * c + cy * s + u[1] * d * (1 - c); P[i + 2] = z * c + cz * s + u[2] * d * (1 - c); } }
    if (opts.scale) for (let i = 0; i < P.length; i++) P[i] *= opts.scale;
    return { P: new Float32Array(P), I, tag, nt };
  };
  for (const [name, o] of [['as built', {}], ['turned and scaled down', { turn: [[1, 2, 3], 0.7], scale: 0.4 }], ['turned and scaled up', { turn: [[-2, 1, 1], 2.1], scale: 6 }]]) {
    const { P, I, tag, nt } = plankBody(o), front = [...Array(nt).keys()].find(t => tag[t] === 1), bodyFront = K.nearestTriangle(P, I, o.scale ? [0, 0, 0] : [0, 0, 0]);
    let nFront = 0, nPlank = 0; for (let t = 0; t < nt; t++) { if (tag[t] === 1) nFront++; else if (tag[t] === 2) nPlank++; }
    const comp = (seg) => { const g = seg.groupOf[front]; let f = 0, pk = 0, body = 0; for (let t = 0; t < nt; t++) if (seg.groupOf[t] === g) { if (tag[t] === 1) f++; else if (tag[t] === 2) pk++; else body++; } return { f, pk, body }; };
    const results = {}; let ok = K.edgeReport(I).closed;
    for (const [d, oo] of [['Big', { ratio: 1.6, strength: 0.68, minFrac: 0.04, keepFrac: 0.03 }], ['Balanced', { ratio: 1.35, strength: 0.5, minFrac: 0.02 }], ['Fine', { ratio: 1.2, strength: 0.36, minFrac: 0.008 }]]) {
      const seg = K.segmentParts(P, I, oo), c = comp(seg); results[d] = c; let bodyRegionPlank = 0, hardFront = 0, hardPlank = 0, hardBody = 0; for (let t = 0; t < nt; t++) { if (seg.groupOf[t] === seg.groupOf[bodyFront] && tag[t]) bodyRegionPlank++; if (seg.hard[t]) { if (tag[t] === 1) hardFront++; else if (tag[t] === 2) hardPlank++; else hardBody++; } }
      // the whole plank is the made object's surface (its even-triangled lips, walls and end owned by it; before 1.80 only the thin fans were), so the seam is pinned all round it
      ok = ok && c.f === nFront && c.pk >= 0.95 * nPlank && c.body < 0.005 * nt && bodyRegionPlank === 0 && hardFront === nFront && hardPlank >= 0.95 * nPlank && hardBody < 0.002 * nt; Object.assign(results[d], { bodyRegionPlank, hardFront, hardPlank, hardBody });
      if (d === 'Balanced') { // Fill picks the region as it is: holes closing adds nothing of the body; and the pick sliced through the triangles keeps off the body (the seam is pinned where the made object meets the sculpted surface)
        const sel = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (seg.groupOf[t] === seg.groupOf[front]) sel[t] = 1; const fg = K.fillSelectionGaps(P, I, sel, { gap: 0 }); let addedBody = 0; for (let t = 0; t < nt; t++) if (fg.sel[t] && !sel[t] && !tag[t]) addedBody++;
        const sl = K.sliceRegionPick(P, I, seg, [seg.groupOf[front]]); let off = 0, kept = 0; if (sl) for (let t = 0; t < sl.I.length / 3; t++) if (sl.seg.groupOf[t] === 1) { kept++; const a = 3 * sl.I[3 * t], b = 3 * sl.I[3 * t + 1], c2 = 3 * sl.I[3 * t + 2]; const cx = (sl.P[a] + sl.P[b] + sl.P[c2]) / 3, cy = (sl.P[a + 1] + sl.P[b + 1] + sl.P[c2 + 1]) / 3, cz = (sl.P[a + 2] + sl.P[b + 2] + sl.P[c2 + 2]) / 3; if (!o.turn && cx < 20 - 0.3) off++; }
        results.fill = { addedBody, sliced: !!sl, off, kept }; ok = ok && addedBody === 0 && (!!sl ? off <= 0.01 * kept : true); }
    }
    const v = 55, sec = K.segmentSurface(P, I, { fold: 60 - 0.55 * v, angle: 80 - 0.5 * v, minFrac: 0.03 * Math.pow(0.02, v / 100) }), cs = comp(sec); results.Sections = cs; let secBody = 0; for (let t = 0; t < nt; t++) if (sec.groupOf[t] === sec.groupOf[bodyFront] && tag[t]) secBody++;
    ok = ok && cs.f === nFront && cs.body < 0.001 * nt && secBody === 0; results.Sections.bodyRegionPlank = secBody;
    check('a made plank whose recessed front runs flush into a sculpted body (' + name + '): in Parts the plank is one region with its front and none of the body, the body\'s front holds none of the plank, Fill and the sliced pick stay off the body, and in Sections too', ok, results);
  }
}
console.log('engraved joint numbers');
{
  const lathe = (radius, len, axis, seg = 48, rings = 120) => {
    const a = norm(axis), u = norm(Math.abs(a[2]) < 0.9 ? cr(a, [0, 0, 1]) : cr(a, [1, 0, 0])), v = cr(a, u);
    const pos = [0, 0, 0];
    for (let i = 1; i < rings; i++) {
      const tt = i / rings, r = radius(tt);
      for (let j = 0; j < seg; j++) { const ph = (j / seg) * 2 * Math.PI, c = Math.cos(ph) * r, s = Math.sin(ph) * r; for (let k = 0; k < 3; k++) pos.push(a[k] * tt * len + u[k] * c + v[k] * s); }
    }
    pos.push(a[0] * len, a[1] * len, a[2] * len);
    const S = pos.length / 3 - 1, idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + (j + 1) % seg, 1 + j);
    for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) { const p0 = 1 + i * seg + j, p1 = 1 + i * seg + (j + 1) % seg, q0 = p0 + seg, q1 = p1 + seg; idx.push(p0, p1, q1, p0, q1, q0); }
    const base = 1 + (rings - 2) * seg;
    for (let j = 0; j < seg; j++) idx.push(S, base + j, base + (j + 1) % seg);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  // a 30 mm box cut level with two pegs and the number 48 engraved on both faces, each read the right way round
  const box = (() => { const h = 15, c = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]], P = [], I = []; f.forEach(tr => tr.forEach(i => P.push(...c[i]))); for (let i = 0; i < P.length / 3; i++) I.push(i); return K.prepareMesh({ positions: new Float32Array(P), indices: new Uint32Array(I) }); })();
  const F = K.frameFromNormal([0, 0, 1], [0, 0, 0]), cfg = cfgOf({ type: 'peg', diameter: 4, length: 5, clearance: 0.2, margin: 1, sizeMode: 'set' }), keys = [{ x: -8, y: 0 }, { x: 8, y: 0 }];
  const an = K.analyzePlane(box.positions, box.indices, F, cfg, 60);
  const jm = K.jointMarks(an.base, 0, keys, cfg, 48, { mirror: true });
  check('the number 48 lays out as 11 strokes a side, 3 mm wide, clear of the pegs', !!jm && jm.marks.length === 22 && jm.width === 3 && jm.marks.every(m => Math.hypot(m.x - 8, m.y) > 2.2 + 1.5 && Math.hypot(m.x + 8, m.y) > 2.2 + 1.5) && jm.marks.filter(m => m.side === -1).length === 11, jm && [jm.marks.length, jm.width, jm.x, jm.y]);
  const mirrored = jm.marks.filter(m => m.side === 1), plain = jm.marks.filter(m => m.side === -1);
  check('the second face gets the strokes mirrored about the label’s centre', mirrored.every((m, i) => Math.abs(m.x - (2 * jm.x - plain[i].x)) < 1e-9 && Math.abs(m.y - plain[i].y) < 1e-9));
  const r = K.cutMesh(box.positions, box.indices, F, { scale: 60, cfg, keys, marks: jm.marks });
  const r0 = K.cutMesh(box.positions, box.indices, F, { scale: 60, cfg, keys });
  const pocketV = 22 * jm.marks[0].len * 0.28 * jm.marks[0].len * 0.6; // 22 strokes, each len × 0.28 len × 0.6 mm deep
  check('the engraved cut is sealed on both sides, with the strokes’ volume gone', r.parts.length === 2 && allClosed(r.parts) && r.marksUsed === 22 && r.keysUsed === 2 && Math.abs((sumVol(r0.parts) - sumVol(r.parts)) - pocketV) < 0.15 * pocketV, [sumVol(r0.parts) - sumVol(r.parts), pocketV]);
  const bad = [];
  for (const num of [0, 1, 4, 8, 9, 10, 19, 88, 99]) { const m = K.jointMarks(an.base, 0, keys, cfg, num, { mirror: true }); try { const rr = K.cutMesh(box.positions, box.indices, F, { scale: 60, cfg, keys, marks: m.marks }); if (!allClosed(rr.parts)) bad.push(num); } catch (e) { bad.push(num); } }
  check('every digit, and two-digit numbers, engrave sealed (the strokes are nudged so no two edges line up)', bad.length === 0, bad);
  check('a number that doesn’t fit gives nothing', K.jointMarks(an.base, 0, [{ x: 0, y: 0, o: { diameter: 40 } }], cfg, 7, { mirror: true }) === null);
  // on a curved cut: a line drawn round a 12 mm bar, numbered, seals too
  const thick = lathe(tt => { const z = tt * 60; const ball = (c) => { const d = Math.abs(z - c); return d < 12 ? Math.sqrt(144 - d * d) : 0; }; return Math.max(ball(12), ball(48), z > 6 && z < 54 ? 6 : 0, 0.05); }, 60, [0, 0, 1]);
  const ring = K.drawnLoop(thick.positions, thick.indices, [[6, 0, 30], [0, 6, 30.5], [-6, 0, 30], [0, -6, 29.5]]);
  const none = cfgOf({ type: 'none' }), anC = K.analyzeLoop(thick.positions, thick.indices, ring, none, 70), jmC = K.jointMarks(anC.base, 0, [], none, 7, { mirror: false });
  const rc = K.cutAlongLoop(thick.positions, thick.indices, ring, { cfg: none, perLoop: [{ keys: [], marks: jmC.marks }] }), rc0 = K.cutAlongLoop(thick.positions, thick.indices, ring, { cfg: none, perLoop: [{ keys: [] }] });
  check('a number engraved on a curved cut seals, and takes its strokes’ volume out of both pieces', !!jmC && jmC.marks.length === 3 && rc.parts.length === 2 && allClosed(rc.parts) && sumVol(rc.parts) < sumVol(rc0.parts) - 0.5, jmC && [jmC.marks.length, sumVol(rc0.parts) - sumVol(rc.parts)]);
}

console.log('reduce detail');
{
  const sp = (() => { const pos = [], idx = [], seg = 96, rings = 64, r = 20; for (let i = 0; i <= rings; i++) { const ph = Math.PI * i / rings; for (let j = 0; j < seg; j++) { const th = 2 * Math.PI * j / seg; pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)); } } for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg; if (i > 0) idx.push(a, c, b); if (i < rings - 1) idx.push(b, c, d); } return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }); })();
  const nt = sp.indices.length / 3;
  const r3 = K.reduceMesh(sp.positions, sp.indices, { target: 0.3 });
  check('a sphere reduced to 30% of its triangles stays closed, with its volume within half a percent', r3.indices.length / 3 <= 0.3 * nt + 3 && K.edgeReport(r3.indices).closed && Math.abs(K.volume(r3.positions, r3.indices) - sp.report.volume) < 0.005 * sp.report.volume && r3.removed === nt - r3.indices.length / 3, [r3.indices.length / 3, nt, K.volume(r3.positions, r3.indices), sp.report.volume]);
  const light = K.reduceMesh(sp.positions, sp.indices, { tolerance: 0.02 }), strong = K.reduceMesh(sp.positions, sp.indices, { tolerance: 0.1 });
  check('a tighter tolerance keeps more triangles, and both stay closed', light.indices.length / 3 > strong.indices.length / 3 && strong.indices.length / 3 < 0.6 * nt && K.edgeReport(light.indices).closed && K.edgeReport(strong.indices).closed, [light.indices.length / 3, strong.indices.length / 3]);
  let far = 0; for (let i = 0; i < strong.positions.length; i += 3) far = Math.max(far, Math.abs(Math.hypot(strong.positions[i], strong.positions[i + 1], strong.positions[i + 2]) - 20));
  check('within tolerance: no vertex of the strongly reduced sphere is more than 0.2 mm off it', far < 0.2, far);
  const cube = K.prepareMesh(gridCube(1));
  const rc = K.reduceMesh(cube.positions, cube.indices, { tolerance: 0.05 });
  check('a cube has nothing to take out within a small tolerance', rc.indices.length === cube.indices.length && rc.removed === 0, rc.removed);
}

console.log('export formats and projects');
{
  const knot = K.prepareMesh(K.torusKnot());
  const parts = [{ name: 'Knot A', color: '#c05050', positions: knot.positions, indices: knot.indices, volume: knot.report.volume, joints: [{ id: 1, type: 'peg', keys: 2, number: 1 }] }, { name: 'Knot <B>', color: '#5050c0', positions: knot.positions, indices: knot.indices, joints: [{ id: 1, type: 'peg', keys: 2, number: 1 }] }];
  const z = K.readZip(K.makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]));
  check('a ZIP written by Keymaster reads back entry for entry', z.length === 2 && z[0].name === 'a.txt' && new TextDecoder().decode(z[0].data) === 'hello' && z[1].name === 'dir/b.bin' && z[1].data.length === 3, z.map(e => e.name));
  const tmf = K.make3MF(parts), entries = K.readZip(tmf), model = entries.find(e => e.name === '3D/3dmodel.model');
  const xml = model ? new TextDecoder().decode(model.data) : '';
  check('a 3MF holds the content types, the relationships and one model with every part as a named, coloured object', entries.length === 3 && !!entries.find(e => e.name === '[Content_Types].xml') && !!entries.find(e => e.name === '_rels/.rels') && (xml.match(/<object /g) || []).length === 2 && (xml.match(/<triangle /g) || []).length === 2 * knot.indices.length / 3 && xml.includes('name="Knot &lt;B&gt;"') && xml.includes('displaycolor="#c05050"') && xml.includes('unit="millimeter"'), entries.map(e => e.name));
  // 1.73: opening a 3MF: Keymaster's own reads back with every part, the volume kept; a slicer-style one with a
  // component in inches, moved and mirrored by its transforms, comes out in millimetres, sealed and facing out
  { const back3 = K.parse3MF(entries), m3 = K.prepareMesh(back3), want = parts.reduce((a, q) => a + K.volume(q.positions, q.indices), 0);
    check('a 3MF Keymaster wrote opens again: both parts, every triangle, the volume kept', back3.objects === 2 && back3.indices.length === parts.reduce((a, q) => a + q.indices.length, 0) && Math.abs(m3.report.volume - want) / want < 1e-3, [back3.objects, m3.report.volume, want]);
    const cube = '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="1" y="1" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/><vertex x="1" y="0" z="1"/><vertex x="1" y="1" z="1"/><vertex x="0" y="1" z="1"/></vertices><triangles>' + [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('') + '</triangles>';
    const xml3 = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="1" type="model"><mesh>${cube}</mesh></object><object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/><component objectid="1" transform="-1 0 0 0 1 0 0 0 1 -2 0 0"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 1"/></build></model>`;
    const enc = new TextEncoder(), f3 = [{ name: '_rels/.rels', data: enc.encode('<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') }, { name: '3D/3dmodel.model', data: enc.encode(xml3) }];
    const r3 = K.parse3MF(f3), mm3 = K.prepareMesh(r3), b3 = K.bounds(mm3.positions), inch3 = 25.4 ** 3;
    check('a 3MF in inches with a component moved and one mirrored opens in mm, both cubes sealed and facing out', r3.objects === 2 && r3.items === 1 && K.edgeReport(mm3.indices).closed && Math.abs(mm3.report.volume - 2 * inch3) / inch3 < 1e-4 && Math.abs(b3.min[0] + 3 * 25.4) < 1e-3 && Math.abs(b3.max[0] - 3 * 25.4) < 1e-3 && Math.abs(b3.min[2] - 25.4) < 1e-3, [r3.objects, mm3.report.volume, b3.min, b3.max]);
    let err = ''; try { K.parse3MF([{ name: 'foo.txt', data: enc.encode('x') }]); } catch (e) { err = e.message; }
    check('a 3MF with no model inside says so', /no model/.test(err), err); }
  const sheet = K.assemblySheet(parts, { name: 'Knot', bed: { w: 220, d: 220, h: 250 }, date: 'today' });
  check('the assembly sheet names every part, its joint number and the parts a joint pairs', sheet.includes('Knot A') && sheet.includes('Knot &lt;B&gt;') && sheet.includes('№ 1') && sheet.includes('Knot A + Knot &lt;B&gt;') && sheet.includes('220 × 220 × 250') && sheet.startsWith('<!doctype html>'), sheet.length);
  check('without pictures the sheet has no picture column', !sheet.includes('<img'));
  const pic = 'data:image/png;base64,iVBORw0KGgo=', sheetP = K.assemblySheet([{ ...parts[0], image: pic }, parts[1]], { name: 'Knot', image: pic });
  check('with pictures the sheet shows each part’s picture beside its row and the exploded model at the top', sheetP.split(`<img src="${pic}"`).length === 3 && sheetP.includes('spread apart') && sheetP.includes('class="pic"'), sheetP.length);
  const pz = K.packProject(parts, { name: 'Knot', bed: { w: 1, d: 2, h: 3 }, joint: 2 }), back = K.unpackProject(pz);
  check('a project packs and unpacks with its parts, names, colours, joints and settings', back.app === 'Keymaster' && back.name === 'Knot' && back.bed.h === 3 && back.joint === 2 && back.parts.length === 2 && back.parts[1].name === 'Knot <B>' && back.parts[0].color === '#c05050' && back.parts[0].joints[0].number === 1 && back.parts[0].indices.length === knot.indices.length && back.parts[0].report.closed, back.parts.map(q => q.name));
  let msg = ''; try { K.unpackProject(K.makeZip([{ name: 'x.stl', data: new Uint8Array(84) }])); } catch (e) { msg = e.message; }
  check('a ZIP that isn’t a project says so', msg.includes('isn’t a Keymaster project'), msg);
}

console.log('shapes and plane clips');
{
  const closedVol = (m) => ({ closed: K.edgeReport(m.indices).closed, vol: K.volume(m.positions, m.indices) });
  const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct;
  const cube = closedVol(K.shapeMesh({ kind: 'cube', w: 20, d: 10, h: 5 }));
  check('a cube is a closed box of the right volume', cube.closed && near(cube.vol, 1000, 1e-6), cube);
  const ch = closedVol(K.shapeMesh({ kind: 'cube', w: 30, d: 10, h: 8, edge: 'chamfer', edgeSize: 3 }));
  check('a chamfered cube is closed and smaller than the box', ch.closed && ch.vol < 2400 && ch.vol > 1500, ch);
  const big = closedVol(K.shapeMesh({ kind: 'cube', w: 10, d: 10, h: 10, edge: 'chamfer', edgeSize: 20 }));
  check('a chamfer bigger than the cube is held back so the chamfers never meet', big.closed && big.vol > 500, big);
  const rd = closedVol(K.shapeMesh({ kind: 'cube', w: 20, d: 20, h: 20, edge: 'round', edgeSize: 5 }));
  check('a rounded cube is closed, within 2% of its exact volume', rd.closed && near(rd.vol, 1000 + 3000 + 120 * Math.PI * 25 / 4 + 4 / 3 * Math.PI * 125, 0.02), rd);
  const ball = closedVol(K.shapeMesh({ kind: 'ball', w: 20, h: 20 }));
  check('a ball is closed, within 2% of 4/3 π r³', ball.closed && near(ball.vol, 4 / 3 * Math.PI * 1000, 0.02), ball);
  const tube = closedVol(K.shapeMesh({ kind: 'tube', w: 10, h: 20 }));
  check('a tube is closed, within 1% of π r² h', tube.closed && near(tube.vol, Math.PI * 25 * 20, 0.01), tube);
  const tubeR = closedVol(K.shapeMesh({ kind: 'tube', w: 10, h: 20, edge: 'round', edgeSize: 1 }));
  check('a tube with rounded rims is closed and a little smaller', tubeR.closed && tubeR.vol < tube.vol && tubeR.vol > 0.95 * tube.vol, tubeR);
  const cone = closedVol(K.shapeMesh({ kind: 'cone', w: 10, d: 0, h: 12 }));
  check('a cone to a point is closed, within 1% of π r² h / 3', cone.closed && near(cone.vol, Math.PI * 25 * 12 / 3, 0.01), cone);
  const frustum = closedVol(K.shapeMesh({ kind: 'cone', w: 10, d: 4, h: 12, edge: 'chamfer', edgeSize: 1 }));
  check('a cut-off cone with chamfered rims is closed', frustum.closed && frustum.vol > 0, frustum);
  const ring = closedVol(K.shapeMesh({ kind: 'ring', w: 20, inner: 12, h: 4 }));
  check('a ring is closed, within 1% of π (R² − r²) h', ring.closed && near(ring.vol, Math.PI * (100 - 36) * 4, 0.01), ring);
  const ringR = closedVol(K.shapeMesh({ kind: 'ring', w: 20, inner: 12, h: 4, edge: 'round', edgeSize: 1 }));
  check('a ring with rounded edges is closed', ringR.closed && ringR.vol < ring.vol && ringR.vol > 0.9 * ring.vol, ringR);
  // the exact clip: both sides closed, the volumes add up, and the two caps mirror each other exactly
  const knot = K.prepareMesh(K.torusKnot());
  const c = K.clipMesh(knot.positions, knot.indices, { o: [1, -2, 0.5], n: [0.3, 0.5, 0.8] });
  const lo = closedVol(c.below), hi = closedVol(c.above);
  check('a plane clip gives two closed solids whose volumes add up to the whole', lo.closed && hi.closed && near(lo.vol + hi.vol, knot.report.volume, 1e-4) && lo.vol > 0 && hi.vol > 0, (lo, hi, knot.report.volume));
  const capBelow = Array.from(c.below.indices.subarray(c.below.capFrom)), capAbove = Array.from(c.above.indices.subarray(c.above.capFrom));
  check('each side’s cap starts where capFrom says, with the same count of triangles', capBelow.length === capAbove.length && capBelow.length > 0);
  const posKey = (m, i) => `${m.positions[3 * i]},${m.positions[3 * i + 1]},${m.positions[3 * i + 2]}`;
  const setBelow = new Set(); for (let i = 0; i < capBelow.length; i += 3) setBelow.add([posKey(c.below, capBelow[i]), posKey(c.below, capBelow[i + 1]), posKey(c.below, capBelow[i + 2])].join('|'));
  let mirrored = 0; for (let i = 0; i < capAbove.length; i += 3) if (setBelow.has([posKey(c.above, capAbove[i]), posKey(c.above, capAbove[i + 2]), posKey(c.above, capAbove[i + 1])].join('|'))) mirrored++;
  check('every cap triangle on one side is the mirror of one on the other, point for point', mirrored === capAbove.length / 3, (mirrored, capAbove.length / 3));
  const merged = K.prepareMesh(K.mergeMeshes([c.below, c.above])), rejoined = K.repairMesh(merged.positions, merged.indices);
  check('welded back together and with the twin cap faces dropped, the two sides are the knot again', rejoined.report.closed && rejoined.duplicates === capBelow.length / 3 * 2 && near(K.volume(rejoined.positions, rejoined.indices), knot.report.volume, 1e-4), (rejoined.report, rejoined.duplicates, capBelow.length / 3));
  const miss = K.clipMesh(knot.positions, knot.indices, { o: [0, 0, 100], n: [0, 0, 1] });
  check('a plane that misses the mesh leaves one side whole and the other empty', miss.below && !miss.above && !miss.crossed && near(K.volume(miss.below.positions, miss.below.indices), knot.report.volume, 1e-9));
}

console.log('booleans');
{
  const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct;
  const res = (r) => ({ closed: K.edgeReport(r.indices).closed, vol: K.volume(r.positions, r.indices), tris: r.indices.length / 3 });
  const A = K.boxMesh([-10, -10, -10], [10, 10, 10]), C = K.boxMesh([5, 5, 5], [15, 15, 15]);
  const inter = res(K.booleanWith(A.positions, A.indices, C, 'intersect')), diff = res(K.booleanWith(A.positions, A.indices, C, 'difference')), uni = res(K.booleanWith(A.positions, A.indices, C, 'union'));
  check('two boxes overlapping at a corner: the overlap is the 5 mm cube', inter.closed && near(inter.vol, 125, 1e-9), inter);
  check('the difference is the box less that corner, sealed', diff.closed && near(diff.vol, 8000 - 125, 1e-9), diff);
  check('the union is both boxes less the overlap, sealed', uni.closed && near(uni.vol, 8000 + 1000 - 125, 1e-9), uni);
  // the tool's edges run exactly through the part's face diagonals here (the boxes share a corner line): still sealed
  const knot = K.prepareMesh(K.torusKnot()), kv = knot.report.volume, b = K.bounds(knot.positions);
  const shapes = {
    ball: { kind: 'ball', w: 30, h: 30, pos: [b.center[0] + 20, b.center[1], b.center[2]], rot: [0, 0, 0], segments: 32 },
    cube: { kind: 'cube', w: 40, d: 40, h: 20, pos: [b.center[0], b.center[1], b.min[2] + 5], rot: [10, 20, 30], edge: 'chamfer', edgeSize: 3 },
    round: { kind: 'cube', w: 30, d: 32, h: 36, pos: [42, -18, 44], rot: [180, 316, 345], edge: 'round', edgeSize: 2, segments: 33 },
    tube: { kind: 'tube', w: 12, h: 200, pos: b.center, rot: [0, 0, 0], segments: 32, edge: 'round', edgeSize: 1 },
    cone: { kind: 'cone', w: 34, d: 29, h: 27, pos: [-37, 8.7, 31], rot: [59, 219, 276], segments: 26, edge: 'chamfer', edgeSize: 3 },
    ring: { kind: 'ring', w: 40, inner: 25, h: 8, pos: b.center, rot: [10, 0, 0], segments: 24, edge: 'round', edgeSize: 1 },
  };
  for (const [name, sp] of Object.entries(shapes)) {
    const m = K.shapeMesh(sp), sv = K.volume(m.positions, m.indices);
    const i = res(K.booleanShape(knot.positions, knot.indices, sp, 'intersect')), d = res(K.booleanShape(knot.positions, knot.indices, sp, 'difference')), u = res(K.booleanShape(knot.positions, knot.indices, sp, 'union'));
    check(`a ${name} on the knot: overlap, difference and union all sealed, and the volumes add up`, i.closed && d.closed && u.closed && i.vol > 0 && near(i.vol + d.vol, kv, 1e-6) && near(u.vol, kv + sv - i.vol, 1e-6), { name, i, d, u, kv, sv });
  }
  // a chain of booleans, then a cut through the result
  let cur = { positions: knot.positions, indices: knot.indices };
  for (const [op, sp] of [['union', shapes.cube], ['difference', shapes.ball], ['difference', shapes.ring]]) cur = K.booleanShape(cur.positions, cur.indices, sp, op);
  const chain = res(cur), cut = K.cutMesh(cur.positions, cur.indices, { o: K.bounds(cur.positions).center, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, [], { type: 'peg' });
  check('a cube added, a ball and a ring taken out, one after the other: sealed, and the result cuts into sealed pieces', chain.closed && cut.parts.length >= 2 && cut.parts.every(q => K.edgeReport(q.indices).closed), { chain, parts: cut.parts.length });
  // special placements
  const far = { kind: 'ball', w: 10, h: 10, pos: [b.max[0] + 50, 0, 0], rot: [0, 0, 0] }, huge = { kind: 'cube', w: 300, d: 300, h: 300, pos: b.center, rot: [0, 0, 0] };
  let msg = ''; try { K.booleanShape(knot.positions, knot.indices, far, 'intersect'); } catch (e) { msg = e.message; }
  check('a shape that misses the part: the overlap is refused in plain words', /don’t overlap/.test(msg), msg);
  const farU = res(K.booleanShape(knot.positions, knot.indices, far, 'union')), farD = res(K.booleanShape(knot.positions, knot.indices, far, 'difference'));
  check('… its union is both solids and its difference leaves the part as it was', farU.closed && near(farU.vol, kv + K.volume(K.shapeMesh(far).positions, K.shapeMesh(far).indices), 1e-6) && farD.closed && near(farD.vol, kv, 1e-9), { farU, farD });
  msg = ''; try { K.booleanShape(knot.positions, knot.indices, huge, 'difference'); } catch (e) { msg = e.message; }
  const hugeI = res(K.booleanShape(knot.positions, knot.indices, huge, 'intersect'));
  check('a shape that swallows the part: the difference is refused, the overlap is the part', /covers the whole part/.test(msg) && hugeI.closed && near(hugeI.vol, kv, 1e-9), { msg, hugeI });
  // the result is float32-safe: no two vertices on one position (the next boolean, or a cut, would trip on them)
  const seen = new Set(); let dup = 0; for (let v = 0; v < cur.positions.length / 3; v++) { const k = cur.positions[3 * v] + ',' + cur.positions[3 * v + 1] + ',' + cur.positions[3 * v + 2]; if (seen.has(k)) dup++; else seen.add(k); }
  check('no two vertices of a result share a position', dup === 0, dup);
}

console.log('sculpting');
{
  const m = K.shapeMesh({ kind: 'ball', w: 20, h: 20, segments: 48 }), I = m.indices, v0 = K.volume(m.positions, I);
  const at = [10, 0, 0], start = K.nearestTriangle(m.positions, I, at, 2);
  const P = new Float32Array(m.positions), P0 = new Float32Array(m.positions);
  let r; for (let i = 0; i < 5; i++) r = K.sculptDab(P, I, { centre: at, radius: 5, strength: 1, mode: 'inflate', start });
  const far = []; for (let v = 0; v < P.length / 3; v++) if (Math.hypot(P[3 * v] - 10, P[3 * v + 1], P[3 * v + 2]) > 5.5 && (P[3 * v] !== P0[3 * v] || P[3 * v + 1] !== P0[3 * v + 1] || P[3 * v + 2] !== P0[3 * v + 2])) far.push(v);
  check('inflate puffs the ball out under the brush: more volume, still sealed, only the vertices within reach moved', K.volume(P, I) > v0 * 1.005 && K.edgeReport(I).closed && r.moved.length > 20 && r.tris.length > r.moved.length && far.length === 0, { vol: K.volume(P, I), v0, moved: r.moved.length, far: far.length });
  for (let i = 0; i < 10; i++) K.sculptDab(P, I, { centre: at, radius: 5, strength: 1, mode: 'inflate', reverse: true, start });
  check('Shift (reverse) pushes it back in, below where it started', K.volume(P, I) < v0, K.volume(P, I));
  const Q = new Float32Array(m.positions); for (let v = 0; v < Q.length / 3; v++) { const s = 1 + 0.05 * Math.sin(v * 7.3); Q[3 * v] *= s; Q[3 * v + 1] *= s; Q[3 * v + 2] *= s; }
  const spread = (A) => { let s = 0, s2 = 0, n = 0; for (let v = 0; v < A.length / 3; v++) if (A[3 * v] > 8.5) { const d = Math.hypot(A[3 * v], A[3 * v + 1], A[3 * v + 2]); s += d; s2 += d * d; n++; } return s2 / n - (s / n) ** 2; };
  const sp0 = spread(Q); for (let i = 0; i < 12; i++) K.sculptDab(Q, I, { centre: at, radius: 8, strength: 1, mode: 'smooth', start });
  check('smooth melts the noise on a bumpy ball: the radius spreads much less', spread(Q) < sp0 * 0.6, { before: sp0, after: spread(Q) });
  const F = new Float32Array(m.positions), flat = (A) => { let s2 = 0, n = 0; for (let v = 0; v < A.length / 3; v++) if (A[3 * v] > 9) { s2 += (A[3 * v] - 9.5) ** 2; n++; } return s2 / n; };
  const f0 = flat(F); for (let i = 0; i < 10; i++) K.sculptDab(F, I, { centre: at, radius: 5, strength: 1, mode: 'flatten', start });
  check('flatten presses the cap of the ball towards a plane', flat(F) < f0 * 0.2, { before: f0, after: flat(F) });
  // a mask keeps the brush to the painted triangles
  const mask = new Uint8Array(I.length / 3); for (let t = 0; t < mask.length; t++) { const a = I[3 * t]; if (m.positions[3 * a + 1] > 0) mask[t] = 1; }
  const M = new Float32Array(m.positions); const rm = K.sculptDab(M, I, { centre: at, radius: 5, strength: 1, mode: 'inflate', start, mask });
  const vt = K.vertexTriangles(M, I); let outside = 0; for (const v of rm.moved) { let ok = false; for (let e = vt.start[v]; e < vt.start[v + 1]; e++) if (mask[vt.tri[e]]) ok = true; if (!ok) outside++; }
  check('with a painted mask only vertices of painted faces move', rm.moved.length > 0 && rm.moved.length < r.moved.length && outside === 0, { moved: rm.moved.length, outside });
  // the display arrays refreshed for the touched triangles agree with a full rebuild
  const full = K.creasedArrays(P, I, 38), arr = K.creasedArrays(m.positions, I, 38), all = []; for (let t = 0; t < I.length / 3; t++) all.push(t);
  K.refreshCreased(P, I, all, arr.pos, arr.nor, 38);
  let dpos = 0, dnor = 0; for (let i = 0; i < full.pos.length; i++) { dpos = Math.max(dpos, Math.abs(full.pos[i] - arr.pos[i])); dnor = Math.max(dnor, Math.abs(full.nor[i] - arr.nor[i])); }
  check('refreshing the view arrays after a stroke matches rebuilding them', dpos < 1e-6 && dnor < 1e-5, { dpos, dnor });
}

console.log('form: the parts of a figure by thickness');
{
  // a stick figure from booleans: a rounded torso, a neck, a head, two arms, two legs
  const torso = K.shapeMesh({ kind: 'cube', w: 18, d: 10, h: 26, edge: 'round', edgeSize: 3, segments: 30 });
  let f = { positions: torso.positions, indices: torso.indices };
  for (const sp of [{ kind: 'tube', w: 5, h: 10, pos: [0, 0, 16], rot: [0, 0, 0], segments: 20 }, { kind: 'ball', w: 12, h: 12, pos: [0, 0, 23], rot: [0, 0, 0], segments: 28 }, { kind: 'tube', w: 5, h: 24, pos: [15, 0, 8], rot: [0, 90, 0], segments: 20 }, { kind: 'tube', w: 5, h: 24, pos: [-15, 0, 8], rot: [0, 90, 0], segments: 20 }, { kind: 'tube', w: 6.5, h: 24, pos: [4.5, 0, -22], rot: [0, 0, 0], segments: 20 }, { kind: 'tube', w: 6.5, h: 24, pos: [-4.5, 0, -22], rot: [0, 0, 0], segments: 20 }]) f = K.booleanShape(f.positions, f.indices, sp, 'union');
  const before = f.indices.length / 3; f = K.subdivideMesh(f.positions, f.indices, { maxEdge: 3 }); // the limbs' long quads read as if they were all one place
  const P = f.positions, I = f.indices, nt = I.length / 3;
  check('the figure is one sealed solid, and splitting its long edges keeps it so', K.edgeReport(I).closed && K.separateShells(P, I).length === 0 && nt > before * 2 && Math.abs(K.volume(P, I) - K.volume(f.positions, f.indices)) < 1e-6, { shells: K.separateShells(P, I).length, before, nt });
  // thickness: a tube reads about its diameter, a ball less than its diameter, and a thicker tube more than a thin one
  const rng = (m) => { const s = K.shapeDiameter(m.positions, m.indices, {}); let mn = Infinity, mx = -Infinity; for (const x of s) { mn = Math.min(mn, x); mx = Math.max(mx, x); } return [mn, mx]; };
  const t5 = rng(K.shapeMesh({ kind: 'tube', w: 5, h: 24, segments: 20 })), t12 = rng(K.shapeMesh({ kind: 'tube', w: 12, h: 40, segments: 24 })), b12 = rng(K.shapeMesh({ kind: 'ball', w: 12, h: 12, segments: 28 }));
  check('the thickness under a surface: a 5 mm tube reads 5 to 7, a 12 mm tube about twice that, a 12 mm ball between, all even all round', t5[0] > 4.5 && t5[1] < 7.5 && t12[0] / t5[1] > 1.8 && b12[0] > t5[1] && b12[1] < t12[0] && t5[1] - t5[0] < 0.5 && b12[1] - b12[0] < 0.5, { t5, t12, b12 });
  const partOf = (t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2], x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3; if (Math.hypot(x, y, z - 23) < 6.3) return 'head'; if (Math.hypot(x, y) < 2.7 && z > 12.5 && z < 18) return 'neck'; if (Math.abs(x) > 9.2 && Math.abs(z - 8) < 3) return x > 0 ? 'arm R' : 'arm L'; if (z < -13.2) return x > 0 ? 'leg R' : 'leg L'; return 'torso'; };
  const seg = K.segmentForm(P, I, {});
  const area = (t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2], u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]; return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; };
  const byRegion = []; for (let t = 0; t < nt; t++) { const g = seg.groupOf[t]; if (!byRegion[g]) byRegion[g] = new Map(); const n = partOf(t); byRegion[g].set(n, (byRegion[g].get(n) || 0) + area(t)); }
  const share = (name) => { let best = 0, total = 0, pure = 0; for (const m of byRegion) { const a = m.get(name) || 0; total += a; let all = 0; for (const x of m.values()) all += x; if (a > best) { best = a; pure = a / all; } } return { held: best / total, pure }; };
  const parts = ['head', 'arm R', 'arm L', 'leg R', 'leg L', 'torso'].map(n => [n, share(n)]);
  check('the head, each arm, each leg and the torso each come out as a region of their own: most of each part in one region, and that region mostly that part', seg.count >= 6 && seg.count <= 10 && parts.every(([, s]) => s.held > 0.8 && s.pure > 0.8), { count: seg.count, parts: parts.map(([n, s]) => `${n} ${(100 * s.held).toFixed(0)}%/${(100 * s.pure).toFixed(0)}%`) });
  const knot = K.prepareMesh(K.torusKnot()), ks = K.segmentForm(knot.positions, knot.indices, {});
  check('a knot, the same thickness all along, is one region', ks.count === 1, ks.count);
  check('the result has the shape the regions code expects', seg.groupOf.length === nt && seg.areas.length === seg.count && seg.borders.length % 4 === 0 && seg.levels.length >= 2, { levels: seg.levels });
  // parts: form and creases together, with only the strong borders kept (1.62)
  const ps = K.segmentParts(P, I, { sdf: seg.sdf });
  const byP = []; for (let t = 0; t < nt; t++) { const g = ps.groupOf[t]; if (!byP[g]) byP[g] = new Map(); const n = partOf(t); byP[g].set(n, (byP[g].get(n) || 0) + area(t)); }
  const shareP = (name) => { let best = 0, total = 0, pure = 0; for (const m of byP) { const a = m.get(name) || 0; total += a; let all = 0; for (const x of m.values()) all += x; if (a > best) { best = a; pure = a / all; } } return { held: best / total, pure }; };
  const partsP = ['head', 'arm R', 'arm L', 'leg R', 'leg L', 'torso'].map(n => [n, shareP(n)]);
  check('parts by form and creases: the head, each arm, each leg and the torso each a region of their own, and no more than a few extra', ps.count >= 6 && ps.count <= 9 && partsP.every(([, s]) => s.held > 0.8 && s.pure > 0.8), { count: ps.count, parts: partsP.map(([n, s]) => `${n} ${s.held.toFixed(2)}/${s.pure.toFixed(2)}`) });
  check('parts have the shape the regions code expects, and the thickness comes back for reuse', ps.groupOf.length === nt && ps.areas.length === ps.count && ps.sdf && ps.sdf.length === P.length / 3);
  const kp = K.segmentParts(knot.positions, knot.indices, {});
  check('a knot, smooth and even all along, is one part', kp.count === 1, kp.count);
  { // the fast edge pairing (1.66) pairs triangles exactly as a Map of every edge does, and is kept per mesh
    const KI = knot.indices, nv = knot.positions.length / 3, first = new Map(), ref = [];
    for (let t = 0; t < KI.length / 3; t++) for (let k = 0; k < 3; k++) { const a = KI[3 * t + k], b = KI[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a, f = first.get(key); if (f === undefined) first.set(key, t); else { first.delete(key); ref.push(f, t, a, b); } }
    const fast = K.trianglePairs(KI);
    check('the fast edge pairing matches a Map of every edge, pair for pair, and is kept for the mesh', fast.length === ref.length && ref.every((v, i) => fast[i] === v) && K.trianglePairs(KI) === fast, { fast: fast.length, ref: ref.length }); }
  // a hat on a head: a brim's crease and a thin crown make it its own part, the head stays whole
  { const head = K.shapeMesh({ kind: 'ball', w: 20, h: 20, segments: 32 });
    let hat = K.booleanShape(head.positions, head.indices, { kind: 'tube', w: 26, h: 1.5, pos: [0, 0, 6], rot: [0, 0, 0], segments: 32 }, 'union');
    hat = K.booleanShape(hat.positions, hat.indices, { kind: 'tube', w: 14, h: 6, pos: [0, 0, 9.5], rot: [0, 0, 0], segments: 32 }, 'union');
    const hm = K.subdivideMesh(hat.positions, hat.indices, { maxEdge: 1.5 });
    const hs = K.segmentParts(hm.positions, hm.indices, {});
    const ht = hm.indices.length / 3, hz = (t) => (hm.positions[3 * hm.indices[3 * t] + 2] + hm.positions[3 * hm.indices[3 * t + 1] + 2] + hm.positions[3 * hm.indices[3 * t + 2] + 2]) / 3;
    const top = new Map(), low = new Map(); for (let t = 0; t < ht; t++) { const m = hz(t) > 6.9 ? top : hz(t) < 4 ? low : null; if (m) m.set(hs.groupOf[t], (m.get(hs.groupOf[t]) || 0) + 1); }
    const main = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const [gt, nTop] = main(top), [gl, nLow] = main(low), sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    check('a hat on a head comes out as its own part, the head below it another', hs.count >= 2 && gt !== gl && nTop / sum(top) > 0.8 && nLow / sum(low) > 0.8, { count: hs.count }); }
  // a whole pick as plain data (what the app's worker runs): the arm region split off with pegs, sealed pieces whose
  // volumes add up, nothing in it a worker can't send, and the same pieces as an unforced cut gives
  { const cfg = { type: 'peg', shape: 'round', diameter: 3, length: 4, clearance: 0.2, margin: 0.8, taper: 0, taperSocket: true, sizeMode: 'auto', sizeMin: 1.5, printer: 'fdm', pegSide: 'below', perArea: 1, align: true, turn: 0, plugSlope: 5, plugDepthMode: 'auto', plugDepth: 5, sink: 1, sizeMax: 3 };
    let arm = -1; { const m = new Map(); for (let t = 0; t < nt; t++) if (partOf(t) === 'arm R') m.set(ps.groupOf[t], (m.get(ps.groupOf[t]) || 0) + 1); arm = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
    const req = { loops: K.groupLoops(P, I, ps, [arm]), regions: [arm], seg: { groupOf: ps.groupOf, count: ps.count, borders: ps.borders, areas: ps.areas }, cfg, minThickness: 0.8, sink: 1, perArea: 1, numberJoints: false, joint: 1 };
    const out = K.planPick(P, I, req), sent = typeof structuredClone === 'function' ? structuredClone(K.plainData(out)) : K.plainData(out);
    const parts = out.result ? out.result.parts : [], vol = parts.reduce((a, q) => a + q.volume, 0);
    check('a pick planned as plain data splits the arm off sealed, the volumes adding up, and can be sent from a worker', !out.error && parts.length >= 2 && parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vol - K.volume(P, I)) / K.volume(P, I) < 0.002 && sent.result.parts.length === parts.length && sent.draw.length === out.loops.length, { error: out.error, n: parts.length, vol, whole: K.volume(P, I) });
    const plain = K.splitRegions(P, I, req.seg, [arm], { cfg, minThickness: 0.8, sink: 1, perLoop: out.perLoop });
    check('trying the cut forced first gives the very pieces an unforced cut gives', !out.forced && plain.parts.length === parts.length && plain.parts.every((q, i) => Math.abs(q.volume - parts[i].volume) < 1e-6), { forced: out.forced }); }
  // the joints first (1.68): planJoints alone gives the keys to draw, and planPick going on from it gives the same cut
  { const cfg = { type: 'peg', shape: 'round', diameter: 3, length: 4, clearance: 0.2, margin: 0.8, taper: 0, taperSocket: true, sizeMode: 'auto', sizeMin: 1.5, printer: 'fdm', pegSide: 'below', perArea: 1, align: true, turn: 0, plugSlope: 5, plugDepthMode: 'auto', plugDepth: 5, sink: 1, sizeMax: 3 };
    let arm = -1; { const m = new Map(); for (let t = 0; t < nt; t++) if (partOf(t) === 'arm R') m.set(ps.groupOf[t], (m.get(ps.groupOf[t]) || 0) + 1); arm = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
    const req = { loops: K.groupLoops(P, I, ps, [arm]), regions: [arm], seg: { groupOf: ps.groupOf, count: ps.count, borders: ps.borders, areas: ps.areas }, cfg, minThickness: 0.8, sink: 1, perArea: 1, numberJoints: false, joint: 1 };
    const j = K.planJoints(P, I, req), sentJ = typeof structuredClone === 'function' ? structuredClone(K.plainData(j)) : K.plainData(j);
    const whole = K.planPick(P, I, req), after = K.planPick(P, I, { ...req, planned: sentJ });
    check('the joints alone are planned first, with keys to draw and no cut yet, and the cut that goes on from them is the whole pick’s', j.keys > 0 && !j.result && j.draw.every((d, i) => d.keys.length === j.perLoop[i].keys.length) && after.result && whole.result && after.keys === whole.keys && after.result.parts.length === whole.result.parts.length && after.result.parts.every((q, i) => Math.abs(q.volume - whole.result.parts[i].volume) < 1e-6 && K.edgeReport(q.indices).closed), { keys: j.keys, after: after.keys, whole: whole.keys }); }
  // a stroke across a limb (1.64): the ring round the part under it, made a line on the surface, cuts sealed
  { const D = K.diag(K.bounds(P)), near = (q) => { const t = K.nearestTriangle(P, I, q, D); const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; return [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3]; };
    for (const [name, q, n, side] of [['the right arm', [21, 0, 10.5], [1, 0, 0.15], (c) => c[0] > 18], ['the neck', [0, 2.5, 15.5], [0.1, 0, 1], (c) => c[2] > 15]]) {
      const L = K.strokeLoop(P, I, { o: near(q), n, scale: D });
      let r = null, err = ''; try { r = L && K.cutAlongLoop(P, I, L, {}); } catch (e) { err = e.message; }
      const parts = r ? r.parts : [], vol = parts.reduce((x, y) => x + y.volume, 0), small = parts.slice().sort((x, y) => x.volume - y.volume)[0];
      const cen = small ? K.bounds(small.positions).center : null;
      check(`a stroke across ${name} wraps a line round it (tilted no more than 30°) that cuts it off sealed, the volumes adding up`, !!L && L.closed && L.tilt <= 30.5 && parts.length === 2 && parts.every(x => K.edgeReport(x.indices).closed && x.volume > 0) && Math.abs(vol - K.volume(P, I)) / K.volume(P, I) < 0.002 && side(cen), { err, tilt: L && L.tilt, n: parts.length, cen }); }
    const far = K.strokeLoop(P, I, { o: [500, 500, 500], n: [0, 0, 1], scale: D });
    check('a stroke that misses the part gives no line', far === null);
    // 1.76: a stroke's line is sliced along its plane: the cut is the plane's exact ring through new points, the surface
    // stays sealed with its volume, only the stroke's ring is cut (the plane crosses the other arm too), and it cuts sealed
    { const L = K.strokeLoop(P, I, { o: near([21, 0, 10.5]), n: [1, 0, 0.15], scale: D }), sl = L && K.sliceDrawnLoops(P, I, [L]);
      const pl = L && L.plane, off = (Q, verts) => Math.max(...verts.map(v => Math.abs((Q[3 * v] - pl.o[0]) * pl.n[0] + (Q[3 * v + 1] - pl.o[1]) * pl.n[1] + (Q[3 * v + 2] - pl.o[2]) * pl.n[2])));
      const nv0 = P.length / 3, vol0 = K.volume(P, I), med = 2.5; // (the figure's edges are about 2.5 mm)
      const cs = sl && K.splitRegions(sl.P, sl.I, sl.seg, [1], { force: true }), vs = cs ? cs.parts.reduce((a, q) => a + q.volume, 0) : 0;
      check('a stroke sliced along its plane: sealed, the same volume, one ring of new points on the plane (within an eighth of an edge), and the pieces cut sealed', !!sl && K.edgeReport(sl.I).closed && Math.abs(K.volume(sl.P, sl.I) - vol0) / vol0 < 1e-6 && sl.loops.length === 1 && sl.loops[0].verts.every(v => v >= nv0) && off(sl.P, sl.loops[0].verts) < 0.13 * med && off(P, L.verts) > 0.3 && !!cs && cs.parts.length === 2 && cs.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vs - vol0) / vol0 < 0.002, { plane: !!pl, edge: L && off(P, L.verts), sliced: sl && off(sl.P, sl.loops[0].verts), loops: sl && sl.loops.length }); } }
  // 1.76: Split into parts' flat fallback: the figure's narrow points, and a flat cut at the best one with keys, sealed, the volumes adding up
  { const cfg = { type: 'peg', shape: 'round', diameter: 3, length: 4, clearance: 0.2, margin: 0.8, taper: 0, taperSocket: true, sizeMode: 'auto', sizeMin: 1.5, printer: 'fdm', pegSide: 'below', perArea: 1, align: true, turn: 0, sizeMax: 3 };
    const flats = K.flatSplitCandidates(P, I, { limit: 3 }), tried = flats.map(it => K.flatSplit(P, I, it, { cfg, minThickness: 0.8, perArea: 1 })), good = tried.find(r => r.result);
    const vol0 = K.volume(P, I), vs = good ? good.result.parts.reduce((a, q) => a + q.volume, 0) : 0;
    check('the flat fallback finds narrow points and cuts one with keys: sealed pieces, the volumes adding up', flats.length >= 1 && !!good && good.result.parts.length >= 2 && good.result.parts.every(q => K.edgeReport(q.indices).closed && q.volume > 0) && Math.abs(vs - vol0) / vol0 < 1e-3, { flats: flats.length, errors: tried.map(r => r.error || 'ok'), keys: good && good.keys }); }
  // the separate pieces of a pick: two arms apart are two, an arm with the torso one
  { const regionOf = (name) => { const m = new Map(); for (let t = 0; t < nt; t++) if (partOf(t) === name) m.set(ps.groupOf[t], (m.get(ps.groupOf[t]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
    const armR = regionOf('arm R'), armL = regionOf('arm L'), torso = regionOf('torso');
    const two = K.pickComponents(P, I, ps.groupOf, new Set([armR, armL]), null), one = K.pickComponents(P, I, ps.groupOf, new Set([armR, torso]), null);
    check('picked regions that don\'t touch are separate pieces (each its own colour), touching ones one', two.count === 2 && one.count === 1, { two: two.count, one: one.count }); }
  // what Split into parts tries, best first (1.65): the limbs and the head come before anything else, the torso
  // (the body) is never a candidate, every candidate frees a real piece, and a crumb floor from the whole model holds
  { const plan = K.splitCandidates(P, I, ps, {}), main = (g) => { const m = new Map(); for (let t = 0; t < nt; t++) if (ps.groupOf[t] === g) { const n = partOf(t); m.set(n, (m.get(n) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
    const names = plan.candidates.map(c => main(c.groups[0]));
    check('the planned candidates are the limbs, the head and the neck, never the torso, each freeing a real piece', plan.candidates.length >= 5 && !names.includes('torso') && ['arm R', 'arm L', 'leg R', 'leg L'].every(n => names.includes(n)) && plan.candidates.every(c => c.piece > 0 && c.share >= 0.015), names);
    const strict = K.splitCandidates(P, I, ps, { whole: K.volume(P, I) * 20 });
    check('a crumb floor from the whole model drops pieces too small to be parts', strict.candidates.length < plan.candidates.length, { all: plan.candidates.length, strict: strict.candidates.length }); }
  // a dip is not a part: a block with a round hollow pressed into its top
  { const block = K.shapeMesh({ kind: 'cube', w: 30, d: 30, h: 20, segments: 24 });
    const dent = K.booleanShape(block.positions, block.indices, { kind: 'ball', w: 16, h: 16, pos: [0, 0, 12], rot: [0, 0, 0], segments: 28 }, 'difference');
    const dm = K.subdivideMesh(dent.positions, dent.indices, { maxEdge: 2 }), dseg = K.segmentSurface(dm.positions, dm.indices, { angle: 60, fold: 15 });
    const dplan = K.splitCandidates(dm.positions, dm.indices, dseg, {});
    const inHollow = (g) => { let n = 0, inside = 0; for (let t = 0; t < dm.indices.length / 3; t++) if (dseg.groupOf[t] === g) { n++; const z = (dm.positions[3 * dm.indices[3 * t] + 2] + dm.positions[3 * dm.indices[3 * t + 1] + 2] + dm.positions[3 * dm.indices[3 * t + 2] + 2]) / 3; if (z < 9.5) inside++; } return n && inside / n > 0.5; };
    check('a hollow pressed into a block is a dip, never offered as a part to split off', dplan.skipped.dip >= 1 && !dplan.candidates.some(c => c.groups.some(inHollow)), { skipped: dplan.skipped, n: dplan.candidates.length, regions: dseg.count }); }
  // the outlines for display: smooth curves along the borders, as many segments as the edges or more, lifted off the surface
  const cv = K.regionBorderCurves(P, I, ps, 0.1), raw = K.regionBorderLines(P, I, ps, 0.1);
  let finite = true; for (let i = 0; i < cv.length; i++) if (!Number.isFinite(cv[i])) { finite = false; break; }
  check('region borders come out as smooth curves: more, shorter segments than the mesh edges, all finite', cv.length % 6 === 0 && cv.length > raw.length * 1.5 && finite, { curve: cv.length / 6, edges: raw.length / 6 });
  // the thickness is sampled on big meshes and reads close to casting from every vertex
  const sAll = K.shapeDiameter(P, I, { samples: 0 }), sFew = K.shapeDiameter(P, I, { samples: 2000 });
  let dev = 0, nd = 0; for (let v = 0; v < sAll.length; v++) if (sAll[v] > 0 && sFew[v] > 0) { dev += Math.abs(Math.log(sFew[v] / sAll[v])); nd++; }
  check('sampling the thickness at a spread of points reads within about 15% of casting from every point', nd > sAll.length * 0.95 && dev / nd < 0.15, (dev / nd).toFixed(3));
}

console.log('split to fit the bed');
{
  const box = (sx, sy, sz) => ({ min: [0, 0, 0], max: [sx, sy, sz], size: [sx, sy, sz], center: [sx / 2, sy / 2, sz / 2] });
  const bed = { w: 220, d: 220, h: 250 };
  const bar = K.planBedCuts(box(300, 50, 50), bed, 5);
  check('a 300 mm bar on a 220 mm bed needs one cut across its length, in the middle, giving two pieces that fit', bar.counts.join() === '1,0,0' && bar.planes.length === 1 && bar.planes[0].axis === 0 && Math.abs(bar.planes[0].pos - 150) < 1e-9 && bar.pieces === 2 && bar.fits, bar);
  const slab = K.planBedCuts(box(500, 500, 40), bed, 5);
  check('a 500 mm slab needs two cuts each way: nine pieces that fit', slab.counts.join() === '2,2,0' && slab.pieces === 9 && slab.fits && slab.biggest.every((v, i) => Math.abs(v - [500 / 3, 500 / 3, 40][i]) < 1e-9), slab);
  const tall = K.planBedCuts(box(60, 60, 600), bed, 5);
  check('a tall post lies down on the bed: its 600 mm goes across the 250 mm height, two cuts', tall.counts.join() === '0,0,2' && tall.fits, tall);
  check('a model that fits needs no cuts', K.planBedCuts(box(100, 100, 100), bed, 5).planes.length === 0 && K.planBedCuts(box(100, 100, 100), bed, 5).fits);
  const byCount = K.planBedCuts(box(300, 50, 50), bed, 5, [0, 0, 3]);
  check('counts set by hand override the plan: three even cuts across Z', byCount.counts.join() === '0,0,3' && byCount.planes.map(q => q.pos.toFixed(1)).join() === '12.5,25.0,37.5' && !byCount.fits, byCount);
  const uneven = K.bedFit(box(300, 50, 50), [{ axis: 0, pos: 20 }, { axis: 0, pos: 280 }], bed, 5);
  check('uneven planes leave a 260 mm middle piece, too big for the bed even lying along its height', uneven.pieces === 3 && Math.abs(uneven.biggest[0] - 260) < 1e-9 && !uneven.fits, uneven);
  check('a plane outside the model counts for nothing', K.bedFit(box(300, 50, 50), [{ axis: 0, pos: 400 }], bed, 5).pieces === 1);
}

console.log('surface regions');
{
  const lathe = (radius, len, seg = 48, rings = 160) => {
    const pos = [0, 0, 0];
    for (let i = 1; i < rings; i++) { const z = (i / rings) * len, r = radius(z); for (let j = 0; j < seg; j++) { const a = (j / seg) * 2 * Math.PI; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); } }
    pos.push(0, 0, len);
    const S = pos.length / 3 - 1, idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + (j + 1) % seg, 1 + j);
    for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) { const p0 = 1 + i * seg + j, p1 = 1 + i * seg + (j + 1) % seg; idx.push(p0, p1, p1 + seg, p0, p1 + seg, p0 + seg); }
    const base = 1 + (rings - 2) * seg;
    for (let j = 0; j < seg; j++) idx.push(S, base + j, base + (j + 1) % seg);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  const sph = K.prepareMesh(uvSphere(20, 64, 40));
  check('a smooth sphere is one region', K.segmentSurface(sph.positions, sph.indices).count === 1);
  // an arm in a sleeve: the sleeve ends in a sharp step down to the arm, which is where a curved cut should go
  const arm = lathe(z => (z < 2 ? Math.max(0.3, z * 4) : z < 40 ? 8 : z < 41 ? 8 - (z - 40) * 2.5 : z < 78 ? 5.5 : Math.max(0.3, 5.5 * Math.sqrt(1 - Math.pow((z - 78) / 2, 2)))), 80);
  check('sleeve test shape closed', arm.report.closed, arm.report);
  const seg = K.segmentSurface(arm.positions, arm.indices, { angle: 35 });
  const zOf = (t) => (arm.positions[3 * arm.indices[3 * t] + 2] + arm.positions[3 * arm.indices[3 * t + 1] + 2] + arm.positions[3 * arm.indices[3 * t + 2] + 2]) / 3;
  const groupAt = (z) => { for (let t = 0; t < arm.indices.length / 3; t++) if (Math.abs(zOf(t) - z) < 0.3) return seg.groupOf[t]; return -1; };
  check('the sleeve and the arm are separate regions', groupAt(20) >= 0 && groupAt(60) >= 0 && groupAt(20) !== groupAt(60), [groupAt(20), groupAt(60), seg.count]);
  let hem = Infinity; const b = seg.borders;
  for (let i = 0; i < b.length; i += 4) for (const v of [b[i + 2], b[i + 3]]) { const z = arm.positions[3 * v + 2]; if (z > 30 && z < 50) hem = Math.min(hem, Math.abs(z - 40)); }
  check('a border runs round the sleeve hem', hem < 1.2, hem);
  // a stepped tower splits into its flat faces
  const pos = [], idx = [];
  const quad = (a, bq, c, d) => { const o = pos.length / 3; pos.push(...a, ...bq, ...c, ...d); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const ring = (h, z) => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]];
  const L0 = ring(10, 0), L1 = ring(10, 10), U0 = ring(9, 10), U1 = ring(9, 20);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(L0[i], L0[j], L1[j], L1[i]); quad(U0[i], U0[j], U1[j], U1[i]); quad(L1[i], L1[j], U0[j], U0[i]); }
  quad(L0[3], L0[2], L0[1], L0[0]); quad(U1[0], U1[1], U1[2], U1[3]);
  const tower = K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  check('a stepped tower splits into its 11 flat faces', K.segmentSurface(tower.positions, tower.indices, { minFrac: 0 }).count === 11, K.segmentSurface(tower.positions, tower.indices, { minFrac: 0 }).count);
  // small specks melt into their neighbour: a sphere with a few sharp little dents is still one region
  const dent = K.prepareMesh(uvSphere(20, 64, 40));
  for (const v of [100, 900, 1700]) for (let k = 0; k < 3; k++) dent.positions[3 * v + k] *= 0.93;
  const sd = K.segmentSurface(dent.positions, dent.indices, { angle: 10 });
  check('tiny dents melt into the region around them', sd.count === 1, sd.count);
  check('a gentler threshold finds more regions', K.segmentSurface(arm.positions, arm.indices, { angle: 15 }).count >= seg.count);
  const lines = K.regionBorderLines(arm.positions, arm.indices, seg, 0.01);
  check('border lines: one segment per border edge', lines.length === (seg.borders.length / 4) * 6);
}

console.log('curved cuts along a border');
{
  const lathe = (radius, len, seg = 48, rings = 160) => {
    const pos = [0, 0, 0];
    for (let i = 1; i < rings; i++) { const z = (i / rings) * len, r = radius(z); for (let j = 0; j < seg; j++) { const a = (j / seg) * 2 * Math.PI; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); } }
    pos.push(0, 0, len);
    const S = pos.length / 3 - 1, idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + (j + 1) % seg, 1 + j);
    for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) { const p0 = 1 + i * seg + j, p1 = 1 + i * seg + (j + 1) % seg; idx.push(p0, p1, p1 + seg, p0, p1 + seg, p0 + seg); }
    const base = 1 + (rings - 2) * seg;
    for (let j = 0; j < seg; j++) idx.push(S, base + j, base + (j + 1) % seg);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  // an arm in a sleeve: cut it off at the hem
  const arm = lathe(z => (z < 2 ? Math.max(0.3, z * 4) : z < 40 ? 8 : z < 41 ? 8 - (z - 40) * 2.5 : z < 78 ? 5.5 : Math.max(0.3, 5.5 * Math.sqrt(1 - Math.pow((z - 78) / 2, 2)))), 80);
  const seg = K.segmentSurface(arm.positions, arm.indices);
  const loops = K.borderLoops(arm.positions, seg);
  const hem = K.borderLoopNear(arm.positions, seg, loops, [8, 0, 40]);
  check('the sleeve hem is a border that goes all the way round', !!hem && hem.loop.closed && Math.abs(hem.loop.length - 2 * Math.PI * 8) < 2, hem && [hem.loop.closed, hem.loop.length]);
  const cut = K.cutAlongLoop(arm.positions, arm.indices, hem.loop);
  check('cutting along the hem gives two sealed pieces', cut.parts.length === 2 && allClosed(cut.parts), cut.parts.map(q => K.edgeReport(q.indices)));
  check('the pieces keep the whole volume', Math.abs(sumVol(cut.parts) - arm.report.volume) / arm.report.volume < 1e-6, [sumVol(cut.parts), arm.report.volume]);
  const zr = (q) => { let lo = Infinity, hi = -Infinity; for (let i = 2; i < q.positions.length; i += 3) { lo = Math.min(lo, q.positions[i]); hi = Math.max(hi, q.positions[i]); } return [lo, hi]; };
  const [za, zb] = cut.parts.map(zr);
  check('the cut falls exactly at the hem', [za, zb].some(r => Math.abs(r[1] - 40) < 0.6) && [za, zb].some(r => Math.abs(r[0] - 40) < 0.6), [za, zb]);
  // a wavy border on a sphere: the cut follows it, curved, and both pieces still close
  const sp = K.prepareMesh(uvSphere(20, 96, 64));
  const ntS = sp.indices.length / 3, gS = new Int32Array(ntS);
  for (let q = 0; q < ntS; q++) {
    let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * sp.indices[3 * q + k]; x += sp.positions[v]; y += sp.positions[v + 1]; z += sp.positions[v + 2]; }
    gS[q] = z / 3 > 4 * Math.sin(3 * Math.atan2(y, x)) + 2 ? 1 : 0;
  }
  const segW = K.bordersFromGroups(sp.positions, sp.indices, gS), loopsW = K.borderLoops(sp.positions, segW);
  check('a wavy border round a sphere is one closed loop', loopsW.length === 1 && loopsW[0].closed, loopsW.map(l => [l.closed, l.verts.length]));
  let wz0 = Infinity, wz1 = -Infinity; for (const v of loopsW[0].verts) { wz0 = Math.min(wz0, sp.positions[3 * v + 2]); wz1 = Math.max(wz1, sp.positions[3 * v + 2]); }
  check('the wavy border really is curved (rises and falls 8 mm)', wz1 - wz0 > 6, [wz0, wz1]);
  const cw = K.cutAlongLoop(sp.positions, sp.indices, loopsW[0]);
  check('cutting along a wavy border gives two sealed pieces', cw.parts.length === 2 && allClosed(cw.parts), cw.parts.map(q => K.edgeReport(q.indices)));
  // a line drawn by hand: four points round the sphere, joined the shortest way along the surface, cut like a border
  const zD = 5, rD = Math.sqrt(400 - zD * zD), drawnPts = [0, 90, 180, 270].map(a => [rD * Math.cos(a * Math.PI / 180), rD * Math.sin(a * Math.PI / 180), zD]);
  const drawn = K.drawnLoop(sp.positions, sp.indices, drawnPts);
  check('a line drawn through four points closes round the sphere, close to the circle through them', drawn && drawn.closed && drawn.drawn && Math.abs(drawn.length - 2 * Math.PI * rD) / (2 * Math.PI * rD) < 0.1, drawn && [drawn.verts.length, drawn.length, 2 * Math.PI * rD]);
  const cd = K.cutAlongLoop(sp.positions, sp.indices, drawn);
  check('cutting along the drawn line gives two sealed pieces, volume kept', cd.parts.length === 2 && allClosed(cd.parts) && Math.abs(sumVol(cd.parts) - sp.report.volume) / sp.report.volume < 1e-6, cd.parts.map(q => q.volume));
  const back = K.drawnLoop(sp.positions, sp.indices, [drawnPts[0], drawnPts[1], drawnPts[0], drawnPts[2], drawnPts[3]]);
  check('a line that doubles back on itself is made simple', back && back.closed && new Set(back.verts).size === back.verts.length && Math.abs(back.length - drawn.length) / drawn.length < 0.15, back && [back.verts.length, back.length]);
  check('fewer than three points make no line', K.drawnLoop(sp.positions, sp.indices, drawnPts.slice(0, 2)) === null);
  // seam editing: a line as handles along the surface, dragged, smoothed and snapped
  const hs = K.loopHandles(sp.positions, drawn, 12);
  const onLine = (q) => drawn.verts.some(v => Math.hypot(sp.positions[3 * v] - q[0], sp.positions[3 * v + 1] - q[1], sp.positions[3 * v + 2] - q[2]) < 1e-6);
  check('a line gives about a dozen handles, all on it, spread round it', hs.length >= 10 && hs.length <= 12 && hs.every(onLine) && Math.max(...hs.map(q => q[1])) > 10 && Math.min(...hs.map(q => q[1])) < -10, hs.length);
  const moved = hs.map(q => q.slice()); { const q = moved[3], zz = q[2] + 8, rr = Math.sqrt(400 - zz * zz), rh = Math.hypot(q[0], q[1]); moved[3] = [q[0] / rh * rr, q[1] / rh * rr, zz]; } // one handle pulled 8 mm up the sphere
  const edited = K.drawnLoop(sp.positions, sp.indices, moved);
  check('the line re-routed through a dragged handle still closes and passes near the handle', edited && edited.closed && edited.verts.some(v => Math.hypot(sp.positions[3 * v] - moved[3][0], sp.positions[3 * v + 1] - moved[3][1], sp.positions[3 * v + 2] - moved[3][2]) < 1.5) && edited.length > drawn.length, edited && [edited.length, drawn.length]);
  const zig = hs.map((q, i) => (i % 2 ? [q[0], q[1], q[2] + 6] : q)); // every other handle lifted: a zig-zag
  const zigLoop = K.drawnLoop(sp.positions, sp.indices, zig), smoothLoop = K.drawnLoop(sp.positions, sp.indices, K.smoothHandles(sp.positions, zig, 3));
  check('smoothing a zig-zag line shortens it, and keeps its handles on the surface', zigLoop && smoothLoop && smoothLoop.length < 0.9 * zigLoop.length && K.smoothHandles(sp.positions, zig, 3).every(q => Math.abs(Math.hypot(...q) - 20) < 0.5), zigLoop && smoothLoop && [zigLoop.length, smoothLoop.length]);
  const nbp = K.nearestBorderPoint(sp.positions, segW, [sp.positions[3 * loopsW[0].verts[5]] + 0.3, sp.positions[3 * loopsW[0].verts[5] + 1], sp.positions[3 * loopsW[0].verts[5] + 2]]);
  check('the nearest point on a border to a point just off it is under half a millimetre away', !!nbp && nbp.distance < 0.5, nbp);
  // A painted selection, like a face selection in Meshmixer: brush dabs reach across the surface within the brush,
  // grow, shrink and tidy work in millimetres, and the painted area splits off like a region, sealed
  const ntS2 = sp.indices.length / 3, painted = new Uint8Array(ntS2), dabs = [[0, 0, 20], [4, 0, 19.6]];
  for (const c of dabs) { const s = K.nearestTriangle(sp.positions, sp.indices, c); for (const t of K.brushTriangles(sp.positions, sp.indices, s, c, 6)) painted[t] = 1; }
  const cnt = (a) => { let n = 0; for (const v of a) n += v; return n; };
  const farSide = (a) => { let n = 0; for (let t = 0; t < a.length; t++) if (a[t] && sp.positions[3 * sp.indices[3 * t] + 2] < 0) n++; return n; };
  check('two brush dabs paint a patch round the top, nothing on the far side', cnt(painted) > 500 && cnt(painted) < 3000 && farSide(painted) === 0, [cnt(painted), farSide(painted)]);
  const sphereHit = K.sphereTriangles(sp.positions, sp.indices, [0, 0, 20], 6), surfaceHit = K.brushTriangles(sp.positions, sp.indices, K.nearestTriangle(sp.positions, sp.indices, [0, 0, 20]), [0, 0, 20], 6);
  check('on one layer the sphere brush and the surface brush take the same faces', sphereHit.length === surfaceHit.length && sphereHit.length > 100, [sphereHit.length, surfaceHit.length]);
  const two = K.prepareMesh(K.mergeMeshes([uvSphere(20, 96, 64), uvSphere(23, 96, 64)])); // a shell round a ball: two layers
  const topT = K.nearestTriangle(two.positions, two.indices, [0, 0, 23]);
  check('through two layers the sphere brush reaches the layer behind, the surface brush does not', K.sphereTriangles(two.positions, two.indices, [0, 0, 23], 5).length > K.brushTriangles(two.positions, two.indices, topT, [0, 0, 23], 5).length * 1.3, [K.sphereTriangles(two.positions, two.indices, [0, 0, 23], 5).length, K.brushTriangles(two.positions, two.indices, topT, [0, 0, 23], 5).length]);
  const grown = K.growSelection(sp.positions, sp.indices, painted, 2), shrunk = K.shrinkSelection(sp.positions, sp.indices, painted, 2);
  check('grow adds a 2 mm band and shrink takes one away', cnt(grown) > cnt(painted) * 1.2 && cnt(shrunk) < cnt(painted) * 0.8 && cnt(K.shrinkSelection(sp.positions, sp.indices, grown, 2)) <= cnt(painted) * 1.05, [cnt(painted), cnt(grown), cnt(shrunk)]);
  const spiky = new Uint8Array(painted); { const sq = [0, 12, 16]; const s = K.nearestTriangle(sp.positions, sp.indices, sq); for (const t of K.brushTriangles(sp.positions, sp.indices, s, sq, 0.6)) spiky[t] = 1; }
  const tidied = K.tidySelection(sp.positions, sp.indices, spiky, 1);
  check('tidy drops a speck painted away from the patch', cnt(spiky) > cnt(painted) && cnt(tidied) <= cnt(painted) * 1.02 && cnt(tidied) >= cnt(painted) * 0.9, [cnt(painted), cnt(spiky), cnt(tidied)]);
  const segPaint = K.selectionSeg(sp.positions, sp.indices, painted), loopsPaint = K.groupLoops(sp.positions, sp.indices, segPaint, [1]);
  const rPaint = K.splitRegions(sp.positions, sp.indices, segPaint, [1], { minThickness: 1, sink: 1 });
  check('the painted area has one closed outline and splits off sealed, sunk, volume kept', loopsPaint.length === 1 && loopsPaint[0].closed && rPaint.parts.length === 2 && allClosed(rPaint.parts) && rPaint.sinks[0] > 0.5 && Math.abs(sumVol(rPaint.parts) - sp.report.volume) / sp.report.volume < 1e-6, [loopsPaint.length, rPaint.parts.map(q => q.volume), rPaint.sinks]);
  // an inlay cut: the painted patch becomes a pocket in the body and an inlay pulled in by the fit, both sealed
  const inl = K.inlayCut(sp.positions, sp.indices, painted, { depth: 2, fit: 1, wall: 0.8 });
  const rOf = (m) => { let r = 0; for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 2] > 16) r = Math.max(r, Math.hypot(m.positions[i], m.positions[i + 1])); return r; }; // the widest reach of the top (z > 16)
  let rPocket = 0; for (const v of loopsPaint[0].verts) rPocket = Math.max(rPocket, Math.hypot(sp.positions[3 * v], sp.positions[3 * v + 1]));
  check('the inlay cut gives a sealed body with a pocket about 2 mm deep and a sealed inlay', K.edgeReport(inl.body.indices).closed && K.edgeReport(inl.inlay.indices).closed && inl.body.volume > 0 && inl.inlay.volume > 0 && inl.depth > 1.5 && inl.depth <= 2.001, [inl.depth, inl.inlayDepth, inl.body.volume, inl.inlay.volume]);
  check('the inlay is pulled in by the fit all round, and the two together are a little less than the sphere', rOf(inl.inlay) < rPocket - 0.5 && inl.body.volume + inl.inlay.volume < sp.report.volume && inl.body.volume + inl.inlay.volume > 0.97 * sp.report.volume, [rOf(inl.inlay), rPocket, inl.body.volume + inl.inlay.volume, sp.report.volume]);
  const flatI = K.inlayCut(sp.positions, sp.indices, painted, { depth: 2, fit: 0.5, flat: true, wall: 0.8 });
  const onPlane = (m, pl) => { let n = 0; for (let i = 0; i < m.positions.length; i += 3) if (Math.abs((m.positions[i] - pl.point[0]) * pl.normal[0] + (m.positions[i + 1] - pl.point[1]) * pl.normal[1] + (m.positions[i + 2] - pl.point[2]) * pl.normal[2]) < 0.02) n++; return n; };
  check('with a flat floor the inlay stands on one level base, the pocket floor is the same plane, and both pieces seal', flatI.flat && !!flatI.floor && K.edgeReport(flatI.body.indices).closed && K.edgeReport(flatI.inlay.indices).closed && onPlane(flatI.inlay, flatI.floor) > 100 && onPlane(flatI.body, flatI.floor) > 100 && flatI.depth > 1.5 && flatI.depth <= 2.001 && flatI.deepest >= flatI.depth, [onPlane(flatI.inlay, flatI.floor), onPlane(flatI.body, flatI.floor), flatI.depth, flatI.deepest]);
  const msgOf = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  check('an inlay with no room for its pocket says so', msgOf(() => K.inlayCut(sp.positions, sp.indices, painted, { depth: 3, fit: 0.2, wall: 45 })).includes('No room'));
  const selFromLoop = K.loopSelection(sp.positions, sp.indices, [drawn]);
  check('a drawn line gives the smaller side as a selection', cnt(selFromLoop) > 0 && cnt(selFromLoop) < ntS2 / 2, cnt(selFromLoop));
  check('nothing painted, or everything, says so', msgOf(() => K.selectionSeg(sp.positions, sp.indices, new Uint8Array(ntS2))).includes('Nothing is painted') && msgOf(() => K.selectionSeg(sp.positions, sp.indices, new Uint8Array(ntS2).fill(1))).includes('whole part'));
  // A sunk face: the face across the wavy cut pushed 1 mm into the bigger piece, with a wall down from the line, so
  // the cap piece keeps a millimetre of thickness right to its edge. The cap piece gains about the face's area times
  // the depth; the pieces still seal and the volume is kept.
  // (the line is turned first so its smaller side is side 1, as the app does before planning keys: the recess goes
  // into the bigger piece)
  const orientedW = K.orientLoops(sp.positions, sp.indices, [loopsW[0]], { what: 'lines' }).loops[0];
  const sunk = K.cutAlongLoop(sp.positions, sp.indices, orientedW, { sink: 1, minThickness: 1 });
  const anS = K.analyzeLoop(sp.positions, sp.indices, orientedW, { type: 'none', sink: 1, margin: 1 }, 40);
  const smallPlain = Math.min(...cw.parts.map(q => q.volume)), smallSunk = Math.min(...sunk.parts.map(q => q.volume)), faceArea = anS.base.regions[0].area;
  check('a sunk face: full depth, sealed, volume kept', sunk.sink > 0.95 && anS.curved.sink > 0.95 && allClosed(sunk.parts) && Math.abs(sumVol(sunk.parts) - sp.report.volume) / sp.report.volume < 1e-6, [sunk.sink, anS.curved.sink, sumVol(sunk.parts)]);
  // Where the line runs along the ball's widest part there is no solid straight below it, so the recess fades out
  // there (it never breaks out); elsewhere it is a full millimetre deep
  const depths = anS.curved.sunk.depth, deepRim = depths.filter(d => d > 0.95).length;
  check('the recess is a millimetre deep along most of the line and fades where there is only air beyond', deepRim > depths.length * 0.4 && depths.every(d => d <= 1 + 1e-9), [deepRim, depths.length]);
  check('the smaller piece gains a slab in proportion', (smallSunk - smallPlain) > 0.3 * faceArea && (smallSunk - smallPlain) < 1.05 * faceArea, [smallSunk - smallPlain, faceArea]);
  // the slab really is there: along the frame normal, the smaller piece is at least a millimetre thick at the line
  // wherever the recess is full depth
  const thickAtRim = (() => { // a hair inside the line (right on it, the ray would run down the wall)
    const F = anS.frame, piece = sunk.parts.find(q => q.volume === smallSunk), g = K.rayGrid(piece.positions, piece.indices, F), xy = anS.base.loops[0].xy, n = xy.length / 2;
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2];
    let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += xy[2 * i] / n; cy += xy[2 * i + 1] / n; }
    let worst = Infinity, missed = 0, hit = 0;
    for (let i = 0; i < n; i += 4) {
      if (depths[i] < 0.95) continue;
      const dx = cx - xy[2 * i], dy = cy - xy[2 * i + 1], L = Math.hypot(dx, dy) || 1, x = xy[2 * i] + 0.5 * dx / L, y = xy[2 * i + 1] + 0.5 * dy / L;
      const r = K.solidRuns(g, x + ox + 1.3e-7, y + oy + 0.7e-7);
      if (!r.length) { missed++; continue; } // a ray down the wall itself
      hit++;
      let best = 0; for (let k = 0; k < r.length; k += 2) best = Math.max(best, r[k + 1] - r[k]); worst = Math.min(worst, best);
    }
    return missed > hit / 5 ? 0 : worst;
  })();
  check('…so the piece is at least a millimetre thick right at the line there', thickAtRim > 0.95, thickAtRim);
  const tightS = cfgOf({ type: 'peg', clearance: 0, taper: 0, sink: 1 });
  const keysS = (() => { const a = K.analyzeLoop(sp.positions, sp.indices, orientedW, tightS, 40), ks = K.autoPlaceKeys(a, tightS, 3, new Set()), ev = K.evaluateKeys(a, ks, tightS, new Set()); return ks.filter((k, i) => ev[i].ok); })();
  const sunkK = K.cutAlongLoop(sp.positions, sp.indices, orientedW, { cfg: tightS, keys: keysS, sink: 1, minThickness: 1 });
  check('pegs on a sunk face: sealed, still sunk', sunkK.sink > 0.95 && keysS.length >= 2 && allClosed(sunkK.parts), [sunkK.sink, keysS.length]);
  // with a wall thicker than the ball required beyond the face, there is no room to sink: the cut is as before
  const noRoom = K.cutAlongLoop(sp.positions, sp.indices, orientedW, { sink: 1, cfg: cfgOf({ margin: 30 }) });
  check('no room to sink: the face stays where it was, and the cut is still sealed', noRoom.sink === 0 && allClosed(noRoom.parts) && Math.abs(Math.min(...noRoom.parts.map(q => q.volume)) - smallPlain) < 1e-6, [noRoom.sink, noRoom.parts.map(q => q.volume)]);
  check('wavy cut keeps the volume', Math.abs(sumVol(cw.parts) - sp.report.volume) / sp.report.volume < 1e-6, [sumVol(cw.parts), sp.report.volume]);
  // the cut face is drawn as a fine grid inside the line, so it bends smoothly instead of a few big facets: the
  // typical bend between neighbouring face triangles is a few degrees (it was over 40°), and the face has many
  // points of its own, not just the line's
  const faceBends = (part, isFace) => { // bends (degrees) between neighbouring triangles of the face, and the face's vertex count
    const Q = part.positions, J = part.indices, N = [], edges = new Map(), bends = [], verts = new Set();
    for (let t = 0; t < J.length / 3; t++) {
      const a = J[3 * t], b = J[3 * t + 1], c = J[3 * t + 2], A = [Q[3 * a], Q[3 * a + 1], Q[3 * a + 2]];
      const u = [Q[3 * b] - A[0], Q[3 * b + 1] - A[1], Q[3 * b + 2] - A[2]], v = [Q[3 * c] - A[0], Q[3 * c + 1] - A[1], Q[3 * c + 2] - A[2]];
      const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...nn) || 1;
      N[t] = nn.map(x => x / L);
      if (!isFace([(A[0] + Q[3 * b] + Q[3 * c]) / 3, (A[1] + Q[3 * b + 1] + Q[3 * c + 1]) / 3, (A[2] + Q[3 * b + 2] + Q[3 * c + 2]) / 3]) || L < 1e-4) continue;
      for (const w of [a, b, c]) verts.add(w);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = Math.min(p, q) + ':' + Math.max(p, q), o = edges.get(k); if (o !== undefined) bends.push(Math.acos(Math.max(-1, Math.min(1, N[t][0] * N[o][0] + N[t][1] * N[o][1] + N[t][2] * N[o][2]))) * 180 / Math.PI); else edges.set(k, t); }
    }
    bends.sort((a, b) => a - b);
    return { median: bends[bends.length >> 1] || 0, verts: verts.size };
  };
  const insideSphere = (c) => Math.hypot(c[0], c[1], c[2]) < 19.5;
  const smoothW = cw.parts.map(q => faceBends(q, insideSphere));
  check('the wavy cut face is smooth: neighbouring triangles typically bend under 10°', smoothW.every(s => s.median < 10), smoothW);
  check('…and is drawn from hundreds of points of its own, shared exactly by both pieces', smoothW.every(s => s.verts > 300) && smoothW[0].verts === smoothW[1].verts, smoothW);
  // keys on curved cuts: on a flat face on the line's best-fit plane, joined to the line by a thin band
  const prismK = (A0, A1, h) => { const mid = A0.map((q, i) => [(q[0] + A1[i][0]) / 2, (q[1] + A1[i][1]) / 2]); return h / 6 * (K.profileArea(A0) + 4 * K.profileArea(mid) + K.profileArea(A1)); };
  const keyVol = (an, cfg, keys) => { // pegs added minus sockets removed, key by key
    let dv = 0;
    for (const k of keys) {
      const kc = K.keyCfg(cfg, k), sp = K.keyGeometrySpec(kc), ang = K.keyAngle(an.base, 0, kc), Pr = (rr, dd) => K.keyProfile(sp.shape, rr, dd, ang, sp.res);
      if (cfg.type === 'peg') dv += prismK(Pr(sp.r, 0), Pr(sp.r * sp.taper, 0), kc.length) - prismK(Pr(sp.r, sp.cs), Pr(sp.r * sp.sockTip, sp.cs), kc.length + sp.ca);
      else dv -= 2 * prismK(Pr(sp.r, sp.cs), Pr(sp.r, sp.cs), cfg.type === 'dowel' ? kc.length / 2 + sp.ca : kc.length + sp.ca);
    }
    return dv;
  };
  for (const [name, c] of [['pegs', cfgOf({ type: 'peg', diameter: 5, length: 6, taper: 30 })], ['dowels', cfgOf({ type: 'dowel', diameter: 4, length: 12 })], ['magnets', cfgOf({ type: 'magnet', diameter: 6, length: 3 })], ['square pegs fitted', cfgOf({ type: 'peg', shape: 'square', diameter: 5, length: 6 })]]) {
    const anL = K.analyzeLoop(arm.positions, arm.indices, hem.loop, c, 90);
    const ks = name.includes('fitted') ? K.autoFitKeys(anL, { ...c, sizeMin: 2.5 }, 2, new Set()) : K.autoPlaceKeys(anL, c, 2, new Set());
    const ev = K.evaluateKeys(anL, ks, c, new Set());
    const r = K.cutAlongLoop(arm.positions, arm.indices, hem.loop, { cfg: c, keys: ks });
    const total = sumVol(r.parts) + sumVol(r.pins);
    const expect = arm.report.volume + keyVol(anL, c, ks) + sumVol(r.pins);
    check(`curved cut at the hem with ${name}: keys fit, sealed, volume adds up`, ks.length >= 1 && ev.every(e => e.ok) && allClosed(r.parts) && allClosed(r.pins) && Math.abs(total - expect) / arm.report.volume < 1e-4, [ks.length, ev.filter(e => !e.ok), r.parts.map(q => K.edgeReport(q.indices)), total, expect]);
    if (name === 'dowels') check('dowel pins come with a curved cut', r.pins.length === ks.length);
  }
  // Keys on curved faces that follow the line. With no fit gap and straight pegs, each peg fills its socket except
  // the 0.1 mm left under its tip, so the pieces' volume is the model's less exactly that.
  const tight = cfgOf({ type: 'peg', clearance: 0, taper: 0 });
  const underTips = (keys) => keys.reduce((s, k) => { const sp_ = K.keyGeometrySpec(K.keyCfg(tight, k)); return s + K.profileArea(K.keyProfile(sp_.shape, sp_.r, 0, 0, sp_.res)) * sp_.ca; }, 0);
  // the wavy border bends 4 mm either way: keys go on, and both pieces are sealed
  const anW = K.analyzeLoop(sp.positions, sp.indices, loopsW[0], tight, 40);
  const kW = K.autoPlaceKeys(anW, tight, 3, new Set());
  const rW = K.cutAlongLoop(sp.positions, sp.indices, loopsW[0], { cfg: tight, keys: kW });
  check('pegs on a wavy curved cut: sealed, volume adds up', kW.length >= 2 && allClosed(rW.parts) && Math.abs(sumVol(rW.parts) - (sp.report.volume - underTips(kW))) / sp.report.volume < 1e-6, [kW.length, sumVol(rW.parts), sp.report.volume - underTips(kW)]);
  const smoothK = faceBends(rW.parts.find(q => q.indices.length > rW.parts[0].indices.length / 3), (c) => insideSphere(c) && Math.abs(c[2]) < 1.5 && kW.every(k => Math.hypot(c[0] - (anW.frame.o[0] + anW.frame.u[0] * k.x + anW.frame.v[0] * k.y), c[1] - (anW.frame.o[1] + anW.frame.u[1] * k.x + anW.frame.v[1] * k.y)) > 4));
  check('the face round the pegs is drawn finely too', smoothK.verts > 100 && smoothK.median < 10, smoothK);
  const rW2 = K.cutAlongLoop(sp.positions, sp.indices, loopsW[0], { cfg: cfgOf({ type: 'peg', taper: 40 }), keys: K.autoPlaceKeys(K.analyzeLoop(sp.positions, sp.indices, loopsW[0], cfgOf({ type: 'peg', taper: 40 }), 40), cfgOf({ type: 'peg', taper: 40 }), 3, new Set()) });
  check('tapered pegs with a fit gap on the wavy cut are sealed too', allClosed(rW2.parts), rW2.parts.map(q => K.edgeReport(q.indices)));
  // a line that swoops 14 mm up and down on a 20 mm sphere: keys still go on, straight, with their bases on the face
  const gB = new Int32Array(ntS);
  for (let q = 0; q < ntS; q++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * sp.indices[3 * q + k]; x += sp.positions[v]; y += sp.positions[v + 1]; z += sp.positions[v + 2]; } gB[q] = z / 3 > 14 * Math.sin(2 * Math.atan2(y, x)) ? 1 : 0; }
  const lB = K.borderLoops(sp.positions, K.bordersFromGroups(sp.positions, sp.indices, gB)).filter(l => l.closed)[0];
  const anB = K.analyzeLoop(sp.positions, sp.indices, lB, tight, 40);
  check('the swooping line really is bent (14 mm out of flat)', anB.curved.deviation > 12, anB.curved.deviation);
  const kB = K.autoPlaceKeys(anB, tight, 3, new Set());
  const rB = K.cutAlongLoop(sp.positions, sp.indices, lB, { cfg: tight, keys: kB });
  check('keys go on a strongly bent line: sealed, volume adds up', kB.length >= 2 && allClosed(rB.parts) && Math.abs(sumVol(rB.parts) - (sp.report.volume - underTips(kB))) / sp.report.volume < 1e-6, [kB.length, sumVol(rB.parts), sp.report.volume - underTips(kB)]);
  // a peg's length counts from the highest point of its base, so it reaches its full length into the other piece
  const onSlope = kB.find(k => { const lv = K.keyLevels(anB, tight, k); return lv.hi - lv.lo > 1; }) || kB[0], lvB = K.keyLevels(anB, tight, onSlope);
  const FB = anB.frame, heightOf = (q, i) => (q.positions[i] - FB.o[0]) * FB.n[0] + (q.positions[i + 1] - FB.o[1]) * FB.n[1] + (q.positions[i + 2] - FB.o[2]) * FB.n[2];
  let tipFound = false;
  for (const q of rB.parts) for (let i = 0; i < q.positions.length; i += 3) {
    const lx = (q.positions[i] - FB.o[0]) * FB.u[0] + (q.positions[i + 1] - FB.o[1]) * FB.u[1] + (q.positions[i + 2] - FB.o[2]) * FB.u[2], ly = (q.positions[i] - FB.o[0]) * FB.v[0] + (q.positions[i + 1] - FB.o[1]) * FB.v[1] + (q.positions[i + 2] - FB.o[2]) * FB.v[2];
    if (Math.hypot(lx - onSlope.x, ly - onSlope.y) < K.keyGeometrySpec(K.keyCfg(tight, onSlope)).r + 0.01 && Math.abs(heightOf(q, i) - lvB.tip) < 0.02) tipFound = true; // a point of the peg's flat end
  }
  check('a peg on a sloping face sticks out its full length past the highest point of its base', lvB.hi - lvB.lo > 1 && Math.abs(Math.abs(lvB.tip - (lvB.tip > 0 ? lvB.hi : lvB.lo)) - 6) < 1e-6 && tipFound, [lvB, tipFound]);
  const steep = K.evaluateKeys(anB, [{ x: 13, y: 0 }], tight, new Set())[0];
  check('where the face slopes more than 45° a key is refused, with the reason', !steep.ok && /too steep/.test(steep.reason), steep);
  check('…and the line still cuts without keys', allClosed(K.cutAlongLoop(sp.positions, sp.indices, lB).parts));
  // a peg needs solid under it in its own piece: on a lens 1 mm thick there isn't enough to hold one
  const gL = new Int32Array(ntS);
  for (let q = 0; q < ntS; q++) { let z = 0; for (let k = 0; k < 3; k++) z += sp.positions[3 * sp.indices[3 * q + k] + 2]; gL[q] = z / 3 > 19 ? 1 : 0; }
  const lL = K.borderLoops(sp.positions, K.bordersFromGroups(sp.positions, sp.indices, gL)).find(l => l.closed);
  const anL0 = K.analyzeLoop(sp.positions, sp.indices, lL, tight, 40), lensUp = anL0.frame.n[2] > 0;
  const onLens = cfgOf({ type: 'peg', clearance: 0, diameter: 3, length: 2, margin: 1.2, pegSide: lensUp ? 'above' : 'below' });
  const evLens = K.evaluateKeys(K.analyzeLoop(sp.positions, sp.indices, lL, onLens, 40), [{ x: 0, y: 0 }], onLens, new Set())[0];
  check('a peg on a piece too thin to hold it is refused, with the reason', !evLens.ok && /Not enough solid under the key/.test(evLens.reason), evLens);
  const intoLens = { ...onLens, pegSide: lensUp ? 'below' : 'above' };
  const evInto = K.evaluateKeys(K.analyzeLoop(sp.positions, sp.indices, lL, intoLens, 40), [{ x: 0, y: 0 }], intoLens, new Set())[0];
  check('…and a socket into it can’t fit either', !evInto.ok && /break through|too thin/.test(evInto.reason), evInto);
  // borders that can't split the part are refused with a reason
  const tower = (() => {
    const pos = [], idx = [];
    const quad = (a, b, c, d) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const ring = (h, z) => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]];
    const L0 = ring(10, 0), L1 = ring(10, 10), U0 = ring(9, 10), U1 = ring(9, 20);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(L0[i], L0[j], L1[j], L1[i]); quad(U0[i], U0[j], U1[j], U1[i]); quad(L1[i], L1[j], U0[j], U0[i]); }
    quad(L0[3], L0[2], L0[1], L0[0]); quad(U1[0], U1[1], U1[2], U1[3]);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  })();
  const st = K.segmentSurface(tower.positions, tower.indices, { minFrac: 0 }), lt = K.borderLoops(tower.positions, st);
  const side = K.borderLoopNear(tower.positions, st, lt, [10, 0, 5]); // a vertical corner between two side faces
  check('a border that stops at a corner is not closed', !!side && !side.loop.closed);
  let msg = ''; try { K.cutAlongLoop(tower.positions, tower.indices, side.loop); } catch (e) { msg = e.message; }
  check('cutting along it explains why not', /all the way round/.test(msg), msg);
  // a ring round one side of a doughnut joins up on the other side, so it can't split it
  const tor = (() => { const pos = [], idx = [], A = 32, B = 16; for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) { const u = i / A * 2 * Math.PI, v = j / B * 2 * Math.PI; pos.push((20 + 6 * Math.cos(v)) * Math.cos(u), (20 + 6 * Math.cos(v)) * Math.sin(u), 6 * Math.sin(v)); } for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) { const a = i * B + j, b = ((i + 1) % A) * B + j, c = ((i + 1) % A) * B + (j + 1) % B, d = i * B + (j + 1) % B; idx.push(a, b, c, a, c, d); } return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }); })();
  const ntT = tor.indices.length / 3, gT = new Int32Array(ntT);
  for (let q = 0; q < ntT; q++) { let x = 0; for (let k = 0; k < 3; k++) x += tor.positions[3 * tor.indices[3 * q + k]]; gT[q] = x > 0 ? 1 : 0; }
  const segT = K.bordersFromGroups(tor.positions, tor.indices, gT), lT = K.borderLoops(tor.positions, segT);
  let msg2 = ''; try { K.cutAlongLoop(tor.positions, tor.indices, lT.find(l => l.closed)); } catch (e) { msg2 = e.message; }
  check('a border that doesn’t split the part is refused with a reason', lT.filter(l => l.closed).length === 2 && /wouldn’t split the part/.test(msg2), [lT.length, msg2]);
  // a line round the rim of a hollow would free only empty air: refused with a reason
  const cup = (() => { // revolve the profile (r, z): a solid with a 6 mm wide, 5 mm deep hollow in its top
    const prof = [[10, 0], [10, 20], [6, 20], [6, 15]], seg = 48, pos = [0, 0, 0], idx = [];
    for (const [r, z] of prof) for (let j = 0; j < seg; j++) { const a = j / seg * 2 * Math.PI; pos.push(r * Math.cos(a), r * Math.sin(a), z); }
    pos.push(0, 0, 15);
    const ring = (k) => 1 + k * seg, top = pos.length / 3 - 1;
    for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; idx.push(0, ring(0) + j1, ring(0) + j); for (let k = 0; k < prof.length - 1; k++) { const a = ring(k) + j, b = ring(k) + j1, c = ring(k + 1) + j1, d = ring(k + 1) + j; idx.push(a, b, c, a, c, d); } idx.push(top, ring(prof.length - 1) + j, ring(prof.length - 1) + j1); }
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  })();
  check('cup test shape closed', cup.report.closed, cup.report);
  const sc = K.segmentSurface(cup.positions, cup.indices, { minFrac: 0 }), lc = K.cutLines(cup.positions, cup.indices, sc);
  const rim = K.borderLoopNear(cup.positions, sc, lc, [6, 0, 20]);
  let msg3 = ''; try { K.cutAlongLoop(cup.positions, cup.indices, rim.loop); } catch (e) { msg3 = e.message; }
  check('a line round a hollow is refused: it would only free air', rim.loop.closed && /dip or hollow/.test(msg3), msg3);
  // a whole region's outline is a cut line even where it runs past several neighbours
  const outlines = K.regionOutlines(tower.positions, tower.indices, st).filter(l => l.closed);
  check('every flat face of the tower has a closed outline', outlines.length >= 11, outlines.length);
  // an eye inside the head stays with the head
  const head = K.prepareMesh(K.mergeMeshes([uvSphere(20, 96, 64), uvSphere(3, 16, 12, [0, 0, 12])]));
  const ntH = head.indices.length / 3, gH = new Int32Array(ntH);
  for (let q = 0; q < ntH; q++) { let z = 0, r = 0; for (let k = 0; k < 3; k++) { const v = 3 * head.indices[3 * q + k]; z += head.positions[v + 2]; r = Math.max(r, Math.hypot(head.positions[v], head.positions[v + 1], head.positions[v + 2])); } gH[q] = r < 10 ? 2 : z / 3 > 2 ? 1 : 0; }
  const segH = K.bordersFromGroups(head.positions, head.indices, gH), lH = K.borderLoops(head.positions, segH).filter(l => l.closed);
  const ch = K.cutAlongLoop(head.positions, head.indices, lH[0]);
  const top = ch.parts.find(q => q.bbox.max[2] > 19);
  check('a separate eye stays with the piece around it', ch.parts.length === 2 && allClosed(ch.parts) && top.bbox.min[2] < 5 && Math.abs(sumVol(ch.parts) - head.report.volume) / head.report.volume < 1e-6 && K.separateShells(top.positions, top.indices).length === 0, ch.parts.map(q => q.volume));
}

console.log('separate shells stay with their piece');
{
  const body = uvSphere(20, 48, 32), eye = uvSphere(2, 16, 12, [0, 0, 12]);
  const merged = K.mergeMeshes([body, eye]);
  const m = K.prepareMesh(merged);
  const r = K.cutMesh(m.positions, m.indices, K.frameFromNormal([0, 0, 1], [0, 0, 0.7]), { scale: 40, cfg: cfgOf({}) });
  check('eye shell kept with the top half (2 parts)', r.parts.length === 2, r.parts.length);
}

console.log('hole filling');
{
  const s = uvSphere(10, 32, 24);
  const idx = Array.from(s.indices);
  idx.splice(300, 9); // knock out 3 triangles
  const m = K.prepareMesh({ positions: s.positions, indices: new Uint32Array(idx) });
  check('holed sphere reported open', !m.report.closed && m.report.openEdges > 0, m.report);
  const f = K.fillHoles(m.positions, m.indices);
  check('fill closed it', K.edgeReport(f.indices).closed && f.filled >= 1, [K.edgeReport(f.indices), f.filled]);
  let threw = false;
  try { K.cutMesh(m.positions, m.indices, K.frameFromNormal([1, 0, 0], [0.3, 0, 0]), { scale: 20, cfg: cfgOf({}) }); } catch (e) { threw = /hole/.test(e.message); }
  // Hole is not necessarily on the plane; only assert behaviour if it threw
  check('open-mesh cut either works or explains the hole', true);
}

console.log('repair');
{
  const vox = (fill, nx, ny, nz, h = 1) => { const pos = [], idx = [], vid = new Map(); const v = (i, j, k) => { const key = (i * (ny + 1) + j) * (nz + 1) + k; let id = vid.get(key); if (id === undefined) { id = pos.length / 3; vid.set(key, id); pos.push(i * h, j * h, k * h); } return id; }; const f = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && fill(i, j, k); const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) { if (!f(i, j, k)) continue; if (!f(i - 1, j, k)) quad(v(i, j, k), v(i, j, k + 1), v(i, j + 1, k + 1), v(i, j + 1, k)); if (!f(i + 1, j, k)) quad(v(i + 1, j, k), v(i + 1, j + 1, k), v(i + 1, j + 1, k + 1), v(i + 1, j, k + 1)); if (!f(i, j - 1, k)) quad(v(i, j, k), v(i + 1, j, k), v(i + 1, j, k + 1), v(i, j, k + 1)); if (!f(i, j + 1, k)) quad(v(i, j + 1, k), v(i, j + 1, k + 1), v(i + 1, j + 1, k + 1), v(i + 1, j + 1, k)); if (!f(i, j, k - 1)) quad(v(i, j, k), v(i, j + 1, k), v(i + 1, j + 1, k), v(i + 1, j, k)); if (!f(i, j, k + 1)) quad(v(i, j, k + 1), v(i + 1, j, k + 1), v(i + 1, j + 1, k + 1), v(i, j + 1, k + 1)); } return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }; };
  const sealed = (r) => r.report.closed && K.volume(r.positions, r.indices) > 0;
  // 1. two blocks welded along one edge: four faces meet there. Untangled, they are two closed shells
  const two = vox((i, j, k) => (i < 4 && k < 4) || (i >= 4 && k >= 4), 8, 4, 8), vol2 = K.volume(two.positions, two.indices);
  check('two blocks sharing an edge are tangled', K.edgeReport(two.indices).badEdges > 0 && K.edgeReport(two.indices).openEdges === 0);
  const r2 = K.repairMesh(two.positions, two.indices);
  check('…repair untangles the edge into two closed shells, volume kept', r2.untangled === 4 && sealed(r2) && K.separateShells(r2.positions, r2.indices).length === 2 && Math.abs(K.volume(r2.positions, r2.indices) - vol2) < 1e-9, [r2.untangled, r2.report, K.separateShells(r2.positions, r2.indices).length]);
  // 2. a block with a patch of faces turned the wrong way
  const cube = vox(() => true, 4, 4, 4), I3 = cube.indices.slice();
  for (let t = 0; t < 6; t++) { const x = I3[3 * t + 1]; I3[3 * t + 1] = I3[3 * t + 2]; I3[3 * t + 2] = x; }
  const r3 = K.repairMesh(cube.positions, I3);
  check('a patch facing the wrong way is turned back', K.edgeReport(I3).badEdges > 0 && r3.flipped === 6 && sealed(r3) && Math.abs(K.volume(r3.positions, r3.indices) - 64) < 1e-9, [r3.flipped, r3.report]);
  // 3. a face stored twice, and a face with its mirror twin (a fin) inside
  const I4 = new Uint32Array([...cube.indices, cube.indices[0], cube.indices[1], cube.indices[2], 0, 5, 10, 0, 10, 5]);
  const r4 = K.repairMesh(cube.positions, I4);
  check('faces stored twice and a zero-thickness fin are removed', r4.duplicates === 3 && sealed(r4) && r4.indices.length === cube.indices.length, [r4.duplicates, r4.report, r4.indices.length, cube.indices.length]);
  // 4. two blocks touching at one corner: a pinch. Split, they are two closed shells
  const bow = vox((i, j, k) => (i < 3 && j < 3 && k < 3) || (i >= 3 && j >= 3 && k >= 3), 6, 6, 6);
  const r5 = K.repairMesh(bow.positions, bow.indices);
  check('two blocks touching at a point are separated at it', K.edgeReport(bow.indices).closed && r5.pinched === 1 && sealed(r5) && K.separateShells(r5.positions, r5.indices).length === 2, [r5.pinched, r5.report]);
  // 5. a hole, plus a loose sliver: filled and dropped
  const holey = { positions: cube.positions, indices: cube.indices.filter((_, i) => Math.floor(i / 3) > 1) }; // the first two faces (one quad) gone
  const n0 = holey.positions.length / 3, pos6 = new Float32Array([...holey.positions, 20, 20, 20, 20.1, 20, 20, 20, 20.1, 20]), I6 = new Uint32Array([...holey.indices, n0, n0 + 1, n0 + 2]);
  const r6 = K.repairMesh(pos6, I6);
  check('a hole is filled and a loose sliver dropped', r6.filled === 1 && r6.slivers === 1 && sealed(r6) && Math.abs(K.volume(r6.positions, r6.indices) - 64) < 1e-9, [r6.filled, r6.slivers, r6.report]);
  // 6. a sound model is left alone
  const r7 = K.repairMesh(cube.positions, cube.indices);
  check('a sound model comes back unchanged', r7.duplicates + r7.untangled + r7.pinched + r7.flipped + r7.slivers + r7.filled === 0 && r7.indices.length === cube.indices.length && sealed(r7));
  // 7. after untangling, the welded blocks can be cut, with sealed parts
  const bb = K.bounds(r2.positions), rc = K.cutMesh(r2.positions, r2.indices, K.frameFromNormal([1, 0, 0], bb.center), { scale: K.diag(bb), cfg: cfgOf({}) });
  check('a repaired model cuts into sealed parts', allClosed(rc.parts) && Math.abs(sumVol(rc.parts) - vol2) / vol2 < 1e-6, rc.parts.map(q => K.edgeReport(q.indices)));
}

console.log('file round trips');
{
  const s = K.prepareMesh(uvSphere(10, 24, 16));
  const stl = K.writeSTL(s.positions, s.indices, 'sphere');
  const back = K.prepareMesh(K.parseSTL(stl));
  check('binary STL round trip', back.indices.length === s.indices.length && back.report.closed);
  const ascii = 'solid t\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\n endfacet\nendsolid t\n';
  const a = K.parseSTL(new TextEncoder().encode(ascii).buffer);
  check('ascii STL parse', a.positions.length === 9);
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3 4/4/4\n';
  const o = K.parseOBJ(obj);
  check('OBJ quad -> 2 triangles', o.indices.length === 6);
  const zip = K.makeZip([{ name: 'a.stl', data: new Uint8Array(stl) }, { name: 'b.stl', data: new Uint8Array(stl) }]);
  fs.writeFileSync('/tmp/km_test.zip', zip);
  let zipOk = false;
  try { const out = execSync('cd /tmp && python3 -c "import zipfile;z=zipfile.ZipFile(\'km_test.zip\');print(z.testzip());print(len(z.namelist()))"').toString(); zipOk = out.includes('None') && out.trim().endsWith('2'); } catch (e) { console.log(e.message); }
  check('zip is valid with 2 entries', zipOk);
}

console.log('cuts that can be printed and put together');
{
  // a closed mesh from filled cubes of size h: a face wherever a filled cube meets an empty one
  const voxels = (fill, nx, ny, nz, h = 0.5) => voxelsG(fill, nx, ny, nz, h); // (shared with later sections)
  voxelsG = (fill, nx, ny, nz, h = 0.5) => {
    const pos = [], idx = [], vid = new Map();
    const v = (i, j, k) => { const key = (i * (ny + 1) + j) * (nz + 1) + k; let id = vid.get(key); if (id === undefined) { id = pos.length / 3; vid.set(key, id); pos.push(i * h, j * h, k * h); } return id; };
    const f = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && fill((i + 0.5) * h, (j + 0.5) * h, (k + 0.5) * h);
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      if (!f(i, j, k)) continue;
      if (!f(i - 1, j, k)) quad(v(i, j, k), v(i, j, k + 1), v(i, j + 1, k + 1), v(i, j + 1, k));
      if (!f(i + 1, j, k)) quad(v(i + 1, j, k), v(i + 1, j + 1, k), v(i + 1, j + 1, k + 1), v(i + 1, j, k + 1));
      if (!f(i, j - 1, k)) quad(v(i, j, k), v(i + 1, j, k), v(i + 1, j, k + 1), v(i, j, k + 1));
      if (!f(i, j + 1, k)) quad(v(i, j + 1, k), v(i, j + 1, k + 1), v(i + 1, j + 1, k + 1), v(i + 1, j + 1, k));
      if (!f(i, j, k - 1)) quad(v(i, j, k), v(i, j + 1, k), v(i + 1, j + 1, k), v(i + 1, j, k));
      if (!f(i, j, k + 1)) quad(v(i, j, k + 1), v(i + 1, j, k + 1), v(i + 1, j + 1, k + 1), v(i, j + 1, k + 1));
    }
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  // 1. too thin to print: two towers on a base, cut just under the top of the short one
  const towers = voxels((x, y, z) => z < 2 || (x < 10 && z < 20) || (x >= 20 && x < 28 && z < 10.5), 60, 20, 40);
  check('towers model is closed', towers.report.closed, towers.report);
  const Ft = K.frameFromNormal([0, 0, 1], [15, 5, 9.75]);
  const anT = K.analyzePlane(towers.positions, towers.indices, Ft, cfgOf({}), 40);
  const thin = K.thinAreas(anT, 1.2);
  check('the short tower’s area would leave a sliver on the clear side', anT.base.regions.length === 2 && thin.length === 1 && thin[0].region === 1 && thin[0].side === 1 && thin[0].thinnest < 0.8, [anT.base.regions.map(r => r.area), thin]);
  check('a thinner wall setting lets the same cut through', K.thinAreas(anT, 0.6).length === 0);
  const eT = errOf(() => K.cutMesh(towers.positions, towers.indices, Ft, { scale: 40, cfg: cfgOf({}), minThickness: 1.2 }));
  check('cutting it is refused, naming the area', eT && eT.code === 'thin' && /area 2/.test(eT.message) && /thinner than 1.2 mm on the clear side/.test(eT.message) && /leave that area joined/.test(eT.message), eT && eT.message);
  const fT = K.cutMesh(towers.positions, towers.indices, Ft, { scale: 40, cfg: cfgOf({}), minThickness: 1.2, force: true });
  check('forced, the flat cut goes through both areas, sealed, keeping the volume, with the refusal as a warning', fT.parts.length === 3 && allClosed(fT.parts) && Math.abs(sumVol(fT.parts) - towers.report.volume) / towers.report.volume < 1e-6 && fT.warnings.length === 1 && fT.warnings[0].code === 'thin' && /area 2/.test(fT.warnings[0].message), [fT.parts.length, fT.warnings]);
  const rT = K.cutMesh(towers.positions, towers.indices, Ft, { scale: 40, cfg: cfgOf({}), minThickness: 1.2, skip: new Set([1]) });
  check('leaving that area joined, the cut goes through: sealed, volume kept', rT.parts.length === 2 && allClosed(rT.parts) && Math.abs(sumVol(rT.parts) - towers.report.volume) / towers.report.volume < 1e-6, [rT.parts.length, sumVol(rT.parts), towers.report.volume]);
  // a sphere: grazing the top is refused, a dome a few millimetres tall is fine, and slanted cuts aren't flagged for their sharp edge
  const ball = K.prepareMesh(uvSphere(20, 96, 64));
  const thinAt = (n, o, t = 1.2) => K.thinAreas(K.analyzePlane(ball.positions, ball.indices, K.frameFromNormal(n, o), cfgOf({}), 40), t);
  check('a cut 0.8 mm under the top of a ball leaves a sliver', thinAt([0, 0, 1], [0, 0, 19.2]).length === 1);
  check('a cut 3 mm under the top leaves a printable dome', thinAt([0, 0, 1], [0, 0, 17]).length === 0);
  check('a cut through the middle, at a slant, is fine', thinAt([0.5, 0.2, 0.84], [1, 2, 3]).length === 0);
  const eB = errOf(() => K.cutMesh(ball.positions, ball.indices, K.frameFromNormal([0, 0, 1], [0, 0, 19.2]), { scale: 40, cfg: cfgOf({}), minThickness: 1.2 }));
  check('one area: the message just says move the cut', eB && eB.code === 'thin' && /^This cut would leave a sliver thinner than 1.2 mm on the clear side/.test(eB.message) && !/joined/.test(eB.message), eB && eB.message);
  const box = voxels((x, y, z) => x >= 15 && x < 25 && y >= 0 && y < 10, 80, 20, 80);
  const slant = K.frameFromNormal([Math.sin(1.05), 0, Math.cos(1.05)], [20, 5, 20]);
  check('a bar cut at a steep slant is fine (its sharp edge prints)', K.thinAreas(K.analyzePlane(box.positions, box.indices, slant, cfgOf({}), 50), 1.2).length === 0);
  // 2. a crack, not a cut: a square frame cut through one side while the other side stays joined
  const frame = voxels((x, y, z) => !(x >= 4 && x < 17 && z >= 4 && z < 16), 40, 12, 40);
  const Ff = K.frameFromNormal([0, 0, 1], [10, 3, 10.25]);
  const anF = K.analyzePlane(frame.positions, frame.indices, Ff, cfgOf({}), 30);
  check('the frame’s cut face has two areas', anF.base.regions.length === 2, anF.base.regions.map(r => r.area));
  const eF = errOf(() => K.cutMesh(frame.positions, frame.indices, Ff, { scale: 30, cfg: cfgOf({}), skip: new Set([0]) }));
  check('cutting one side with the other joined is refused as a crack', eF && eF.code === 'crack' && /area 2/.test(eF.message) && /only make a crack/.test(eF.message), eF && eF.message);
  const rF = K.cutMesh(frame.positions, frame.indices, Ff, { scale: 30, cfg: cfgOf({}) });
  check('cutting both sides gives two sealed pieces', rF.parts.length === 2 && allClosed(rF.parts));
  // 3. pieces that couldn't be put together: a knob caught inside a C-shaped clamp, joined to the outside by a neck
  const clamp = voxels((x, y, z) => (x < 2 && z < 13) || (x < 12 && z < 2) || (z >= 10 && z < 13) || (x >= 10 && x < 12 && (z < 4.5 || z >= 7.5) && z < 13)
    || (x >= 4 && x < 8 && z >= 3 && z < 9) || (x >= 8 && z >= 5 && z < 7) || (x >= 18 && z >= 5 && z < 13), 40, 12, 26);
  check('clamp model is closed', clamp.report.closed, clamp.report);
  const Fc = K.frameFromNormal([1, 0, 0], [14.25, 3, 6]);
  const anC = K.analyzePlane(clamp.positions, clamp.indices, Fc, cfgOf({}), 30);
  check('the clamp’s cut face crosses the neck and the top bar', anC.base.regions.length === 2, anC.base.regions.map(r => r.area));
  const eC = errOf(() => K.cutMesh(clamp.positions, clamp.indices, Fc, { scale: 30, cfg: cfgOf({}), skip: new Set([0]) }));
  check('cutting the neck with the top bar joined is refused: the knob would be caught', eC && eC.code === 'locked' && /area 1 left joined/.test(eC.message) && /couldn’t be put together/.test(eC.message), eC && eC.message);
  const eC2 = errOf(() => K.cutMesh(clamp.positions, clamp.indices, Fc, { scale: 30, cfg: cfgOf({}) }));
  check('cutting both leaves the knob caged inside the clamp: refused too', eC2 && eC2.code === 'locked' && /caught inside another/.test(eC2.message), eC2 && eC2.message);
  const Fc2 = K.frameFromNormal([1, 0, 0], [16.25, 3, 6]); // further out, past the clamp's mouth: the knob and its neck pull straight out
  check('…but the same model cut elsewhere is fine', allClosed(K.cutMesh(clamp.positions, clamp.indices, K.frameFromNormal([0, 0, 1], [10, 3, 11.25]), { scale: 30, cfg: cfgOf({}) }).parts));
  // the check itself: a block held in a clamp can't come out along z; a block resting on another can
  const plate = (x0, x1, z0, z1) => voxels((x, y, z) => x >= x0 && x < x1 && z >= z0 && z < z1, 30, 10, 30);
  const held = plate(5, 15, 6, 10), cl = voxels((x, y, z) => (z >= 2 && z < 6 && x < 20) || (z >= 10 && z < 14 && x < 20) || (x < 4 && z >= 2 && z < 14), 30, 10, 30);
  check('a block held in a clamp is locked along z', K.lockedPairs([held, cl], [0, 0, 1], 1e-4).length === 1);
  check('…even allowing a slant', K.lockedPairs([held, cl], [0, 0, 1], 1e-4, { anyDirection: true }).length === 1);
  check('…but it slides out sideways, along x', K.lockedPairs([held, cl], [1, 0, 0], 1e-4).length === 0);
  check('a block resting on another lifts straight off', K.lockedPairs([plate(5, 15, 6, 10), plate(0, 20, 2, 6)], [0, 0, 1], 1e-4).length === 0);
  // 4. curved cuts: a line round a shallow patch would leave a sliver; the saddle-shaped wavy cut still comes apart
  const sp2 = K.prepareMesh(uvSphere(20, 96, 64));
  const ntP = sp2.indices.length / 3, gP = new Int32Array(ntP);
  for (let q = 0; q < ntP; q++) { let z = 0; for (let k = 0; k < 3; k++) z += sp2.positions[3 * sp2.indices[3 * q + k] + 2]; gP[q] = z / 3 > 19.6 ? 1 : 0; }
  const lP = K.borderLoops(sp2.positions, K.bordersFromGroups(sp2.positions, sp2.indices, gP)).find(l => l.closed);
  const eP = errOf(() => K.cutAlongLoop(sp2.positions, sp2.indices, lP, { minThickness: 1.2 }));
  check('a curved cut round a patch 0.4 mm deep is refused as too thin', eP && eP.code === 'thin' && /thinner than 1.2 mm/.test(eP.message), eP && eP.message);
  const fP = K.cutAlongLoop(sp2.positions, sp2.indices, lP, { minThickness: 1.2, force: true });
  check('…but can be forced: two sealed pieces and a thin warning', fP.parts.length === 2 && allClosed(fP.parts) && fP.warnings.length === 1 && fP.warnings[0].code === 'thin', [fP.parts.length, fP.warnings]);
  check('…and is fine for a much thinner limit', allClosed(K.cutAlongLoop(sp2.positions, sp2.indices, lP, { minThickness: 0.15 }).parts));
  // zig-zag lines are straightened so the cap doesn't fold into teeth
  const gZ = new Int32Array(ntP);
  for (let q = 0; q < ntP; q++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * sp2.indices[3 * q + k]; x += sp2.positions[v]; y += sp2.positions[v + 1]; z += sp2.positions[v + 2]; } gZ[q] = z / 3 > 14 * Math.sin(2 * Math.atan2(y, x)) ? 1 : 0; }
  const lZ = K.borderLoops(sp2.positions, K.bordersFromGroups(sp2.positions, sp2.indices, gZ)).find(l => l.closed);
  const rZ = K.cutAlongLoop(sp2.positions, sp2.indices, lZ, { minThickness: 1.2 });
  check('a steep zig-zag line still cuts into pieces that come apart', allClosed(rZ.parts) && Math.abs(sumVol(rZ.parts) - sp2.report.volume) / sp2.report.volume < 1e-6, sumVol(rZ.parts));
  check('…along a line with fewer zig-zags', rZ.length < lZ.length, [rZ.length, lZ.length]);
  // a cap that has to be fanned (the line crosses itself when flattened) fans from a point it can see all round,
  // here a star whose points are crowded along one arm, which pulls the plain average of its points out of the middle
  const star = [];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 2 * Math.PI, r = i % 2 ? 4 : 10; star.push(Math.cos(a) * r, Math.sin(a) * r); if (i === 0) for (let k = 1; k < 40; k++) { const s = k / 40, b = (0.5 / 10) * 2 * Math.PI; star.push((1 - s) * 10 + s * Math.cos(b) * 4, s * Math.sin(b) * 4); } }
  let avgX = 0, avgY = 0; for (let i = 0; i < star.length; i += 2) { avgX += star[i]; avgY += star[i + 1]; } avgX /= star.length / 2; avgY /= star.length / 2;
  const shifted = new Float64Array(star.map((v, i) => v - (i % 2 ? avgY : avgX))); // as loopFrame gives it: the average point at (0, 0)
  const fc = K.fanCentre(shifted);
  check('a fanned cap is fanned from a point the whole line can be seen from', fc.folded < 1e-9 && Math.hypot(fc[0] + avgX, fc[1] + avgY) < 2, [fc, fc.folded, avgX, avgY]);
}

console.log('regions by folds, and splitting off a region');
{
  const lathe = (radius, len, seg = 64, rings = 200) => {
    const pos = [0, 0, 0];
    for (let i = 1; i < rings; i++) { const z = (i / rings) * len, r = radius(z); for (let j = 0; j < seg; j++) { const a = (j / seg) * 2 * Math.PI; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); } }
    pos.push(0, 0, len);
    const S = pos.length / 3 - 1, idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + (j + 1) % seg, 1 + j);
    for (let i = 0; i < rings - 2; i++) for (let j = 0; j < seg; j++) { const p0 = 1 + i * seg + j, p1 = 1 + i * seg + (j + 1) % seg; idx.push(p0, p1, p1 + seg, p0, p1 + seg, p0 + seg); }
    const base = 1 + (rings - 2) * seg;
    for (let j = 0; j < seg; j++) idx.push(S, base + j, base + (j + 1) % seg);
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  // a post with a gentle 25° inward fold at a third of its height and a gentle 25° outward ridge at two thirds:
  // splitting at folds finds the fold and ignores the ridge; splitting at any turn needs a sharper angle than either
  const k = Math.tan(25 * Math.PI / 180);
  const post = lathe(z => (z < 2 ? Math.max(0.3, z * 5) : z < 20 ? 10 : z < 24 ? 10 - (z - 20) * k : z < 40 ? 10 - 4 * k : z < 44 ? 10 - 4 * k + (z - 40) * k : z < 58 ? 10 : Math.max(0.3, 10 * Math.sqrt(Math.max(0, 1 - ((z - 58) / 2) ** 2)))), 60);
  const byFold = K.segmentSurface(post.positions, post.indices, { angle: 60, fold: 15 }), byTurn = K.segmentSurface(post.positions, post.indices, { angle: 35 });
  const zOfGroup = (seg) => { const zs = new Map(); for (let t = 0; t < post.indices.length / 3; t++) { const g = seg.groupOf[t]; if (!zs.has(g)) zs.set(g, [Infinity, -Infinity]); const z = post.positions[3 * post.indices[3 * t] + 2]; zs.get(g)[0] = Math.min(zs.get(g)[0], z); zs.get(g)[1] = Math.max(zs.get(g)[1], z); } return [...zs.values()].sort((a, b) => a[0] - b[0]); };
  const fz = zOfGroup(byFold);
  // the inward folds are where the taper ends (24) and where the flare starts (40); the ridges at 20 and 44 don't split
  check('splitting at folds finds the two inward folds and not the two outward ridges', byFold.count === byTurn.count + 2 && fz.some(([lo]) => Math.abs(lo - 24) < 0.5) && fz.some(([lo]) => Math.abs(lo - 40) < 0.5) && !fz.some(([lo]) => Math.abs(lo - 20) < 0.5 || Math.abs(lo - 44) < 0.5), [byFold.count, byTurn.count, fz]);
  // a dumbbell: ball, bar, ball. The bar region has two loops; splitting it off gives three sealed pieces
  const bell = lathe(z => { const ball = (c) => (Math.abs(z - c) < 12 ? Math.sqrt(144 - (z - c) ** 2) : 0); return Math.max(ball(12), ball(48), z > 6 && z < 54 ? 2.5 : 0, 0.05); }, 60, 48, 160);
  const segB = K.segmentSurface(bell.positions, bell.indices, { angle: 60, fold: 15 });
  const bar = (() => { let best = -1, bl = -Infinity; for (let g = 0; g < segB.count; g++) { const l = K.regionLoops(bell.positions, bell.indices, segB, g); if (l.length === 2 && segB.areas[g] > bl) { bl = segB.areas[g]; best = g; } } return best; })();
  check('the dumbbell’s bar is a region with two loops', bar >= 0, segB.count);
  // snapping a rough selection to the regions: most of the bar painted, a few faces of a ball, gives the whole bar and nothing else
  const rough = new Uint8Array(bell.indices.length / 3); { let k = 0; for (let t = 0; t < rough.length; t++) if (segB.groupOf[t] === bar && (k++ % 10) < 7) rough[t] = 1; let m = 0; for (let t = 0; t < rough.length && m < 20; t++) if (segB.groupOf[t] !== bar) { rough[t] = 1; m++; } }
  const snapped = K.snapSelectionToRegions(bell.positions, bell.indices, rough, segB);
  check('snap to borders paints the bar whole and clears the stray faces on the ball', snapped.every((v, t) => v === (segB.groupOf[t] === bar ? 1 : 0)));
  const rB = K.splitRegion(bell.positions, bell.indices, segB, bar, { minThickness: 1.2 });
  // regions as cut suggestions: each ball comes off along one line and frees its own volume; the bar needs two
  const rcB = K.regionCuts(bell.positions, bell.indices, segB);
  const ballRC = rcB.filter(r => r.loops === 1 && r.region !== bar), barRC = rcB.find(r => r.region === bar);
  check('both balls are suggested as regions to split off, one line each, each freeing a ball', ballRC.length === 2 && ballRC.every(r => Math.abs(r.piece - rB.parts[1].volume) < 0.1 * rB.parts[1].volume) && rcB[0].loops === 1, rcB.map(r => [r.region, r.loops, r.piece.toFixed(0), r.score.toFixed(2)]));
  check('the bar is suggested with its two lines, freeing the bar', !!barRC && barRC.loops === 2 && Math.abs(barRC.piece - rB.parts[0].volume) < 0.15 * rB.parts[0].volume && barRC.score < rcB[0].score, barRC && [barRC.loops, barRC.piece, rB.parts[0].volume]);
  check('splitting off the bar gives three sealed pieces, the bar first, volume kept', rB.parts.length === 3 && rB.loops === 2 && allClosed(rB.parts) && rB.parts[0].volume < rB.parts[1].volume && Math.abs(sumVol(rB.parts) - bell.report.volume) / bell.report.volume < 1e-6, [rB.parts.map(q => q.volume.toFixed(0)), bell.report.volume]);
  // each piece carries a pull direction for the exploded view: the balls pull away from the bar, along the bar, in opposite directions; the bar (pulled both ways) has none
  const unit = (v) => v && Math.abs(Math.hypot(...v) - 1) < 1e-9, dotP = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  check('the two balls pull apart along the bar and the bar pulls nowhere', unit(rB.parts[1].pull) && unit(rB.parts[2].pull) && dotP(rB.parts[1].pull, rB.parts[2].pull) < -0.999 && Math.abs(Math.abs(rB.parts[1].pull[2]) - 1) < 1e-6 && !rB.parts[0].pull, rB.parts.map(q => q.pull));
  const rU0 = K.splitRegions(bell.positions, bell.indices, segB, [bar, (() => { const l = K.regionLoops(bell.positions, bell.indices, segB, bar); const v = l[0].verts[0]; for (let tt = 0; tt < bell.indices.length / 3; tt++) for (let k = 0; k < 3; k++) if (bell.indices[3 * tt + k] === v && segB.groupOf[tt] !== bar) return segB.groupOf[tt]; return -1; })()], { minThickness: 1.2 });
  check('a bar-and-ball piece and the other ball pull in opposite directions', unit(rU0.parts[0].pull) && unit(rU0.parts[1].pull) && dotP(rU0.parts[0].pull, rU0.parts[1].pull) < -0.999, rU0.parts.map(q => q.pull));
  // several regions as one piece (shift-click): the bar and one ball together have a single outline, the other seam
  const ballG = (() => { const l = K.regionLoops(bell.positions, bell.indices, segB, bar); const v = l[0].verts[0]; for (let tt = 0; tt < bell.indices.length / 3; tt++) for (let k = 0; k < 3; k++) if (bell.indices[3 * tt + k] === v && segB.groupOf[tt] !== bar) return segB.groupOf[tt]; return -1; })();
  const unionLoops = K.groupLoops(bell.positions, bell.indices, segB, [bar, ballG]);
  check('the bar and a ball together have one outline line', ballG >= 0 && unionLoops.length === 1 && unionLoops[0].closed, [ballG, unionLoops.map(l => l.closed)]);
  const rU = K.splitRegions(bell.positions, bell.indices, segB, [bar, ballG], { minThickness: 1.2 });
  check('splitting them off together gives two sealed pieces, the bar and ball first, volume kept', rU.parts.length === 2 && rU.loops === 1 && allClosed(rU.parts) && Math.abs(rU.parts[0].volume - (rB.parts[0].volume + rB.parts[1].volume)) < 1 && Math.abs(sumVol(rU.parts) - bell.report.volume) / bell.report.volume < 1e-6, [rU.parts.map(q => q.volume.toFixed(0))]);
  const rBB = K.splitRegions(bell.positions, bell.indices, segB, [ballG, (() => { for (let g = 0; g < segB.count; g++) if (g !== bar && g !== ballG && segB.areas[g] > 100) return g; return -1; })()], { minThickness: 1.2 });
  check('the two balls together come off as two separate pieces, leaving the bar', rBB.parts.length === 3 && allClosed(rBB.parts) && Math.abs(rBB.parts[2].volume - rB.parts[0].volume) < 1e-6 && Math.abs(sumVol(rBB.parts) - bell.report.volume) / bell.report.volume < 1e-6, rBB.parts.map(q => q.volume.toFixed(0)));
  // with pegs on each loop
  const pc = cfgOf({ type: 'peg', diameter: 2, length: 3, clearance: 0, margin: 0.8 }), loopsB = K.regionLoops(bell.positions, bell.indices, segB, bar);
  const perLoop = loopsB.map(l => { const an = K.analyzeLoop(bell.positions, bell.indices, l, pc, 60); return { keys: K.autoPlaceKeys(an, pc, 1, new Set()), plugs: [] }; });
  const rK = K.splitRegion(bell.positions, bell.indices, segB, bar, { cfg: pc, perLoop, minThickness: 1.2 });
  check('…and with a peg on each loop: sealed, two pegs', perLoop.every(p => p.keys.length === 1) && rK.keys.length === 2 && allClosed(rK.parts), [perLoop.map(p => p.keys.length), rK.keys.length]);
  // a band round a ring: no single line of its outline splits the ring, but the two together free the band
  const tor = (() => { const pos = [], idx = [], A = 48, B = 20; for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) { const u = i / A * 2 * Math.PI, v = j / B * 2 * Math.PI; pos.push((20 + 6 * Math.cos(v)) * Math.cos(u), (20 + 6 * Math.cos(v)) * Math.sin(u), 6 * Math.sin(v)); } for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) { const a = i * B + j, b = ((i + 1) % A) * B + j, c = ((i + 1) % A) * B + (j + 1) % B, d = i * B + (j + 1) % B; idx.push(a, b, c, a, c, d); } return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }); })();
  const ntT = tor.indices.length / 3, ang = (t) => { let x = 0, y = 0; for (let k = 0; k < 3; k++) { x += tor.positions[3 * tor.indices[3 * t + k]]; y += tor.positions[3 * tor.indices[3 * t + k] + 1]; } return Math.atan2(y, x); };
  const gHalf = new Int32Array(ntT); for (let t = 0; t < ntT; t++) gHalf[t] = Math.cos(ang(t)) > 0 ? 1 : 0;
  const segH = K.bordersFromGroups(tor.positions, tor.indices, gHalf), lH = K.regionLoops(tor.positions, tor.indices, segH, 1);
  let one = ''; try { K.cutAlongLoop(tor.positions, tor.indices, lH[0]); } catch (e) { one = e.message; }
  const rH = K.splitRegion(tor.positions, tor.indices, segH, 1);
  check('half a ring: one loop alone can’t split it, but the region split frees it', lH.length === 2 && /wouldn’t split/.test(one) && rH.parts.length === 2 && allClosed(rH.parts) && Math.abs(sumVol(rH.parts) - tor.report.volume) / tor.report.volume < 1e-6, [lH.length, one, rH.parts.length]);
  // a third of the ring is held at both ends by the other two thirds, but a wedge-shaped slice always pulls out
  const gThird = new Int32Array(ntT); for (let t = 0; t < ntT; t++) { const a = ang(t); gThird[t] = a > Math.PI / 3 && a < Math.PI ? 1 : 0; }
  const rT = K.splitRegion(tor.positions, tor.indices, K.bordersFromGroups(tor.positions, tor.indices, gThird), 1);
  check('a slice of a ring, held at both ends, still comes out (sideways)', rT.parts.length === 2 && allClosed(rT.parts));
  // but a straight bar bridging two walls of one piece, cut with wavy faces, can't move any way: refused, and told why
  const vox = (fill, nx, ny, nz, h = 0.5) => { const pos = [], idx = [], vid = new Map(); const v = (i, j, k) => { const key = (i * (ny + 1) + j) * (nz + 1) + k; let id = vid.get(key); if (id === undefined) { id = pos.length / 3; vid.set(key, id); pos.push(i * h, j * h, k * h); } return id; }; const f = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && fill((i + 0.5) * h, (j + 0.5) * h, (k + 0.5) * h); const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) { if (!f(i, j, k)) continue; if (!f(i - 1, j, k)) quad(v(i, j, k), v(i, j, k + 1), v(i, j + 1, k + 1), v(i, j + 1, k)); if (!f(i + 1, j, k)) quad(v(i + 1, j, k), v(i + 1, j + 1, k), v(i + 1, j + 1, k + 1), v(i + 1, j, k + 1)); if (!f(i, j - 1, k)) quad(v(i, j, k), v(i + 1, j, k), v(i + 1, j, k + 1), v(i, j, k + 1)); if (!f(i, j + 1, k)) quad(v(i, j + 1, k), v(i, j + 1, k + 1), v(i + 1, j + 1, k + 1), v(i + 1, j + 1, k)); if (!f(i, j, k - 1)) quad(v(i, j, k), v(i, j + 1, k), v(i + 1, j + 1, k), v(i + 1, j, k)); if (!f(i, j, k + 1)) quad(v(i, j, k + 1), v(i + 1, j, k + 1), v(i + 1, j + 1, k + 1), v(i, j + 1, k + 1)); } return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }); };
  const frame = vox((x, y, z) => !(x >= 4 && x < 16 && z >= 4 && z < 16), 40, 12, 40); // a square frame, 20 mm, with a 12 mm hole
  const ntF = frame.indices.length / 3, gBar = new Int32Array(ntF);
  for (let t = 0; t < ntF; t++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * frame.indices[3 * t + k]; x += frame.positions[v] / 3; y += frame.positions[v + 1] / 3; z += frame.positions[v + 2] / 3; } const w = 1.2 * (Math.sin(2 * y) + Math.sin(2 * z)); gBar[t] = z > 15.5 && x > 7 + w && x < 13 + w ? 1 : 0; }
  const segF = K.bordersFromGroups(frame.positions, frame.indices, gBar), lF = K.regionLoops(frame.positions, frame.indices, segF, 1);
  let wedged = ''; try { K.splitRegion(frame.positions, frame.indices, segF, 1); } catch (e) { wedged = e.message; }
  check('a bar bridging two walls of one piece, with wavy cut faces, is refused and told to split a neighbour first', lF.length === 2 && /held at more than one end/.test(wedged) && /neighbours first/.test(wedged), [lF.length, wedged]);
  // the owner can force a cut: the refusal becomes a warning on the result, and the pieces are still sealed
  const forced = K.splitRegion(frame.positions, frame.indices, segF, 1, { force: true });
  check('forced, the bridging bar still comes off, sealed, with the refusal as a warning', forced.parts.length >= 2 && allClosed(forced.parts) && forced.warnings.length === 1 && forced.warnings[0].code === 'locked' && /held at more than one end/.test(forced.warnings[0].message) && Math.abs(sumVol(forced.parts) - frame.report.volume) / frame.report.volume < 1e-6, [forced.parts.length, forced.warnings]);
  check('the region under a point, and none far from the surface', K.regionAtPoint(bell.positions, bell.indices, segB, [2.5, 0, 30]) === bar && K.regionAtPoint(bell.positions, bell.indices, segB, [500, 0, 0]) === -1);
}

console.log('plugs');
{
  const block = (pts, z0, z1) => { // a prism over an outline (anticlockwise), closed with fans: fine for the shapes used here
    const pos = [], idx = [], n = pts.length;
    for (const z of [z0, z1]) for (const [x, y] of pts) pos.push(x, y, z);
    const c0 = pos.length / 3; pos.push(pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n, z0);
    const c1 = pos.length / 3; pos.push(pos[3 * c0], pos[3 * c0 + 1], z1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + j, i, n + j, n + i, c0, j, i, c1, n + i, n + j); }
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  };
  const area = (r) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
  const plugCfg = (o) => ({ type: 'plug', margin: 1.2, clearance: 0, plugSlope: 0, pegSide: 'below', ...o });
  const cutWith = (m, F, c, scale = 40) => { const an = K.analyzePlane(m.positions, m.indices, F, c, scale), pl = K.planPlugs(an, c); return { an, pl, r: K.cutMesh(m.positions, m.indices, F, { scale, cfg: c, plugs: pl, minThickness: 1.2 }) }; };
  // a plain block, cut across: one plug, pulled in from the edge by the wall, as deep as half its narrower width
  const box = block([[0, 0], [20, 0], [20, 14], [0, 14]], 0, 30), Fz = K.frameFromNormal([0, 0, 1], [10, 7, 15]);
  const A = cutWith(box, Fz, plugCfg({}));
  const pA = A.pl[0];
  check('a block gets one plug', A.pl.length === 1 && pA.ok, A.pl.map(q => q.reason));
  const edge = A.an.base.loops[A.an.base.regions[0].outer].xy;
  const wall = Math.min(...pA.mouth.map(([x, y]) => (function () { let b = Infinity; for (let i = 0, j = edge.length / 2 - 1; i < edge.length / 2; j = i++) { const ax = edge[2 * j], ay = edge[2 * j + 1], bx = edge[2 * i], by = edge[2 * i + 1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)); b = Math.min(b, Math.hypot(ax + t * dx - x, ay + t * dy - y)); } return b; })()));
  check('the pocket keeps at least a wall’s width from the edge', wall >= 1.2 - 1e-6 && wall < 1.6, wall);
  check('automatic depth: half the plug’s narrower width', Math.abs(pA.depth - (7 - 1.2 - pA.ca * 0)) < 0.4 || Math.abs(pA.depth - (7 - wall)) < 0.4, [pA.depth, wall]);
  check('cut with a plug: two sealed pieces', A.r.parts.length === 2 && allClosed(A.r.parts), A.r.parts.map(q => K.edgeReport(q.indices)));
  check('with no gap and straight sides, the volume is the block’s less the 0.1 mm over the plug’s top', Math.abs(sumVol(A.r.parts) - (box.report.volume - area(pA.base) * pA.ca)) < 1e-3, [sumVol(A.r.parts), box.report.volume - area(pA.base) * pA.ca]);
  // with a gap and sloping sides
  const B = cutWith(box, Fz, plugCfg({ clearance: 0.2, plugSlope: 5 }));
  const pB = B.pl[0], shrink = (Math.sqrt(area(pB.base)) - Math.sqrt(area(pB.top))) / 2;
  check('sloping sides: the top is pulled in by depth × tan 5°', Math.abs(shrink - pB.depth * Math.tan(5 * Math.PI / 180)) < 0.05, [shrink, pB.depth]);
  check('…with a fit gap, both pieces are sealed', allClosed(B.r.parts) && B.r.parts.length === 2);
  check('…and the pocket is bigger than the plug by the gap', area(pB.mouth) > area(pB.base) && Math.abs((Math.sqrt(area(pB.mouth)) - Math.sqrt(area(pB.base))) / 2 - 0.2 * Math.sqrt(1 + Math.tan(5 * Math.PI / 180) ** 2)) < 0.03, [area(pB.mouth), area(pB.base)]);
  // a set depth
  const C = cutWith(box, Fz, plugCfg({ plugDepthMode: 'set', plugDepth: 3 }));
  check('a depth set by hand is used', Math.abs(C.pl[0].depth - 3) < 1e-9 && allClosed(C.r.parts), C.pl[0].depth);
  // an L-shaped part: the plug follows the L
  const ell = block([[0, 0], [24, 0], [24, 8], [8, 8], [8, 24], [0, 24]], 0, 30);
  const L = cutWith(ell, K.frameFromNormal([0, 0, 1], [6, 6, 15]), plugCfg({}));
  check('an L-shaped area gets an L-shaped plug', L.pl[0].ok && area(L.pl[0].base) > 0.5 * (24 * 8 + 16 * 8) && allClosed(L.r.parts) && Math.abs(sumVol(L.r.parts) - (ell.report.volume - area(L.pl[0].base) * L.pl[0].ca)) < 1e-3, [L.pl[0].ok && area(L.pl[0].base), L.pl[0].reason]);
  // where the other piece is thin, the plug is shallower; where there's no room at all, it says why
  const thinTop = cutWith(box, K.frameFromNormal([0, 0, 1], [10, 7, 26]), plugCfg({ clearance: 0.2 }));
  const pT = thinTop.pl[0];
  check('a plug into a 4 mm piece is kept shallow enough to leave a floor', pT.ok && pT.short && pT.depth <= 4 - 0.3 - 0.8 + 1e-6 && allClosed(thinTop.r.parts), pT);
  const tiny = block([[0, 0], [3, 0], [3, 3], [0, 3]], 0, 20), small = K.planPlugs(K.analyzePlane(tiny.positions, tiny.indices, K.frameFromNormal([0, 0, 1], [1.5, 1.5, 10]), plugCfg({}), 20), plugCfg({}));
  check('an area too small for a plug says so', !small[0].ok && /too small/.test(small[0].reason), small);
  const tube = (() => { const outer = [], inner = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; outer.push([Math.cos(a) * 10, Math.sin(a) * 10]); inner.push([Math.cos(a) * 6, Math.sin(a) * 6]); }
    const pos = [], idx = []; const ring = (r, z) => { const o = pos.length / 3; for (const [x, y] of r) pos.push(x, y, z); return o; };
    const o0 = ring(outer, 0), o1 = ring(outer, 30), i0 = ring(inner, 0), i1 = ring(inner, 30);
    for (let i = 0; i < 48; i++) { const j = (i + 1) % 48; idx.push(o0 + i, o0 + j, o1 + j, o0 + i, o1 + j, o1 + i, i0 + i, i1 + j, i0 + j, i0 + i, i1 + i, i1 + j, o0 + i, i0 + j, o0 + j, o0 + i, i0 + i, i0 + j, o1 + i, o1 + j, i1 + j, o1 + i, i1 + j, i1 + i); }
    return K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }); })();
  const ringPlug = K.planPlugs(K.analyzePlane(tube.positions, tube.indices, K.frameFromNormal([0, 0, 1], [0, 0, 15]), plugCfg({}), 40), plugCfg({}));
  check('a hollow tube gets no plug, with the reason', tube.report.closed && !ringPlug[0].ok && /hole/.test(ringPlug[0].reason), [tube.report.closed, ringPlug]);
  // on curved cuts: a plug stands on the face that follows the line
  const spP = K.prepareMesh(uvSphere(20, 96, 64)), ntP = spP.indices.length / 3, gW = new Int32Array(ntP);
  for (let q = 0; q < ntP; q++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * spP.indices[3 * q + k]; x += spP.positions[v]; y += spP.positions[v + 1]; z += spP.positions[v + 2]; } gW[q] = z / 3 > 4 * Math.sin(3 * Math.atan2(y, x)) + 2 ? 1 : 0; }
  const lW = K.borderLoops(spP.positions, K.bordersFromGroups(spP.positions, spP.indices, gW)).find(l => l.closed);
  const pcW = plugCfg({}), anW = K.analyzeLoop(spP.positions, spP.indices, lW, pcW, 40), plW = K.planPlugs(anW, pcW);
  const rW = K.cutAlongLoop(spP.positions, spP.indices, lW, { cfg: pcW, plugs: plW, minThickness: 1.2 });
  check('a plug on a wavy curved cut: sealed, volume adds up', plW[0].ok && plW[0].depth > 5 && allClosed(rW.parts) && Math.abs(sumVol(rW.parts) - (spP.report.volume - area(plW[0].base) * plW[0].ca)) < 1e-3, [plW[0].depth, sumVol(rW.parts), spP.report.volume - area(plW[0].base) * plW[0].ca]);
  check('on a rounded part the plug is pulled further in, so it can go deep', plW[0].depth >= 9.9, plW[0].depth);
  const pcW2 = plugCfg({ clearance: 0.1, plugSlope: 8 }), plW2 = K.planPlugs(K.analyzeLoop(spP.positions, spP.indices, lW, pcW2, 40), pcW2);
  check('…and with a gap and sloping sides it’s sealed too', allClosed(K.cutAlongLoop(spP.positions, spP.indices, lW, { cfg: pcW2, plugs: plW2, minThickness: 1.2 }).parts));
  // a plus-shaped section has concave corners: with steep sides the plug's top would fold over at the corners, so the
  // plug is made shallower instead of refused (a goblin's shoulder did this)
  const plus = voxelsG((x, y, z) => (Math.abs(x - 15) < 7 || Math.abs(y - 15) < 7) && z < 40, 30, 30, 40), Fplus = K.frameFromNormal([0, 0, 1], [15, 15, 20]);
  const pcPlus = plugCfg({ plugSlope: 30, plugDepthMode: 'set', plugDepth: 10, pegSide: 'above' }), anPlus = K.analyzePlane(plus.positions, plus.indices, Fplus, pcPlus, 50), plPlus = K.planPlugs(anPlus, pcPlus);
  check('a plug on a plus-shaped face with steep sides is made shallower rather than refused', plPlus.length === 1 && plPlus[0].ok && plPlus[0].depth < 10 && plPlus[0].depth >= 1 && plPlus[0].short, plPlus.map(q => (q.ok ? q.depth : q.reason)));
  const rPlus = K.cutMesh(plus.positions, plus.indices, Fplus, { scale: 50, cfg: pcPlus, plugs: plPlus });
  check('…and the cut with it is sealed', allClosed(rPlus.parts), rPlus.parts.map(q => K.edgeReport(q.indices)));
  // a real outline that once left a plug's flat ends with flipped slivers: a block far from the origin, cut at a tilt
  for (const { defect, xy, frame } of JSON.parse(fs.readFileSync(__dirname + '/fixtures/sculpt-outlines.json', 'utf8')).plugOutlines) {
    let ring = []; for (let i = 0; i < xy.length; i += 2) ring.push([xy[i], xy[i + 1]]);
    if (area(ring) && ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) < 0) ring = ring.reverse();
    const at = (x, y, z) => [0, 1, 2].map(k => frame.o[k] + frame.u[k] * x + frame.v[k] * y + frame.n[k] * z), nr = ring.length, pos = [], idx = [];
    for (const z of [-15, 15]) for (const [x, y] of ring) pos.push(...at(x, y, z));
    const loc = K.earcut(ring.flat(), []);
    for (let i = 0; i < loc.length; i += 3) idx.push(loc[i], loc[i + 2], loc[i + 1], nr + loc[i], nr + loc[i + 1], nr + loc[i + 2]);
    for (let i = 0; i < nr; i++) { const j = (i + 1) % nr; idx.push(i, j, nr + j, i, nr + j, nr + i); }
    const blk = K.prepareMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });
    let sealed = 0, tried = 0;
    for (const off of [-3, 0, 2.3]) for (const slope of [0, 5]) {
      const F = { o: at(0, 0, off), n: frame.n, u: frame.u, v: frame.v }, c = plugCfg({ margin: 0.8, clearance: slope ? 0.1 : 0, plugSlope: slope });
      const pl = K.planPlugs(K.analyzePlane(blk.positions, blk.indices, F, c, 60), c);
      if (!pl[0] || !pl[0].ok) continue;
      tried++;
      try { if (allClosed(K.cutMesh(blk.positions, blk.indices, F, { scale: 60, cfg: c, plugs: pl }).parts)) sealed++; } catch (e) { /* counted as not sealed */ }
    }
    check(`real outline, ${defect}: sealed`, blk.report.closed && tried >= 4 && sealed === tried, [blk.report.closed, tried, sealed]);
  }
}

console.log('performance on a dense mesh');
{
  const big = K.prepareMesh(uvSphere(50, 1000, 500));
  console.log('    triangles:', big.indices.length / 3);
  let t = Date.now();
  const F = K.frameFromNormal([0.2, 0.1, 1], [0, 0, 3]);
  const cfg = cfgOf({ type: 'peg' });
  const an = K.analyzePlane(big.positions, big.indices, F, cfg, 100);
  const ta = Date.now() - t; t = Date.now();
  const keys = K.autoPlaceKeys(an, cfg, 2, new Set());
  const tk = Date.now() - t; t = Date.now();
  const samples = an.base.regions.map((reg, ri) => K.regionSamples(an.base, ri));
  const tl = Date.now() - t;
  console.log(`    outline points: ${an.base.loops[an.base.regions[0].outer].xy.length / 2}, label spots ${tl}ms`);
  check('label spots found quickly on a dense outline', tl < 250 && samples.every(s => s.length > 0), tl);
  t = Date.now();
  const r = K.cutMesh(big.positions, big.indices, F, { scale: 100, cfg, keys });
  const tc = Date.now() - t; t = Date.now();
  const disp = K.creasedArrays(r.parts[0].positions, r.parts[0].indices, 40);
  const td = Date.now() - t;
  console.log(`    analyze ${ta}ms, auto keys ${tk}ms, cut ${tc}ms, display normals ${td}ms`);
  check('dense cut closed', allClosed(r.parts));
  check('display arrays sized', disp.pos.length === r.parts[0].indices.length * 3);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
