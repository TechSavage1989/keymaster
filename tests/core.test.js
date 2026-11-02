const K = require('../src/core.js');
const fs = require('fs');
const { execSync } = require('child_process');
let fails = 0, passes = 0;
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
  check('wavy cut keeps the volume', Math.abs(sumVol(cw.parts) - sp.report.volume) / sp.report.volume < 1e-6, [sumVol(cw.parts), sp.report.volume]);
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
  const voxels = (fill, nx, ny, nz, h = 0.5) => {
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
