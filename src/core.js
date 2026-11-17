/* Keymaster geometry core. Pure JavaScript, no dependencies, so it can be tested in Node
   and later moved into a Web Worker unchanged. Units are millimeters throughout. */
const KMCore = (() => {
  'use strict';

  /* ---------- growable typed lists ---------- */
  class F64List {
    constructor(cap) { this.a = new Float64Array(Math.max(16, cap | 0)); this.n = 0; }
    reserve(extra) {
      if (this.n + extra <= this.a.length) return;
      let c = this.a.length * 2; while (c < this.n + extra) c *= 2;
      const b = new Float64Array(c); b.set(this.a.subarray(0, this.n)); this.a = b;
    }
    push3(x, y, z) { this.reserve(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3; return n / 3; }
  }
  class U32List {
    constructor(cap) { this.a = new Uint32Array(Math.max(16, cap | 0)); this.n = 0; }
    reserve(extra) {
      if (this.n + extra <= this.a.length) return;
      let c = this.a.length * 2; while (c < this.n + extra) c *= 2;
      const b = new Uint32Array(c); b.set(this.a.subarray(0, this.n)); this.a = b;
    }
    push3(x, y, z) { this.reserve(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3; }
    view() { return this.a.subarray(0, this.n); }
  }

  /* ---------- open-addressing map keyed by an ordered int pair ---------- */
  function nextPow2(n) { let p = 16; while (p < n) p *= 2; return p; }
  class PairMap {
    constructor(expected) { this._alloc(nextPow2(Math.ceil(Math.max(8, expected) * 2))); }
    _alloc(size) {
      this.mask = size - 1; this.ka = new Int32Array(size).fill(-1);
      this.kb = new Int32Array(size); this.val = new Int32Array(size);
      this.count = 0; this.limit = Math.floor(size * 0.7);
    }
    _slot(a, b) {
      let h = Math.imul(a ^ 0x5bd1e995, 0x9E3779B1) ^ Math.imul(b + 0x27d4eb2d, 0x85EBCA77);
      h ^= h >>> 15;
      const ka = this.ka, kb = this.kb, m = this.mask;
      let i = h & m;
      for (;;) {
        const k = ka[i];
        if (k === -1 || (k === a && kb[i] === b)) return i;
        i = (i + 1) & m;
      }
    }
    get(a, b) { const i = this._slot(a, b); return this.ka[i] === -1 ? -1 : this.val[i]; }
    set(a, b, v) {
      let i = this._slot(a, b);
      if (this.ka[i] === -1) {
        if (this.count + 1 > this.limit) { this._grow(); i = this._slot(a, b); }
        this.ka[i] = a; this.kb[i] = b; this.count++;
      }
      this.val[i] = v;
    }
    inc(a, b) {
      let i = this._slot(a, b);
      if (this.ka[i] === -1) {
        if (this.count + 1 > this.limit) { this._grow(); i = this._slot(a, b); }
        this.ka[i] = a; this.kb[i] = b; this.val[i] = 0; this.count++;
      }
      return ++this.val[i];
    }
    _grow() {
      const oka = this.ka, okb = this.kb, ov = this.val;
      this._alloc((this.mask + 1) * 2);
      for (let i = 0; i < oka.length; i++) {
        if (oka[i] === -1) continue;
        const j = this._slot(oka[i], okb[i]);
        this.ka[j] = oka[i]; this.kb[j] = okb[i]; this.val[j] = ov[i]; this.count++;
      }
    }
  }

  /* ---------- earcut-style polygon triangulation (with holes) ---------- */
  function earcut(data, holeIndices) {
    const dim = 2;
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    let outerNode = linkedList(data, 0, outerLen, dim, true);
    const triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    let minX = 0, minY = 0, invSize = 0;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = Infinity; minY = Infinity; let maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < outerLen; i += dim) {
        const x = data[i], y = data[i + 1];
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
      invSize = Math.max(maxX - minX, maxY - minY);
      invSize = invSize !== 0 ? 32767 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
    return triangles;
  }
  function linkedList(data, start, end, dim, clockwise) {
    let last;
    if (clockwise === (ringArea(data, start, end, dim) > 0)) {
      for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
      for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
    return last;
  }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    let p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeNode(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    let stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev, next = ear.next;
      if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
        triangles.push(prev.i / dim | 0, ear.i / dim | 0, next.i / dim | 0);
        removeNode(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
        else if (pass === 1) {
          ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
          earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
        } else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
        break;
      }
    }
  }
  function isEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    let p = c.next;
    while (p !== a) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
        pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function isEarHashed(ear, minX, minY, invSize) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
    let p = ear.prevZ, n = ear.nextZ;
    const hit = (q) => q !== a && q !== c && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1 &&
      pointInTriangle(ax, ay, bx, by, cx, cy, q.x, q.y) && area(q.prev, q, q.next) >= 0;
    while (p && p.z >= minZ && n && n.z <= maxZ) {
      if (hit(p)) return false; p = p.prevZ;
      if (hit(n)) return false; n = n.nextZ;
    }
    while (p && p.z >= minZ) { if (hit(p)) return false; p = p.prevZ; }
    while (n && n.z <= maxZ) { if (hit(n)) return false; n = n.nextZ; }
    return true;
  }
  function cureLocalIntersections(start, triangles, dim) {
    let p = start;
    do {
      const a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        triangles.push(a.i / dim | 0, p.i / dim | 0, b.i / dim | 0);
        removeNode(p); removeNode(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          let c = splitPolygon(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
          earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function eliminateHoles(data, holeIndices, outerNode, dim) {
    const queue = [];
    for (let i = 0, len = holeIndices.length; i < len; i++) {
      const start = holeIndices[i] * dim;
      const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
      const list = linkedList(data, start, end, dim, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (let i = 0; i < queue.length; i++) outerNode = eliminateHole(queue[i], outerNode);
    return outerNode;
  }
  function eliminateHole(hole, outerNode) {
    const bridge = findHoleBridge(hole, outerNode);
    if (!bridge) return outerNode;
    const bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    let p = outerNode;
    const hx = hole.x, hy = hole.y;
    let qx = -Infinity, m;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) return m;
        }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y;
    let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x &&
        pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) &&
          (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
          m = p; tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
  function indexCurve(start, minX, minY, invSize) {
    let p = start;
    do {
      if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
      p.prevZ = p.prev; p.nextZ = p.next; p = p.next;
    } while (p !== start);
    p.prevZ.nextZ = null; p.prevZ = null;
    sortLinked(p);
  }
  function sortLinked(list) {
    let numMerges, inSize = 1;
    do {
      let p = list, e, tail = null;
      list = null; numMerges = 0;
      while (p) {
        numMerges++;
        let q = p, pSize = 0;
        for (let i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
        let qSize = inSize;
        while (pSize > 0 || (qSize > 0 && q)) {
          if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; }
          else { e = q; q = q.nextZ; qSize--; }
          if (tail) tail.nextZ = e; else list = e;
          e.prevZ = tail; tail = e;
        }
        p = q;
      }
      tail.nextZ = null;
      inSize *= 2;
    } while (numMerges > 1);
    return list;
  }
  function zOrder(x, y, minX, minY, invSize) {
    x = (x - minX) * invSize | 0; y = (y - minY) * invSize | 0;
    x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
    y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
    return x | (y << 1);
  }
  function getLeftmost(start) {
    let p = start, leftmost = start;
    do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start);
    return leftmost;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
      (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
      (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
      ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
        (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
        (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
  }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
  function intersects(p1, q1, p2, q2) {
    const o1 = sgn(area(p1, q1, p2)), o2 = sgn(area(p1, q1, q2)), o3 = sgn(area(p2, q2, p1)), o4 = sgn(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
  }
  function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function intersectsPolygon(a, b) {
    let p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ?
      area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
      area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function middleInside(a, b) {
    let p = a, inside = false;
    const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
        (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function splitPolygon(a, b) {
    const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }
  function insertNode(i, x, y, last) {
    const p = createNode(i, x, y);
    if (!last) { p.prev = p; p.next = p; }
    else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeNode(p) {
    p.next.prev = p.prev; p.prev.next = p.next;
    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
  }
  function createNode(i, x, y) { return { i, x, y, prev: null, next: null, z: 0, prevZ: null, nextZ: null, steiner: false }; }
  function ringArea(data, start, end, dim) {
    let sum = 0;
    for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }

  /* ---------- file parsing ---------- */
  function parseSTL(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    if (buffer.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === buffer.byteLength) return readBinarySTL(dv, n);
    }
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    if (/^\s*solid/i.test(head) && /facet|vertex/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536))))) {
      const text = new TextDecoder().decode(bytes);
      const re = /vertex\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)/g;
      const out = [];
      let m;
      while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
      const usable = out.length - (out.length % 9);
      if (usable === 0) throw new Error('This STL file has no triangles in it.');
      return { positions: new Float32Array(out.slice(0, usable)), indices: null };
    }
    if (buffer.byteLength > 84) return readBinarySTL(dv, Math.floor((buffer.byteLength - 84) / 50));
    throw new Error('This file is not a readable STL.');
  }
  function readBinarySTL(dv, n) {
    const pos = new Float32Array(n * 9);
    let o = 84;
    for (let t = 0; t < n; t++) {
      o += 12;
      for (let k = 0; k < 9; k++) { pos[t * 9 + k] = dv.getFloat32(o, true); o += 4; }
      o += 2;
    }
    return { positions: pos, indices: null };
  }
  function parseOBJ(text) {
    const verts = [], idx = [];
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (line.length < 2) continue;
      const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1);
      if (c0 === 118 && (c1 === 32 || c1 === 9)) { // "v "
        const p = line.trim().split(/\s+/);
        verts.push(+p[1], +p[2], +p[3]);
      } else if (c0 === 102 && (c1 === 32 || c1 === 9)) { // "f "
        const p = line.trim().split(/\s+/);
        const nv = verts.length / 3;
        const f = [];
        for (let k = 1; k < p.length; k++) {
          let v = parseInt(p[k], 10);
          if (Number.isNaN(v)) continue;
          v = v < 0 ? nv + v : v - 1;
          f.push(v);
        }
        for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
      }
    }
    if (!idx.length) throw new Error('This OBJ file has no faces in it.');
    return { positions: new Float32Array(verts), indices: new Uint32Array(idx) };
  }

  /* ---------- mesh preparation ---------- */
  function bounds(P) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return { min: [x0, y0, z0], max: [x1, y1, z1], size: [x1 - x0, y1 - y0, z1 - z0], center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] };
  }
  function diag(b) { return Math.hypot(b.size[0], b.size[1], b.size[2]) || 1; }

  function weld(P, I, tol, f64 = false) {
    const n = P.length / 3;
    const inv = 1 / tol;
    const size = nextPow2(n * 2);
    const mask = size - 1;
    const table = new Int32Array(size).fill(-1);
    const remap = new Uint32Array(n);
    const qx = new Float64Array(n), qy = new Float64Array(n), qz = new Float64Array(n);
    const out = f64 ? new Float64Array(P.length) : new Float32Array(P.length);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(P[3 * i] * inv), y = Math.round(P[3 * i + 1] * inv), z = Math.round(P[3 * i + 2] * inv);
      let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
      h ^= h >>> 13;
      let s = h & mask;
      for (;;) {
        const k = table[s];
        if (k === -1) {
          table[s] = m; qx[m] = x; qy[m] = y; qz[m] = z;
          out[3 * m] = P[3 * i]; out[3 * m + 1] = P[3 * i + 1]; out[3 * m + 2] = P[3 * i + 2];
          remap[i] = m++; break;
        }
        if (qx[k] === x && qy[k] === y && qz[k] === z) { remap[i] = k; break; }
        s = (s + 1) & mask;
      }
    }
    const src = I || null;
    const nIdx = src ? src.length : n;
    const idx = new Uint32Array(nIdx);
    let w = 0;
    for (let t = 0; t < nIdx; t += 3) {
      const a = remap[src ? src[t] : t], b = remap[src ? src[t + 1] : t + 1], c = remap[src ? src[t + 2] : t + 2];
      if (a === b || b === c || a === c) continue;
      idx[w] = a; idx[w + 1] = b; idx[w + 2] = c; w += 3;
    }
    return { positions: out.slice(0, m * 3), indices: idx.slice(0, w) };
  }

  function volume(P, I) {
    let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }
  function volumeCentroid(P, I) {
    let v = 0, cx = 0, cy = 0, cz = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], qx = P[c], qy = P[c + 1], qz = P[c + 2];
      const d = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
      v += d; cx += d * (ax + bx + qx); cy += d * (ay + by + qy); cz += d * (az + bz + qz);
    }
    if (Math.abs(v) < 1e-12) { const b = bounds(P); return { volume: 0, centroid: b.center }; }
    return { volume: v / 6, centroid: [cx / (4 * v), cy / (4 * v), cz / (4 * v)] };
  }

  function edgeReport(I) {
    const em = new PairMap(I.length);
    for (let t = 0; t < I.length; t += 3) {
      em.inc(I[t], I[t + 1]); em.inc(I[t + 1], I[t + 2]); em.inc(I[t + 2], I[t]);
    }
    let open = 0, bad = 0;
    for (let t = 0; t < I.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = I[t + k], b = I[t + (k + 1) % 3];
        if (em.get(a, b) > 1) bad++;
        if (em.get(b, a) === -1) open++;
      }
    }
    return { openEdges: open, badEdges: bad, closed: open === 0 && bad === 0 };
  }

  function flipAll(I) { for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } }

  function prepareMesh(raw) {
    if (!raw.positions.length) throw new Error('The file has no geometry in it.');
    const b0 = bounds(raw.positions);
    const tol = Math.max(diag(b0) * 1e-7, 1e-9);
    const m = weld(raw.positions, raw.indices, tol);
    if (!m.indices.length) throw new Error('The model has no usable triangles.');
    const specks = removeSpecks(m);
    if (!m.indices.length) throw new Error('The model has no usable triangles.');
    const rep = edgeReport(m.indices);
    let vol = volume(m.positions, m.indices);
    let flipped = false;
    if (vol < 0) { flipAll(m.indices); vol = -vol; flipped = true; }
    return { positions: m.positions, indices: m.indices, report: { ...rep, flipped, volume: vol, specks } };
  }
  // Loose specks: separate shells too small to print, such as a single triangle stored back to back with a copy
  // of itself (zero volume). Real sculpt exports carry dozens of these, and their flat cross-sections confuse
  // capping. A shell is a speck when it encloses less than 0.001 mm³ (a 0.1 mm cube) and is under 0.5 mm across.
  function removeSpecks(m) {
    const P = m.positions, I = m.indices, nv = P.length / 3, nt = I.length / 3;
    const par = new Int32Array(nv);
    for (let i = 0; i < nv; i++) par[i] = i;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < nt; t++) { const a = find(I[3 * t]), b = find(I[3 * t + 1]), c = find(I[3 * t + 2]); par[a] = b; par[find(c)] = b; }
    const info = new Map();
    for (let t = 0; t < nt; t++) {
      const r = find(I[3 * t]);
      let s = info.get(r);
      if (!s) { s = { vol: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], tris: 0 }; info.set(r, s); }
      s.tris++;
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      s.vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { if (P[v + k] < s.lo[k]) s.lo[k] = P[v + k]; if (P[v + k] > s.hi[k]) s.hi[k] = P[v + k]; }
    }
    if (info.size < 2) return 0;
    const drop = new Set();
    for (const [r, s] of info) {
      const size = Math.max(s.hi[0] - s.lo[0], s.hi[1] - s.lo[1], s.hi[2] - s.lo[2]);
      if (Math.abs(s.vol) < 1e-3 && size < 0.5) drop.add(r);
    }
    if (!drop.size || drop.size === info.size) return 0;
    const keep = [];
    for (let t = 0; t < nt; t++) if (!drop.has(find(I[3 * t]))) keep.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]);
    // compact the vertices so dropped ones don't linger
    const remap = new Int32Array(nv).fill(-1), pos = [];
    const idx = new Uint32Array(keep.length);
    for (let i = 0; i < keep.length; i++) {
      const v = keep[i];
      if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      idx[i] = remap[v];
    }
    m.positions = new Float32Array(pos);
    m.indices = idx;
    return drop.size;
  }

  /* ---------- repair ----------
     Real exports come tangled: faces stored twice, two modelled parts welded along a seam so four faces meet at
     an edge, a patch facing the wrong way, loose slivers, holes. Cutting needs a surface where every
     edge has exactly two faces running opposite ways, so repairMesh works through the kinds in turn, up to a few
     passes (filling a hole can expose the next flaw), and says what it did. */
  function repairMesh(P, I, passes = 3) {
    let cur = { positions: P, indices: I };
    const totals = { duplicates: 0, untangled: 0, pinched: 0, flipped: 0, slivers: 0, filled: 0, skipped: 0 };
    for (let pass = 0; pass < passes; pass++) {
      const r = repairPass(cur.positions, cur.indices);
      for (const k of Object.keys(totals)) totals[k] += r[k];
      cur = r;
      if (r.report.closed || !(r.duplicates + r.untangled + r.pinched + r.flipped + r.slivers + r.filled)) break;
    }
    return { positions: cur.positions, indices: cur.indices, ...totals, report: cur.report };
  }
  // Half-edges of a triangle list grouped by their smaller vertex, each group sorted by the larger, so the faces
  // on any edge are a short scan. Half-edge i = 3t + k runs tris[i] -> tris[3t + (k + 1) % 3].
  function edgeTable(tris, nv) {
    const n = tris.length, lo = new Int32Array(n), hi = new Int32Array(n), start = new Int32Array(nv + 1), list = new Int32Array(n);
    for (let i = 0; i < n; i++) { const a = tris[i], b = tris[i - (i % 3) + (i + 1) % 3]; lo[i] = Math.min(a, b); hi[i] = Math.max(a, b); start[lo[i] + 1]++; }
    for (let v = 0; v < nv; v++) start[v + 1] += start[v];
    const fill = start.slice(0, nv);
    for (let i = 0; i < n; i++) list[fill[lo[i]]++] = i;
    for (let v = 0; v < nv; v++) { // sort each small group by the larger vertex (insertion sort: groups are a handful)
      for (let i = start[v] + 1; i < start[v + 1]; i++) { const x = list[i]; let j = i - 1; while (j >= start[v] && hi[list[j]] > hi[x]) { list[j + 1] = list[j]; j--; } list[j + 1] = x; }
    }
    const faces = (a, b) => { // half-edges on the undirected edge a-b
      const l = Math.min(a, b), h = Math.max(a, b), out = [];
      for (let i = start[l]; i < start[l + 1]; i++) { const x = list[i]; if (hi[x] === h) out.push(x); else if (hi[x] > h) break; }
      return out;
    };
    const forward = (i, a, b) => tris[i] === a; // does half-edge i run a -> b?
    return { faces, forward, lo, hi };
  }
  function repairPass(P, I) {
    let nv = P.length / 3, pos = Array.from(P), tris = [];
    // 1. faces stored twice: keep one; a face and its mirror twin are a zero-thickness fin, so both go
    const dropped = new Set();
    {
      const byMin = new Map();
      for (let t = 0; t < I.length / 3; t++) {
        const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
        if (a === b || b === c || a === c) { dropped.add(t); continue; }
        const s = [a, b, c].sort((x, y) => x - y), key = s[1] * nv + s[2];
        let m = byMin.get(s[0]); if (!m) byMin.set(s[0], m = new Map());
        const u = m.get(key);
        if (u === undefined) { m.set(key, t); continue; }
        const same = [0, 1, 2].some(r => I[3 * u] === I[3 * t + r] && I[3 * u + 1] === I[3 * t + (r + 1) % 3]);
        dropped.add(t); if (!same) dropped.add(u);
      }
    }
    const duplicates = dropped.size;
    for (let t = 0; t < I.length / 3; t++) if (!dropped.has(t)) tris.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]);
    let nt = tris.length / 3;
    // 2. edges with more than two faces, or two running the same way: pair the faces by which side their
    //    material lies on (sweeping round the edge from a face, its material is behind its normal). A face left
    //    without a partner keeps an open edge.
    let E = edgeTable(tris, nv);
    const pairOf = new Map(); // half-edge -> the half-edge it pairs with across a tangled edge
    const badVerts = new Set(), done = new Set();
    let untangled = 0;
    for (let i = 0; i < tris.length; i++) {
      const a = E.lo[i], b = E.hi[i], key = a * nv + b;
      if (done.has(key)) continue; done.add(key);
      const hs = E.faces(a, b);
      if (hs.length < 2) continue;
      if (hs.length === 2 && E.forward(hs[0], a, b) !== E.forward(hs[1], a, b)) continue; // an ordinary edge
      untangled++; badVerts.add(a); badVerts.add(b);
      const d = norm3([pos[3 * b] - pos[3 * a], pos[3 * b + 1] - pos[3 * a + 1], pos[3 * b + 2] - pos[3 * a + 2]]);
      const F = frameFromNormal(d, [pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]]);
      const ang = hs.map(h => { const t = Math.floor(h / 3), c = [0, 1, 2].map(k => tris[3 * t + k]).find(v => v !== a && v !== b); const r = [pos[3 * c] - F.o[0], pos[3 * c + 1] - F.o[1], pos[3 * c + 2] - F.o[2]]; return { h, th: Math.atan2(r[0] * F.v[0] + r[1] * F.v[1] + r[2] * F.v[2], r[0] * F.u[0] + r[1] * F.u[1] + r[2] * F.u[2]), fwd: E.forward(h, a, b) }; }).sort((x, y) => x.th - y.th);
      const n = ang.length, want = new Map();
      for (let j = 0; j < n; j++) { const f = ang[j], g = ang[(j + (f.fwd ? n - 1 : 1)) % n]; want.set(f.h, g.h); } // a→b faces look behind (−θ), b→a faces ahead
      for (const [f, g] of want) if (want.get(g) === f && f !== g) pairOf.set(f, g);
    }
    // round every vertex, group its faces by the edges that join them (ordinary edges, and the pairs chosen above),
    // and give each group after the first its own copy of the vertex. That separates the surfaces welded along a
    // tangled edge, and also two surfaces that touch at a single vertex (a pinch), which the hole filler can't close
    let pinched = 0;
    {
      const cstart = new Int32Array(nv + 1), clist = new Int32Array(tris.length);
      for (let i = 0; i < tris.length; i++) cstart[tris[i] + 1]++;
      for (let v = 0; v < nv; v++) cstart[v + 1] += cstart[v];
      const cfill = cstart.slice(0, nv);
      for (let i = 0; i < tris.length; i++) clist[cfill[tris[i]]++] = i;
      const splits = [], par = new Map();
      const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
      for (let v = 0; v < nv; v++) {
        if (cstart[v + 1] - cstart[v] < 2) continue;
        par.clear();
        for (let c = cstart[v]; c < cstart[v + 1]; c++) par.set(Math.floor(clist[c] / 3), Math.floor(clist[c] / 3));
        for (let c = cstart[v]; c < cstart[v + 1]; c++) {
          const corner = clist[c], t = Math.floor(corner / 3), k = corner % 3;
          for (const i of [3 * t + k, 3 * t + (k + 2) % 3]) { // the two edges of t that touch v
            const a = E.lo[i], b = E.hi[i], hs = E.faces(a, b);
            let mate = -1;
            if (hs.length === 2 && !pairOf.has(hs[0]) && !pairOf.has(hs[1]) && E.forward(hs[0], a, b) !== E.forward(hs[1], a, b)) mate = Math.floor((hs[0] === i ? hs[1] : hs[0]) / 3);
            else if (pairOf.has(i)) mate = Math.floor(pairOf.get(i) / 3);
            if (mate >= 0) { const x = find(t), y = find(mate); if (x !== y) par.set(x, y); }
          }
        }
        const groups = new Map();
        for (let c = cstart[v]; c < cstart[v + 1]; c++) { const t = Math.floor(clist[c] / 3), r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
        if (groups.size < 2) continue;
        let first = true;
        for (const [, g] of groups) { if (first) { first = false; continue; } splits.push([v, g]); if (!badVerts.has(v)) pinched++; }
      }
      for (const [v, g] of splits) { // applied once every vertex has been looked at, since each split renumbers faces
        const copy = pos.length / 3; pos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
        for (const t of g) for (let k = 0; k < 3; k++) if (tris[3 * t + k] === v) tris[3 * t + k] = copy;
      }
      nv = pos.length / 3;
    }
    // 3. orientation: walk each connected surface, turning faces to agree with their neighbours, then turn any
    //    closed surface that ends up inside out
    E = edgeTable(tris, nv);
    const comp = new Int32Array(nt).fill(-1), flip = new Uint8Array(nt);
    let flipped = 0, ncomp = 0;
    const flipTri = (t) => { const x = tris[3 * t + 1]; tris[3 * t + 1] = tris[3 * t + 2]; tris[3 * t + 2] = x; };
    const compOpen = [];
    for (let s = 0; s < nt; s++) {
      if (comp[s] >= 0) continue;
      const id = ncomp++, st = [s], mine = []; comp[s] = id;
      let open = false;
      while (st.length) {
        const t = st.pop(); mine.push(t);
        for (let k = 0; k < 3; k++) {
          const i = 3 * t + k, hs = E.faces(E.lo[i], E.hi[i]);
          if (hs.length !== 2) { open = true; continue; }
          const q = Math.floor((hs[0] === i ? hs[1] : hs[0]) / 3);
          if (comp[q] >= 0) continue;
          comp[q] = id;
          // the edge as t runs it now (t may have been turned since the table was built)
          const a0 = E.lo[i], b0 = E.hi[i];
          let fwd = false; for (let j = 0; j < 3; j++) if (tris[3 * t + j] === a0 && tris[3 * t + (j + 1) % 3] === b0) fwd = true;
          const a = fwd ? a0 : b0, b = fwd ? b0 : a0;
          let same = false; for (let j = 0; j < 3; j++) if (tris[3 * q + j] === a && tris[3 * q + (j + 1) % 3] === b) same = true; // uses a→b too: faces the other way
          if (same) { flipTri(q); flip[q] = 1; }
          st.push(q);
        }
      }
      let turned = 0; for (const t of mine) if (flip[t]) turned++;
      if (turned > mine.length / 2) { for (const t of mine) { flipTri(t); flip[t] ^= 1; } turned = mine.length - turned; } // the root was the odd one out
      let vol = 0;
      for (const t of mine) { const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2]; vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6; }
      if (!open && vol < 0) { for (const t of mine) { flipTri(t); flip[t] ^= 1; } turned = mine.length - turned; } // a closed surface facing in
      flipped += turned; compOpen[id] = open;
    }
    // 4. loose open slivers (under 0.5 mm across, not closed) go
    const lo = [], hi = [];
    for (let t = 0; t < nt; t++) { const c = comp[t]; if (!lo[c]) { lo[c] = [Infinity, Infinity, Infinity]; hi[c] = [-Infinity, -Infinity, -Infinity]; } for (let k = 0; k < 3; k++) { const v = 3 * tris[3 * t + k]; for (let j = 0; j < 3; j++) { if (pos[v + j] < lo[c][j]) lo[c][j] = pos[v + j]; if (pos[v + j] > hi[c][j]) hi[c][j] = pos[v + j]; } } }
    const gone = new Set();
    for (let c = 0; c < ncomp; c++) if (compOpen[c] && Math.max(hi[c][0] - lo[c][0], hi[c][1] - lo[c][1], hi[c][2] - lo[c][2]) < 0.5) gone.add(c);
    const kept = []; for (let t = 0; t < nt; t++) if (!gone.has(comp[t])) kept.push(tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]);
    const slivers = gone.size;
    // 5. holes
    const filled = fillHoles(new Float32Array(pos), new Uint32Array(kept));
    // compact: drop vertices nothing uses any more
    const remap = new Int32Array(nv).fill(-1), outPos = [], outIdx = new Uint32Array(filled.indices.length);
    for (let i = 0; i < filled.indices.length; i++) { const v = filled.indices[i]; if (remap[v] < 0) { remap[v] = outPos.length / 3; outPos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); } outIdx[i] = remap[v]; }
    const positions = new Float32Array(outPos), indices = outIdx;
    const report = edgeReport(indices);
    return { positions, indices, duplicates, untangled, pinched, flipped, slivers, filled: filled.filled, skipped: filled.skipped, report };
  }

  /* ---------- hole filling ---------- */
  function fillHoles(P, I) {
    const em = new PairMap(I.length);
    for (let t = 0; t < I.length; t += 3) { em.inc(I[t], I[t + 1]); em.inc(I[t + 1], I[t + 2]); em.inc(I[t + 2], I[t]); }
    const nxt = new Map();
    for (let t = 0; t < I.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = I[t + k], b = I[t + (k + 1) % 3];
        if (em.get(b, a) === -1) { // boundary edge a->b, hole polygon runs b->a
          if (nxt.has(b)) nxt.set(b, -1); else nxt.set(b, a);
        }
      }
    }
    const used = new Set();
    const tris = [];
    let filled = 0, skipped = 0;
    for (const start of nxt.keys()) {
      if (used.has(start) || nxt.get(start) === -1) continue;
      const ring = [];
      let q = start, ok = true;
      while (true) {
        if (used.has(q)) { ok = q === start; break; }
        used.add(q); ring.push(q);
        const nq = nxt.get(q);
        if (nq === undefined || nq === -1) { ok = false; break; }
        q = nq;
      }
      if (!ok || ring.length < 3) { skipped++; continue; }
      // Newell normal
      let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = 3 * ring[i], b = 3 * ring[(i + 1) % ring.length];
        nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
        ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
        nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
        cx += P[a]; cy += P[a + 1]; cz += P[a + 2];
      }
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const fr = frameFromNormal([nx, ny, nz], [cx / ring.length, cy / ring.length, cz / ring.length]);
      const flat = [];
      for (const v of ring) {
        const dx = P[3 * v] - fr.o[0], dy = P[3 * v + 1] - fr.o[1], dz = P[3 * v + 2] - fr.o[2];
        flat.push(dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2], dx * fr.v[0] + dy * fr.v[1] + dz * fr.v[2]);
      }
      const loc = earcut(flat);
      const out = [];
      let s = 0;
      for (let i = 0; i < loc.length; i += 3) s += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
      for (let i = 0; i < loc.length; i += 3) {
        if (s >= 0) out.push(ring[loc[i]], ring[loc[i + 1]], ring[loc[i + 2]]);
        else out.push(ring[loc[i]], ring[loc[i + 2]], ring[loc[i + 1]]);
      }
      fixTJunctions(out, ring);
      for (const v of out) tris.push(v);
      filled++;
    }
    const ni = new Uint32Array(I.length + tris.length);
    ni.set(I); ni.set(tris, I.length);
    return { positions: P, indices: ni, filled, skipped };
  }
  function tri2(f, a, b, c) { return (f[2 * b] - f[2 * a]) * (f[2 * c + 1] - f[2 * a + 1]) - (f[2 * c] - f[2 * a]) * (f[2 * b + 1] - f[2 * a + 1]); }

  // Earcut drops collinear or duplicate ring points. Re-insert them so the cap shares every edge with the side wall.
  function fixTJunctions(tris, ring) {
    const used = new Set(tris);
    let anyMissing = false;
    for (const v of ring) if (!used.has(v)) { anyMissing = true; break; }
    if (!anyMissing) return;
    const n = ring.length;
    let first = -1;
    for (let i = 0; i < n; i++) if (used.has(ring[i])) { first = i; break; }
    if (first < 0) return;
    const runs = [];
    let i = first;
    for (let step = 0; step < n;) {
      let j = (i + 1) % n, missing = [];
      step++;
      while (!used.has(ring[j]) && step < n + 1) { missing.push(ring[j]); j = (j + 1) % n; step++; }
      if (missing.length) runs.push([ring[i], missing, ring[j]]);
      i = j;
      if (i === first) break;
    }
    for (const [A, mids, B] of runs) {
      let found = false;
      for (let t = 0; t < tris.length && !found; t += 3) {
        for (let k = 0; k < 3; k++) {
          const p = tris[t + k], q = tris[t + (k + 1) % 3], x = tris[t + (k + 2) % 3];
          let chain = null;
          if (p === A && q === B) chain = [A, ...mids, B];
          else if (p === B && q === A) chain = [B, ...mids.slice().reverse(), A];
          if (!chain) continue;
          const repl = [];
          for (let c = 0; c + 1 < chain.length; c++) repl.push(chain[c], chain[c + 1], x);
          tris.splice(t, 3, ...repl);
          found = true; break;
        }
      }
    }
  }

  // Earcut can also leave a long cap edge running straight past ring points it still uses elsewhere, for example
  // when the straight sides of two square sockets line up. Split any cap edge that passes through such a point.
  function splitThroughPoints(tris, rings, xyOf) {
    const edges = new Set();
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) edges.add(tris[t + k] + ',' + tris[t + (k + 1) % 3]);
    const cand = new Set();
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (!edges.has(a + ',' + b) && !edges.has(b + ',' + a)) { cand.add(a); cand.add(b); }
    }
    if (!cand.size) return;
    const pts = [...cand].map(v => [v, xyOf(v)]);
    const queue = [];
    for (let t = 0; t < tris.length; t += 3) queue.push([tris[t], tris[t + 1], tris[t + 2]]);
    const out = [];
    let guard = queue.length * 4 + 1000;
    while (queue.length && guard-- > 0) {
      const tri = queue.pop();
      let hit = null;
      for (let k = 0; k < 3 && !hit; k++) {
        const p = tri[k], q = tri[(k + 1) % 3], x = tri[(k + 2) % 3];
        const P = xyOf(p), Q = xyOf(q), dx = Q[0] - P[0], dy = Q[1] - P[1], L2 = dx * dx + dy * dy;
        if (L2 <= 0) continue;
        for (const [v, V] of pts) {
          if (v === p || v === q || v === x) continue;
          const s = ((V[0] - P[0]) * dx + (V[1] - P[1]) * dy) / L2;
          if (s <= 1e-9 || s >= 1 - 1e-9) continue;
          const off = Math.abs((V[0] - P[0]) * dy - (V[1] - P[1]) * dx) / Math.sqrt(L2);
          if (off < 1e-7 * Math.sqrt(L2) + 1e-9) { hit = [p, v, q, x]; break; }
        }
      }
      if (hit) { const [p, v, q, x] = hit; queue.push([p, v, x], [v, q, x]); } else out.push(...tri);
    }
    if (guard <= 0) return; // pathological input: keep the original triangles
    tris.length = 0;
    for (const v of out) tris.push(v);
  }

  // True when triangles over loop points 0..L-1 form one clean disk: every loop edge used once, every
  // other edge used once in each direction (orientation is fixed afterwards, so either winding counts).
  function diskTriangulation(loc, L) {
    if (loc.length !== 3 * (L - 2)) return false;
    let rev = 0, fwd = 0;
    for (let i = 0; i < loc.length; i += 3) for (let k = 0; k < 3; k++) { const a = loc[i + k], b = loc[i + (k + 1) % 3]; if (b === (a + 1) % L) fwd++; else if (a === (b + 1) % L) rev++; }
    const flip = rev > fwd, seen = new Set();
    for (let i = 0; i < loc.length; i += 3) for (let k = 0; k < 3; k++) {
      let a = loc[i + k], b = loc[i + (k + 1) % 3];
      if (flip) { const s = a; a = b; b = s; }
      const e = a * L + b;
      if (seen.has(e) || a === b) return false;
      seen.add(e);
    }
    for (const e of seen) { const a = Math.floor(e / L), b = e % L; if (b !== (a + 1) % L && !seen.has(b * L + a)) return false; }
    for (let a = 0; a < L; a++) if (!seen.has(a * L + (a + 1) % L)) return false;
    return true;
  }
  // Last safety net for a cap: earcut can silently drop a sliver triangle where two ring points nearly touch
  // (seen on real sculpts, with points 0.001 mm apart). Compare the cap's boundary with the rings it should
  // fill and triangulate whatever loop is left over, so the cap always meets the side walls exactly.
  function patchCap(tris, rings, xyOf, wantCCW) {
    const cnt = new Map();
    const key = (a, b) => a + ',' + b;
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) { const e = key(tris[t + k], tris[t + (k + 1) % 3]); cnt.set(e, (cnt.get(e) || 0) + 1); }
    const need = new Set();
    rings.forEach((r, ri) => {
      // the cap's edge runs round the outer ring the same way as the cap faces, and round holes the other way
      let s = 0;
      for (let i = 0; i < r.length; i++) { const a = xyOf(r[i]), b = xyOf(r[(i + 1) % r.length]); s += a[0] * b[1] - b[0] * a[1]; }
      const ccw = s > 0, along = ri === 0 ? ccw === wantCCW : ccw !== wantCCW;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; need.add(along ? key(a, b) : key(b, a)); }
    });
    const loopEdges = [];
    for (const e of need) if (!cnt.has(e)) loopEdges.push(e.split(',').map(Number)); // boundary the cap is missing
    for (const [e] of cnt) {
      const [a, b] = e.split(',').map(Number);
      if (!cnt.has(key(b, a)) && !need.has(e)) loopEdges.push([b, a]); // cap boundary that shouldn't be there, reversed
    }
    if (!loopEdges.length) return 0;
    const out = new Map();
    for (const [a, b] of loopEdges) { if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
    let added = 0;
    for (const [start] of out) {
      while (out.get(start) && out.get(start).length) {
        const loop = [start];
        let v = out.get(start).pop(), guard = loopEdges.length + 1;
        while (v !== start && guard-- > 0) {
          loop.push(v);
          const nx = out.get(v);
          if (!nx || !nx.length) { loop.length = 0; break; }
          v = nx.pop();
        }
        if (loop.length < 3 || v !== start) continue;
        // triangulate the loop keeping its direction, so every new edge pairs with the edge it closes
        const flat = [];
        for (const id of loop) { const p = xyOf(id); flat.push(p[0], p[1]); }
        let loc = loop.length > 3 ? earcut(flat, []) : [0, 1, 2];
        if (!diskTriangulation(loc, loop.length)) { loc = []; for (let i = 1; i + 1 < loop.length; i++) loc.push(0, i, i + 1); }
        // Orient by topology, not area: these leftover loops are often slivers of zero width, where any
        // area test is meaningless. Triangles must run round the loop in its own order.
        const L = loop.length;
        let fwdE = 0, revE = 0;
        for (let i = 0; i < loc.length; i += 3) for (let k = 0; k < 3; k++) {
          const a = loc[i + k], b = loc[i + (k + 1) % 3];
          if (b === (a + 1) % L) fwdE++; else if (a === (b + 1) % L) revE++;
        }
        const rev = revE > fwdE;
        for (let i = 0; i < loc.length; i += 3) {
          const a = loc[i], b = loc[i + 1], c = loc[i + 2];
          if (rev) tris.push(loop[a], loop[c], loop[b]); else tris.push(loop[a], loop[b], loop[c]);
          added++;
        }
      }
    }
    return added;
  }

  /* ---------- frames and planes ---------- */
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function frameFromNormal(n, o) {
    n = norm3(n);
    const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm3(cross3(ref, n));
    const v = cross3(n, u); // u x v = n
    return { o: o.slice(), n, u, v };
  }
  function shiftFrame(F, d) { return { o: [F.o[0] + F.n[0] * d, F.o[1] + F.n[1] * d, F.o[2] + F.n[2] * d], n: F.n, u: F.u, v: F.v }; }

  /* ---------- plane sections ---------- */
  // Returns closed loops of the mesh cross-section. Each loop lists section-point ids and the triangle each segment came from.
  function computeSection(P, I, F, scale) { return buildSection(P, I, F, scale, 0); }
  function buildSection(P, I, F, scale, base) {
    const nv = P.length / 3, nt = I.length / 3;
    const nx = F.n[0], ny = F.n[1], nz = F.n[2];
    // Keep every vertex well clear of the plane. A vertex almost on it makes a cluster of section points closer
    // together than the exported float32 positions can tell apart (seen on real sculpts at 0.00001 mm), so move
    // the plane to the middle of the widest gap among nearby vertices. The move is at most W, a few microns.
    const tol = (scale || 1) * 1e-6, W = (scale || 1) * 2e-5;
    const dist = new Float64Array(nv);
    const near = [];
    for (let i = 0, j = 0; i < nv; i++, j += 3) {
      const d = (P[j] - F.o[0]) * nx + (P[j + 1] - F.o[1]) * ny + (P[j + 2] - F.o[2]) * nz - base;
      dist[i] = d;
      if (d > -W && d < W) near.push(d);
    }
    let shift = 0;
    if (near.some(d => d > -tol && d < tol)) {
      near.push(-W, W);
      near.sort((a, b) => a - b);
      let best = -1;
      for (let k = 0; k + 1 < near.length; k++) {
        const gap = near[k + 1] - near[k];
        if (gap > best) { best = gap; shift = (near[k] + near[k + 1]) / 2; }
      }
      for (let i = 0; i < nv; i++) dist[i] -= shift;
    }
    shift += base;
    // count crossing triangles
    let crossing = 0;
    for (let t = 0; t < nt; t++) {
      const sa = dist[I[3 * t]] < 0, sb = dist[I[3 * t + 1]] < 0, sc = dist[I[3 * t + 2]] < 0;
      if (sa !== sb || sa !== sc) crossing++;
    }
    const emap = new PairMap(crossing * 2 + 8);
    const pts = new F64List(crossing * 3 + 9);
    const segA = new Int32Array(crossing), segB = new Int32Array(crossing), segTri = new Int32Array(crossing);
    let ns = 0;
    const edgePoint = (i, j) => {
      const lo = i < j ? i : j, hi = i < j ? j : i;
      let id = emap.get(lo, hi);
      if (id !== -1) return id;
      const dl = dist[lo], dh = dist[hi];
      const t = dl / (dl - dh);
      id = pts.push3(P[3 * lo] + t * (P[3 * hi] - P[3 * lo]), P[3 * lo + 1] + t * (P[3 * hi + 1] - P[3 * lo + 1]), P[3 * lo + 2] + t * (P[3 * hi + 2] - P[3 * lo + 2]));
      emap.set(lo, hi, id);
      return id;
    };
    for (let t = 0; t < nt; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const da = dist[a] < 0, db = dist[b] < 0, dc = dist[c] < 0;
      if (da === db && da === dc) continue;
      let i0, i1, i2;
      if (da === db) { i0 = c; i1 = a; i2 = b; } else if (da === dc) { i0 = b; i1 = c; i2 = a; } else { i0 = a; i1 = b; i2 = c; }
      const p01 = edgePoint(i0, i1), p02 = edgePoint(i0, i2);
      if (dist[i0] < 0) { segA[ns] = p02; segB[ns] = p01; } else { segA[ns] = p01; segB[ns] = p02; }
      segTri[ns] = t; ns++;
    }
    const np = pts.n / 3;
    const res = { dist, shift, pts: pts.a, np, emap, segTri, loops: [], error: null };
    const next = new Int32Array(np).fill(-1), segOf = new Int32Array(np);
    for (let s = 0; s < ns; s++) {
      if (next[segA[s]] !== -1) { res.error = 'nonmanifold'; return res; }
      next[segA[s]] = segB[s]; segOf[segA[s]] = s;
    }
    const visited = new Uint8Array(np);
    const ox = F.o[0], oy = F.o[1], oz = F.o[2];
    const ux = F.u[0], uy = F.u[1], uz = F.u[2], vx = F.v[0], vy = F.v[1], vz = F.v[2];
    const PA = pts.a;
    for (let p = 0; p < np; p++) {
      if (visited[p]) continue;
      const ids = [], segs = [];
      let q = p;
      while (!visited[q]) {
        visited[q] = 1; ids.push(q); segs.push(segOf[q]);
        q = next[q];
        if (q === -1) { res.error = 'open'; return res; }
      }
      if (q !== p) { res.error = 'nonmanifold'; return res; }
      if (ids.length < 3) continue;
      const xy = new Float64Array(ids.length * 2);
      for (let k = 0; k < ids.length; k++) {
        const j = 3 * ids[k];
        const dx = PA[j] - ox, dy = PA[j + 1] - oy, dz = PA[j + 2] - oz;
        xy[2 * k] = dx * ux + dy * uy + dz * uz;
        xy[2 * k + 1] = dx * vx + dy * vy + dz * vz;
      }
      res.loops.push(makeLoop(ids, segs, xy));
    }
    return res;
  }

  // Indices of an outline's points with self-crossing tangles removed: at each crossing, drop the shorter arc
  // between the two crossing edges. Real sculpts have microscopic folds that make cut outlines cross themselves,
  // and earcut can return overlapping triangles for those.
  function untangledRing(xy) {
    let keep = [];
    for (let i = 0; i < xy.length / 2; i++) keep.push(i);
    for (let iter = 0; iter < 64 && keep.length > 3; iter++) {
      const sub = new Float64Array(keep.length * 2);
      keep.forEach((k, i) => { sub[2 * i] = xy[2 * k]; sub[2 * i + 1] = xy[2 * k + 1]; });
      const hits = findSelfCrossings(sub);
      if (!hits.length) break;
      const [k, m] = hits[0], n = keep.length;
      const inner = m - k; // points k+1..m lie between the two crossing edges on one side
      let drop;
      if (inner <= n - inner) { drop = new Set(); for (let i = k + 1; i <= m; i++) drop.add(i); }
      else { drop = new Set(); for (let i = m + 1; i < n; i++) drop.add(i); for (let i = 0; i <= k; i++) drop.add(i); }
      if (n - drop.size < 3) break;
      keep = keep.filter((_, i) => !drop.has(i));
    }
    return keep;
  }
  // Proper crossings between non-adjacent edges of one outline, found with a uniform grid.
  function findSelfCrossings(xy) {
    const n = xy.length / 2;
    if (n < 4) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
    for (let i = 0; i < n; i++) {
      const x = xy[2 * i], y = xy[2 * i + 1], j = (i + 1) % n;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      len += Math.hypot(xy[2 * j] - x, xy[2 * j + 1] - y);
    }
    const cell = Math.max(len / n * 2, Math.max(x1 - x0, y1 - y0) / 512, 1e-9);
    const cols = Math.floor((x1 - x0) / cell) + 1;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = Math.floor((Math.min(xy[2 * i], xy[2 * j]) - x0) / cell), bx = Math.floor((Math.max(xy[2 * i], xy[2 * j]) - x0) / cell);
      const ay = Math.floor((Math.min(xy[2 * i + 1], xy[2 * j + 1]) - y0) / cell), by = Math.floor((Math.max(xy[2 * i + 1], xy[2 * j + 1]) - y0) / cell);
      for (let cx = ax; cx <= bx; cx++) for (let cy = ay; cy <= by; cy++) { const key = cy * cols + cx; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(i); }
    }
    const seen = new Set(), hits = [];
    for (const list of grid.values()) {
      for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
        let k = list[p], m = list[q];
        if (k > m) { const s = k; k = m; m = s; }
        if (m === k + 1 || (k === 0 && m === n - 1)) continue;
        const key = k * n + m;
        if (seen.has(key)) continue;
        seen.add(key);
        const ax = xy[2 * k], ay = xy[2 * k + 1], bx = xy[2 * ((k + 1) % n)], by = xy[2 * ((k + 1) % n) + 1];
        const cx = xy[2 * m], cy = xy[2 * m + 1], dx = xy[2 * ((m + 1) % n)], dy = xy[2 * ((m + 1) % n) + 1];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (den === 0) continue;
        const tk = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const tm = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (tk > 1e-9 && tk < 1 - 1e-9 && tm > 1e-9 && tm < 1 - 1e-9) hits.push([k, m, tk, tm]);
      }
    }
    return hits;
  }
  function makeLoop(ids, segs, xy) {
    let a = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = xy.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      a += xy[2 * j] * xy[2 * i + 1] - xy[2 * i] * xy[2 * j + 1];
      const x = xy[2 * i], y = xy[2 * i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { ids, segs, xy, area: a / 2, bbox: [x0, y0, x1, y1] };
  }

  function pointInRing(xy, px, py) {
    let inside = false;
    const n = xy.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = xy[2 * i], yi = xy[2 * i + 1], xj = xy[2 * j], yj = xy[2 * j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inBox(b, x, y) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }
  function distToRing(xy, px, py) {
    let best = Infinity;
    const n = xy.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = xy[2 * j], ay = xy[2 * j + 1], bx = xy[2 * i], by = xy[2 * i + 1];
      const dx = bx - ax, dy = by - ay;
      const L = dx * dx + dy * dy;
      let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function buildRegions(loops) {
    const L = loops.length;
    const depth = new Int32Array(L), parent = new Int32Array(L).fill(-1);
    for (let i = 0; i < L; i++) {
      const li = loops[i], px = li.xy[0], py = li.xy[1], ai = Math.abs(li.area);
      let best = -1, bestArea = Infinity, count = 0;
      for (let j = 0; j < L; j++) {
        if (j === i) continue;
        const lj = loops[j], aj = Math.abs(lj.area);
        if (aj <= ai || !inBox(lj.bbox, px, py)) continue;
        if (pointInRing(lj.xy, px, py)) { count++; if (aj < bestArea) { bestArea = aj; best = j; } }
      }
      depth[i] = count; parent[i] = best;
    }
    // A loop inside an area's outline is a hole when it runs the opposite way. One running the same way is a
    // separate solid overlapping the first (real sculpts have these, such as a pin modelled inside a leg):
    // it becomes its own area, marked nested, and the outer area treats it as an obstacle for keys.
    const order = [...Array(L).keys()].sort((a, b) => depth[a] - depth[b]);
    let dom = 0; // solid outlines run the same way as the largest loop
    for (let i = 0; i < L; i++) if (Math.abs(loops[i].area) > Math.abs(dom)) dom = loops[i].area;
    const isOuter = new Uint8Array(L);
    const regions = [];
    const regionOfOuter = new Map();
    for (const i of order) {
      const pa = parent[i];
      const hole = pa >= 0 && isOuter[pa] && Math.sign(loops[i].area) !== Math.sign(loops[pa].area);
      if (hole) {
        const r = regions[regionOfOuter.get(pa)];
        r.holes.push(i); r.area -= Math.abs(loops[i].area);
      } else {
        isOuter[i] = 1;
        regionOfOuter.set(i, regions.length);
        const nested = pa >= 0 && isOuter[pa];
        // a lone loop running backwards is a hole whose containing outline couldn't be found (a speck of a void
        // touching the surface): it is still capped, facing the other way, but never gets keys
        const inverted = pa < 0 && Math.sign(loops[i].area) !== Math.sign(dom);
        regions.push({ outer: i, holes: [], islands: [], nested, inverted, area: Math.abs(loops[i].area), bbox: loops[i].bbox });
        if (nested) regions[regionOfOuter.get(pa)].islands.push(i);
      }
    }
    regions.sort((a, b) => b.area - a.area);
    return regions;
  }
  function regionContains(loops, r, x, y) {
    if (!inBox(r.bbox, x, y) || !pointInRing(loops[r.outer].xy, x, y)) return false;
    for (const h of r.holes) if (inBox(loops[h].bbox, x, y) && pointInRing(loops[h].xy, x, y)) return false;
    return true;
  }
  function regionAt(sec, x, y) { // the innermost area containing the point (an overlapping inner solid wins)
    let best = -1;
    for (let i = 0; i < sec.regions.length; i++) {
      if ((best < 0 || sec.regions[i].area < sec.regions[best].area) && regionContains(sec.loops, sec.regions[i], x, y)) best = i;
    }
    return best;
  }
  function regionClearance(loops, r, x, y) {
    let d = distToRing(loops[r.outer].xy, x, y);
    for (const h of r.holes) d = Math.min(d, distToRing(loops[h].xy, x, y));
    if (r.islands) for (const h of r.islands) d = Math.min(d, distToRing(loops[h].xy, x, y));
    return d;
  }
  // Grid of points inside one area, each with its distance to the area's edge. Computed once per analysis
  // so the label spot can be re-picked cheaply whenever keys move.
  function regionSamples(sec, ri, target = 500) {
    const reg = sec.regions[ri];
    const [x0, y0, x1, y1] = reg.bbox;
    const w = x1 - x0, hgt = y1 - y0;
    const h = Math.max(1e-9, Math.sqrt((w * hgt) / target));
    // a label doesn't need exact clearance, so measure it against thinned-out outlines (dense sculpts can have tens of thousands of points)
    const thin = (xy) => {
      const n = xy.length / 2, step = Math.ceil(n / 1500);
      if (step <= 1) return xy;
      const o = [];
      for (let i = 0; i < n; i += step) o.push(xy[2 * i], xy[2 * i + 1]);
      return o;
    };
    const rings = [reg.outer, ...reg.holes, ...(reg.islands || [])].map(li => thin(sec.loops[li].xy));
    const out = [];
    for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) {
      if (!regionContains(sec.loops, reg, x, y) || (reg.islands && reg.islands.length && regionAt(sec, x, y) !== ri)) continue;
      let clear = Infinity;
      for (const r of rings) clear = Math.min(clear, distToRing(r, x, y));
      out.push({ x, y, clear });
    }
    if (!out.length) {
      // a sliver thinner than the grid: fall back to the midpoint of its outline's longest chord through the first vertex
      const xy = sec.loops[reg.outer].xy, n = xy.length / 2;
      let bx = xy[0], by = xy[1], bd = -1;
      for (let i = 1; i < n; i++) { const d = Math.hypot(xy[2 * i] - xy[0], xy[2 * i + 1] - xy[1]); if (d > bd) { bd = d; bx = xy[2 * i]; by = xy[2 * i + 1]; } }
      out.push({ x: (xy[0] + bx) / 2, y: (xy[1] + by) / 2, clear: 0 });
    }
    return out;
  }
  // The roomiest spot in an area, staying clear of keys (each treated as a disc of radius avoidR).
  function pickLabelPoint(samples, keys, avoidR) {
    let best = samples[0], bestS = -Infinity;
    for (const s of samples) {
      let score = s.clear;
      for (const k of keys || []) score = Math.min(score, Math.hypot(s.x - k.x, s.y - k.y) - avoidR);
      if (score > bestS) { bestS = score; best = s; }
    }
    return { x: best.x, y: best.y };
  }
  function section(P, I, F, scale) {
    const s = computeSection(P, I, F, scale);
    if (s.error) return { error: s.error, loops: [], regions: [] };
    return { error: null, loops: s.loops, regions: buildRegions(s.loops) };
  }

  /* ---------- keys ---------- */
  const KEY_DEFAULTS = {
    peg: { diameter: 5, length: 6 },
    dowel: { diameter: 4, length: 12 },
    magnet: { diameter: 6, length: 3 },
  };
  function keyGeometrySpec(cfg) {
    const r = cfg.diameter / 2, c = cfg.clearance, ca = cfg.clearance + 0.1;
    // Taper (pegs only): percent the tip narrows, 0 straight to 100 a point (kept at 2% of the width so the tip
    // stays a real, printable outline). Older settings stored it as on/off, which meant 20%.
    const pct = cfg.type !== 'peg' ? 0 : typeof cfg.taper === 'number' ? Math.max(0, Math.min(100, cfg.taper)) : cfg.taper ? 20 : 0;
    const taper = Math.max(0.02, 1 - pct / 100);
    const match = pct > 0 && cfg.taperSocket !== false; // socket narrows with the peg, or stays straight
    // The fit gap is meant at right angles to the wall: on a sloping wall, a gap c measured across is only c·cosθ
    // at right angles, so grow a matching socket by c / cosθ, using the steepest slope of the shape.
    const slope = cfg.length > 0 ? (r * (1 - taper)) / cfg.length : 0;
    const cs = match ? c * Math.sqrt(1 + slope * slope) : c;
    const shape = shapeFor(cfg);
    const res = profileRes(r + cs);
    const sock = keyProfile(shape, r, cs, 0, res);
    let sockets; // [{side:-1|+1, depth}]
    if (cfg.type === 'peg') {
      const s = cfg.pegSide === 'above' ? -1 : +1; // socket goes into the side opposite the peg
      sockets = [{ side: s, depth: cfg.length + ca }];
    } else if (cfg.type === 'dowel') sockets = [{ side: -1, depth: cfg.length / 2 + ca }, { side: +1, depth: cfg.length / 2 + ca }];
    else sockets = [{ side: -1, depth: cfg.length + ca }, { side: +1, depth: cfg.length + ca }];
    const fit = profileFit(sock);
    return { r, c, cs, ca, taper, taperPct: pct, sockTip: match ? taper : 1, sockets, shape, res, outer: shape === 'round' ? r + cs : fit.outer, inner: shape === 'round' ? r + cs : fit.inner };
  }

  /* ---------- key shapes ----------
     Every shape is defined by its half-width r and an outward offset d, so a socket is the peg grown by exactly
     the clearance on every side (scaling would leave thin gaps on shapes like the cross). Vertex count depends
     only on the shape and res, so the top and bottom rings of a tapered key always pair up. All shapes are
     star-shaped around the key centre, which the cap fans and wall orientation in cutMesh rely on. */
  const KEY_SHAPES = ['round', 'square', 'hexagon', 'cross', 'oval', 'slot', 'dshape'];
  const MAGNET_SHAPES = ['round', 'square'];
  function shapeFor(cfg) {
    if (cfg.shape === 'bar') return 'bar'; // an engraved mark's segment, whatever the key type
    const s = KEY_SHAPES.includes(cfg.shape) ? cfg.shape : 'round';
    if (cfg.type === 'peg' && s === 'round') return 'dshape'; // (1.97) a peg holds the piece from turning: never round (the owner: "no plug or key can be perfectly or nearly circular")
    return cfg.type === 'magnet' && !MAGNET_SHAPES.includes(s) ? 'round' : s;
  }
  function profileRes(rad) { return Math.max(20, Math.min(56, Math.round((2 * Math.PI * rad) / 0.5))); }
  function keyProfile(shape, r, d = 0, angle = 0, res = profileRes(r + d)) {
    const R = r + d, out = [];
    const arc = (cx, cy, rad, a0, a1, n, closed) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (closed ? i / n : i / (n - 1)); out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
    switch (shape) {
      case 'square': out.push([R, -R], [R, R], [-R, R], [-R, -R]); break;
      case 'bar': { const w = 0.28 * r + d; out.push([R, -w], [R, w], [-R, w], [-R, -w]); break; } // a stroke of an engraved digit: 2r long, 0.56r thick
      case 'hexagon': { const q = R * 2 / Math.sqrt(3); arc(0, 0, q, 0, 2 * Math.PI, 6, true); break; } // across flats = 2R
      case 'cross': {
        const w = 0.38 * r + d; // arm half-thickness
        out.push([R, -w], [R, w], [w, w], [w, R], [-w, R], [-w, w], [-R, w], [-R, -w], [-w, -w], [-w, -R], [w, -R], [w, -w]);
        break;
      }
      case 'oval': { // ellipse 3:2, grown along its true normals so the gap is even all round
        const a = 1.5 * r, b = r;
        for (let i = 0; i < res; i++) {
          const t = (i / res) * 2 * Math.PI, nx = b * Math.cos(t), ny = a * Math.sin(t), nl = Math.hypot(nx, ny);
          out.push([a * Math.cos(t) + d * nx / nl, b * Math.sin(t) + d * ny / nl]);
        }
        break;
      }
      case 'slot': { const h = Math.max(4, Math.round(res / 2)); arc(r, 0, R, -Math.PI / 2, Math.PI / 2, h, false); arc(-r, 0, R, Math.PI / 2, Math.PI * 1.5, h, false); break; }
      case 'dshape': { const f = Math.min(0.5 * r + d, R * 0.999), a0 = Math.acos(f / R); arc(0, 0, R, a0, 2 * Math.PI - a0, res, false); break; } // flat side at +x
      default: arc(0, 0, R, 0, 2 * Math.PI, res, true);
    }
    if (!angle) return out;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    return out.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
  }
  function profileFit(prof) { // outer: farthest point; inner: nearest edge, measured from the key centre
    let outer = 0, inner = Infinity;
    for (let i = 0; i < prof.length; i++) {
      const [ax, ay] = prof[i], [bx, by] = prof[(i + 1) % prof.length];
      outer = Math.max(outer, Math.hypot(ax, ay));
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let s = L > 0 ? -(ax * dx + ay * dy) / L : 0; s = s < 0 ? 0 : s > 1 ? 1 : s;
      inner = Math.min(inner, Math.hypot(ax + s * dx, ay + s * dy));
    }
    return { outer, inner };
  }
  function profileArea(prof) { let a = 0; for (let i = 0; i < prof.length; i++) { const [ax, ay] = prof[i], [bx, by] = prof[(i + 1) % prof.length]; a += ax * by - bx * ay; } return a / 2; }
  // Long direction of an area, from the second moments of its outline. Near-round areas get 0 so keys don't spin as the plane moves.
  function regionAngle(sec, ri) {
    const reg = sec.regions[ri];
    if (reg._angle !== undefined) return reg._angle;
    const xy = sec.loops[reg.outer].xy, n = xy.length / 2;
    let A = 0, cx = 0, cy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x0 = xy[2 * j], y0 = xy[2 * j + 1], x1 = xy[2 * i], y1 = xy[2 * i + 1], c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
      sxx += (y0 * y0 + y0 * y1 + y1 * y1) * c; syy += (x0 * x0 + x0 * x1 + x1 * x1) * c; sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
    }
    let ang = 0;
    if (Math.abs(A) > 1e-12) {
      A /= 2; cx /= 6 * A; cy /= 6 * A;
      const Ixx = sxx / 12 - A * cy * cy, Iyy = syy / 12 - A * cx * cx, Ixy = sxy / 24 - A * cx * cy; // Ixx = ∫y², Iyy = ∫x²
      const mxx = Iyy, myy = Ixx; // spread along x and along y
      const tr = mxx + myy, det = mxx * myy - Ixy * Ixy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
      if (l2 > 0 && l1 / l2 > 1.2) ang = 0.5 * Math.atan2(2 * Ixy, mxx - myy);
    }
    reg._angle = ang;
    return ang;
  }
  function keyAngle(sec, ri, cfg) {
    if (shapeFor(cfg) === 'round') return 0;
    const base = cfg.align === false || ri < 0 || !sec.regions[ri] ? 0 : regionAngle(sec, ri);
    return base + ((cfg.turn || 0) * Math.PI) / 180;
  }
  // Outline points of a key's footprint (socket size), spaced evenly, for checking it against an area's edge.
  function footprintOf(spec, angle) {
    const prof = keyProfile(spec.shape, spec.r, spec.cs, angle, spec.res);
    let per = 0;
    for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const step = per / 40, pts = [];
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i], b = prof[(i + 1) % prof.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    return { round: spec.shape === 'round', outer: spec.outer, inner: spec.inner, pts };
  }
  // Smallest gap between the key's footprint at (x, y) and the area's edge. Negative when the footprint pokes out.
  // `need` is the gap the caller requires: a key comfortably inside skips the detailed outline check.
  // With exact set, measure the whole outline even once it's known to fail, so near misses can be ranked.
  function footprintClear(sec, reg, x, y, fp, need, exact) {
    const c = regionClearance(sec.loops, reg, x, y);
    if (fp.round || c - fp.outer >= need) return c - fp.outer;
    if (c < fp.inner) return c - fp.inner;
    let best = Infinity;
    for (const [px, py] of fp.pts) {
      if (!regionContains(sec.loops, reg, x + px, y + py)) { if (!exact) return -1; best = Math.min(best, -regionClearance(sec.loops, reg, x + px, y + py)); continue; }
      best = Math.min(best, regionClearance(sec.loops, reg, x + px, y + py));
      if (best < need && !exact) return best;
    }
    return best;
  }
  function depthPlan(cfg) {
    const spec = keyGeometrySpec(cfg);
    const floor = Math.max(0.8, cfg.margin * 0.75);
    const plan = [];
    for (const s of spec.sockets) {
      plan.push({ side: s.side, depth: s.depth * 0.5, need: 'wall' });
      plan.push({ side: s.side, depth: s.depth, need: 'wall' });
      plan.push({ side: s.side, depth: s.depth + floor, need: 'floor' });
    }
    return plan;
  }
  function analyzePlane(P, I, F, cfg, scale) {
    const base = section(P, I, F, scale);
    const depth = [];
    if (!base.error && cfg.type !== 'none') {
      for (const d of depthPlan(cfg)) {
        const s = section(P, I, shiftFrame(F, d.side * d.depth), scale);
        depth.push({ ...d, sec: s });
      }
    }
    const an = { frame: F, base, depth };
    Object.defineProperty(an, '_src', { value: { P, I, F, scale, cfg, cache: new Map() } }); // for keys with their own settings
    return an;
  }
  // Settings a key may change for itself; the key type and the side pegs go on stay the same for the whole cut.
  const KEY_OVERRIDES = ['shape', 'diameter', 'length', 'clearance', 'taper', 'taperSocket', 'turn', 'align'];
  function keyCfg(cfg, key) {
    if (!key || (!key.o && !key.a)) return cfg;
    const out = { ...cfg };
    if (key.a) { out.diameter = key.a.diameter; out.length = key.a.length; } // the size picked to fit its area
    if (key.o) for (const f of KEY_OVERRIDES) if (key.o[f] !== undefined) out[f] = key.o[f]; // what the owner set
    return out;
  }
  // The depth sections a key's own sockets need. They match the analysis when its depths do; otherwise they are
  // sectioned once and cached on the analysis.
  function depthFor(an, kcfg) {
    const src = an._src, plan = depthPlan(kcfg);
    if (!src || an.base.error || kcfg.type === 'none' || an.curved) return an.depth;
    const sig = plan.map(d => `${d.side}:${d.depth.toFixed(4)}:${d.need}`).join('|');
    if (sig === depthPlan(src.cfg).map(d => `${d.side}:${d.depth.toFixed(4)}:${d.need}`).join('|')) return an.depth;
    if (!src.cache.has(sig)) src.cache.set(sig, plan.map(d => ({ ...d, sec: section(src.P, src.I, shiftFrame(src.F, d.side * d.depth), src.scale) })));
    return src.cache.get(sig);
  }
  function keyScore(an, cfg, x, y, skip, spec = keyGeometrySpec(cfg), fps, exact, depth = an.depth) {
    const m = cfg.margin;
    const ri = regionAt(an.base, x, y);
    if (ri < 0) return { ok: false, reason: 'Not on the cut face', region: -1, score: -Infinity };
    if (skip && skip.has(ri)) return { ok: false, reason: 'In an area you chose not to cut', region: ri, score: -Infinity };
    if (an.base.regions[ri].inverted) return { ok: false, reason: 'Not on the cut face', region: -1, score: -Infinity };
    if (an.base.regions[ri].nested) return { ok: false, reason: 'On a part of the model that overlaps another', region: ri, score: -Infinity };
    let fp = fps && fps[ri];
    if (!fp) { fp = footprintOf(spec, keyAngle(an.base, ri, cfg)); if (fps) fps[ri] = fp; }
    let score = footprintClear(an.base, an.base.regions[ri], x, y, fp, m, exact);
    if (score < m) return { ok: false, reason: 'Too close to the edge', region: ri, score, slack: score - m };
    let slack = score - m;
    if (an.curved) {
      const c = curvedKeyCheck(an, cfg, spec, x, y, keyAngle(an.base, ri, cfg));
      if (!c.ok) return { ok: false, reason: c.reason, region: ri, score: -Infinity, slack: c.slack };
      return { ok: true, reason: '', region: ri, score: Math.min(score, m + c.slack), slack: Math.min(slack, c.slack) };
    }
    for (const d of depth) {
      if (d.sec.error) continue;
      const rj = regionAt(d.sec, x, y);
      if (rj < 0) return { ok: false, reason: d.need === 'floor' ? 'Socket would break through the surface' : 'Socket would break through the side', region: ri, score: -Infinity };
      const need = d.need === 'wall' ? m * 0.75 : 0;
      const cl = footprintClear(d.sec, d.sec.regions[rj], x, y, fp, need, exact);
      if (d.need === 'wall' && cl < need) return { ok: false, reason: 'Wall around the socket is too thin', region: ri, score: cl, slack: cl - need };
      if (d.need === 'floor' && cl < 0) return { ok: false, reason: 'Socket would break through the surface', region: ri, score: -Infinity, slack: cl };
      if (d.need === 'wall') score = Math.min(score, cl);
      slack = Math.min(slack, cl - need);
    }
    return { ok: true, reason: '', region: ri, score, slack };
  }
  function evaluateKeys(an, keys, cfg, skip) {
    const spec = keyGeometrySpec(cfg), fps = [];
    const specs = keys.map(k => (k.o || k.a ? keyGeometrySpec(keyCfg(cfg, k)) : spec));
    const res = keys.map((k, i) => {
      if (!k.o && !k.a) return keyScore(an, cfg, k.x, k.y, skip, spec, fps);
      const kc = keyCfg(cfg, k);
      return keyScore(an, kc, k.x, k.y, skip, specs[i], null, false, depthFor(an, kc));
    });
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (Math.hypot(keys[i].x - keys[j].x, keys[i].y - keys[j].y) < specs[i].outer + specs[j].outer + cfg.margin) {
        for (const k of [i, j]) if (res[k].ok) res[k] = { ...res[k], ok: false, reason: 'Overlaps another key' };
      }
    }
    return res;
  }
  /* Keys sized to fit each area, within what prints reliably. Tries sizes from the largest allowed down to the
     smallest, and keeps the first that fits. Pegs are 1.2 times as long as they are wide; dowel pins 2.5 times;
     magnets come from standard disc sizes. */
  const PRINTERS = { resin: { min: 1, gap: 0.1, wall: 0.8 }, fdm: { min: 2.5, gap: 0.2, wall: 1.2 } };
  const KEY_SIZES = [15, 12, 10, 8, 7, 6, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.6, 1.2, 1];
  const MAGNET_SIZES = [[10, 3], [8, 3], [6, 3], [5, 2], [4, 2], [3, 1.5], [3, 1], [2, 1]]; // diameter × thickness, mm
  function sizeLadder(cfg) {
    const max = cfg.sizeMax || cfg.diameter, min = cfg.sizeMin || PRINTERS[cfg.printer === 'resin' ? 'resin' : 'fdm'].min;
    if (cfg.type === 'magnet') return MAGNET_SIZES.filter(([d]) => d <= max + 1e-9 && d >= Math.min(min, 2) - 1e-9);
    const ds = [max, ...KEY_SIZES.filter(d => d < max - 1e-9 && d >= min - 1e-9)];
    const len = (d) => cfg.type === 'dowel' ? Math.max(2, Math.round(d * 2.5 * 2) / 2) : Math.max(1, Math.round(d * (cfg.lenRatio || 1.2) * 2) / 2); // (a block key is longer for its width, as cast kits make them: lenRatio)
    return ds.map(d => [d, len(d)]);
  }
  function autoFitKeys(an, cfg, perRegion, skip) {
    const keys = [], empty = [];
    if (cfg.type === 'none' || an.base.error) { keys.empty = empty; return keys; }
    const ladder = sizeLadder(cfg);
    an.base.regions.forEach((reg, ri) => {
      if ((skip && skip.has(ri)) || reg.nested || reg.inverted) return;
      // the widest key that could fit (twice the clearance at the area's roomiest spot, less wall and gap), and no
      // more than half the area's width, so the walls round it stay sturdy; magnets hold better the bigger they are
      let room = 0;
      for (const s of regionSamples(an.base, ri)) room = Math.max(room, s.clear);
      const fits = 2 * (room - cfg.margin - cfg.clearance);
      const bound = cfg.type === 'magnet' ? fits : Math.min(fits, room);
      const others = new Set(skip || []);
      an.base.regions.forEach((_, j) => { if (j !== ri) others.add(j); });
      let reason = 'Area too small';
      for (const [d, L] of ladder) {
        if (d > bound * 1.05 && d !== ladder[ladder.length - 1][0]) continue;
        const kc = { ...cfg, diameter: d, length: L };
        const ks = autoPlaceKeys(an, kc, perRegion, others);
        if (ks.length) { for (const k of ks) keys.push({ x: k.x, y: k.y, a: { diameter: d, length: L } }); return; }
        if (ks.empty && ks.empty[0]) reason = ks.empty[0].reason;
      }
      empty.push({ region: ri, reason, smallest: true });
    });
    keys.empty = empty;
    return keys;
  }
  function autoPlaceKeys(an, cfg, perRegion, skip) {
    const keys = [];
    if (cfg.type === 'none' || an.base.error) return keys;
    const spec = keyGeometrySpec(cfg), fps = [], depth = depthFor(an, cfg); // checked at the depths this size needs
    const R = spec.outer, m = cfg.margin;
    const empty = []; // areas left without a key, with the reason, so the interface can say why
    an.base.regions.forEach((reg, ri) => {
      if (skip && skip.has(ri)) return;
      if (reg.nested || reg.inverted) return;
      // the key's inscribed circle plus the wall must fit at the very least
      if (reg.area < Math.PI * (spec.inner + m) * (spec.inner + m)) { empty.push({ region: ri, reason: 'Area too small' }); return; }
      const [x0, y0, x1, y1] = reg.bbox;
      let h = Math.max(R * 0.3, Math.sqrt(reg.area / 1400));
      while (((x1 - x0) / h) * ((y1 - y0) / h) > 5000) h *= 1.25;
      const cands = [], tried = [];
      const test = (x, y, exact) => {
        if (!regionContains(an.base.loops, reg, x, y)) return;
        const s = keyScore(an, cfg, x, y, skip, spec, fps, exact, depth);
        if (s.ok && s.region === ri) cands.push({ x, y, score: s.score });
        else if (s.region === ri && isFinite(s.slack)) tried.push({ x, y, score: s.slack, reason: s.reason });
      };
      for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) test(x, y, false);
      if (!cands.length) { const again = tried.splice(0); for (const q of again) test(q.x, q.y, true); } // rank the near misses properly
      // Where keys fit can be a strip narrower than the grid (thick walls, long shapes, narrow areas), so the
      // grid steps right over it. Look again, finer and finer, around the most promising spots.
      for (let step = h / 3, level = 0; !cands.length && tried.length && level < 3; step /= 3, level++) {
        // the closest near misses, spread out so separate promising spots each get a look
        const pool = [];
        for (const q of tried.sort((a, b) => b.score - a.score)) {
          if (pool.length >= 8) break;
          if (pool.every(o => Math.hypot(o.x - q.x, o.y - q.y) > step * 2)) pool.push(q);
        }
        tried.length = 0;
        for (const q of pool) for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (i || j) test(q.x + i * step, q.y + j * step, true);
        tried.push(...pool);
      }
      if (!cands.length) {
        const best = tried.sort((a, b) => b.score - a.score)[0];
        empty.push({ region: ri, reason: best ? best.reason : 'Socket would break through the surface' });
        return;
      }
      const chosen = [];
      let best = cands[0];
      for (const c of cands) if (c.score > best.score) best = c;
      chosen.push(best);
      while (chosen.length < perRegion) {
        let pick = null, pickD = -1;
        for (const c of cands) {
          let d = Infinity;
          for (const k of chosen) d = Math.min(d, Math.hypot(c.x - k.x, c.y - k.y));
          if (d < 2 * R + m + h * 0.5) continue;
          const w = d + Math.min(c.score, R) * 0.5;
          if (w > pickD) { pickD = w; pick = c; }
        }
        if (!pick) break;
        chosen.push(pick);
      }
      for (const c of chosen) keys.push({ x: c.x, y: c.y });
    });
    keys.empty = empty;
    return keys;
  }

  /* ---------- cut suggestions ----------
     Three kinds, all pure geometry so they can run in a worker later:
     - narrow points (wrists, ankles, necks, tails): slice along many directions, follow each limb from slice to
       slice, and look for a cross-section that pinches in between wider ones, then tilt the plane to sit square
       across the narrowest spot;
     - panel lines and seams: sharp inward creases that lie together on one plane;
     - separate pieces: solids that don't touch, which can be split apart without cutting. */
  function sweepDirections(P) {
    const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]].map(norm3);
    for (const a of principalAxes(P)) if (dirs.every(d => Math.abs(d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) < 0.97)) dirs.push(a);
    return dirs;
  }
  // (1.83) eigenvalues and vectors of a symmetric 3×3 [xx, xy, xz, yy, yz, zz] (Jacobi), largest first
  function symEig3(c) {
    const a = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let it = 0; it < 60; it++) {
      let p = 0, q = 1; for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
      if (Math.abs(a[p][q]) < 1e-18) break;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), cs = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = cs * x - sn * y; a[k][q] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = cs * x - sn * y; a[q][k] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = cs * x - sn * y; V[k][q] = sn * x + cs * y; }
    }
    return [0, 1, 2].map(i => ({ l: a[i][i], v: [V[0][i], V[1][i], V[2][i]] })).sort((x, y) => y.l - x.l);
  }
  // (1.83) A surface patch shaped like a tube (a sleeve, a leg, a forearm): longer than it is wide, and its faces
  // turning all the way round its long axis (the normals' spread has almost nothing along that axis and plenty in both
  // directions across it). A cape over the shoulders, a belt round the waist or a panel of a coat is not: a cape's
  // normals point up as much as round, a belt is longest across its own axis, a panel faces one way.
  // `s` holds the area-weighted sums [A, Σx(3), Σxxᵀ(6), Σnnᵀ(6)].
  function tubeLike(s, short) { return !!tubeAxis(s, short); }
  // the tube's axis (the direction its normals lack), or null; `short`: a stub of a tube, so no length is asked for
  function tubeAxis(s, short) {
    const A = s[0]; if (!(A > 0)) return null;
    const m = [s[1] / A, s[2] / A, s[3] / A];
    const c = [s[4] / A - m[0] * m[0], s[5] / A - m[0] * m[1], s[6] / A - m[0] * m[2], s[7] / A - m[1] * m[1], s[8] / A - m[1] * m[2], s[9] / A - m[2] * m[2]];
    const e = symEig3(c), en = symEig3([s[10] / A, s[11] / A, s[12] / A, s[13] / A, s[14] / A, s[15] / A]);
    if (!(en[2].l <= 0.13 && en[1].l >= 0.3)) return null;
    if (short) return en[2].v;
    if (!(e[1].l > 0) || e[0].l < 1.8 * e[1].l) return null;
    const ax = e[0].v, nn = en[2].v, align = Math.abs(ax[0] * nn[0] + ax[1] * nn[1] + ax[2] * nn[2]);
    return align >= 0.85 ? nn : null;
  }
  function principalAxes(P) { // eigenvectors of the vertex covariance, by power iteration with deflation
    const n = P.length / 3, step = Math.max(1, Math.floor(n / 20000));
    let mx = 0, my = 0, mz = 0, c = 0;
    for (let i = 0; i < n; i += step) { mx += P[3 * i]; my += P[3 * i + 1]; mz += P[3 * i + 2]; c++; }
    mx /= c; my /= c; mz /= c;
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += step) {
      const d = [P[3 * i] - mx, P[3 * i + 1] - my, P[3 * i + 2] - mz];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[3 * r + q] += d[r] * d[q];
    }
    const out = [];
    for (let k = 0; k < 2; k++) {
      let v = k ? [0.3, 1, 0.2] : [1, 0.4, 0.2];
      for (let it = 0; it < 60; it++) {
        let w = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
        for (const u of out) { const d = w[0] * u[0] + w[1] * u[1] + w[2] * u[2]; w = [w[0] - d * u[0], w[1] - d * u[1], w[2] - d * u[2]]; }
        const L = Math.hypot(w[0], w[1], w[2]);
        if (L < 1e-12) break;
        v = [w[0] / L, w[1] / L, w[2] / L];
      }
      out.push(v);
    }
    out.push(norm3(cross3(out[0], out[1])));
    return out;
  }
  function regionCentroid(sec, reg) { // area centroid of an area (outline minus holes), in the plane's 2D coords
    let A = 0, cx = 0, cy = 0;
    for (const li of [reg.outer, ...reg.holes]) {
      const xy = sec.loops[li].xy, n = xy.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const c = xy[2 * j] * xy[2 * i + 1] - xy[2 * i] * xy[2 * j + 1];
        A += c; cx += (xy[2 * j] + xy[2 * i]) * c; cy += (xy[2 * j + 1] + xy[2 * i + 1]) * c;
      }
    }
    return Math.abs(A) > 1e-12 ? [cx / (3 * A), cy / (3 * A)] : [sec.loops[reg.outer].xy[0], sec.loops[reg.outer].xy[1]];
  }
  const planePoint = (F, x, y) => [F.o[0] + F.u[0] * x + F.v[0] * y, F.o[1] + F.u[1] * x + F.v[1] * y, F.o[2] + F.u[2] * x + F.v[2] * y];
  // One direction's sweep: the places to cut found while following areas from slice to slice. A narrow point
  // (a wrist, an ankle, a neck) is an area smaller than the ones on both sides of it. A join (a shoulder, a hip,
  // a head on a neck hidden by hair) is where an area meets one several times bigger: the chain starts or ends
  // beside a much bigger area in the next slice, or drops or jumps sharply within itself. Each candidate carries
  // `freed`, the volume (slice areas × step) on the smaller side, so a cut that only frees a thumb ranks low.
  function neckSweep(P, I, dir, scale, slices = 36) {
    const n = P.length / 3;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const s = P[3 * i] * dir[0] + P[3 * i + 1] * dir[1] + P[3 * i + 2] * dir[2]; if (s < lo) lo = s; if (s > hi) hi = s; }
    const step = (hi - lo) / slices, minA = Math.pow(0.025 * scale, 2) * Math.PI / 4;
    const layers = [];
    for (let k = 1; k < slices; k++) {
      const s = lo + step * k;
      const F = frameFromNormal(dir, [dir[0] * s, dir[1] * s, dir[2] * s]);
      const sec = section(P, I, F, scale);
      const L = [];
      if (!sec.error) for (const reg of sec.regions) {
        if (reg.nested || reg.inverted || reg.area < minA * 0.25) continue;
        const [cx, cy] = regionCentroid(sec, reg);
        L.push({ area: reg.area, c: planePoint(F, cx, cy), chain: -1, k: layers.length, reg, sec, F });
      }
      layers.push(L);
    }
    // follow each area to the nearest area in the next slice; at a fork the closest branch carries on
    const chains = [];
    for (let k = 0; k < layers.length; k++) {
      const prev = k ? layers[k - 1] : [];
      const claims = new Map();
      for (const r of layers[k]) {
        let best = -1, bd = Infinity;
        prev.forEach((q, j) => {
          const d = Math.hypot(r.c[0] - q.c[0], r.c[1] - q.c[1], r.c[2] - q.c[2]);
          if (d < 0.5 * (Math.sqrt(r.area) + Math.sqrt(q.area)) + step && d < bd) { bd = d; best = j; }
        });
        if (best >= 0 && (!claims.has(best) || claims.get(best).d > bd)) claims.set(best, { r, d: bd });
      }
      for (const [j, { r }] of claims) r.chain = prev[j].chain;
      for (const r of layers[k]) {
        if (r.chain < 0) { r.chain = chains.length; chains.push([]); }
        chains[r.chain].push(r);
      }
    }
    let V = 0;
    for (const L of layers) for (const r of L) V += r.area * step;
    const minFreed = 0.01 * V; // a cut has to free at least 1% of the model
    // is r's centre inside q's area (an area on the next slice), or within r's own radius of it?
    const meets = (r, q) => {
      const F = q.F, d = [r.c[0] - F.o[0], r.c[1] - F.o[1], r.c[2] - F.o[2]];
      const x = d[0] * F.u[0] + d[1] * F.u[1] + d[2] * F.u[2], y = d[0] * F.v[0] + d[1] * F.v[1] + d[2] * F.v[2];
      return regionContains(q.sec.loops, q.reg, x, y) || regionClearance(q.sec.loops, q.reg, x, y) < Math.sqrt(r.area / Math.PI) + step;
    };
    const JUMP = 2.5; // an area this many times bigger is another part
    const found = [];
    for (const ch of chains) {
      const cum = []; let acc = 0;
      for (const r of ch) { acc += r.area * step; cum.push(acc); }
      const total = acc, before = (m) => (m > 0 ? cum[m - 1] : 0), after = (m) => total - cum[m];
      const push = (kind, m, big, freed) => {
        if (freed < minFreed) return;
        found.push({ kind, normal: dir.slice(), point: ch[m].c, area: ch[m].area, pinch: ch[m].area / big, freed });
      };
      // narrow points
      if (ch.length >= 5) for (let m = 2; m < ch.length - 2; m++) {
        const a = ch[m].area;
        if (a < minA || a > ch[m - 1].area || a > ch[m + 1].area) continue;
        let wb = 0, wa = 0;
        for (let q = Math.max(0, m - 10); q < m; q++) wb = Math.max(wb, ch[q].area);
        for (let q = m + 1; q < Math.min(ch.length, m + 11); q++) wa = Math.max(wa, ch[q].area);
        if (a / Math.min(wb, wa) < 0.6) push('neck', m, Math.min(wb, wa), Math.min(before(m), after(m)));
      }
      if (ch.length < 2) continue;
      // joins within the chain: a sharp drop (the rest of the chain is the smaller part) or jump (the start is)
      // (the small side has to hold its size for another slice: the edge of a flat base jumps in area too)
      const steady = (m, next) => ch[next] !== undefined && ch[next].area <= 1.5 * ch[m].area;
      for (let m = 1; m < ch.length; m++) {
        const a0 = ch[m - 1].area, a1 = ch[m].area;
        if (a1 * JUMP <= a0 && a1 >= minA && steady(m, m + 1)) push('join', m, a0, after(m - 1));
        else if (a0 * JUMP <= a1 && a0 >= minA && steady(m - 1, m - 2)) push('join', m - 1, a1, cum[m - 1]);
      }
      // joins at the chain's ends: a much bigger area on the slice before the start, or after the end
      const first = ch[0], last = ch[ch.length - 1];
      if (first.k > 0 && first.area >= minA && steady(0, 1)) for (const q of layers[first.k - 1]) if (q.area >= JUMP * first.area && meets(first, q)) { push('join', 0, q.area, total); break; }
      if (last.k < layers.length - 1 && last.area >= minA && steady(ch.length - 1, ch.length - 2)) for (const q of layers[last.k + 1]) if (q.area >= JUMP * last.area && meets(last, q)) { push('join', ch.length - 1, q.area, total); break; }
    }
    return found;
  }
  // The area of the cut face that contains point p, for a plane through p with normal nrm (or null).
  function areaAt(P, I, nrm, p, scale) {
    const F = frameFromNormal(nrm, p);
    const sec = section(P, I, F, scale);
    if (sec.error) return null;
    const ri = regionAt(sec, 0, 0);
    if (ri < 0) return null;
    const [cx, cy] = regionCentroid(sec, sec.regions[ri]);
    return { area: sec.regions[ri].area, point: planePoint(F, cx, cy) };
  }
  // What cutting the area at the frame's origin would free. The surface on the side the normal points to is
  // flooded from that area's outline without crossing the plane; the areas of the plane it runs into are the
  // ones that have to be cut with it (an arm's shoulder cut must also cut the strap over it), every other area
  // can stay joined. Returns the piece's volume (the sum over its triangles with the caps added, and the caps lie
  // in the plane through the origin, so they add nothing), the rest, the areas to cut (`areas`, as 3D points, and
  // their total `cutArea`). With `whole` set the whole plane is cut and the two sides are measured instead.
  function freedBy(P, I, F, scale, whole = false, at = [0, 0]) {
    const nt = I.length / 3, nv = P.length / 3, o = F.o, n = F.n, total = Math.abs(volume(P, I));
    const s = new Float64Array(nv);
    for (let i = 0; i < nv; i++) s[i] = (P[3 * i] - o[0]) * n[0] + (P[3 * i + 1] - o[1]) * n[1] + (P[3 * i + 2] - o[2]) * n[2];
    const tetra = (t) => {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ax = P[a] - o[0], ay = P[a + 1] - o[1], az = P[a + 2] - o[2], bx = P[b] - o[0], by = P[b + 1] - o[1], bz = P[b + 2] - o[2], cx = P[c] - o[0], cy = P[c + 1] - o[1], cz = P[c + 2] - o[2];
      return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    };
    const sideOf = (t) => { const pos = (s[I[3 * t]] > 0) + (s[I[3 * t + 1]] > 0) + (s[I[3 * t + 2]] > 0); return pos === 3 ? 1 : pos === 0 ? -1 : 0; };
    if (whole) {
      let vol = 0;
      for (let t = 0; t < nt; t++) if (sideOf(t) > 0) vol += tetra(t);
      const piece = Math.abs(vol) / 6;
      return { piece, rest: Math.max(0, total - piece), areas: [], cutArea: 0 };
    }
    const sec = section(P, I, F, scale);
    if (sec.error) return null;
    const ri = regionAt(sec, at[0], at[1]);
    if (ri < 0) return null;
    const tol = 1e-3 * scale;
    // where each crossing triangle's piece of the outline lies, in the plane
    const mid = (t) => {
      let mx = 0, my = 0, mz = 0, c = 0;
      for (let k = 0; k < 3; k++) {
        const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3];
        if ((s[a] > 0) === (s[b] > 0)) continue;
        const f = s[a] / (s[a] - s[b]);
        mx += P[3 * a] + (P[3 * b] - P[3 * a]) * f; my += P[3 * a + 1] + (P[3 * b + 1] - P[3 * a + 1]) * f; mz += P[3 * a + 2] + (P[3 * b + 2] - P[3 * a + 2]) * f; c++;
      }
      if (!c) return null;
      mx = mx / c - o[0]; my = my / c - o[1]; mz = mz / c - o[2];
      return [mx * F.u[0] + my * F.u[1] + mz * F.u[2], mx * F.v[0] + my * F.v[1] + mz * F.v[2]];
    };
    const seed = [];
    for (let t = 0; t < nt; t++) {
      if (sideOf(t)) continue;
      const m = mid(t);
      if (m && regionClearance(sec.loops, sec.regions[ri], m[0], m[1]) < tol) seed.push(t);
    }
    if (!seed.length) return null;
    const nb = triangleAdjacency(P, I).nb, seen = new Uint8Array(nt), stack = [], touched = new Set();
    for (const t of seed) for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && !seen[q] && sideOf(q) > 0) { seen[q] = 1; stack.push(q); } }
    let vol = 0;
    while (stack.length) {
      const t = stack.pop();
      vol += tetra(t);
      for (let k = 0; k < 3; k++) {
        const q = nb[3 * t + k];
        if (q < 0 || seen[q]) continue;
        if (sideOf(q) === 0) { touched.add(q); continue; } // never across the plane
        seen[q] = 1; stack.push(q);
      }
    }
    // the areas the piece is bounded by: every one the flood ran into
    const needed = new Set();
    for (const t of touched) {
      const m = mid(t);
      if (!m) continue;
      for (let j = 0; j < sec.regions.length; j++) { const r = sec.regions[j]; if (!r.nested && !r.inverted && regionClearance(sec.loops, r, m[0], m[1]) < tol) { needed.add(j); break; } }
    }
    needed.delete(ri);
    let cutArea = sec.regions[ri].area, extra = 0; const areas = [planePoint(F, ...regionCentroid(sec, sec.regions[ri]))];
    for (const j of needed) { const r = sec.regions[j]; cutArea += r.area; extra = Math.max(extra, r.area); areas.push(planePoint(F, ...regionCentroid(sec, r))); }
    const piece = Math.abs(vol) / 6;
    return { area: sec.regions[ri].area, piece, rest: Math.max(0, total - piece), areas, cutArea, extra };
  }
  // The cleanest flat cut through a spot on the surface (the owner's click-to-cut-here): planes through the point
  // with normals in and around the surface's tangent plane there (the ring round a limb runs across the limb, so
  // its normal lies along it), each measured by the area whose outline the point is on and, through `freedBy`,
  // what cutting it frees. The best is the lowest cut area for the piece freed (area over freed^⅔, as the
  // suggestions score), never the smallest area alone, which would be a sliver shaved off the surface. It is then
  // tilted, still through the point, until that stops improving. Returns a suggestion-shaped result or null.
  function cutHere(P, I, point, scale) {
    const tri = nearestTriangle(P, I, point, 0.1 * scale);
    let N = null;
    if (tri >= 0) { const a = 3 * I[3 * tri], b = 3 * I[3 * tri + 1], c = 3 * I[3 * tri + 2]; N = norm3(cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]])); }
    const dirs = [];
    if (N) {
      const T = frameFromNormal(N, point);
      for (const el of [0, 30, -30]) { const ce = Math.cos(el * Math.PI / 180), se = Math.sin(el * Math.PI / 180), step = el ? 30 : 15; for (let a = 0; a < 180; a += step) { const r = a * Math.PI / 180; dirs.push(norm3([(T.u[0] * Math.cos(r) + T.v[0] * Math.sin(r)) * ce + N[0] * se, (T.u[1] * Math.cos(r) + T.v[1] * Math.sin(r)) * ce + N[1] * se, (T.u[2] * Math.cos(r) + T.v[2] * Math.sin(r)) * ce + N[2] * se])); } }
    } else dirs.push(...sweepDirections(P));
    const total = Math.abs(volume(P, I)) || 1, tol = 2e-3 * scale;
    // the cut through the point with this normal: the area the point's outline bounds, and what it frees
    const measure = (n) => {
      const F = frameFromNormal(n, point), sec = section(P, I, F, scale);
      if (sec.error) return null;
      let ri = -1, bd = Infinity;
      for (let i = 0; i < sec.regions.length; i++) { const r = sec.regions[i]; if (r.nested || r.inverted) continue; const d = regionClearance(sec.loops, r, 0, 0); if (d < bd) { bd = d; ri = i; } }
      if (ri < 0 || bd > tol) return null;
      const s = pickLabelPoint(regionSamples(sec, ri, 200), [], 0); // a point well inside the area
      const fb = freedBy(P, I, F, scale, false, [s.x, s.y]);
      if (!fb) return null;
      const freed = Math.min(fb.piece, fb.rest);
      if (freed < 0.005 * total) return null;
      if (fb.extra > 0.4 * fb.area) return null; // would need a second cut nearly as big elsewhere (both legs): a slice through the model, not a cut round this spot
      return { normal: n, F, area: sec.regions[ri].area, inside: planePoint(F, s.x, s.y), freed, piece: fb.piece, areas: fb.areas, cutArea: fb.cutArea, extra: fb.extra, ratio: fb.cutArea / Math.pow(freed, 2 / 3) };
    };
    let best = null;
    for (const d of dirs) { const m = measure(d); if (m && (!best || m.ratio < best.ratio)) best = m; }
    if (!best) return null;
    for (const deg of [12, 6, 3, 1.5]) {
      let improved = true, guard = 0;
      while (improved && guard++ < 4) {
        improved = false;
        const F = best.F, r = (deg * Math.PI) / 180, nrm = best.normal;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const tn = norm3([nrm[0] * Math.cos(r) + (F.u[0] * a + F.v[0] * b) * Math.sin(r), nrm[1] * Math.cos(r) + (F.u[1] * a + F.v[1] * b) * Math.sin(r), nrm[2] * Math.cos(r) + (F.u[2] * a + F.v[2] * b) * Math.sin(r)]);
          const m = measure(tn);
          if (m && m.ratio < best.ratio * 0.995) { best = m; improved = true; break; }
        }
      }
    }
    return { kind: 'here', normal: best.normal, point: best.inside, at: point.slice(), area: best.area, width: 2 * Math.sqrt(best.area / Math.PI), freed: best.freed, piece: best.piece, areas: best.areas, cutArea: best.cutArea, extra: best.extra, score: 1 / (1 + best.ratio / 1.5) };
  }
  // Merge narrow points found from several directions and tilt each plane until it sits square across the neck.
  // Each is scored by how cleanly it separates (1 − pinch), how much it frees (`freed` as a share of the model:
  // full marks from 8% up, so a thumb or a buckle never outranks an arm) and how many directions found it.
  function refineNecks(P, I, found, scale, limit = 8, most = 24) {
    found.sort((a, b) => a.area - b.area);
    const groups = [];
    for (const f of found) {
      const g = groups.find(g => Math.hypot(f.point[0] - g.point[0], f.point[1] - g.point[1], f.point[2] - g.point[2]) < 0.8 * Math.sqrt(Math.max(f.area, g.area)));
      if (g) { g.votes++; g.pinch = Math.min(g.pinch, f.pinch); g.freed = Math.max(g.freed || 0, f.freed || 0); if (f.kind === 'neck') g.kind = 'neck'; } else groups.push({ ...f, votes: 1 });
    }
    const V = Math.abs(volume(P, I)) || 1;
    const sizeOf = (g) => Math.sqrt(Math.min(1, (g.freed || 0) / V / 0.08));
    const rough = (g) => (1 - g.pinch) * Math.min(1, 0.7 + 0.1 * g.votes) * (g.freed === undefined ? 1 : sizeOf(g));
    // the final score: how much the cut frees (full marks from 8% of the model), how narrow the cut is for the
    // piece it frees (cut area against the piece's volume^⅔: a ball cut through its middle scores 1.2, a limb at
    // its joint well under 1), how clear the narrowing was, and how many directions found it
    const score = (g, freed, cutArea) => { const ratio = cutArea / Math.pow(Math.max(freed, 1e-9), 2 / 3), q = 1 / (1 + ratio / 1.5); return sizeOf({ freed }) * Math.min(1, 0.7 + 0.1 * g.votes) * Math.sqrt(Math.max(0, 1 - g.pinch) * q); };
    groups.sort((a, b) => rough(b) - rough(a));
    const out = [];
    for (const g of groups.slice(0, most)) {
      let nrm = g.normal, p = g.point, area = g.area;
      for (const deg of [12, 6, 3, 1.5]) {
        let improved = true, guard = 0;
        while (improved && guard++ < 4) {
          improved = false;
          const F = frameFromNormal(nrm, p), r = (deg * Math.PI) / 180;
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = norm3([nrm[0] * Math.cos(r) + (F.u[0] * a + F.v[0] * b) * Math.sin(r), nrm[1] * Math.cos(r) + (F.u[1] * a + F.v[1] * b) * Math.sin(r), nrm[2] * Math.cos(r) + (F.u[2] * a + F.v[2] * b) * Math.sin(r)]);
            const res = areaAt(P, I, t, p, scale);
            if (res && res.area < area * 0.999 && res.area > area * 0.3) { nrm = t; p = res.point; area = res.area; improved = true; break; }
          }
        }
      }
      // what the cut would really free, with the other areas of its plane left joined
      const fb = freedBy(P, I, frameFromNormal(nrm, p), scale);
      if (!fb) continue;
      const freed = Math.min(fb.piece, fb.rest);
      if (freed < 0.01 * V) continue; // frees only a speck (a thumb, a buckle)
      if (fb.extra > 0.6 * fb.area) continue; // needs a second cut nearly as big as itself (both legs at once): a slice, not a joint
      out.push({ kind: g.kind || 'neck', normal: nrm, point: p, area, width: 2 * Math.sqrt(area / Math.PI), freed, piece: fb.piece, areas: fb.areas, cutArea: fb.cutArea, extra: fb.extra, score: score(g, freed, fb.cutArea) });
    }
    out.sort((a, b) => b.score - a.score);
    // two groups can settle on the same neck after tilting
    // and a long even neck (a bar, a forearm) is narrow all along it: keep one spot per neck
    const sameNeck = (o, u) => {
      const d = [o.point[0] - u.point[0], o.point[1] - u.point[1], o.point[2] - u.point[2]], len = Math.hypot(d[0], d[1], d[2]);
      if (len < 0.6 * Math.sqrt(Math.max(o.area, u.area))) return true;
      const par = Math.abs(o.normal[0] * u.normal[0] + o.normal[1] * u.normal[1] + o.normal[2] * u.normal[2]) > 0.985;
      const along = Math.abs(d[0] * u.normal[0] + d[1] * u.normal[1] + d[2] * u.normal[2]);
      const off = Math.sqrt(Math.max(0, len * len - along * along));
      return par && off < 0.5 * Math.sqrt(Math.min(o.area, u.area)) && Math.abs(o.area - u.area) < 0.2 * Math.max(o.area, u.area);
    };
    // and two cuts near each other that free nearly the same piece (a forearm at two spots) are one cut
    const samePiece = (o, u) => Math.abs(o.piece - u.piece) < 0.15 * Math.max(o.piece, u.piece) && Math.hypot(o.point[0] - u.point[0], o.point[1] - u.point[1], o.point[2] - u.point[2]) < 4 * Math.max(o.width, u.width);
    const uniq = [];
    for (const o of out) if (!uniq.some(u => sameNeck(o, u) || samePiece(o, u))) uniq.push(o);
    return uniq.slice(0, limit);
  }
  // Sharp inward creases (valleys between faces), as short segments.
  function creaseEdges(P, I, minDeg = 30) {
    const nt = I.length / 3, first = new Map(), out = [];
    const nrm = (t) => {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      return norm3(cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    };
    const cosMin = Math.cos((minDeg * Math.PI) / 180), nv = P.length / 3;
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], w = I[3 * t + (k + 2) % 3];
      const key = a < b ? a * nv + b : b * nv + a;
      const f = first.get(key);
      if (f === undefined) { first.set(key, t * 3 + k); continue; }
      first.delete(key);
      const t0 = Math.floor(f / 3), n0 = nrm(t0), n1 = nrm(t);
      if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] > cosMin) continue;
      // a valley: this triangle's far corner sits above the other triangle's plane
      const up = (P[3 * w] - P[3 * a]) * n0[0] + (P[3 * w + 1] - P[3 * a + 1]) * n0[1] + (P[3 * w + 2] - P[3 * a + 2]) * n0[2];
      if (up <= 0) continue;
      const d = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], len = Math.hypot(d[0], d[1], d[2]);
      if (len > 0) out.push({ mid: [(P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2], dir: [d[0] / len, d[1] / len, d[2] / len], len });
    }
    return out;
  }
  // Planes that many crease segments lie in, scored by how much of the cut outline there runs along creases.
  function creasePlanes(P, I, dirs, scale, edges, limit = 6) {
    const bin = Math.max(0.2, scale * 0.0015), out = [];
    const b = bounds(P);
    for (const d of dirs) {
      const hist = new Map();
      for (const e of edges) {
        if (Math.abs(e.dir[0] * d[0] + e.dir[1] * d[1] + e.dir[2] * d[2]) > 0.12) continue;
        const s = e.mid[0] * d[0] + e.mid[1] * d[1] + e.mid[2] * d[2], k = Math.round(s / bin);
        const h = hist.get(k) || { w: 0, sw: 0 };
        h.w += e.len; h.sw += e.len * s; hist.set(k, h);
      }
      let lo = Infinity, hi = -Infinity;
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) { const s = x * d[0] + y * d[1] + z * d[2]; lo = Math.min(lo, s); hi = Math.max(hi, s); }
      const peaks = [...hist.entries()].filter(([k, h]) => h.w >= 0.08 * scale && h.w >= (hist.get(k - 1) || { w: 0 }).w && h.w >= (hist.get(k + 1) || { w: 0 }).w).sort((a, c) => c[1].w - a[1].w).slice(0, 4);
      for (const [k, h] of peaks) {
        let w = h.w, sw = h.sw;
        for (const j of [k - 1, k + 1]) { const g = hist.get(j); if (g) { w += g.w; sw += g.sw; } }
        const s = sw / w;
        if (s < lo + 0.05 * (hi - lo) || s > hi - 0.05 * (hi - lo)) continue; // a cut at the very end only trims a sliver
        const c = b.center, cs = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
        const F = frameFromNormal(d, [c[0] + d[0] * (s - cs), c[1] + d[1] * (s - cs), c[2] + d[2] * (s - cs)]);
        const sec = section(P, I, F, scale);
        if (sec.error || !sec.loops.length) continue;
        let per = 0;
        for (const l of sec.loops) { const xy = l.xy, n = xy.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) per += Math.hypot(xy[2 * i] - xy[2 * j], xy[2 * i + 1] - xy[2 * j + 1]); }
        const coverage = Math.min(1, w / per);
        if (coverage < 0.25) continue;
        // pin it on the model: the area-weighted centre of the cut face
        let A = 0, px = 0, py = 0;
        for (const reg of sec.regions) { if (reg.nested || reg.inverted) continue; const [cx, cy] = regionCentroid(sec, reg); A += reg.area; px += cx * reg.area; py += cy * reg.area; }
        const ri = regionAt(sec, px / (A || 1), py / (A || 1));
        let pin = planePoint(F, px / (A || 1), py / (A || 1));
        if (ri < 0 && sec.regions.length) { const big = sec.regions[0], c = regionCentroid(sec, big); pin = planePoint(F, c[0], c[1]); }
        const fb = freedBy(P, I, F, scale, true);
        if (!fb || Math.min(fb.piece, fb.rest) < 0.01 * Math.abs(volume(P, I))) continue; // only trims a sliver
        out.push({ kind: 'crease', normal: d.slice(), point: pin, length: w, coverage, freed: Math.min(fb.piece, fb.rest), score: coverage });
      }
    }
    out.sort((a, c) => c.score - a.score);
    const uniq = [];
    for (const o of out) {
      const same = uniq.some(u => Math.abs(o.normal[0] * u.normal[0] + o.normal[1] * u.normal[1] + o.normal[2] * u.normal[2]) > 0.98 &&
        Math.abs((o.point[0] - u.point[0]) * u.normal[0] + (o.point[1] - u.point[1]) * u.normal[1] + (o.point[2] - u.point[2]) * u.normal[2]) < Math.max(2 * bin, 0.025 * scale));
      if (!same) uniq.push(o);
    }
    return uniq.slice(0, limit);
  }
  // Solids that don't touch each other. Shells sitting inside another (eyes, inner parts) stay with it.
  // Every piece of surface that doesn't share a vertex with another, as a label per triangle, without merging a piece
  // into one whose bounds hold it (separateShells does that, for eyes and inner voids). A kit's head pushed into its
  // body is such a piece: the owner's backpack figure refused it as "covers the whole part".
  function shellComponents(P, I) {
    const nv = P.length / 3, nt = I.length / 3, par = new Int32Array(nv);
    for (let i = 0; i < nv; i++) par[i] = i;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < nt; t++) { const a = find(I[3 * t]), b = find(I[3 * t + 1]), c = find(I[3 * t + 2]); par[a] = b; par[find(c)] = b; }
    const label = new Int32Array(nt), ids = new Map();
    for (let t = 0; t < nt; t++) { const r = find(I[3 * t]); if (!ids.has(r)) ids.set(r, ids.size); label[t] = ids.get(r); }
    return { label, count: ids.size };
  }
  // The triangles marked in `mask` as a mesh of their own, vertices renumbered
  function extractTriangles(P, I, mask) {
    const map = new Int32Array(P.length / 3).fill(-1), pos = [], idx = [];
    for (let t = 0; t < I.length / 3; t++) {
      if (!mask[t]) continue;
      for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); } idx.push(map[v]); }
    }
    const positions = P instanceof Float64Array ? new Float64Array(pos) : new Float32Array(pos), indices = new Uint32Array(idx);
    return { positions, indices, volume: volume(positions, indices) };
  }
  function separateShells(P, I) {
    const nv = P.length / 3, nt = I.length / 3, par = new Int32Array(nv);
    for (let i = 0; i < nv; i++) par[i] = i;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < nt; t++) { const a = find(I[3 * t]), b = find(I[3 * t + 1]), c = find(I[3 * t + 2]); par[a] = b; par[find(c)] = b; }
    const groups = new Map();
    for (let t = 0; t < nt; t++) { const r = find(I[3 * t]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
    if (groups.size < 2) return [];
    let shells = [...groups.values()].map(tris => {
      const idx = new Uint32Array(tris.length * 3), map = new Map(), pos = [];
      tris.forEach((t, k) => { for (let j = 0; j < 3; j++) { const v = I[3 * t + j]; let w = map.get(v); if (w === undefined) { w = pos.length / 3; map.set(v, w); pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); } idx[3 * k + j] = w; } });
      const positions = new Float32Array(pos);
      return { positions, indices: idx, volume: volume(positions, idx), bbox: bounds(positions), tris };
    });
    shells.sort((a, b) => b.volume - a.volume);
    // (1.99) inside means inside the solid, not just its box: a hand cut free beside a figure's body lies within the body's
    // box (the base is wide) and was merged back into it as if it were an eye in a head, so the sleeve between them had
    // to slide off both at once, and its cuff end was left flat. Most of a few of the shell's points must be in the host.
    const testers = new Map(), tester = (h) => { let f = testers.get(h); if (!f) testers.set(h, f = insideTester(h.positions, h.indices)); return f; };
    const inside = (a, b) => {
      if (!(a.bbox.min.every((v, i) => v >= b.bbox.min[i] - 1e-6) && a.bbox.max.every((v, i) => v <= b.bbox.max[i] + 1e-6))) return false;
      const n = a.positions.length / 3, k = Math.min(9, n), f = tester(b); let inn = 0;
      for (let j = 0; j < k; j++) { const v = 3 * Math.floor((j + 0.5) * n / k); if (f(a.positions[v], a.positions[v + 1], a.positions[v + 2])) inn++; }
      return inn * 2 > k;
    };
    const top = [];
    for (const s of shells) {
      const host = top.filter(h => inside(s, h)).sort((a, b) => a.volume - b.volume)[0];
      if (host) { testers.delete(host); const m = mergeMeshes([host, s]); host.positions = m.positions; host.indices = m.indices; host.volume += s.volume; host.tris = host.tris.concat(s.tris); } // an inner shell stays with its host
      else top.push(s);
    }
    for (const s of top) s.tris.sort((a, b) => a - b); // the triangles of the original each piece holds (tris), so a clicked triangle maps to its piece
    return top.length > 1 ? top : [];
  }

  /* ---------- surface regions ----------
     Split the surface into regions wherever it turns sharply (a crease, a hem, a panel edge), like ZBrush's
     auto polygroups: neighbouring triangles join when the angle between them is under `angle` degrees. Specks
     smaller than `minFrac` of the total area (sculpted texture, noise) melt into the neighbour they share the
     longest border with. These borders are the lines a curved cut will follow. */
  // Regions of the surface. Neighbouring triangles join unless the surface turns more than `angle` between them.
  // With `fold` set, a concave turn (a valley: cloth meeting skin, a collar, a belt's edge, a shoe top) splits at
  // that gentler angle, while a convex one (a ridge) still needs `angle`: on organic sculpts the parts meet in
  // valleys, and ridges are mostly detail.
  // Regions that touch themselves at a single vertex (two corners of one region meeting diagonally, or a region
  // pinched to a point between two others) have outlines that can't be cut along: the owner's Faceless Doll had
  // five of its biggest parts skipped for it. At every such vertex the triangles round it all go to the region that
  // holds most of them, a few rounds over, so every outline is a clean loop. In place; returns how many changed.
  function unpinchGroups(P, I, groupOf) {
    const nt = I.length / 3, pairs = trianglePairs(I), vt = vertexTriangles(P, I);
    let changed = 0;
    for (let round = 0; round < 6; round++) {
      const cnt = new Map(); // vertex·k + region -> border edges of that region at that vertex
      const key = (v, g) => v * 4294967296 + g;
      for (let i = 0; i < pairs.length; i += 4) {
        const g1 = groupOf[pairs[i]], g2 = groupOf[pairs[i + 1]];
        if (g1 === g2) continue;
        for (const v of [pairs[i + 2], pairs[i + 3]]) for (const g of [g1, g2]) { const k = key(v, g); cnt.set(k, (cnt.get(k) || 0) + 1); }
      }
      const pinched = new Set();
      for (const [k, c] of cnt) if (c > 2) pinched.add(Math.floor(k / 4294967296));
      if (!pinched.size) break;
      for (const v of pinched) {
        const tally = new Map();
        for (let k = vt.start[v]; k < vt.start[v + 1]; k++) { const g = groupOf[vt.tri[k]]; tally.set(g, (tally.get(g) || 0) + 1); }
        let best = -1, bn = -1; for (const [g, n] of tally) if (n > bn) { bn = n; best = g; }
        for (let k = vt.start[v]; k < vt.start[v + 1]; k++) { const t = vt.tri[k]; if (groupOf[t] !== best) { groupOf[t] = best; changed++; } }
      }
    }
    if (changed) { // regions emptied are numbered out, so every region holds triangles
      let mx = -1; for (let t = 0; t < nt; t++) if (groupOf[t] > mx) mx = groupOf[t];
      const used = new Int32Array(mx + 1).fill(-1); let n = 0;
      for (let t = 0; t < nt; t++) { if (used[groupOf[t]] < 0) used[groupOf[t]] = n++; }
      const keepOrder = [...used.keys()].filter(g => used[g] >= 0).sort((a, b) => a - b), ren = new Int32Array(used.length).fill(-1);
      keepOrder.forEach((g, i) => { ren[g] = i; });
      for (let t = 0; t < nt; t++) groupOf[t] = ren[groupOf[t]];
    }
    return changed;
  }
  // (1.96) Tongues and notches off the regions' borders (the owner: "topology that should not be included in a selection is
  // still selected and cut"): where two regions meet with no crease between them (a step in thickness, a melted
  // sliver) the border wanders, and a narrow tongue of one region pokes into the other; cut along it, the piece gets a
  // paper-thin flap. Each region is opened by a share (`frac`, a quarter) of its own half-width, the furthest any of its
  // triangles lies from its border measured over the surface, so nothing here goes by the model's size: what the
  // opening takes off is a tongue, narrower than that against the region itself. A tongue goes to the neighbour it
  // lies in when most of its border with other regions is smooth: no crease of `sharp` (25°) or more, and no seam
  // between made and sculpted surface (`hard`). A tongue bounded by creases is a real feature (a strap, a lapel, a
  // made object's strip) and stays; `fixed` triangles (the made objects) never move. A tube (a sleeve, a finger) is
  // not narrow in this sense: its triangles lie far from its ends. In place; returns how many triangles moved.
  // (1.97) A flat patch walled off from its own region belongs to the face it lies flush with. The owner's hand on a
  // book took a patch of the book's cover between two fingers: the boolean that joined them had cut the cover into
  // small even triangles there, so it looked like skin to every rule that reads triangle shape. What gives it away,
  // on any model, is how it sits: flat (neighbours within `flat`° of each other), walled off from the rest of its own
  // region by sharp creases (over `crease`°) along at least half its outline, and running on, flush (under `flush`°),
  // into another region across the rest. Such a patch, under a quarter of its region, goes to the region it runs on
  // into (the longest flush border). With `within`, only inside one part. Returns how many triangles moved.
  function flatIslands(P, I, groupOf, opts = {}) {
    const nt = I.length / 3, pairs = trianglePairs(I), within = opts.within || null, hard = opts.hard || null; // (with `hard`, only onto a made object's face: a book's page block flush with a skirt stays the book's)
    const cFlat = Math.cos((opts.flat || 3) * Math.PI / 180), cCrease = Math.cos((opts.crease || 60) * Math.PI / 180), cFlush = Math.cos((opts.flush || 10) * Math.PI / 180);
    const N = new Float64Array(3 * nt), A = new Float64Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], c1 = 3 * I[3 * t + 1], c2 = 3 * I[3 * t + 2];
      const ux = P[c1] - P[a], uy = P[c1 + 1] - P[a + 1], uz = P[c1 + 2] - P[a + 2], vx = P[c2] - P[a], vy = P[c2 + 1] - P[a + 1], vz = P[c2 + 2] - P[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, L = Math.hypot(x, y, z); A[t] = L / 2;
      if (L > 0) { N[3 * t] = x / L; N[3 * t + 1] = y / L; N[3 * t + 2] = z / L; }
    }
    const dot = (s, t) => N[3 * s] * N[3 * t] + N[3 * s + 1] * N[3 * t + 1] + N[3 * s + 2] * N[3 * t + 2];
    const len = (i) => Math.hypot(P[3 * pairs[i + 2]] - P[3 * pairs[i + 3]], P[3 * pairs[i + 2] + 1] - P[3 * pairs[i + 3] + 1], P[3 * pairs[i + 2] + 2] - P[3 * pairs[i + 3] + 2]);
    // flat patches within one region: flooded across flat edges, never drifting more than `flat` from where they began
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < pairs.length; i += 4) { const s = pairs[i], t = pairs[i + 1]; if (groupOf[s] === groupOf[t] && A[s] > 0 && A[t] > 0 && dot(s, t) > cFlat) { const x = find(s), y = find(t); if (x !== y) par[x] = y; } }
    const pa = new Map(), pn = new Map(), pc = new Map(); // each patch's area, area-weighted normal and triangle count
    for (let t = 0; t < nt; t++) { const r = find(t); pa.set(r, (pa.get(r) || 0) + A[t]); pc.set(r, (pc.get(r) || 0) + 1); let n = pn.get(r); if (!n) pn.set(r, n = [0, 0, 0]); n[0] += A[t] * N[3 * t]; n[1] += A[t] * N[3 * t + 1]; n[2] += A[t] * N[3 * t + 2]; }
    const ga = new Map(), gh = new Map(); for (let t = 0; t < nt; t++) { ga.set(groupOf[t], (ga.get(groupOf[t]) || 0) + A[t]); if (hard && hard[t]) gh.set(groupOf[t], (gh.get(groupOf[t]) || 0) + A[t]); }
    const sculpted = (g) => !hard || (gh.get(g) || 0) < 0.5 * ga.get(g); // (with `hard`, only out of a sculpted region: a made object's own faces are left as the objects' rules put them)
    // each patch's outline: creased against its own region, or flush with another region (by region)
    const creased = new Map(), own = new Map(), flushBy = new Map(), total = new Map();
    const flatPatch = (r) => { const n = pn.get(r); return Math.hypot(n[0], n[1], n[2]) > 0.98 * pa.get(r); };
    const agree = (r, q) => { const a = pn.get(r), b = pn.get(q); return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > cFlush * Math.hypot(...a) * Math.hypot(...b); };
    for (let i = 0; i < pairs.length; i += 4) {
      const s = pairs[i], t = pairs[i + 1], rs = find(s), rt = find(t); if (rs === rt) continue;
      const l = len(i), d = dot(s, t);
      for (const [p, q, rp] of [[s, t, rs], [t, s, rt]]) {
        total.set(rp, (total.get(rp) || 0) + l);
        if (groupOf[q] === groupOf[p]) { own.set(rp, (own.get(rp) || 0) + l); if (d < cCrease) creased.set(rp, (creased.get(rp) || 0) + l); }
        else if (d > cFlush && !(within && within[p] !== within[q]) && pa.get(find(q)) >= pa.get(rp) && flatPatch(find(q)) && agree(rp, find(q)) && (!hard || hard[q])) { /* flush with a flat face of the other region at least its size, not a stray flat triangle of skin */ let m = flushBy.get(rp); if (!m) flushBy.set(rp, m = new Map()); m.set(groupOf[q], (m.get(groupOf[q]) || 0) + l); }
      }
    }
    const to = new Map();
    for (const [r, m] of flushBy) {
      const g = groupOf[r], o = own.get(r) || 0;
      if (!(o > 0) || (creased.get(r) || 0) < 0.5 * o || pa.get(r) > 0.25 * ga.get(g) || !sculpted(g) || pc.get(r) < (opts.min || 12)) continue; // (a few triangles flush by chance are not a face)
      const n = pn.get(r), nl = Math.hypot(...n); if (!(nl > 0.98 * pa.get(r))) continue; // (flat as a whole, not a gentle curve)
      let best = -1, bl = 0; for (const [h, l] of m) if (l > bl) { bl = l; best = h; }
      if (best >= 0) to.set(r, best);
    }
    let moved = 0;
    if (to.size) for (let t = 0; t < nt; t++) { const h = to.get(find(t)); if (h !== undefined && groupOf[t] !== h) { groupOf[t] = h; moved++; } }
    return moved;
  }
  function trimTongues(P, I, groupOf, opts = {}) {
    const nt = I.length / 3, { nb, C } = triangleAdjacency(P, I), frac = opts.frac === undefined ? 0.25 : opts.frac;
    const cosSharp = Math.cos(((opts.sharp === undefined ? 25 : opts.sharp) * Math.PI) / 180), hard = opts.hard || null, fixed = opts.fixed || null;
    const N = new Float64Array(3 * nt), A = new Float64Array(nt);
    for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2], n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), l = Math.hypot(n[0], n[1], n[2]); A[t] = l / 2; if (l > 0) { N[3 * t] = n[0] / l; N[3 * t + 1] = n[1] / l; N[3 * t + 2] = n[2] / l; } }
    const elen = (t, k) => { const a = 3 * I[3 * t + k], b = 3 * I[3 * t + (k + 1) % 3]; return Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); };
    const cdist = (t, q) => Math.hypot(C[3 * q] - C[3 * t], C[3 * q + 1] - C[3 * t + 1], C[3 * q + 2] - C[3 * t + 2]);
    let moved = 0; const within = opts.within || null, lock = new Uint8Array(nt); // (a tongue moved once stays: without this a run could go over and come back)
    for (let round = 0; round < (opts.rounds || 3); round++) {
      let count = 0; for (let t = 0; t < nt; t++) if (groupOf[t] + 1 > count) count = groupOf[t] + 1;
      // a heap of (distance, triangle), spreading inside each region only
      const hd = [], ht = [];
      const push = (d, t) => { let i = hd.length; hd.push(d); ht.push(t); while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hd[i] = hd[p]; ht[i] = ht[p]; i = p; } hd[i] = d; ht[i] = t; };
      const pop = () => { const top = ht[0], d = hd.pop(), t = ht.pop(), n = hd.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hd[c + 1] < hd[c]) c++; if (hd[c] >= d) break; hd[i] = hd[c]; ht[i] = ht[c]; i = c; } hd[i] = d; ht[i] = t; } return top; };
      const spread = (dist, limit) => { while (hd.length) { const d = hd[0], t = pop(); if (d > dist[t]) continue; for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q < 0 || groupOf[q] !== groupOf[t]) continue; const nd = d + cdist(t, q); if (nd < dist[q] && (!limit || nd <= limit[groupOf[q]])) { dist[q] = nd; push(nd, q); } } } };
      // how far each triangle lies from its region's border, and each region's half-width
      const d = new Float64Array(nt).fill(Infinity);
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && groupOf[q] !== groupOf[t]) { const v = cdist(t, q) / 2; if (v < d[t]) d[t] = v; } }
      for (let t = 0; t < nt; t++) if (d[t] < Infinity) push(d[t], t);
      spread(d, null);
      const half = new Float64Array(count); for (let t = 0; t < nt; t++) if (d[t] < Infinity && d[t] > half[groupOf[t]]) half[groupOf[t]] = d[t];
      // opened: the core (at least frac of the half-width in) grown back by as much
      const r = half.map(h => frac * h), back = new Float64Array(nt).fill(Infinity), reach = r.map(x => 1.1 * x);
      for (let t = 0; t < nt; t++) if (d[t] === Infinity || d[t] >= r[groupOf[t]]) { back[t] = 0; push(0, t); } // (a region with no border at all is all core)
      spread(back, reach);
      // the runs the opening took off, and their borders with other regions
      const par = new Int32Array(nt).fill(-1); const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let t = 0; t < nt; t++) if (back[t] === Infinity) par[t] = t;
      for (let t = 0; t < nt; t++) if (par[t] >= 0) for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q > t && par[q] >= 0 && groupOf[q] === groupOf[t]) { const x = find(t), y = find(q); if (x !== y) par[x] = y; } }
      // what the opening kept, in connected pieces: a run that joins two of them is a bridge of its region, not a tongue
      const kp = new Int32Array(nt).fill(-1); const kfind = (x) => { while (kp[x] !== x) { kp[x] = kp[kp[x]]; x = kp[x]; } return x; };
      for (let t = 0; t < nt; t++) if (par[t] < 0) kp[t] = t;
      for (let t = 0; t < nt; t++) if (kp[t] >= 0) for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q > t && kp[q] >= 0 && groupOf[q] === groupOf[t]) { const x = kfind(t), y = kfind(q); if (x !== y) kp[x] = y; } }
      const runs = new Map(); // root -> { area, out, neck, roots, held, to: Map(region -> smooth length), all: Map(region -> length) }
      const regArea = new Float64Array(count); for (let t = 0; t < nt; t++) regArea[groupOf[t]] += A[t];
      for (let t = 0; t < nt; t++) {
        if (par[t] < 0) continue; const x = find(t); let R = runs.get(x); if (!R) runs.set(x, R = { area: 0, out: 0, neck: 0, roots: new Set(), held: false, to: new Map(), all: new Map() });
        R.area += A[t]; if (lock[t] || (fixed && fixed[t])) R.held = true;
        for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q < 0) continue; if (groupOf[q] === groupOf[t]) { if (par[q] < 0) { R.neck += elen(t, k); R.roots.add(kfind(q)); } continue; } const l = elen(t, k); R.out += l; R.all.set(groupOf[q], (R.all.get(groupOf[q]) || 0) + l);
          const smooth = N[3 * t] * N[3 * q] + N[3 * t + 1] * N[3 * q + 1] + N[3 * t + 2] * N[3 * q + 2] >= cosSharp && !(hard && hard[t] !== hard[q]) && !(fixed && fixed[q]) && !(within && within[t] !== within[q]);
          if (smooth) R.to.set(groupOf[q], (R.to.get(groupOf[q]) || 0) + l); }
      }
      const dest = new Map();
      for (const [x, R] of runs) { if (R.held || !(R.out > 0) || R.area > 0.1 * regArea[groupOf[x]]) continue; let all = 0, best = -1, bl = 0; for (const [g, l] of R.to) { all += l; if (l > bl) { bl = l; best = g; } } if (best >= 0 && all >= 0.6 * R.out && R.roots.size === 1 && R.neck < 0.5 * R.all.get(best)) dest.set(x, best); } // (one neck, and the border gets shorter by the move: at least halved along the region it goes to)
      // two runs side by side (a tongue, and the corners of the other region beside its root) would swap and leave islands: the bigger goes, the other is looked at again next round
      if (dest.size > 1) { const drop = new Set(); for (let t = 0; t < nt; t++) { if (par[t] < 0) continue; const x = find(t); if (!dest.has(x)) continue; for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q < 0 || par[q] < 0) continue; const y = find(q); if (y !== x && dest.has(y)) drop.add(runs.get(x).area < runs.get(y).area ? x : y); } } for (const x of drop) dest.delete(x); }
      let now = 0; if (dest.size) for (let t = 0; t < nt; t++) if (par[t] >= 0) { const g = dest.get(find(t)); if (g !== undefined) { groupOf[t] = g; lock[t] = 1; now++; } }
      moved += now; if (!now) break;
    }
    return moved;
  }
  // Hard surface or organic, per triangle (the owner: "determine when a hard surface meets a more organic surface and
  // split accordingly"): cloth, skin and hair bend a little at nearly every edge, each triangle a flat patch of its
  // own, while a modelled object (a book, a buckle, a crucifix, a cylinder's facets) is flat patches of several
  // triangles meeting at edges. Each triangle is scored by the share of its edges that bend gently (0.5° to 30°) next
  // to a lone triangle; the score is averaged over three rings of neighbours, and under 40% gentle is hard; then any
  // hard or organic patch under 0.2% of the surface takes the other label. On Father Rhinehardt it finds the books,
  // their clasps, the crucifix and the cuff bands, and leaves the robe and the hands organic. Returns a Uint8Array,
  // 1 for hard.
  function hardSurface(P, I, N, A, pairs, total, minPatch = 0.0005) {
    const nt = I.length / 3, np = pairs.length / 4;
    const lo = Math.cos(0.5 * Math.PI / 180), hi = Math.cos(30 * Math.PI / 180);
    // flat patches: neighbours within half a degree; each patch scored by how much of its outline is a sharp edge
    // (a book's face is outlined by sharp edges; a faceted cylinder's facet, or a low-poly robe's, by gentle ones)
    const fp = new Int32Array(nt); for (let t = 0; t < nt; t++) fp[t] = t;
    const ff = (x) => { while (fp[x] !== x) { fp[x] = fp[fp[x]]; x = fp[x]; } return x; };
    const dots = new Float64Array(np), elen = new Float64Array(np);
    for (let i = 0; i < np; i++) {
      const a = pairs[4 * i], b = pairs[4 * i + 1], ea = 3 * pairs[4 * i + 2], eb = 3 * pairs[4 * i + 3];
      dots[i] = N[3 * a] * N[3 * b] + N[3 * a + 1] * N[3 * b + 1] + N[3 * a + 2] * N[3 * b + 2];
      elen[i] = Math.hypot(P[ea] - P[eb], P[ea + 1] - P[eb + 1], P[ea + 2] - P[eb + 2]);
      if (dots[i] >= lo) { const x = ff(a), y = ff(b); if (x !== y) fp[x] = y; }
    }
    const fn = new Int32Array(nt); for (let t = 0; t < nt; t++) fn[ff(t)]++;
    // an edge that bends gently is organic only beside a lone triangle (cloth, skin); between flat patches of two or
    // more triangles it is the faceting of a made shape (a cylinder's facets, a book's bevels)
    const soft = new Float64Array(nt), cnt = new Float64Array(nt);
    for (let i = 0; i < np; i++) {
      const a = pairs[4 * i], b = pairs[4 * i + 1], g = dots[i] < lo && dots[i] > hi && (fn[ff(a)] === 1 || fn[ff(b)] === 1) ? 1 : 0;
      soft[a] += g; soft[b] += g; cnt[a]++; cnt[b]++;
    }
    const deg = new Int32Array(nt + 1);
    for (let i = 0; i < np; i++) { deg[pairs[4 * i] + 1]++; deg[pairs[4 * i + 1] + 1]++; }
    for (let t = 0; t < nt; t++) deg[t + 1] += deg[t];
    const fill = deg.slice(0, nt), nb = new Int32Array(deg[nt]);
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
    let h = new Float64Array(nt); for (let t = 0; t < nt; t++) h[t] = cnt[t] ? 1 - soft[t] / cnt[t] : 0;
    // (1.75, 1.78) CAD-style triangles: a modelled object exported from CAD or a hard-surface tool is long thin
    // triangles fanned across flat panels (a corner under 12°), where a sculpt's triangles are even. Rendered on
    // Father Rhinehardt this alone outlines the books, the crucifix, the glasses, the buckles, the base's rim and the
    // cuffs' edges, where the gentle-edge score above also took whole patches of robe, trousers and sleeve for made
    // surface (and the fan of thin triangles a boolean leaves on the robe round the book, whose pairs defeat the
    // lone-triangle test). So the share of thin triangles over three rings is the first signal; the gentle-edge
    // score only counts for a large flat face (at least 0.2% of the surface: a CAD box's faces are two big
    // triangles each, not thin at all), never for the small facet pairs of a sculpt.
    const thinT = new Uint8Array(nt);
    { const lim = Math.cos(12 * Math.PI / 180);
      for (let t = 0; t < nt; t++) {
        const v = [3 * I[3 * t], 3 * I[3 * t + 1], 3 * I[3 * t + 2]];
        for (let k = 0; k < 3; k++) { const o = v[k], a = v[(k + 1) % 3], b = v[(k + 2) % 3]; const ux = P[a] - P[o], uy = P[a + 1] - P[o + 1], uz = P[a + 2] - P[o + 2], wx = P[b] - P[o], wy = P[b + 1] - P[o + 1], wz = P[b + 2] - P[o + 2]; const L = Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz); if (L && (ux * wx + uy * wy + uz * wz) / L > lim) { thinT[t] = 1; break; } }
      }
    }
    // thin and in a flat patch of three or more (the fan of thin triangles a boolean leaves on a robe round a book wraps
    // the robe, so its triangles lie flat with at most one neighbour: 6% of them pass, against 72% of the book's)
    let thinScore = new Float64Array(nt); for (let t = 0; t < nt; t++) thinScore[t] = thinT[t] && fn[ff(t)] >= 3 ? 1 : 0;
    for (let it = 0; it < 3; it++) { const g = new Float64Array(nt); for (let t = 0; t < nt; t++) { let sm = thinScore[t], n = 1; for (let j = deg[t]; j < deg[t + 1]; j++) { sm += thinScore[nb[j]]; n++; } g[t] = sm / n; } thinScore = g; }
    const patchArea = new Float64Array(nt); for (let t = 0; t < nt; t++) patchArea[ff(t)] += A[t];
    // (1.76) no averaging across a seam: a flat panel (two or more coplanar triangles) takes one label for all of it,
    // from its own triangles; only lone triangles are averaged, and only with lone neighbours. The three rings of
    // averaging this replaced spread the book's label a few triangles out over the robe, so the border sat off the seam
    // and every pick near the book took a band of robe with it (the owner: "random connected triangles are still being
    // selected even when the topology clearly suggests separate parts")
    const pSum = new Float64Array(nt), pA = new Float64Array(nt);
    for (let t = 0; t < nt; t++) if (fn[ff(t)] > 1) { const r = ff(t); pSum[r] += h[t] * A[t]; pA[r] += A[t]; }
    for (let it = 0; it < 3; it++) { const g = Float64Array.from(h); for (let t = 0; t < nt; t++) { if (fn[ff(t)] > 1) continue; let sm = h[t], n = 1; for (let j = deg[t]; j < deg[t + 1]; j++) { const q = nb[j]; if (fn[ff(q)] > 1) continue; sm += h[q]; n++; } g[t] = sm / n; } h = g; }
    const out = new Uint8Array(nt); for (let t = 0; t < nt; t++) { const r = ff(t); const gentle = (fn[r] > 1 ? pSum[r] / (pA[r] || 1) : h[t]) > 0.6 && fn[r] > 1 && patchArea[r] >= 0.002 * total; out[t] = thinScore[t] > 0.35 || gentle ? 1 : 0; }
    { // a hard patch must have sharp edges in it (its length of edges turning over 30°, at least the side of a square
      // of its area): flat-paired facets of a low-poly robe, or a knot's even quads, have none and stay organic
      const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (out[a] && out[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
      const area = new Map(), sh = new Map();
      for (let t = 0; t < nt; t++) if (out[t]) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      for (let i = 0; i < np; i++) if (dots[i] <= hi) for (const t of [pairs[4 * i], pairs[4 * i + 1]]) if (out[t]) { const r = find(t); sh.set(r, (sh.get(r) || 0) + elen[i] / 2); }
      for (let t = 0; t < nt; t++) if (out[t]) { const r = find(t); if ((sh.get(r) || 0) < Math.sqrt(area.get(r))) out[t] = 0; }
    }
    for (let round = 0; round < 2; round++) { // small patches of either kind join what surrounds them
      const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (out[a] === out[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
      const area = new Map(); for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      let flipped = 0; for (let t = 0; t < nt; t++) if (area.get(find(t)) < minPatch * total) { out[t] = 1 - out[t]; flipped++; }
      if (!flipped) break;
    }
    return out;
  }
  // (1.79) Made props carved out as whole parts. The owner: "selecting the hand should only select the hand, selecting
  // parts of the book should only select parts of the book, selecting the arm should only select the arm". The
  // grouping by thickness and creases gives the figure's limbs, head and clothes, but a prop fused into the figure (a
  // book against a robe, under a hand) came out either in one region with what it touches (1.70) or in dozens of
  // slivers (1.72 to 1.78, once rules were stacked on to keep every creased piece and every hard-to-organic edge).
  // Here every connected run of made surface (`made`, from `hardSurface`: long thin coplanar triangles, as CAD and
  // hard-surface tools export them) at least `minArea` becomes a region of its own, with the sculpted islands it
  // encloses (a bevel strip between two panels); what is left of the regions it was carved from is split into its
  // connected runs, and runs under `minArea` go to the neighbour they share the most border with. `groupOf` is
  // relabelled in place; the count is returned.
  // (1.81) A convex outline of points [[x, y, z], ...]: for each of 162 fixed directions (a Fibonacci sphere), the plane
  // through the farthest point that way. { planes: [[nx, ny, nz, d], ...] (outward unit normals, n·p <= d inside),
  // points: the extreme points }, or null for no points. It holds the convex hull and lies within about 1% of its extent
  // of it; `extra` directions (an object's own face normals, from faceDirections) make a box's faces exact, where the fixed
  // directions alone overshoot its corners by up to 9%. It replaced a quickhull (1.80), which on a book's thousands of nearly coplanar float32 points built a broken
  // horizon and grew without end until the page ran out of memory; this is linear and cannot fail.
  const OUTLINE_DIRS = (() => { const n = 162, out = [], g = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z), a = g * i; out.push([r * Math.cos(a), r * Math.sin(a), z]); } return out; })();
  // The main face directions of a set of triangles: their normals binned to about 3°, the 24 biggest bins by area.
  function faceDirections(N, A, tris) {
    const bins = new Map();
    for (const t of tris) { const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2]; const k = Math.round(x * 20) * 1681 + Math.round(y * 20) * 41 + Math.round(z * 20); let b = bins.get(k); if (!b) { b = [0, 0, 0, 0]; bins.set(k, b); } b[0] += x * A[t]; b[1] += y * A[t]; b[2] += z * A[t]; b[3] += A[t]; }
    return [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, 24).map(b => { const L = Math.hypot(b[0], b[1], b[2]) || 1; return [b[0] / L, b[1] / L, b[2] / L]; });
  }
  function convexOutline(pts, extra) {
    if (!pts.length) return null;
    const planes = [], ext = new Set();
    for (const d of extra ? OUTLINE_DIRS.concat(extra) : OUTLINE_DIRS) { let m = -Infinity, at = -1; for (let i = 0; i < pts.length; i++) { const q = pts[i], v = d[0] * q[0] + d[1] * q[1] + d[2] * q[2]; if (v > m) { m = v; at = i; } } planes.push([d[0], d[1], d[2], m]); ext.add(at); }
    const points = []; for (const i of ext) points.push(pts[i]);
    return { planes, points };
  }

  // (1.80) Made objects and the surface they own. The owner's book: its covers, straps and page block are five runs of made
  // surface a millimetre or two apart (fillets and strap channels between them are even triangles), and its bottom face,
  // a page block recessed behind the cover lips, runs on without a crease into the skirt it lies flush against, so every
  // pick of the book's underside took a strip of robe, in Parts, Sections and Fill alike. Here the made runs (`prop`,
  // from the runs in propLabels) are grouped into objects: two runs join when the way between them over the surface is
  // under a quarter of the larger run's diagonal (a book's parts; never a button three diameters from the next). Each
  // object's convex hull is its outline in space, and the object claims the surface round it that lies on that hull: a
  // triangle reached from the object over the surface whose plane holds the whole hull behind it (within `supMade` or
  // `supPlain` of the diagonal: the straps hang a little below the page block) and whose inward line enters the hull
  // within `deepMade` or `deepPlain` of the diagonal (the page block sits behind the strap bottoms; a thin fan of made
  // triangles that runs on across the robe, and the skirt beyond the book's footprint, miss the hull). Made surface is
  // reached across any edge, sculpted surface never across a concave crease of 30° or more (a finger lying on the cover
  // meets it in a valley) and under stricter limits, so the cover's fillets come in and the hand stays out. An object
  // claims at most its own area. The labels are rewritten in place; the new count is returned.
  function propObjects(P, I, prop, nProps, made, N, C, A, pairs, opts = {}) {
    const nt = I.length / 3, np = pairs.length / 4; if (nProps < 1) return nProps;
    const join = opts.join === undefined ? 0.25 : opts.join, cosC = Math.cos((opts.crease === undefined ? 30 : opts.crease) * Math.PI / 180);
    const supMade = opts.supMade === undefined ? 0.3 : opts.supMade, supPlain = opts.supPlain === undefined ? 0.02 : opts.supPlain, deepMade = opts.deepMade === undefined ? 0.3 : opts.deepMade, deepPlain = opts.deepPlain === undefined ? 0.02 : opts.deepPlain, band = opts.band === undefined ? 0.05 : opts.band;
    const deg = new Int32Array(nt + 1); for (let i = 0; i < np; i++) { deg[pairs[4 * i] + 1]++; deg[pairs[4 * i + 1] + 1]++; } for (let t = 0; t < nt; t++) deg[t + 1] += deg[t];
    const fill = deg.slice(0, nt), nb = new Int32Array(deg[nt]), ne = new Int32Array(deg[nt]); for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; ne[fill[a]] = i; nb[fill[a]++] = b; ne[fill[b]] = i; nb[fill[b]++] = a; }
    const concave = new Uint8Array(np), fp = new Int32Array(nt), cosFlat = Math.cos(Math.PI / 180); for (let t = 0; t < nt; t++) fp[t] = t;
    const ff = (x) => { while (fp[x] !== x) { fp[x] = fp[fp[x]]; x = fp[x]; } return x; };
    for (let i = 0; i < np; i++) { const s = pairs[4 * i], q = pairs[4 * i + 1]; const dot = N[3 * s] * N[3 * q] + N[3 * s + 1] * N[3 * q + 1] + N[3 * s + 2] * N[3 * q + 2]; const valley = (C[3 * q] - C[3 * s]) * N[3 * s] + (C[3 * q + 1] - C[3 * s + 1]) * N[3 * s + 1] + (C[3 * q + 2] - C[3 * s + 2]) * N[3 * s + 2] > 1e-9; concave[i] = valley && dot < cosC ? 1 : 0; if (dot >= cosFlat) { const x = ff(s), y = ff(q); if (x !== y) fp[x] = y; } }
    // a flat panel (three or more triangles within a degree of one plane) is a face of a made thing however even its
    // triangles: a book's side between the straps; it is claimed on the same terms as made surface, where a curved
    // sculpted surface (a fillet, a finger) gets the strict terms and the band
    const fn = new Int32Array(nt); for (let t = 0; t < nt; t++) fn[ff(t)]++; const flat = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (fn[ff(t)] >= 3) flat[t] = 1;
    // each run's diagonal
    const mn = [], mx = []; for (let p = 0; p < nProps; p++) { mn.push([Infinity, Infinity, Infinity]); mx.push([-Infinity, -Infinity, -Infinity]); }
    for (let t = 0; t < nt; t++) if (prop[t] >= 0) for (const v of [I[3 * t], I[3 * t + 1], I[3 * t + 2]]) for (let k = 0; k < 3; k++) { const x = P[3 * v + k]; if (x < mn[prop[t]][k]) mn[prop[t]][k] = x; if (x > mx[prop[t]][k]) mx[prop[t]][k] = x; }
    const pdg = new Float64Array(nProps); for (let p = 0; p < nProps; p++) pdg[p] = Math.hypot(mx[p][0] - mn[p][0], mx[p][1] - mn[p][1], mx[p][2] - mn[p][2]);
    // group: Dijkstra over centroid distances from every run at once, each front reaching join × its own diagonal; where two
    // fronts meet within reach of the larger, the runs join
    const gp = new Int32Array(nProps); for (let p = 0; p < nProps; p++) gp[p] = p; const gf = (x) => { while (gp[x] !== x) { gp[x] = gp[gp[x]]; x = gp[x]; } return x; };
    // two groups join only if together they are still one rigid shape: the surface of both lies on the hull of their union
    // (a box's covers and straps), not deep under it (a cuff and the book beside it: their hull bridges over the hand
    // between them, so the cover under the hand and the cuff's inner side lie well under it)
    const byProp = []; for (let p = 0; p < nProps; p++) byProp.push([]); for (let t = 0; t < nt; t++) if (prop[t] >= 0) byProp[prop[t]].push(t);
    const riseMax = opts.rise === undefined ? 0.06 : opts.rise;
    const rigidSeen = new Map(); // (1.81) a pair's verdict, asked again at every edge where their fronts meet: kept until either joins something
    const rigid = (x, y) => { const key = Math.min(x, y) * nProps + Math.max(x, y); let v = rigidSeen.get(key); if (v === undefined) { v = rigidNow(x, y); rigidSeen.set(key, v); } return v; };
    const rigidNow = (x, y) => {
      const tris = []; for (let p = 0; p < nProps; p++) if (gf(p) === x || gf(p) === y) for (const t of byProp[p]) tris.push(t);
      const vs = new Set(); for (const t of tris) { vs.add(I[3 * t]); vs.add(I[3 * t + 1]); vs.add(I[3 * t + 2]); }
      const pts = []; for (const v of vs) pts.push([P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
      const h = convexOutline(pts, faceDirections(N, A, tris)); if (!h) return true;
      const bmn = [Infinity, Infinity, Infinity], bmx = [-Infinity, -Infinity, -Infinity]; for (const q of pts) for (let k = 0; k < 3; k++) { if (q[k] < bmn[k]) bmn[k] = q[k]; if (q[k] > bmx[k]) bmx[k] = q[k]; }
      const dg = Math.hypot(bmx[0] - bmn[0], bmx[1] - bmn[1], bmx[2] - bmn[2]); let sum = 0, all = 0;
      const step = Math.max(1, Math.floor(tris.length / 4000)); // (the mean rise from at most 4,000 triangles)
      for (let i = 0; i < tris.length; i += step) { const t = tris[i], nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2], cx = C[3 * t], cy = C[3 * t + 1], cz = C[3 * t + 2]; let rise = Infinity;
        for (const pl of h.planes) { const den = pl[0] * nx + pl[1] * ny + pl[2] * nz; if (den > 1e-9) { const s = (pl[3] - (pl[0] * cx + pl[1] * cy + pl[2] * cz)) / den; if (s < rise) rise = s; } }
        if (rise < Infinity) { sum += Math.max(0, rise) * A[t]; all += A[t]; } }
      return (all ? sum / all : 0) <= riseMax * dg;
    };
    { const dist = new Float64Array(nt).fill(Infinity), from = new Int32Array(nt).fill(-1), heap = [];
      const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; const tmp = heap[i]; heap[i] = heap[j]; heap[j] = tmp; i = j; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; const tmp = heap[i]; heap[i] = heap[m]; heap[m] = tmp; i = m; } } return top; };
      for (let t = 0; t < nt; t++) if (prop[t] >= 0) { dist[t] = 0; from[t] = prop[t]; push([0, t]); }
      while (heap.length) { const [dd, t] = pop(); if (dd > dist[t]) continue; const p = from[t];
        for (let j = deg[t]; j < deg[t + 1]; j++) { const q = nb[j]; if (concave[ne[j]] && !(made[q] && made[t])) continue; /* (the way between two runs crosses a valley only from made surface to made surface: a cuff is not part of the book under the hand it meets, which the way over the hand's fingers would have joined) */ const L = Math.hypot(C[3 * q] - C[3 * t], C[3 * q + 1] - C[3 * t + 1], C[3 * q + 2] - C[3 * t + 2]), nd = dd + L;
          if (from[q] >= 0 && from[q] !== p && nd + dist[q] <= join * Math.max(pdg[p], pdg[from[q]])) { const x = gf(p), y = gf(from[q]); if (x !== y && rigid(x, y)) gp[x] = y; }
          if (prop[q] < 0 && nd < dist[q] && nd <= join * pdg[p]) { dist[q] = nd; from[q] = p; push([nd, q]); } } }
    }
    const gid = new Map(), groupOf = new Int32Array(nProps); for (let p = 0; p < nProps; p++) { const g = gf(p); if (!gid.has(g)) gid.set(g, gid.size); groupOf[p] = gid.get(g); }
    const nObj = gid.size, out = new Int32Array(nt).fill(-1); for (let t = 0; t < nt; t++) if (prop[t] >= 0) out[t] = groupOf[prop[t]];
    const byObj = []; for (let g = 0; g < nObj; g++) byObj.push([]); for (let t = 0; t < nt; t++) if (out[t] >= 0) byObj[out[t]].push(t);
    for (let g = 0; g < nObj; g++) {
      const tris = byObj[g], vs = new Set(); for (const t of tris) { vs.add(I[3 * t]); vs.add(I[3 * t + 1]); vs.add(I[3 * t + 2]); }
      const pts = []; let area = 0; for (const v of vs) pts.push([P[3 * v], P[3 * v + 1], P[3 * v + 2]]); for (const t of tris) area += A[t];
      const bmn = [Infinity, Infinity, Infinity], bmx = [-Infinity, -Infinity, -Infinity]; for (const q of pts) for (let k = 0; k < 3; k++) { if (q[k] < bmn[k]) bmn[k] = q[k]; if (q[k] > bmx[k]) bmx[k] = q[k]; }
      const dg = Math.hypot(bmx[0] - bmn[0], bmx[1] - bmn[1], bmx[2] - bmn[2]);
      const h = convexOutline(pts, faceDirections(N, A, tris)); if (!h) continue;
      const hpts = h.points, planes = h.planes;
      const test = (t, sup, deep) => { // the plane holds the hull behind it within sup × dg; the line along -n from the centroid enters the hull within deep × dg
        const nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2], cx = C[3 * t], cy = C[3 * t + 1], cz = C[3 * t + 2], d0 = nx * cx + ny * cy + nz * cz;
        for (const q of hpts) if (nx * q[0] + ny * q[1] + nz * q[2] - d0 > sup * dg) return false;
        let lo = 0, hi = Infinity;
        for (const pl of planes) { const den = -(pl[0] * nx + pl[1] * ny + pl[2] * nz), num = pl[3] - (pl[0] * cx + pl[1] * cy + pl[2] * cz); if (Math.abs(den) < 1e-12) { if (num < -1e-9 * dg) return false; continue; } if (den > 0) { if (num / den < hi) hi = num / den; } else if (num / den > lo) lo = num / den; }
        return lo <= hi + 1e-9 * dg && lo <= deep * dg;
      };
      // sculpted surface is claimed only within a band of `band` × dg from the object's made surface (the way measured over
      // the surface): a fillet along the cover's edge, never a hand lying on the cover, whose pads meet it too gently
      // for a crease to stop the flood
      // an object claims at most its own area, and all or nothing: a flood that would take more (a flange's thin rim
      // reaching both faces of the flange) claims none, rather than an arbitrary ring of it
      const onOutline = (t) => { const x = C[3 * t], y = C[3 * t + 1], z = C[3 * t + 2]; let worst = -Infinity, wp = null; for (const pl of planes) { const d = pl[0] * x + pl[1] * y + pl[2] * z - pl[3]; if (d > worst) { worst = d; wp = pl; } } return worst <= 0.04 * dg && N[3 * t] * wp[0] + N[3 * t + 1] * wp[1] + N[3 * t + 2] * wp[2] >= 0; };
      const stack = tris.slice(), seen = new Uint8Array(nt), far = new Float64Array(nt), took = []; for (const t of tris) seen[t] = 1; let claimed = 0;
      while (stack.length) { const t = stack.pop(); for (let j = deg[t]; j < deg[t + 1]; j++) { const q = nb[j]; if (seen[q] || out[q] >= 0 || (concave[ne[j]] && !(made[q] && onOutline(q)))) continue; /* (1.81: across a concave seam only into made surface on the object's outline, facing out: a strap wrapping the book, not a cuff ring resting on the cover, which came in that way in 1.80) */ const rigid = made[q] || flat[q], dq = rigid ? 0 : far[t] + Math.hypot(C[3 * q] - C[3 * t], C[3 * q + 1] - C[3 * t + 1], C[3 * q + 2] - C[3 * t + 2]); if (!rigid && dq > band * dg) continue; seen[q] = 1; if (!(rigid ? test(q, supMade, deepMade) : test(q, supPlain, deepPlain))) continue; if (claimed + A[q] > area) { for (const x of took) out[x] = -1; stack.length = 0; break; } out[q] = g; far[q] = dq; claimed += A[q]; took.push(q); stack.push(q); } }
    }
    for (let t = 0; t < nt; t++) prop[t] = out[t];
    return nObj;
  }
  function propLabels(P, I, made, A, pairs, total, minArea, opts = {}) {
    const nt = I.length / 3, np = pairs.length / 4;
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    // (two made objects fused together, a block standing on a box, part at the sharp concave seam between them)
    const N = new Float64Array(3 * nt), C = new Float64Array(3 * nt);
    for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), L = Math.hypot(n[0], n[1], n[2]) || 1; for (let k = 0; k < 3; k++) { N[3 * t + k] = n[k] / L; C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3; } }
    const cos60 = Math.cos(Math.PI / 3), seam = (i) => { const s0 = pairs[4 * i], q = pairs[4 * i + 1]; const dot = N[3 * s0] * N[3 * q] + N[3 * s0 + 1] * N[3 * q + 1] + N[3 * s0 + 2] * N[3 * q + 2]; if (dot >= cos60) return false; return (C[3 * q] - C[3 * s0]) * N[3 * s0] + (C[3 * q + 1] - C[3 * s0 + 1]) * N[3 * s0 + 1] + (C[3 * q + 2] - C[3 * s0 + 2]) * N[3 * s0 + 2] > 1e-9; };
    // runs of made surface, with the seams respected (fine) and ignored (coarse): a coarse run parts at its seams only
    // where that leaves two pieces each at least minArea (a block standing on a box), never where a groove merely crosses
    // a face (a book's strap channels across its cover)
    const parC = new Int32Array(nt); for (let t = 0; t < nt; t++) parC[t] = t;
    const findC = (x) => { while (parC[x] !== x) { parC[x] = parC[parC[x]]; x = parC[x]; } return x; };
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (made[a] === made[b]) { const x = findC(a), y = findC(b); if (x !== y) parC[x] = y; if (!(made[a] && seam(i))) { const x2 = find(a), y2 = find(b); if (x2 !== y2) par[x2] = y2; } } }
    const area = new Map(), areaC = new Map(), bigFine = new Map(); // coarse run -> how many fine runs in it reach minArea
    for (let t = 0; t < nt; t++) { const r = find(t), c = findC(t); area.set(r, (area.get(r) || 0) + A[t]); areaC.set(c, (areaC.get(c) || 0) + A[t]); }
    for (const [r, a] of area) if (a >= minArea) { const c = findC(r); bigFine.set(c, (bigFine.get(c) || 0) + 1); }
    for (let t = 0; t < nt; t++) if (made[t] && (bigFine.get(findC(t)) || 0) < 2) par[t] = findC(t) === t ? t : par[t]; // (kept whole: the fine runs fold back into the coarse one)
    for (let t = 0; t < nt; t++) if (made[t] && (bigFine.get(findC(t)) || 0) < 2) { const x = find(t), y = find(findC(t)); if (x !== y) par[x] = y; }
    area.clear(); for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
    // the props: made runs at least minArea and at most 35% of the surface (a figure whose whole body reads as made,
    // a lathe or a subdivided boolean, is no prop: its parts stay as the grouping found them); sculpted runs enclosed
    // by one prop and smaller than it join it
    const prop = new Int32Array(nt).fill(-1); let nProps = 0; const propId = new Map();
    for (let t = 0; t < nt; t++) if (made[t] && area.get(find(t)) >= minArea && area.get(find(t)) <= 0.35 * total) { const r = find(t); if (!propId.has(r)) propId.set(r, nProps++); prop[t] = propId.get(r); }
    if (!nProps) return { prop, nProps: 0 };
    nProps = propObjects(P, I, prop, nProps, made, N, C, A, pairs, opts); // (1.80) runs grouped into objects, each with the surface it owns
    // sculpted runs (connected, outside every object) that border one object only and are smaller than it join it
    const par2 = new Int32Array(nt); for (let t = 0; t < nt; t++) par2[t] = t;
    const find2 = (x) => { while (par2[x] !== x) { par2[x] = par2[par2[x]]; x = par2[x]; } return x; };
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (prop[a] < 0 && prop[b] < 0) { const x = find2(a), y = find2(b); if (x !== y) par2[x] = y; } }
    const area2 = new Map(), touches = new Map(); // sculpted run -> set of object ids it borders, or -2 when it borders something that isn't one
    for (let t = 0; t < nt; t++) if (prop[t] < 0) { const r = find2(t); area2.set(r, (area2.get(r) || 0) + A[t]); }
    for (let i = 0; i < np; i++) {
      const a = pairs[4 * i], b = pairs[4 * i + 1]; if ((prop[a] >= 0) === (prop[b] >= 0)) continue;
      const [m, o] = prop[a] >= 0 ? [a, b] : [b, a], r = find2(o);
      let set = touches.get(r); if (!set) { set = new Set(); touches.set(r, set); }
      set.add(prop[m]);
    }
    const propArea = new Float64Array(nProps); for (let t = 0; t < nt; t++) if (prop[t] >= 0) propArea[prop[t]] += A[t];
    for (let t = 0; t < nt; t++) if (prop[t] < 0) { const r = find2(t), set = touches.get(r); if (set && set.size === 1) { const [p] = set; if (area2.get(r) < 0.2 * propArea[p]) prop[t] = p; } } // (a fifth: a hand on a book, enclosed between the book and the cuff, is no island of it)
    return { prop, nProps };
  }
  function carveProps(P, I, groupOf, made, A, pairs, total, minArea, labels) {
    const nt = I.length / 3, np = pairs.length / 4;
    const { prop, nProps } = labels || propLabels(P, I, made, A, pairs, total, minArea);
    if (!nProps) return null;
    // relabel: props first, then the connected runs of what each old region has left
    const base = nProps, par2 = new Int32Array(nt); for (let t = 0; t < nt; t++) par2[t] = t;
    const find2 = (x) => { while (par2[x] !== x) { par2[x] = par2[par2[x]]; x = par2[x]; } return x; };
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (prop[a] < 0 && prop[b] < 0 && groupOf[a] === groupOf[b]) { const x = find2(a), y = find2(b); if (x !== y) par2[x] = y; } }
    const runArea = new Map(); for (let t = 0; t < nt; t++) if (prop[t] < 0) { const r = find2(t); runArea.set(r, (runArea.get(r) || 0) + A[t]); }
    // small leftover runs go to the neighbour run (or prop) they share the most border with, smallest first, a few rounds
    const label = new Int32Array(nt); for (let t = 0; t < nt; t++) label[t] = prop[t] >= 0 ? prop[t] : base + find2(t);
    for (let round = 0; round < 6; round++) {
      const la = new Map(); for (let t = 0; t < nt; t++) la.set(label[t], (la.get(label[t]) || 0) + A[t]);
      const border = new Map();
      for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (label[a] === label[b]) continue; const ea = 3 * pairs[4 * i + 2], eb = 3 * pairs[4 * i + 3], len = Math.hypot(P[ea] - P[eb], P[ea + 1] - P[eb + 1], P[ea + 2] - P[eb + 2]); for (const [x, y] of [[label[a], label[b]], [label[b], label[a]]]) { let m = border.get(x); if (!m) { m = new Map(); border.set(x, m); } m.set(y, (m.get(y) || 0) + len); } }
      const small = [...la].filter(([l, a]) => l >= base && a < minArea).sort((x, y) => x[1] - y[1]);
      if (!small.length) break;
      const to = new Map();
      for (const [l] of small) { const m = border.get(l); if (!m) continue; let best = -1, bl = -1; for (const [o, len] of m) if (len > bl && !to.has(o)) { bl = len; best = o; } if (best >= 0) to.set(l, best); }
      if (!to.size) break;
      for (let t = 0; t < nt; t++) { let l = label[t]; while (to.has(l)) l = to.get(l); label[t] = l; }
    }
    const ids = new Map(); for (let t = 0; t < nt; t++) { if (!ids.has(label[t])) ids.set(label[t], ids.size); groupOf[t] = ids.get(label[t]); }
    return ids.size;
  }
  // (1.84) Sections are pieces of parts (the owner: "sections should be more sectional like sections or smaller pieces
  // of defined parts, where a section is where a border or otherwise detectable delineation in a single part is"): the
  // crease sections (`segmentSurface`) laid over the parts (`segmentParts`, or `opts.parts`, a groupOf), so a section
  // never runs from one part into another (a sleeve's band never takes in the cape over it); a piece under the speck
  // size melts into the neighbour in the same part it shares most border with, or stays when it is a whole small part.
  function segmentSections(P, I, opts = {}) {
    const nt = I.length / 3, pairs = trianglePairs(I);
    const parts = opts.parts || segmentParts(P, I, opts.partsOpts || {}).groupOf;
    const sec = segmentSurface(P, I, opts);
    const A = new Float64Array(nt); let total = 0;
    for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]); A[t] = Math.hypot(n[0], n[1], n[2]) / 2; total += A[t]; }
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < pairs.length; i += 4) { const a = pairs[i], b = pairs[i + 1]; if (parts[a] === parts[b] && sec.groupOf[a] === sec.groupOf[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
    const limit = total * (opts.minFrac === undefined ? 0.003 : opts.minFrac) * 0.5;
    for (let pass = 0; pass < 8; pass++) { // specks the overlay leaves along a part's border melt within their part
      const area = new Map(); for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      const nb = new Map();
      for (let i = 0; i < pairs.length; i += 4) {
        const a = pairs[i], b = pairs[i + 1]; if (parts[a] !== parts[b]) continue; const x = find(a), y = find(b); if (x === y) continue;
        const l = Math.hypot(P[3 * pairs[i + 2]] - P[3 * pairs[i + 3]], P[3 * pairs[i + 2] + 1] - P[3 * pairs[i + 3] + 1], P[3 * pairs[i + 2] + 2] - P[3 * pairs[i + 3] + 2]);
        for (const [u, w] of [[x, y], [y, x]]) { if (area.get(u) >= limit) continue; let m = nb.get(u); if (!m) nb.set(u, m = new Map()); m.set(w, (m.get(w) || 0) + l); }
      }
      let merged = 0, touched = new Set();
      for (const [u, m] of [...nb].sort((p, q) => area.get(p[0]) - area.get(q[0]))) { if (touched.has(u) || find(u) !== u) continue; let best = -1, bl = 0; for (const [w, l] of m) if (l > bl && !touched.has(find(w))) { bl = l; best = find(w); } if (best < 0 || best === u) continue; par[u] = best; touched.add(best); merged++; }
      if (!merged) break;
    }
    const groupOf = new Int32Array(nt), ids = new Map(); for (let t = 0; t < nt; t++) { const r = find(t); if (!ids.has(r)) ids.set(r, ids.size); groupOf[t] = ids.get(r); }
    if (opts.tongues !== false) trimTongues(P, I, groupOf, { hard: sec.hard || null, within: parts }); // (1.96) tongues go to the section they poke into, within their part
    if (opts.planes !== false) flatIslands(P, I, groupOf, { within: parts, hard: sec.hard || null }); // (1.97) a flat patch walled off from its section goes to the face it is flush with
    unpinchGroups(P, I, groupOf);
    const out = bordersFromGroups(P, I, groupOf);
    out.areas = new Array(out.count).fill(0); for (let t = 0; t < nt; t++) out.areas[out.groupOf[t]] += A[t];
    if (sec.hard) out.hard = sec.hard;
    out.parts = parts;
    return out;
  }
  function segmentSurface(P, I, opts = {}) {
    const angle = opts.angle === undefined ? 35 : opts.angle, minFrac = opts.minFrac === undefined ? 0.003 : opts.minFrac, fold = opts.fold;
    const keepCreased = opts.keepCreased !== undefined ? !!opts.keepCreased : fold !== undefined; // (1.72) with a fold, regions creased all round are kept
    const nt = I.length / 3, nv = P.length / 3;
    const N = new Float64Array(nt * 3), A = new Float64Array(nt), C = fold !== undefined ? new Float64Array(nt * 3) : null;
    let total = 0;
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      const L = Math.hypot(n[0], n[1], n[2]);
      A[t] = L / 2; total += L / 2;
      if (L > 0) { N[3 * t] = n[0] / L; N[3 * t + 1] = n[1] / L; N[3 * t + 2] = n[2] / L; }
      if (C) for (let k = 0; k < 3; k++) C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
    }
    // triangle neighbours across each edge, with the edge's length
    const pairs = trianglePairs(I);
    const par = new Int32Array(nt);
    for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const cosA = Math.cos((angle * Math.PI) / 180), cosF = fold !== undefined ? Math.cos((fold * Math.PI) / 180) : cosA;
    const np = pairs.length / 4, smooth = new Uint8Array(np);
    for (let i = 0; i < pairs.length; i += 4) {
      const s = pairs[i], q = pairs[i + 1];
      const dot = N[3 * s] * N[3 * q] + N[3 * s + 1] * N[3 * q + 1] + N[3 * s + 2] * N[3 * q + 2];
      // a valley: the neighbour's centre lies on the outward side of this triangle's plane
      const valley = C && (C[3 * q] - C[3 * s]) * N[3 * s] + (C[3 * q + 1] - C[3 * s + 1]) * N[3 * s + 1] + (C[3 * q + 2] - C[3 * s + 2]) * N[3 * s + 2] > 0;
      if (dot >= (valley ? cosF : cosA)) smooth[i / 4] = 1;
    }
    // (1.74) where a hard surface meets an organic one there is a border, whatever the angle (the owner: "make sure the
    // application can determine when a hard surface meets a more organic surface and splits accordingly")
    const hard = (opts.hardSurface !== undefined ? opts.hardSurface : fold !== undefined) ? hardSurface(P, I, N, A, pairs, total) : null;
    if (hard && opts.props !== false) { // (1.80) a made object's whole surface counts as hard, the contact surface it owns included (a book's recessed page block, flush with the skirt)
      const { prop } = propLabels(P, I, hard, A, pairs, total, total * 0.002);
      for (let t = 0; t < nt; t++) if (prop[t] >= 0) hard[t] = 1;
    }
    if (hard) for (let i = 0; i < np; i++) if (hard[pairs[4 * i]] !== hard[pairs[4 * i + 1]]) smooth[i] = 0;
    for (let i = 0; i < np; i++) if (smooth[i]) { const x = find(pairs[4 * i]), y = find(pairs[4 * i + 1]); if (x !== y) par[x] = y; }
    // melt specks into the neighbour they share the most border with, smallest first, until none are left
    const minA = total * minFrac;
    const sharpTurn = 40 * Math.PI / 180;
    const hardOfRegion = (r) => { if (!hard) return 0; if (hardArea === null) return 0; return (hardArea.get(find(r)) || 0) * 2 > (areaAll.get(find(r)) || 1) ? 1 : 0; };
    let hardArea = null, areaAll = null;
    let keepWidth = 0; // a creased region kept must be at least this wide on average (its area over its outline): a median edge, and 0.4% of the model's size
    if (keepCreased) { const L = []; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 3000))) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); } L.sort((x, y) => x - y); keepWidth = Math.max(L[L.length >> 1] || 0, 0.004 * diag(bounds(P))); }
    for (let pass = 0; pass < 12; pass++) {
      const area = new Map();
      for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      const border = new Map(), tot = new Map(), turn = new Map();
      for (let i = 0; i < pairs.length; i += 4) {
        const x = find(pairs[i]), y = find(pairs[i + 1]);
        if (x === y) continue;
        const a = 3 * pairs[i + 2], b = 3 * pairs[i + 3], len = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
        // with `keepCreased`, the length counted is the smooth part of the border (a speck joins what it runs into smoothly)
        const w = keepCreased ? (smooth[i / 4] ? len : 0.02 * len) : len;
        for (const [g, h] of [[x, y], [y, x]]) { if (!border.has(g)) border.set(g, new Map()); const m = border.get(g); m.set(h, (m.get(h) || 0) + w); }
        if (keepCreased) { tot.set(x, (tot.get(x) || 0) + len); tot.set(y, (tot.get(y) || 0) + len); const s0 = pairs[i], q0 = pairs[i + 1], tr = len * Math.acos(Math.max(-1, Math.min(1, N[3 * s0] * N[3 * q0] + N[3 * s0 + 1] * N[3 * q0 + 1] + N[3 * s0 + 2] * N[3 * q0 + 2]))); turn.set(x, (turn.get(x) || 0) + tr); turn.set(y, (turn.get(y) || 0) + tr); }
      }
      const small = [...area.entries()].filter(([, a]) => a < minA).sort((a, b) => a[1] - b[1]);
      if (!small.length) break;
      if (hard) { hardArea = new Map(); areaAll = area; for (let t = 0; t < nt; t++) if (hard[t]) { const r = find(t); hardArea.set(r, (hardArea.get(r) || 0) + A[t]); } }
      let merged = 0;
      for (const [g, ga] of small) {
        const r = find(g);
        if (r !== g) continue; // already merged this pass
        const m = border.get(g);
        if (!m) continue;
        let best = -1, bl = -1;
        const gh = hardOfRegion(g);
        for (const [h, len] of m) { const hr = find(h); if (hr === g) continue; if (hard && ga >= 0.1 * minA && hardOfRegion(hr) !== gh) continue; /* (1.75) never across hard to organic */ if (len > bl) { bl = len; best = hr; } }
        // a region creased all round (the face of a book under a hand) is a part, however small: only a speck
        // under a tenth of the smallest size, or one that meets a neighbour smoothly along a fifth of its border, melts
        if (keepCreased && ga >= 0.1 * minA && bl < 0.2 * (tot.get(g) || 1) && ga >= keepWidth * (tot.get(g) || Infinity) && (turn.get(g) || 0) >= sharpTurn * (tot.get(g) || Infinity)) continue; // (and creased sharply, 40° on average round it, as a part's edge is: the arcs of a wavy ledge, folded gently against each other, still melt) // (and chunky: a thin band between two creases, as a lathe leaves where a bar meets a ball, still melts)
        if (best >= 0) { par[g] = best; merged++; }
      }
      if (!merged) break;
    }
    // number the regions, largest first
    const area = new Map();
    for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
    const order = [...area.entries()].sort((a, b) => b[1] - a[1]);
    const id = new Map(order.map(([r], i) => [r, i]));
    const groupOf = new Int32Array(nt);
    for (let t = 0; t < nt; t++) groupOf[t] = id.get(find(t));
    let areas = order.map(([, a]) => a), count = order.length;
    if (unpinchGroups(P, I, groupOf)) { count = 0; for (let t = 0; t < nt; t++) count = Math.max(count, groupOf[t] + 1); areas = new Array(count).fill(0); for (let t = 0; t < nt; t++) areas[groupOf[t]] += A[t]; }
    const borders = [];
    for (let i = 0; i < pairs.length; i += 4) if (groupOf[pairs[i]] !== groupOf[pairs[i + 1]]) borders.push(pairs[i], pairs[i + 1], pairs[i + 2], pairs[i + 3]);
    return { groupOf, count, areas, borders: new Int32Array(borders), hard };
  }
  /* ---------- form: the parts of a figure by thickness ----------
     The owner's "intelligence to detect form and parts": limbs, a head, a torso, a weapon are told apart by how
     thick the solid is under the surface (the shape diameter of Shapira, Shamir and Cohen-Or), not by how the
     surface turns. Rays are sent inward from each vertex in a small cone; the median distance to the far wall is
     the thickness there. Thicknesses are clustered into a few levels, each triangle takes the level that fits it
     and its neighbours (a few passes of smoothing that respects concave creases), and each connected run of one
     level is a region: a head and a torso of like thickness still part at the thin neck between them. */
  // A grid of the triangles for ray casting: cells of about diag / n, each with the triangles whose box meets it
  function meshGrid(P, I, n = 48) {
    const b = bounds(P), lo = [b.min[0] - 1e-6, b.min[1] - 1e-6, b.min[2] - 1e-6], size = Math.max(...b.size) / n + 1e-9;
    const dims = b.size.map(s => Math.max(1, Math.ceil(s / size) + 1)), nt = I.length / 3;
    const cellOf = (x, y, z) => (Math.min(dims[0] - 1, Math.max(0, Math.floor((x - lo[0]) / size))) * dims[1] + Math.min(dims[1] - 1, Math.max(0, Math.floor((y - lo[1]) / size)))) * dims[2] + Math.min(dims[2] - 1, Math.max(0, Math.floor((z - lo[2]) / size)));
    const count = new Int32Array(dims[0] * dims[1] * dims[2] + 1);
    const span = (t) => { const a = 3 * I[3 * t], c = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2], out = []; for (let k = 0; k < 3; k++) { const x0 = Math.min(P[a + k], P[c + k], P[d + k]), x1 = Math.max(P[a + k], P[c + k], P[d + k]); out.push(Math.max(0, Math.floor((x0 - lo[k]) / size)), Math.min(dims[k] - 1, Math.floor((x1 - lo[k]) / size))); } return out; };
    for (let t = 0; t < nt; t++) { const s = span(t); for (let i = s[0]; i <= s[1]; i++) for (let j = s[2]; j <= s[3]; j++) for (let k = s[4]; k <= s[5]; k++) count[(i * dims[1] + j) * dims[2] + k + 1]++; }
    for (let c = 0; c < count.length - 1; c++) count[c + 1] += count[c];
    const fill = count.slice(0, -1), tris = new Int32Array(count[count.length - 1]);
    for (let t = 0; t < nt; t++) { const s = span(t); for (let i = s[0]; i <= s[1]; i++) for (let j = s[2]; j <= s[3]; j++) for (let k = s[4]; k <= s[5]; k++) tris[fill[(i * dims[1] + j) * dims[2] + k]++] = t; }
    return { lo, size, dims, start: count, tris, cellOf };
  }
  // The distance along a ray to the first face whose back it meets (the far wall from inside), or -1
  function castInward(grid, P, I, o, d, maxT) {
    const { lo, size, dims, start, tris } = grid;
    let ix = Math.floor((o[0] - lo[0]) / size), iy = Math.floor((o[1] - lo[1]) / size), iz = Math.floor((o[2] - lo[2]) / size);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= dims[0] || iy >= dims[1] || iz >= dims[2]) return -1;
    const step = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])], idx = [ix, iy, iz];
    const tMax = [0, 0, 0], tDelta = [0, 0, 0];
    for (let k = 0; k < 3; k++) { if (d[k] === 0) { tMax[k] = Infinity; tDelta[k] = Infinity; continue; } const next = lo[k] + (idx[k] + (step[k] > 0 ? 1 : 0)) * size; tMax[k] = (next - o[k]) / d[k]; tDelta[k] = Math.abs(size / d[k]); }
    let best = -1, guard = 0;
    const eps = size * 1e-6;
    while (guard++ < dims[0] + dims[1] + dims[2] + 3) {
      const c = (idx[0] * dims[1] + idx[1]) * dims[2] + idx[2];
      for (let q = start[c]; q < start[c + 1]; q++) {
        const t = tris[q], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], cc = 3 * I[3 * t + 2];
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det >= -1e-12) continue; // only the back of a face (its normal along the ray, so det < 0): the far wall seen from inside
        const inv = 1 / det, tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > eps && tt < maxT && (best < 0 || tt < best)) best = tt;
      }
      // the nearest hit found in a cell already passed is final
      const tCell = Math.min(tMax[0], tMax[1], tMax[2]);
      if (best >= 0 && best <= tCell) return best;
      if (tCell > maxT) return best;
      const k = tMax[0] <= tMax[1] ? (tMax[0] <= tMax[2] ? 0 : 2) : (tMax[1] <= tMax[2] ? 1 : 2);
      idx[k] += step[k]; tMax[k] += tDelta[k];
      if (idx[k] < 0 || idx[k] >= dims[k]) return best;
    }
    return best;
  }
  // The thickness under every vertex: the median distance to the far wall over rays in a cone round the inward
  // normal, smoothed a little over the surface. NaN where no ray meets a wall (an open or inverted surface).
  function shapeDiameter(P, I, opts = {}) {
    const nv = P.length / 3, nt = I.length / 3, b = bounds(P), D = diag(b);
    const grid = meshGrid(P, I, opts.cells || Math.max(48, Math.min(96, Math.round(Math.cbrt(nt) * 1.2)))), vt = vertexTriangles(P, I), adj = vertexAdjacency(P, I);
    const cone = ((opts.cone === undefined ? 45 : opts.cone) * Math.PI) / 180, rays = opts.rays || 12;
    const out = new Float32Array(nv), fn = [0, 0, 0];
    // Rays are cast from a spread of vertices (one per cell of a grid sized to the sample count), never more than
    // `samples` of them, and the rest take the value of their nearest sampled neighbour before the smoothing: the
    // thickness is read per part, so a sample every millimetre or two is plenty, and a 500k-triangle sculpt took
    // twenty seconds when every vertex cast its rays.
    const samples = opts.samples === undefined ? 16000 : opts.samples;
    let sampled = null;
    if (samples > 0 && nv > samples) {
      let area = 0;
      for (let t = 0; t < nt; t++) {
        const a = 3 * I[3 * t], c = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2];
        const n = cross3([P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]]);
        area += Math.hypot(n[0], n[1], n[2]) / 2;
      }
      const cell = Math.max(D * 1e-4, Math.sqrt(area / samples)), seen = new Set();
      sampled = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) {
        const key = `${Math.floor((P[3 * v] - b.min[0]) / cell)},${Math.floor((P[3 * v + 1] - b.min[1]) / cell)},${Math.floor((P[3 * v + 2] - b.min[2]) / cell)}`;
        if (!seen.has(key)) { seen.add(key); sampled[v] = 1; }
      }
    }
    for (let v = 0; v < nv; v++) {
      if (sampled && !sampled[v]) { out[v] = NaN; continue; }
      let nx = 0, ny = 0, nz = 0;
      for (let e = vt.start[v]; e < vt.start[v + 1]; e++) { faceNormal(P, I, vt.tri[e], fn); nx += fn[0]; ny += fn[1]; nz += fn[2]; }
      const l = Math.hypot(nx, ny, nz); if (!(l > 0)) { out[v] = NaN; continue; }
      const n = [-nx / l, -ny / l, -nz / l], F = frameFromNormal(n, [0, 0, 0]);
      const o = [P[3 * v] + n[0] * D * 1e-5, P[3 * v + 1] + n[1] * D * 1e-5, P[3 * v + 2] + n[2] * D * 1e-5];
      const hits = [];
      const c = Math.cos(cone), s = Math.sin(cone);
      const t0 = castInward(grid, P, I, o, n, D); if (t0 > 0) hits.push(t0);
      for (let r = 0; r < rays; r++) {
        const a = (2 * Math.PI * r) / rays, d = [n[0] * c + (F.u[0] * Math.cos(a) + F.v[0] * Math.sin(a)) * s, n[1] * c + (F.u[1] * Math.cos(a) + F.v[1] * Math.sin(a)) * s, n[2] * c + (F.u[2] * Math.cos(a) + F.v[2] * Math.sin(a)) * s];
        const tt = castInward(grid, P, I, o, d, D); if (tt > 0) hits.push(tt); // the ray's own length, as the shape diameter is defined
      }
      if (!hits.length) { out[v] = NaN; continue; }
      // at a corner or an edge half the cone can leave through a neighbouring face at once: only rays that see a
      // wall within a few times the straight ray's distance count
      const keep = t0 > 0 ? hits.filter(h => h > t0 / 2.5 && h < t0 * 2.5) : hits;
      keep.sort((x, y) => x - y);
      out[v] = keep[keep.length >> 1];
    }
    if (sampled) { // the vertices that cast no rays take the thickness of the nearest sampled one, over the surface
      const queue = new Int32Array(nv); let head = 0, tail = 0;
      for (let v = 0; v < nv; v++) if (sampled[v] && out[v] > 0) queue[tail++] = v;
      while (head < tail) { const v = queue[head++]; for (let e = adj.start[v]; e < adj.start[v + 1]; e++) { const u = adj.to[e]; if (!(out[u] > 0)) { out[u] = out[v]; queue[tail++] = u; } } }
    }
    // a little smoothing in log space, so one stray ray doesn't make a bump; holes filled from neighbours
    let cur = new Float32Array(nv); for (let v = 0; v < nv; v++) cur[v] = out[v] > 0 ? Math.log(out[v]) : NaN;
    for (let pass = 0; pass < (opts.smooth === undefined ? 3 : opts.smooth); pass++) {
      const next = new Float32Array(nv);
      for (let v = 0; v < nv; v++) {
        let sum = 0, n = 0; if (cur[v] === cur[v]) { sum += 2 * cur[v]; n += 2; }
        for (let e = adj.start[v]; e < adj.start[v + 1]; e++) { const u = cur[adj.to[e]]; if (u === u) { sum += u; n++; } }
        next[v] = n ? sum / n : NaN;
      }
      cur = next;
    }
    for (let v = 0; v < nv; v++) out[v] = cur[v] === cur[v] ? Math.exp(cur[v]) : NaN;
    return out;
  }
  // Regions by form: the thickness levels, smoothed over the surface, each connected run of a level a region.
  // ratio: thickness levels closer than this (1.35: 35% apart) are one; minFrac: regions under this share of the
  // area melt into a neighbour. Returns what segmentSurface returns.
  function segmentForm(P, I, opts = {}) {
    const nt = I.length / 3, nv = P.length / 3, ratio = opts.ratio || 1.35, minFrac = opts.minFrac === undefined ? 0.02 : opts.minFrac;
    const sdf = opts.sdf || shapeDiameter(P, I, opts);
    const A = new Float64Array(nt), X = new Float64Array(nt), N = new Float64Array(nt * 3), C = new Float64Array(nt * 3);
    let total = 0, nx = 0;
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), L = Math.hypot(n[0], n[1], n[2]);
      A[t] = L / 2; total += L / 2; if (L > 0) { N[3 * t] = n[0] / L; N[3 * t + 1] = n[1] / L; N[3 * t + 2] = n[2] / L; }
      for (let k = 0; k < 3; k++) C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
      let s = 0, m = 0; for (const v of [I[3 * t], I[3 * t + 1], I[3 * t + 2]]) if (sdf[v] > 0) { s += Math.log(sdf[v]); m++; }
      X[t] = m ? s / m : NaN; if (m) nx++;
    }
    if (!nx) return bordersFromGroups(P, I, new Int32Array(nt));
    // thickness levels: k-means on the log thickness, area-weighted, from six seeds, merged where levels are close
    // on a histogram of 2,048 bins of the log thickness, weighted by area: the same levels, without sorting and
    // sweeping every triangle twenty times (most of a second on a 350k-triangle figure)
    let lo = Infinity, hi = -Infinity; for (let t = 0; t < nt; t++) if (X[t] === X[t]) { if (X[t] < lo) lo = X[t]; if (X[t] > hi) hi = X[t]; }
    const NB = 2048, span = Math.max(1e-9, hi - lo), hw = new Float64Array(NB), hc = new Float64Array(NB), hs = new Float64Array(NB);
    for (let t = 0; t < nt; t++) if (X[t] === X[t]) { const i = Math.min(NB - 1, Math.floor(((X[t] - lo) / span) * NB)); hw[i] += A[t]; hc[i]++; hs[i] += X[t] * A[t]; }
    // each bin at its triangles' own area-weighted mean, so the levels land where they did before
    const xs = []; for (let i = 0; i < NB; i++) if (hc[i] > 0) xs.push([hw[i] > 0 ? hs[i] / hw[i] : lo + ((i + 0.5) / NB) * span, hw[i], hc[i]]);
    let centres = [];
    { let tot = 0; for (const q of xs) tot += q[2]; for (let k = 0; k < 6; k++) { const want = Math.floor(((k + 0.5) / 6) * tot); let acc = 0, x = xs[xs.length - 1][0]; for (const q of xs) { acc += q[2]; if (acc > want) { x = q[0]; break; } } centres.push(x); } } // seeds by triangle count, as before
    const kmeans = () => { for (let it = 0; it < 20; it++) { const sum = centres.map(() => 0), w = centres.map(() => 0); for (const [x, a] of xs) { let bi = 0, bd = Infinity; for (let k = 0; k < centres.length; k++) { const d = Math.abs(x - centres[k]); if (d < bd) { bd = d; bi = k; } } sum[bi] += x * a; w[bi] += a; } let moved = 0; for (let k = 0; k < centres.length; k++) if (w[k] > 0) { const c = sum[k] / w[k]; moved += Math.abs(c - centres[k]); centres[k] = c; } centres.sort((p, q) => p - q); if (moved < 1e-6) break; } };
    kmeans();
    const gap = Math.log(ratio);
    for (let guard = 0; guard < 8; guard++) {
      let merged = false;
      for (let k = 0; k + 1 < centres.length; k++) if (centres[k + 1] - centres[k] < gap) { centres.splice(k, 2, (centres[k] + centres[k + 1]) / 2); merged = true; break; }
      if (!merged) break;
      kmeans();
    }
    const K = centres.length, sigma = gap / 2;
    // the label of each triangle: its own fit plus its neighbours' labels, across concave creases less so
    const pairs = trianglePairs(I);
    const nbStart = new Int32Array(nt + 1); for (let i = 0; i < pairs.length; i += 4) { nbStart[pairs[i] + 1]++; nbStart[pairs[i + 1] + 1]++; }
    for (let t = 0; t < nt; t++) nbStart[t + 1] += nbStart[t];
    const nbFill = nbStart.slice(0, nt), nb = new Int32Array(nbStart[nt]), nw = new Float64Array(nbStart[nt]);
    for (let i = 0; i < pairs.length; i += 4) {
      const s = pairs[i], q = pairs[i + 1], dot = N[3 * s] * N[3 * q] + N[3 * s + 1] * N[3 * q + 1] + N[3 * s + 2] * N[3 * q + 2];
      const valley = (C[3 * q] - C[3 * s]) * N[3 * s] + (C[3 * q + 1] - C[3 * s + 1]) * N[3 * s + 1] + (C[3 * q + 2] - C[3 * s + 2]) * N[3 * s + 2] > 1e-9;
      const w = (valley && dot < 0.97 ? 0.15 : 1) * Math.max(0.1, dot); // labels change easily across a crease
      nb[nbFill[s]] = q; nw[nbFill[s]++] = w; nb[nbFill[q]] = s; nw[nbFill[q]++] = w;
    }
    const label = new Int32Array(nt), lambda = opts.smoothness === undefined ? 1.5 : opts.smoothness;
    for (let t = 0; t < nt; t++) { let bi = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = X[t] === X[t] ? Math.abs(X[t] - centres[k]) : 0; if (d < bd) { bd = d; bi = k; } } label[t] = bi; }
    const cost = new Float64Array(K);
    for (let pass = 0; pass < 8; pass++) {
      let changed = 0;
      for (let t = 0; t < nt; t++) {
        for (let k = 0; k < K; k++) { const d = X[t] === X[t] ? (X[t] - centres[k]) / sigma : 0; cost[k] = 0.5 * d * d; }
        for (let e = nbStart[t]; e < nbStart[t + 1]; e++) { const l = label[nb[e]]; for (let k = 0; k < K; k++) if (k !== l) cost[k] += lambda * nw[e]; }
        let bi = label[t], bc = cost[bi]; for (let k = 0; k < K; k++) if (cost[k] < bc - 1e-12) { bc = cost[k]; bi = k; }
        if (bi !== label[t]) { label[t] = bi; changed++; }
      }
      if (!changed) break;
    }
    // each connected run of one level is a region; specks melt into the neighbour they share most border with
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < pairs.length; i += 4) if (label[pairs[i]] === label[pairs[i + 1]]) { const x = find(pairs[i]), y = find(pairs[i + 1]); if (x !== y) par[x] = y; }
    const minA = total * minFrac;
    for (let pass = 0; pass < 12; pass++) {
      const area = new Map(); for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      const border = new Map();
      for (let i = 0; i < pairs.length; i += 4) { const x = find(pairs[i]), y = find(pairs[i + 1]); if (x === y) continue; const a = 3 * pairs[i + 2], b = 3 * pairs[i + 3], len = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); for (const [g, h] of [[x, y], [y, x]]) { if (!border.has(g)) border.set(g, new Map()); const m = border.get(g); m.set(h, (m.get(h) || 0) + len); } }
      const small = [...area.entries()].filter(([, a]) => a < minA).sort((a, b) => a[1] - b[1]);
      if (!small.length) break;
      let merged = 0;
      for (const [g] of small) { if (find(g) !== g) continue; const m = border.get(g); if (!m) continue; let best = -1, bl = -1; for (const [h, len] of m) { const hr = find(h); if (hr !== g && len > bl) { bl = len; best = hr; } } if (best >= 0) { par[g] = best; merged++; } }
      if (!merged) break;
    }
    const groupOf = new Int32Array(nt), ids = new Map();
    for (let t = 0; t < nt; t++) { const r = find(t); if (!ids.has(r)) ids.set(r, ids.size); groupOf[t] = ids.get(r); }
    unpinchGroups(P, I, groupOf);
    const seg = bordersFromGroups(P, I, groupOf);
    seg.areas = new Array(seg.count).fill(0); for (let t = 0; t < nt; t++) seg.areas[groupOf[t]] += A[t];
    seg.levels = centres.map(c => Math.exp(c)); seg.sdf = sdf;
    return seg;
  }
  /* ---------- parts: form and folds together ----------
     The owner's "arms, legs, tools in hand, feet, bases, hats, clothing borders, backpacks": a part is bounded
     by a real feature. The thickness runs (segmentForm) and the crease regions (segmentSurface with the fold)
     are laid over each other, and then neighbouring regions are merged, weakest border first, until every
     border left is strong: concave along most of its length (a collar, an armpit, a hat's brim, a shirt's hem),
     a step in thickness (an arm against a torso, a sword against a hand), or a neck (a border short against the
     smaller region's size: a head on a neck, a base under a foot). A convex ridge or a thickness wobble in the
     middle of a smooth body is not a part boundary, so those borders go. */
  // (1.81) A made object's pieces, wherever the grouping put them. The owner's book at Fine: a lip of the lower cover (5 mm²
  // of CAD triangles, too small to be a prop, cut off from the cover by inside corners and by cloth showing between the
  // clasps) runs on into the skirt with no crease, so it ended in the skirt's region and lit up with it. After the grouping,
  // the made surface in regions that aren't an object's is tested against every object's convex outline (tolerance 2.5% of
  // the object's diagonal), triangle by triangle, and what passes moves to the region holding most of that object.   // Only made triangles move, so the grouping of everything else is as it was.
  function ownObjectPieces(P, I, groupOf, made, prop, A, C, N, pairs) {
    const nt = I.length / 3, np = pairs.length / 4; let total = 0; for (let t = 0; t < nt; t++) total += A[t]; let nObj = 0; for (let t = 0; t < nt; t++) if (prop[t] + 1 > nObj) nObj = prop[t] + 1;
    if (!nObj) return 0;
    // the region each object lives in (the one holding most of its area), and which regions those are
    const objRegion = new Int32Array(nObj).fill(-1); { const tally = new Map(); for (let t = 0; t < nt; t++) if (prop[t] >= 0) { const k = prop[t] * 1e6 + groupOf[t]; tally.set(k, (tally.get(k) || 0) + A[t]); } const best = new Float64Array(nObj); for (const [k, a] of tally) { const o = Math.floor(k / 1e6), g = k - o * 1e6; if (a > best[o]) { best[o] = a; objRegion[o] = g; } } }
    const isObjRegion = new Set(objRegion);
    // pieces: connected made triangles of one region, in a region that isn't an object's, not in any object
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    // (1.82) every triangle outside the objects is a candidate, even ones too: a book's lower edge strips between its clasps are
    // part even, part CAD triangles; a run moves only if it holds made surface (below)
    const cand = (t) => prop[t] < 0 && !isObjRegion.has(groupOf[t]);
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (cand(a) && cand(b) && groupOf[a] === groupOf[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
    const pieces = new Map(); for (let t = 0; t < nt; t++) if (cand(t)) { const r = find(t); let L = pieces.get(r); if (!L) { L = []; pieces.set(r, L); } L.push(t); }
    if (!pieces.size) return 0;
    const hulls = []; for (let o = 0; o < nObj; o++) { const vs = new Set(), tris = []; for (let t = 0; t < nt; t++) if (prop[t] === o) { tris.push(t); vs.add(I[3 * t]); vs.add(I[3 * t + 1]); vs.add(I[3 * t + 2]); } const pts = []; for (const v of vs) pts.push([P[3 * v], P[3 * v + 1], P[3 * v + 2]]); const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const q of pts) for (let k = 0; k < 3; k++) { if (q[k] < mn[k]) mn[k] = q[k]; if (q[k] > mx[k]) mx[k] = q[k]; } const h = convexOutline(pts, faceDirections(N, A, tris)); const tol = 0.025 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); hulls.push(h ? { planes: h.planes, tol, mn: mn.map(x => x - tol), mx: mx.map(x => x + tol) } : null); }
    // each made triangle in such a piece is tested on its own: inside an object's outline within the tolerance and, near its
    // boundary, not facing into it (a recessed page block lies deep inside; a fingertip or a cuff resting on the cover, and the
    // fan of thin robe triangles round the book, face into it). Connected runs of passing triangles of at least 0.01% of the
    // surface move to the object's region
    const pass = new Int32Array(nt).fill(-1);
    for (const L of pieces.values()) for (const t of L) {
      const x = C[3 * t], y = C[3 * t + 1], z = C[3 * t + 2];
      for (let o = 0; o < nObj; o++) { const H = hulls[o]; if (!H || objRegion[o] < 0) continue; if (x < H.mn[0] || y < H.mn[1] || z < H.mn[2] || x > H.mx[0] || y > H.mx[1] || z > H.mx[2]) continue;
        let worst = -Infinity, wp = null; for (const pl of H.planes) { const d = pl[0] * x + pl[1] * y + pl[2] * z - pl[3]; if (d > worst) { worst = d; wp = pl; } if (d > H.tol) break; }
        if (worst < -H.tol || (worst <= H.tol && N[3 * t] * wp[0] + N[3 * t + 1] * wp[1] + N[3 * t + 2] * wp[2] >= 0.2)) { pass[t] = o; break; } } // (1.82: facing along the outline's nearest face, 0.2: the robe's fan of thin triangles under the book faces across it (90% of it under 0.12) and had been handed to the book; the lip's edge triangles align from 0.25)
    }
    const rp = new Int32Array(nt); for (let t = 0; t < nt; t++) rp[t] = t;
    const rf = (x) => { while (rp[x] !== x) { rp[x] = rp[rp[x]]; x = rp[x]; } return x; };
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (pass[a] >= 0 && pass[a] === pass[b] && groupOf[a] === groupOf[b]) { const x = rf(a), y = rf(b); if (x !== y) rp[x] = y; } }
    const runA = new Map(), runM = new Map(); for (let t = 0; t < nt; t++) if (pass[t] >= 0) { const r = rf(t); runA.set(r, (runA.get(r) || 0) + A[t]); if (made[t]) runM.set(r, (runM.get(r) || 0) + A[t]); }
    const lost = new Set(), src = groupOf.slice ? groupOf.slice() : Array.from(groupOf);
    { // (1.85) a run of made triangles in a sculpted region that borders an object's region far more than anything else is a
      // strip of the object (the owner's book: the wall of the groove between the cover's panels, a narrow strip of long thin
      // triangles running across the book, sat in the hand's part because the hand touches it, and a cut round the hand ran
      // out along it to the book's edge and back, capping a thin sheet across the cover). Neither inside the outline nor on it
      // facing out, it passes no test above; its border is what gives it away
      const mp = new Int32Array(nt); for (let t = 0; t < nt; t++) mp[t] = t;
      const mf = (x) => { while (mp[x] !== x) { mp[x] = mp[mp[x]]; x = mp[x]; } return x; };
      const isRun = (t) => made[t] && cand(t) && pass[t] < 0;
      for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (isRun(a) && isRun(b) && groupOf[a] === groupOf[b]) { const x = mf(a), y = mf(b); if (x !== y) mp[x] = y; } }
      const toObj = new Map(), toRest = new Map();
      for (let i = 0; i < np; i++) {
        const a = pairs[4 * i], b = pairs[4 * i + 1], va = 3 * pairs[4 * i + 2], vb = 3 * pairs[4 * i + 3];
        const l = Math.hypot(P[va] - P[vb], P[va + 1] - P[vb + 1], P[va + 2] - P[vb + 2]);
        for (const [x, y] of [[a, b], [b, a]]) { if (!isRun(x) || (isRun(y) && groupOf[y] === groupOf[x])) continue; const r = mf(x);
          if (isObjRegion.has(groupOf[y])) { let m = toObj.get(r); if (!m) toObj.set(r, m = new Map()); m.set(groupOf[y], (m.get(groupOf[y]) || 0) + l); }
          else if (!made[y]) toRest.set(r, (toRest.get(r) || 0) + l); } // (only sculpted surface counts against it: more made surface beside it is more of the object)
      }
      const dest = new Map(); for (const [r, m] of toObj) { let bg = -1, bl = 0; for (const [g, l] of m) if (l > bl) { bl = l; bg = g; } if (bg >= 0 && bl >= 1.5 * (toRest.get(r) || 0)) dest.set(r, bg); }
      const objOfRegion = new Map(); for (let o = 0; o < nObj; o++) if (objRegion[o] >= 0) objOfRegion.set(objRegion[o], o);
      for (let t = 0; t < nt; t++) if (isRun(t)) { const g = dest.get(mf(t)); if (g !== undefined) { lost.add(groupOf[t]); groupOf[t] = g; prop[t] = objOfRegion.has(g) ? objOfRegion.get(g) : prop[t]; lost.add(g); } }
    }
    let moved = lost.size ? 1 : 0; // (1.82: runs of at least 0.003% of the surface, a fifth of them made: the strips between the clasps are each a few tenths of a mm²)
    for (let t = 0; t < nt; t++) if (pass[t] >= 0) { const r = rf(t); if (runA.get(r) >= 3e-5 * total && (runM.get(r) || 0) >= 0.2 * runA.get(r)) { groupOf[t] = objRegion[pass[t]]; prop[t] = pass[t]; moved++; lost.add(src[t]); lost.add(groupOf[t]); } }
    if (moved) { // (1.82) a region the move cut in two keeps its main piece; the scraps it left go to the neighbour they share most border with (on a boolean figure the shoulder's fillet went to the torso and left islands of the arm's region behind, which a pick cut as crumbs)
      const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
      const fd = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
      const np = pairs.length / 4;
      for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (groupOf[a] === groupOf[b] && lost.has(groupOf[a])) par[fd(a)] = fd(b); }
      const pa = new Map(), big = new Map(); for (let t = 0; t < nt; t++) if (lost.has(groupOf[t])) { const r = fd(t); pa.set(r, (pa.get(r) || 0) + A[t]); }
      for (const [r, a] of pa) { const g = groupOf[r]; if (!big.has(g) || a > pa.get(big.get(g))) big.set(g, r); }
      const nbr = new Map(); for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (groupOf[a] === groupOf[b]) continue; for (const [x, y] of [[a, b], [b, a]]) { if (!lost.has(groupOf[x])) continue; const r = fd(x); if (big.get(groupOf[x]) === r) continue; let m = nbr.get(r); if (!m) nbr.set(r, m = new Map()); m.set(groupOf[y], (m.get(groupOf[y]) || 0) + 1); } }
      const to = new Map(); for (const [r, m] of nbr) { if (pa.get(r) >= 0.25 * pa.get(big.get(groupOf[r]))) continue; let bg = -1, bc = 0; for (const [g, c] of m) if (c > bc) { bc = c; bg = g; } if (bg >= 0) to.set(r, bg); }
      for (let t = 0; t < nt; t++) if (lost.has(groupOf[t])) { const g = to.get(fd(t)); if (g !== undefined) groupOf[t] = g; }
    }
    return moved;
  }
  function segmentParts(P, I, opts = {}) {
    const nt = I.length / 3, nv = P.length / 3, ratio = opts.ratio || 1.35, minFrac = opts.minFrac === undefined ? 0.02 : opts.minFrac;
    const fold = ((opts.fold === undefined ? 15 : opts.fold) * Math.PI) / 180, strong = opts.strength === undefined ? 0.5 : opts.strength;
    const form = segmentForm(P, I, { ...opts, minFrac: 0.004 });
    const sdf = form.sdf;
    // (1.79) the crease regions as 1.70 found them: no hard-to-organic borders and no kept creased pieces (from 1.72 to 1.78
    // those turned 7 parts into 50 on Father Rhinehardt); the made props are carved out whole at the end instead
    const creases = segmentSurface(P, I, { angle: opts.angle || 60, fold: opts.fold === undefined ? 15 : opts.fold, minFrac: 0.003, hardSurface: false, keepCreased: opts.keepCreased !== false }); // (a small piece creased all round, a block on a box, stays a crease region: that costs one region on Rhinehardt)
    // triangle areas, normals, centroids and log thickness
    const A = new Float64Array(nt), X = new Float64Array(nt), N = new Float64Array(nt * 3), C = new Float64Array(nt * 3);
    let total = 0;
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), L = Math.hypot(n[0], n[1], n[2]);
      A[t] = L / 2; total += L / 2; if (L > 0) { N[3 * t] = n[0] / L; N[3 * t + 1] = n[1] / L; N[3 * t + 2] = n[2] / L; }
      for (let k = 0; k < 3; k++) C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
      let s = 0, m = 0; for (const v of [I[3 * t], I[3 * t + 1], I[3 * t + 2]]) if (sdf && sdf[v] > 0) { s += Math.log(sdf[v]); m++; }
      X[t] = m ? s / m : 0;
    }
    // the edges between triangles, with their length and whether they are a concave crease at least `fold` deep
    const pairs = trianglePairs(I);
    const ne = pairs.length / 4, ehard = new Uint8Array(ne), elen = new Float64Array(ne), eturn = new Float64Array(ne), econcave = new Uint8Array(ne), econvex = new Uint8Array(ne), cosFold = Math.cos(fold);
    for (let e = 0; e < ne; e++) {
      const s = pairs[4 * e], q = pairs[4 * e + 1], a = 3 * pairs[4 * e + 2], b = 3 * pairs[4 * e + 3];
      elen[e] = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
      const dot = N[3 * s] * N[3 * q] + N[3 * s + 1] * N[3 * q + 1] + N[3 * s + 2] * N[3 * q + 2];
      const valley = (C[3 * q] - C[3 * s]) * N[3 * s] + (C[3 * q + 1] - C[3 * s + 1]) * N[3 * s + 1] + (C[3 * q + 2] - C[3 * s + 2]) * N[3 * s + 2] > 1e-9;
      eturn[e] = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (creases.hard && creases.hard[s] !== creases.hard[q]) ehard[e] = 1; // hard surface meets organic
      econcave[e] = valley && dot < cosFold ? 1 : 0;
      econvex[e] = !valley && dot < cosFold ? 1 : 0;
    }
    // (1.79) the made props (a book, a crucifix, a sword: long thin coplanar triangles) are fixed from the start: each is
    // one region whatever the thickness and the creases say, nothing merges with one or melts into one, and a small
    // part's contact with the figure is measured against the sculpted surface alone (a hand lying on a book touches
    // the book all along its underside; what holds it to the figure is a sliver of skirt)
    const made = opts.props === false ? null : hardSurface(P, I, N, A, pairs, total), minProp = total * Math.min(minFrac / 4, 0.002);
    const labels = made ? propLabels(P, I, made, A, pairs, total, minProp) : null, prop = labels ? labels.prop : null;
    // both labellings laid over each other: a region is a connected run with one form level and one crease region
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const isProp = (t) => prop !== null && prop[t] >= 0;
    const same = (s, q) => isProp(s) || isProp(q) ? prop[s] === prop[q] : form.groupOf[s] === form.groupOf[q] && creases.groupOf[s] === creases.groupOf[q];
    for (let e = 0; e < ne; e++) if (same(pairs[4 * e], pairs[4 * e + 1])) { const x = find(pairs[4 * e]), y = find(pairs[4 * e + 1]); if (x !== y) par[x] = y; }
    const propRoot = new Uint8Array(nt); if (prop) for (let t = 0; t < nt; t++) if (prop[t] >= 0) propRoot[find(t)] = 1; // (roots never change for a prop: nothing joins it)
    // region sums and the borders between regions, rebuilt after each round of merging. Merging only ever removes
    // borders, so only the edges that are borders now are looked at again, and the sums are gathered from the
    // triangles once per root (each round a merge is the only change; rescanning every triangle and edge each
    // round was most of the time on a big figure).
    const cand = []; for (let e = 0; e < ne; e++) if (find(pairs[4 * e]) !== find(pairs[4 * e + 1])) cand.push(e);
    const tArea = new Float64Array(nt), tX = new Float64Array(nt), tHard = new Float64Array(nt); // (tHard: the hard surface in each root, so a region's kind is judged whole)
    for (let t = 0; t < nt; t++) { const r = find(t); tArea[r] += A[t]; tX[r] += X[t] * A[t]; if (creases.hard && creases.hard[t]) tHard[r] += A[t]; }
    const sumsOf = (r) => { // the sums of a root, gathered from the roots merged into it so far
      return { a: tArea[r], x: tX[r] };
    };
    const join = (from, to) => { from = find(from); to = find(to); if (from === to) return; par[from] = to; tArea[to] += tArea[from]; tX[to] += tX[from]; tHard[to] += tHard[from]; tArea[from] = 0; tX[from] = 0; tHard[from] = 0; };
    // (1.78) a region's kind, judged whole: hard (a made object) when at least half its surface is, else organic. Hard
    // never joins organic, however they meet: the edge test alone let a book face melt into the coat's front strip
    // once that strip held a few mm² of hard surface from an earlier melt, since the edges between hard and hard read
    // as no boundary
    const kindOf = (r) => (creases.hard ? (tHard[r] >= 0.5 * tArea[r] ? 1 : 0) : 0), kindsDiffer = (a, b) => !!creases.hard && kindOf(find(a)) !== kindOf(find(b));
    const stats = () => {
      const area = new Map(), xsum = new Map(), border = new Map(); // border: "r,s" -> { r, s, len, concave, convex }
      for (let i = 0; i < cand.length; i++) {
        const e = cand[i], x = find(pairs[4 * e]), y = find(pairs[4 * e + 1]); if (x === y) continue;
        for (const r of [x, y]) if (!area.has(r)) { const sm = sumsOf(r); area.set(r, sm.a); xsum.set(r, sm.x); }
        const r = Math.min(x, y), s = Math.max(x, y), key = r * nt + s;
        let b = border.get(key); if (!b) { b = { r, s, len: 0, concave: 0, convex: 0, turn: 0, hard: 0 }; border.set(key, b); }
        b.len += elen[e]; b.turn += elen[e] * eturn[e]; if (ehard[e]) b.hard += elen[e]; if (econcave[e]) b.concave += elen[e]; if (econvex[e]) b.convex += elen[e];
      }
      return { area, xsum, border };
    };
    const gap = Math.log(ratio);
    // how much a border looks like a part boundary, 0 to 1
    const strength = (b, st) => {
      const ar = st.area.get(b.r), as = st.area.get(b.s), small = Math.min(ar, as);
      const concave = b.len > 0 ? b.concave / b.len : 0, convex = b.len > 0 ? b.convex / b.len : 0;
      // a step in thickness (1 at the ratio the levels are told apart at); along a convex ridge (a plate's rim, a
      // box's edge) the thickness reading jumps by itself, so a ridge is never taken for a part boundary
      const neckRaw = 1 - Math.min(1, b.len / (2 * Math.sqrt(Math.PI * small))); // 1 when the border is tiny against the smaller region's girth
      const neck = neckRaw * (1 - convex);
      // a thickness step counts in full only with something on the surface to back it (a valley along part of the
      // border, or a narrowing): across a flat plate the reading drifts from thick by a wall to thin at the rim,
      // and a hat's brim came out as four rings
      const support = Math.min(1, 0.35 + 1.5 * concave + 1.5 * neckRaw);
      const step = Math.min(1, Math.abs(st.xsum.get(b.r) / ar - st.xsum.get(b.s) / as) / gap) * (1 - convex) * support;
      if (propRoot[b.r] || propRoot[b.s] || kindsDiffer(b.r, b.s)) return 1; // (1.78, 1.79) a made object against a sculpted one is always a part boundary
      return Math.max(concave, step, neck, b.len > 0 ? b.hard / b.len : 0); // (1.74) a border all along where a hard surface meets an organic one is a part boundary
    };
    const melt = (limit, pickWeakest, keep) => { // regions under `limit` of the area go into a neighbour: the one sharing the most border, or the weakest border
      for (let pass = 0; pass < 30; pass++) {
        const st = stats(), by = new Map();
        for (const b of st.border.values()) { if (!by.has(b.r)) by.set(b.r, []); if (!by.has(b.s)) by.set(b.s, []); by.get(b.r).push(b); by.get(b.s).push(b); }
        const small = [...st.area.entries()].filter(([, a]) => a < limit).sort((a, b) => a[1] - b[1]);
        if (!small.length) return;
        let merged = 0;
        const touched = new Set(); // (1.79) a region whose neighbour already changed this pass waits for the next, so what is judged is what the stats say
        for (const [g] of small) {
          if (find(g) !== g || propRoot[g]) continue;
          const bs = by.get(g); if (!bs) continue;
          if (bs.some(b => touched.has(find(b.r === g ? b.s : b.r)))) continue;
          let best = null, bv = -Infinity;
          // a small region bordered mostly by a prop is a face of it the labelling missed (a book's bottom face, modelled with even
          // triangles, had melted onto the robe it lies flush with): it joins the prop it shares the most border with. Otherwise a
          // sliver beside a prop (the fan a boolean leaves on a robe) stays with the sculpted surface
          let propLen = 0, allLen = 0, bestProp = null, bpl = -1;
          for (const b of bs) { const o = find(b.r === g ? b.s : b.r); if (o === g) continue; allLen += b.len; if (propRoot[o]) { propLen += b.len; if (b.len > bpl) { bpl = b.len; bestProp = o; } } }
          if (bestProp !== null && propLen >= 0.4 * allLen) { join(g, bestProp); touched.add(find(bestProp)); merged++; continue; }
          const anyPlain = propLen < allLen;
          for (const b of bs) { const o = b.r === g ? b.s : b.r; if (find(o) === g) continue; if (anyPlain && propRoot[find(o)]) continue; if (keep && (keep.has(g) || keep.has(find(o))) && !keep.tubeWith(g, find(o))) continue; /* (1.83) a limb only joins, or takes in, more of itself */ const sb = pickWeakest ? strength(b, st) : 0; /* (1.79: a strong border no longer stops a small region melting by itself; a part attached by a narrow contact is kept below) */ if ((kindsDiffer(g, o) || (b.len > 0 && b.hard / b.len >= 0.5)) && st.area.get(g) >= 0.0001 * total) continue; /* (1.75, 1.78) never across hard to organic, by region or by edge */ /* never across a clear part boundary, unless a speck */ const v = pickWeakest ? -(b.turn / (b.len || 1)) - 0.1 * sb : b.len; if (v > bv) { bv = v; best = o; } } // (1.72) into the neighbour it flows into most smoothly: a strip of robe beside a book belongs to the robe, which it meets at a gentle fold, not to the book it meets at a right angle
          // (1.72) a small part clearly bounded all round (its weakest border still a crease or a step well past
          // `strong`: a hand lying on a book, a clasp) stays a part: the owner's picks "grabbed too much" when such
          // parts melted into what they touch. Only a speck under a tenth of the limit goes regardless.
          if (best !== null && st.area.get(g) >= keepArea) { // (1.79) a small part attached by a narrow contact stays a part: a hand resting on a book touches it
            // along a sliver of its outline (on Father Rhinehardt 5 mm of a 21 mm girth), a block on a box along its base, where a panel
            // of robe between two folds is bordered along its whole outline (from 1.72 to 1.78 every small piece creased all
            // round was kept, which turned 7 parts into 50)
            let weak = Infinity, per = 0; for (const b of bs) { const o = b.r === g ? b.s : b.r; if (find(o) === g) continue; weak = Math.min(weak, strength(b, st)); if (!propRoot[find(o)]) per += b.len; }
            if (weak >= keepStrong && per < 0.7 * 2 * Math.sqrt(Math.PI * st.area.get(g))) continue;
          }
          if (best !== null) { if (keep) keep.joined(g, find(best)); join(g, best); touched.add(find(best)); merged++; }
        }
        if (!merged) return;
      }
    };
    const keepStrong = opts.keepStrong !== undefined ? opts.keepStrong : Math.min(0.95, Math.max(0.6, strong + 0.15));
    const keepArea = total * minFrac / 4; // the smallest part kept for a narrow contact: 1% of the surface at Big, 0.5% at Balanced, 0.2% at Fine
    let keepWidth; { const L = []; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 3000))) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); } L.sort((x, y) => x - y); keepWidth = Math.max(L[L.length >> 1] || 0, 0.004 * diag(bounds(P))); } // a kept part is chunky, not a band along a crease
    melt(total * 0.003, true); // slivers the overlay leaves along creases (into the neighbour they are least separated from: by the longest border, a book's face went into the hand lying on it)
    // merge across weak borders, the weakest first, until every border is a part boundary
    for (let round = 0; round < 400; round++) {
      const st = stats();
      let weakest = null, wv = strong;
      for (const b of st.border.values()) { const v = strength(b, st); if (v < wv) { wv = v; weakest = b; } }
      if (!weakest) break;
      join(weakest.s, weakest.r);
    }
    // (1.83) a limb stays a part: a tube-shaped region (a sleeve, a leg) at least `keepArea` is never melted for being small.
    // At Balanced the owner's sleeves (1.3% and 1.5% of the surface) went into the capelet and the coat's back
    const tubes = new Set();
    if (opts.tubes !== false) {
      const acc = new Map();
      for (let t = 0; t < nt; t++) {
        const r = find(t); let s = acc.get(r); if (!s) acc.set(r, s = new Float64Array(16));
        const a = A[t], x = C[3 * t], y = C[3 * t + 1], z = C[3 * t + 2], u = N[3 * t], v = N[3 * t + 1], w = N[3 * t + 2];
        s[0] += a; s[1] += a * x; s[2] += a * y; s[3] += a * z; s[4] += a * x * x; s[5] += a * x * y; s[6] += a * x * z; s[7] += a * y * y; s[8] += a * y * z; s[9] += a * z * z;
        s[10] += a * u * u; s[11] += a * u * v; s[12] += a * u * w; s[13] += a * v * v; s[14] += a * v * w; s[15] += a * w * w;
      }
      for (const [r, s] of acc) if (!propRoot[r] && s[0] >= keepArea && s[0] < total * minFrac && tubeLike(s)) tubes.add(r);
      const both = (a, b) => { const x = acc.get(a), y = acc.get(b), z = new Float64Array(16); for (let k = 0; k < 16; k++) z[k] = (x ? x[k] : 0) + (y ? y[k] : 0); return z; };
      tubes.tubeWith = (g, o) => tubeLike(both(g, o)); // a sleeve's piece joins the rest of the sleeve, not the cape it meets
      tubes.joined = (g, o) => { const z = both(g, o); acc.set(o, z); const was = tubes.has(g) || tubes.has(o); tubes.delete(g); if (was && tubeLike(z)) tubes.add(o); else tubes.delete(o); };
    }
    melt(total * minFrac, true, tubes); // what is left small joins the neighbour it is least separated from
    const groupOf = new Int32Array(nt), ids = new Map();
    for (let t = 0; t < nt; t++) { const r = find(t); if (!ids.has(r)) ids.set(r, ids.size); groupOf[t] = ids.get(r); }
    // (1.79) the props' enclosed islands (a bevel strip between two panels) join them, and leftover slivers melt
    if (made) carveProps(P, I, groupOf, made, A, pairs, total, minProp, labels);
    if (made && prop) ownObjectPieces(P, I, groupOf, made, prop, A, C, N, pairs); // (1.81)
    if (made && prop) for (let t = 0; t < nt; t++) if (prop[t] >= 0) made[t] = 1; // (1.80) the objects' claimed surface is hard too, so the seam is pinned round it
    if (opts.tongues !== false) { // (1.96) narrow tongues across smooth borders go to the region they poke into; the made objects keep what they hold
      let fixed = null; if (prop) { fixed = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (prop[t] >= 0) fixed[t] = 1; }
      trimTongues(P, I, groupOf, { hard: made, fixed }); // (no region is emptied: a tongue is at most a tenth of its region)
    }
    if (opts.planes !== false) flatIslands(P, I, groupOf, { hard: made }); // (1.97) no patch of a book's cover between the fingers goes with the hand on it
    unpinchGroups(P, I, groupOf);
    const seg = bordersFromGroups(P, I, groupOf);
    seg.areas = new Array(seg.count).fill(0); for (let t = 0; t < nt; t++) seg.areas[groupOf[t]] += A[t];
    seg.levels = form.levels; seg.sdf = sdf; seg.hard = made; // (1.77) so a pick's slice can pin the seam where hard meets organic
    return seg;
  }
  // Every edge longer than maxEdge split at its middle, the triangles beside it with it (one split edge gives two
  // triangles, two give three, three give four), until no edge is longer. The mesh stays sealed: neighbours share
  // each new point. Thickness and region labels are read per triangle, so long thin triangles blur them.
  function subdivideMesh(P, I, opts = {}) {
    const maxEdge = opts.maxEdge, max2 = maxEdge * maxEdge;
    let pos = Array.from(P), idx = Array.from(I);
    for (let round = 0; round < (opts.rounds || 8); round++) {
      const nv = pos.length / 3, mids = new Map(), out = [];
      const mid = (a, b) => { const key = a < b ? a * nv + b : b * nv + a; let m = mids.get(key); if (m === undefined) { m = pos.length / 3; pos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2); mids.set(key, m); } return m; };
      const long = (a, b) => (pos[3 * a] - pos[3 * b]) ** 2 + (pos[3 * a + 1] - pos[3 * b + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * b + 2]) ** 2 > max2;
      let any = false;
      for (let t = 0; t < idx.length; t += 3) {
        let a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const s = [long(a, b), long(b, c), long(c, a)], n = s.filter(Boolean).length;
        if (!n) { out.push(a, b, c); continue; }
        any = true;
        if (n === 3) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); continue; }
        // turn the triangle so the split edges come first: a->b split (n = 1), or a->b and b->c split (n = 2)
        for (let k = 0; k < 3; k++) { if ((n === 1 && s[0]) || (n === 2 && s[0] && s[1])) break; [a, b, c] = [b, c, a]; s.push(s.shift()); }
        if (n === 1) { const ab = mid(a, b); out.push(a, ab, c, ab, b, c); }
        else { const ab = mid(a, b), bc = mid(b, c); out.push(a, ab, c, ab, bc, c, ab, b, bc); }
      }
      idx = out;
      if (!any) break;
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  }
  // Neighbouring triangles across each edge, as [t1, t2, a, b] per edge (a, b the edge's ends), in the order the
  // second triangle of each edge is met; a third triangle on an edge starts a new pair, as before. Built once per
  // index array with the open-addressing pair map and kept: the part finders built it four times over with a JS Map
  // of a million keys, which was a second and more of finding the parts on a 350k-triangle figure.
  const pairCache = new WeakMap();
  function trianglePairs(I) {
    let out = pairCache.get(I);
    if (out) return out;
    const nt = I.length / 3, em = new PairMap(I.length), buf = new Int32Array(I.length * 2);
    let n = 0;
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], lo = a < b ? a : b, hi = a < b ? b : a, f = em.get(lo, hi);
      if (f <= 0) em.set(lo, hi, t + 1);
      else { em.set(lo, hi, 0); buf[n++] = f - 1; buf[n++] = t; buf[n++] = a; buf[n++] = b; }
    }
    out = buf.slice(0, n); pairCache.set(I, out);
    return out;
  }
  // The same result shape for any grouping of triangles (used by tests and by hand-made groupings).
  function bordersFromGroups(P, I, groupOf) {
    const nt = I.length / 3, pairs = trianglePairs(I);
    let m = 0; for (let i = 0; i < pairs.length; i += 4) if (groupOf[pairs[i]] !== groupOf[pairs[i + 1]]) m++;
    const borders = new Int32Array(4 * m); let j = 0;
    for (let i = 0; i < pairs.length; i += 4) if (groupOf[pairs[i]] !== groupOf[pairs[i + 1]]) { borders[j++] = pairs[i]; borders[j++] = pairs[i + 1]; borders[j++] = pairs[i + 2]; borders[j++] = pairs[i + 3]; }
    let count = 0; for (let t = 0; t < nt; t++) count = Math.max(count, groupOf[t] + 1);
    return { groupOf, count, borders };
  }
  /* ---------- regions carried through a cut ----------
     The owner, on 1.95: after three cuts a click on a sleeve picked a region that wandered over the capelet, because
     every piece was segmented afresh, sockets and cut faces and all, and came out differently each time. A piece made
     by a cut now keeps the regions its surface had on the part it was cut from. */
  // Which triangle of the part (P0, I0) each triangle of a piece cut from it lies on, or -1 for a triangle the cut
  // made (a cut face, a wall, a key). Triangles the cut left alone are matched by their corners' positions exactly;
  // the rest (split by a slice, or with a corner eased along the line) are surface when all three corners lie on the
  // part's surface, and take the triangle under their middle that faces their way.
  function inheritTriangles(P0, I0, P, I) {
    const nt0 = I0.length / 3, nt = I.length / 3, nv0 = P0.length / 3, nv = P.length / 3, src = new Int32Array(nt).fill(-1);
    if (!nt || !nt0) return src;
    const F0 = P0 instanceof Float32Array ? P0 : new Float32Array(P0), F = P instanceof Float32Array ? P : new Float32Array(P);
    const U0 = new Uint32Array(F0.buffer, F0.byteOffset, F0.length), U = new Uint32Array(F.buffer, F.byteOffset, F.length);
    const hash3 = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
    let size = 1; while (size < 2 * nv0 + 2) size <<= 1;
    const vtab = new Int32Array(size).fill(-1), canon = new Int32Array(nv0);
    for (let v = 0; v < nv0; v++) {
      const a = U0[3 * v], b = U0[3 * v + 1], c = U0[3 * v + 2]; let h = hash3(a, b, c) & (size - 1);
      for (;;) { const w = vtab[h]; if (w < 0) { vtab[h] = v; canon[v] = v; break; } if (U0[3 * w] === a && U0[3 * w + 1] === b && U0[3 * w + 2] === c) { canon[v] = w; break; } h = (h + 1) & (size - 1); }
    }
    const vmap = new Int32Array(nv);
    for (let v = 0; v < nv; v++) {
      const a = U[3 * v], b = U[3 * v + 1], c = U[3 * v + 2]; let h = hash3(a, b, c) & (size - 1), m = -1;
      for (;;) { const w = vtab[h]; if (w < 0) break; if (U0[3 * w] === a && U0[3 * w + 1] === b && U0[3 * w + 2] === c) { m = w; break; } h = (h + 1) & (size - 1); }
      vmap[v] = m;
    }
    let tsize = 1; while (tsize < 2 * nt0 + 2) tsize <<= 1;
    const ttab = new Int32Array(tsize).fill(-1), tri0 = new Int32Array(3 * nt0);
    const turn = (a, b, c, out, o) => { if (a <= b && a <= c) { out[o] = a; out[o + 1] = b; out[o + 2] = c; } else if (b <= a && b <= c) { out[o] = b; out[o + 1] = c; out[o + 2] = a; } else { out[o] = c; out[o + 1] = a; out[o + 2] = b; } };
    for (let t = 0; t < nt0; t++) {
      turn(canon[I0[3 * t]], canon[I0[3 * t + 1]], canon[I0[3 * t + 2]], tri0, 3 * t);
      const a = tri0[3 * t], b = tri0[3 * t + 1], c = tri0[3 * t + 2]; if (a === b || b === c || a === c) continue;
      let h = hash3(a, b, c) & (tsize - 1);
      for (;;) { const w = ttab[h]; if (w < 0) { ttab[h] = t; break; } if (tri0[3 * w] === a && tri0[3 * w + 1] === b && tri0[3 * w + 2] === c) break; h = (h + 1) & (tsize - 1); }
    }
    const used = new Uint8Array(nt0), q = [0, 0, 0], open = [];
    for (let t = 0; t < nt; t++) {
      const x = vmap[I[3 * t]], y = vmap[I[3 * t + 1]], z = vmap[I[3 * t + 2]];
      if (x >= 0 && y >= 0 && z >= 0) {
        turn(x, y, z, q, 0); let h = hash3(q[0], q[1], q[2]) & (tsize - 1);
        for (;;) { const w = ttab[h]; if (w < 0) break; if (tri0[3 * w] === q[0] && tri0[3 * w + 1] === q[1] && tri0[3 * w + 2] === q[2]) { src[t] = w; used[w] = 1; break; } h = (h + 1) & (tsize - 1); }
      }
      if (src[t] < 0) open.push(t);
    }
    if (!open.length) return src;
    // the rest by place: the part's triangles no piece triangle matched, near the open ones, in a grid of cells
    const bb0 = bounds(P0), eps = 1e-5 * diag(bb0);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of open) for (let k = 0; k < 3; k++) { const v = 3 * I[3 * t + k]; for (let j = 0; j < 3; j++) { if (P[v + j] < mn[j]) mn[j] = P[v + j]; if (P[v + j] > mx[j]) mx[j] = P[v + j]; } }
    const cands = []; let sum = 0;
    for (let t = 0; t < nt0; t++) {
      if (used[t]) continue;
      const a = 3 * I0[3 * t], b = 3 * I0[3 * t + 1], c = 3 * I0[3 * t + 2]; let out = false, ext = 0;
      for (let j = 0; j < 3 && !out; j++) { const lo = Math.min(P0[a + j], P0[b + j], P0[c + j]), hi = Math.max(P0[a + j], P0[b + j], P0[c + j]); if (hi < mn[j] - eps || lo > mx[j] + eps) out = true; ext = Math.max(ext, hi - lo); }
      if (!out) { cands.push(t); sum += ext; }
    }
    if (!cands.length) return src;
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], eps);
    const h = Math.max(1.5 * sum / cands.length, span / 96, 4 * eps), pad = 0.25 * h;
    const dim = [0, 1, 2].map(j => Math.max(1, Math.ceil((mx[j] - mn[j] + 2 * pad) / h) + 1));
    const cellOf = (x, j) => Math.max(0, Math.min(dim[j] - 1, Math.floor((x - mn[j] + pad) / h)));
    const cells = new Map();
    for (const t of cands) {
      const a = 3 * I0[3 * t], b = 3 * I0[3 * t + 1], c = 3 * I0[3 * t + 2], lo = [0, 0, 0], hi = [0, 0, 0];
      for (let j = 0; j < 3; j++) { lo[j] = cellOf(Math.min(P0[a + j], P0[b + j], P0[c + j]) - pad, j); hi[j] = cellOf(Math.max(P0[a + j], P0[b + j], P0[c + j]) + pad, j); }
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = (x * dim[1] + y) * dim[2] + z; let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(t); }
    }
    const at = (Q, v) => [Q[3 * v], Q[3 * v + 1], Q[3 * v + 2]];
    const near = (p, n) => { // the candidate nearest p (facing along n when given), as [triangle, distance]
      const L = cells.get((cellOf(p[0], 0) * dim[1] + cellOf(p[1], 1)) * dim[2] + cellOf(p[2], 2)); let best = -1, bd = Infinity;
      if (L) for (const t of L) {
        const a = at(P0, I0[3 * t]), b = at(P0, I0[3 * t + 1]), c = at(P0, I0[3 * t + 2]);
        if (n) { const m = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]), l = Math.hypot(m[0], m[1], m[2]); if (!(l > 0) || (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) / l < 0.5) continue; }
        const cp = closestOnTriangle(p, a, b, c), d = Math.hypot(cp[0] - p[0], cp[1] - p[1], cp[2] - p[2]);
        if (d < bd) { bd = d; best = t; }
      }
      return [best, bd];
    };
    const onSurf = new Int8Array(nv); // 1 on the part's surface, -1 off it
    for (const t of open) {
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) { const v = I[3 * t + k]; if (!onSurf[v]) onSurf[v] = vmap[v] >= 0 || near(at(P, v), null)[1] <= eps ? 1 : -1; if (onSurf[v] < 0) ok = false; }
      if (!ok) continue;
      const a = at(P, I[3 * t]), b = at(P, I[3 * t + 1]), c = at(P, I[3 * t + 2]);
      const n = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]), l = Math.hypot(n[0], n[1], n[2]);
      if (!(l > 0)) continue;
      const r = near([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], [n[0] / l, n[1] / l, n[2] / l]);
      if (r[0] >= 0 && r[1] <= pad) src[t] = r[0];
    }
    return src;
  }
  // The regions of a piece from those of the part it was cut from (`groupOf0`, by the part's triangles; `src` from
  // `inheritTriangles`). Every triangle of the old surface keeps its region. A scrap of a region left beside a cut
  // face (under `opts.scrap`, 15%, of that region as it was, `opts.areas`: what a smoothed cut line leaves along the
  // rim, or the stub past a flat limb end) joins the neighbour it shares the most border with, and so does any crumb
  // of a region this piece holds under 15% of. Each cut face (its
  // walls, its plug or socket) then joins the region it shares the most rim with, so the socket takes the place of
  // what was cut away and no region's outline runs through it: picking the coat takes the socket in it, and the
  // capelet's outline runs along the rim as it ran along the sleeve. A piece that is all new (a pin) is one region.
  function carryRegions(P, I, groupOf0, src, opts = {}) {
    const nt = I.length / 3, pairs = trianglePairs(I), np = pairs.length / 4, areas0 = opts.areas || null, scrap = opts.scrap === undefined ? 0.15 : opts.scrap;
    const lab = new Int32Array(nt), A = new Float64Array(nt); let count0 = 0;
    for (let t = 0; t < nt; t++) {
      lab[t] = src[t] >= 0 ? groupOf0[src[t]] : -1; if (lab[t] + 1 > count0) count0 = lab[t] + 1;
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2], n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      A[t] = Math.hypot(n[0], n[1], n[2]) / 2;
    }
    if (opts.count > count0) count0 = opts.count;
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < np; i++) { const a = pairs[4 * i], b = pairs[4 * i + 1]; if (lab[a] === lab[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
    const area = new Float64Array(nt), byFace = new Uint8Array(nt); let anyNew = false;
    for (let t = 0; t < nt; t++) { area[find(t)] += A[t]; if (lab[t] < 0) anyNew = true; }
    const out = new Int32Array(nt);
    if (anyNew) {
      { const vnew = new Uint8Array(P.length / 3); for (let t = 0; t < nt; t++) if (lab[t] < 0) { vnew[I[3 * t]] = 1; vnew[I[3 * t + 1]] = 1; vnew[I[3 * t + 2]] = 1; }
        for (let t = 0; t < nt; t++) if (lab[t] >= 0 && (vnew[I[3 * t]] || vnew[I[3 * t + 1]] || vnew[I[3 * t + 2]])) byFace[find(t)] = 1; } // (touching the cut's rim, if only at a point)
      const here = new Float64Array(count0 + 1); for (let t = 0; t < nt; t++) if (lab[t] >= 0) here[lab[t]] += A[t]; // how much of each region this piece holds
      const loose = (r) => lab[r] < 0 || (!!areas0 && (byFace[r] ? area[r] : here[lab[r]]) < scrap * (areas0[lab[r]] || 0)); // a cut face; a scrap beside one; or a crumb of a region that went with the other piece
      const nb = new Map(); // a loose run -> (the run beside it -> the length of border they share)
      for (let i = 0; i < np; i++) {
        const x = find(pairs[4 * i]), y = find(pairs[4 * i + 1]); if (x === y) continue;
        const lx = loose(x), ly = loose(y); if (!lx && !ly) continue;
        const va = 3 * pairs[4 * i + 2], vb = 3 * pairs[4 * i + 3], l = Math.hypot(P[va] - P[vb], P[va + 1] - P[vb + 1], P[va + 2] - P[vb + 2]);
        if (lx) { let m = nb.get(x); if (!m) nb.set(x, m = new Map()); m.set(y, (m.get(y) || 0) + l); }
        if (ly) { let m = nb.get(y); if (!m) nb.set(y, m = new Map()); m.set(x, (m.get(x) || 0) + l); }
      }
      // sets of runs: each scrap joins the run it borders most, then each cut face the set it borders most
      const sp = new Map(); const sf = (x) => { let r = x; while (sp.has(r) && sp.get(r) !== r) r = sp.get(r); return r; };
      const order = [...nb.keys()].sort((a, b) => (lab[a] < 0) - (lab[b] < 0) || area[a] - area[b]);
      for (const r of order) {
        const tally = new Map(); for (const [o, l] of nb.get(r)) { const s = sf(o); if (s === sf(r)) continue; tally.set(s, (tally.get(s) || 0) + l); }
        let best = -1, bl = 0; for (const [s, l] of tally) if (l > bl) { bl = l; best = s; }
        if (best >= 0) sp.set(sf(r), best);
      }
      // a set's region: that of its one run that isn't loose; of its biggest scrap when it has none; a new one when it is all cut face
      const setLab = new Map(), setBest = new Map(); let extra = count0;
      const roots = new Set(); for (let t = 0; t < nt; t++) roots.add(find(t));
      for (const r of roots) { const s = sf(r); if (lab[r] < 0) continue; const rank = loose(r) ? area[r] : Infinity; if (!(setBest.get(s) >= rank)) { setBest.set(s, rank); setLab.set(s, lab[r]); } }
      // (1.96) a region the cut split into two big runs (a U cut across its arms, a cape across the body) is a region
      // per run: the biggest keeps the old label, the others get new ones (`from` still names the old region)
      { const setArea = new Map(); for (const r of roots) { const s = sf(r); setArea.set(s, (setArea.get(s) || 0) + area[r]); }
        const taken = new Set(); for (const [s, l] of [...setLab].sort((a, b) => setArea.get(b[0]) - setArea.get(a[0]))) { if (taken.has(l)) setLab.set(s, extra++); else taken.add(l); } }
      for (const r of roots) { const s = sf(r); if (!setLab.has(s)) setLab.set(s, extra++); }
      for (let t = 0; t < nt; t++) out[t] = setLab.get(sf(find(t)));
      unpinchGroups(P, I, out);
    } else out.set(lab);
    // numbered in the order the part's regions were, the new ones last
    let top = 0; for (let t = 0; t < nt; t++) if (out[t] + 1 > top) top = out[t] + 1;
    const ren = new Int32Array(top).fill(-1); for (let t = 0; t < nt; t++) ren[out[t]] = 0;
    const from = []; for (let g = 0; g < top; g++) if (ren[g] === 0) { ren[g] = from.length; from.push(anyNew ? -1 : g); }
    for (let t = 0; t < nt; t++) out[t] = ren[out[t]];
    if (anyNew) { const tally = from.map(() => new Map()); for (let t = 0; t < nt; t++) if (lab[t] >= 0) { const m = tally[out[t]]; m.set(lab[t], (m.get(lab[t]) || 0) + A[t]); } tally.forEach((m, g) => { let bl = 0; for (const [l, a] of m) if (a > bl) { bl = a; from[g] = l; } }); }
    const seg = bordersFromGroups(P, I, out);
    seg.areas = new Array(seg.count).fill(0); for (let t = 0; t < nt; t++) seg.areas[out[t]] += A[t];
    if (opts.hard) { seg.hard = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (src[t] >= 0 && opts.hard[src[t]]) seg.hard[t] = 1; }
    if (opts.levels) seg.levels = opts.levels;
    seg.from = from; seg.carried = true;
    return seg;
  }

  /* ---------- curved cuts along a border ----------
     A border between two regions that runs all the way round (a sleeve hem, a collar) can split a part along
     its existing edges. Each side gets its own copy of the border's vertices and an identical curved cap that
     follows the border, so the pieces are sealed and fit together exactly. */
  // Closed chains of border edges between the same two regions.
  function borderLoops(P, seg) {
    const b = seg.borders, byPair = new Map();
    for (let e = 0; e < b.length / 4; e++) {
      const g1 = seg.groupOf[b[4 * e]], g2 = seg.groupOf[b[4 * e + 1]], key = g1 < g2 ? `${g1},${g2}` : `${g2},${g1}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(e);
    }
    const loops = [];
    for (const [key, edges] of byPair) {
      const at = new Map();
      for (const e of edges) for (const v of [b[4 * e + 2], b[4 * e + 3]]) { if (!at.has(v)) at.set(v, []); at.get(v).push(e); }
      const used = new Set();
      for (const e0 of edges) {
        if (used.has(e0)) continue;
        const verts = [b[4 * e0 + 2]], es = [e0];
        used.add(e0);
        let v = b[4 * e0 + 3], closed = false, simple = true;
        for (let guard = 0; guard < edges.length + 2; guard++) {
          if (v === verts[0]) { closed = true; break; }
          if (verts.includes(v)) { simple = false; break; }
          verts.push(v);
          const next = (at.get(v) || []).filter(x => !used.has(x));
          if (at.get(v).length !== 2) simple = false;
          if (!next.length) break;
          const e = next[0];
          used.add(e); es.push(e);
          v = b[4 * e + 2] === v ? b[4 * e + 3] : b[4 * e + 2];
        }
        let length = 0;
        for (let i = 0; i < verts.length - (closed ? 0 : 1); i++) { const p = verts[i], q = verts[(i + 1) % verts.length]; length += Math.hypot(P[3 * p] - P[3 * q], P[3 * p + 1] - P[3 * q + 1], P[3 * p + 2] - P[3 * q + 2]); }
        loops.push({ pair: key.split(',').map(Number), verts, edges: es, closed: closed && simple, length });
      }
    }
    return loops;
  }
  // Each region's whole outline, as closed loops: the line a cut takes to free that region, even where the outline
  // runs past several neighbouring regions (a sleeve hem with a seam crossing it, a panel among other panels).
  function regionOutlines(P, I, seg) {
    const b = seg.borders, nv = P.length / 3, out = [];
    const byGroup = new Map(); // group -> directed outline edges (a -> b as its own triangles run)
    const dir = (t, a, c) => { for (let k = 0; k < 3; k++) if (I[3 * t + k] === a && I[3 * t + (k + 1) % 3] === c) return true; return false; };
    for (let e = 0; e < b.length / 4; e++) {
      const t0 = b[4 * e], t1 = b[4 * e + 1], a = b[4 * e + 2], c = b[4 * e + 3];
      for (const tt of [t0, t1]) {
        const g = seg.groupOf[tt], fwd = dir(tt, a, c);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push({ from: fwd ? a : c, to: fwd ? c : a, e });
      }
    }
    for (const [g, edges] of byGroup) {
      const next = new Map();
      for (const d of edges) { if (!next.has(d.from)) next.set(d.from, []); next.get(d.from).push(d); }
      const used = new Set();
      for (const d0 of edges) {
        if (used.has(d0)) continue;
        const verts = [], es = [];
        let d = d0, simple = true, closed = false;
        for (let guard = 0; guard <= edges.length; guard++) {
          used.add(d); verts.push(d.from); es.push(d.e);
          if (d.to === d0.from) { closed = true; break; }
          const opts = (next.get(d.to) || []).filter(x => !used.has(x));
          if (opts.length !== 1) simple = false;
          if (!opts.length) break;
          d = opts[0];
        }
        if (new Set(verts).size !== verts.length) simple = false;
        let length = 0;
        for (let i = 0; i < verts.length; i++) { const p = verts[i], q = verts[(i + 1) % verts.length]; length += Math.hypot(P[3 * p] - P[3 * q], P[3 * p + 1] - P[3 * q + 1], P[3 * p + 2] - P[3 * q + 2]); }
        out.push({ region: g, verts, edges: es, closed: closed && simple, length });
      }
    }
    return out;
  }
  // Regions worth splitting off along their outline, as cut suggestions: an arm, a head, a backpack. Each region
  // whose outline closes is measured without cutting: its piece's volume (the region's triangles plus a cap over
  // each outline fanned from that outline's centre, facing out) and its outlines' flattened area, scored like a
  // flat cut (how much it frees, and how narrow the seam is for the piece). `point` is the region's innermost
  // triangle, for a pin on the model and for picking the region with a click.
  function regionCuts(P, I, seg, limit = 8) {
    const nt = I.length / 3, total = Math.abs(volume(P, I)) || 1, outlines = regionOutlines(P, I, seg);
    const byRegion = new Map();
    for (const l of outlines) { if (!byRegion.has(l.region)) byRegion.set(l.region, []); byRegion.get(l.region).push(l); }
    // the innermost triangle of each region: most steps from a border, over the triangle adjacency
    const adj = triangleAdjacency(P, I), nb = adj.nb, hops = new Int32Array(nt).fill(-1), queue = [];
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q < 0 || seg.groupOf[q] !== seg.groupOf[t]) { hops[t] = 0; queue.push(t); break; } }
    for (let i = 0; i < queue.length; i++) { const t = queue[i]; for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && hops[q] < 0 && seg.groupOf[q] === seg.groupOf[t]) { hops[q] = hops[t] + 1; queue.push(q); } } }
    const inner = new Int32Array(seg.count).fill(-1);
    for (let t = 0; t < nt; t++) { const g = seg.groupOf[t]; if (inner[g] < 0 || hops[t] > hops[inner[g]]) inner[g] = t; }
    const out = [];
    for (const [g, loops] of byRegion) {
      if (!loops.every(l => l.closed) || inner[g] < 0) continue;
      const ti0 = inner[g], o = [P[3 * I[3 * ti0]], P[3 * I[3 * ti0] + 1], P[3 * I[3 * ti0] + 2]];
      const tet = (a, b, c) => { const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2], bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2], cx = c[0] - o[0], cy = c[1] - o[1], cz = c[2] - o[2]; return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx); };
      const at = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
      let vol = 0;
      for (let t = 0; t < nt; t++) if (seg.groupOf[t] === g) vol += tet(at(I[3 * t]), at(I[3 * t + 1]), at(I[3 * t + 2]));
      // each outline runs as the region's triangles do, so its cap runs the other way to face out
      for (const l of loops) {
        const m = l.verts.length; let cx = 0, cy = 0, cz = 0;
        for (const v of l.verts) { cx += P[3 * v]; cy += P[3 * v + 1]; cz += P[3 * v + 2]; }
        const c = [cx / m, cy / m, cz / m];
        for (let i = 0; i < m; i++) vol += tet(c, at(l.verts[(i + 1) % m]), at(l.verts[i]));
      }
      const piece = Math.abs(vol) / 6, freed = Math.min(piece, total - piece);
      if (freed < 0.01 * total) continue;
      let cutArea = 0, length = 0;
      for (const l of loops) {
        const { xy } = loopFrame(P, l.verts), m = l.verts.length; let A = 0;
        for (let i = 0, j = m - 1; i < m; j = i++) A += xy[2 * j] * xy[2 * i + 1] - xy[2 * i] * xy[2 * j + 1];
        cutArea += Math.abs(A) / 2; length += l.length;
      }
      const ratio = cutArea / Math.pow(freed, 2 / 3), q = 1 / (1 + ratio / 1.5);
      const score = Math.sqrt(Math.min(1, freed / total / 0.08)) * q;
      const ti = inner[g], point = [(P[3 * I[3 * ti]] + P[3 * I[3 * ti + 1]] + P[3 * I[3 * ti + 2]]) / 3, (P[3 * I[3 * ti] + 1] + P[3 * I[3 * ti + 1] + 1] + P[3 * I[3 * ti + 2] + 1]) / 3, (P[3 * I[3 * ti] + 2] + P[3 * I[3 * ti + 1] + 2] + P[3 * I[3 * ti + 2] + 2]) / 3];
      out.push({ kind: 'region', region: g, loops: loops.length, length, point, piece, freed, cutArea, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
  // What Split into parts should try, best first, measured without cutting (from the owner's ten reference figures,
  // where most of the time went on regions that could never come off): each region, or set of regions, as the piece
  // its outline would free (its triangles closed by a fan per outline). A negative piece is a dip or a recess (an eye
  // socket, the inside of a cloak) and is dropped; so is a piece under `minShare` of the model (a hair tuft) and the
  // body itself (`keep`, the biggest region). Each carries its neighbours, by shared border length, so a region
  // refused as hooked or held at both ends can be tried again together with one of them (a forearm with its hand).
  // Flat cuts for Split into parts (1.76): the narrow points of what is left, as the Suggest tool finds them (a neck, a
  // waist, a limb's root), best first. Regions that hook (an arm whose hand rests on the hip, a sword against the
  // body) can't come off along their outline, and most of the owner's figures had ended a split with one of them.
  function flatSplitCandidates(P, I, opts = {}) {
    const scale = diag(bounds(P)), dirs = sweepDirections(P);
    let found = [];
    for (const d of dirs) found = found.concat(neckSweep(P, I, d, scale));
    return refineNecks(P, I, found, scale).sort((a, b) => b.score - a.score).slice(0, opts.limit || 6);
  }
  // One such cut: the plane through the spot, only the areas that free the piece (`it.areas`) cut, keys or a plug
  // sized to fit, the thickness and hook checks as the Plane tool's. { result, keys, plugs, F } or { error, code }.
  function flatSplit(P, I, it, opts = {}) {
    const scale = diag(bounds(P)), F = frameFromNormal(norm3(it.normal), it.point), cfg = opts.cfg;
    const an = analyzePlane(P, I, F, cfg, scale);
    if (an.base.error || !an.base.regions.length) return { error: 'The cut plane doesn’t pass through this part.' };
    const keep = new Set();
    for (const a of it.areas || []) { const d = [a[0] - F.o[0], a[1] - F.o[1], a[2] - F.o[2]], x = d[0] * F.u[0] + d[1] * F.u[1] + d[2] * F.u[2], y = d[0] * F.v[0] + d[1] * F.v[1] + d[2] * F.v[2]; const ri = regionAt(an.base, x, y); if (ri >= 0) keep.add(ri); }
    const skip = new Set(); if (keep.size) an.base.regions.forEach((r, i) => { if (!keep.has(i)) skip.add(i); });
    const keys = cfg.type === 'none' || cfg.type === 'plug' ? [] : autoPlaceKeys(an, cfg, opts.perArea || 2, skip);
    const plugs = cfg.type === 'plug' ? planPlugs(an, cfg, skip) : [];
    let result;
    try { result = cutMesh(P, I, F, { scale, cfg, keys, plugs, skip, minThickness: opts.minThickness || 0 }); } catch (err) { return { error: err.message, code: err.code || null }; }
    return { result, F, keys: result.keysUsed || keys.length, plugs: plugs.filter(q => q.ok).length };
  }
  function splitCandidates(P, I, seg, opts = {}) {
    // `whole`: the volume of the model as it was before any of it came off, so later rounds don't chop the
    // remainder into crumbs (on a 40 mm figure the twelfth piece was 0.02 cm³)
    const nt = I.length / 3, total = Math.abs(volume(P, I)) || 1, minShare = opts.minShare === undefined ? 0.015 : opts.minShare, floor = Math.max(minShare * total, (opts.minWhole === undefined ? 0.03 : opts.minWhole) * (opts.whole || 0));
    const keep = opts.keep !== undefined ? opts.keep : seg.areas.indexOf(Math.max(...seg.areas));
    const outlines = regionOutlines(P, I, seg), byRegion = new Map();
    for (const l of outlines) { if (!byRegion.has(l.region)) byRegion.set(l.region, []); byRegion.get(l.region).push(l); }
    // neighbours by shared border length
    const nbr = new Map(), b = seg.borders;
    for (let e = 0; e < b.length / 4; e++) {
      const g1 = seg.groupOf[b[4 * e]], g2 = seg.groupOf[b[4 * e + 1]], a = 3 * b[4 * e + 2], c = 3 * b[4 * e + 3], len = Math.hypot(P[a] - P[c], P[a + 1] - P[c + 1], P[a + 2] - P[c + 2]);
      for (const [x, y] of [[g1, g2], [g2, g1]]) { if (!nbr.has(x)) nbr.set(x, new Map()); nbr.get(x).set(y, (nbr.get(x).get(y) || 0) + len); }
    }
    const o = bounds(P).center, at = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
    const tet = (a, bb, c) => { const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2], bx = bb[0] - o[0], by = bb[1] - o[1], bz = bb[2] - o[2], cx = c[0] - o[0], cy = c[1] - o[1], cz = c[2] - o[2]; return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx); };
    const triVol = new Float64Array(seg.count);
    for (let t = 0; t < nt; t++) triVol[seg.groupOf[t]] += tet(at(I[3 * t]), at(I[3 * t + 1]), at(I[3 * t + 2]));
    const measure = (groups) => {
      const loops = groups.length === 1 ? (byRegion.get(groups[0]) || []) : groupLoops(P, I, seg, groups);
      if (!loops.length || !loops.every(l => l.closed)) return null;
      let vol = 0; for (const g of groups) vol += triVol[g];
      let cutArea = 0, length = 0;
      for (const l of loops) {
        const m = l.verts.length; let cx = 0, cy = 0, cz = 0;
        for (const v of l.verts) { cx += P[3 * v]; cy += P[3 * v + 1]; cz += P[3 * v + 2]; }
        const c = [cx / m, cy / m, cz / m];
        for (let i = 0; i < m; i++) vol += tet(c, at(l.verts[(i + 1) % m]), at(l.verts[i]));
        const { xy } = loopFrame(P, l.verts); let A = 0;
        for (let i = 0, j = m - 1; i < m; j = i++) A += xy[2 * j] * xy[2 * i + 1] - xy[2 * i] * xy[2 * j + 1];
        cutArea += Math.abs(A) / 2; length += l.length;
      }
      const piece = vol / 6;
      if (piece <= 0) return { groups, dip: true };
      if (piece < floor || piece > 0.85 * total) return { groups, small: piece < floor };
      const ratio = cutArea / Math.pow(piece, 2 / 3);
      return { groups, piece, share: piece / total, cutArea, length, loops: loops.length, ratio, score: Math.sqrt(Math.min(1, piece / total / 0.08)) / (1 + ratio / 1.5) };
    };
    const out = [], skipped = { dip: 0, small: 0, open: 0 };
    for (let g = 0; g < seg.count; g++) {
      if (g === keep) continue;
      const m = measure([g]);
      if (!m) { skipped.open++; continue; }
      if (m.dip) { skipped.dip++; continue; }
      if (!m.score) { skipped.small++; continue; }
      m.neighbours = [...(nbr.get(g) || new Map()).entries()].filter(([h]) => h !== keep).sort((x, y) => y[1] - x[1]).map(([h]) => h);
      m.alts = m.neighbours.slice(0, 2).map(h => measure([g, h])).filter(x => x && x.score).map(x => x.groups); // the region with a neighbour, to try when it alone is hooked or wedged
      out.push(m);
    }
    // each connected run of regions off the body, as one (a whole arm, upper arm to hand; an elephant's legs with
    // the base they stand on, where each leg alone is held at both ends by the body and the base)
    const seen = new Uint8Array(seg.count); seen[keep] = 1;
    for (let g = 0; g < seg.count; g++) {
      if (seen[g]) continue;
      const run = [], st = [g]; seen[g] = 1;
      while (st.length) { const x = st.pop(); run.push(x); for (const h of (nbr.get(x) || new Map()).keys()) if (!seen[h]) { seen[h] = 1; st.push(h); } }
      if (run.length < 2 || run.length > 12) continue;
      const m = measure(run.sort((a, b) => a - b));
      if (m && m.score && m.share <= 0.4) { m.neighbours = []; m.alts = []; m.run = true; m.score *= 0.6; out.push(m); } // after the single parts: tried when they are held at both ends // a limb, not most of the model round a small body
    }
    out.sort((x, y) => (x.run ? 1 : 0) - (y.run ? 1 : 0) || y.score - x.score); // single parts first, the runs after them
    return { candidates: out, skipped, measure };
  }
  // Every line a curved cut can follow: borders between two regions, and whole region outlines, without repeats.
  function cutLines(P, I, seg) {
    const all = borderLoops(P, seg).concat(regionOutlines(P, I, seg)), seen = new Set(), out = [];
    for (const l of all) {
      const key = l.edges.slice().sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key); out.push(l);
    }
    return out;
  }
  // The border edge nearest a point on the surface, and the shortest closed line through it (or any line if none
  // through it closes, so the interface can say why it can't be cut).
  function borderLoopNear(P, seg, loops, point) {
    const b = seg.borders;
    let best = -1, bd = Infinity;
    for (let e = 0; e < b.length / 4; e++) {
      const a = 3 * b[4 * e + 2], c = 3 * b[4 * e + 3];
      const d = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      let s = L > 0 ? ((point[0] - P[a]) * d[0] + (point[1] - P[a + 1]) * d[1] + (point[2] - P[a + 2]) * d[2]) / L : 0; s = Math.max(0, Math.min(1, s));
      const dist = Math.hypot(P[a] + s * d[0] - point[0], P[a + 1] + s * d[1] - point[1], P[a + 2] + s * d[2] - point[2]);
      if (dist < bd) { bd = dist; best = e; }
    }
    if (best < 0) return null;
    const through = loops.filter(l => l.edges.includes(best));
    const closed = through.filter(l => l.closed).sort((x, y) => x.length - y.length);
    const loop = closed[0] || through[0];
    return loop ? { loop, distance: bd, edge: best } : null;
  }
  // A cut line's best-fit (Newell) plane, its points flattened onto it, and how far the line strays from it.
  function loopFrame(P, ring) {
    const n = ring.length;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const p = 3 * ring[i], q = 3 * ring[(i + 1) % n];
      nx += (P[p + 1] - P[q + 1]) * (P[p + 2] + P[q + 2]); ny += (P[p + 2] - P[q + 2]) * (P[p] + P[q]); nz += (P[p] - P[q]) * (P[p + 1] + P[q + 1]);
      cx += P[p]; cy += P[p + 1]; cz += P[p + 2];
    }
    // the same frame whichever way the line runs (lines picked together may be turned round to agree)
    const big = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? nx : Math.abs(ny) >= Math.abs(nz) ? ny : nz;
    if (big < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const F = frameFromNormal(norm3([nx, ny, nz]), [cx / n, cy / n, cz / n]);
    const xy = new Float64Array(2 * n), h = new Float64Array(n);
    let dev = 0;
    for (let i = 0; i < n; i++) {
      const p = 3 * ring[i], d = [P[p] - F.o[0], P[p + 1] - F.o[1], P[p + 2] - F.o[2]];
      xy[2 * i] = d[0] * F.u[0] + d[1] * F.u[1] + d[2] * F.u[2]; xy[2 * i + 1] = d[0] * F.v[0] + d[1] * F.v[1] + d[2] * F.v[2];
      h[i] = d[0] * F.n[0] + d[1] * F.n[1] + d[2] * F.n[2];
      dev = Math.max(dev, Math.abs(h[i]));
    }
    return { F, xy, h, dev, centre: [cx / n, cy / n, cz / n] };
  }
  // Where to fan a curved cut's cap from: a point the flattened line can be seen from all the way round, if there
  // is one. Fanned from anywhere else, the cap folds over itself where the line doubles back, and the fold is a
  // lip that would hook the two pieces together.
  function fanCentre(xy) {
    const n = xy.length / 2;
    let A = 0, ax = 0, ay = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, c = xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1];
      A += c; ax += (xy[2 * i] + xy[2 * j]) * c; ay += (xy[2 * i + 1] + xy[2 * j + 1]) * c;
    }
    const cands = [[0, 0]];
    if (Math.abs(A) > 1e-12) cands.push([ax / (3 * A), ay / (3 * A)]);
    const sec = { loops: [makeLoop([...Array(n).keys()], [], xy)] };
    sec.regions = buildRegions(sec.loops);
    let best = null;
    for (const s of regionSamples(sec, 0, 200)) if (!best || s.clear > best.clear) best = s;
    if (best) cands.push([best.x, best.y]);
    const sg = Math.sign(A) || 1;
    const folded = ([cx, cy]) => {
      let f = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = ((xy[2 * i] - cx) * (xy[2 * j + 1] - cy) - (xy[2 * j] - cx) * (xy[2 * i + 1] - cy)) * sg; if (a < 0) f -= a; }
      return f;
    };
    let pick = cands[0], pf = folded(pick);
    for (const c of cands.slice(1)) { const f = folded(c); if (f < pf - 1e-12) { pf = f; pick = c; } }
    pick.folded = pf;
    return pick;
  }
  /* The face of a curved cut follows the line: a smooth surface spanning it, with each point's height off the
     line's best-fit plane blended from the heights of the line around it (mean value coordinates, which match the
     line exactly at its edge and bend smoothly in between). */
  function capHeight(xy, h) {
    const n = xy.length / 2, dx = new Float64Array(n), dy = new Float64Array(n), r = new Float64Array(n), t = new Float64Array(n);
    return (x, y) => {
      for (let i = 0; i < n; i++) { dx[i] = xy[2 * i] - x; dy[i] = xy[2 * i + 1] - y; r[i] = Math.hypot(dx[i], dy[i]); if (r[i] < 1e-9) return h[i]; }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, cr = dx[i] * dy[j] - dx[j] * dy[i], dt = dx[i] * dx[j] + dy[i] * dy[j], den = r[i] * r[j] + dt;
        if (Math.abs(den) < 1e-12 * r[i] * r[j]) { const s = r[i] / (r[i] + r[j]); return h[i] + (h[j] - h[i]) * s; } // on the line itself
        t[i] = cr / den; // tan of half the angle the edge subtends
      }
      let sw = 0, sh = 0;
      for (let i = 0; i < n; i++) { const w = (t[(i + n - 1) % n] + t[i]) / r[i]; sw += w; sh += w * h[i]; }
      return Math.abs(sw) > 1e-15 ? sh / sw : 0;
    };
  }
  /* A cap drawn as a regular grid inside the line, so a bumpy line gives a smooth face: grid points at least
     three-quarters of a step in from every ring get the face's height (`H`), the cells with all four corners in
     are two triangles each, the outline of those cells is traced, and the band between each ring and the grid is
     triangulated with the flat-cut safeguards. rings[0] is the outer line, the rest are holes (key sockets).
     Returns triangles over vertex ids (new grid ids from addVertex, with their flat coordinates put in xyMap),
     or null when the shape is too small or awkward for a grid, so the caller can draw the cap the plain way. */
  function gridCap(rings, xyOf, H, step, addVertex, xyMap, wantCCW) {
    const pts = rings.map(r => r.map(xyOf)), flats = pts.map(flatOf), outer = flats[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) { x0 = Math.min(x0, outer[i]); x1 = Math.max(x1, outer[i]); y0 = Math.min(y0, outer[i + 1]); y1 = Math.max(y1, outer[i + 1]); }
    const nx = Math.floor((x1 - x0) / step) + 1, ny = Math.floor((y1 - y0) / step) + 1;
    if (nx < 4 || ny < 4) return null;
    const gx = x0 + ((x1 - x0) - (nx - 1) * step) / 2, gy = y0 + ((y1 - y0) - (ny - 1) * step) / 2;
    // points inside, clear of every ring
    const ok = new Uint8Array(nx * ny), clear = 0.75 * step;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = gx + i * step, y = gy + j * step;
      if (!pointInRing(outer, x, y)) continue;
      let good = distToRing(outer, x, y) >= clear;
      for (let r = 1; r < flats.length && good; r++) if (pointInRing(flats[r], x, y) || distToRing(flats[r], x, y) < clear) good = false;
      if (good) ok[i * ny + j] = 1;
    }
    // cells with all four corners in; cells that touch only at a corner would tangle the outline, so drop one
    const cell = new Uint8Array((nx - 1) * (ny - 1)), C = (i, j) => (i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 ? cell[i * (ny - 1) + j] : 0);
    for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) if (ok[i * ny + j] && ok[(i + 1) * ny + j] && ok[i * ny + j + 1] && ok[(i + 1) * ny + j + 1]) cell[i * (ny - 1) + j] = 1;
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
        if (!C(i, j)) continue;
        if ((C(i + 1, j + 1) && !C(i + 1, j) && !C(i, j + 1)) || (C(i - 1, j + 1) && !C(i - 1, j) && !C(i, j + 1))) { cell[i * (ny - 1) + j] = 0; changed = true; }
      }
      if (!changed) break;
    }
    let any = 0; for (let i = 0; i < cell.length; i++) any += cell[i];
    if (any < 4) return null;
    // vertex ids for the corners in use
    const id = new Int32Array(nx * ny).fill(-1), vid = (i, j) => { const k = i * ny + j; if (id[k] < 0) { const x = gx + i * step, y = gy + j * step; id[k] = addVertex(x, y); xyMap.set(id[k], [x, y]); } return id[k]; };
    const cap = [];
    for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) if (C(i, j)) { const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1); cap.push(a, b, c, a, c, d); }
    // the grid's outline: boundary edges with the grid on their left, chained into loops
    const next = new Map();
    for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
      if (!C(i, j)) continue;
      if (!C(i, j - 1)) next.set(vid(i, j), vid(i + 1, j));
      if (!C(i + 1, j)) next.set(vid(i + 1, j), vid(i + 1, j + 1));
      if (!C(i, j + 1)) next.set(vid(i + 1, j + 1), vid(i, j + 1));
      if (!C(i - 1, j)) next.set(vid(i, j + 1), vid(i, j));
    }
    const loops = [], used = new Set();
    for (const s of next.keys()) {
      if (used.has(s)) continue;
      const loop = []; let v = s;
      while (v !== undefined && !used.has(v)) { used.add(v); loop.push(v); v = next.get(v); }
      if (v !== s || loop.length < 4) return null;
      loops.push(loop);
    }
    const at = (v) => xyMap.get(v) || xyOf(v), area = (ids) => { let s = 0; for (let i = 0; i < ids.length; i++) { const a = at(ids[i]), b = at(ids[(i + 1) % ids.length]); s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
    const outerLoops = loops.filter(l => area(l) > 0), innerLoops = loops.filter(l => area(l) < 0);
    // which hole rings sit inside a grid component (inside one of its inner outlines)
    const holeHome = rings.slice(1).map(r => { const [x, y] = xyOf(r[0]); return innerLoops.findIndex(l => pointInRing(flatOf(l.map(at)), x, y)); });
    // earcut over a polygon with holes, back to ids, then the safeguards
    const tri = (polyIds, holeIds) => {
      const flat = [], ids = [], holes = [];
      for (const v of polyIds) { ids.push(v); const q = at(v); flat.push(q[0], q[1]); }
      for (const h of holeIds) { holes.push(ids.length); for (const v of h) { ids.push(v); const q = at(v); flat.push(q[0], q[1]); } }
      const loc = earcut(flat, holes), out = [];
      let sum = 0; for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
      const flip = sum < 0;
      for (let i = 0; i < loc.length; i += 3) { if (flip) out.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]); else out.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]); }
      for (const r of [polyIds, ...holeIds]) fixTJunctions(out, r);
      splitThroughPoints(out, [polyIds, ...holeIds], at);
      return out;
    };
    const append = (list) => { for (const v of list) cap.push(v); }; // never a spread: a fine cap can be too many for one call
    append(tri(rings[0], [...outerLoops, ...rings.slice(1).filter((_, k) => holeHome[k] < 0)]));
    innerLoops.forEach((l, k) => append(tri(l, rings.slice(1).filter((_, h) => holeHome[h] === k))));
    if (!wantCCW) for (let i = 0; i < cap.length; i += 3) { const x = cap[i + 1]; cap[i + 1] = cap[i + 2]; cap[i + 2] = x; }
    patchCap(cap, rings, at, wantCCW);
    return cap;
  }
  // How finely to draw a cap: three-quarters of the line's own edge length (finer than the line, so the face follows
  // the smooth heights between its points and the band to the line has no long slivers), and never more than a few
  // thousand cells.
  function capStep(xy) {
    const n = xy.length / 2, lens = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; lens.push(Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1])); x0 = Math.min(x0, xy[2 * i]); x1 = Math.max(x1, xy[2 * i]); y0 = Math.min(y0, xy[2 * i + 1]); y1 = Math.max(y1, xy[2 * i + 1]); }
    lens.sort((a, b) => a - b);
    return Math.max(lens[n >> 1] * 0.75, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000), 1e-3);
  }
  // The same, looked up from a grid worked out once, for the many checks key placement makes.
  function capHeightGrid(xy, h, cells = 96) {
    const exact = capHeight(xy, h);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < xy.length; i += 2) { x0 = Math.min(x0, xy[i]); x1 = Math.max(x1, xy[i]); y0 = Math.min(y0, xy[i + 1]); y1 = Math.max(y1, xy[i + 1]); }
    const sx = (x1 - x0) / cells || 1, sy = (y1 - y0) / cells || 1, g = new Float64Array((cells + 1) * (cells + 1));
    for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) g[i * (cells + 1) + j] = exact(x0 + i * sx, y0 + j * sy);
    return (x, y) => {
      const fx = Math.min(cells - 1e-9, Math.max(0, (x - x0) / sx)), fy = Math.min(cells - 1e-9, Math.max(0, (y - y0) / sy)), i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, k = i * (cells + 1) + j;
      return (g[k] * (1 - a) + g[k + cells + 1] * a) * (1 - b) + (g[k + 1] * (1 - a) + g[k + cells + 2] * a) * b;
    };
  }
  /* Keys on a curved cut sit on that face. The analysis looks like analyzePlane's, with the area inside the line as
     the cut face, so keys are placed and sized the same way; their depth checks run along lines through the model
     instead of on flat sections (curvedKeyCheck). */
  function analyzeLoop(P, I, loop, cfg, scale) {
    loop = straightLoop(P, I, loop);
    const { F, xy, h, dev } = loopFrame(P, loop.verts);
    const L = makeLoop(loop.verts, [], xy);
    const base = { error: null, loops: [L], regions: buildRegions([L]) };
    const into2 = intoSide2(xy), sunk = cfg && cfg.sink > 0 ? (cfg.sinkStep === false ? sunkRingAt(P, I, F, loop.verts, xy, h, into2, cfg.sink, cfg.minThickness > 0 ? cfg.minThickness : cfg.margin || 0.8) : sunkRing(P, I, F, loop.verts, xy, h, into2, cfg.sink, cfg.minThickness > 0 ? cfg.minThickness : cfg.margin || 0.8, false, null, cfg.sinkTaper || 0)) : null;
    if (sunk) { const L2 = makeLoop(loop.verts, [], sunk.xy2); base.loops = [L2]; base.regions = buildRegions([L2]); }
    const an = { frame: F, base, depth: [], curved: { deviation: dev, heightAt: sunk ? capHeightGrid(sunk.xy2, sunk.h2) : capHeightGrid(xy, h), sink: sunk ? sunk.max : 0, into2, sunk } };
    Object.defineProperty(an, '_src', { value: { P, I, F, scale, cfg, cache: new Map() } });
    Object.defineProperty(an.curved, 'rays', { get() { return raysFor(P, I, F); } });
    return an;
  }
  // Where a key sits on a curved face: the face's heights round its socket outline, lowest and highest.
  function keyBase(an, spec, x, y, angle) {
    const H = an.curved.heightAt;
    let lo = H(x, y), hi = lo;
    for (const [px, py] of keyProfile(spec.shape, spec.r, spec.cs, angle, spec.res)) { const z = H(x + px, y + py); if (z < lo) lo = z; if (z > hi) hi = z; }
    return { lo, hi, mid: H(x, y) };
  }
  // How far a key goes on a curved face. Each key is straight, along the line's best-fit direction, with its base
  // on the face. A peg sticks its full length past the highest point of its base on the socket's side, so it
  // always reaches that far into the other piece; its socket is that deep plus the gap. The same goes for each
  // dowel or magnet socket, measured from the base's furthest point on its own side.
  function keyLevels(an, cfg, key) {
    const kc = keyCfg(cfg, key), spec = keyGeometrySpec(kc), b = keyBase(an, spec, key.x, key.y, keyAngle(an.base, 0, kc));
    const out = { lo: b.lo, hi: b.hi, mid: b.mid, sockets: spec.sockets.map(s => ({ side: s.side, floor: (s.side > 0 ? b.hi : b.lo) + s.side * s.depth })) };
    if (cfg.type === 'peg') { const s = spec.sockets[0].side; out.tip = (s > 0 ? b.hi : b.lo) + s * kc.length; }
    if (cfg.type === 'dowel') { out.pin = [(b.lo + b.hi) / 2 - kc.length / 2, (b.lo + b.hi) / 2 + kc.length / 2]; }
    return out;
  }
  // A key on a curved face, checked along lines through the model: the face mustn't slope more than 45° under it,
  // the walls round each socket must be solid to its floor, the floor must hold, and (for pegs) there must be
  // solid at least a wall's depth under the peg in its own piece, so it's anchored and can't snap off.
  function curvedKeyCheck(an, cfg, spec, x, y, angle) {
    const m = cfg.margin, H = an.curved.heightAt, g = an.curved.rays, F = an.frame;
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2], oz = F.o[0] * F.n[0] + F.o[1] * F.n[1] + F.o[2] * F.n[2];
    const b = keyBase(an, spec, x, y, angle), width = 2 * (spec.r + spec.cs);
    if (b.hi - b.lo > width) return { ok: false, reason: 'Cut face too steep here', slack: (width - (b.hi - b.lo)) / 2 };
    const few = (prof, k) => { const step = Math.max(1, Math.floor(prof.length / k)); return prof.filter((_, i) => i % step === 0); };
    // how far solid material runs from the face at (px, py) into side s, past the level `to` (negative: short of it).
    // Where the face there isn't inside the model at all, the socket would break out: that counts as -Infinity for
    // the reason, with how far off it is kept for ranking near misses.
    const past = (px, py, s, to) => {
      const r = solidRuns(g, px + ox + 1.3e-7, py + oy + 0.7e-7), c = H(px, py) + oz + s * 1e-4;
      let gap = m;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] <= c && c <= r[i + 1]) return s > 0 ? r[i + 1] - oz - to : to - (r[i] - oz);
        gap = Math.min(gap, c < r[i] ? r[i] - c : c - r[i + 1]);
      }
      return { out: -(gap + 0.05) };
    };
    const floorT = Math.max(0.8, m * 0.75);
    let slack = Infinity;
    for (const sk of spec.sockets) {
      const s = sk.side, floor = (s > 0 ? b.hi : b.lo) + s * sk.depth;
      for (const [px, py] of few(keyProfile(spec.shape, spec.r, spec.cs + 0.75 * m, angle, spec.res), 16)) {
        const v = past(x + px, y + py, s, floor);
        if (v.out !== undefined) return { ok: false, reason: 'Socket would break through the side', slack: Math.max(v.out, -m) };
        if (v < 0) return { ok: false, reason: 'Wall around the socket is too thin', slack: Math.max(v, -m) };
        slack = Math.min(slack, v);
      }
      for (const [px, py] of [[0, 0], ...few(keyProfile(spec.shape, spec.r * 0.6, 0, angle, spec.res), 6)]) {
        const v = past(x + px, y + py, s, floor + s * floorT);
        if (v.out !== undefined || v < 0) return { ok: false, reason: 'Socket would break through the surface', slack: Math.max(v.out !== undefined ? v.out : v, -m) };
        slack = Math.min(slack, v);
      }
    }
    if (cfg.type === 'peg') { // the peg's own piece is on the other side from its socket
      const s = -spec.sockets[0].side, from = s > 0 ? b.hi : b.lo;
      for (const [px, py] of [[0, 0], ...few(keyProfile(spec.shape, spec.r * 0.6, 0, angle, spec.res), 6)]) {
        const v = past(x + px, y + py, s, from + s * m);
        if (v.out !== undefined || v < 0) return { ok: false, reason: 'Not enough solid under the key to hold it', slack: Math.max(v.out !== undefined ? v.out : v, -m) };
        slack = Math.min(slack, v);
      }
    }
    return { ok: true, slack };
  }
  // A cut line with its zig-zags straightened. Where the line runs along two sides of one triangle and the third
  // side would do, it takes the third side (the triangle moves to the other piece, and the line moves by less than
  // a triangle). Lines along mesh edges zig-zag a lot; flattened, a zig-zag doubles back on itself, and the cap
  // across it would fold into little teeth that hook the pieces together. Cached, so a line's keys and its cut agree.
  const straightCache = new WeakMap();
  function straightLoop(P, I, loop) {
    if (!loop.closed || loop.verts.length < 6) return loop;
    let byI = straightCache.get(loop);
    if (byI && byI.I === I) return byI.out;
    const nv = P.length / 3, ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
    const ring = loop.verts.slice(), edges = new Map(); // ring edge -> how many times it's used
    for (let i = 0; i < ring.length; i++) { const k = ek(ring[i], ring[(i + 1) % ring.length]); edges.set(k, (edges.get(k) || 0) + 1); }
    const count = new Map(); for (const v of ring) count.set(v, (count.get(v) || 0) + 1);
    const want = new Set(); // edges a-c that would shortcut a corner of the line
    for (let i = 0; i < ring.length; i++) want.add(ek(ring[(i + ring.length - 1) % ring.length], ring[(i + 1) % ring.length]));
    const opp = new Map(); // for those edges: the corners of the triangles beside them
    for (let q = 0; q < I.length; q += 3) for (let k = 0; k < 3; k++) {
      const key = ek(I[q + k], I[q + (k + 1) % 3]);
      if (want.has(key)) { const c = I[q + (k + 2) % 3]; const l = opp.get(key); if (l) l.push(c); else opp.set(key, [c]); }
    }
    let changed = true;
    while (changed && ring.length > 5) {
      changed = false;
      for (let i = 0; i < ring.length && ring.length > 5; i++) {
        const n = ring.length, a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n], k = ek(a, c);
        const o = opp.get(k);
        if (!o || !o.includes(b) || edges.get(k) || count.get(b) > 1) continue;
        ring.splice(i, 1); i--;
        edges.set(ek(a, b), edges.get(ek(a, b)) - 1); edges.set(ek(b, c), edges.get(ek(b, c)) - 1); edges.set(k, 1); count.set(b, 0);
        changed = true;
      }
      if (changed) { // corners made by the shortcuts can be straightened too
        const more = [];
        for (let i = 0; i < ring.length; i++) { const k = ek(ring[(i + ring.length - 1) % ring.length], ring[(i + 1) % ring.length]); if (!opp.has(k)) { more.push(k); opp.set(k, null); } }
        if (more.length) {
          const add = new Set(more);
          for (let q = 0; q < I.length; q += 3) for (let k = 0; k < 3; k++) {
            const key = ek(I[q + k], I[q + (k + 1) % 3]);
            if (add.has(key)) { const c = I[q + (k + 2) % 3]; const l = opp.get(key); if (l) l.push(c); else opp.set(key, [c]); }
          }
        }
      }
    }
    let length = 0;
    for (let i = 0; i < ring.length; i++) { const a = 3 * ring[i], b = 3 * ring[(i + 1) % ring.length]; length += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
    const out = ring.length === loop.verts.length ? loop : { ...loop, verts: ring, length };
    straightCache.set(loop, { I, out });
    return out;
  }
  /* ---------- lines drawn by hand ----------
     The owner's "manual painting": click points on the surface and the line runs from each to the next along the
     surface's own edges, the shortest way, then closes back to the first. The result is a loop like any border
     loop, so cutAlongLoop, keys and plugs work on it unchanged. */
  const adjCache = new WeakMap();
  function vertexAdjacency(P, I) {
    let adj = adjCache.get(I);
    if (adj) return adj;
    const nv = P.length / 3, deg = new Int32Array(nv + 1);
    for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) { deg[I[i + k] + 1]++; }
    for (let v = 0; v < nv; v++) deg[v + 1] += deg[v];
    const fill = deg.slice(0, nv), to = new Int32Array(deg[nv]), len = new Float32Array(deg[nv]);
    for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = I[i + k], b = I[i + (k + 1) % 3], L = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
      to[fill[a]] = b; len[fill[a]++] = L; // each triangle adds a -> b; the twin triangle adds b -> a
    }
    adj = { start: deg, to, len };
    adjCache.set(I, adj);
    return adj;
  }
  // The vertex nearest a point.
  function nearestVertex(P, point) {
    let best = -1, bd = Infinity;
    for (let v = 0; v < P.length / 3; v++) { const d = (P[3 * v] - point[0]) ** 2 + (P[3 * v + 1] - point[1]) ** 2 + (P[3 * v + 2] - point[2]) ** 2; if (d < bd) { bd = d; best = v; } }
    return best;
  }
  // The vertex nearest each of many points, as `nearestVertex` gives (ties to the lower index), from a grid of the
  // vertices built once: a stroke's line snaps 160 points, and one pass over 470k vertices per point took most of
  // its time.
  function nearestVertices(P, points) {
    const nv = P.length / 3;
    if (points.length < 4 || nv < 2000) return points.map(q => nearestVertex(P, q));
    const b = bounds(P), cell = Math.max(1e-9, Math.cbrt((Math.max(b.size[0], 1e-9) * Math.max(b.size[1], 1e-9) * Math.max(b.size[2], 1e-9)) / (nv / 4)));
    const nx = Math.floor(b.size[0] / cell) + 1, ny = Math.floor(b.size[1] / cell) + 1, nz = Math.floor(b.size[2] / cell) + 1;
    const ci = (x, y, z) => (z * ny + y) * nx + x, cl = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
    const cellOf = new Int32Array(nv), start = new Int32Array(nx * ny * nz + 1);
    for (let v = 0; v < nv; v++) { const c = ci(cl(Math.floor((P[3 * v] - b.min[0]) / cell), nx), cl(Math.floor((P[3 * v + 1] - b.min[1]) / cell), ny), cl(Math.floor((P[3 * v + 2] - b.min[2]) / cell), nz)); cellOf[v] = c; start[c + 1]++; }
    for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
    const items = new Int32Array(nv), fill = start.slice(0, -1);
    for (let v = 0; v < nv; v++) items[fill[cellOf[v]]++] = v; // in index order within each cell
    return points.map((q) => {
      const gx = Math.floor((q[0] - b.min[0]) / cell), gy = Math.floor((q[1] - b.min[1]) / cell), gz = Math.floor((q[2] - b.min[2]) / cell);
      let best = -1, bd = Infinity;
      const maxR = Math.max(nx, ny, nz) + Math.max(Math.abs(gx), Math.abs(gy), Math.abs(gz));
      for (let r = 0; r <= maxR; r++) {
        // cells on the shell r away (Chebyshev); stop once the nearest possible point in it is farther than the best
        if (best >= 0) { const near = (r - 1) * cell; if (near > 0 && near * near > bd) break; }
        for (let z = gz - r; z <= gz + r; z++) { if (z < 0 || z >= nz) continue;
          for (let y = gy - r; y <= gy + r; y++) { if (y < 0 || y >= ny) continue;
            const edge = Math.abs(z - gz) === r || Math.abs(y - gy) === r;
            for (let x = gx - r; x <= gx + r; x += (edge || r === 0) ? 1 : 2 * r) { if (x < 0 || x >= nx) continue;
              const c = ci(x, y, z);
              for (let k = start[c]; k < start[c + 1]; k++) { const v = items[k], d = (P[3 * v] - q[0]) ** 2 + (P[3 * v + 1] - q[1]) ** 2 + (P[3 * v + 2] - q[2]) ** 2; if (d < bd || (d === bd && v < best)) { bd = d; best = v; } }
            }
          }
        }
      }
      return best;
    });
  }
  // The shortest way along the surface's edges from vertex a to vertex b (Dijkstra with a binary heap), as the
  // vertices from a to b inclusive. Edges are charged a little extra for straying from the straight line between
  // the two points, so the way runs where a hand would draw it instead of wandering round bumps.
  function surfacePath(P, I, a, b) {
    if (a === b) return [a];
    const adj = vertexAdjacency(P, I), nv = P.length / 3;
    const A = [P[3 * a], P[3 * a + 1], P[3 * a + 2]], B = [P[3 * b], P[3 * b + 1], P[3 * b + 2]], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], D = Math.hypot(...AB) || 1;
    const stray = (v) => { // distance of a vertex from the segment a-b
      const q = [P[3 * v] - A[0], P[3 * v + 1] - A[1], P[3 * v + 2] - A[2]], s = Math.max(0, Math.min(1, (q[0] * AB[0] + q[1] * AB[1] + q[2] * AB[2]) / (D * D)));
      return Math.hypot(q[0] - s * AB[0], q[1] - s * AB[1], q[2] - s * AB[2]);
    };
    const dist = new Float64Array(nv).fill(Infinity), prev = new Int32Array(nv).fill(-1), heap = [];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI][0] <= heap[i][0]) break; [heap[pI], heap[i]] = [heap[i], heap[pI]]; i = pI; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    dist[a] = 0; push([0, a]);
    while (heap.length) {
      const [d, v] = pop();
      if (d > dist[v]) continue;
      if (v === b) break;
      for (let e = adj.start[v]; e < adj.start[v + 1]; e++) {
        const w = adj.to[e], nd = d + adj.len[e] * (1 + 2 * stray(w) / D);
        if (nd < dist[w]) { dist[w] = nd; prev[w] = v; push([nd, w]); }
      }
    }
    if (prev[b] < 0) return null; // no way there (a separate shell)
    const path = []; for (let v = b; v >= 0; v = prev[v]) path.push(v);
    return path.reverse();
  }
  // A closed line through the given points (the nearest vertex to each), joined the shortest way along the surface
  // and back to the first. Where the line would cross itself, the detour is dropped so the loop is simple.
  // Returns a loop like borderLoops gives (verts, closed, length, drawn), or null if the points can't be joined.
  function drawnLoop(P, I, points) {
    if (points.length < 3) return null;
    const vs = nearestVertices(P, points), verts = [];
    for (let i = 0; i < vs.length; i++) {
      const path = surfacePath(P, I, vs[i], vs[(i + 1) % vs.length]);
      if (!path) return null;
      for (let k = 0; k + 1 < path.length; k++) verts.push(path[k]); // the last vertex starts the next leg
    }
    // make it simple: when a vertex comes round again, the loop between the two visits goes
    const seen = new Map(), ring = [];
    for (const v of verts) { if (seen.has(v)) { const at = seen.get(v); for (let k = at; k < ring.length; k++) seen.delete(ring[k]); ring.length = at; } seen.set(v, ring.length); ring.push(v); }
    if (ring.length < 3) return null;
    let length = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; length += Math.hypot(P[3 * p] - P[3 * q], P[3 * p + 1] - P[3 * q + 1], P[3 * p + 2] - P[3 * q + 2]); }
    return { verts: ring, closed: true, length, drawn: true, anchors: Array.from(vs), points: points.map(p => [p[0], p[1], p[2]]) }; // (the points clicked, which a slice follows)
  }
  // The connected pieces of a pick: triangles that are in (sel[t], or their region in `picked`), joined across shared
  // edges. Returns a label per triangle (-1 when not picked) and the count, so separate pieces of a pick can show in
  // colours of their own and touching ones share one (the owner's request).
  function pickComponents(P, I, groupOf, picked, sel) {
    const nt = I.length / 3, nv = P.length / 3, inside = (t) => (sel ? sel[t] === 1 : picked.has(groupOf[t]));
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const em = new PairMap(I.length);
    for (let t = 0; t < nt; t++) {
      if (!inside(t)) continue;
      for (let k = 0; k < 3; k++) {
        const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], lo = a < b ? a : b, hi = a < b ? b : a, f = em.get(lo, hi);
        if (f === -1) em.set(lo, hi, t); else { const x = find(f), y = find(t); if (x !== y) par[x] = y; }
      }
    }
    const label = new Int32Array(nt).fill(-1), ids = new Map();
    for (let t = 0; t < nt; t++) if (inside(t)) { const r = find(t); if (!ids.has(r)) ids.set(r, ids.size); label[t] = ids.get(r); }
    if (ids.size > 1) { // separate pieces of the model that touch (a hand pushed into its cuff) are one piece of the pick
      const m = touchingSets(P, I, label, ids.size, { apart: shellComponents(P, I).label });
      for (let t = 0; t < nt; t++) if (label[t] >= 0) label[t] = m.of[label[t]];
      return { label, count: m.count, nv };
    }
    return { label, count: ids.size, nv };
  }
  // Which labelled sets of triangles touch: `label[t]` (-1 for none, else 0 .. count-1) per triangle; two sets
  // touch where a vertex of one lies within `tol` of a vertex of the other (by default one and a half of the sets'
  // median edges, at most 0.6% of the model's size), as a hand pushed into its cuff does along the rim, though they share no edge. Returns
  // `{ of, count }`: each set's group, numbered from 0.
  function touchingSets(P, I, label, count, opts = {}) { // opts.pairs (a Set): every touching pair a·count + b (a < b) is added to it instead; opts.apart (a label per triangle, as `shellComponents` gives): only vertices on different pieces count
    const nt = I.length / 3, par = new Int32Array(count), pairs = opts.pairs || null, apart = opts.apart || null; let tol = opts.tol; for (let k = 0; k < count; k++) par[k] = k;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    if (!(tol > 0)) {
      const L = [], step = Math.max(1, Math.floor(nt / 4000));
      for (let t = 0; t < nt; t += step) if (label[t] >= 0) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
      L.sort((x, y) => x - y); tol = Math.min(1.5 * (L[L.length >> 1] || 0), 0.006 * diag(bounds(P))); // never more than a hair of the model: a coarse mesh's long edges would join pieces well apart
    }
    if (!(tol > 0) || count < 2) { const of = new Int32Array(count); for (let k = 0; k < count; k++) of[k] = k; return { of, count }; }
    const vl = new Int32Array(P.length / 3).fill(-1);
    const va = apart ? new Int32Array(P.length / 3) : null;
    for (let t = 0; t < nt; t++) if (label[t] >= 0) for (let k = 0; k < 3; k++) { vl[I[3 * t + k]] = label[t]; if (va) va[I[3 * t + k]] = apart[t]; }
    const cell = new Map(), key = (x, y, z) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
    for (let v = 0; v < vl.length; v++) {
      if (vl[v] < 0) continue;
      const k = key(Math.floor(P[3 * v] / tol), Math.floor(P[3 * v + 1] / tol), Math.floor(P[3 * v + 2] / tol));
      let arr = cell.get(k); if (!arr) cell.set(k, arr = []); arr.push(v);
    }
    const t2 = tol * tol;
    for (let v = 0; v < vl.length; v++) {
      if (vl[v] < 0) continue;
      const cx = Math.floor(P[3 * v] / tol), cy = Math.floor(P[3 * v + 1] / tol), cz = Math.floor(P[3 * v + 2] / tol);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const arr = cell.get(key(cx + dx, cy + dy, cz + dz)); if (!arr) continue;
        for (const w of arr) {
          if ((pairs ? vl[w] === vl[v] : find(vl[w]) === find(vl[v])) || (va && va[w] === va[v])) continue;
          const ex = P[3 * w] - P[3 * v], ey = P[3 * w + 1] - P[3 * v + 1], ez = P[3 * w + 2] - P[3 * v + 2];
          if (ex * ex + ey * ey + ez * ez <= t2) { if (pairs) pairs.add(Math.min(vl[v], vl[w]) * count + Math.max(vl[v], vl[w])); else par[find(vl[w])] = find(vl[v]); }
        }
      }
    }
    const of = new Int32Array(count), ids = new Map();
    for (let k = 0; k < count; k++) { const r = find(k); if (!ids.has(r)) ids.set(r, ids.size); of[k] = ids.get(r); }
    return { of, count: ids.size };
  }
  // The regions between a pick and a region further along (the owner: a click on a shoulder, then a Shift-click
  // on the hand, should take the arm between): the cheapest chain of neighbouring regions from any of `from` to
  // `to`, each region charged the square root of its area, so a chain runs along a limb rather than across the
  // body. Regions neighbour across a border or where their pieces touch without sharing an edge (a hand pushed
  // into its cuff). The biggest region (the body) is never passed through, nor a region over three times the
  // bigger of the two ends (the pick so far and `to`), nor more than `maxSteps` (6) regions,
  // nor more than `maxShare` (40%) of the surface. Returns the regions in between (not `from`, not `to`); empty
  // when the two already touch or no such chain is found.
  function regionPath(P, I, seg, from, to, opts = {}) {
    const n = seg.count, areas = seg.areas, maxSteps = opts.maxSteps || 6, maxShare = opts.maxShare || 0.4;
    const adj = Array.from({ length: n }, () => new Set()), b = seg.borders, g = seg.groupOf;
    for (let e = 0; e < b.length; e += 4) { const x = g[b[e]], y = g[b[e + 1]]; if (x !== y) { adj[x].add(y); adj[y].add(x); } }
    const sh = shellComponents(P, I);
    if (sh.count > 1) { // regions on different pieces that touch
      const lab = new Int32Array(g.length); for (let t = 0; t < g.length; t++) lab[t] = g[t];
      const pairs = new Set(); touchingSets(P, I, lab, n, { tol: opts.tol, pairs, apart: sh.label });
      for (const k of pairs) { const x = Math.floor(k / n), y = k % n; adj[x].add(y); adj[y].add(x); }
    }
    let total = 0, big = 0; for (let r = 0; r < n; r++) { total += areas[r]; if (areas[r] > areas[big]) big = r; }
    const src = new Set(from);
    if (src.has(to)) return [];
    let ends = areas[to], picked = 0; for (const f of src) picked += areas[f];
    const cap = 3 * Math.max(ends, picked); // nothing in between much bigger than what was clicked: a hand and a shoulder don't take the torso between
    for (const f of src) if (adj[f].has(to)) return [];
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), steps = new Int32Array(n), done = new Uint8Array(n);
    for (const f of src) dist[f] = 0;
    for (;;) {
      let u = -1; for (let r = 0; r < n; r++) if (!done[r] && dist[r] < Infinity && (u < 0 || dist[r] < dist[u])) u = r;
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const w of adj[u]) {
        if (done[w] || src.has(w)) continue;
        if (w !== to && (w === big || areas[w] > cap || steps[u] + 1 > maxSteps)) continue;
        const d = dist[u] + Math.sqrt(areas[w]);
        if (d < dist[w]) { dist[w] = d; prev[w] = u; steps[w] = steps[u] + 1; }
      }
    }
    if (prev[to] < 0) return [];
    const out = []; let area = 0;
    for (let r = prev[to]; r >= 0 && !src.has(r); r = prev[r]) { out.push(r); area += areas[r]; }
    return area > maxShare * total ? [] : out.reverse();
  }
  /* ---------- a stroke that wraps a cut round a part ----------
     ModelSplitter's Line tool, as the owner asked: "draw a line that automatically creates a cut after the line
     analyzes the surface and wraps around parts smoothly". The stroke on the screen and the eye make a plane
     through the model; `strokeLoop` starts from it at `o` (where the stroke crosses the part), tilts it, still
     through `o` and never more than `maxTilt` from the stroke's plane, until the ring round the part under the
     stroke is as short as it gets (square across a limb, or along a neck's narrowest), and then turns that ring
     into a line on the surface (`drawnLoop` through points along it) and eases it (`smoothHandles`), so the cut
     follows the model rather than a flat plane. It returns a loop as `drawnLoop` does, or null. */
  function strokeLoop(P, I, req) {
    const scale = req.scale || diag(bounds(P)), o = req.o, n0 = norm3(req.n), maxTilt = ((req.maxTilt === undefined ? 30 : req.maxTilt) * Math.PI) / 180;
    const tol = Math.max(1e-3, scale * 0.02);
    // the ring through o for a normal: the loop of the section passing nearest o (o lies on the plane), and its length
    const ringFor = (n) => {
      const F = frameFromNormal(n, o), sec = section(P, I, F, scale);
      if (sec.error || !sec.loops.length) return null;
      let best = null, bd = Infinity;
      for (const L of sec.loops) {
        const xy = L.xy, m = xy.length / 2;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m, ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1];
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
          const d = Math.hypot(ax + t * dx, ay + t * dy);
          if (d < bd) { bd = d; best = L; }
        }
      }
      if (!best || bd > tol) return null;
      let len = 0; const xy = best.xy, m = xy.length / 2;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; len += Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1]); }
      return { n, F, loop: best, len };
    };
    const F0 = frameFromNormal(n0, o);
    let best = ringFor(n0);
    if (!best) return null;
    const first = best.len;
    const angleOf = (n) => Math.acos(Math.max(-1, Math.min(1, n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2])));
    for (const deg of [12, 6, 3]) { // tilt, about the plane's own two axes, while the ring gets shorter
      let improved = true, guard = 0;
      while (improved && guard++ < 6) {
        improved = false;
        const r = (deg * Math.PI) / 180, F = best.F, nrm = best.n;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const tn = norm3([0, 1, 2].map(k => nrm[k] * Math.cos(r) + (F.u[k] * a + F.v[k] * b) * Math.sin(r)));
          if (angleOf(tn) > maxTilt) continue;
          const c = ringFor(tn);
          if (c && c.len < best.len * 0.985 && c.len > first * 0.5) { best = c; improved = true; break; } // never down to a ring round some small detail beside the stroke
        }
      }
    }
    // the ring as points on the model, about one every 1.5% of its length (40 to 160), then a line on the surface
    const xy = best.loop.xy, m = xy.length / 2, want = Math.max(40, Math.min(160, Math.round(m / 2)));
    const pts = [];
    for (let k = 0; k < want; k++) { const i = Math.floor((k * m) / want); pts.push(planePoint(best.F, xy[2 * i], xy[2 * i + 1])); }
    let loop = drawnLoop(P, I, pts);
    if (!loop) return null;
    if (req.smooth !== 0) { // eased a little, so the mesh's zigzags don't show in the seam
      const h = loopHandles(P, loop, Math.max(12, Math.min(48, Math.round(pts.length / 3))));
      const eased = drawnLoop(P, I, smoothHandles(P, h, req.smooth || 2));
      if (eased && eased.verts.length >= 3) loop = eased;
    }
    // (1.76) the plane the ring lies in goes with the line, so slicing follows the plane exactly (ModelSplitter's line cut)
    return { ...loop, stroke: true, normal: best.n, tilt: (angleOf(best.n) * 180) / Math.PI, ring: best.len, plane: { o: [...best.F.o], n: [...best.n] } };
  }
  /* ---------- engraved joint numbers ----------
     The same number on both mating faces of a cut (modelsplitter's joint numbers), so a kit of many pieces goes
     together without guessing. Each digit is seven strokes, and each stroke is a shallow pocket cut by the key
     machinery (shape 'bar', a both-sides socket with no clearance), so flat and curved cuts engrave alike. */
  const DIGIT_STROKES = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  // Marks (strokes) for `number`, as {x, y, len, deg, side}: laid out in an area of a cut face (`sec`, `ri`) at
  // the clearest spot away from its keys, as big as fits from 3 mm strokes down to 1.5 mm; `mirror` lays a second
  // set mirrored for the other face (side +1), so each reads the right way round. Null when nothing fits.
  function jointMarks(sec, ri, keys, cfg, number, opts = {}) {
    const digits = String(Math.max(0, Math.round(number))).split('').map(Number);
    if (!sec.regions[ri] || sec.regions[ri].nested || sec.regions[ri].inverted) return null;
    const samples = regionSamples(sec, ri, 400), outerOf = (k) => { try { return keyGeometrySpec(keyCfg(cfg, k)).outer; } catch (err) { return 3; } };
    const kk = (keys || []).map(k => ({ x: k.x, y: k.y, r: outerOf(k) }));
    for (const W of [3, 2.5, 2, 1.5]) { // a digit is W wide, 2W tall
      const t = 0.205 * W, L = W - 1.3 * t, pitch = 1.4 * W, width = (digits.length - 1) * pitch + W + t, height = 2 * W + t, half = Math.hypot(width, height) / 2 + 0.3;
      let best = null, bs = -Infinity;
      for (const s of samples) { let sc = s.clear - half; for (const k of kk) sc = Math.min(sc, Math.hypot(s.x - k.x, s.y - k.y) - k.r - half); if (sc > bs) { bs = sc; best = s; } }
      if (!best || bs < 0) continue;
      const strokes = [];
      digits.forEach((d, i) => {
        const cx = best.x - ((digits.length - 1) * pitch) / 2 + i * pitch, cy = best.y, on = DIGIT_STROKES[d] || '';
        const seg = { a: [cx, cy + W, 0], g: [cx, cy, 0], d: [cx, cy - W, 0], f: [cx - W / 2, cy + W / 2, 90], b: [cx + W / 2, cy + W / 2, 90], e: [cx - W / 2, cy - W / 2, 90], c: [cx + W / 2, cy - W / 2, 90] };
        // every stroke is nudged by a hair of its own: two pockets whose edges line up exactly leave the cap's
        // triangulation with collinear points it can't always sew up (digits 0, 4, 8 and 9 came out open)
        for (const ch of on) { const [x, y, deg] = seg[ch], k = strokes.length; strokes.push({ x: x + (((k * 3) % 5) - 2) * 0.03 * t, y: y + (((k * 7) % 5) - 2) * 0.03 * t, len: L * (1 - ((k % 3) * 0.01)), deg }); }
      });
      const depth = opts.depth > 0 ? opts.depth : 0.6, out = [];
      for (const s of strokes) out.push({ ...s, depth, side: opts.mirror ? -1 : undefined });
      if (opts.mirror) for (const s of strokes) out.push({ x: 2 * best.x - s.x, y: s.y, len: s.len, deg: s.deg, depth, side: +1 }); // mirrored about the label's centre, for the face seen from the other side
      return { marks: out, x: best.x, y: best.y, width: W, number: digits.join('') };
    }
    return null;
  }
  // Marks as key-like objects for the cut routines: each stroke a 'bar' of its length, engraved `depth` deep.
  function markKeys(marks) {
    return (marks || []).map(m => ({ x: m.x, y: m.y, mark: true, side: m.side, o: { shape: 'bar', diameter: m.len, length: m.depth || 0.6, clearance: 0, taper: 0, taperSocket: false, align: false, turn: m.deg || 0 } }));
  }
  /* ---------- reduce detail ----------
     A lighter copy of a dense model, so it paints and cuts faster (modelsplitter's Reduce for cutting): quadric
     edge collapse (Garland & Heckbert). Every vertex carries the sum of its faces' plane quadrics; the cheapest
     edge is collapsed onto whichever of its two ends or their midpoint costs least, as long as the mesh stays a
     closed manifold (the link condition: the ends share exactly the two apexes of the edge's triangles) and no
     triangle turns over. Stops at the target count, or when the next collapse would move the surface more than
     `tolerance` (the root of the quadric cost, in mm). Returns { positions, indices, removed }. */
  function reduceMesh(P, I, opts = {}) {
    const nv = P.length / 3, nt0 = I.length / 3;
    const target = opts.target > 0 ? Math.max(4, Math.floor(opts.target < 1 ? nt0 * opts.target : opts.target)) : 4;
    const tol2 = opts.tolerance > 0 ? opts.tolerance * opts.tolerance : Infinity;
    const X = Float64Array.from(P), T = Int32Array.from(I);
    const Q = new Float64Array(nv * 10), vt = Array.from({ length: nv }, () => []), ver = new Int32Array(nv), alive = new Uint8Array(nv).fill(1);
    const normalOf = (t) => { const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2]; const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
    for (let t = 0; t < nt0; t++) {
      const n = normalOf(t), L = Math.hypot(n[0], n[1], n[2]);
      for (let k = 0; k < 3; k++) vt[T[3 * t + k]].push(t);
      if (!(L > 1e-18)) continue;
      const a = n[0] / L, b = n[1] / L, c = n[2] / L, v0 = 3 * T[3 * t], d = -(a * X[v0] + b * X[v0 + 1] + c * X[v0 + 2]);
      for (let k = 0; k < 3; k++) { const o = T[3 * t + k] * 10; Q[o] += a * a; Q[o + 1] += a * b; Q[o + 2] += a * c; Q[o + 3] += a * d; Q[o + 4] += b * b; Q[o + 5] += b * c; Q[o + 6] += b * d; Q[o + 7] += c * c; Q[o + 8] += c * d; Q[o + 9] += d * d; }
    }
    const qcost = (v, x, y, z) => { const o = v * 10; return Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x + Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y + Q[o + 7] * z * z + 2 * Q[o + 8] * z + Q[o + 9]; };
    // a binary heap of [cost, a, b, verA, verB, x, y, z]
    const heap = [];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const best = (a, b) => { // the cheapest of the two ends and the midpoint
      const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2], bx = X[3 * b], by = X[3 * b + 1], bz = X[3 * b + 2];
      let out = null;
      for (const [x, y, z] of [[(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], [ax, ay, az], [bx, by, bz]]) { const c = qcost(a, x, y, z) + qcost(b, x, y, z); if (!out || c < out[0]) out = [c, a, b, ver[a], ver[b], x, y, z]; }
      return out;
    };
    const seen = new Set();
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) { const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a; if (seen.has(key)) continue; seen.add(key); push(best(a, b)); }
    seen.clear();
    const ring = (v) => { const s = new Set(); for (const t of vt[v]) { if (T[3 * t] < 0) continue; for (let k = 0; k < 3; k++) { const w = T[3 * t + k]; if (w !== v) s.add(w); } } return s; }; // (a vertex's list can still hold triangles killed by an earlier collapse)
    let nt = nt0; const stats = { stale: 0, edge: 0, link: 0, flip: 0, done: 0 };
    while (heap.length && nt > target) {
      const e = pop(), [cost, a, b, va, vb, x, y, z] = e;
      if (!alive[a] || !alive[b] || ver[a] !== va || ver[b] !== vb) { stats.stale++; continue; } // stale
      if (cost > tol2) break;
      // the edge's own triangles, and the link condition
      vt[a] = vt[a].filter(t => T[3 * t] >= 0); vt[b] = vt[b].filter(t => T[3 * t] >= 0);
      const shared = vt[a].filter(t => T[3 * t] === b || T[3 * t + 1] === b || T[3 * t + 2] === b);
      if (shared.length !== 2) { stats.edge++; continue; } // a boundary or tangled edge stays as it is
      const ra = ring(a), rb = ring(b); let common = 0; for (const w of ra) if (rb.has(w)) common++;
      if (common !== 2) { stats.link++; continue; }
      // no triangle may turn over or vanish when a and b move to the new point
      let ok = true;
      const trial = (v, t) => { const o = 3 * v, sx = X[o], sy = X[o + 1], sz = X[o + 2]; const before = normalOf(t); X[o] = x; X[o + 1] = y; X[o + 2] = z; const after = normalOf(t); X[o] = sx; X[o + 1] = sy; X[o + 2] = sz; const Lb = Math.hypot(...before), La = Math.hypot(...after); return La > 1e-14 && (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) > 0.2 * Lb * La; };
      for (const t of vt[a]) if (ok && !shared.includes(t) && !trial(a, t)) ok = false;
      for (const t of vt[b]) if (ok && !shared.includes(t) && !trial(b, t)) ok = false;
      if (!ok) { stats.flip++; continue; }
      // collapse b into a at the new point
      stats.done++;
      X[3 * a] = x; X[3 * a + 1] = y; X[3 * a + 2] = z;
      for (const t of shared) { T[3 * t] = T[3 * t + 1] = T[3 * t + 2] = -1; }
      nt -= shared.length;
      const keep = vt[a].filter(t => T[3 * t] >= 0);
      for (const t of vt[b]) { if (T[3 * t] < 0) continue; for (let k = 0; k < 3; k++) if (T[3 * t + k] === b) T[3 * t + k] = a; keep.push(t); }
      vt[a] = keep; vt[b] = []; alive[b] = 0;
      for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
      ver[a]++; ver[b]++;
      for (const w of ring(a)) push(best(a, w));
    }
    // compact
    const map = new Int32Array(nv).fill(-1), pos = []; let n = 0;
    for (let t = 0; t < nt0; t++) { if (T[3 * t] < 0) continue; for (let k = 0; k < 3; k++) { const v = T[3 * t + k]; if (map[v] < 0) { map[v] = n++; pos.push(X[3 * v], X[3 * v + 1], X[3 * v + 2]); } } }
    const idx = new Uint32Array(nt * 3); let j = 0;
    for (let t = 0; t < nt0; t++) { if (T[3 * t] < 0) continue; for (let k = 0; k < 3; k++) idx[j++] = map[T[3 * t + k]]; }
    return { positions: new Float32Array(pos), indices: idx, removed: nt0 - nt, stats };
  }
  /* ---------- inlay cut ----------
     Pop a detail out as its own part to print in another colour (an eye, a gem, a badge), as modelsplitter's inlay
     cut: the body gets a pocket under the painted or picked area, and the inlay is the same area cut with its
     outline pulled in by the fit, so it presses back into place. Both come from sunk-face cuts of the original
     model: the pocket from the area's outline (the recess goes into the body), the inlay from the outline shrunk
     by `fit`, sunk to the same depth; only the body of the first cut and the inlay of the second are kept. */
  // `sel` is the area as a triangle selection (1 painted); opts: depth (mm), fit (mm per side), flat (a level
  // floor, so the inlay prints on its base), wall (solid to keep under the pocket).
  function inlayCut(P, I, sel, opts = {}) {
    const depth = opts.depth > 0 ? opts.depth : 3, fit = opts.fit >= 0 ? opts.fit : 0.2, wall = opts.wall > 0 ? opts.wall : 0.8;
    const cut = (s, want, w, plane) => splitRegions(P, I, selectionSeg(P, I, s), [1], { sink: want, sinkFlat: !!opts.flat, sinkPlane: plane || null, sinkStep: false, force: true, minThickness: 0, cfg: { type: 'none', margin: w } });
    let pocket;
    try { pocket = cut(sel, depth, wall); } catch (err) { throw new Error(`The pocket can’t be cut here: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`); }
    const got = pocket.sinks[0] || 0;
    if (got < 0.3) throw new Error('No room for a pocket here: the body is too thin under this area. Try a shallower depth or a thicker spot.');
    const sel2 = fit > 0 ? shrinkSelection(P, I, sel, fit) : sel;
    let count = 0; for (let t = 0; t < sel2.length; t++) count += sel2[t];
    if (!count) throw new Error('The area is too small for an inlay at this fit: nothing is left once it’s pulled in. Paint a bigger area or reduce the fit.');
    let inlay;
    const floor = opts.flat && pocket.floors ? pocket.floors[0] : null;
    try { inlay = cut(sel2, got, 0.1, floor); } catch (err) { throw new Error(`The inlay can’t be cut here: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`); }
    const body = pocket.parts.slice(1), piece = inlay.parts[0];
    if (!body.length || !piece) throw new Error('The inlay cut didn’t separate the area from the body.');
    const merged = body.length === 1 ? body[0] : (() => { const m = mergeMeshes(body); return { positions: m.positions, indices: m.indices, volume: body.reduce((s, q) => s + q.volume, 0) }; })();
    // the depth shown is the pocket's floor under the line's deepest point (with a flat floor the deepest point of the
    // recess is further in, under the area's highest point)
    return { body: { positions: merged.positions, indices: merged.indices, volume: merged.volume }, inlay: { positions: piece.positions, indices: piece.indices, volume: piece.volume }, depth: floor ? floor.floor : got, deepest: got, inlayDepth: inlay.sinks[0] || 0, flat: !!floor, floor };
  }
  // The triangles on one side of closed lines (side 1: the smaller side, or the side the lines run forward on),
  // as a selection, so a picked line or region can be used where a painted area is.
  function loopSelection(P, I, loops) {
    const { side } = orientLoops(P, I, loops, { what: 'lines' });
    const sel = new Uint8Array(side.length);
    for (let t = 0; t < side.length; t++) sel[t] = side[t] === 1 ? 1 : 0;
    return sel;
  }
  /* ---------- seam editing ----------
     A cut line as a few handles along the surface (the owner's band tool, as modelsplitter has): drag one and the
     line is re-routed through it along the surface, smooth them, or snap one to a region border. */
  // Handles along a line: about `n` points evenly spaced by length along its vertices (always at least three).
  function loopHandles(P, loop, n = 16) {
    const vs = loop.verts, m = vs.length, at = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
    let total = 0;
    for (let i = 0; i < m; i++) { const a = vs[i], b = vs[(i + 1) % m]; total += Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]); }
    const want = Math.max(3, Math.min(n, m)), step = total / want, out = [];
    let acc = 0, next = 0;
    for (let i = 0; i < m && out.length < want; i++) {
      if (acc >= next - 1e-9) { out.push(at(vs[i])); next += step; }
      const a = vs[i], b = vs[(i + 1) % m]; acc += Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
    }
    while (out.length < 3 && out.length < m) out.push(at(vs[Math.floor(m * out.length / 3)]));
    return out;
  }
  // Smooth a closed run of handles, `passes` times, then put each back onto the nearest vertex so the line stays
  // on the surface. Each pass is Taubin's pair: a step towards the midpoint of the neighbours (λ) and a slightly
  // bigger step back (μ), which eases zig-zags without shrinking the loop (plain averaging pulled a small seam
  // round a 5 mm bar into a dot).
  function smoothHandles(P, points, passes = 1) {
    let pts = points.map(q => q.slice());
    const n = pts.length;
    if (n < 3) return pts;
    const step = (t) => { pts = pts.map((q, i) => { const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n]; return [q[0] + t * ((a[0] + b[0]) / 2 - q[0]), q[1] + t * ((a[1] + b[1]) / 2 - q[1]), q[2] + t * ((a[2] + b[2]) / 2 - q[2])]; }); };
    for (let k = 0; k < passes; k++) { step(0.5); step(-0.53); }
    return nearestVertices(P, pts).map(v => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
  }
  // The nearest point on any region border to a point, and how far it is.
  function nearestBorderPoint(P, seg, point) {
    const b = seg.borders;
    let best = null, bd = Infinity;
    for (let e = 0; e < b.length / 4; e++) {
      const a = 3 * b[4 * e + 2], c = 3 * b[4 * e + 3];
      const d = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      let s = L > 0 ? ((point[0] - P[a]) * d[0] + (point[1] - P[a + 1]) * d[1] + (point[2] - P[a + 2]) * d[2]) / L : 0; s = Math.max(0, Math.min(1, s));
      const q = [P[a] + s * d[0], P[a + 1] + s * d[1], P[a + 2] + s * d[2]], dist = Math.hypot(q[0] - point[0], q[1] - point[1], q[2] - point[2]);
      if (dist < bd) { bd = dist; best = q; }
    }
    return best ? { point: best, distance: bd } : null;
  }
  /* ---------- split to fit the bed ----------
     Flat cuts across the axes that make every piece fit the printer (the owner's large prints, and modelsplitter's
     auto multi-plane). A piece can lie any way on the plate, so the model's extents are matched to the bed's
     longest to longest; each axis then needs ceil(size / room) − 1 cuts, spaced evenly. */
  // The plan: `bed` is {w, d, h}, `margin` is kept clear at every edge, `counts` (per axis) overrides the
  // worked-out numbers (cuts by count, as the Multi-plane tool). Returns the counts, the planes ({axis, pos}),
  // how many pieces, the size of each, and whether they fit.
  function planBedCuts(bbox, bed, margin = 0, counts) {
    const room = [bed.w, bed.d, bed.h].map(v => Math.max(1, v - 2 * margin)).sort((a, b) => a - b);
    const order = [0, 1, 2].sort((a, b) => bbox.size[a] - bbox.size[b]); // the model's axes, smallest first
    const n = [0, 0, 0];
    order.forEach((ax, k) => { n[ax] = Math.max(0, Math.ceil(bbox.size[ax] / room[k] - 1e-9) - 1); });
    if (counts) for (let k = 0; k < 3; k++) if (counts[k] !== undefined && counts[k] !== null && counts[k] !== '') n[k] = Math.max(0, counts[k] | 0);
    const planes = [];
    for (let ax = 0; ax < 3; ax++) for (let i = 1; i <= n[ax]; i++) planes.push({ axis: ax, pos: bbox.min[ax] + bbox.size[ax] * i / (n[ax] + 1) });
    return { counts: n, planes, ...bedFit(bbox, planes, bed, margin) };
  }
  // What a set of planes gives: the number of pieces, the biggest piece's size (the widest gap between cuts on
  // each axis) and whether every piece fits the bed.
  function bedFit(bbox, planes, bed, margin = 0) {
    const room = [bed.w, bed.d, bed.h].map(v => Math.max(1, v - 2 * margin)).sort((a, b) => a - b);
    const biggest = [0, 1, 2].map(ax => {
      const cuts = planes.filter(q => q.axis === ax).map(q => q.pos).filter(x => x > bbox.min[ax] && x < bbox.max[ax]).sort((a, b) => a - b);
      let gap = 0, prev = bbox.min[ax];
      for (const x of cuts.concat([bbox.max[ax]])) { gap = Math.max(gap, x - prev); prev = x; }
      return gap;
    });
    const pieces = [0, 1, 2].reduce((acc, ax) => acc * (planes.filter(q => q.axis === ax && q.pos > bbox.min[ax] && q.pos < bbox.max[ax]).length + 1), 1);
    const fits = biggest.slice().sort((a, b) => a - b).every((s, k) => s <= room[k] + 1e-9);
    return { pieces, biggest, fits, room };
  }
  // Which way, along the line's frame normal, the material of side 2 (the piece that doesn't hold the line's
  // forward edges) lies: +1 or -1.
  function intoSide2(xy) {
    let area2 = 0; const n = xy.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
    return area2 > 0 ? -1 : 1;
  }
  /* A sunk cut face: the face across a curved cut, pushed into the other piece with a wall down from the line,
     so the piece the line goes round keeps at least that much thickness right up to its edge (the owner's
     "impossibly thin walls": a shallow region split off along its outline is a lens that thins to nothing at the
     rim). The other piece gets the matching recess, the way kit parts seat into one another. Each line point is
     pushed into the other piece as far as there is solid to hold it with a wall to spare, checked along lines
     through the model (none where only air lies beyond the line, as under an overhang); the depths are smoothed
     along the line so the wall changes gently, and the face over the sunk
     ring is checked the same way. Returns { xy2, h2, depth, max } in the line's frame, or null for no sink. The
     walls run straight along the line's frame normal: following the other piece's surface was tried and dropped,
     because on a bumpy line the pushed points crossed each other. */
  /* The sunk face as a plug (1.87, 1.88). The owner's arm, cut off along a line that climbs under the capelet, came
     off with flaps of sleeve as thin as paper round its end, because the cut face hugged the sleeve where the line
     climbed. So the face goes from the line's own edge straight into the other piece, each point as far as the solid
     holds it with a wall to spare, down to one level floor `want` past the line's deepest point (lower only where
     there is no room): the piece's end is a solid plug that seats in a matching socket. The walls lean in by `taper`
     degrees so it slides home. 1.87 stepped the walls in by a wall's width first; the owner found the ledge "a
     sliver of a lip", so the walls start at the line now, and the room is measured along lines a hair inside it
     (on the line itself they graze the surface). Where the ring can't be moved in even that far, each point is
     sunk by itself as before. An inlay's pocket (`flat`) keeps its exact outline. */
  // (1.98) The extruded end, a flat array of points, with a flat side where it is nearly round (4πA/L² over `limit`):
  // every point past a chord `cut` of the smallest radius out from the middle, towards the farthest point, is moved
  // onto the chord, so the count stays the same and each wall still runs from its line point to its floor point.
  // A round limb's extrusion (Extra key None) could turn in its socket; with a flat it seats one way only.
  function flatEnd(xy, limit = 0.9, cut = 0.7) {
    const n = xy.length / 2; if (n < 8) return xy;
    let A = 0, L = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1], cr = ax * by - bx * ay; A += cr; cx += (ax + bx) * cr; cy += (ay + by) * cr; L += Math.hypot(bx - ax, by - ay); }
    A /= 2; if (!(Math.abs(A) > 0)) return xy; cx /= 6 * A; cy /= 6 * A;
    if (4 * Math.PI * Math.abs(A) / (L * L) < limit) return xy;
    let far = -1, fx = 1, fy = 0, rmin = Infinity;
    for (let i = 0; i < n; i++) { const r = Math.hypot(xy[2 * i] - cx, xy[2 * i + 1] - cy); if (r > far) { far = r; fx = (xy[2 * i] - cx) / r; fy = (xy[2 * i + 1] - cy) / r; } rmin = Math.min(rmin, r); }
    const hc = cut * rmin, out = Float64Array.from(xy);
    for (let i = 0; i < n; i++) { const s = (xy[2 * i] - cx) * fx + (xy[2 * i + 1] - cy) * fy - hc; if (s > 0) { out[2 * i] -= s * fx; out[2 * i + 1] -= s * fy; } }
    return out;
  }
  function sunkRing(P, I, F, ring, xy, h, into2, want, wall, flat = false, plane = null, taper = 0) {
    if (flat) return sunkRingAt(P, I, F, ring, xy, h, into2, want, wall, true, plane);
    // (1.90) only a line round something a plug can be: a crevice in a fist (3 mm across, winding 13 mm out of its own
    // plane) extruded into a knife-thin fin, and the cut that came back was offered without any plug; such a line,
    // or one bounding a speck, is cut as it is
    { const n = h.length; let a2 = 0, per = 0, lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; per += Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1]); lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
      const width = per > 0 ? 2 * Math.abs(a2) / per : 0; // (4 × area / length: a circle's diameter)
      if (width < Math.max(4 * wall, 2 * want) || hi - lo > 2 * width) return null; }
    const B = insetRing(xy, Math.max(0.02, 0.25 * wall)) || nudgeIn(xy, Math.max(0.02, 0.25 * wall)); // (1.91) only where the room is measured: a jagged CAD outline (the book's) that can't be offset cleanly is nudged in point by point
    if (B) {
      // (1.96) the room is measured along the plug's own leaning walls. Measured straight down from the rim, a sleeve
      // that bends away below its cuff, or a wrist inside a flared cuff, read as "too thin for a plug from the edge"
      // (1.4 mm of room on a 23 mm sleeve), though a plug leaning in 20° sits well inside it. The walls as built are
      // then checked point by point, and where they aren't held the room is measured straight as before.
      const n = h.length, nrm = taper > 0 ? inwardOf(xy) : null;
      const tries = taper > 0 ? [taper, 0] : [0], found = [];
      for (let k = 0; k < tries.length; k++) {
        const deg = tries[k], lean = deg > 0 ? { nrm, tan: Math.tan(deg * Math.PI / 180) } : null;
        const r = sunkRingAt(P, I, F, ring, B, h, into2, want, wall, false, null, true, lean);
        if (!r) continue;
        const t = taperRing(xy, r.depth, taper);
        if (lean && t.deg < deg - 1e-9 && t.deg > 0 && !tries.includes(t.deg)) tries.splice(k + 1, 0, t.deg); // (the ring folds at the full taper: measured again at the taper it holds)
        r.xy2 = flatEnd(t.xy); r.taper = t.deg; r.column = true; r.lineXY = Array.from(xy); r.lineH = Array.from(h); // (1.98) a nearly round end gets a flat: the extrusion can't turn in its socket
        for (let i = 0; i < n; i++) r.h2[i] = h[i] + r.depth[i] * into2;
        r.held = r.holds(r.xy2, r.h2); delete r.holds;
        r.score = (r.held ? 1000 : 0) + (r.shallow ? 0 : 400) + (r.flatEnd ? 200 : r.leveled ? 100 : 0) + 10 * Math.min(r.least, 9) + Math.min(r.max, 9) / 10;
        if (r.held || !lean) found.push(r); // (measured straight and not held as built: 1.95's plug, kept only when nothing better fits)
      }
      if (found.length) return found.reduce((a, b) => (b.score > a.score ? b : a));
    }
    return null; // (1.92) no plug fits: the face is left as it is (sunk point by point it kept a slanted, thin rim), and the joint is a plug pulled in from the edge instead (`planJoints`)
  }
  // The inward direction on the plane at each point of a ring, from the ring eased smooth (as `taperRing` leans its walls)
  function inwardOf(xy) {
    const n = xy.length / 2; let a2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
    const sg = a2 > 0 ? 1 : -1; let e = Array.from({ length: n }, (_, i) => [xy[2 * i], xy[2 * i + 1]]);
    for (let k = 0; k < 10; k++) e = e.map((p, i) => { const a = e[(i + n - 1) % n], c = e[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
    return e.map((p, i) => { const a = e[(i + n - 1) % n], c = e[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L * sg, dx / L * sg]; });
  }
  // Each point of a ring moved in on its plane by d, along the inward direction of the ring eased smooth (no check
  // that the result is a clean ring: it only says where to look for room)
  function nudgeIn(xy, d) {
    const n = xy.length / 2; if (n < 3) return null;
    let a2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
    const sg = a2 > 0 ? 1 : -1; let e = Array.from({ length: n }, (_, i) => [xy[2 * i], xy[2 * i + 1]]);
    for (let k = 0; k < 10; k++) e = e.map((p, i) => { const a = e[(i + n - 1) % n], c = e[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
    const out = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) { const a = e[(i + n - 1) % n], c = e[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1; out[2 * i] = xy[2 * i] - dy / L * sg * d; out[2 * i + 1] = xy[2 * i + 1] + dx / L * sg * d; }
    return out;
  }
  // The floor's ring: each line point moved in on the plane by its depth × tan(deg), along the inward direction of
  // the line eased smooth (a line along mesh edges zig-zags); less taper where that would fold the ring.
  function taperRing(xy, depth, deg) {
    const n = xy.length / 2, copy = Float64Array.from(xy);
    if (!(deg > 0) || n < 4) return { xy: copy, deg: 0 };
    let a2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
    const sg = a2 > 0 ? 1 : -1; // inward is to the left of an anticlockwise ring
    let e = Array.from({ length: n }, (_, i) => [xy[2 * i], xy[2 * i + 1]]);
    for (let k = 0; k < 10; k++) e = e.map((p, i) => { const a = e[(i + n - 1) % n], c = e[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
    const nrm = e.map((p, i) => { const a = e[(i + n - 1) % n], c = e[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L * sg, dx / L * sg]; });
    const pts = Array.from({ length: n }, (_, i) => [xy[2 * i], xy[2 * i + 1]]), flatPts = flatOf(a2 > 0 ? pts : pts.slice().reverse());
    for (const [f, src] of [[1, e], [1, pts], [0.5, e], [0.5, pts], [0.25, pts]]) { // (from the eased line first: the floor ring comes out smooth)
      const tn = Math.tan(deg * f * Math.PI / 180), q = src.map((p, i) => [p[0] + nrm[i][0] * depth[i] * tn, p[1] + nrm[i][1] * depth[i] * tn]);
      const qq = a2 > 0 ? q : q.slice().reverse();
      if (ringOk(qq) && q.every(p => pointInRing(flatPts, p[0], p[1]))) { const out = new Float64Array(2 * n); q.forEach((p, i) => { out[2 * i] = p[0]; out[2 * i + 1] = p[1]; }); return { xy: out, deg: deg * f }; }
      // (1.92) a jagged outline (a book's edge with its straps and clasps) folds the moved ring at every notch: the
      // moved ring is eased until it is a clean ring inside the line, so the plug's end is a smooth outline and its
      // sides lean in from the jagged edge (before, such a plug had straight sides)
      if (f === 1 && src === e) {
        let r = q;
        for (let pass = 0; pass < 60; pass++) {
          r = r.map((p, i) => { const a = r[(i + n - 1) % n], c = r[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
          if (pass % 4 !== 3) continue;
          // (where the eased ring still crosses a notch of the line, that point stays on the line: a straight side there)
          // where the eased ring still crosses a notch of the line, that point comes back towards the line as far as
          // it must (a steeper side there), and so do the points round a crossing that is left; then its neighbours
          // are held to it, so no point stands out from the ring as a fin
          const tt = new Float64Array(n).fill(1), at = (i) => [pts[i][0] + (r[i][0] - pts[i][0]) * tt[i], pts[i][1] + (r[i][1] - pts[i][1]) * tt[i]];
          for (let i = 0; i < n; i++) { while (tt[i] > 0) { const q0 = at(i); if (pointInRing(flatPts, q0[0], q0[1])) break; tt[i] = tt[i] > 0.26 ? tt[i] - 0.25 : 0; } }
          let r2 = null;
          for (let fix = 0; fix < 16; fix++) {
            for (let sweep = 0; sweep < 2; sweep++) for (let i = 0; i < n; i++) { const lo = Math.min(tt[(i + n - 1) % n], tt[(i + 1) % n]); if (tt[i] > lo + 0.25) tt[i] = lo + 0.25; }
            r2 = pts.map((_, i) => at(i));
            const hits = findSelfCrossings(flatOf(r2)); if (!hits.length) break;
            for (const [k, m] of hits) { const inner = m - k, wrap = inner > n / 2, from = wrap ? m : k, cnt = wrap ? n - inner : inner; if (cnt > n / 8) continue; for (let j = -1; j <= cnt + 2; j++) { const i = ((from + j) % n + n) % n; tt[i] = Math.max(0, tt[i] - 0.25); } }
          }
          // (the blending and the crossings' fix move points again: none may end outside the line)
          for (let i = 0; i < n; i++) { while (tt[i] > 0) { const q0 = at(i); if (pointInRing(flatPts, q0[0], q0[1])) break; tt[i] = tt[i] > 0.26 ? tt[i] - 0.25 : 0; } }
          r2 = pts.map((_, i) => at(i));
          const rr = a2 > 0 ? r2 : r2.slice().reverse();
          let kept = 0; for (let i = 0; i < n; i++) if (tt[i] > 0.5) kept++;
          if (kept >= 0.6 * n && ringOk(rr)) { const out = new Float64Array(2 * n); r2.forEach((p, i) => { out[2 * i] = p[0]; out[2 * i + 1] = p[1]; }); return { xy: out, deg: deg * f }; }
        }
      }
    }
    return { xy: copy, deg: 0 };
  }
  // The ring moved in by w on its plane (same points, same order), or null where that folds it or brings it nearer
  // than most of w to the line anywhere.
  function insetRing(xy, w) {
    const n = xy.length / 2; if (n < 4) return null;
    let a2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
    const ccw = a2 > 0, idx = [...Array(n).keys()]; if (!ccw) idx.reverse();
    const pts = idx.map(i => [xy[2 * i], xy[2 * i + 1]]);
    const ease = (r) => r.map((p, i) => { const a = r[(i + n - 1) % n], c = r[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
    // a line along the mesh's edges zig-zags, and moving each corner in folds it, so the line is eased first (more
    // each try), moved in from there, and must still stay most of w in from the line itself
    for (const [passes, f] of [[0, 1], [3, 1], [10, 1.25], [30, 1.5]]) { let src = pts; for (let k = 0; k < passes; k++) src = ease(src); const r = insetFrom(src, w * f); if (r) return r; }
    return null;
    function insetFrom(src, d) {
    let q = offsetRing(src, -d);
    const near = (p) => { let best = Infinity; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], L = ex * ex + ey * ey || 1e-30, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L)); best = Math.min(best, Math.hypot(a[0] + ex * t - p[0], a[1] + ey * t - p[1])); } return best; };
    const flatPts = flatOf(pts), good = (r) => ringOk(r) && r.every(p => pointInRing(flatPts, p[0], p[1]) && near(p) >= 0.7 * w);
    // a notch narrower than 2w folds the moved ring into a swallowtail: the loop past the crossing is cut out, its
    // points spread along the two edges through the crossing (so none share a place)
    for (let it = 0; it < 4 * n; it++) {
      const hits = findSelfCrossings(flatOf(q)); if (!hits.length) break;
      const [k, m, tk] = hits[0], inner = m - k, wrap = inner > n / 2;
      if (Math.min(inner, n - inner) > n / 4) return null; // not a notch: the ring itself is too narrow here
      const X = [q[k][0] + (q[(k + 1) % n][0] - q[k][0]) * tk, q[k][1] + (q[(k + 1) % n][1] - q[k][1]) * tk];
      const from = wrap ? m : k, cnt = wrap ? n - inner : inner, A0 = q[from], B0 = q[(from + cnt + 1) % n];
      const l1 = Math.hypot(X[0] - A0[0], X[1] - A0[1]), l2 = Math.hypot(B0[0] - X[0], B0[1] - X[1]), L = l1 + l2 || 1e-30;
      for (let r = 1; r <= cnt; r++) { const d = (r / (cnt + 1)) * L; q[(from + r) % n] = d <= l1 ? [A0[0] + (X[0] - A0[0]) * d / (l1 || 1e-30), A0[1] + (X[1] - A0[1]) * d / (l1 || 1e-30)] : [X[0] + (B0[0] - X[0]) * (d - l1) / (l2 || 1e-30), X[1] + (B0[1] - X[1]) * (d - l1) / (l2 || 1e-30)]; }
    }
    for (let pass = 0; pass < 4 && !good(q); pass++) { // tight corners: ease the stepped-in ring and look again
      q = q.map((p, i) => { const a = q[(i + n - 1) % n], c = q[(i + 1) % n]; return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4]; });
    }
    if (!good(q)) return null;
    const out = new Float64Array(2 * n); idx.forEach((i, k) => { out[2 * i] = q[k][0]; out[2 * i + 1] = q[k][1]; });
    return out;
    }
  }
  function sunkRingAt(P, I, F, ring, xy, h, into2, want, wall, flat = false, plane = null, column = false, lean = null) {
    const n = ring.length, g = raysFor(P, I, F), nv = P.length / 3;
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2], oz = F.o[0] * F.n[0] + F.o[1] * F.n[1] + F.o[2] * F.n[2];
    // straight into the other piece along the frame normal, so the recess walls are parallel and the piece lifts
    // straight out (walls that followed the other piece's surface crossed each other on bumpy lines)
    const dir = [0, 0, into2], dirs = []; for (let i = 0; i < n; i++) dirs.push(dir);
    // how deep each point can go: the sunk point needs a wall of solid beyond it, and must be inside at all
    const roomAt = (x, y, z) => { const r = solidRuns(g, x + ox + 1.3e-7, y + oy + 0.7e-7), c = z + oz; for (let i = 0; i < r.length; i += 2) if (r[i] - 1e-6 <= c && c <= r[i + 1] + 1e-6) return into2 > 0 ? [r[i + 1] - c, c - r[i]] : [c - r[i], r[i + 1] - c]; return null; };
    const depth = new Float64Array(n);
    if (flat) {
      // a flat floor (an inlay that prints on its base): one plane, `want` beyond the line's deepest point, every
      // point pushed to it; when any point lacks the room, the whole floor comes up, so it stays flat
      let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
      const off = Array.from(h, v => (into2 > 0 ? hi - v : v - lo));
      // a given plane (an inlay's floor must be the pocket's): each point goes straight along the normal to it
      let given = null;
      if (plane) {
        const dn = F.n[0] * plane.normal[0] + F.n[1] * plane.normal[1] + F.n[2] * plane.normal[2];
        if (Math.abs(dn) > 0.5) {
          given = [];
          for (let i = 0; i < n; i++) { const p = planePoint(F, xy[2 * i], xy[2 * i + 1]), q = [p[0] + F.n[0] * h[i], p[1] + F.n[1] * h[i], p[2] + F.n[2] * h[i]]; given.push(((plane.point[0] - q[0]) * plane.normal[0] + (plane.point[1] - q[1]) * plane.normal[1] + (plane.point[2] - q[2]) * plane.normal[2]) / (into2 * dn)); }
          if (given.some(v => !(v > 0.02))) given = null;
        }
      }
      const tries = given ? [0] : []; for (let w = want; w > 0.05 && !given; w /= 2) tries.push(w);
      for (const w of tries) {
        const d = given ? given : off.map(v => v + w);
        let ok = true;
        for (let i = 0; i < n && ok; i++) { const r = roomAt(xy[2 * i], xy[2 * i + 1], h[i] + d[i] * into2); if (!(r && r[0] >= wall && (column ? r[1] >= d[i] - 1e-3 * wall : r[1] >= 0.05))) ok = false; } // (a stepped-in column must be solid all the way from the ledge to the floor)
        if (!ok) continue;
        const xy2 = new Float64Array(2 * n), h2 = new Float64Array(n);
        for (let i = 0; i < n; i++) { xy2[2 * i] = xy[2 * i]; xy2[2 * i + 1] = xy[2 * i + 1]; h2[i] = h[i] + d[i] * into2; }
        const H = capHeight(xy2, h2), L = makeLoop(ring, [], xy2), base = { loops: [L], regions: buildRegions([L]) }, rooms = [];
        for (const q of regionSamples(base, 0, 150)) { const r = roomAt(q.x, q.y, H(q.x, q.y)); rooms.push(r ? r[0] : 0); }
        rooms.sort((a, b) => a - b);
        if (!rooms.length || rooms[Math.floor(0.1 * rooms.length)] >= 0.75 * wall) {
          const zf = h2[0], pt = [F.o[0] + F.n[0] * zf, F.o[1] + F.n[1] * zf, F.o[2] + F.n[2] * zf]; // the floor plane, for a matching piece
          const floor = given ? Math.min(...d) : w;
          return { xy2, h2, depth: d, max: Math.max(...d), floor, flat: true, plane: { point: pt, normal: F.n.slice(), floor } };
        }
      }
      return null;
    }
    // (1.87) a plug: how far the solid holds each point's line through the model, with a wall to spare
    const roomOf = new Float64Array(n);
    let hTop = -Infinity; for (let i = 0; i < n; i++) hTop = Math.max(hTop, h[i] * into2);
    for (let i = 0; column && i < n; i++) {
      const r = roomAt(xy[2 * i], xy[2 * i + 1], h[i] + into2 * 1e-3 * wall);
      roomOf[i] = r ? r[0] - wall : -Infinity;
      if (r && lean) { // along the leaning wall: as deep as every point of it is inside the other piece with a wall beyond
        const far = hTop + want - h[i] * into2 + wall, step = Math.max(0.25, 0.5 * wall, far / 40); let ok = 0;
        for (let d = Math.min(step, 0.5 * want); d <= far + step; d += step) { const q = roomAt(xy[2 * i] + lean.nrm[i][0] * d * lean.tan, xy[2 * i + 1] + lean.nrm[i][1] * d * lean.tan, h[i] + into2 * d); if (!(q && q[0] >= wall)) break; ok = d; }
        roomOf[i] = ok > 0 ? ok : Math.min(roomOf[i], 0);
      }
    }
    // the plug as built (its floor ring moved in by the taper): held where every floor point, but for a stray 2% of the line, is inside the other piece with half a wall beyond
    const holds = (xy2, h2) => { let per = 0, short = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(xy2[2 * j] - xy2[2 * i], xy2[2 * j + 1] - xy2[2 * i + 1], h2[j] - h2[i]); per += l; const q = roomAt(xy2[2 * i], xy2[2 * i + 1], h2[i]); if (!(q && q[0] >= 0.5 * wall)) short += l; } return short <= 0.04 * per; };
    if (column) { // a point whose line grazes the surface reads no room at all: it takes its nearer neighbours' room
      for (let i = 0; i < n; i++) if (roomOf[i] === -Infinity) { let l = -Infinity, r = -Infinity; for (let k = 1; k <= 3 && l === -Infinity; k++) l = roomOf[(i + n - k) % n]; for (let k = 1; k <= 3 && r === -Infinity; k++) r = roomOf[(i + k) % n]; roomOf[i] = Math.min(l, r); }
    }
    if (column) return plugFloor();
    // (1.92) The plug's end, with no tilt and no point left short: the owner's arm came off with its end a tall
    // spike, because the floor was a plane tilted up to 35° to fit the shoulder and then pulled down to the line
    // wherever a point lacked room. Now the end is level (square to the plug's axis) `w` past the line's deepest
    // point if the other piece holds that all round; otherwise the cut face itself pushed in by `w` (its own shape,
    // smooth); `w` is Extrude, then less, never under `dMin`. A point whose line only grazes the other piece's
    // surface reads a dip in the room that its neighbours don't have: a dip of a point or two is read past (the room
    // there is its neighbours'), a longer one is real and the plug must fit it. Null when nothing fits.
    function plugFloor() {
      let per = 0; const seg = new Float64Array(n);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; seg[i] = Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1], h[j] - h[i]); per += seg[i]; }
      // the room as the solid holds it, past one- or two-point dips (each point's room is at least the lower of the
      // best rooms within two points either side: a lone grazing reading lifts to its neighbours', a real narrowing
      // that spans more points stays)
      const room = Float64Array.from(roomOf), reach = Math.min(3 * wall, Math.max(2 * wall, 0.015 * per)); // (never past a real narrowing: three walls at most)
      for (let i = 0; n >= 12 && i < n; i++) { // (by length along the line, not by count: sliced lines crowd points)
        let l = -Infinity, r = -Infinity, run = 0;
        for (let k = 1; k < n / 2; k++) { run += seg[(i + n - k) % n]; if (run > reach) break; l = Math.max(l, roomOf[(i + n - k) % n]); }
        run = 0; for (let k = 1; k < n / 2; k++) { run += seg[(i + k - 1) % n]; if (run > reach) break; r = Math.max(r, roomOf[(i + k) % n]); }
        if (l > -Infinity && r > -Infinity) room[i] = Math.max(roomOf[i], Math.min(l, r));
      }
      const lv = new Float64Array(n); let top = -Infinity;
      for (let i = 0; i < n; i++) { lv[i] = h[i] * into2; top = Math.max(top, lv[i]); }
      const dMin = Math.min(want, Math.max(wall, 0.4)); // (a miniature's 2 mm limb holds a plug of half a millimetre, no more)
      const ws = [want, 0.75 * want, 0.5 * want, 0.35 * want, 0.2 * want].filter(w => w >= dMin - 1e-9);
      if (!ws.length) ws.push(want);
      const faceHolds = (d) => { // the face over the floor must have solid beyond it too, under its middle
        const xy2 = Float64Array.from(xy), h2 = new Float64Array(n); for (let i = 0; i < n; i++) h2[i] = h[i] + d[i] * into2;
        const H = capHeight(xy2, h2), L = makeLoop(ring, [], xy2), base = { loops: [L], regions: buildRegions([L]) }, rooms = [];
        for (const q of regionSamples(base, 0, 150)) { const r = roomAt(q.x, q.y, H(q.x, q.y)); rooms.push(r ? r[0] : 0); }
        rooms.sort((a, b) => a - b);
        return !rooms.length || rooms[Math.floor(0.1 * rooms.length)] >= 0.75 * wall ? { xy2, h2 } : null;
      };
      // (1.96) a plug 1 mm deep at its shallowest is no key (the owner's book: "1.0 to 18.6 mm"): every kind is tried at
      // a useful depth first (half of Extrude, or 1.5 mm), and only then the shallow ones, marked `shallow`
      const good = (w) => w >= Math.min(1.5, 0.5 * want) - 1e-9, order = [];
      for (const deepOnes of [true, false]) for (const kind of ['level', 'leveled', 'even']) for (const w of ws) if (good(w) === deepOnes) order.push([kind, w]);
      for (const [kind, w] of order) { // (a level end at any depth before an even one: an even plug on a saddle-shaped line keeps the line's horns)
        const d = new Float64Array(n); let shortLen = 0; // (a stray point or two still short, under 2% of the line, doesn't stop a plug)
        for (let i = 0; i < n; i++) { d[i] = kind === 'level' ? top + w - lv[i] : w; if (!(room[i] >= d[i] - 0.5 * wall)) shortLen += (seg[i] + seg[(i + n - 1) % n]) / 2; }
        if (shortLen > Math.min(4 * wall, Math.max(2 * wall, 0.02 * per))) continue;
        if (kind === 'leveled') {
          // (1.93, the owner: "extrude into the main body part, leveling the extrusion out to a more smooth or flat
          // plug") where the other piece can't hold a level end all round, the end is level as far as it holds and
          // comes down smoothly only where it must, never nearer the line than `w`: the line's horns are filled in
          // between, up to the level, instead of standing bare
          const cap = (i) => Math.max(w, room[i]), win = Math.max(3 * wall, 0.08 * per);
          for (let i = 0; i < n; i++) d[i] = Math.min(top + w - lv[i], cap(i));
          for (let pass = 0; pass < 3; pass++) { // the floor's level eased along the line (lowest within reach, then the mean), held between `w` and the room
            const lvl = Array.from(d, (v, i) => lv[i] + v), lo = new Float64Array(n), sm = new Float64Array(n);
            const span = (i, f) => { let acc = f(null, lvl[i]), run = 0; for (let k = 1; k < n / 2; k++) { run += seg[(i + k - 1) % n]; if (run > win) break; acc = f(acc, lvl[(i + k) % n]); } run = 0; for (let k = 1; k < n / 2; k++) { run += seg[(i + n - k) % n]; if (run > win) break; acc = f(acc, lvl[(i + n - k) % n]); } return acc; };
            for (let i = 0; i < n; i++) lo[i] = pass === 0 ? span(i, (a, v) => (a === null ? v : Math.min(a, v))) : lvl[i];
            for (let i = 0; i < n; i++) lvl[i] = lo[i];
            for (let i = 0; i < n; i++) { const a = span(i, (acc, v) => (acc === null ? [v, 1] : [acc[0] + v, acc[1] + 1])); sm[i] = a[0] / a[1]; }
            for (let i = 0; i < n; i++) d[i] = Math.max(w, Math.min(sm[i] - lv[i], cap(i), top + w - lv[i]));
          }
          let dLo = Infinity, dHi = 0; for (let i = 0; i < n; i++) { dLo = Math.min(dLo, d[i]); dHi = Math.max(dHi, d[i]); }
          if (dHi - dLo < 0.25 * w) continue; // (no deeper anywhere than an even plug: that one will do)
        }
        const f = faceHolds(d);
        if (!f) continue;
        let max = 0; for (let i = 0; i < n; i++) max = Math.max(max, d[i]);
        return { xy2: f.xy2, h2: f.h2, depth: Array.from(d), max, least: w, flatEnd: kind === 'level', leveled: kind === 'leveled', even: kind === 'even', floorTilt: 0, shallow: !good(w), holds };
      }
      return null;
    }
    // (an inlay's sunk face, or one sunk without a plug) each point as deep as the solid holds it
    for (let i = 0; i < n; i++) {
      let s = want;
      for (let tries = 0; tries < 5 && s > 0.02; tries++) {
        const r = roomAt(xy[2 * i] + s * dirs[i][0], xy[2 * i + 1] + s * dirs[i][1], h[i] + s * dirs[i][2]);
        if (r && r[0] >= wall && r[1] >= 0.05) break;
        s /= 2;
        if (tries === 4) s = 0;
      }
      depth[i] = s;
    }
    // smoothed along the line: no deeper than its neighbours within a wall's length, then averaged over the same
    const len = new Float64Array(n); for (let i = 0; i < n; i++) { const j = (i + 1) % n; len[i] = Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1], h[j] - h[i]); }
    const window = (i, f) => { let acc = f.init, run = 0; for (let k = 0; k <= n / 2; k++) { if (k > 0 && (run += len[(i + k - 1) % n]) > wall) break; acc = f.step(acc, depth[(i + k) % n]); } run = 0; for (let k = 1; k <= n / 2; k++) { if ((run += len[(i + n - k) % n]) > wall) break; acc = f.step(acc, depth[(i + n - k) % n]); } return f.done(acc); };
    const lows = new Float64Array(n); for (let i = 0; i < n; i++) lows[i] = window(i, { init: Infinity, step: Math.min, done: (a) => a });
    depth.set(lows);
    const smooth = new Float64Array(n); for (let i = 0; i < n; i++) smooth[i] = window(i, { init: [0, 0], step: (a, v) => [a[0] + v, a[1] + 1], done: (a) => a[0] / a[1] });
    let max = 0; for (let i = 0; i < n; i++) max = Math.max(max, smooth[i]);
    if (max < 0.05) return null;
    const xy2 = new Float64Array(2 * n), h2 = new Float64Array(n);
    const build = (scale) => { for (let i = 0; i < n; i++) { const s = smooth[i] * scale; xy2[2 * i] = xy[2 * i] + s * dirs[i][0]; xy2[2 * i + 1] = xy[2 * i + 1] + s * dirs[i][1]; h2[i] = h[i] + s * dirs[i][2]; } };
    // the face over the sunk ring must have a wall of solid beyond it too (a thin body under a region)
    for (let scale = 1; scale > 0.1; scale *= 0.5) {
      build(scale);
      const H = capHeight(xy2, h2), L = makeLoop(ring, [], xy2), base = { loops: [L], regions: buildRegions([L]) }, rooms = [];
      for (const q of regionSamples(base, 0, 150)) { const r = roomAt(q.x, q.y, H(q.x, q.y)); rooms.push(r ? r[0] : 0); }
      rooms.sort((a, b) => a - b);
      if (!rooms.length || rooms[Math.floor(0.1 * rooms.length)] >= 0.75 * wall) { const d = Array.from(smooth, v => v * scale); return { xy2, h2, depth: d, max: max * scale }; }
    }
    return null;
  }
  /* Lines cut together must agree: each piece of surface they bound has to lie on one side of every line round
     it. Side 1 holds every line's forward edges, side 2 the rest (a region and its neighbours; two balls picked
     together and the bar between them). Returns the loops, turned round where needed, with the side numbers of
     every triangle; throws where the lines don't free a piece, or can't agree. Called before keys are planned, so
     the frames the keys are planned in are the frames the cut uses. */
  function orientLoops(P, I, loopsIn, opts = {}) {
    const loops = loopsIn.map(l => straightLoop(P, I, l));
    if (loops.some(l => !l.closed)) throw new Error('This border doesn’t go all the way round, so it can’t split the part. Pick one that circles a limb or the edge of a sleeve.');
    const nv = P.length / 3, nt = I.length / 3, rings = loops.map(l => l.verts.slice()), L = rings.length;
    const cutEdge = new Set();
    for (const ring of rings) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; cutEdge.add(a < b ? a * nv + b : b * nv + a); }
    // neighbours across every edge that isn't on a line
    const first = new Map(), nb = new Int32Array(nt * 3).fill(-1);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
      if (cutEdge.has(key)) continue;
      const f = first.get(key);
      if (f === undefined) first.set(key, 3 * t + k); else { first.delete(key); nb[3 * t + k] = Math.floor(f / 3); nb[f] = t; }
    }
    // the pieces of surface the lines bound, with every line as a wall
    const comp = new Int32Array(nt).fill(-1);
    let nc = 0;
    for (let t0 = 0; t0 < nt; t0++) {
      if (comp[t0] >= 0) continue;
      const st = [t0]; comp[t0] = nc;
      while (st.length) { const t = st.pop(); for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && comp[q] < 0) { comp[q] = nc; st.push(q); } } }
      nc++;
    }
    // the piece on each side of each line's first edge (forward: the triangle that holds the edge as the line runs)
    const want = new Map(); // directed edge -> [loop, which side]
    rings.forEach((ring, li) => { want.set(ring[0] * nv + ring[1], [li, 0]); want.set(ring[1] * nv + ring[0], [li, 1]); });
    const sidesOf = rings.map(() => [-1, -1]);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const w = want.get(I[3 * t + k] * nv + I[3 * t + (k + 1) % 3]); if (w) sidesOf[w[0]][w[1]] = comp[t]; }
    if (sidesOf.some(s => s[0] < 0 || s[1] < 0)) throw new Error('This border runs along an edge of the surface that isn’t closed. Fill holes in the model panel first.');
    if (sidesOf.some(([a, b]) => a === b)) throw new Error(L > 1 ? (opts.what === 'lines' ? 'Cutting along these lines wouldn’t free a piece yet: the surface still joins up around them. Shift-click another line that goes round the same piece, such as where it touches something else, or paint the area to split off.' : 'Cutting along this region’s outline wouldn’t free it (the surface joins up around it).') : 'Cutting along this border alone wouldn’t split the part in two: the surface joins up around it, as when a hand holds something that touches the body. Click the region beside the line instead, to cut along its whole outline, shift-click more lines, or paint the area to split off.');
    const colour = new Int8Array(nc);
    for (let seed = 0; seed < L; seed++) {
      if (colour[sidesOf[seed][0]] || colour[sidesOf[seed][1]]) continue;
      colour[sidesOf[seed][0]] = 1;
      let changed = true;
      while (changed) {
        changed = false;
        for (const [a, b] of sidesOf) {
          if (colour[a] && !colour[b]) { colour[b] = 3 - colour[a]; changed = true; } else if (colour[b] && !colour[a]) { colour[a] = 3 - colour[b]; changed = true; }
          else if (colour[a] && colour[a] === colour[b]) throw new Error('These lines can’t all be cut at once: a piece would have to be on both sides of one of them. Pick fewer lines, or split off a region instead.');
        }
      }
    }
    // For a region, side 1 is the region. For lines picked by hand, side 1 is the smaller side (less surface), so a
    // sunk face recesses into the bigger piece and the keys' "solid half" means the bigger piece.
    if (opts.what !== 'region') {
      const area = [0, 0, 0];
      for (let t = 0; t < nt; t++) { const c = colour[comp[t]]; if (!c) continue; const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2]; area[c] += Math.hypot(...cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]])); }
      if (area[1] > area[2]) for (let c = 0; c < nc; c++) if (colour[c]) colour[c] = 3 - colour[c];
    }
    const out = loops.map((l, li) => (colour[sidesOf[li][0]] === 2 ? { ...l, verts: l.verts.slice().reverse() } : l));
    const side = new Int8Array(nt);
    for (let t = 0; t < nt; t++) side[t] = colour[comp[t]];
    return { loops: out, side };
  }
  /* ---------- painted selections ----------
     What Meshmixer and ZBrush do: paint faces with a brush, then split the painted faces off and cap the holes.
     A painted area always has a closed outline, so it always separates; it is cut like a region (splitRegions on
     a two-group labelling), so keys, plugs, sinking and "cut anyway" all apply. */
  const triAdjCache = new WeakMap();
  function triangleAdjacency(P, I) {
    let adj = triAdjCache.get(I);
    if (adj) return adj;
    const nt = I.length / 3, nv = P.length / 3, nb = new Int32Array(nt * 3).fill(-1), first = new Map(), C = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a, f = first.get(key);
        if (f === undefined) first.set(key, 3 * t + k); else { first.delete(key); nb[3 * t + k] = Math.floor(f / 3); nb[f] = t; }
        C[3 * t] += P[3 * a] / 3; C[3 * t + 1] += P[3 * a + 1] / 3; C[3 * t + 2] += P[3 * a + 2] / 3;
      }
    }
    adj = { nb, C };
    triAdjCache.set(I, adj);
    return adj;
  }
  // The point of triangle abc nearest p (Ericson's regions), as [x, y, z]
  function closestOnTriangle(p, a, b, c) {
    const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    const at = (o, d, t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a.slice();
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b.slice();
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, ab, d1 / (d1 - d3));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c.slice();
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, ac, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  }
  // Cut lines eased along the surface (the owner: "if a cut would come out jagged due to the original topology,
  // smooth it out"). A line that follows the mesh's edges zigzags from triangle to triangle; each of its vertices
  // is drawn towards the middle of its two neighbours on the line, `passes` times, and put back on the surface as
  // it was (the nearest point of the triangles round it), never further than `reach` (0.9) of its shortest edge
  // from where it was, and never so far that a triangle round it turns over. Only the line's vertices move and the
  // connections stay as they are, so a sealed part stays sealed and both pieces share the smoothed line. Returns
  // `{ positions, moved }`: a copy of P (P itself when nothing moved).
  function smoothLoopVertices(P, I, loops, opts = {}) {
    const passes = opts.passes || 10, reach = opts.reach || 0.9, vt = vertexTriangles(P, I);
    const Q = P instanceof Float64Array ? new Float64Array(P) : new Float32Array(P), pt = (A, v) => [A[3 * v], A[3 * v + 1], A[3 * v + 2]];
    const on = new Map(); // vertex -> its two neighbours on a line (a vertex on two lines, or twice on one, stays put)
    const skip = new Set();
    for (const l of loops) {
      if (!l.closed || l.verts.length < 4) continue;
      const n = l.verts.length;
      for (let i = 0; i < n; i++) { const v = l.verts[i]; if (on.has(v)) skip.add(v); else on.set(v, [l.verts[(i + n - 1) % n], l.verts[(i + 1) % n]]); }
    }
    for (const v of skip) on.delete(v);
    { // (1.77) a vertex where the line runs along a sharp edge (a crease, a made object's rim on cloth) stays on it: eased, it left the seam
      const tris = (a, b) => { const out = []; for (let k = vt.start[a]; k < vt.start[a + 1]; k++) { const t = vt.tri[k]; if (I[3 * t] === b || I[3 * t + 1] === b || I[3 * t + 2] === b) out.push(t); } return out; };
      const edges = [];
      for (const [v, [a, b]] of on) for (const w of [a, b]) { const ts = tris(v, w); if (ts.length === 2) edges.push(ts[0], ts[1], v, w); }
      for (const v of sharpEdgeVertices(P, I, edges, null, opts.pinDeg || 25)) on.delete(v);
    }
    if (!on.size) return { positions: P, moved: 0 };
    const limit = new Map(), nrm = (A, t) => { const a = pt(A, I[3 * t]), b = pt(A, I[3 * t + 1]), c = pt(A, I[3 * t + 2]); return cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]); };
    for (const v of on.keys()) {
      let e = Infinity;
      for (let k = vt.start[v]; k < vt.start[v + 1]; k++) { const t = vt.tri[k]; for (let j = 0; j < 3; j++) { const w = I[3 * t + j]; if (w !== v) e = Math.min(e, Math.hypot(P[3 * w] - P[3 * v], P[3 * w + 1] - P[3 * v + 1], P[3 * w + 2] - P[3 * v + 2])); } }
      limit.set(v, reach * e);
    }
    let moved = 0;
    const flips = (v) => { for (let k = vt.start[v]; k < vt.start[v + 1]; k++) { const t = vt.tri[k], a = nrm(P, t), b = nrm(Q, t), la = Math.hypot(...a), lb = Math.hypot(...b); if (!(lb > 1e-12 * la) || (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) < 0.3 * la * lb) return true; } return false; };
    for (let pass = 0; pass < passes; pass++) {
      const next = new Map();
      for (const [v, [a, b]] of on) {
        const p = pt(Q, v), m = [(Q[3 * a] + Q[3 * b]) / 2, (Q[3 * a + 1] + Q[3 * b + 1]) / 2, (Q[3 * a + 2] + Q[3 * b + 2]) / 2];
        const want = [p[0] + (m[0] - p[0]) * 0.5, p[1] + (m[1] - p[1]) * 0.5, p[2] + (m[2] - p[2]) * 0.5];
        let best = null, bd = Infinity; // back on the surface as it was
        for (let k = vt.start[v]; k < vt.start[v + 1]; k++) { const t = vt.tri[k], q = closestOnTriangle(want, pt(P, I[3 * t]), pt(P, I[3 * t + 1]), pt(P, I[3 * t + 2])), d = (q[0] - want[0]) ** 2 + (q[1] - want[1]) ** 2 + (q[2] - want[2]) ** 2; if (d < bd) { bd = d; best = q; } }
        const o = pt(P, v), dx = best[0] - o[0], dy = best[1] - o[1], dz = best[2] - o[2], dl = Math.hypot(dx, dy, dz), lim = limit.get(v);
        if (dl > lim) { const f = lim / dl; best = [o[0] + dx * f, o[1] + dy * f, o[2] + dz * f]; }
        next.set(v, best);
      }
      for (const [v, q] of next) {
        const was = pt(Q, v);
        Q[3 * v] = q[0]; Q[3 * v + 1] = q[1]; Q[3 * v + 2] = q[2];
        if (flips(v)) { Q[3 * v] = was[0]; Q[3 * v + 1] = was[1]; Q[3 * v + 2] = was[2]; }
      }
    }
    for (const v of on.keys()) if (Q[3 * v] !== P[3 * v] || Q[3 * v + 1] !== P[3 * v + 1] || Q[3 * v + 2] !== P[3 * v + 2]) moved++;
    return { positions: moved ? Q : P, moved };
  }
  // The triangle whose centre is nearest a point (none when the point is far from the surface).
  function nearestTriangle(P, I, point, limit = Infinity) {
    const { C } = triangleAdjacency(P, I);
    let best = -1, bd = limit * limit;
    for (let t = 0; t < C.length / 3; t++) { const d = (C[3 * t] - point[0]) ** 2 + (C[3 * t + 1] - point[1]) ** 2 + (C[3 * t + 2] - point[2]) ** 2; if (d < bd) { bd = d; best = t; } }
    return best;
  }
  // A brush dab: the triangles within `radius` of `centre`, reached across the surface from the triangle under the
  // brush, so a dab on a hand doesn't paint the other side of a thin hand... unless the surface is thinner than the
  // brush, as in the real tools. Returns triangle ids.
  function brushTriangles(P, I, start, centre, radius) {
    const { nb, C } = triangleAdjacency(P, I), r2 = radius * radius, seen = new Uint8Array(C.length / 3), out = [], st = [start];
    if (start < 0) return out;
    seen[start] = 1;
    while (st.length) {
      const t = st.pop();
      if ((C[3 * t] - centre[0]) ** 2 + (C[3 * t + 1] - centre[1]) ** 2 + (C[3 * t + 2] - centre[2]) ** 2 > r2) continue;
      out.push(t);
      for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && !seen[q]) { seen[q] = 1; st.push(q); } }
    }
    return out;
  }
  // The sphere brush (modelsplitter's): every triangle whose centre lies within the radius, connected or not, so
  // a dab reaches a layer behind (clothing over a body) that the surface brush stops at.
  function sphereTriangles(P, I, centre, radius) {
    const { C } = triangleAdjacency(P, I), r2 = radius * radius, out = [];
    for (let t = 0; t < C.length / 3; t++) if ((C[3 * t] - centre[0]) ** 2 + (C[3 * t + 1] - centre[1]) ** 2 + (C[3 * t + 2] - centre[2]) ** 2 <= r2) out.push(t);
    return out;
  }
  /* ---------- sculpting ----------
     modelsplitter's Sculpt tool: brushes that move vertices, with a soft falloff, on a copy of the positions the
     app commits as one undo step per stroke. The surface's connections never change, so a sealed part stays sealed.
     The brush takes the vertices it can reach across the surface from the face under it, within its radius (as the
     surface paint brush does), never the far side of a thin part. */
  const vtCache = new WeakMap();
  // The triangles round each vertex (CSR), cached per index array
  function vertexTriangles(P, I) {
    let vt = vtCache.get(I);
    if (vt) return vt;
    const nv = P.length / 3, start = new Int32Array(nv + 1);
    for (let k = 0; k < I.length; k++) start[I[k] + 1]++;
    for (let v = 0; v < nv; v++) start[v + 1] += start[v];
    const fill = start.slice(0, nv), tri = new Int32Array(I.length);
    for (let k = 0; k < I.length; k++) tri[fill[I[k]]++] = (k / 3) | 0;
    vt = { start, tri };
    vtCache.set(I, vt);
    return vt;
  }
  const faceNormal = (P, I, t, out) => {
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
    out[0] = ey * fz - ez * fy; out[1] = ez * fx - ex * fz; out[2] = ex * fy - ey * fx; // twice the area, facing out
    return out;
  };
  // One dab of the brush on P (changed in place). centre and radius in mm; strength 0 to 1; mode 'smooth'
  // (each vertex towards the middle of its neighbours), 'inflate' (out along the surface, or in with reverse),
  // 'flatten' (towards the plane through the brush's area); start is the triangle under the brush; mask, if given,
  // marks the triangles the brush may touch (a painted area), by triangle. Returns the vertices moved and the
  // triangles they belong to, so a view can refresh just those.
  function sculptDab(P, I, { centre, radius, strength = 0.5, mode = 'inflate', reverse = false, start = -1, mask = null }) {
    const nv = P.length / 3, r2 = radius * radius, adj = vertexAdjacency(P, I), vt = vertexTriangles(P, I);
    if (start < 0) start = nearestTriangle(P, I, centre, radius);
    if (start < 0) return { moved: [], tris: [] };
    // the vertices within reach across the surface
    const seen = new Uint8Array(nv), queue = [], w = [];
    const d2 = (v) => (P[3 * v] - centre[0]) ** 2 + (P[3 * v + 1] - centre[1]) ** 2 + (P[3 * v + 2] - centre[2]) ** 2;
    for (let k = 0; k < 3; k++) { const v = I[3 * start + k]; if (!seen[v]) { seen[v] = 1; queue.push(v); } }
    const picked = [];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q], dd = d2(v);
      if (dd > r2) continue;
      picked.push(v); const u = Math.sqrt(dd) / radius; w.push((1 - u * u) ** 2);
      for (let e = adj.start[v]; e < adj.start[v + 1]; e++) { const n = adj.to[e]; if (!seen[n]) { seen[n] = 1; queue.push(n); } }
    }
    const allowed = (v) => { if (!mask) return true; for (let e = vt.start[v]; e < vt.start[v + 1]; e++) if (mask[vt.tri[e]]) return true; return false; };
    const moved = [], fn = [0, 0, 0];
    const normalAt = (v, out) => { out[0] = out[1] = out[2] = 0; for (let e = vt.start[v]; e < vt.start[v + 1]; e++) { faceNormal(P, I, vt.tri[e], fn); out[0] += fn[0]; out[1] += fn[1]; out[2] += fn[2]; } const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; return out; };
    const s = Math.max(0, Math.min(1, strength));
    if (mode === 'smooth') {
      const target = new Float64Array(picked.length * 3);
      for (let i = 0; i < picked.length; i++) { // the middle of the neighbours, from the positions before the dab
        const v = picked[i]; let x = 0, y = 0, z = 0, n = 0;
        for (let e = adj.start[v]; e < adj.start[v + 1]; e++) { const u = adj.to[e]; x += P[3 * u]; y += P[3 * u + 1]; z += P[3 * u + 2]; n++; }
        if (n) { target[3 * i] = x / n; target[3 * i + 1] = y / n; target[3 * i + 2] = z / n; } else { target[3 * i] = P[3 * v]; target[3 * i + 1] = P[3 * v + 1]; target[3 * i + 2] = P[3 * v + 2]; }
      }
      for (let i = 0; i < picked.length; i++) { const v = picked[i]; if (!allowed(v)) continue; const f = s * w[i] * 0.5; P[3 * v] += (target[3 * i] - P[3 * v]) * f; P[3 * v + 1] += (target[3 * i + 1] - P[3 * v + 1]) * f; P[3 * v + 2] += (target[3 * i + 2] - P[3 * v + 2]) * f; moved.push(v); }
    } else if (mode === 'flatten') {
      // the plane: the brush area's weighted middle and the mean of its normals
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, tw = 0; const nn = [0, 0, 0], N = [];
      for (let i = 0; i < picked.length; i++) { const v = picked[i]; normalAt(v, nn); N.push(nn[0], nn[1], nn[2]); cx += P[3 * v] * w[i]; cy += P[3 * v + 1] * w[i]; cz += P[3 * v + 2] * w[i]; nx += nn[0] * w[i]; ny += nn[1] * w[i]; nz += nn[2] * w[i]; tw += w[i]; }
      if (!(tw > 0)) return { moved: [], tris: [] };
      cx /= tw; cy /= tw; cz /= tw; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      for (let i = 0; i < picked.length; i++) { const v = picked[i]; if (!allowed(v)) continue; const h = (P[3 * v] - cx) * nx + (P[3 * v + 1] - cy) * ny + (P[3 * v + 2] - cz) * nz, f = s * w[i] * 0.5 * h; P[3 * v] -= nx * f; P[3 * v + 1] -= ny * f; P[3 * v + 2] -= nz * f; moved.push(v); }
    } else { // inflate
      const step = s * radius * 0.05 * (reverse ? -1 : 1), nn = [0, 0, 0], N = new Float64Array(picked.length * 3);
      for (let i = 0; i < picked.length; i++) { normalAt(picked[i], nn); N[3 * i] = nn[0]; N[3 * i + 1] = nn[1]; N[3 * i + 2] = nn[2]; } // normals from the positions before the dab
      for (let i = 0; i < picked.length; i++) { const v = picked[i]; if (!allowed(v)) continue; const f = step * w[i]; P[3 * v] += N[3 * i] * f; P[3 * v + 1] += N[3 * i + 1] * f; P[3 * v + 2] += N[3 * i + 2] * f; moved.push(v); }
    }
    const tset = new Set(); for (const v of moved) for (let e = vt.start[v]; e < vt.start[v + 1]; e++) tset.add(vt.tri[e]);
    return { moved, tris: [...tset] };
  }
  // Display arrays (as creasedArrays makes them) refreshed for a few triangles after their vertices moved: the
  // positions, and each corner's normal from the faces round its vertex within the crease angle.
  function refreshCreased(P, I, tris, pos, nor, creaseDeg) {
    const vt = vertexTriangles(P, I), cosT = Math.cos((creaseDeg * Math.PI) / 180), fn = [0, 0, 0], gn = [0, 0, 0];
    for (const t of tris) {
      faceNormal(P, I, t, fn); const l = Math.hypot(fn[0], fn[1], fn[2]) || 1, ux = fn[0] / l, uy = fn[1] / l, uz = fn[2] / l;
      for (let j = 0; j < 3; j++) {
        const vi = I[3 * t + j], o = 9 * t + 3 * j;
        pos[o] = P[3 * vi]; pos[o + 1] = P[3 * vi + 1]; pos[o + 2] = P[3 * vi + 2];
        let sx = 0, sy = 0, sz = 0;
        for (let e = vt.start[vi]; e < vt.start[vi + 1]; e++) { faceNormal(P, I, vt.tri[e], gn); const gl = Math.hypot(gn[0], gn[1], gn[2]) || 1; if ((gn[0] * ux + gn[1] * uy + gn[2] * uz) / gl >= cosT) { sx += gn[0]; sy += gn[1]; sz += gn[2]; } }
        const sl = Math.hypot(sx, sy, sz) || 1;
        nor[o] = sx / sl; nor[o + 1] = sy / sl; nor[o + 2] = sz / sl;
      }
    }
  }
  // Snap a selection to the surface regions: every region at least half painted (by area) is painted whole, the
  // rest is cleared, so a rough stroke lands on the regions' borders.
  function snapSelectionToRegions(P, I, sel, seg) {
    const nt = I.length / 3, painted = new Float64Array(seg.count), total = new Float64Array(seg.count);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), area = Math.hypot(n[0], n[1], n[2]) / 2, g = seg.groupOf[t];
      total[g] += area; if (sel[t]) painted[g] += area;
    }
    const out = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) { const g = seg.groupOf[t]; out[t] = total[g] > 0 && painted[g] >= 0.5 * total[g] ? 1 : 0; }
    return out;
  }
  // Grow a selection outward by `mm` across the surface (shrink: grow what isn't selected). Returns a new Uint8Array.
  function growSelection(P, I, sel, mm) {
    const { nb, C } = triangleAdjacency(P, I), nt = sel.length, dist = new Float64Array(nt).fill(Infinity), out = new Uint8Array(sel);
    const heap = [];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI][0] <= heap[i][0]) break; [heap[pI], heap[i]] = [heap[i], heap[pI]]; i = pI; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (let t = 0; t < nt; t++) if (sel[t]) { let edge = false; for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && !sel[q]) edge = true; } if (edge) { dist[t] = 0; push([0, t]); } }
    while (heap.length) {
      const [d, t] = pop();
      if (d > dist[t]) continue;
      for (let k = 0; k < 3; k++) {
        const q = nb[3 * t + k]; if (q < 0 || sel[q]) continue;
        const nd = d + Math.hypot(C[3 * q] - C[3 * t], C[3 * q + 1] - C[3 * t + 1], C[3 * q + 2] - C[3 * t + 2]);
        if (nd <= mm && nd < dist[q]) { dist[q] = nd; out[q] = 1; push([nd, q]); }
      }
    }
    return out;
  }
  function shrinkSelection(P, I, sel, mm) {
    const inv = new Uint8Array(sel.length); for (let t = 0; t < sel.length; t++) inv[t] = sel[t] ? 0 : 1;
    const grown = growSelection(P, I, inv, mm), out = new Uint8Array(sel.length);
    for (let t = 0; t < sel.length; t++) out[t] = grown[t] ? 0 : 1;
    return out;
  }
  // Tidy a selection's edge: drop tongues and fill notches narrower than 2·r (open, then close), so the outline is
  // something a cut can follow cleanly.
  function tidySelection(P, I, sel, r) {
    const opened = growSelection(P, I, shrinkSelection(P, I, sel, r), r);
    return shrinkSelection(P, I, growSelection(P, I, opened, r), r);
  }
  // Fill the gaps in a selection (the owner's "auto fill gaps between selected parts to complete the selection"):
  // first a closing (grown by `gap`, then shrunk by it, so channels and notches narrower than 2·gap between picked
  // pieces fill while the outline elsewhere stays put), then every unpicked patch the selection surrounds (a
  // component of the rest of the surface that isn't the biggest one, and is smaller than the selection) is filled
  // too: crevices, eye sockets, the gaps between straps. Returns the new selection and what it added.
  function fillSelectionGaps(P, I, sel, opts = {}) {
    const nt = I.length / 3, gap = Math.max(0, opts.gap || 0);
    const before = sel.reduce((a, v) => a + (v ? 1 : 0), 0);
    let out = gap > 0 ? shrinkSelection(P, I, growSelection(P, I, sel, gap), gap) : Uint8Array.from(sel);
    for (let t = 0; t < nt; t++) if (sel[t]) out[t] = 1; // a closing never drops what was picked
    // the unpicked patches, by connection across shared edges
    const area = new Float64Array(nt);
    for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]); area[t] = Math.hypot(n[0], n[1], n[2]) / 2; }
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const pairs = trianglePairs(I);
    for (let i = 0; i < pairs.length; i += 4) { const s = pairs[i], q = pairs[i + 1]; if (!out[s] && !out[q]) { const x = find(s), y = find(q); if (x !== y) par[x] = y; } }
    const comp = new Map(), touches = new Set(); let selArea = 0;
    for (let t = 0; t < nt; t++) { if (out[t]) { selArea += area[t]; continue; } const r = find(t); comp.set(r, (comp.get(r) || 0) + area[t]); }
    for (let i = 0; i < pairs.length; i += 4) { const s = pairs[i], q = pairs[i + 1]; if (out[s] !== out[q]) touches.add(find(out[s] ? q : s)); }
    // the outside is the biggest patch that borders the selection; patches that don't border it at all (another
    // loose piece, an inner shell) are left alone
    let biggest = -1, ba = -1; for (const r of touches) { const a = comp.get(r); if (a > ba) { ba = a; biggest = r; } }
    let holes = 0;
    const maxFill = opts.maxFrac > 0 ? opts.maxFrac * selArea : selArea; // (1.90) with maxFrac only holes under that share of the selection (gaps between fingers, not a hand on a book)
    const fill = new Set(); for (const r of touches) if (r !== biggest && comp.get(r) < maxFill) { fill.add(r); holes++; }
    if (fill.size) for (let t = 0; t < nt; t++) if (!out[t] && fill.has(find(t))) out[t] = 1;
    // only what joins up with the picked pieces stays: the closing can leave a stray bit in a crevice nearby
    { const q = new Int32Array(nt); let h = 0, tl = 0; const keep = new Uint8Array(nt);
      for (let t = 0; t < nt; t++) if (sel[t]) { keep[t] = 1; q[tl++] = t; }
      const nbr = triangleAdjacency(P, I).nb;
      while (h < tl) { const t = q[h++]; for (let k = 0; k < 3; k++) { const u = nbr[3 * t + k]; if (u >= 0 && out[u] && !keep[u]) { keep[u] = 1; q[tl++] = u; } } }
      for (let t = 0; t < nt; t++) if (out[t] && !keep[t]) out[t] = 0; }
    const after = out.reduce((a, v) => a + (v ? 1 : 0), 0);
    return { sel: out, added: after - before, holes };
  }
  // A painted selection as a two-region labelling (1 painted, 0 not), ready for splitRegions(..., [1], opts).
  function selectionSeg(P, I, sel) {
    const groupOf = new Int32Array(sel.length);
    let n = 0; for (let t = 0; t < sel.length; t++) { groupOf[t] = sel[t] ? 1 : 0; n += sel[t] ? 1 : 0; }
    if (!n) throw new Error('Nothing is painted yet. Drag over the part to paint the area to split off.');
    if (n === sel.length) throw new Error('The whole part is painted, so there is nothing to split it from. Erase some, or Clear and paint just the area to split off.');
    const seg = bordersFromGroups(P, I, groupOf);
    seg.areas = [0, 0];
    return seg;
  }
  function cutAlongLoop(P, I, loop, opts = {}) {
    const r = cutAlongLoops(P, I, [loop], opts);
    return { parts: r.parts, pins: r.pins, length: r.length, frame: r.frames[0], warnings: r.warnings, sinks: r.sinks, sink: r.sinks[0], floors: r.floors, plugsMade: r.plugsMade, jointsMade: r.jointsMade, sinkNote: r.sinkNote };
  }
  /* Cut along several closed lines at once. Side 1 is whatever lies on the left of the lines as they run (the
     triangles holding the lines' own directed edges); side 2 is the rest, and may come apart into several pieces.
     A single line splits a part in two; a region's whole outline, all its loops together, splits the region off
     even where the surface loops back on itself (an arm whose hand rests on the hip). Keys or a plug go on each
     line, from opts.keys and opts.plugs for one line or opts.perLoop[i] for several. */
  function cutAlongLoops(P, I, loopsIn, opts = {}) {
    const { loops, side } = orientLoops(P, I, loopsIn, opts);
    const nv = P.length / 3, nt = I.length / 3, rings = loops.map(l => l.verts), L = rings.length;
    const offs = []; let nn = nv; for (const r of rings) { offs.push(nn); nn += r.length; }
    const extra = nn, M = extra + 2 * L; // centre points for fans after the copies
    // side 2 gets its own copy of every line's vertices
    const copy = new Map();
    rings.forEach((ring, li) => ring.forEach((v, i) => copy.set(v, offs[li] + i)));
    const pos = new Array(M * 3).fill(0);
    for (let i = 0; i < P.length; i++) pos[i] = P[i];
    for (const [v, c] of copy) { pos[3 * c] = P[3 * v]; pos[3 * c + 1] = P[3 * v + 1]; pos[3 * c + 2] = P[3 * v + 2]; }
    const tris = [[], [], []];
    for (let t = 0; t < nt; t++) {
      const s = side[t];
      let a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      if (s === 2) { if (copy.has(a)) a = copy.get(a); if (copy.has(b)) b = copy.get(b); if (copy.has(c)) c = copy.get(c); }
      tris[s].push(a, b, c);
    }
    const ek = (a, b) => (a < b ? a * M + b : b * M + a);
    const surf = new Set(), along = new Set(); // the surface's edges on both sides, apart from the lines' own (the caps meet those)
    for (const ring of rings) for (let i = 0; i < ring.length; i++) along.add(ek(ring[i], ring[(i + 1) % ring.length]));
    const uncopy = new Map(); for (const [v, c] of copy) uncopy.set(c, v);
    const orig = (v) => (uncopy.has(v) ? uncopy.get(v) : v); // side 2's copies of the line points, by their original ids
    for (const s of [1, 2]) for (let i = 0; i < tris[s].length; i += 3) for (let k = 0; k < 3; k++) { const e = ek(orig(tris[s][i + k]), orig(tris[s][i + (k + 1) % 3])); if (!along.has(e)) surf.add(e); }
    const cfg = opts.cfg || { type: 'none' };
    // each line's cap: the line projected on its best-fit plane, triangulated with the same safeguards as flat cuts
    const caps = rings.map((ring, li) => {
      const n = ring.length, lf = loopFrame(P, ring), F = lf.F, xy = lf.xy;
      const ringXY = new Map(ring.map((v, i) => [v, [xy[2 * i], xy[2 * i + 1]]]));
      const keep = untangledRing(xy), flat = [], ids = [];
      for (const k of keep) { ids.push(ring[k]); flat.push(xy[2 * k], xy[2 * k + 1]); }
      // side 1 holds the line along its direction, so its cap must run the other way
      let area2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; area2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1]; }
      const wantCCW = !(area2 > 0);
      const loc = earcut(flat, []);
      let sum = 0; for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
      const flip = wantCCW ? sum < 0 : sum > 0, cap = [];
      for (let i = 0; i < loc.length; i += 3) { if (flip) cap.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]); else cap.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]); }
      fixTJunctions(cap, ring);
      const xyOf = (id) => ringXY.get(id);
      splitThroughPoints(cap, [ring], xyOf);
      patchCap(cap, [ring], xyOf, wantCCW);
      // Where the line passes close to itself, a cap edge between two of its points can double up an existing
      // edge of the surface (straightening removes most of these). If one would, or the line crosses itself when
      // flattened, the cap is fanned from a centre point instead: a fan only joins line points to the centre.
      let clash = keep.length < n;
      for (let i = 0; i < cap.length && !clash; i += 3) for (let k = 0; k < 3; k++) if (surf.has(ek(cap[i + k], cap[i + (k + 1) % 3]))) { clash = true; break; }
      const per = opts.perLoop ? opts.perLoop[li] || {} : opts, into2 = wantCCW ? 1 : -1;
      const lcfg = (per.inset || per.onEnd) && per.cfg ? per.cfg : per.pegSide && per.pegSide !== cfg.pegSide ? { ...cfg, pegSide: per.pegSide } : cfg; // which piece the pegs or plug stand on, per line (an inset plug brings its own settings)
      // a sunk face: the line pushed into side 2 by up to opts.sink, as far as that piece can hold; the face, its
      // keys and its checks then all work on the sunk ring
      const sinkWall = opts.minThickness > 0 ? opts.minThickness : cfg.margin || 0.8, taper = opts.sinkTaper !== undefined ? opts.sinkTaper : cfg.sinkTaper || 0;
      const sunk = !(opts.sink > 0) || (per.inset && !opts.sinkFlat && opts.sinkStep !== false) ? null : opts.sinkStep === false || opts.sinkFlat ? sunkRingAt(P, I, F, ring, xy, lf.h, into2, opts.sink, sinkWall, !!opts.sinkFlat, opts.sinkPlane || null) : sunkRing(P, I, F, ring, xy, lf.h, into2, opts.sink, sinkWall, false, null, taper);
      // every face carries its frame: a plug may run along another axis than its line's own (1.92: the pieces' one
      // pull direction), and the face, its walls, its cap and its checks are then all worked in that frame
      const own = { F, xy, h: lf.h, cap, clash, xyOf, wantCCW };
      const faceOf = (fxy, fh, fr) => { const sec = { loops: [makeLoop(ring, [], fxy)] }; sec.regions = buildRegions(sec.loops); return { xy: fxy, h: fh, sec, step: capStep(fxy), H: capHeight(fxy, fh), fr }; };
      const plain = faceOf(xy, lf.h, own), c = { ring, n, lf, F, xy, wantCCW, cap, clash, xyOf, into2, plain, cfg: lcfg, sunkFace: sunk ? Object.assign(faceOf(sunk.xy2, sunk.h2, own), { sunk }) : null, axisFace: null };
      // the plug along the axis e (a unit vector into side 2), or null where the line, seen along e, isn't a clean ring
      c.along = (e) => {
        if (!(opts.sink > 0) || opts.sinkStep === false || opts.sinkFlat) return null;
        const en = [into2 * e[0], into2 * e[1], into2 * e[2]]; // the frame's normal, on the same side as the line's own
        if (en[0] * F.n[0] + en[1] * F.n[1] + en[2] * F.n[2] < WAY_COS) return null; // more than 70° off the line's own axis (1.96: was 60°)
        const Fe = frameFromNormal(norm3(en), lf.centre), exy = new Float64Array(2 * n), eh = new Float64Array(n);
        for (let i = 0; i < n; i++) { const p = 3 * ring[i], d = [P[p] - Fe.o[0], P[p + 1] - Fe.o[1], P[p + 2] - Fe.o[2]]; exy[2 * i] = d[0] * Fe.u[0] + d[1] * Fe.u[1] + d[2] * Fe.u[2]; exy[2 * i + 1] = d[0] * Fe.v[0] + d[1] * Fe.v[1] + d[2] * Fe.v[2]; eh[i] = d[0] * Fe.n[0] + d[1] * Fe.n[1] + d[2] * Fe.n[2]; }
        let a2 = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += exy[2 * i] * exy[2 * j + 1] - exy[2 * j] * exy[2 * i + 1]; }
        if (!(a2 > 0) !== wantCCW || untangledRing(exy).length < n) return null; // turned over, or folded, seen along e
        const es = sunkRing(P, I, Fe, ring, exy, eh, into2, opts.sink, sinkWall, false, null, taper);
        if (!es || !es.column) return null;
        const ef = [], eids = []; for (let i = 0; i < n; i++) { eids.push(ring[i]); ef.push(exy[2 * i], exy[2 * i + 1]); }
        const eloc = earcut(ef, []), ecap = []; let esum = 0; for (let i = 0; i < eloc.length; i += 3) esum += tri2(ef, eloc[i], eloc[i + 1], eloc[i + 2]);
        const eflip = wantCCW ? esum < 0 : esum > 0; for (let i = 0; i < eloc.length; i += 3) { if (eflip) ecap.push(eids[eloc[i]], eids[eloc[i + 2]], eids[eloc[i + 1]]); else ecap.push(eids[eloc[i]], eids[eloc[i + 1]], eids[eloc[i + 2]]); }
        const exyMap = new Map(ring.map((v, i) => [v, [exy[2 * i], exy[2 * i + 1]]]));
        fixTJunctions(ecap, ring); splitThroughPoints(ecap, [ring], (id) => exyMap.get(id)); patchCap(ecap, [ring], (id) => exyMap.get(id), wantCCW);
        // (1.97) the plug on the extruded end, planned again on this face, standing along the same axis
        let endPlugs = null;
        if (per.onEnd && per.cfg) try {
          const L2 = makeLoop(ring, [], es.xy2), anE = { frame: Fe, base: { error: null, loops: [L2], regions: buildRegions([L2]) }, depth: [], curved: { deviation: 0, heightAt: capHeightGrid(es.xy2, es.h2), sink: es.max, into2, sunk: es } };
          Object.defineProperty(anE, '_src', { value: { P, I, F: Fe, scale: diag(bounds(P)), cfg: per.cfg, cache: new Map() } });
          Object.defineProperty(anE.curved, 'rays', { get() { return raysFor(P, I, Fe); } });
          const ecfg = { ...per.cfg, pegSide: curvedSideOf('below', into2) }, pl = planPlugs(anE, ecfg).filter(q => q.ok && q.depth >= 1);
          if (pl.length) endPlugs = { plugs: pl, cfg: ecfg };
        } catch (err) { endPlugs = null; }
        return Object.assign(faceOf(es.xy2, es.h2, { F: Fe, xy: exy, h: eh, cap: ecap, clash: false, xyOf: (id) => exyMap.get(id), wantCCW }), { sunk: es, endPlugs });
      };
      // (1.96) the locating boss for a line that can't carry a plug along the way the pieces go on: the face's own
      // shape pulled in from the edge (`planPlugs`), standing along the line's own axis, with sides drafted a little
      // more than the angle between that axis and the way `e`, so it lifts out along `e` (a cone frees along any
      // direction inside its own slope). Null where the way is more than 58° off, or nothing fits.
      const bossCache = new Map();
      c.boss = (e) => {
        if (per.tiny) return null;
        const cs = into2 * (e[0] * F.n[0] + e[1] * F.n[1] + e[2] * F.n[2]), phi = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
        if (phi > 60) return null;
        const draft = Math.min(64, Math.max(taper || 5, Math.ceil(phi + 3))), key = String(draft);
        if (bossCache.has(key)) return bossCache.get(key);
        const depth = opts.sink > 0 ? opts.sink : 0;
        const pcfg = { ...lcfg, type: 'plug', plugSlope: draft, plugSlopeMax: 64, ...(depth > 0 ? { plugDepthMode: 'set', plugDepth: Math.max(1, depth) } : { plugDepthMode: 'auto' }) };
        let out = null;
        try {
          const an = analyzeLoop(P, I, loops[li], { ...pcfg, sink: 0 }, diag(bounds(P)));
          const pl = planPlugs(an, pcfg).filter(q => q.ok);
          if (pl.length) { const H = an.curved.heightAt; out = { plugs: pl, cfg: pcfg, draft, draw: pl.map(q => { let lo = Infinity, hi = -Infinity; for (const [x, y] of q.mouth) { const z = H(x, y); lo = Math.min(lo, z); hi = Math.max(hi, z); } return { base: q.base, top: q.top, z0: q.side > 0 ? lo : hi, tip: (q.side > 0 ? hi : lo) + q.side * q.depth }; }) }; }
        } catch (err) { out = null; }
        bossCache.set(key, out);
        return out;
      };
      // which face, and which joints on it: 'own' (the keys or plug planned for this line, in its own frame), 'boss'
      // (`c.bossPlan`) or 'none'
      c.use = (which, joints = 'own') => {
        const f = which === 'sunk' && c.sunkFace ? c.sunkFace : which === 'axis' && c.axisFace ? c.axisFace : c.plain;
        Object.assign(c, { sec: f.sec, step: f.step, H: f.H, sunk: f.sunk || null, sink: f.sunk ? f.sunk.max : 0, F: f.fr.F, xy: f.fr.xy, h: f.fr.h, cap: f.fr.cap, clash: f.fr.clash, xyOf: f.fr.xyOf });
        const own = joints === 'own' && f.fr.F === lf.F; // (keys and plugs were planned in the line's own frame)
        c.cfg = lcfg;
        c.keys = !own || cfg.type === 'none' || cfg.type === 'plug' ? [] : (per.keys || []).filter(k => regionAt(f.sec, k.x, k.y) === 0); c.marks = f.fr.F !== lf.F ? [] : markKeys(per.marks).filter(k => regionAt(f.sec, k.x, k.y) === 0); /* (marks were laid out in the line's own frame: none on a face worked in another) */ c.plugs = own && (cfg.type === 'plug' || per.inset) ? (per.plugs || []).filter(q => q.ok) : [];
        c.bossUsed = null;
        if (joints === 'end' && per.onEnd) { // (1.97) the extruded end's own plug, and nothing else
          if (f === c.sunkFace && f.fr.F === lf.F) { c.plugs = (per.plugs || []).filter(q => q.ok); c.cfg = lcfg; }
          else if (f.endPlugs) { c.plugs = f.endPlugs.plugs; c.cfg = f.endPlugs.cfg; }
        }
        if (joints === 'boss' && c.bossPlan && f === c.plain) { c.plugs = c.bossPlan.plugs; c.cfg = c.bossPlan.cfg; c.bossUsed = c.bossPlan; c.marks = []; } // (a boss covers the face: no joint number under it)
        c.joined = c.keys.length + c.plugs.length;
      };
      c.tiny = !!per.tiny; c.way = null; c.bossPlan = null; c.endOK = !!per.onEnd && !per.endLow;
      c.use('sunk'); c.ownJoined = c.joined;
      return c;
    });
    const base1 = tris[1].length, base2 = tris[2].length;
    let pins = [];
    const makeParts = (fan, fine = true) => { // fan: per loop, fan the cap from a centre point; fine: draw caps as grids
      tris[1].length = base1; tris[2].length = base2; pins = [];
      let src = pos;
      caps.forEach((c, li) => {
        const { ring, n, F, xy, wantCCW, cap, sunk } = c;
        if (c.joined || c.marks.length) { const r = curvedLoopCap(src, tris, ring, copy, xy, c.h, F, wantCCW, c.keys.concat(c.marks), c.cfg, surf, ek, c.plugs, sunk, fine); src = r.V; pins.push(...r.pins); }
        else {
          const xyMap = new Map([[extra + 2 * li, null]]);
          // the new points on the face that follows the line, each with a copy for the other piece
          const addAt = (x, y, z) => { const q = [0, 1, 2].map(k => F.o[k] + F.u[k] * x + F.v[k] * y + F.n[k] * z), v1 = src.length / 3; src.push(q[0], q[1], q[2], q[0], q[1], q[2]); copy.set(v1, v1 + 1); return v1; };
          const addVertex = (x, y) => addAt(x, y, c.H(x, y));
          // a sunk face: the line's points pushed into side 2, with a wall from each line edge down to them; the cap
          // then spans the sunk ring
          let capRing = ring, lowOf = null;
          if (sunk) {
            const low = ring.map((v, i) => { const id = addAt(sunk.xy2[2 * i], sunk.xy2[2 * i + 1], sunk.h2[i]); xyMap.set(id, [sunk.xy2[2 * i], sunk.xy2[2 * i + 1]]); return id; });
            const steps = [ring, low];
            for (let s = 0; s + 1 < steps.length; s++) for (let i = 0; i < n; i++) {
              const a = steps[s][i], b = steps[s][(i + 1) % n], la = steps[s + 1][i], lb = steps[s + 1][(i + 1) % n];
              tris[1].push(b, a, la, b, la, lb); // against side 1's line edge a -> b, and along the sunk ring's la -> lb
              tris[2].push(copy.get(b), copy.get(la), copy.get(a), copy.get(b), copy.get(lb), copy.get(la));
            }
            lowOf = new Map(ring.map((v, i) => [v, low[i]]));
            capRing = low;
          }
          const xyOfCap = (id) => xyMap.get(id) || c.xyOf(id);
          let flatTris = lowOf ? cap.map(v => (lowOf.has(v) ? lowOf.get(v) : v)) : cap;
          if (fan[li]) {
            const c1 = extra + 2 * li, c2 = c1 + 1, [fx, fy] = fanCentre(c.xy), fz = sunk ? sunk.h2.reduce((s, v) => s + v, 0) / n : 0;
            const fc = [0, 1, 2].map(k => F.o[k] + F.u[k] * fx + F.v[k] * fy + F.n[k] * fz);
            for (const cc of [c1, c2]) { src[3 * cc] = fc[0]; src[3 * cc + 1] = fc[1]; src[3 * cc + 2] = fc[2]; }
            xyMap.set(c1, [fx, fy]); copy.set(c1, c2);
            flatTris = [];
            for (let i = 0; i < n; i++) { const a = capRing[i], b = capRing[(i + 1) % n]; flatTris.push(c1, b, a); } // runs against side 1's line, like the flat cap
          }
          // the grid cap is tried even where the plain cap would be fanned (its band may avoid the surface edge the
          // flat cap doubled); a band edge between two line points that still doubles a surface edge means the plain cap
          let grid = fine ? gridCap([capRing], xyOfCap, c.H, c.step, addVertex, xyMap, wantCCW) : null;
          if (grid) for (let i = 0; grid && i < grid.length; i += 3) for (let k = 0; k < 3; k++) { const a = grid[i + k], b = grid[i + (k + 1) % 3]; if (a < M && b < M && surf.has(ek(a, b))) { grid = null; break; } }
          const capTris = grid || flatTris;
          for (const v of capTris) tris[1].push(v);
          for (let i = 0; i < capTris.length; i += 3) tris[2].push(copy.get(capTris[i]), copy.get(capTris[i + 2]), copy.get(capTris[i + 1])); // the same cap, facing the other piece
        }
      });
      const build = (list) => {
        const map = new Map(), out = [], idx = new Uint32Array(list.length);
        for (let i = 0; i < list.length; i++) { const v = list[i]; let w = map.get(v); if (w === undefined) { w = out.length / 3; map.set(v, w); out.push(src[3 * v], src[3 * v + 1], src[3 * v + 2]); } idx[i] = w; }
        const positions = new Float32Array(out);
        return { positions, indices: idx, volume: volume(positions, idx), bbox: bounds(positions) };
      };
      const one = build(tris[1]), two = build(tris[2]);
      // with several lines, either side may come apart into separate pieces (two balls picked together leave the bar)
      const ones = L > 1 ? separateShells(one.positions, one.indices) : [], rest = L > 1 ? separateShells(two.positions, two.indices) : [];
      const firsts = ones.length ? ones : [one];
      for (const q of firsts) q.first = true;
      const parts = [...firsts, ...(rest.length ? rest : [two])];
      // other shells the lines never touched (eyes, separate pieces) stay with the piece around them, or the bigger one
      if (tris[0].length) {
        const loose = separateShells(...(() => { const m = build(tris[0]); return [m.positions, m.indices]; })());
        const shells = loose.length ? loose : [build(tris[0])];
        for (const sh of shells) {
          const c = sh.bbox.center;
          const inside = parts.filter(q => c.every((v, i) => v >= q.bbox.min[i] && v <= q.bbox.max[i]));
          const host = (inside.length ? inside : parts).reduce((x, y) => (inside.length ? (x.volume < y.volume ? x : y) : (x.volume > y.volume ? x : y)));
          const m = mergeMeshes([host, sh]);
          host.positions = m.positions; host.indices = m.indices; host.volume = volume(m.positions, m.indices); host.bbox = bounds(m.positions);
        }
      }
      return parts;
    };
    const buildParts = () => {
      let parts = makeParts(caps.map(c => c.clash));
      if (!parts.every(q => edgeReport(q.indices).closed)) parts = makeParts(caps.map(c => c.clash), false); // a grid cap didn't seal: plain caps (1.92: round keys and plugs too: a plug on a limb's flat end came out open and was dropped)
      const joined = caps.some(c => c.joined);
      if (!joined && caps.some(c => !c.clash) && !parts.every(q => edgeReport(q.indices).closed)) parts = makeParts(caps.map(() => true), false); // a flat cap didn't seal: fan them instead
      if (parts.every(q => edgeReport(q.indices).closed) && parts.some(q => !(q.volume > 0))) // a line rings a dip, so the "piece" would be empty air
        throw new Error('This line goes round a dip or hollow in the surface, so cutting along it wouldn’t free a solid piece. Pick a line round something that sticks out, like a limb or a sleeve.');
      for (const q of parts) if (!edgeReport(q.indices).closed || !(q.volume > 0)) throw new Error('Keymaster couldn’t make sealed pieces along this border. Try a nearby border, or a flat cut here.');
      return parts;
    };
    const tol = Math.max(1e-4, diag(bounds(P)) * 2e-6), WAY_COS = Math.cos(70 * Math.PI / 180);
    // The plugs, plan by plan, until the pieces pass (a lock, or a piece too thin, moves on to the next plan):
    // 1. each line's plug along its own axis, when the lines' axes agree (a plug only slides out straight, so plugs
    //    that point different ways always lock);
    // 2. (1.92) one pull direction: the pieces are built without plugs, the way they come apart is found
    //    (`pullWays`), and every line between them gets its plug along that way (an arm held at the shoulder and at
    //    the hand on the hip comes out between the two, so both plugs lean that way);
    // 3. the longest line's plug alone; 4. no plugs, where the refusal stands (or, forced, becomes a warning).
    const sunkCaps = caps.filter(c => c.sunkFace), axisOf = (c) => c.lf.F.n.map(x => x * c.into2);
    const agree = sunkCaps.every(a => sunkCaps.every(b => { const p = axisOf(a), q = axisOf(b); return p[0] * q[0] + p[1] * q[1] + p[2] * q[2] > Math.cos(Math.PI / 6); }));
    let parts = null, warnings, plainParts = null, sinkNote = null, lastFail = null;
    const attempt = (plan, canForce) => {
      caps.forEach((c, i) => c.use(plan[i][0], plan[i][1]));
      const bare = caps.every(c => c.F === c.lf.F && !c.sunk && !c.joined && !c.marks.length);
      const p = bare && plainParts ? plainParts : buildParts(); const w = checkPieces(p, canForce); parts = p; warnings = w; return true;
    };
    const soft = (e) => { if (e.code !== 'locked' && e.code !== 'thin') throw e; sinkNote = sinkNote || e.code; lastFail = e.code; return false; };
    const ownPlan = caps.map(c => [c.sunkFace ? 'sunk' : 'plain', 'own']), plainPlan = caps.map(() => ['plain', 'own']);
    const anyJoint = caps.some(c => c.sunkFace || c.ownJoined);
    let done = false;
    if (!anyJoint) done = attempt(plainPlan, true);
    if (!done && (agree || !sunkCaps.length)) try { done = attempt(ownPlan, false); } catch (e) { done = soft(e); }
    // (1.96) One way on for every line. The pieces are built bare, the ways they come apart are found (`pullWays`,
    // best for the lines taken together), and each line gets the best joint that lifts out along its way: its own
    // plug where the way lies inside the plug's taper, a plug along the way where the other piece holds one, else a
    // boss drafted past the angle between the two (`c.boss`). Before, a line more than 60° off the way, any line
    // whose plug didn't fit along it, and every line once keys were planned, was simply cut flat.
    if (!done && anyJoint && lastFail !== 'thin') {
      caps.forEach(c => c.use('plain', 'none')); plainParts = buildParts();
      const ways = pullWays(plainParts);
      let before = agree || !sunkCaps.length ? ownPlan.map(x => x.join()).join() + '|' + caps.map(() => 0).join('') : '';
      if (ways.some(Boolean)) for (const bossAll of [false, true]) {
        const plan = caps.map((c, i) => {
          const e = ways[i], q = axisOf(c); c.way = null; c.wayOff = null;
          if (!e) return ['plain', 'none'];
          const phi = Math.acos(Math.max(-1, Math.min(1, e[0] * q[0] + e[1] * q[1] + e[2] * q[2]))) * 180 / Math.PI; c.wayOff = phi;
          if (phi <= 3) return [c.sunkFace ? 'sunk' : 'plain', 'own']; // (its own axis, near enough: checked along it, with its keys)
          c.way = e;
          if (!bossAll && c.sunkFace && phi <= (c.sunkFace.sunk.taper || 0) - 2) return ['sunk', c.endOK ? 'end' : 'none'];
          if (!bossAll && (c.axisFace = c.along(e))) return ['axis', c.endOK ? 'end' : 'none'];
          if ((c.bossPlan = c.boss(e))) return ['plain', 'boss'];
          return ['plain', 'none'];
        });
        const sig = plan.map(x => x.join()).join() + '|' + caps.map(c => (c.way ? 1 : 0)).join('');
        if (sig === before || !plan.some(x => x[0] !== 'plain' || x[1] !== 'none')) { if (bossAll) break; continue; }
        before = sig;
        try { done = attempt(plan, false); } catch (e) { done = !e.code && plan.some(x => x[1] === 'boss') ? false : soft(e); } // (a boss plan that didn't seal is a failed plan: the later plans still run)
        if (done) break;
      }
      if (!done) caps.forEach(c => { c.way = null; c.wayOff = null; });
    }
    if (!done && sunkCaps.length > 1) { const longest = caps.indexOf(sunkCaps.reduce((b, c) => (c.xy.length > b.xy.length ? c : b))); try { done = attempt(caps.map((c, i) => [i === longest ? 'sunk' : 'plain', 'own']), false); } catch (e) { done = soft(e); } }
    if (!done) attempt(plainPlan, true);
    // (1.87) forced through a lock that no plan frees (a piece held at both ends): cut with the plugs after all, along
    // their own axes, since dropping them only brought the thin rims back
    if (opts.force && sunkCaps.length && caps.every(c => !c.sunk) && warnings && warnings.some(w => w.code === 'locked')) {
      const stepped = caps.map(c => [c.sunkFace && c.sunkFace.sunk.column ? 'sunk' : 'plain', 'own']);
      if (stepped.some(x => x[0] === 'sunk')) { const keep = { parts, warnings }; try { attempt(stepped, true); sinkNote = null; } catch (e) { caps.forEach(c => c.use('plain')); parts = keep.parts; warnings = keep.warnings; } }
    }
    if (caps.some(c => c.sunk)) sinkNote = null;
    parts.sort((x, y) => y.volume - x.volume);
    // each line's plug as it was made, in the model's own coordinates (the app draws it from these after the check)
    const plugsMade = caps.map(c => { if (!c.sunk || !c.sunk.column) return null; const F = c.F, at = (x, y, z) => [0, 1, 2].map(k => F.o[k] + F.u[k] * x + F.v[k] * y + F.n[k] * z); const floor = [], line = []; for (let i = 0; i < c.n; i++) { floor.push(...at(c.sunk.xy2[2 * i], c.sunk.xy2[2 * i + 1], c.sunk.h2[i])); const v = 3 * c.ring[i]; line.push(P[v], P[v + 1], P[v + 2]); } return { floor, line, depth: c.sunk.max, least: c.sunk.least || 0, flat: !!c.sunk.flatEnd, leveled: !!c.sunk.leveled, taper: c.sunk.taper || 0, axis: F.n.map(x => x * c.into2), shared: (!!c.axisFace && c.sunk === c.axisFace.sunk) || !!c.way }; });
    // (1.96) each line's joint as it was made: 'edge' (a plug from the cut's edge), 'skew' (one along the shared way),
    // 'boss' (a drafted boss, with its plan for the app to draw), 'plug' / 'keys' (as planned), or null with why
    const jointsMade = caps.map(c => {
      const v = 3 * c.ring[0], kind = c.sunk && c.sunk.column ? (c.axisFace && c.sunk === c.axisFace.sunk ? 'skew' : 'edge') : c.bossUsed ? 'boss' : c.plugs.length ? 'plug' : c.keys.length ? 'keys' : null;
      const j = { at: [P[v], P[v + 1], P[v + 2]], kind, keys: c.keys.length, endPlugs: c.sunk && c.sunk.column ? c.plugs.length : 0, off: c.way ? c.wayOff : 0 }; // (1.97) a plug standing on an extruded end
      if (c.bossUsed) Object.assign(j, { plugs: c.bossUsed.plugs, cfg: c.bossUsed.cfg, draft: c.bossUsed.draft, draw: c.bossUsed.draw, depth: Math.max(...c.bossUsed.plugs.map(q => q.depth)) });
      if (!kind) j.why = c.tiny ? 'tiny' : c.wayOff > 60 ? 'off' : 'room';
      return j;
    });
    return { parts, pins, length: loops.reduce((s, l) => s + l.length, 0), frames: caps.map(c => c.F), keys: caps.flatMap(c => c.keys), plugs: caps.flatMap(c => c.plugs), warnings, sinks: caps.map(c => c.sink), floors: caps.map(c => (c.sunk && c.sunk.plane) || null), plugsMade, jointsMade, sinkNote: sunkCaps.length && !caps.some(c => c.sunk) ? sinkNote || 'locked' : null };
    // the two pieces each line separates: side 1, and the piece of side 2 holding that line's copied vertices
    function pairsOf(parts) {
      const keyOf = (x, y, z) => `${x},${y},${z}`;
      const sets = parts.map(q => { const s = new Set(); for (let i = 0; i < q.positions.length; i += 3) s.add(keyOf(q.positions[i], q.positions[i + 1], q.positions[i + 2])); return s; });
      return (c) => {
        const k = keyOf(P[3 * c.ring[0]], P[3 * c.ring[0] + 1], P[3 * c.ring[0] + 2]);
        const mine = parts.find((q, i) => q.first && sets[i].has(k)), other = parts.find((q, i) => !q.first && sets[i].has(k));
        return [mine || parts.find(q => q.first), other || parts.find(q => !q.first)];
      };
    }
    // (1.92) Which way the pieces between each line come apart, without plugs: per line, a unit direction into side 2
    // along which its two pieces slide apart (far enough for the deepest plug between them), or null. The lines
    // between the same two pieces share one direction, tried in turn: the lines' axes taken together, each line's own,
    // then leaning up to 40° from them, and from one piece's middle to the other's.
    function pullWays(prts) {
      const pair = pairsOf(prts), out = caps.map(() => null), groups = new Map();
      caps.forEach((c, i) => { if (c.tiny || !(c.sunkFace || c.ownJoined || opts.sink > 0)) return; const [a, b] = pair(c), key = prts.indexOf(a) + ':' + prts.indexOf(b); if (!groups.has(key)) groups.set(key, { a, b, idx: [] }); groups.get(key).idx.push(i); });
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], ang = (p, q) => Math.acos(Math.max(-1, Math.min(1, dot(p, q)))) * 180 / Math.PI;
      for (const { a, b, idx } of groups.values()) {
        const axes = idx.map(i => axisOf(caps[i])), lens = idx.map(i => loops[i].length || 1), sum = [0, 0, 0];
        axes.forEach((e, k) => { for (let j = 0; j < 3; j++) sum[j] += e[j] * lens[k]; });
        const byLen = idx.map((i, k) => k).sort((x, y) => lens[y] - lens[x]);
        // how far off its own axis each line's own plug still lifts out: its taper, less a little
        const lean = idx.map(i => (caps[i].sunkFace ? Math.max(0, (caps[i].sunkFace.sunk.taper || 0) - 2) : 0));
        const cands = [];
        if (Math.hypot(...sum) > 1e-9) cands.push(norm3(sum));
        byLen.forEach(k => cands.push(axes[k]));
        // (1.96) each line's axis turned towards each other line's as far as its own plug's taper lets it go
        for (const k of byLen) for (const m of byLen) { if (m === k || lean[k] < 4) continue; const W = ang(axes[k], axes[m]) * Math.PI / 180; if (W < 0.05) continue; for (const f of [0.95, 0.6]) { const t = Math.min(W, f * lean[k] * Math.PI / 180), s1 = Math.sin(W - t) / Math.sin(W), s2 = Math.sin(t) / Math.sin(W); cands.push(norm3([0, 1, 2].map(j => axes[k][j] * s1 + axes[m][j] * s2))); } }
        if (axes.length > 1) { const un = [0, 0, 0]; axes.forEach(e => { for (let j = 0; j < 3; j++) un[j] += e[j]; }); if (Math.hypot(...un) > 1e-9) { const u = norm3(un); cands.push(u); for (const f of [0.33, 0.67]) cands.push(norm3([0, 1, 2].map(j => u[j] * f + cands[0][j] * (1 - f)))); } }
        const base = cands[0], F0 = frameFromNormal(base, [0, 0, 0]);
        for (const deg of [20, 40]) for (let k = 0; k < 8; k++) { const t = (k * Math.PI) / 4, s = Math.sin((deg * Math.PI) / 180), co = Math.cos((deg * Math.PI) / 180); cands.push([0, 1, 2].map(j => F0.n[j] * co + (F0.u[j] * Math.cos(t) + F0.v[j] * Math.sin(t)) * s)); }
        const ma = volumeCentroid(a.positions, a.indices).centroid, mb = volumeCentroid(b.positions, b.indices).centroid, ap = [mb[0] - ma[0], mb[1] - ma[1], mb[2] - ma[2]];
        if (Math.hypot(...ap) > 1e-9) cands.push(norm3(ap));
        const deep = Math.max(3, ...idx.map(i => ((caps[i].sunkFace ? caps[i].sunkFace.sunk.max : opts.sink) || 0) + 1));
        // the way that gives the most lines a joint comes first, then the better joints (a line's own plug or keys
        // count 3, a plug or boss up to 45° off 2, a shallow boss up to 58° off 1), then the longest line's
        const score = (e) => { let n = 0, sc = 0, first = 0; idx.forEach((i, k) => { const phi = ang(e, axes[k]), c = caps[i]; const p = (c.sunkFace || c.ownJoined) && phi <= Math.max(3, lean[k]) ? 3 : phi <= 45 ? 2 : phi <= 60 ? 1 : 0; if (p) n++; sc += p; if (k === byLen[0]) first = p; }); return [n, sc, first]; };
        const order = cands.map((e0, k) => { const e = dot(e0, base) < 0 ? e0.map(x => -x) : e0; return { e, k, s: score(e) }; }).filter(x => x.s[0] > 0) // (the plugs point into side 2)
          .sort((x, y) => y.s[0] - x.s[0] || y.s[1] - x.s[1] || y.s[2] - x.s[2] || x.k - y.k);
        let tries = 0;
        for (const { e } of order) {
          if (++tries > 10) break;
          if (!slidesApart(a, b, e, tol, deep, 0.2)) continue;
          for (const i of idx) out[i] = e;
          break;
        }
      }
      return out;
    }
    // The printability rules on the pieces: a refusal, or with opts.force (the owner's "cut anyway") a warning on the
    // result. Thrown (never a warning) while a sink plan can still be retried.
    function checkPieces(parts, canForce) {
    const pair = pairsOf(parts); // the two pieces each line separates
    const warnings = [], refuse = (message, code, wedged, keyless) => { if (opts.force && canForce) { if (!warnings.some(w => w.code === code)) { const w = { code, message }; if (wedged) w.wedged = true; if (keyless) w.keyless = true; warnings.push(w); } return; } throw guardError(message, code); };
    for (const c of caps) {
      const [p1, p2] = pair(c), F = c.F;
      if (opts.minThickness > 0) { // neither piece may be too thin to print where they meet
        const th0 = opts.minThickness, pts = regionSamples(c.sec, 0, 300), th = jointThickness(p1, p2, F, pts, tol), area = c.sec.regions[0].area, cellArea = area / pts.length;
        for (const s of ['a', 'b']) {
          let n = 0, thin = 0, inner = 0;
          th.forEach((q, i) => { if (!q) return; n++; if (q[s] < th0) { thin++; if (pts[i].clear >= th0) inner++; } });
          if (n && (thin === n || inner * cellArea >= Math.max(Math.PI * th0 * th0, 0.4 * area)))
            refuse(`Cutting along this line would leave a piece thinner than ${+th0.toFixed(2)} mm, too thin to print. Pick a line round something thicker, or a flat cut here.`, 'thin');
        }
      }
      const mid = [p1, p2].map(q => volumeCentroid(q.positions, q.indices).centroid), apart = [0, 1, 2].map(k => mid[1][k] - mid[0][k]);
      // the other lines between these same pieces (an arm held at the shoulder and at the hand on the hip): a piece held
      // at both ends may still come out along one of its joints, or between them, so those directions are tried too
      const same = L > 1 ? caps.filter(d => d !== c && (([a, b]) => a === p1 && b === p2)(pair(d))) : [];
      const also = (Math.hypot(...apart) > 1e-9 ? [apart] : []).concat(same.flatMap(d => [d.F.n, d.F.n.map(x => -x)]));
      for (const d of same) if (d.way) also.push(d.way); // (1.96) the one way on found for the lines between these pieces
      if (same.length) { const sum = [0, 0, 0]; for (const d of [c, ...same]) for (let k = 0; k < 3; k++) sum[k] += d.into2 * d.F.n[k]; if (Math.hypot(...sum) > 1e-9) also.push(sum); }
      // (1.92) a plug is a key: it only slides out straight along its axis, and only once it has come all the way out
      const plugged = !!(c.sunk && c.sunk.column);
      const dir = c.way || F.n; // (1.96) a joint made to lift out along the pieces' one way on is checked along that way
      if (lockedPairs([p1, p2], dir, tol, { anyDirection: !c.joined && !plugged, distance: Math.max(pullDistance(c.cfg, c.keys, c.plugs), plugged ? c.sink + 1 : 0), also }).length) {
        const wedged = same.length > 0; // held at both ends by one piece (a shin between the thigh and a shoe that stands on the same base)
        // with keys the pieces must slide straight; would they come apart at a slant without them? Asked of these
        // same pieces, so a pick needn't build them all again without keys just to find out (half a neck pick's time)
        const keyless = c.joined && opts.force && !lockedPairs([p1, p2], dir, tol, { anyDirection: true, distance: 3, also }).length;
        refuse(wedged ? `This piece is held in ${same.length + 1} places by the same neighbour, and no one direction frees them all, so it couldn’t be fitted back on after printing. Split off one of its neighbours first, or pick it in smaller parts held in one place each, or cut it anyway.`
          : c.joined ? 'With keys, the pieces would have to slide straight apart, and here they’d catch on each other.'
          : 'The pieces on each side of this line would hook round each other, so they couldn’t be put together after printing. Pick a different line, or use a flat cut here.', 'locked', wedged, keyless);
      }
    }
    // which way each piece pulls away from the others: along the lines' frame normals, away from the piece across
    // each line (the exploded view moves pieces this way)
    for (const q of parts) { let s = [0, 0, 0]; for (const c of caps) { const [p1, p2] = pair(c); const sg = q === p1 ? -c.into2 : q === p2 ? c.into2 : 0; if (sg) for (let k = 0; k < 3; k++) s[k] += sg * c.F.n[k]; } const L = Math.hypot(...s); q.pull = L > 1e-9 ? s.map(v => v / L) : null; }
    return warnings;
    }
  }
  // The keyed cap for a curved cut: the face that follows the line (capHeight), with a hole per key, made once and
  // shared by both pieces so they meet exactly. Round each key's socket outline the face is the same on both sides;
  // inside it, the peg's piece has a narrow ring of face out to the peg (the fit gap) and then the peg, and the
  // socket's piece has the socket. Keys are straight, along the plane's normal, sized as keyLevels describes.
  function curvedLoopCap(pos, tris, ring, copy, xy0, hts0, F, wantCCW1, keys, cfg, surf, ek, plugs = [], sunk = null, drawFine = true) {
    const V = Array.from(pos), n = ring.length;
    const addV = (q) => { V.push(q[0], q[1], q[2]); return V.length / 3 - 1; };
    const at = (x, y, z) => [F.o[0] + F.u[0] * x + F.v[0] * y + F.n[0] * z, F.o[1] + F.u[1] * x + F.v[1] * y + F.n[1] * z, F.o[2] + F.u[2] * x + F.v[2] * y + F.n[2] * z];
    const posOf = (i) => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    const xy = sunk ? sunk.xy2 : xy0, hts = sunk ? sunk.h2 : hts0; // on a sunk face everything sits on the sunk ring
    const H = capHeight(xy, hts);
    const sec = { loops: [makeLoop(ring, [], xy)] }; sec.regions = buildRegions(sec.loops);
    const sgOf = (s) => ((s === 1 ? wantCCW1 : !wantCCW1) ? -1 : 1); // which way each piece's material lies
    const pegSide = cfg.pegSide === 'above' ? +1 : -1, pins = [];
    // microscopic folds in the flattened line are snipped out (and stitched back in after), as on flat cuts; a line
    // that really crosses over itself can't carry keys
    const keep = untangledRing(xy);
    if (keep.length < n) {
      const area = (idx) => { let s = 0; for (let i = 0; i < idx.length; i++) { const a = idx[i], b = idx[(i + 1) % idx.length]; s += xy[2 * a] * xy[2 * b + 1] - xy[2 * b] * xy[2 * a + 1]; } return Math.abs(s) / 2; };
      const kept = area(keep), full = area([...Array(n).keys()]);
      if (Math.abs(full - kept) > Math.max(0.01 * kept, 0.05)) throw new Error('This line crosses over itself when flattened, so keys can’t sit on it.');
    }
    // the shared face: the line, with each key's socket outline as a hole
    const flat = [], ids = [], holes = [], ringXY = new Map(), other = new Map();
    for (let i = 0; i < n; i++) { ringXY.set(ring[i], [xy0[2 * i], xy0[2 * i + 1]]); other.set(ring[i], copy.get(ring[i])); }
    // a sunk face: the line's points pushed into side 2, with a wall from each line edge down to them
    let capRing = ring;
    if (sunk) {
      const low = ring.map((v, i) => { const q = at(xy[2 * i], xy[2 * i + 1], hts[i]), v1 = addV(q), v2 = addV(q); other.set(v1, v2); ringXY.set(v1, [xy[2 * i], xy[2 * i + 1]]); return v1; });
      const steps = [ring, low];
      for (let s = 0; s + 1 < steps.length; s++) for (let i = 0; i < n; i++) {
        const a = steps[s][i], b = steps[s][(i + 1) % n], la = steps[s + 1][i], lb = steps[s + 1][(i + 1) % n];
        tris[1].push(b, a, la, b, la, lb);
        tris[2].push(other.get(b), other.get(la), other.get(a), other.get(b), other.get(lb), other.get(la));
      }
      capRing = low;
    }
    const rings = [capRing];
    for (const q of keep) { ids.push(capRing[q]); flat.push(xy[2 * q], xy[2 * q + 1]); }
    // every key or plug as four outlines: the socket's mouth and the peg's base on the face, the peg's end and the
    // socket's floor; with its length and each socket's depth
    const items = keys.map(k => {
      k.cfg = keyCfg(cfg, k); k.spec = keyGeometrySpec(k.cfg); k.angle = keyAngle(sec, 0, k.cfg);
      const ks = k.spec, at2 = (prof) => prof.map(([px, py]) => [k.x + px, k.y + py]);
      if (k.mark) { const prof = at2(keyProfile('bar', ks.r, 0, k.angle, ks.res)); return Object.assign(k, { mouth2: prof, base2: prof, end2: prof, floor2: prof, len: k.cfg.length, gap: 0, depthOn: () => k.cfg.length }); }
      return Object.assign(k, { mouth2: at2(keyProfile(ks.shape, ks.r, ks.cs, k.angle, ks.res)), base2: at2(keyProfile(ks.shape, ks.r, 0, k.angle, ks.res)), end2: at2(keyProfile(ks.shape, ks.r * ks.taper, 0, k.angle, ks.res)), floor2: at2(keyProfile(ks.shape, ks.r * ks.sockTip, ks.cs, k.angle, ks.res)), len: k.cfg.length, gap: ks.cs, depthOn: (sg) => (ks.sockets.find(q => q.side === sg) || { depth: k.cfg.length + ks.ca }).depth });
    }).concat(plugs.filter(q => q.ok).map(q => ({ x: q.x, y: q.y, plug: true, mouth2: q.mouth, base2: q.base, end2: q.top, floor2: q.floor, len: q.depth, gap: cfg.clearance, depthOn: () => q.depth + q.ca })));
    for (const k of items) {
      k.sock = k.mouth2.map(([x, y]) => ({ x, y, z: H(x, y) }));
      k.peg = k.base2.map(([x, y]) => ({ x, y, z: H(x, y) }));
      let lo = H(k.x, k.y), hi = lo;
      for (const q of k.sock.concat(k.peg)) { lo = Math.min(lo, q.z); hi = Math.max(hi, q.z); }
      k.lo = lo; k.hi = hi;
      k.ids = { 1: k.sock.map(q => addV(at(q.x, q.y, q.z))), 2: k.sock.map(q => addV(at(q.x, q.y, q.z))) };
      k.ids[1].forEach((v, i) => { ringXY.set(v, [k.sock[i].x, k.sock[i].y]); other.set(v, k.ids[2][i]); });
      rings.push(k.ids[1]); holes.push(ids.length);
      k.ids[1].forEach((v, i) => { ids.push(v); flat.push(k.sock[i].x, k.sock[i].y); });
    }
    const loc = earcut(flat, holes);
    let sum = 0; for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
    const flip = wantCCW1 ? sum < 0 : sum > 0, cap = [];
    for (let i = 0; i < loc.length; i += 3) { if (flip) cap.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]); else cap.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]); }
    for (const r of rings) fixTJunctions(cap, r);
    const xyOf = (v) => ringXY.get(v);
    splitThroughPoints(cap, rings, xyOf);
    patchCap(cap, rings, xyOf, wantCCW1);
    for (let i = 0; i < cap.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = cap[i + k], b = cap[i + (k + 1) % 3];
      if (a < pos.length / 3 && b < pos.length / 3 && surf.has(ek(a, b))) throw new Error('The face across this line would run along the surface, so keys can’t sit on it.');
    }
    // the face drawn finely, so it follows the line smoothly between the rims
    const xyMap = new Map(), addVertex = (x, y) => { const z = H(x, y), v1 = addV(at(x, y, z)), v2 = addV(at(x, y, z)); other.set(v1, v2); return v1; };
    let fine = drawFine ? gridCap(rings, xyOf, H, capStep(xy), addVertex, xyMap, wantCCW1) : null;
    if (fine) for (let i = 0; fine && i < fine.length; i += 3) for (let k = 0; k < 3; k++) { const a = fine[i + k], b = fine[i + (k + 1) % 3]; if (a < pos.length / 3 && b < pos.length / 3 && surf.has(ek(a, b))) { fine = null; break; } }
    if (!fine) fine = cap;
    for (const v of fine) tris[1].push(v);
    for (let i = 0; i < fine.length; i += 3) tris[2].push(other.get(fine[i]), other.get(fine[i + 2]), other.get(fine[i + 1])); // the same face, facing the other piece
    for (const s of [1, 2]) {
      const T = tris[s], sg = sgOf(s), nrm = F.n;
      const pushOriented = (a, b, c, e) => {
        const A = posOf(a), B = posOf(b), C = posOf(c);
        const nn = cross3([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
        if (nn[0] * e[0] + nn[1] * e[1] + nn[2] * e[2] < 0) T.push(a, c, b); else T.push(a, b, c);
      };
      const face = [-sg * nrm[0], -sg * nrm[1], -sg * nrm[2]]; // the face looks away from this piece's material
      for (const k of items) {
        const sock = k.ids[s];
        // a tube from a rim on the face to a flat end at height z: walls that face along their own edges (out of a
        // peg or plug, into a socket), so any outline works, and the end triangulated flat
        const tube = (rim, rimXY, endXY, z, dir, role) => {
          const end = endXY.map(([x, y]) => addV(at(x, y, z))), m = rim.length, ccw = outlineArea(rimXY) > 0, w = role === 'peg' ? 1 : -1;
          for (let i = 0; i < m; i++) {
            const j = (i + 1) % m, dx = rimXY[j][0] - rimXY[i][0], dy = rimXY[j][1] - rimXY[i][1];
            const ox = (ccw ? dy : -dy) * w, oy = (ccw ? -dx : dx) * w, e = [F.u[0] * ox + F.v[0] * oy, F.u[1] * ox + F.v[1] * oy, F.u[2] * ox + F.v[2] * oy];
            pushOriented(rim[i], rim[j], end[j], e); pushOriented(rim[i], end[j], end[i], e);
          }
          T.push(...endCap(end, endXY, (role === 'peg' ? dir : -dir) > 0));
        };
        if (!k.mark && (cfg.type === 'peg' || k.plug) && sg === pegSide) {
          // the fit gap: a ring of face from the socket outline in to the peg (none with no gap), then the peg itself
          const peg = k.gap > 1e-9 ? k.peg.map(q => addV(at(q.x, q.y, q.z))) : sock, m = peg.length;
          if (peg !== sock) for (let i = 0; i < m; i++) { const j = (i + 1) % m; pushOriented(sock[i], sock[j], peg[j], face); pushOriented(sock[i], peg[j], peg[i], face); }
          const S = -sg, tip = (S > 0 ? k.hi : k.lo) + S * k.len;
          tube(peg, k.gap > 1e-9 ? k.base2 : k.mouth2, k.end2, tip, S, 'peg');
        } else {
          const floor = (sg > 0 ? k.hi : k.lo) + sg * k.depthOn(sg);
          tube(sock, k.mouth2, k.floor2, floor, sg, 'socket');
        }
      }
    }
    if (cfg.type === 'dowel') for (const k of keys) { if (k.mark) continue; const zc = (k.lo + k.hi) / 2; pins.push(makePin((x, y, z) => at(x, y, z + zc), k, k.spec, k.cfg.length)); }
    return { V, pins };
  }

  /* ---------- splitting off a region ----------
     What ZBrush and Meshmixer do with a selected group: the region becomes its own piece, cut along its whole
     outline. The outline may be several loops (an arm has a shoulder loop and a cuff loop), so the cuts go one
     loop at a time, each on the piece that still holds the region, with that loop's own keys or plug. */
  function regionLoops(P, I, seg, g) { return regionOutlines(P, I, seg).filter(l => l.region === g); }
  function splitRegion(P, I, seg, g, opts = {}) { return splitRegions(P, I, seg, [g], opts); }
  // The outline of several regions taken together (a head as its face, hair and collar): the borders between them
  // drop out, so the loops go round the lot.
  function groupLoops(P, I, seg, groups) {
    if (groups.length === 1) return regionLoops(P, I, seg, groups[0]);
    const set = new Set(groups), g0 = groups[0], merged = new Int32Array(seg.groupOf.length);
    for (let t = 0; t < merged.length; t++) merged[t] = set.has(seg.groupOf[t]) ? g0 : seg.groupOf[t];
    return regionLoops(P, I, bordersFromGroups(P, I, merged), g0);
  }
  // Split off one region, or several as one piece, along their whole outline. The piece (or pieces, when the
  // regions chosen don't touch) comes first.
  function splitRegions(P, I, seg, groups, opts = {}) {
    const loops = groupLoops(P, I, seg, groups), one = groups.length === 1;
    if (!loops.length) throw new Error(one ? 'This region covers the whole surface, so there is nothing to split it from.' : 'These regions cover the whole surface, so there is nothing to split them from.');
    if (loops.some(l => !l.closed)) throw new Error(`${one ? 'This region’s' : 'These regions’'} outline pinches to a point somewhere, so it can’t be cut along cleanly. Try a different fold angle.`);
    // separate pieces of the model wholly inside the pick (the owner's Bills: a forearm, its cuff and the hand are
    // pieces of their own pushed into each other) have no line to cut along, so the cut took only the shoulder and
    // left the rest of the arm on the body. They are set aside, the rest is cut, and they go with the regions' piece.
    if (!opts.noLoose) {
      const comps = shellComponents(P, I), set = new Set(groups), nt = I.length / 3;
      const whole = new Uint8Array(comps.count).fill(1), any = new Uint8Array(comps.count);
      for (let t = 0; t < nt; t++) { const c = comps.label[t]; any[c] = 1; if (!set.has(seg.groupOf[t])) whole[c] = 0; }
      const loose = []; for (let c = 0; c < comps.count; c++) if (any[c] && whole[c]) loose.push(c);
      if (loose.length && loose.length < comps.count) {
        const isLoose = new Uint8Array(comps.count); for (const c of loose) isLoose[c] = 1;
        const keep = new Uint8Array(nt), aside = new Uint8Array(nt), groupOf = [];
        for (let t = 0; t < nt; t++) { if (isLoose[comps.label[t]]) aside[t] = 1; else { keep[t] = 1; groupOf.push(seg.groupOf[t]); } }
        const rest = extractTriangles(P, I, keep), off = extractTriangles(P, I, aside);
        const rseg = bordersFromGroups(rest.positions, rest.indices, Int32Array.from(groupOf));
        if (groups.some(g => rseg.groupOf.includes(g))) {
          let perLoop = opts.perLoop;
          if (perLoop) { // each line's joints follow it, whatever order the lines come in now
            const key = (Q, v) => `${Q[3 * v]},${Q[3 * v + 1]},${Q[3 * v + 2]}`;
            const own = loops.map(l => new Set(l.verts.map(v => key(P, v))));
            const rl = groupLoops(rest.positions, rest.indices, rseg, groups.filter(g => rseg.groupOf.includes(g)));
            perLoop = rl.map(l => { const k = key(rest.positions, l.verts[0]), i = own.findIndex(o => o.has(k)); return i >= 0 ? perLoop[i] : { keys: [], plugs: [] }; });
          }
          const r = splitRegions(rest.positions, rest.indices, rseg, groups.filter(g => rseg.groupOf.includes(g)), { ...opts, perLoop, noLoose: true });
          const m = mergeMeshes([r.parts[0], off]);
          r.parts[0] = { ...r.parts[0], positions: m.positions, indices: m.indices, volume: r.parts[0].volume + off.volume };
          return { ...r, loose: loose.length };
        }
      }
    }
    const r = cutAlongLoops(P, I, loops, { ...opts, what: 'region' });
    r.parts = [...r.parts.filter(q => q.first), ...r.parts.filter(q => !q.first)]; // the regions' own piece (or pieces, when they don't touch) first
    for (const q of r.parts) delete q.first;
    return { ...r, loops: loops.length };
  }
  /* ---------- a whole pick, as plain data ----------
     Everything the app does when a region or a line is picked: the lines turned to agree, the analysis of each
     line, its keys or plug, the joint numbers, and the cut with its fallbacks (without the joints when they won't
     fit, then forced when the refusal is one that may be overridden). It returns only plain data (no analyses,
     which carry functions), so it can run in a Web Worker: the owner's 352k-triangle figure froze for half a
     minute on a refused pick, which ran the cut three times on the main thread. The markers are drawn from
     `draw`: per line, each key with its angle and levels, each plug with its two heights.
     req: { loops, regions, seg, painted, lines, cfg, minThickness, sink, sizeSet, perArea, numberJoints, joint } */
  // A copy of a result fit to send from a Web Worker: functions dropped (keys carry a depthOn helper once cut),
  // typed arrays kept as they are, shared objects copied once
  function plainData(x, seen = new Map()) {
    if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
    if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return x;
    if (seen.has(x)) return seen.get(x);
    if (Array.isArray(x)) { const out = new Array(x.length); seen.set(x, out); for (let i = 0; i < x.length; i++) out[i] = plainData(x[i], seen); return out; }
    if (x instanceof Map || x instanceof Set) return x; // cloneable as they are (none here holds functions)
    const out = {}; seen.set(x, out);
    for (const k of Object.keys(x)) { const v = x[k]; if (typeof v !== 'function') out[k] = plainData(v, seen); }
    return out;
  }
  function curvedSideOf(pref, into2) { return (pref === 'below') === (into2 > 0) ? 'below' : 'above'; }
  // The joints alone, the quick first half of a pick (the app draws them while the cut is checked: on a big
  // figure the owner saw no keys for the many seconds the check took): the lines oriented, each line's frame,
  // keys or plug, joint marks and what to draw. `planPick(P, I, { ...req, planned })` goes on from it.
  // A region pick with its outline re-routed smooth (the owner's Aysil: region outlines wander in steps and notches
  // a millimetre or so across, and the cut face and its sunk wall followed every one, so the pieces caught instead
  // of sliding together). Each outline is turned into handles about 1/40 of its length apart (never closer than
  // four of the mesh's edges), the handles eased (`smoothHandles`, three passes) and joined again along the surface
  // (`drawnLoop`); the pick becomes the side of the new lines holding most of what was picked, plus any loose piece
  // wholly in the pick. Returns { seg, groups: [1], loops } or null (a line that wouldn't close, or nothing gained).
  function smoothRegionPick(P, I, seg, groups) {
    const loops = groupLoops(P, I, seg, groups);
    if (!loops.length || loops.some(l => !l.closed)) return null;
    const nt = I.length / 3, set = new Set(groups), L = [];
    for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 4000))) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
    L.sort((x, y) => x - y); const med = L[L.length >> 1] || 1;
    const out = [];
    for (const l of loops) {
      const spacing = Math.max(4 * med, l.length / 40), n = Math.round(l.length / spacing);
      if (n < 8) { out.push(l); continue; } // too short to ease: kept as it is
      const d = drawnLoop(P, I, smoothHandles(P, loopHandles(P, l, n), 3));
      if (!d || !d.closed || d.verts.length < 3) return null;
      out.push(d);
    }
    let side; try { side = orientLoops(P, I, out, { what: 'lines' }).side; } catch (err) { return null; }
    const comps = shellComponents(P, I), whole = new Uint8Array(comps.count).fill(1);
    for (let t = 0; t < nt; t++) if (!set.has(seg.groupOf[t])) whole[comps.label[t]] = 0;
    let in1 = 0, in2 = 0; for (let t = 0; t < nt; t++) if (set.has(seg.groupOf[t])) { if (side[t] === 1) in1++; else if (side[t] === 2) in2++; }
    const keep = in1 >= in2 ? 1 : 2, groupOf = new Int32Array(nt);
    for (let t = 0; t < nt; t++) groupOf[t] = side[t] === keep || whole[comps.label[t]] ? 1 : 0;
    // scraps the new lines pinch off (a sliver between the old outline and the new) go to the side round them
    const pairs = trianglePairs(I), par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < pairs.length; i += 4) { const a = pairs[i], b = pairs[i + 1]; if (groupOf[a] === groupOf[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
    const size = new Map(); let n1 = 0; for (let t = 0; t < nt; t++) { const r = find(t); size.set(r, (size.get(r) || 0) + 1); n1 += groupOf[t]; }
    const tiny = Math.max(8, 0.02 * Math.min(n1, nt - n1));
    for (let t = 0; t < nt; t++) if (size.get(find(t)) < tiny && !whole[comps.label[t]]) groupOf[t] = 1 - groupOf[t];
    n1 = 0; for (let t = 0; t < nt; t++) n1 += groupOf[t];
    if (!n1 || n1 === nt) return null;
    const s2 = bordersFromGroups(P, I, groupOf), l2 = groupLoops(P, I, s2, [1]);
    if (!l2.length || l2.some(l => !l.closed)) return null;
    return { seg: s2, groups: [1], loops: l2 };
  }
  // The surface sliced along the zero level of a field over its vertices (`f`, never exactly 0): each crossed edge
  // gets one new vertex, 12% to 88% along it and computed from its lower-numbered end, so the two triangles beside it
  // share it and the surface stays sealed with the same volume; each crossed triangle becomes three. Returns the new
  // positions and indices and, per triangle, 1 where f > 0.
  // The vertices of a pick's outline that sit on a sharp edge (the surface turning at least `deg` across the border
  // edge there, or a hard surface meeting an organic one): a seam a smoothed or eased line must never leave. The
  // owner's book on a robe: the region was right, but the slice that follows a click blurred across the seam and
  // took a strip of robe with the book. `edges` are [t1, t2, va, vb] quads (as `seg.borders`), `hard` per triangle.
  function sharpEdgeVertices(P, I, edges, keep, deg = 25, hard = null) {
    const out = new Set(), cosD = Math.cos((deg * Math.PI) / 180);
    const nrm = (t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]); const L = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / L, n[1] / L, n[2] / L]; };
    for (let i = 0; i < edges.length; i += 4) {
      const t1 = edges[i], t2 = edges[i + 1];
      if (keep && !keep(t1, t2)) continue;
      let sharp = hard && hard[t1] !== hard[t2];
      if (!sharp) { const a = nrm(t1), b = nrm(t2); sharp = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < cosD; }
      if (sharp) { out.add(edges[i + 2]); out.add(edges[i + 3]); }
    }
    return out;
  }
  function sliceByField(P, I, f) {
    const nt = I.length / 3, nv = P.length / 3;
    const Pn = []; for (let i = 0; i < P.length; i++) Pn.push(P[i]);
    const mid = new Map(), In = [], gOf = [], par = [];
    const cross = (a, b) => {
      const key = a < b ? a * nv + b : b * nv + a; let m = mid.get(key);
      if (m !== undefined) return m;
      const lo = a < b ? a : b, hi = a < b ? b : a; // from the lower end, so both triangles get the same point
      let s = f[lo] / (f[lo] - f[hi]); s = Math.max(0.12, Math.min(0.88, s));
      m = Pn.length / 3; Pn.push(P[3 * lo] + s * (P[3 * hi] - P[3 * lo]), P[3 * lo + 1] + s * (P[3 * hi + 1] - P[3 * lo + 1]), P[3 * lo + 2] + s * (P[3 * hi + 2] - P[3 * lo + 2]));
      mid.set(key, m); return m;
    };
    const d2 = (x, y) => (Pn[3 * x] - Pn[3 * y]) ** 2 + (Pn[3 * x + 1] - Pn[3 * y + 1]) ** 2 + (Pn[3 * x + 2] - Pn[3 * y + 2]) ** 2;
    for (let t = 0; t < nt; t++) {
      let a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const za = f[a] === 0, zb = f[b] === 0, zc = f[c] === 0;
      if (za || zb || zc) { // (1.77) a vertex exactly on the line (a pinned seam vertex): the line passes through it, no new point there
        const pos = (f[a] > 0) + (f[b] > 0) + (f[c] > 0), neg = (f[a] < 0) + (f[b] < 0) + (f[c] < 0);
        if (!pos || !neg) { In.push(a, b, c); gOf.push(pos ? 1 : neg ? 0 : (f[a] + f[b] + f[c] > 0 ? 1 : 0)); par.push(t); continue; }
        // one zero, one positive, one negative: split the edge between the signed ends and fan from the zero vertex
        if (zb) [a, b, c] = [b, c, a]; else if (zc) [a, b, c] = [c, a, b];
        const x = cross(b, c);
        In.push(a, b, x, a, x, c); gOf.push(f[b] > 0 ? 1 : 0, f[c] > 0 ? 1 : 0); par.push(t, t); continue;
      }
      const sa = f[a] > 0, sb = f[b] > 0, sc = f[c] > 0;
      if (sa === sb && sb === sc) { In.push(a, b, c); gOf.push(sa ? 1 : 0); par.push(t); continue; }
      // turn the triangle so a is the lone vertex
      if (sb !== sa && sb !== sc) [a, b, c] = [b, c, a]; else if (sc !== sa && sc !== sb) [a, b, c] = [c, a, b];
      const x = cross(a, b), y = cross(a, c), ga = f[a] > 0 ? 1 : 0;
      In.push(a, x, y); gOf.push(ga);
      if (d2(x, c) <= d2(b, y)) { In.push(x, b, c, x, c, y); } else { In.push(x, b, y, y, b, c); }
      gOf.push(1 - ga, 1 - ga); par.push(t, t, t);
    }
    const P2 = new (P.constructor === Float64Array ? Float64Array : Float32Array)(Pn), I2 = new Uint32Array(In), G = Int32Array.from(gOf);
    return { P2, I2, G, added: mid.size, parent: Int32Array.from(par) };
  }
  // A stroke's lines sliced along their planes (ModelSplitter's line cut, the owner: "slice drawn lines is not slicing
  // the topology as expected"): a stroke's line is the plane's ring walked along mesh edges, so the slice follows the
  // plane itself and the cut is the plane's exact ring. Every vertex takes its distance from the plane (no band: clamped,
  // a long edge's crossing point moved to its middle), the surface is sliced through every ring of the plane, and then
  // the pieces are joined back across every ring but the stroke's own (the chain of crossed triangles from the line's
  // vertices across shared edges: one ring, however close another runs, on a finger beside a finger or a fold of cloth).
  // Several strokes cut together: each plane's own ring is the only one kept of it.
  function slicePlaneLoops(P, I, loops, sel, cnt, cin, med) {
    const nt = I.length / 3, nv = P.length / 3, vt = vertexTriangles(P, I), pr = trianglePairs(I);
    const tnb = new Int32Array(nt + 1); for (let i = 0; i < pr.length; i += 4) { tnb[pr[i] + 1]++; tnb[pr[i + 1] + 1]++; }
    for (let t = 0; t < nt; t++) tnb[t + 1] += tnb[t];
    const fill = tnb.slice(0, nt), tto = new Int32Array(tnb[nt]); for (let i = 0; i < pr.length; i += 4) { tto[fill[pr[i]]++] = pr[i + 1]; tto[fill[pr[i + 1]]++] = pr[i]; }
    const f = new Float64Array(nv), chain = new Uint8Array(nt), skipV = new Uint8Array(nv); // (skipV: another plane's vertices are left out of this one's sign vote)
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li], vs = loop.verts; if (vs.length < 3) return null;
      const { o, n } = loop.plane, dz = (v) => (P[3 * v] - o[0]) * n[0] + (P[3 * v + 1] - o[1]) * n[1] + (P[3 * v + 2] - o[2]) * n[2];
      const crossed = new Uint8Array(nt), seenT = new Uint8Array(nt), queue = [];
      for (let t = 0; t < nt; t++) { const a = dz(I[3 * t]) > 0, b = dz(I[3 * t + 1]) > 0, c = dz(I[3 * t + 2]) > 0; if (a !== b || b !== c) crossed[t] = 1; }
      for (const v of vs) for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const t = vt.tri[j]; if (crossed[t] && !seenT[t]) { seenT[t] = 1; queue.push(t); } }
      for (let h = 0; h < queue.length; h++) { const t = queue[h]; for (let j = tnb[t]; j < tnb[t + 1]; j++) { const u = tto[j]; if (crossed[u] && !seenT[u]) { seenT[u] = 1; queue.push(u); } } }
      if (!queue.length) return null;
      // which way round: the side the line bounds, by the chain's own vertices
      let agree = 0, disagree = 0;
      for (const t of queue) for (let k = 0; k < 3; k++) { const v = I[3 * t + k], d = dz(v); if (Math.abs(d) > 0.5 * med && cnt[v] && (cin[v] === 0 || cin[v] === cnt[v])) { if ((d > 0) === (cin[v] > 0)) agree++; else disagree++; } }
      const flip = disagree > agree ? -1 : 1;
      if (li === 0) { for (let v = 0; v < nv; v++) { const d = dz(v); f[v] = d === 0 ? -flip * 1e-9 * med : flip * d; } } // (a vertex on the plane goes with the side below it, as `crossed` counts it)
      else { // a later plane cuts the first's field where its own ring runs: the sign of the field is kept, the size from this plane
        for (const t of queue) for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; if (!skipV[v]) { const d = dz(v); f[v] = d === 0 ? -flip * 1e-9 * med : flip * d; } }
        for (const t of queue) for (let k = 0; k < 3; k++) skipV[I[3 * t + k]] = 1;
      }
      for (const t of queue) chain[t] = 1;
    }
    const { P2, I2, G, added, parent } = sliceByField(P, I, f);
    const nt2 = G.length;
    // the pieces, joined across every crossing but the chains' own (an edge inside a chain triangle with both ends new)
    const pr2 = trianglePairs(I2), par = new Int32Array(nt2); for (let t = 0; t < nt2; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < pr2.length; i += 4) {
      const a = pr2[i], b = pr2[i + 1], va = pr2[i + 2], vb = pr2[i + 3];
      if (parent[a] === parent[b] && chain[parent[a]] && va >= nv && vb >= nv) continue; // the stroke's own crossing
      const x = find(a), y = find(b); if (x !== y) par[x] = y;
    }
    // side 1: of the pieces the rings separate (loose shells stay side 0; splitRegions takes those inside the pick with
    // it), those holding more of the side the lines bound than not; failing that, every one but the biggest (the line
    // walked may have cut corners, so the side it bounds can be a poor guide)
    const touched = new Set(); for (let i = 0; i < pr2.length; i += 4) { const a = pr2[i], b = pr2[i + 1]; if (parent[a] === parent[b] && chain[parent[a]] && pr2[i + 2] >= nv && pr2[i + 3] >= nv) { touched.add(find(a)); touched.add(find(b)); } }
    const vote = new Map(); for (let t = 0; t < nt2; t++) { const r = find(t); if (!touched.has(r)) continue; if (!vote.has(r)) vote.set(r, [0, 0]); vote.get(r)[sel[parent[t]] ? 1 : 0]++; }
    let side = new Set(); for (const [r, [out, inn]] of vote) if (inn > out) side.add(r);
    if (!side.size || side.size === vote.size) { let big = -1; for (const [r, [out, inn]] of vote) if (big < 0 || out + inn > vote.get(big)[0] + vote.get(big)[1]) big = r; side = new Set([...vote.keys()].filter(r => r !== big)); }
    for (let t = 0; t < nt2; t++) G[t] = side.has(find(t)) ? 1 : 0;
    let g1 = 0; for (const x of G) g1 += x; if (!g1 || g1 === nt2) return null;
    const s2 = bordersFromGroups(P2, I2, G), l2 = groupLoops(P2, I2, s2, [1]);
    if (!l2.length || l2.some(l => !l.closed) || l2.length !== loops.length) return null;
    return { P: P2, I: I2, seg: s2, groups: [1], loops: l2.map(l => ({ ...l, drawn: true })), added };
  }
  // A drawn line sliced through the triangles (the owner: "any drawn cuts must actually slice new vertexes into the
  // model"): a line drawn by hand, or a stroke, runs along the mesh's own edges, so on a coarse mesh it steps from
  // vertex to vertex. Here the line's points are eased into a smooth curve (three passes of neighbour averaging),
  // and every vertex within a few rings of it takes its distance to the curve, signed by the side of the curve it
  // lies on (across the curve's tangent and the surface normal, turned to agree with the side the line bounds);
  // farther vertices take the side the line bounds, at a fixed distance. The surface is then sliced where that
  // field is zero (`sliceByField`), so the cut runs along the curve through the faces. Returns
  // { P, I, seg, groups: [1], loops } on the new mesh, or null when the slice doesn't close or moves the area much.
  function sliceDrawnLoops(P, I, loops) {
    const nt = I.length / 3, nv = P.length / 3;
    let sel; try { sel = loopSelection(P, I, loops); } catch (err) { return null; }
    let n1 = 0; for (const x of sel) n1 += x; if (!n1 || n1 === nt) return null;
    const cnt = new Int32Array(nv), cin = new Int32Array(nv), vn = new Float64Array(3 * nv);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; cnt[v]++; if (sel[t]) cin[v]++; vn[3 * v] += n[0]; vn[3 * v + 1] += n[1]; vn[3 * v + 2] += n[2]; }
    }
    const L = []; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 3000))) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
    L.sort((x, y) => x - y); const med = L[L.length >> 1] || 1;
    const adj = vertexAdjacency(P, I), band = 4 * med, f = new Float64Array(nv);
    for (let v = 0; v < nv; v++) f[v] = cin[v] * 2 >= cnt[v] ? band : -band;
    const nearAll = new Uint8Array(nv);
    if (loops.every(l => l.plane)) return slicePlaneLoops(P, I, loops, sel, cnt, cin, med);
    for (const loop of loops) {
      const vs = loop.verts, m = vs.length; if (m < 3) continue;
      let pts = vs.map(v => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
      // the points clicked hold the curve where they were put (a drawn line keeps them); the rest is smoothed
      const fixed = new Uint8Array(m);
      if (loop.anchors && loop.points) { const at = new Map(); vs.forEach((v, i) => { if (!at.has(v)) at.set(v, i); }); loop.anchors.forEach((v, k) => { const i = at.get(v); if (i !== undefined) { fixed[i] = 1; pts[i] = loop.points[k].slice(); } }); }
      const passes = fixed.some(x => x) ? 12 : 3;
      for (let it = 0; it < passes; it++) pts = pts.map((p, i) => { if (fixed[i]) return p; const a = pts[(i + m - 1) % m], b = pts[(i + 1) % m]; return [0.25 * a[0] + 0.5 * p[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * p[1] + 0.25 * b[1], 0.25 * a[2] + 0.5 * p[2] + 0.25 * b[2]]; });
      // the vertices near the line: a few rings out from it
      const near = new Map(); let ring = vs.slice(); for (const v of ring) near.set(v, 0);
      for (let r = 1; r <= 4; r++) { const nx = []; for (const v of ring) for (let j = adj.start[v]; j < adj.start[v + 1]; j++) { const w = adj.to[j]; if (!near.has(w)) { near.set(w, r); nx.push(w); } } ring = nx; }
      const sideOf = new Map(); let agree = 0, disagree = 0;
      for (const [v] of near) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
        let bd = Infinity, bi = 0, bt = 0;
        for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz || 1; let tt = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2; tt = Math.max(0, Math.min(1, tt)); const qx = a[0] + tt * dx - x, qy = a[1] + tt * dy - y, qz = a[2] + tt * dz - z, d = qx * qx + qy * qy + qz * qz; if (d < bd) { bd = d; bi = i; bt = tt; } }
        const a = pts[bi], b = pts[(bi + 1) % m], tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], c = [a[0] + bt * tg[0], a[1] + bt * tg[1], a[2] + bt * tg[2]];
        // the signed distance across the curve, square to it along the surface (linear through the curve, so the slice
        // lands where the curve runs even where the curve cuts a chord inside the surface)
        const nn = [vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]], sd = cross3(tg, nn), sl = Math.hypot(sd[0], sd[1], sd[2]) || 1, lat = (sd[0] * (x - c[0]) + sd[1] * (y - c[1]) + sd[2] * (z - c[2])) / sl;
        const side = lat >= 0 ? 1 : -1, d = Math.abs(lat);
        sideOf.set(v, [side, d]);
        if (d > 0.5 * med && cnt[v] && (cin[v] === 0 || cin[v] === cnt[v])) { if ((side > 0) === (cin[v] > 0)) agree++; else disagree++; }
      }
      const flip = disagree > agree ? -1 : 1;
      for (const [v, [side, d]] of sideOf) { f[v] = flip * side * Math.min(band, Math.max(d, 1e-7 * med)); nearAll[v] = 1; }
    }
    { // islands: a vertex piece of one sign under 2% of the smaller side, cut off by a noisy normal or a fold, takes the
      // sign round it (as in sliceRegionPick), so the slice gives the lines drawn and no specks beside them
      const par = new Int32Array(nv); for (let v = 0; v < nv; v++) par[v] = v;
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let v = 0; v < nv; v++) for (let j = adj.start[v]; j < adj.start[v + 1]; j++) { const w = adj.to[j]; if ((f[v] > 0) === (f[w] > 0)) { const x = find(v), y = find(w); if (x !== y) par[x] = y; } }
      const size = new Map(); let pos = 0;
      for (let v = 0; v < nv; v++) { const r = find(v); size.set(r, (size.get(r) || 0) + 1); if (f[v] > 0) pos++; }
      const small = Math.max(6, 0.02 * Math.min(pos, nv - pos)), big = [new Map(), new Map()]; // (never the biggest piece of a sign: a fingertip's whole side is a few vertices)
      for (const [r, n] of size) { const k = f[r] > 0 ? 1 : 0, c = big[k]; if (!c.size || n > [...c.values()][0]) { c.clear(); c.set(r, n); } }
      for (let v = 0; v < nv; v++) { const r = find(v), k = f[v] > 0 ? 1 : 0; if (cnt[v] && !big[k].has(r) && size.get(r) < small && ((f[v] > 0) !== (cin[v] * 2 >= cnt[v]) || nearAll[v])) f[v] = -f[v]; }
    }
    const { P2, I2, G, added } = sliceByField(P, I, f);
    let g1 = 0; for (const x of G) g1 += x; if (!g1 || g1 === G.length) return null;
    let s2 = bordersFromGroups(P2, I2, G), l2 = groupLoops(P2, I2, s2, [1]);
    if (l2.length > loops.length) { // a patch the slice cut off beside the line (a fold the plane grazes) goes to the side round it
      const nt2 = G.length, pr = trianglePairs(I2), par = new Int32Array(nt2); for (let t = 0; t < nt2; t++) par[t] = t;
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < pr.length; i += 4) { const a = pr[i], b = pr[i + 1]; if (G[a] === G[b]) { const x = find(a), y = find(b); if (x !== y) par[x] = y; } }
      const size = new Map(), touch = new Set(); for (let t = 0; t < nt2; t++) { const r = find(t); size.set(r, (size.get(r) || 0) + 1); }
      for (let i = 0; i < pr.length; i += 4) if (G[pr[i]] !== G[pr[i + 1]]) { touch.add(find(pr[i])); touch.add(find(pr[i + 1])); }
      const keep = [0, 1].map(k => { let br = -1, bn = 0; for (const r of touch) if (G[r] === k && size.get(r) > bn) { bn = size.get(r); br = r; } return br; });
      for (let t = 0; t < nt2; t++) { const r = find(t); if (touch.has(r) && r !== keep[G[t]] && size.get(r) < 0.25 * size.get(keep[G[t]])) G[t] = 1 - G[t]; }
      s2 = bordersFromGroups(P2, I2, G); l2 = groupLoops(P2, I2, s2, [1]);
    }
    if (!l2.length || l2.some(l => !l.closed) || l2.length !== loops.length) return null;
    const triArea = (Q, J, t) => { const a = 3 * J[3 * t], b = 3 * J[3 * t + 1], c = 3 * J[3 * t + 2]; const n = cross3([Q[b] - Q[a], Q[b + 1] - Q[a + 1], Q[b + 2] - Q[a + 2]], [Q[c] - Q[a], Q[c + 1] - Q[a + 1], Q[c + 2] - Q[a + 2]]); return Math.hypot(n[0], n[1], n[2]) / 2; };
    let a0 = 0, a1 = 0; for (let t = 0; t < nt; t++) if (sel[t]) a0 += triArea(P, I, t); for (let t = 0; t < G.length; t++) if (G[t]) a1 += triArea(P2, I2, t);
    const slack = loops.reduce((q, l) => q + (l.length || 0), 0) * 3 * med; // (a band three edges wide along the line: a small piece's share moves a lot)
    if (!loops.every(l => l.plane) && Math.abs(a1 - a0) > Math.max(0.33 * a0, slack)) return null; // (a stroke's ring is the plane's own; the line it walked may have cut corners)
    return { P: P2, I: I2, seg: s2, groups: [1], loops: l2.map(l => ({ ...l, drawn: true })), added };
  }
  // A region pick sliced along a smooth curve through the triangles (the owner: "the application should be able to
  // slice topology and not just cut along existing topology vertexes"). Any line made of the mesh's own edges steps
  // from vertex to vertex, so on a coarse or uneven mesh the cut's rim and its sunk wall came out in teeth and points
  // however the line was eased. Here the pick is a field over the vertices: the distance along the surface to its
  // outline (Dijkstra over the edges, within a band), plus inside and minus outside, smoothed by `passes` rounds of
  // neighbour averaging so the outline's steps and notches average out over about `scale` mm; the cut follows the
  // field's zero level, which crosses edges anywhere along them. Each crossed edge gets one new vertex (shared by
  // the two triangles beside it, so the surface stays sealed), placed between 12% and 88% of the way along so no
  // new triangle is a sliver; each crossed triangle splits into three. Islands the smoothing makes or loses that
  // are under 2% of the smaller side go back to the side round them; loose pieces wholly in the pick stay in it.
  // Returns { P, I, seg, groups: [1], loops, scale } on the new mesh (the original is untouched), or null.
  function sliceRegionPick(P, I, seg, groups, opts = {}) {
    const nt = I.length / 3, nv = P.length / 3, set = new Set(groups);
    const inT = new Uint8Array(nt); let nIn = 0;
    for (let t = 0; t < nt; t++) if (set.has(seg.groupOf[t])) { inT[t] = 1; nIn++; }
    if (!nIn || nIn === nt) return null;
    const L = []; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 4000))) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; L.push(Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
    L.sort((x, y) => x - y); const med = L[L.length >> 1] || 1;
    let scale = opts.scale;
    { // about 1/40 of the shortest outline, never under three edges, nor over 1/15 of it (a small patch on a coarse mesh would melt away)
      let shortest = Infinity; for (const l of groupLoops(P, I, seg, groups)) if (l.closed) shortest = Math.min(shortest, l.length);
      if (!isFinite(shortest)) return null;
      if (!scale) scale = Math.min(Math.max(3 * med, shortest / 40), shortest / 15);
    }
    // each vertex: inside (all its triangles picked), outside (none) or on the outline
    const cnt = new Int32Array(nv), cin = new Int32Array(nv);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; cnt[v]++; if (inT[t]) cin[v]++; }
    // (1.77) the outline's vertices on a sharp edge (a crease of 25° or more, or hard meeting organic) are pinned: the
    // field is held at zero there through the smoothing, so the slice runs through them and never drifts off the seam
    const pinned = sharpEdgeVertices(P, I, seg.borders, (t1, t2) => inT[t1] !== inT[t2], opts.pinDeg || 25, seg.hard || null);
    if (opts.pin) for (const v of opts.pin) if (cin[v] && cin[v] < cnt[v]) pinned.add(v); // (1.83) a limb's flat end stays exactly where it was cut
    const band = 4 * scale, dist = new Float64Array(nv).fill(Infinity), heap = [];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI][0] <= heap[i][0]) break; [heap[pI], heap[i]] = [heap[i], heap[pI]]; i = pI; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (let v = 0; v < nv; v++) if (cin[v] && cin[v] < cnt[v]) { dist[v] = 0; push([0, v]); }
    const adj = vertexAdjacency(P, I);
    while (heap.length) {
      const [d, v] = pop();
      if (d > dist[v] || d > band) continue;
      for (let j = adj.start[v]; j < adj.start[v + 1]; j++) { const w = adj.to[j], nd = d + adj.len[j]; if (nd < dist[w]) { dist[w] = nd; push([nd, w]); } }
    }
    const f = new Float64Array(nv), live = [];
    for (let v = 0; v < nv; v++) {
      const s = cin[v] === cnt[v] ? 1 : cin[v] === 0 ? -1 : 0, d = Math.min(dist[v], band);
      f[v] = s * d; if (dist[v] < band && !pinned.has(v)) live.push(v);
    }
    // smoothing: plain neighbour averages, enough rounds to spread over `scale` (a walk of k steps reaches about √k edges)
    const passes = opts.passes || Math.max(4, Math.min(120, Math.round(1.5 * (scale / med) ** 2)));
    const g = new Float64Array(nv);
    for (let it = 0; it < passes; it++) {
      for (const v of live) { let s = 0, n = 0; for (let j = adj.start[v]; j < adj.start[v + 1]; j++) { s += f[adj.to[j]]; n++; } g[v] = n ? 0.5 * f[v] + 0.5 * s / n : f[v]; }
      for (const v of live) f[v] = g[v];
    }
    let onOutline = 0; for (let v = 0; v < nv; v++) if (cin[v] && cin[v] < cnt[v]) onOutline++;
    if (pinned.size < 0.3 * onOutline) { // smoothing shrinks a convex pick and swells a concave one (a curve shortens as it is smoothed): the level is moved
      // so the side kept holds as much surface as the pick did, by each vertex's share of its triangles' area.
      // (1.77: not when much of the outline is pinned to a seam: the whole correction then lands on the few free stretches)
      const va = new Float64Array(nv); let a0 = 0;
      for (let t = 0; t < nt; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]; const ar = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2; for (let k = 0; k < 3; k++) va[I[3 * t + k]] += ar / 3; if (inT[t]) a0 += ar; }
      const order = live.slice().sort((x, y) => f[y] - f[x]); // the band, from the most inside
      let acc = 0; for (let v = 0; v < nv; v++) if (dist[v] >= band && f[v] > 0) acc += va[v]; // inside, beyond the band
      let level = 0;
      for (const v of order) { if (acc + va[v] > a0) { level = f[v]; break; } acc += va[v]; }
      level = Math.max(-0.75 * band, Math.min(0.75 * band, level));
      for (const v of live) f[v] -= level;
    }
    const tiny = 1e-7 * med;
    for (let v = 0; v < nv; v++) if (Math.abs(f[v]) < tiny) f[v] = pinned.has(v) ? 0 : cin[v] * 2 >= cnt[v] ? tiny : -tiny;
    // islands: vertex pieces of one sign (through edges between vertices of that sign); small ones that the field
    // touched take the other sign, unless the piece is a loose shell wholly in or out of the pick as it was
    const comps = shellComponents(P, I), shellMixed = new Uint8Array(comps.count), shellIn = new Uint8Array(comps.count).fill(1);
    for (let t = 0; t < nt; t++) { if (!inT[t]) shellIn[comps.label[t]] = 0; }
    for (let t = 0; t < nt; t++) if (inT[t] !== shellIn[comps.label[t]]) shellMixed[comps.label[t]] = 1;
    const vShell = new Int32Array(nv); for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vShell[I[3 * t + k]] = comps.label[t];
    const par = new Int32Array(nv); for (let v = 0; v < nv; v++) par[v] = v;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let v = 0; v < nv; v++) for (let j = adj.start[v]; j < adj.start[v + 1]; j++) { const w = adj.to[j]; if ((f[v] > 0) === (f[w] > 0)) { const x = find(v), y = find(w); if (x !== y) par[x] = y; } }
    const size = new Map(); let pos = 0;
    for (let v = 0; v < nv; v++) { const r = find(v); size.set(r, (size.get(r) || 0) + 1); if (f[v] > 0) pos++; }
    const small = Math.max(6, 0.02 * Math.min(pos, nv - pos));
    for (let v = 0; v < nv; v++) if (shellMixed[vShell[v]] && size.get(find(v)) < small) f[v] = -f[v];
    const { P2, I2, G, added } = sliceByField(P, I, f);
    let n1 = 0; for (const x of G) n1 += x;
    if (!n1 || n1 === G.length) return null;
    const s2 = bordersFromGroups(P2, I2, G), l2 = groupLoops(P2, I2, s2, [1]);
    if (!l2.length || l2.some(l => !l.closed)) return null;
    // the smoothing must not eat much of the pick, nor add much (a small patch on a coarse mesh melts away)
    const triArea = (Q, J, t) => { const a = 3 * J[3 * t], b = 3 * J[3 * t + 1], c = 3 * J[3 * t + 2]; const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], wx = Q[c] - Q[a], wy = Q[c + 1] - Q[a + 1], wz = Q[c + 2] - Q[a + 2]; return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2; };
    let a0 = 0, a1 = 0; for (let t = 0; t < nt; t++) if (inT[t]) a0 += triArea(P, I, t);
    for (let t = 0; t < G.length; t++) if (G[t]) a1 += triArea(P2, I2, t);
    if (a1 < 0.75 * a0 || a1 > 1.33 * a0) return null;
    return { P: P2, I: I2, seg: s2, groups: [1], loops: l2, scale, added };
  }
  // (1.83) A limb ends in a flat cut across it where it meets the body. A sleeve's region ends where the cloth does,
  // which on the owner's Father Rhinehardt runs up under the capelet: cutting along it left the capelet's rim as knife
  // flaps on the body and a spike on top of the arm. Here each outline of a region pick that is the root of a tube
  // (the picked surface near it shaped like a tube, the region across it much bigger) is replaced by the ring of a
  // plane square to the tube's axis, at the outline's mean height along it, moved into the limb until the ring is the
  // tube's own (no longer than 1.6 times its girth: the plane must not run into the body or the cape). The surface is
  // sliced along that ring only (the plane's other rings, through a cape or the coat, are left joined), and the pick
  // becomes what lies on the limb's side of the ring, reached from the picked triangles without crossing the ring or
  // the pick's other outlines. Returns { P, I, seg, groups: [1], pin, ends, planes } on the new mesh, or null.
  function limbEndPick(P, I, seg, groups, opts = {}) {
    const nt = I.length / 3, nv = P.length / 3, set = new Set(groups), inT = new Uint8Array(nt);
    let aPick = 0; const A = new Float64Array(nt), C = new Float64Array(3 * nt), N = new Float64Array(3 * nt);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const n = cross3([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), L = Math.hypot(n[0], n[1], n[2]);
      A[t] = L / 2; for (let k = 0; k < 3; k++) { C[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3; N[3 * t + k] = L > 0 ? n[k] / L : 0; }
      if (set.has(seg.groupOf[t])) { inT[t] = 1; aPick += A[t]; }
    }
    if (!aPick) return null;
    let total = 0; for (let t = 0; t < nt; t++) total += A[t];
    const loops = groupLoops(P, I, seg, groups); if (!loops.length || loops.some(l => !l.closed)) return null;
    const vt = vertexTriangles(P, I), scale = diag(bounds(P));
    const pip = (xy, x, y) => { let inside = false; const m = xy.length / 2; for (let i = 0, j = m - 1; i < m; j = i++) { const xi = xy[2 * i], yi = xy[2 * i + 1], xj = xy[2 * j], yj = xy[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
    const ringLen = (xy) => { let l = 0; const m = xy.length / 2; for (let i = 0; i < m; i++) { const j = (i + 1) % m; l += Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1]); } return l; };
    const ends = [], other = [];
    for (const lp of loops) {
      const vs = lp.verts, m = vs.length; if (m < 6) { other.push(lp); continue; }
      let len = 0; const c0 = [0, 0, 0];
      for (let i = 0; i < m; i++) { const p = 3 * vs[i], q = 3 * vs[(i + 1) % m]; len += Math.hypot(P[p] - P[q], P[p + 1] - P[q + 1], P[p + 2] - P[q + 2]); for (let k = 0; k < 3; k++) c0[k] += P[p + k] / m; }
      const r0 = len / (2 * Math.PI);
      // the rest of the part must be much bigger than the pick (the body a limb comes off; a cape or a cuff beside the
      // outline can be smaller than a whole arm)
      if (total - aPick < 1.5 * aPick) { other.push(lp); continue; }
      // the picked surface near the outline must be a tube
      const s = new Float64Array(16), near = [];
      for (let t = 0; t < nt; t++) if (inT[t]) {
        const x = C[3 * t], y = C[3 * t + 1], z = C[3 * t + 2]; if (Math.hypot(x - c0[0], y - c0[1], z - c0[2]) > 2.5 * r0) continue;
        const a = A[t], u = N[3 * t], v = N[3 * t + 1], w = N[3 * t + 2]; near.push(t);
        s[0] += a; s[1] += a * x; s[2] += a * y; s[3] += a * z; s[4] += a * x * x; s[5] += a * x * y; s[6] += a * x * z; s[7] += a * y * y; s[8] += a * y * z; s[9] += a * z * z;
        s[10] += a * u * u; s[11] += a * u * v; s[12] += a * u * w; s[13] += a * v * v; s[14] += a * v * w; s[15] += a * w * w;
      }
      const ax0 = near.length >= 30 ? tubeAxis(s, true) : null;
      if (!ax0) { other.push(lp); continue; }
      const mu = [s[1] / s[0], s[2] / s[0], s[3] / s[0]];
      let ax = ax0.slice(); if ((c0[0] - mu[0]) * ax[0] + (c0[1] - mu[1]) * ax[1] + (c0[2] - mu[2]) * ax[2] < 0) ax = ax.map(x => -x); // pointing out of the limb, into the body
      const rs = near.map(t => { const d = [C[3 * t] - mu[0], C[3 * t + 1] - mu[1], C[3 * t + 2] - mu[2]], h = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; return Math.hypot(d[0] - h * ax[0], d[1] - h * ax[1], d[2] - h * ax[2]); }).sort((x, y) => x - y);
      const rT = rs[rs.length >> 1]; if (!(rT > 0)) { other.push(lp); continue; }
      let sRing = 0; for (const v of vs) sRing += ((P[3 * v] - mu[0]) * ax[0] + (P[3 * v + 1] - mu[1]) * ax[1] + (P[3 * v + 2] - mu[2]) * ax[2]) / m;
      // the plane's place: from the outline's mean height into the limb, the ring that is the tube's own and meets the
      // surface most squarely (a sleeve flares where it meets the coat under a cape: a ring through the flare grazes the
      // surface and leaves a blade on the arm)
      let found = null;
      for (let k = 0; k <= 6; k++) { // (at most a radius and a half in: further, a short sleeve would be cut away)
        const h = sRing - k * 0.25 * rT, o = [mu[0] + h * ax[0], mu[1] + h * ax[1], mu[2] + h * ax[2]];
        const F = frameFromNormal(ax, o), sec = section(P, I, F, scale); if (sec.error) continue;
        let best = null, bl = Infinity;
        for (const L of sec.loops) { if (!pip(L.xy, 0, 0)) continue; const l = ringLen(L.xy); if (l < bl) { bl = l; best = L; } }
        if (!best || bl > 1.6 * 2 * Math.PI * rT || bl < 0.4 * 2 * Math.PI * rT) continue;
        const xy = best.xy, mm = xy.length / 2, pts = []; for (let i = 0; i < mm; i += Math.max(1, Math.floor(mm / 120))) pts.push(planePoint(F, xy[2 * i], xy[2 * i + 1]));
        // (1.86) the ring must run over the picked limb itself: a plane through a shoulder pad or a cape beside the limb (its
        // ring wrapping both) cut the pad, which the owner never picked
        const near = nearestVertices(P, pts); let onPick = 0; for (const v of near) { for (let j = vt.start[v]; j < vt.start[v + 1]; j++) if (inT[vt.tri[j]]) { onPick++; break; } }
        if (onPick < 0.6 * near.length) continue;
        // (1.92) by its worst stretch too, not only on average: a ring square to the sleeve most of the way round but
        // grazing it along the front (where the sleeve tucks under the cape) left a thin brim on the arm there
        const gz = []; for (const v of near) { let nx = 0, ny = 0, nz = 0; for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const t = vt.tri[j]; nx += N[3 * t] * A[t]; ny += N[3 * t + 1] * A[t]; nz += N[3 * t + 2] * A[t]; } const L = Math.hypot(nx, ny, nz) || 1; gz.push(Math.abs((nx * ax[0] + ny * ax[1] + nz * ax[2]) / L)); }
        const mean = gz.reduce((x, y) => x + y, 0) / (gz.length || 1), worst = gz.slice().sort((x, y) => x - y)[Math.floor(0.9 * (gz.length - 1))] || 0, graze = mean; // (1.93: by its mean again: judged by its worst stretch the ring moved a step down the sleeve, out from under the cape and into plain view)
        if (!found || graze < found.graze - 0.05) found = { o, n: ax, F, ring: best, len: bl, graze };
        if (found.graze <= 0.3) break; // (the first that meets the surface squarely enough: nearer the joint is better)
      }
      if (!found) { other.push(lp); continue; }
      ends.push(found);
    }
    if (!ends.length) return null;
    // the field: each end's plane, signed so the limb's side is positive; one end per limb, so the planes are far apart
    // and each vertex takes the plane of the end nearest it
    const f = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      let bd = Infinity, bi = 0;
      for (let e = 0; e < ends.length; e++) { const o = ends[e].o, d = Math.hypot(P[3 * v] - o[0], P[3 * v + 1] - o[1], P[3 * v + 2] - o[2]); if (d < bd) { bd = d; bi = e; } }
      const { o, n } = ends[bi];
      const dz = (P[3 * v] - o[0]) * n[0] + (P[3 * v + 1] - o[1]) * n[1] + (P[3 * v + 2] - o[2]) * n[2];
      f[v] = dz === 0 ? 1e-12 * scale : -dz;
    }
    // each end's own ring: the triangles it crosses, flooded from those nearest the section's points across crossed neighbours
    const pr = trianglePairs(I), tnb = new Int32Array(nt + 1); for (let i = 0; i < pr.length; i += 4) { tnb[pr[i] + 1]++; tnb[pr[i + 1] + 1]++; }
    for (let t = 0; t < nt; t++) tnb[t + 1] += tnb[t];
    const fill = tnb.slice(0, nt), tto = new Int32Array(tnb[nt]); for (let i = 0; i < pr.length; i += 4) { tto[fill[pr[i]]++] = pr[i + 1]; tto[fill[pr[i + 1]]++] = pr[i]; }
    const crossed = (t) => { const a = f[I[3 * t]] > 0, b = f[I[3 * t + 1]] > 0, c = f[I[3 * t + 2]] > 0; return a !== b || b !== c; };
    const chain = new Uint8Array(nt);
    for (const e of ends) {
      const xy = e.ring.xy, m = xy.length / 2, pts = []; for (let i = 0; i < m; i++) pts.push(planePoint(e.F, xy[2 * i], xy[2 * i + 1]));
      const seeds = nearestVertices(P, pts), queue = [], seen = new Uint8Array(nt);
      for (const v of seeds) for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const t = vt.tri[j]; if (!seen[t] && crossed(t)) { seen[t] = 1; queue.push(t); } }
      for (let h = 0; h < queue.length; h++) { const t = queue[h]; for (let j = tnb[t]; j < tnb[t + 1]; j++) { const u = tto[j]; if (!seen[u] && crossed(u)) { seen[u] = 1; queue.push(u); } } }
      if (queue.length < 6) return null;
      for (const t of queue) chain[t] = 1;
    }
    const { P2, I2, G, parent } = sliceByField(P, I, f), nt2 = G.length;
    // the edges the flood may not cross: an end's ring (inside a chain triangle, both ends new) and the pick's other outlines
    const blocked = new Set(); for (const lp of other) { const vs = lp.verts; for (let i = 0; i < vs.length; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; blocked.add(a < b ? a * nv + b : b * nv + a); } }
    const pr2 = trianglePairs(I2), nb = new Int32Array(nt2 + 1); for (let i = 0; i < pr2.length; i += 4) { nb[pr2[i] + 1]++; nb[pr2[i + 1] + 1]++; }
    for (let t = 0; t < nt2; t++) nb[t + 1] += nb[t];
    const fl = nb.slice(0, nt2), to = new Int32Array(nb[nt2]), ok = new Uint8Array(nb[nt2]);
    for (let i = 0; i < pr2.length; i += 4) {
      const a = pr2[i], b = pr2[i + 1], va = pr2[i + 2], vb = pr2[i + 3];
      const ring = parent[a] === parent[b] && chain[parent[a]] && va >= nv && vb >= nv;
      const line = va < nv && vb < nv && blocked.has(va < vb ? va * nv + vb : vb * nv + va);
      const pass = ring || line ? 0 : 1;
      ok[fl[a]] = pass; to[fl[a]++] = b; ok[fl[b]] = pass; to[fl[b]++] = a;
    }
    const sel = new Int32Array(nt2), queue = [];
    // seeds: the picked triangles on the limb's side of the planes (a picked triangle up under the cape, beyond the
    // plane, is left to the body); the flood then takes in whatever it reaches without crossing a ring or another outline
    for (let t = 0; t < nt2; t++) if (inT[parent[t]] && G[t] === 1) { sel[t] = 1; queue.push(t); }
    for (let h = 0; h < queue.length; h++) { const t = queue[h]; for (let j = nb[t]; j < nb[t + 1]; j++) { const u = to[j]; if (ok[j] && !sel[u]) { sel[u] = 1; queue.push(u); } } }
    let a1 = 0, n1 = 0; for (let t = 0; t < nt2; t++) if (sel[t]) { n1++; const a = 3 * I2[3 * t], b = 3 * I2[3 * t + 1], c = 3 * I2[3 * t + 2]; const n = cross3([P2[b] - P2[a], P2[b + 1] - P2[a + 1], P2[b + 2] - P2[a + 2]], [P2[c] - P2[a], P2[c + 1] - P2[a + 1], P2[c + 2] - P2[a + 2]]); a1 += Math.hypot(n[0], n[1], n[2]) / 2; }
    if (!n1 || n1 === nt2 || a1 < 0.5 * aPick || a1 > 2 * aPick) return null; // (the ring didn't close off the limb: the flood ran into the body)
    const s2 = bordersFromGroups(P2, I2, sel), l2 = groupLoops(P2, I2, s2, [1]);
    if (!l2.length || l2.some(l => !l.closed) || l2.length !== loops.length) return null;
    if (seg.hard) { const h = new Uint8Array(nt2); for (let t = 0; t < nt2; t++) h[t] = seg.hard[parent[t]]; s2.hard = h; }
    const pin = new Set(); for (let t = 0; t < nt2; t++) if (chain[parent[t]]) for (let k = 0; k < 3; k++) { const v = I2[3 * t + k]; if (v >= nv) pin.add(v); }
    const cover = new Uint8Array(nt); for (let t = 0; t < nt2; t++) if (sel[t]) cover[parent[t]] = 1; // the part's own triangles the pick now covers, for the app to tint
    return { P: P2, I: I2, seg: s2, groups: [1], loops: l2, pin, ends: ends.length, planes: ends.map(e => ({ o: e.o, n: e.n })), cover };
  }
  // The mesh a pick works on: with `req.smooth`, the picked lines eased along the surface (`smoothLoopVertices`)
  // on a copy, with its own index array so no cache kept for the original's positions is read for it
  function pickMesh(P, I, req) {
    if (!req.loops || !req.loops.length || req.sliced) return { P, I, req }; // (a pick already sliced is not sliced again)
    if (!req.regions && req.sliceDrawn && !req.noSlice && req.loops.every(l => l.closed && l.drawn)) { // (1.75) drawn lines and strokes sliced through the faces
      let sl = null; try { sl = sliceDrawnLoops(P, I, req.loops); } catch (err) { sl = null; }
      if (sl) return { P: sl.P, I: sl.I, req: { ...req, seg: sl.seg, regions: sl.groups, loops: sl.loops, sliced: true } };
    }
    if (!req.smooth) return { P, I, req };
    if (req.regions && req.seg && !req.noReroute && !req.noSlice && req.limbEnds !== false) { // (1.93: only when asked (the app's End limbs with a flat cut, off by default): the cut follows the seam that was picked or painted, where it shows least; 1.92's flat end on a brushed arm sat in plain view below the shoulder) // (1.83) a limb ends in a flat cut across it (1.86: never a painted pick: the owner's paint is what is cut, as painted)
      let le = null; try { le = limbEndPick(P, I, req.seg, req.regions); } catch (err) { le = null; }
      if (le) {
        let sl = null; try { sl = sliceRegionPick(le.P, le.I, le.seg, [1], { ...(typeof req.smooth === 'object' ? req.smooth : {}), pin: le.pin }); } catch (err) { sl = null; }
        const r = sl || le;
        const flatEnds = le.ends >= le.loops.length; // (every outline a flat limb end: it meets the surface squarely, so the face isn't sunk; sunk, it left a thin collar round the recess)
        return { P: r.P, I: r.I, req: { ...req, seg: r.seg, regions: r.groups, loops: r.loops, sliced: true, limbEnds: le.ends, cover: le.cover, sink: req.sink } }; // (1.92: a flat end keeps its plug: from the edge where the other piece holds it, pulled in where not)
      }
    }
    if (req.regions && req.seg && !req.noReroute && !req.noSlice) { // a region pick sliced along a smooth curve through the triangles
      let sl = null; try { sl = sliceRegionPick(P, I, req.seg, req.regions, typeof req.smooth === 'object' ? req.smooth : {}); } catch (err) { sl = null; }
      if (sl) return { P: sl.P, I: sl.I, req: { ...req, seg: sl.seg, regions: sl.groups, loops: sl.loops, sliced: true } };
    }
    if (req.regions && req.seg && !req.noReroute) { // a region's outline re-routed smooth first, then its points eased
      let sr = null; try { sr = smoothRegionPick(P, I, req.seg, req.regions); } catch (err) { sr = null; }
      if (sr) req = { ...req, seg: sr.seg, regions: sr.groups, loops: sr.loops, rerouted: true };
    }
    const r = smoothLoopVertices(P, I, req.loops, typeof req.smooth === 'object' ? req.smooth : {});
    return r.moved ? { P: r.positions, I: I.slice(), req } : { P, I, req };
  }
  function planJoints(P0, I0, req0) {
    const { P, I, req } = pickMesh(P0, I0, req0);
    const cfg = { ...req.cfg, ...(req.minThickness > 0 ? { minThickness: req.minThickness } : {}), ...(req.sink !== undefined ? { sink: req.sink } : {}), ...(req.sinkStep === false ? { sinkStep: false } : {}) }, D = diag(bounds(P)); // (1.87) keys planned on the face the cut makes: the same wall steps it in
    let loops = req.loops;
    if (!req.regions && loops.length && loops.every(l => l.closed)) { try { loops = orientLoops(P, I, loops, { what: 'lines' }).loops; } catch (err) { /* the cut will say why */ } }
    const out = { loops, perLoop: [], frames: [], draw: [], keys: 0, plugs: 0, noKeys: null, result: null, error: null, errorCode: null, forced: null, dropped: null };
    if (req.cover) out.cover = req.cover; // (1.83) what a limb's flat end makes the pick cover, on the part itself
    if (req.sliced) out.paths = loops.map(l => { const a = new Float32Array(3 * l.verts.length); l.verts.forEach((v, i) => { a[3 * i] = P[3 * v]; a[3 * i + 1] = P[3 * v + 1]; a[3 * i + 2] = P[3 * v + 2]; }); return a; }); // the sliced lines' points: their vertices are new, so the app draws them from these
    const closed = loops.length > 0 && loops.every(l => l.closed);
    if (closed && (cfg.type !== 'none' || cfg.sink > 0)) { // (1.90) with no key the extrusion is still worked out, so it can be drawn
      const longest = Math.max(...loops.map(l => l.length || 0));
      for (const loop of loops) {
        const per = { keys: [], plugs: [] }, draw = { keys: [], plugs: [] };
        // (1.92) a speck of a line (a spot where a sleeve touches the coat, a twentieth of the longest line) is cut as it is, with no complaint that no joint fits it
        const tiny = loops.length > 1 && (loop.length || 0) < 0.05 * longest; if (tiny) per.tiny = true;
        let an = null;
        try {
          const an0 = analyzeLoop(P, I, loop, cfg, D), side = curvedSideOf(cfg.pegSide, an0.curved.into2), lcfg = { ...cfg, pegSide: side };
          an = side === cfg.pegSide ? an0 : analyzeLoop(P, I, loop, lcfg, D);
          per.pegSide = side; per.cfg = lcfg;
          out.frames.push(an.frame);
          const sk = an.curved && an.curved.sunk; // (1.90) the extruded plug drawn before the cut: its floor ring, and where each wall starts
          if (sk && sk.column) draw.sink = { floor: Array.from(sk.xy2), h: Array.from(sk.h2), line: sk.lineXY, lineH: sk.lineH };
          // (1.92) where the other piece can't hold a plug from the cut's edge (a shoulder that slopes away right above
          // the line), the plug is pulled in from the edge by a wall instead, tapered and as deep as Extrude asks:
          // the owner's arm ended in bare horns, or in nothing, where the edge plug didn't fit
          // (1.96) and where the edge plug is only a shallow one (under 1.5 mm at its shallowest: the owner's "1.0 to
          // 18.6 mm" was no key), the plug set in from the edge is taken instead when it goes deeper
          const shallow = !!(sk && sk.column && sk.shallow);
          let inset = cfg.sink > 0 && cfg.sinkStep !== false && (!(sk && sk.column) || shallow) && (cfg.type === 'none' || cfg.type === 'plug');
          const pcfg = cfg.type === 'plug' ? lcfg : { ...lcfg, type: 'plug', plugSlope: Math.max(2, cfg.sinkTaper || 5), plugDepthMode: 'set', plugDepth: Math.max(1, cfg.sink) }; // (a plug chosen as the key keeps its own settings)
          let pl = null;
          if (inset && shallow) {
            let an2 = null; try { an2 = analyzeLoop(P, I, loop, { ...lcfg, sink: 0 }, D); pl = planPlugs(an2, pcfg); } catch (err) { pl = null; }
            if (pl && pl.some(q => q.ok && q.depth >= Math.max(1.5, 1.5 * (sk.least || 0)))) { an = an2; out.frames[out.frames.length - 1] = an.frame; delete draw.sink; }
            else { inset = false; pl = null; }
          }
          if (inset) {
            if (!pl) pl = planPlugs(an, pcfg);
            per.plugs = pl.filter(q => q.ok); per.inset = per.plugs.length > 0; per.cfg = per.inset ? pcfg : lcfg;
            if (!per.plugs.length && !out.noKeys && !tiny) out.noKeys = { code: 'plug', reason: (pl[0] || {}).reason || 'no room' };
            const H = an.curved.heightAt;
            for (const q of per.plugs) { let lo = Infinity, hi = -Infinity; for (const [x, y] of q.mouth) { const z = H(x, y); lo = Math.min(lo, z); hi = Math.max(hi, z); } draw.plugs.push({ base: q.base, top: q.top, z0: q.side > 0 ? lo : hi, tip: (q.side > 0 ? hi : lo) + q.side * q.depth }); }
          } else if (cfg.type === 'none') { /* no key: the extrusion alone */ }
          else if (cfg.type === 'plug' && sk && sk.column) {
            // (1.89) the cut is already extruded into a plug: a second plug on its floor added nothing and, on a steeply
            // tapered floor, came away as a slab of its own; the extruded plug is this line's plug
            // (1.97) but a plug chosen as the extra key is a key the owner looks for: the extrusion starts at the cut's
            // edge and carries on the piece's own slope, so it reads as the piece made longer, not as a key ("there are no
            // plugs or keys on the upper arm parts"). A smaller plug now stands on the extruded end, set in from its
            // edge, on the same piece (side 1, which the extrusion stands on: 'below' in the frame's terms through `curvedSideOf`), so the end steps down into its socket
            per.extruded = true;
            const endSide = curvedSideOf('below', an.curved.into2); // side 1 holds the extrusion
            const ecfg = { ...lcfg, pegSide: endSide, plugSlope: Math.max(lcfg.plugSlope || 5, cfg.sinkTaper || 0) }; // (sides as steep as the extrusion's, so it lifts out whichever way the extrusion does)
            let pl = []; try { pl = planPlugs(an, ecfg); } catch (err) { pl = []; }
            per.plugs = pl.filter(q => q.ok && q.depth >= 1);
            if (!per.plugs.length && ecfg.plugSlope > (lcfg.plugSlope || 5)) { // too steep to fit: the usual slope, kept only where the pieces part along the line's own axis
              ecfg.plugSlope = lcfg.plugSlope || 5; per.endLow = true;
              try { per.plugs = planPlugs(an, ecfg).filter(q => q.ok && q.depth >= 1); } catch (err) { per.plugs = []; }
            }
            if (per.plugs.length) {
              per.cfg = ecfg; per.onEnd = true;
              const H = an.curved.heightAt;
              for (const q of per.plugs) { let lo = Infinity, hi = -Infinity; for (const [x, y] of q.mouth) { const z = H(x, y); lo = Math.min(lo, z); hi = Math.max(hi, z); } draw.plugs.push({ base: q.base, top: q.top, z0: q.side > 0 ? lo : hi, tip: (q.side > 0 ? hi : lo) + q.side * q.depth }); }
            }
          } else if (cfg.type === 'plug') {
            const pl = planPlugs(an, lcfg);
            per.plugs = pl.filter(q => q.ok);
            if (!per.plugs.length && !out.noKeys && !tiny) out.noKeys = { code: 'plug', reason: (pl[0] || {}).reason || 'no room' };
            const H = an.curved.heightAt;
            for (const q of per.plugs) { let lo = Infinity, hi = -Infinity; for (const [x, y] of q.mouth) { const z = H(x, y); lo = Math.min(lo, z); hi = Math.max(hi, z); } draw.plugs.push({ base: q.base, top: q.top, z0: q.side > 0 ? lo : hi, tip: (q.side > 0 ? hi : lo) + q.side * q.depth }); }
          } else {
            const keys = req.sizeSet ? autoPlaceKeys(an, lcfg, req.perArea, new Set()) : autoFitKeys(an, lcfg, req.perArea, new Set());
            const ok = evaluateKeys(an, keys, lcfg, new Set());
            per.keys = keys.filter((k, i) => ok[i].ok);
            if (!per.keys.length && !out.noKeys && !tiny) out.noKeys = { code: 'room' };
            for (const k of per.keys) { const kc = keyCfg(lcfg, k); draw.keys.push({ k, angle: keyAngle(an.base, 0, kc), lv: keyLevels(an, lcfg, k) }); }
          }
        } catch (err) { out.frames.push(null); an = null; if (!out.noKeys) out.noKeys = { code: 'failed' }; }
        if (req.numberJoints && !per.plugs.length && an) { const jm = jointMarks(an.base, 0, per.keys, per.cfg || cfg, req.joint + out.perLoop.length, { mirror: false }); per.marks = jm ? jm.marks : []; }
        out.perLoop.push(per); out.draw.push(draw); out.keys += per.keys.length; out.plugs += per.plugs.length;
      }
    } else { out.perLoop = loops.map(() => ({ keys: [], plugs: [] })); out.draw = loops.map(() => ({ keys: [], plugs: [] })); }
    return out;
  }
  // The last word on whether a cut prints (the owner: "after any cut of any kind, the topology is physically
  // printable and does not have unprintably thin walls or parts"), whatever made the cut: every face the cut made
  // on each piece (triangles whose three corners are new: the cut face, sunk walls, plug and key walls), sampled
  // up to `samples` faces, casts a line straight into its piece (`castInward`) for the piece's thickness behind it.
  // The band within a wall of the cut's own edge is left out, as `thinAreas` leaves it out on flat cuts: where a
  // slanted surface meets the face the piece always tapers to its edge. A piece is too thin when two fifths or more
  // of the rest, and at least (2 walls)² of it, has less than a wall behind it (a shell, a lens, a lip round a
  // recess), or when the whole piece is smaller than a wall cubed (a crumb). Returns [{ part, thin, share, crumb }].
  function cutPrintCheck(Pin, parts, wall, opts = {}) {
    const out = [];
    if (!(wall > 0)) return out;
    const orig = new Set(); for (let i = 0; i < Pin.length; i += 3) orig.add(Pin[i] + ',' + Pin[i + 1] + ',' + Pin[i + 2]);
    const samples = opts.samples || 3000, cell = wall;
    parts.forEach((q, pi) => {
      const Q = q.positions, J = q.indices, nv = Q.length / 3, nt = J.length / 3, isNew = new Uint8Array(nv);
      const vol = q.volume !== undefined ? q.volume : volume(Q, J);
      if (Math.abs(vol) < wall * wall * wall) { out.push({ part: pi, thin: true, crumb: true, share: 1 }); return; }
      const hash = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
      for (let v = 0; v < nv; v++) {
        isNew[v] = orig.has(Q[3 * v] + ',' + Q[3 * v + 1] + ',' + Q[3 * v + 2]) ? 0 : 1;
        if (!isNew[v]) { const k = key(Math.floor(Q[3 * v] / cell), Math.floor(Q[3 * v + 1] / cell), Math.floor(Q[3 * v + 2] / cell)); let h = hash.get(k); if (!h) { h = []; hash.set(k, h); } h.push(v); }
      }
      const nearOld = (p) => { const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const h = hash.get(key(cx + i, cy + j, cz + k)); if (h) for (const v of h) if ((Q[3 * v] - p[0]) ** 2 + (Q[3 * v + 1] - p[1]) ** 2 + (Q[3 * v + 2] - p[2]) ** 2 < wall * wall) return true; } return false; };
      const fresh = []; for (let t = 0; t < nt; t++) if (isNew[J[3 * t]] && isNew[J[3 * t + 1]] && isNew[J[3 * t + 2]]) fresh.push(t);
      if (!fresh.length) { out.push({ part: pi, thin: false, share: 0 }); return; }
      const step = Math.max(1, Math.floor(fresh.length / samples)), grid = meshGrid(Q, J, 64), D = diag(bounds(Q));
      let A = 0, thinA = 0;
      for (let s = 0; s < fresh.length; s += step) {
        const t = fresh[s], a = J[3 * t], b = J[3 * t + 1], c = J[3 * t + 2];
        const ux = Q[3 * b] - Q[3 * a], uy = Q[3 * b + 1] - Q[3 * a + 1], uz = Q[3 * b + 2] - Q[3 * a + 2], wx = Q[3 * c] - Q[3 * a], wy = Q[3 * c + 1] - Q[3 * a + 1], wz = Q[3 * c + 2] - Q[3 * a + 2];
        const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx], L = Math.hypot(n[0], n[1], n[2]);
        if (!L) continue;
        n[0] /= L; n[1] /= L; n[2] /= L;
        const o = [0, 1, 2].map(k => (Q[3 * a + k] + Q[3 * b + k] + Q[3 * c + k]) / 3 - n[k] * 1e-5 * D);
        if (nearOld(o)) continue;
        const ar = L / 2, d = castInward(grid, Q, J, o, [-n[0], -n[1], -n[2]], 3 * wall);
        A += ar;
        if (d >= 0.02 * wall && d < wall) thinA += ar; // nearer than a fiftieth of a wall is a face touching its neighbour (a fit ring), not a wall
      }
      const share = A ? thinA / A : 0, thinMm2 = thinA * step;
      out.push({ part: pi, thin: share >= 0.4 && thinMm2 >= 4 * wall * wall, share, area: A * step });
    });
    return out;
  }
  // (1.83) Knife edges along a cut's rim (the owner: "super thin sharp edges"): where the cut face meets the surface at
  // a grazing angle the piece runs out to a blade thinner than anything prints. At each rim edge (between a face the
  // cut made and the original surface) the piece's inside angle is measured from the two sides' normals, each the
  // area-weighted normal of its side's triangles round the edge's ends (a sliced triangle at the rim can be a tilted
  // sliver); under `deg` (25°: a blade a `t` thick reaches over two `t` in) it is a knife edge, and a piece has one when
  // such edges run along at least 4·t of rim (shorter nicks are a corner of the cut, not a blade).
  // Returns [{ part, length, knife, rim, sharp, points }].
  function knifeEdges(Pin, parts, t, opts = {}) {
    const out = []; if (!(t > 0)) return out;
    const cosMax = Math.cos(Math.PI - ((opts.deg || 25) * Math.PI) / 180); // normals further apart than this: inside angle under `deg`
    const fr = Math.fround, orig = new Set(); for (let i = 0; i < Pin.length; i += 3) orig.add(fr(Pin[i]) + ',' + fr(Pin[i + 1]) + ',' + fr(Pin[i + 2])); // (float32 either side: a piece's positions may be stored narrower than the model's)
    parts.forEach((q, pi) => {
      const Q = q.positions, J = q.indices, nv = Q.length / 3, nt = J.length / 3, isNew = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) isNew[v] = orig.has(fr(Q[3 * v]) + ',' + fr(Q[3 * v + 1]) + ',' + fr(Q[3 * v + 2])) ? 0 : 1;
      const fresh = new Uint8Array(nt); for (let tr = 0; tr < nt; tr++) fresh[tr] = isNew[J[3 * tr]] && isNew[J[3 * tr + 1]] && isNew[J[3 * tr + 2]] ? 1 : 0;
      const tn = new Float64Array(3 * nt); for (let tr = 0; tr < nt; tr++) { const a = 3 * J[3 * tr], b = 3 * J[3 * tr + 1], c = 3 * J[3 * tr + 2]; const n = cross3([Q[b] - Q[a], Q[b + 1] - Q[a + 1], Q[b + 2] - Q[a + 2]], [Q[c] - Q[a], Q[c + 1] - Q[a + 1], Q[c + 2] - Q[a + 2]]); tn[3 * tr] = n[0]; tn[3 * tr + 1] = n[1]; tn[3 * tr + 2] = n[2]; } // (area-weighted)
      const vt = vertexTriangles(Q, J), pr = trianglePairs(J);
      const sideNormal = (v, want) => { let x = 0, y = 0, z = 0; for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const tr = vt.tri[j]; if (fresh[tr] === want) { x += tn[3 * tr]; y += tn[3 * tr + 1]; z += tn[3 * tr + 2]; } } return [x, y, z]; };
      const rimLen = new Map(), adj = new Map(), knife = new Set(); let total = 0, knifeLen = 0;
      for (let i = 0; i < pr.length; i += 4) {
        const a = pr[i], b = pr[i + 1]; if (fresh[a] === fresh[b]) continue;
        const va = pr[i + 2], vb = pr[i + 3], l = Math.hypot(Q[3 * va] - Q[3 * vb], Q[3 * va + 1] - Q[3 * vb + 1], Q[3 * va + 2] - Q[3 * vb + 2]);
        total += l; for (const [x, y] of [[va, vb], [vb, va]]) { rimLen.set(x, (rimLen.get(x) || 0) + l / 2); if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); }
        const f1 = sideNormal(va, 1), f2 = sideNormal(vb, 1), s1 = sideNormal(va, 0), s2 = sideNormal(vb, 0);
        const nf = norm3([f1[0] + f2[0], f1[1] + f2[1], f1[2] + f2[2]]), ns = norm3([s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]]);
        const dot = nf[0] * ns[0] + nf[1] * ns[1] + nf[2] * ns[2];
        if (dot >= cosMax) continue;
        // convex (a blade, not a crack): the surface triangle's far corner lies behind the cut face
        const s = fresh[a] ? b : a, o = [0, 1, 2].map(k => (Q[3 * J[3 * s] + k] + Q[3 * J[3 * s + 1] + k] + Q[3 * J[3 * s + 2] + k]) / 3);
        if ((o[0] - Q[3 * va]) * nf[0] + (o[1] - Q[3 * va + 1]) * nf[1] + (o[2] - Q[3 * va + 2]) * nf[2] > 0) continue;
        knife.add(va); knife.add(vb); knifeLen += l;
      }
      if (!total) { out.push({ part: pi, length: 0, knife: 0, rim: 0, sharp: false, points: opts.points ? [] : undefined }); return; }
      // the longest run of knife points along the rim
      // (1.92) each rim line's own length, so a run is judged against the line it is on: a blade counts from 4·t, and
      // from a twentieth of its line (a 3 mm nick on a 350 mm figure's 80 mm shoulder line had sent every cut back)
      const loopOf = new Map(), loopLen = []; for (const v0 of adj.keys()) { if (loopOf.has(v0)) continue; const id = loopLen.length; let len = 0; const st = [v0]; loopOf.set(v0, id); while (st.length) { const v = st.pop(); len += rimLen.get(v) || 0; for (const w of adj.get(v) || []) if (!loopOf.has(w)) { loopOf.set(w, id); st.push(w); } } loopLen.push(len); }
      const seen = new Set(); let longest = 0, sharp = false;
      for (const v0 of knife) { if (seen.has(v0)) continue; let run = 0; const st = [v0]; seen.add(v0); while (st.length) { const v = st.pop(); run += rimLen.get(v) || 0; for (const w of adj.get(v) || []) if (!seen.has(w) && knife.has(w)) { seen.add(w); st.push(w); } } longest = Math.max(longest, run); if (run >= Math.max(4 * t, Math.min(10 * t, 0.05 * (loopLen[loopOf.get(v0)] || 0)))) sharp = true; /* (never more than 10·t: a long blade counts on any line) */ }
      out.push({ part: pi, length: longest, knife: knifeLen, rim: total, sharp, points: opts.points ? [...knife] : undefined });
    });
    return out;
  }
  function printMessage(bad) {
    return bad.some(b => b.crumb) ? 'This cut leaves a crumb too small to print. Pick a little more, or cut somewhere else.'
      : 'This cut leaves a piece with walls thinner than the Wall setting behind its cut face, which won’t print well. Move the line, turn off Sink face, or pick a little more.';
  }
  // A pick planned (`planPickPieces`) and its pieces checked for printing (`cutPrintCheck`): a cut that would leave
  // a piece too thin is offered only forced, with the reason, as any thin refusal is
  const pickMeshOf = new WeakMap();
  function planPick(P0, I0, req0) {
    const out = planPickOnce(P0, I0, req0);
    // (1.87) a face stepped into the other piece can run its socket near that piece's far side; when the pieces
    // then fail the print check, the face is sunk as before (each point by the depth, no ledge) and that is kept if
    // it passes
    if (out.printCheck && req0.sink > 0 && req0.sinkStep !== false) {
      let alt = null; try { alt = planPickOnce(P0, I0, { ...req0, sinkStep: false, planned: null }); } catch (err) { alt = null; } // (its joints are planned again, on the face it makes)
      if (alt && alt.result && !alt.error && !alt.printCheck) return alt;
    }
    return out;
  }
  function planPickOnce(P0, I0, req0) {
    const out = planPickPieces(P0, I0, req0), P = pickMeshOf.get(out) || P0;
    if (out.result && !out.error && req0.minThickness > 0 && !req0.noPrintCheck) {
      let bad = [];
      try { bad = cutPrintCheck(P, out.result.parts, req0.minThickness).filter(b => b.thin); } catch (err) { bad = []; }
      if (bad.length) { out.printCheck = bad.map(b => ({ part: b.part, crumb: !!b.crumb, share: b.share })); if (!out.forced) out.forced = printMessage(bad); }
      else if (!req0.noKnifeCheck) { // (1.83) a blade-thin edge along the cut's rim
        let knives = []; try { knives = knifeEdges(P, out.result.parts, req0.minThickness).filter(k => k.sharp); } catch (err) { knives = []; }
        if (knives.length) {
          const mm = Math.round(Math.max(...knives.map(k => k.length)));
          out.printCheck = knives.map(k => ({ part: k.part, knife: true, length: k.length }));
          if (!out.forced) out.forced = `This cut leaves a knife-thin edge along about ${mm} mm of its rim, thinner than the Thinnest piece setting (${+req0.minThickness.toFixed(2)} mm), which will snap or not print. Move the line so it meets the surface more squarely, or pick a little more.`;
        }
      }
    }
    return out;
  }
  // (1.96) The cut may change a line's joint from the one planned (`cutAlongLoops`: a boss drafted to lift out along
  // the pieces' one way on in place of keys or a plug that would lock; keys left off a plug that leans). The pick's
  // per-line plan and what the app draws are brought in step with what was made (`result.jointsMade`, matched to the
  // pick's lines by position: the cut may take its lines in another order).
  function planPickPieces(P0, I0, req0) {
    const out = planPickPiecesRaw(P0, I0, req0), r = out.result, P = pickMeshOf.get(out) || P0;
    if (!r || !r.jointsMade || !out.loops) return out;
    const key = (x, y, z) => Math.fround(x) + ',' + Math.fround(y) + ',' + Math.fround(z);
    const sets = out.loops.map(l => new Set(l.verts.map(v => key(P[3 * v], P[3 * v + 1], P[3 * v + 2]))));
    const made = out.loops.map(() => null), plugsMade = out.loops.map(() => null);
    r.jointsMade.forEach((j, k) => { const i = sets.findIndex((s, i2) => !made[i2] && s.has(key(j.at[0], j.at[1], j.at[2]))); if (i >= 0) { made[i] = j; plugsMade[i] = (r.plugsMade || [])[k] || null; } });
    if (made.some(j => !j)) return out;
    r.jointsMade = made; r.plugsMade = plugsMade;
    out.perLoop = out.perLoop.map((per, i) => {
      const j = made[i], q = { ...per, made: j.kind, why: j.why || null, off: j.off || 0 };
      if (j.kind === 'boss') { Object.assign(q, { keys: [], plugs: j.plugs, inset: true, boss: true, draft: j.draft, cfg: j.cfg, extruded: false }); out.draw[i] = { keys: [], plugs: j.draw }; }
      else {
        if (!j.keys && (per.keys || []).length) { q.keys = []; out.draw[i] = { ...out.draw[i], keys: [] }; }
        if (j.kind !== 'plug' && !j.endPlugs && (per.plugs || []).length) { q.plugs = []; q.inset = false; out.draw[i] = { ...out.draw[i], plugs: [] }; }
        if (j.kind !== 'edge' && j.kind !== 'skew') { if (q.extruded) q.extruded = false; if (out.draw[i] && out.draw[i].sink) out.draw[i] = { ...out.draw[i], sink: null }; }
        else q.extruded = true;
      }
      return q;
    });
    out.keys = out.perLoop.reduce((n, per) => n + (per.keys || []).length, 0); out.plugs = out.perLoop.reduce((n, per) => n + (per.plugs || []).length, 0);
    const allMade = !out.perLoop.some(per => !per.tiny && per.why !== 'tiny' && !per.made);
    if (out.noKeys && allMade) out.noKeys = null;
    if (out.dropped && allMade) out.dropped = null; // (joints were left off as planned, and the cut gave every line one that lifts out)
    return out;
  }
  function planPickPiecesRaw(P0, I0, req0) {
    const { P, I, req } = pickMesh(P0, I0, req0); // the same eased lines as planJoints worked on (it is quick and comes out alike)
    const cfg = req.cfg, out = req.planned ? { ...req.planned, result: null, error: null, errorCode: null, forced: null, dropped: null } : planJoints(P, I, req), loops = out.loops;
    pickMeshOf.set(out, P);
    const run = (withJoints, force, only = -1) => { // only: the one line that keeps its joints
      const o = { cfg, minThickness: req.minThickness, force, sink: req.sink, sinkStep: req.sinkStep, perLoop: withJoints ? out.perLoop : loops.map((l, i) => (i === only ? out.perLoop[i] : { keys: [], plugs: [], pegSide: out.perLoop[i] && out.perLoop[i].pegSide, tiny: out.perLoop[i] && out.perLoop[i].tiny })) };
      if (req.regions) return splitRegions(P, I, req.seg, req.regions, o);
      if (loops.length > 1) return cutAlongLoops(P, I, loops, { ...o, what: 'lines' });
      const p0 = o.perLoop[0] || {};
      return cutAlongLoop(P, I, loops[0], { ...o, cfg: p0.inset && p0.cfg ? p0.cfg : p0.pegSide ? { ...cfg, pegSide: p0.pegSide } : cfg, keys: p0.keys, plugs: p0.plugs });
    };
    const dropJoints = (code) => { out.dropped = { code, what: out.plugs ? 'plug' : 'keys' }; out.keys = 0; out.plugs = 0; out.perLoop = loops.map(() => ({ keys: [], plugs: [] })); out.draw = loops.map(() => ({ keys: [], plugs: [] })); };
    // The cut is tried forced first: a forced cut builds the same pieces and turns the thin and locked refusals
    // into warnings, so its warnings say what an unforced cut would have refused, and the fallbacks below take
    // one run each instead of three (on the owner's figure a refused pick built its pieces nine times)
    let first = null;
    try { first = run(true, true); } catch (err) { first = null; }
    // joints must never make pieces of their own: a pocket that breaks through a thin wall nicks off a crumb
    // (a plug on one of the owner's Aysil limbs left a 0.01 cm³ scrap); then the joints go and the cut stands alone
    // (1.89) nor a piece of their own: a plug on a tapered plug's floor came away whole as a 29 cm³ slab, all of it new
    // faces, joined to neither piece; such a piece has no point of the model's surface
    let orig = null; const onlyNew = (q) => { if (!orig) { orig = new Set(); for (let i = 0; i < P.length; i += 3) orig.add(Math.fround(P[i]) + ',' + Math.fround(P[i + 1]) + ',' + Math.fround(P[i + 2])); } const Q = q.positions; for (let i = 0; i < Q.length; i += 3) if (orig.has(Math.fround(Q[i]) + ',' + Math.fround(Q[i + 1]) + ',' + Math.fround(Q[i + 2]))) return false; return true; };
    const crumbs = (r) => { const v = r.parts.map(q => Math.abs(q.volume)), tot = v.reduce((a, b) => a + b, 0); return v.some(x => x < 0.01 * tot && x < 0.2 * Math.min(...v.filter(y => y >= 0.01 * tot))) || r.parts.some(onlyNew); };
    if (first && (out.keys || out.plugs) && crumbs(first)) {
      let plain = null; try { plain = run(false, true); } catch (err) { plain = null; }
      if (plain && !crumbs(plain)) { first = plain; dropJoints('crumb'); }
    }
    const guards = (r) => (r.warnings || []).filter(w => w.code === 'thin' || w.code === 'locked');
    // (1.92) when joints on every line lock the pieces but the cut without any passes: the joints on one line may still
    // do (the longest that has any first): an arm that goes on along its book's plug keeps that plug and loses only the
    // stud on its shoulder
    const keepOne = () => {
      const withJ = out.perLoop.map((per, i) => i).filter(i => (out.perLoop[i].keys || []).length + (out.perLoop[i].plugs || []).length > 0).sort((a, b) => (loops[b].length || 0) - (loops[a].length || 0));
      if (withJ.length > 1) for (const i of withJ.slice(0, 2)) {
        let one = null; try { one = run(false, true, i); } catch (err) { one = null; }
        if (one && !guards(one).length && !crumbs(one)) {
          out.perLoop = out.perLoop.map((per, k) => (k === i ? per : { keys: [], plugs: [], pegSide: per.pegSide, tiny: per.tiny })); out.draw = out.draw.map((d, k) => (k === i ? d : { keys: [], plugs: [] }));
          out.keys = out.perLoop[i].keys.length; out.plugs = out.perLoop[i].plugs.length; out.dropped = { code: 'locked', what: out.plugs ? 'plug' : 'keys', some: true }; out.result = one; return true;
        }
      }
      return false;
    };
    if (first) {
      const w = guards(first);
      if (!w.length) { out.result = first; return out; }
      if ((out.keys || out.plugs) && !w.some(x => x.code === 'thin') && !w.some(x => x.code === 'locked' && !x.keyless)) { // (1.76: a piece held at both ends too, when it slides out along one of its joints without them) // locked with joints, and the same pieces would come apart at a slant without them: built again without the joints
        let second = null; try { second = run(false, true); } catch (err) { second = null; }
        if (second) { const w2 = guards(second); if (!w2.length && keepOne()) return out; dropJoints('locked'); out.result = second; if (w2.length) out.forced = w2[0].message; return out; }
      }
      // (1.92) locked with joints whichever way it is asked (a stud on an arm's flat end, where the arm only goes on
      // sideways with its book): if the same cut without the joints passes every check, that is the cut
      else if ((out.keys || out.plugs) && !w.some(x => x.code === 'thin')) {
        let second = null; try { second = run(false, true); } catch (err) { second = null; }
        if (second && !guards(second).length) {
          if (keepOne()) return out;
          dropJoints('locked'); out.result = second; return out;
        }
      }
      out.result = first; out.forced = w[0].message; return out;
    }
    try { out.result = run(true); }
    catch (err) {
      let failed = err, joints = true;
      if ((out.keys || out.plugs) && err.code !== 'thin') { // still offer the cut, without the joints
        joints = false;
        try { out.result = run(false); dropJoints(err.code); failed = null; } catch (e2) { failed = e2; }
      }
      // a printability refusal (too thin, or pieces that hook) can be overridden: the cut is offered anyway, with the warning
      if (failed && (failed.code === 'thin' || failed.code === 'locked')) {
        try { out.result = run(joints, true); if (!joints) dropJoints(err.code); out.forced = failed.message; } catch (e3) { failed = e3; }
      }
      if (failed && !out.result) { out.error = failed.message; out.errorCode = failed.code || null; }
    }
    return out;
  }
  // The region under a point on the surface: the triangle nearest it, by its centre (none when the point is far
  // from the surface).
  function regionAtPoint(P, I, seg, point) {
    let best = -1, bd = diag(bounds(P)) * 0.05;
    for (let t = 0; t < I.length / 3; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const d = Math.hypot((P[a] + P[b] + P[c]) / 3 - point[0], (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - point[1], (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - point[2]);
      if (d < bd) { bd = d; best = t; }
    }
    return best < 0 ? -1 : seg.groupOf[best];
  }

  // The borders as smooth curves for display: the border edges are chained into polylines (ending where three or
  // more regions meet), each chain is rounded by two passes of corner cutting (Chaikin), and the points are lifted
  // off the surface along the normals of the triangles beside them. Mesh-edge zigzags made the plain lines ugly.
  function regionBorderCurves(P, I, seg, lift, passes = 2) {
    const b = seg.borders, ne = b.length / 4, nv = P.length / 3;
    const nrm = new Float64Array(nv * 3), fn = [0, 0, 0], deg = new Int32Array(nv), adjE = new Map();
    for (let e = 0; e < ne; e++) {
      const va = b[4 * e + 2], vb = b[4 * e + 3];
      for (const t of [b[4 * e], b[4 * e + 1]]) { faceNormal(P, I, t, fn); for (const v of [va, vb]) { nrm[3 * v] += fn[0]; nrm[3 * v + 1] += fn[1]; nrm[3 * v + 2] += fn[2]; } }
      deg[va]++; deg[vb]++;
      if (!adjE.has(va)) adjE.set(va, []); if (!adjE.has(vb)) adjE.set(vb, []);
      adjE.get(va).push(e); adjE.get(vb).push(e);
    }
    const pt = (v) => { const l = Math.hypot(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]) || 1; return [P[3 * v] + (nrm[3 * v] / l) * lift, P[3 * v + 1] + (nrm[3 * v + 1] / l) * lift, P[3 * v + 2] + (nrm[3 * v + 2] / l) * lift]; };
    const used = new Uint8Array(ne), chains = [];
    const other = (e, v) => (b[4 * e + 2] === v ? b[4 * e + 3] : b[4 * e + 2]);
    const walk = (e0, v0) => { // from vertex v0 along edge e0 through degree-2 vertices
      const verts = [v0]; let e = e0, v = v0;
      while (true) {
        used[e] = 1; v = other(e, v); verts.push(v);
        if (deg[v] !== 2 || v === v0) break;
        const es = adjE.get(v); e = es[0] === e ? es[1] : es[0];
        if (used[e]) break;
      }
      return verts;
    };
    for (let v = 0; v < nv; v++) if (deg[v] && deg[v] !== 2) for (const e of adjE.get(v)) if (!used[e]) chains.push({ verts: walk(e, v), closed: false });
    for (let e = 0; e < ne; e++) if (!used[e]) { const verts = walk(e, b[4 * e + 2]); chains.push({ verts, closed: verts[0] === verts[verts.length - 1] }); } // loops with no junction
    const out = [];
    for (const ch of chains) {
      let pts = ch.verts.map(pt);
      if (ch.closed && pts.length > 1) pts.pop();
      for (let pass = 0; pass < passes && pts.length > 2; pass++) {
        const next = [];
        const n = pts.length, last = ch.closed ? n : n - 1;
        if (!ch.closed) next.push(pts[0]);
        for (let i = 0; i < last; i++) {
          const p = pts[i], q = pts[(i + 1) % n];
          next.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1], 0.75 * p[2] + 0.25 * q[2]]);
          next.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1], 0.25 * p[2] + 0.75 * q[2]]);
        }
        if (!ch.closed) next.push(pts[n - 1]);
        pts = next;
      }
      const n = pts.length, last = ch.closed ? n : n - 1;
      for (let i = 0; i < last; i++) { const p = pts[i], q = pts[(i + 1) % n]; out.push(p[0], p[1], p[2], q[0], q[1], q[2]); }
    }
    return new Float32Array(out);
  }
  // Border edges as line segments, nudged a hair off the surface so they draw on top of it.
  function regionBorderLines(P, I, seg, lift) {
    const b = seg.borders, out = new Float32Array((b.length / 4) * 6), N = (t) => {
      const a = 3 * I[3 * t], c = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2];
      return norm3(cross3([P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]]));
    };
    for (let i = 0, o = 0; i < b.length; i += 4) {
      const n0 = N(b[i]), n1 = N(b[i + 1]), n = norm3([n0[0] + n1[0], n0[1] + n1[1], n0[2] + n1[2]]);
      for (const v of [b[i + 2], b[i + 3]]) { out[o++] = P[3 * v] + n[0] * lift; out[o++] = P[3 * v + 1] + n[1] * lift; out[o++] = P[3 * v + 2] + n[2] * lift; }
    }
    return out;
  }

  /* ---------- cuts that can be printed and put together ----------
     Two rules: no cut may leave a piece too thin to print, and no cut may make pieces that couldn't be put
     together in the real world. */
  // Lines along a direction through a mesh. The triangles are projected across the direction (onto the plane's
  // u and v) and bucketed in a grid, so the heights where any such line meets the surface are quick to find.
  // Coordinates are measured from the world origin, so one grid serves every slide of the plane.
  function rayGrid(P, I, F) {
    const nv = P.length / 3, nt = I.length / 3, { u, v, n } = F;
    const Q = new Float64Array(nv * 3);
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (let i = 0; i < nv; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      const qx = x * u[0] + y * u[1] + z * u[2], qy = x * v[0] + y * v[1] + z * v[2];
      Q[3 * i] = qx; Q[3 * i + 1] = qy; Q[3 * i + 2] = x * n[0] + y * n[1] + z * n[2];
      if (qx < gx0) gx0 = qx; if (qx > gx1) gx1 = qx; if (qy < gy0) gy0 = qy; if (qy > gy1) gy1 = qy;
    }
    let len = 0;
    for (let t = 0; t < nt; t++) { const a = I[3 * t], b = I[3 * t + 1]; len += Math.hypot(Q[3 * a] - Q[3 * b], Q[3 * a + 1] - Q[3 * b + 1]); }
    let cell = Math.max(1e-6, (len / Math.max(1, nt)) * 2);
    while (((gx1 - gx0) / cell + 1) * ((gy1 - gy0) / cell + 1) > 4e6) cell *= 1.5;
    const nx = Math.floor((gx1 - gx0) / cell) + 1, ny = Math.floor((gy1 - gy0) / cell) + 1;
    // triangles bucketed by grid cell, packed into flat arrays: start[c] .. start[c + 1] in items
    const span = new Int32Array(nt * 4), start = new Uint32Array(nx * ny + 1);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const x0 = Math.floor((Math.min(Q[a], Q[b], Q[c]) - gx0) / cell), x1 = Math.floor((Math.max(Q[a], Q[b], Q[c]) - gx0) / cell);
      const y0 = Math.floor((Math.min(Q[a + 1], Q[b + 1], Q[c + 1]) - gy0) / cell), y1 = Math.floor((Math.max(Q[a + 1], Q[b + 1], Q[c + 1]) - gy0) / cell);
      span[4 * t] = x0; span[4 * t + 1] = x1; span[4 * t + 2] = y0; span[4 * t + 3] = y1;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 250000) { span[4 * t + 1] = x0 - 1; continue; } // a degenerate sliver seen edge-on: it covers no area
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) start[x * ny + y + 1]++;
    }
    for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
    const items = new Uint32Array(start[nx * ny]), fill = start.slice(0, nx * ny);
    for (let t = 0; t < nt; t++) for (let x = span[4 * t]; x <= span[4 * t + 1]; x++) for (let y = span[4 * t + 2]; y <= span[4 * t + 3]; y++) items[fill[x * ny + y]++] = t;
    return { Q, I, cell, gx0, gy0, nx, ny, start, items, F };
  }
  // Where the line through (X, Y) runs through solid material: [from, to, from, to, ...] as heights along n from
  // the world origin, lowest first. Each crossing counts in or out by which way the surface faces, so a shell
  // overlapping another (an eye set into a head) doesn't read as a gap.
  function solidRuns(g, X, Y) {
    const out = [], cx = Math.floor((X - g.gx0) / g.cell), cy = Math.floor((Y - g.gy0) / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.nx || cy >= g.ny) return out;
    const Q = g.Q, I = g.I, c = cx * g.ny + cy, hits = [];
    for (let k = g.start[c], e = g.start[c + 1]; k < e; k++) {
      const t = g.items[k];
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c3 = 3 * I[3 * t + 2];
      const x1 = Q[b] - Q[a], y1 = Q[b + 1] - Q[a + 1], x2 = Q[c3] - Q[a], y2 = Q[c3 + 1] - Q[a + 1], den = x1 * y2 - x2 * y1;
      if (Math.abs(den) < 1e-14) continue;
      const s = ((X - Q[a]) * y2 - x2 * (Y - Q[a + 1])) / den, w = (x1 * (Y - Q[a + 1]) - (X - Q[a]) * y1) / den;
      if (s < 0 || w < 0 || s + w > 1) continue;
      hits.push([Q[a + 2] + s * (Q[b + 2] - Q[a + 2]) + w * (Q[c3 + 2] - Q[a + 2]), den > 0 ? -1 : 1]); // facing along n: going up, you leave
    }
    hits.sort((p, q) => p[0] - q[0]);
    let w = 0, from = 0;
    for (let i = 0; i < hits.length; i++) {
      if (i && hits[i][1] === hits[i - 1][1] && hits[i][0] - hits[i - 1][0] < 1e-9) continue; // a line through a shared edge crosses once
      const before = w; w += hits[i][1];
      if (before <= 0 && w > 0) from = hits[i][0]; else if (before > 0 && w <= 0) out.push(from, hits[i][0]);
    }
    return out;
  }
  let lastRays = null; // the grid for the latest part and direction, kept while the plane only slides
  function raysFor(P, I, F) {
    const key = [...F.u, ...F.v].map(x => x.toFixed(9)).join(',');
    if (!lastRays || lastRays.P !== P || lastRays.I !== I || lastRays.key !== key) lastRays = { P, I, key, g: rayGrid(P, I, F) };
    return lastRays.g;
  }
  // The areas whose piece on one side would be too thin to print: thinner than t over most of the area (a cut
  // that skims a bump or runs along a thin plate leaves a flake). The thin band along the edge of any slanted cut is
  // left out: every cut that meets the surface at an angle has one, and it prints as an ordinary sharp edge.
  // Returns [{region, side, thinnest}], side -1 for below the plane and +1 for above.
  function thinAreas(an, t, skip) {
    const src = an._src;
    if (!src || an.base.error || !(t > 0)) return [];
    const F = an.frame, g = raysFor(src.P, src.I, F);
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2], oz = F.o[0] * F.n[0] + F.o[1] * F.n[1] + F.o[2] * F.n[2];
    const out = [];
    an.base.regions.forEach((reg, ri) => {
      if ((skip && skip.has(ri)) || reg.nested || reg.inverted) return;
      const pts = regionSamples(an.base, ri, 300);
      const cellArea = reg.area / pts.length;
      for (const side of [-1, 1]) {
        let n = 0, thin = 0, inner = 0, thinnest = Infinity;
        for (const q of pts) {
          const r = solidRuns(g, q.x + ox + 1.3e-7, q.y + oy + 0.7e-7);
          let k = 0; while (k < r.length && r[k + 1] < oz) k += 2;
          if (k >= r.length || r[k] > oz) continue; // a flaw in the surface here; nothing to measure
          const d = side > 0 ? r[k + 1] - oz : oz - r[k];
          n++;
          if (d < t) { thin++; if (q.clear >= t) inner++; }
          if (d < thinnest) thinnest = d;
        }
        if (!n) continue;
        if (thin === n || inner * cellArea >= Math.max(Math.PI * t * t, 0.4 * reg.area)) out.push({ region: ri, side, thinnest: Math.max(0, thinnest) });
      }
    });
    return out;
  }
  // How thick two pieces are where they meet, measured along F.n at points across the joint (x, y in F's frame).
  // The joint is where a hit on one piece meets a hit on the other. Returns [{a, b}] or null where they don't meet.
  function jointThickness(A, B, F, pts, tol) {
    const ga = rayGrid(A.positions, A.indices, F), gb = rayGrid(B.positions, B.indices, F);
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2];
    const span = (r, i) => (i & 1 ? r[i] - r[i - 1] : r[i + 1] - r[i]); // the solid run that ends (or starts) there
    return pts.map(q => {
      const X = q.x + ox + 1.3e-7, Y = q.y + oy + 0.7e-7, ra = solidRuns(ga, X, Y), rb = solidRuns(gb, X, Y);
      for (let i = 0; i < ra.length; i++) for (let j = 0; j < rb.length; j++) {
        if ((i & 1) === (j & 1) || Math.abs(ra[i] - rb[j]) > tol) continue; // one piece's run ends where the other's starts
        return { a: span(ra, i), b: span(rb, j) };
      }
      return null;
    });
  }
  // Can A and B be pulled a distance D apart along d, one way or the other, without either passing through the
  // other? Checked in columns along d, on a grid across it (set slightly off the grid so no column runs exactly down
  // an edge): in each column the solid stretches of A and of B are compared. A clash only counts where it's deeper
  // than 0.05 mm and at least three columns wide: smaller ones are slivers where a cut face meets the surface at a
  // glancing angle, far finer than anything a printer makes. Pieces that already overlap over a wide patch are one
  // solid modelled inside another (a pin inside a leg): they print as one, so there's nothing to pull apart.
  // a piece's ray grid along a direction, kept with the piece: the lock check asks for the same piece and the
  // same direction once per pair it is in, and building the grid was half the cost of a pick on a big figure
  const rayGridCache = new WeakMap();
  function pieceRayGrid(A, F) {
    let m = rayGridCache.get(A.indices); if (!m) { m = new Map(); rayGridCache.set(A.indices, m); }
    const key = F.n.map(x => x.toFixed(6)).join(',');
    let g = m.get(key); if (!g) { g = rayGrid(A.positions, A.indices, F); m.set(key, g); }
    return g;
  }
  function slidesApart(A, B, d, tol, D, step) {
    const F = frameFromNormal(norm3(d), [0, 0, 0]);
    const ga = pieceRayGrid(A, F), gb = pieceRayGrid(B, F);
    const box = (g) => [g.gx0, g.gy0, g.gx0 + g.nx * g.cell, g.gy0 + g.ny * g.cell];
    const ba = box(ga), bb = box(gb), x0 = Math.max(ba[0], bb[0]), y0 = Math.max(ba[1], bb[1]), x1 = Math.min(ba[2], bb[2]), y1 = Math.min(ba[3], bb[3]);
    if (x1 <= x0 || y1 <= y0) return true;
    // (1.76) a clash counts from 0.05 mm, or a quarter of a percent of the pair's size: printed plastic gives that much, and on
    // a figure scaled to 150 mm a hook of a tenth of a millimetre on an arm against the body had refused every split
    const s0 = Math.max(step, Math.sqrt(((x1 - x0) * (y1 - y0)) / 30000)), grip = Math.max(tol, 0.05, 0.0025 * Math.hypot(x1 - x0, y1 - y0));
    const scan = (s) => {
      const nx = Math.ceil((x1 - x0) / s) + 1, ny = Math.ceil((y1 - y0) / s) + 1;
      const fwd = new Uint8Array(nx * ny), back = new Uint8Array(nx * ny), rest = new Uint8Array(nx * ny);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const X = x0 + (i + 0.0137) * s, Y = y0 + (j + 0.0291) * s;
        const ra = solidRuns(ga, X, Y), rb = solidRuns(gb, X, Y);
        if (!ra.length || !rb.length) continue;
        for (let p = 0; p < ra.length; p += 2) for (let q = 0; q < rb.length; q += 2) {
          const a0 = ra[p], a1 = ra[p + 1], b0 = rb[q], b1 = rb[q + 1];
          if (Math.min(a1 + D, b1) - Math.max(a0, b0) > grip) fwd[i * ny + j] = 1; // A moving ahead would run into this stretch of B
          if (Math.min(a1, b1) - Math.max(a0 - D, b0) > grip) back[i * ny + j] = 1; // and moving back
          if (Math.min(a1, b1) - Math.max(a0, b0) > grip) rest[i * ny + j] = 1; // they overlap where they are
        }
      }
      // a clash at least `r` columns out each way from a column (r = 1: three columns across, the sliver rule)
      const wide = (m, r = 1) => {
        for (let i = r; i + r < nx; i++) for (let j = r; j + r < ny; j++) {
          let all = true;
          for (let k = -r; k <= r && all; k++) if (!m[(i + k) * ny + j] || !m[i * ny + j + k]) all = false;
          if (all) return true;
        }
        return false;
      };
      return { fwd, back, rest, wide, any: (m) => m.some(Boolean) };
    };
    // a quarter of the columns first: pieces that plainly come apart (nothing in the way one way or the other) or
    // plainly clash (a clash five columns across, wider than any sliver at the fine spacing) are settled there; only
    // the close calls are looked at column by column (the owner's 500k-triangle doll spent two minutes a pick here)
    const c = scan(2 * s0);
    if (!c.any(c.fwd) || !c.any(c.back) || c.wide(c.rest, 2)) return true;
    if (c.wide(c.fwd, 2) && c.wide(c.back, 2) && !c.any(c.rest)) return false;
    const f = scan(s0);
    return !f.wide(f.fwd) || !f.wide(f.back) || f.wide(f.rest);
  }
  // Pairs of pieces that touch but can't be pulled apart: they'd hook round each other. Keys set the direction
  // (straight along d); with no keys a slant up to 40° from it is allowed too, and any other directions given
  // (such as from one piece's middle to the other's, along a limb). anyDirection may be a test of the pair. The
  // pieces must come apart by D (the longest key, or a few millimetres) before anything is in the way.
  function lockedPairs(parts, d, tol, opts = {}) {
    const out = [], straight = [norm3(d)], D = opts.distance || 3, step = opts.step || 0.2;
    const slanted = [...straight, ...(opts.also || []).map(norm3)], F = frameFromNormal(norm3(d), [0, 0, 0]);
    for (const deg of [20, 40]) for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + (deg === 40 ? Math.PI / 4 : 0), s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
      slanted.push([0, 1, 2].map(i => F.n[i] * c + (F.u[i] * Math.cos(a) + F.v[i] * Math.sin(a)) * s));
    }
    const box = (q) => q.bbox || bounds(q.positions);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i], B = parts[j];
      if (opts.only && !opts.only(A, B)) continue;
      const ba = box(A), bb = box(B);
      if (!ba.min.every((v, k) => v <= bb.max[k] + tol) || !bb.min.every((v, k) => v <= ba.max[k] + tol)) continue;
      const any = typeof opts.anyDirection === 'function' ? opts.anyDirection(A, B) : opts.anyDirection;
      if (!(any ? slanted : straight).some(e => slidesApart(A, B, e, tol, D, step))) out.push([i, j]);
    }
    return out;
  }
  // The areas listed in the interface (and numbered there, in this order): specks and void specks are left out.
  function shownRegions(regions) { const out = []; regions.forEach((r, i) => { if (!r.inverted && r.area >= 0.05) out.push(i); }); return out; }
  function areaNames(regions, list) {
    const shown = shownRegions(regions), nums = list.map(i => shown.indexOf(i) + 1).filter(k => k > 0).sort((a, b) => a - b);
    if (!nums.length) return 'a small area';
    return nums.length === 1 ? `area ${nums[0]}` : `areas ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
  }
  // In the interface's terms: the solid half is below the plane (side -1), the clear half above it.
  function thinMessage(regions, thin, t) {
    const mm = +t.toFixed(2), areas = [...new Set(thin.map(q => q.region))], sides = new Set(thin.map(q => q.side));
    const where = sides.size > 1 ? 'on both sides' : sides.has(1) ? 'on the clear side' : 'on the solid side';
    if (shownRegions(regions).length <= 1) return `This cut would leave a sliver thinner than ${mm} mm ${where}, too thin to print. Move the cut deeper into the model.`;
    return `Cutting ${areaNames(regions, areas)} would leave a sliver thinner than ${mm} mm ${where}, too thin to print. Move the cut deeper into the model, or leave ${areas.length > 1 ? 'those areas' : 'that area'} joined.`;
  }


  /* ---------- plugs ----------
     A plug is the cut face itself, pulled in from the edge by a wall, standing out from one piece into a matching
     pocket in the other: one per area, the way professional kits join large parts. Its outline is found on a fine
     grid: how far each point is from the area's edge, keep what's at least a wall (and the gap) in, round off narrow
     necks and sharp corners so no wall goes thin, trace it and smooth it. The top and the pocket are offsets of
     that outline, point for point, so all four rings pair up. */
  // squared distances, in cells, from every cell to the nearest site (cells holding 0); others hold 1e20
  function dt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  function distanceField(site, nx, ny) {
    const g = new Float64Array(nx * ny), L = Math.max(nx, ny), f = new Float64Array(L), d = new Float64Array(L), v = new Int32Array(L), z = new Float64Array(L + 1);
    for (let i = 0; i < nx * ny; i++) g[i] = site[i] ? 0 : 1e20;
    for (let x = 0; x < nx; x++) { for (let y = 0; y < ny; y++) f[y] = g[x * ny + y]; dt1(f, ny, d, v, z); for (let y = 0; y < ny; y++) g[x * ny + y] = d[y]; }
    for (let y = 0; y < ny; y++) { for (let x = 0; x < nx; x++) f[x] = g[x * ny + y]; dt1(f, nx, d, v, z); for (let x = 0; x < nx; x++) g[x * ny + y] = Math.sqrt(d[x]); }
    return g;
  }
  // the zero line of a field sampled at cell centres (positive inside), as closed loops of points
  function contourLoops(f, nx, ny, x0, y0, h) {
    const pt = new Map(), next = new Map();
    const P = (i, j) => [x0 + (i + 0.5) * h, y0 + (j + 0.5) * h];
    const edgePoint = (i0, j0, i1, j1) => { // where the zero crossing sits on the edge between two cell centres
      const key = i0 === i1 ? `v${i0},${Math.min(j0, j1)}` : `h${Math.min(i0, i1)},${j0}`;
      if (!pt.has(key)) { const a = f[i0 * ny + j0], b = f[i1 * ny + j1], t = a / (a - b), p = P(i0, j0), q = P(i1, j1); pt.set(key, [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      return key;
    };
    for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
      const a = f[i * ny + j] > 0, b = f[(i + 1) * ny + j] > 0, c = f[(i + 1) * ny + j + 1] > 0, d = f[i * ny + j + 1] > 0;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const S = () => edgePoint(i, j, i + 1, j), E = () => edgePoint(i + 1, j, i + 1, j + 1), N = () => edgePoint(i, j + 1, i + 1, j + 1), W = () => edgePoint(i, j, i, j + 1);
      // segments run with the inside on their left (corners a, b, c, d go anticlockwise from the lower left)
      const seg = (p, q) => next.set(p, q);
      switch (code) {
        case 1: seg(W(), S()); break; case 2: seg(S(), E()); break; case 3: seg(W(), E()); break;
        case 4: seg(E(), N()); break; case 6: seg(S(), N()); break; case 7: seg(W(), N()); break;
        case 8: seg(N(), W()); break; case 9: seg(N(), S()); break; case 11: seg(N(), E()); break;
        case 12: seg(E(), W()); break; case 13: seg(E(), S()); break; case 14: seg(S(), W()); break;
        case 5: { const mid = a + c > 0 && (f[i * ny + j] + f[(i + 1) * ny + j] + f[(i + 1) * ny + j + 1] + f[i * ny + j + 1]) > 0; if (mid) { seg(W(), N()); seg(E(), S()); } else { seg(W(), S()); seg(E(), N()); } break; }
        case 10: { const mid = (f[i * ny + j] + f[(i + 1) * ny + j] + f[(i + 1) * ny + j + 1] + f[i * ny + j + 1]) > 0; if (mid) { seg(S(), W()); seg(N(), E()); } else { seg(S(), E()); seg(N(), W()); } break; }
      }
    }
    const loops = [], used = new Set();
    for (const start of next.keys()) {
      if (used.has(start)) continue;
      const loop = []; let k = start;
      while (k !== undefined && !used.has(k)) { used.add(k); loop.push(pt.get(k)); k = next.get(k); }
      if (loop.length >= 3 && k === start) loops.push(loop);
    }
    return loops;
  }
  const outlineArea = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  // points spread evenly along a closed outline, then smoothed a little to take the grid's stair-steps out
  // (1.97) No key may turn in its socket (the owner: "no plug or key can be perfectly or nearly circular. the point is
  // that the keys would hold the part in place and prevent twisting"). A plug's outline that is nearly round (4πA/L²
  // over `limit`, 0.9: a rounded square is 0.85 and holds by its corners) gets a flat: the ring is cut by a chord a third of the way in from its far side, the way a D-shaped
  // shaft is, and spread back to as many points as it had. Anything else comes back as it was.
  function antiTwist(ring, limit = 0.9) {
    const n = ring.length; if (n < 8) return ring;
    let A = 0, L = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n], cr = a[0] * b[1] - b[0] * a[1]; A += cr; cx += (a[0] + b[0]) * cr; cy += (a[1] + b[1]) * cr; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    A /= 2; if (!(Math.abs(A) > 0)) return ring; cx /= 6 * A; cy /= 6 * A;
    if (4 * Math.PI * Math.abs(A) / (L * L) < limit) return ring;
    let far = -1, fx = 1, fy = 0, rmin = Infinity;
    for (const [x, y] of ring) { const r = Math.hypot(x - cx, y - cy); if (r > far) { far = r; fx = (x - cx) / r; fy = (y - cy) / r; } rmin = Math.min(rmin, r); }
    const h = rmin * 0.45; // the flat: 0.45 of the smallest radius out from the middle, towards the farthest point
    const side = (p) => (p[0] - cx) * fx + (p[1] - cy) * fy - h, out = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], sa = side(a), sb = side(b);
      if (sa <= 0) out.push(a);
      if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    return out.length >= 4 ? evenRing(out, n) : ring;
  }
  function evenRing(pts, n) {
    const L = [0]; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const per = L[pts.length], out = [];
    for (let k = 0, i = 0; k < n; k++) {
      const s = (k / n) * per; while (L[i + 1] < s) i++;
      const a = pts[i], b = pts[(i + 1) % pts.length], t = (s - L[i]) / ((L[i + 1] - L[i]) || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    for (let pass = 0; pass < 2; pass++) { const c = out.map(p => [p[0], p[1]]); for (let i = 0; i < n; i++) { const a = c[(i + n - 1) % n], b = c[(i + 1) % n]; out[i] = [c[i][0] * 0.5 + (a[0] + b[0]) * 0.25, c[i][1] * 0.5 + (a[1] + b[1]) * 0.25]; } }
    return out;
  }
  // an anticlockwise outline moved out (d > 0) or in (d < 0) by d at right angles, point for point
  function offsetRing(pts, d) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      let ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; const n1 = [ey / l, -ex / l];
      ex = c[0] - b[0]; ey = c[1] - b[1]; l = Math.hypot(ex, ey) || 1; const n2 = [ey / l, -ex / l];
      let bx = n1[0] + n2[0], by = n1[1] + n2[1]; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      const s = d / Math.max(0.5, bx * n1[0] + by * n1[1]);
      out.push([b[0] + bx * s, b[1] + by * s]);
    }
    return out;
  }
  // A flat end (a plug's top, a pocket's floor) as triangles over vertex ids, all facing +n (up) or -n. The facing
  // is set for the whole outline at once: earcut leaves slivers where points line up, and a sliver's own normal
  // can't be trusted.
  function endCap(ids, pts, up) {
    const flat = flatOf(pts), loc = earcut(flat, []), out = [];
    let sum = 0; for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
    const flip = up ? sum < 0 : sum > 0;
    for (let i = 0; i < loc.length; i += 3) { if (flip) out.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]); else out.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]); }
    return out;
  }
  const flatOf = (pts) => { const o = new Float64Array(pts.length * 2); pts.forEach((p, i) => { o[2 * i] = p[0]; o[2 * i + 1] = p[1]; }); return o; };
  const ringOk = (pts) => outlineArea(pts) > 0 && !findSelfCrossings(flatOf(pts)).length;
  // The plug's outline for one area, before any slope or gap: at least `inset` in from the edge everywhere, with
  // narrow parts and corners rounded to radius `round`. Returns { ring (anticlockwise), x, y (its deepest point),
  // inradius } or { reason }.
  function plugShape(sec, ri, inset, round) {
    const reg = sec.regions[ri];
    if (reg.holes.length || (reg.islands && reg.islands.length)) return { reason: 'Area has a hole through it' };
    const xy = sec.loops[reg.outer].xy, [bx0, by0, bx1, by1] = reg.bbox;
    const h = Math.max(Math.max(bx1 - bx0, by1 - by0) / 160, 0.02), pad = 3;
    const nx = Math.ceil((bx1 - bx0) / h) + 2 * pad, ny = Math.ceil((by1 - by0) / h) + 2 * pad, x0 = bx0 - pad * h, y0 = by0 - pad * h;
    // which cells are inside the area: a scanline fill against its outline
    const inside = new Uint8Array(nx * ny), nr = xy.length / 2;
    for (let j = 0; j < ny; j++) {
      const y = y0 + (j + 0.5) * h, xs = [];
      for (let i = 0, k = nr - 1; i < nr; k = i++) { const ay = xy[2 * k + 1], by = xy[2 * i + 1]; if ((ay > y) !== (by > y)) xs.push(xy[2 * k] + (y - ay) / (by - ay) * (xy[2 * i] - xy[2 * k])); }
      xs.sort((a, b) => a - b);
      for (let s = 0; s + 1 < xs.length; s += 2) for (let i = Math.max(0, Math.ceil((xs[s] - x0) / h - 0.5)); i < nx && x0 + (i + 0.5) * h <= xs[s + 1]; i++) inside[i * ny + j] = 1;
    }
    const D = distanceField(inside.map(v => 1 - v), nx, ny); // cells from the edge (to the nearest outside cell)
    const deep = inset / h + 0.5 + round / h, core = new Uint8Array(nx * ny);
    let any = false;
    for (let i = 0; i < nx * ny; i++) if (inside[i] && D[i] >= deep) { core[i] = 1; any = true; }
    if (!any) return { reason: 'Area too small for a plug' };
    const E = distanceField(core, nx, ny); // cells from the core; the plug is the core grown back by `round`
    const r = round / h, plug = new Uint8Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) if (E[i] <= r) plug[i] = 1;
    // keep the biggest connected piece
    const comp = new Int32Array(nx * ny).fill(-1), sizes = [];
    for (let s = 0; s < nx * ny; s++) {
      if (!plug[s] || comp[s] >= 0) continue;
      const id = sizes.length, st = [s]; comp[s] = id; let cnt = 0;
      while (st.length) { const c = st.pop(); cnt++; const i = Math.floor(c / ny), j = c % ny; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = a * ny + b; if (plug[q] && comp[q] < 0) { comp[q] = id; st.push(q); } } }
      sizes.push(cnt);
    }
    const best = sizes.indexOf(Math.max(...sizes));
    const f = new Float64Array(nx * ny);
    let deepest = -1, dx = 0, dy = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const c = i * ny + j;
      f[c] = comp[c] === best ? r - E[c] : -Math.max(0.5, E[c] - r);
      if (comp[c] === best && D[c] > deepest) { deepest = D[c]; dx = x0 + (i + 0.5) * h; dy = y0 + (j + 0.5) * h; }
    }
    const loops = contourLoops(f, nx, ny, x0, y0, h);
    if (!loops.length) return { reason: 'Area too small for a plug' };
    let outer = loops[0]; for (const L of loops) if (Math.abs(outlineArea(L)) > Math.abs(outlineArea(outer))) outer = L;
    if (outlineArea(outer) < 0) outer.reverse();
    let per = 0; for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const ring = evenRing(outer, Math.max(24, Math.min(360, Math.round(per / Math.max(h * 1.5, 0.15)))));
    return { ring, x: dx, y: dy, inradius: Math.max(0, (deepest - 0.5) * h - inset), h };
  }
  /* The plugs for a cut, one per area that's cut. Depth is as deep as fits, up to half the plug's narrower width
     (2 to 10 mm), or the depth set; the pocket is checked along lines through the model so it never breaks out, and
     a shallower plug is used where the other piece is thin. The sides slope by cfg.plugSlope degrees (5 by
     default) so it seats easily, and the pocket follows the slope with the fit gap held at right angles to it.
     Returns [{ region, ok, reason, x, y, base, top, mouth, floor, depth, side }], side being the pocket's side. */
  function planPlugs(an, cfg, skip) {
    const out = [];
    if (cfg.type !== 'plug' || !an || an.base.error) return out;
    const sec = an.base, m = cfg.margin, c = cfg.clearance, ca = c + 0.1, floorT = Math.max(0.8, m * 0.75);
    const tanS = Math.tan((Math.max(0, Math.min(cfg.plugSlopeMax > 30 ? cfg.plugSlopeMax : 30, cfg.plugSlope === undefined ? 5 : cfg.plugSlope)) * Math.PI) / 180), gs = c * Math.sqrt(1 + tanS * tanS);
    const S = cfg.pegSide === 'above' ? -1 : +1, round = Math.max(1, m);
    const src = an._src, F = an.frame, H = an.curved ? an.curved.heightAt : () => 0;
    const g = src ? raysFor(src.P, src.I, F) : null;
    const ox = F.o[0] * F.u[0] + F.o[1] * F.u[1] + F.o[2] * F.u[2], oy = F.o[0] * F.v[0] + F.o[1] * F.v[1] + F.o[2] * F.v[2], oz = F.o[0] * F.n[0] + F.o[1] * F.n[1] + F.o[2] * F.n[2];
    // how far solid runs from the face at (x, y) into the pocket's side, past `level` (-Infinity: none there at all)
    const past = (x, y, level) => {
      if (!g) return Infinity;
      const r = solidRuns(g, x + ox + 1.3e-7, y + oy + 0.7e-7), cz = H(x, y) + oz + S * 1e-4;
      for (let i = 0; i < r.length; i += 2) if (r[i] <= cz && cz <= r[i + 1]) return S > 0 ? r[i + 1] - oz - level : level - (r[i] - oz);
      return -Infinity;
    };
    // one try at a plug pulled in by `inset`: its outline and how deep its pocket can go
    const attempt = (ri, inset) => {
      let sh = plugShape(sec, ri, inset, round);
      // a small area (a miniature's arm, 4 mm across) has no room for corners rounded a millimetre: rounded less
      if (sh.reason === 'Area too small for a plug' && round > 0.45) sh = plugShape(sec, ri, inset, Math.max(0.4, 0.5 * m));
      if (!sh.reason && !ringOk(sh.ring)) sh = plugShape(sec, ri, inset, round * 2); // a crossing outline: round it more
      if (!sh.reason && !ringOk(sh.ring)) return { reason: 'Area too irregular for a plug' };
      if (sh.reason) return sh;
      const base = cfg.round === true ? sh.ring : antiTwist(sh.ring), mouth = offsetRing(base, gs); // (1.97) never a round plug: it could turn
      let lo = Infinity, hi = -Infinity;
      for (const q of mouth) { const z = H(q[0], q[1]); lo = Math.min(lo, z); hi = Math.max(hi, z); }
      const from = S > 0 ? hi : lo;
      // the deepest the pocket can go: solid past its floor everywhere inside it, and solid round its walls to the floor
      let room = Infinity;
      const xs = base.map(q => q[0]), ys = base.map(q => q[1]), qx0 = Math.min(...xs), qx1 = Math.max(...xs), qy0 = Math.min(...ys), qy1 = Math.max(...ys);
      const step = Math.max(sh.h * 2, Math.sqrt(((qx1 - qx0) * (qy1 - qy0)) / 60)), fb = flatOf(base), inner = [[sh.x, sh.y]];
      for (let x = qx0 + step / 2; x < qx1; x += step) for (let y = qy0 + step / 2; y < qy1; y += step) if (pointInRing(fb, x, y)) inner.push([x, y]);
      for (const [x, y] of inner) room = Math.min(room, past(x, y, from) - ca - floorT);
      const band = offsetRing(base, gs + 0.75 * m), every = Math.max(1, Math.floor(band.length / 48));
      for (let i = 0; i < band.length; i += every) room = Math.min(room, past(band[i][0], band[i][1], from) - ca);
      const want = cfg.plugDepthMode === 'set' && cfg.plugDepth > 0 ? cfg.plugDepth : Math.max(2, Math.min(10, sh.inradius));
      return { ...sh, base, mouth, room, want, depth: Math.min(want, room) };
    };
    for (const ri of shownRegions(sec.regions)) {
      if (skip && skip.has(ri)) continue;
      if (sec.regions[ri].nested) continue;
      // A plug that fills the face can only be shallow where the other piece thins towards its edge (any rounded
      // part), so try it pulled further in too, and keep the one that goes deepest, up to the depth wanted.
      let best = null, why = null;
      for (const k of [1, 1.5, 2, 3, 4, 6]) {
        const a = attempt(ri, m * k + gs);
        if (a.reason) { why = why || a.reason; break; } // pulled in further it only gets smaller
        if (!(a.room > -Infinity)) { why = 'A pocket would break out of the other piece here'; continue; }
        if (!best || a.depth > best.depth + 0.05) best = a;
        if (a.depth >= a.want - 1e-6) break;
      }
      if (!best || best.depth < 1) { out.push({ region: ri, ok: false, reason: best && best.depth > -Infinity ? 'The other piece is too thin here for a plug' : why || 'Area too small for a plug' }); continue; }
      const { base, mouth, want } = best;
      // the sloping sides move the top in by depth × tan(slope): where that folds a concave corner over itself, a
      // shallower plug is used instead of none
      let depth = best.depth, top, floor, fine = false;
      if (tanS > 0.6 && best.inradius > 0) depth = Math.min(depth, Math.max(1, 0.6 * best.inradius / tanS)); // (1.96) a steeply drafted boss ends in a top at least two fifths as wide as its base
      for (let tries = 0; tries < 8 && depth >= 1; tries++) {
        top = offsetRing(base, -depth * tanS); floor = offsetRing(top, gs);
        if (tanS > 0.6 && best.inradius > 0 && !(ringOk(top) && ringOk(floor))) {
          // (1.96) a steep draft moves the top in by millimetres, and a ring of many short edges moved in point by point
          // folds at every wiggle: the top is the base drawn in towards the plug's middle instead (the same shape,
          // smaller, at least the draft asked at its nearest point), where the base can be seen whole from there
          // (each wall moves in by its line's distance from the middle × (1 − scale), so the scale comes from the
          // nearest wall line, not the inradius: on an L or a U the inside corner's walls pass much nearer the middle;
          // where no scale of at least 0.3 gives every wall its draft, the plug is made shallower below)
          let hmin = Infinity;
          for (let i = 0; i < base.length; i++) { const a = base[i], b = base[(i + 1) % base.length], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey); if (L < 1e-9) continue; hmin = Math.min(hmin, ((best.x - a[0]) * -ey + (best.y - a[1]) * ex) / L); }
          if (hmin > 0 && 1 - depth * tanS / hmin < 0.3 && 0.7 * hmin / tanS >= 1) depth = 0.7 * hmin / tanS; // (as deep as a top three tenths the size allows)
          const sc = hmin > 0 ? 1 - depth * tanS / hmin : -1, fb = flatOf(base);
          const t2 = sc >= 0.3 - 1e-9 ? base.map(q => [best.x + (q[0] - best.x) * sc, best.y + (q[1] - best.y) * sc]) : null;
          if (t2 && t2.every(q => pointInRing(fb, q[0], q[1]))) { top = t2; floor = t2.map((q, i) => [q[0] + mouth[i][0] - base[i][0], q[1] + mouth[i][1] - base[i][1]]); }
        }
        if (ringOk(top) && ringOk(floor)) { fine = true; break; }
        depth *= 0.7;
      }
      if (!ringOk(mouth) || !fine) { out.push({ region: ri, ok: false, reason: 'Area too irregular for a plug' }); continue; }
      out.push({ region: ri, ok: true, x: best.x, y: best.y, base, top, mouth, floor, depth, side: S, ca, short: depth < want - 1e-6, want });
    }
    return out;
  }

  /* ---------- the cut ---------- */
  // Every exported part must be a closed solid. Real sculpts carry microscopic defects (self-crossing folds,
  // near-duplicate points) that can still defeat the cap at one exact plane position, so check the result and,
  // if any part is open, redo the cut a hundredth of a millimetre or so either side. The keys keep their place.
  function cutMesh(P, I, F, opts) {
    const scale = opts.scale || 1, step = scale * 5e-5;
    const skip = opts.skip || new Set(), warnings = []; // with opts.force, the printability rules warn instead of refusing
    // No piece may be too thin to print. Listed areas stop the cut; a thin speck too small to list (the tip of a
    // strand of hair) is quietly left joined, so it stays on its strand instead of becoming a crumb.
    let joinSpecks = null;
    if (opts.minThickness > 0) {
      const base = section(P, I, F, scale);
      if (!base.error) {
        const an = { frame: F, base, depth: [] };
        Object.defineProperty(an, '_src', { value: { P, I, F, scale, cache: new Map() } });
        const thin = thinAreas(an, opts.minThickness, skip), shown = new Set(shownRegions(base.regions));
        const bad = thin.filter(q => shown.has(q.region));
        if (bad.length) { if (opts.force) warnings.push({ code: 'thin', message: thinMessage(base.regions, bad, opts.minThickness) }); else throw guardError(thinMessage(base.regions, bad, opts.minThickness), 'thin', { thin: bad }); }
        const specks = opts.force ? thin.filter(q => !shown.has(q.region)) : thin; // cut anyway: the listed areas are cut, only unlisted specks stay joined
        if (specks.length) {
          joinSpecks = new Set([...skip, ...specks.map(q => q.region)]);
          if (base.regions.every((r, i) => joinSpecks.has(i))) { if (opts.force) joinSpecks = null; else throw guardError(`This cut only grazes the surface, so the piece it cut off would be thinner than ${+opts.minThickness.toFixed(2)} mm, too thin to print. Move the cut deeper into the model.`, 'thin', { thin }); }
        }
      }
    }
    const attempt = (sk) => {
      for (const k of [0, 1, -1, 2, -2, 4, -4]) {
        const Fk = k ? shiftFrame(F, k * step) : F;
        const res = cutOnce(P, I, Fk, { ...opts, skip: sk });
        if (res.parts.every(q => edgeReport(q.indices).closed) && res.pins.every(q => edgeReport(q.indices).closed)) {
          res.retries = Math.abs(k) && [0, 1, -1, 2, -2, 4, -4].indexOf(k);
          try { checkLocks(res, Fk, sk, opts, scale); } catch (e) { if (!opts.force || e.code !== 'locked') throw e; warnings.push({ code: 'locked', message: e.message }); }
          res.warnings = warnings;
          return res;
        }
      }
      throw new Error('Keymaster couldn’t make sealed pieces at this exact spot because the model has a tiny flaw here. Move the cut slightly and try again.');
    };
    if (joinSpecks) { try { return attempt(joinSpecks); } catch (e) { if (e.code !== 'crack' && e.code !== 'locked') throw e; } }
    return attempt(skip);
  }
  // How far apart pieces must slide before they're free: past the longest key, and at least 3 mm.
  function pullDistance(cfg, keys, plugs) {
    let L = 0;
    if (cfg && cfg.type === 'plug') for (const q of plugs || []) L = Math.max(L, q.ok ? q.depth : 0);
    else if (cfg && cfg.type !== 'none') for (const k of keys || [{}]) L = Math.max(L, keyCfg(cfg, k).length || 0);
    return Math.max(3, L + 1);
  }
  function guardError(message, code, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }
  // Pieces on opposite sides of a flat cut always come apart. But a piece that reaches across the cut (through an
  // area left joined) can hook round the piece it meets, and a piece can be caged inside another on its own side
  // (a part of the model that was only held by what was cut away). Every such pair has to come apart, straight
  // along the keys, or at a slant when there are none. Two pieces on the same side don't meet each other, so one
  // can always go in last, at a slant.
  function checkLocks(res, F, skip, opts, scale) {
    const cfg = opts.cfg || { type: 'none' }, unkeyed = cfg.type === 'none' || !res.keysUsed;
    const locked = lockedPairs(res.parts, F.n, Math.max(1e-4, scale * 2e-6), { anyDirection: (A, B) => unkeyed || A.side === B.side, distance: pullDistance(cfg, opts.keys, opts.plugs), only: (A, B) => A.side === 'both' || B.side === 'both' || A.side === B.side });
    if (!locked.length) return;
    const across = locked.some(([i, j]) => res.parts[i].side === 'both' || res.parts[j].side === 'both');
    throw guardError(across && skip.size ? `With ${areaNames(res.regions, [...skip])} left joined, the pieces would hook round each other, so they couldn’t be put together after printing. Cut more areas, or move the cut.`
      : 'This cut would leave a piece caught inside another, so they couldn’t be put together after printing. Move or turn the cut.', 'locked', { locked });
  }
  function cutOnce(P, I, F, opts) {
    const scale = opts.scale || 1;
    const cfg = opts.cfg || { type: 'none' };
    const skip = opts.skip || new Set();
    const sec = computeSection(P, I, F, scale);
    if (sec.error === 'open') throw new Error('The cut crosses a hole in the mesh, so the cut face can’t be closed. Fill holes in the model panel, or move the cut.');
    if (sec.error) throw new Error('The mesh is tangled where it crosses the cut (non-manifold edges). Move the cut slightly, or repair the model first.');
    const loops = sec.loops;
    if (!loops.length) throw new Error('The cut plane doesn’t pass through this part. Slide it into the model first.');
    const regions = buildRegions(loops);
    const selLoop = new Uint8Array(loops.length);
    let anySel = false;
    regions.forEach((r, ri) => { if (!skip.has(ri)) { anySel = true; selLoop[r.outer] = 1; for (const h of r.holes) selLoop[h] = 1; } });
    if (!anySel) throw new Error('Every area of the cut face is switched off. Turn at least one area back on.');

    const nv = P.length / 3, nt = I.length / 3, np = sec.np;
    const split = new Uint8Array(nt);
    for (let l = 0; l < loops.length; l++) if (selLoop[l]) for (const s of loops[l].segs) split[sec.segTri[s]] = 1;
    const spans = new Uint8Array(nt); // crossing triangles left whole in skipped areas
    for (let l = 0; l < loops.length; l++) if (!selLoop[l]) for (const s of loops[l].segs) spans[sec.segTri[s]] = 1;

    const V = new F64List(P.length + np * 3 + 3000);
    for (let i = 0; i < P.length; i++) V.a[i] = P[i];
    V.n = P.length;
    // two copies of the section points: [nv, nv+np) for the side below the plane, [nv+np, nv+2np) for above
    V.reserve(np * 6);
    for (let i = 0; i < np * 3; i++) { V.a[V.n + i] = sec.pts[i]; V.a[V.n + np * 3 + i] = sec.pts[i]; }
    V.n += np * 6;
    const T = new U32List(I.length + 600 + (np * 12));
    const dist = sec.dist;
    for (let t = 0; t < nt; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      if (!split[t]) { T.push3(a, b, c); continue; }
      const da = dist[a] < 0, db = dist[b] < 0, dc = dist[c] < 0;
      let i0, i1, i2;
      if (da === db) { i0 = c; i1 = a; i2 = b; } else if (da === dc) { i0 = b; i1 = c; i2 = a; } else { i0 = a; i1 = b; i2 = c; }
      const e01 = sec.emap.get(Math.min(i0, i1), Math.max(i0, i1));
      const e02 = sec.emap.get(Math.min(i0, i2), Math.max(i0, i2));
      const offIso = nv + (dist[i0] < 0 ? 0 : np), offOther = nv + (dist[i0] < 0 ? np : 0);
      T.push3(i0, offIso + e01, offIso + e02);
      T.push3(offOther + e01, i1, i2); T.push3(offOther + e01, i2, offOther + e02);
    }

    const Fs = shiftFrame(F, sec.shift); // the plane actually used
    const n = Fs.n, u = Fs.u, v = Fs.v, o = Fs.o;
    const at = (x, y, z) => [o[0] + u[0] * x + v[0] * y + n[0] * z, o[1] + u[1] * x + v[1] * y + n[1] * z, o[2] + u[2] * x + v[2] * y + n[2] * z];
    const addV = (p) => V.push3(p[0], p[1], p[2]);
    const pos = (i) => [V.a[3 * i], V.a[3 * i + 1], V.a[3 * i + 2]];
    const pushOriented = (a, b, c, e) => {
      const A = pos(a), B = pos(b), C = pos(c);
      const nn = cross3([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
      if (nn[0] * e[0] + nn[1] * e[1] + nn[2] * e[2] < 0) T.push3(a, c, b); else T.push3(a, b, c);
    };

    const spec = keyGeometrySpec(cfg);
    const keys = (cfg.type === 'none' ? [] : (opts.keys || [])).concat(markKeys(opts.marks)).map(k => ({ ...k, region: -1 }));
    const tmpSec = { loops, regions };
    for (const k of keys) { k.region = regionAt(tmpSec, k.x, k.y); k.cfg = keyCfg(cfg, k); k.spec = k.o || k.a ? keyGeometrySpec(k.cfg) : spec; k.angle = keyAngle(tmpSec, k.region, k.cfg); }
    const plugs = (cfg.type === 'plug' ? (opts.plugs || []).filter(q => q.ok) : []).map(q => ({ ...q, region: regionAt(tmpSec, q.x, q.y) }));
    const pins = [];
    // a plug or its pocket: walls from a ring on the face to a flat end at height z, and the end itself. Walls face
    // out of a plug and into a pocket; any outline works, as each wall faces along its own edge.
    const prism = (rim, rimXY, endXY, z, role) => {
      const m = rim.length, end = endXY.map(([x, y]) => addV(at(x, y, z))), ccw = outlineArea(rimXY) > 0, s = role === 'peg' ? 1 : -1;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, dx = rimXY[j][0] - rimXY[i][0], dy = rimXY[j][1] - rimXY[i][1];
        const ox = (ccw ? dy : -dy) * s, oy = (ccw ? -dx : dx) * s, e = [u[0] * ox + v[0] * oy, u[1] * ox + v[1] * oy, u[2] * ox + v[2] * oy];
        pushOriented(rim[i], rim[j], end[j], e); pushOriented(rim[i], end[j], end[i], e);
      }
      const cap = endCap(end, endXY, Math.sign(z) * s > 0);
      for (let i = 0; i < cap.length; i += 3) T.push3(cap[i], cap[i + 1], cap[i + 2]);
    };

    regions.forEach((reg, ri) => {
      if (skip.has(ri)) return;
      const myKeys = keys.filter(k => k.region === ri), myPlug = plugs.find(q => q.region === ri);
      for (const side of [-1, +1]) { // -1 = below the plane (cap faces +n), +1 = above (cap faces -n)
        const flat = [], ids = [], holes = [], rings = [], ringXY = new Map();
        const pushRing = (ringIds, xy, area) => {
          rings.push(ringIds);
          for (let k = 0; k < ringIds.length; k++) ringXY.set(ringIds[k], [xy[2 * k], xy[2 * k + 1]]);
          // a microscopic hole (a speck of void, often among tangled folds) is left out of earcut, which can't
          // place it reliably; patchCap closes it exactly from its ring
          if (rings.length > 1 && area !== undefined && Math.abs(area) < 1e-3) return;
          if (rings.length > 1) holes.push(ids.length);
          // earcut gets the outline with any tiny self-crossing tangles snipped out; fixTJunctions and patchCap
          // then stitch the snipped points back in, so the cap still meets every wall edge
          for (const k of untangledRing(xy)) { ids.push(ringIds[k]); flat.push(xy[2 * k], xy[2 * k + 1]); }
        };
        const off = nv + (side === -1 ? 0 : np);
        pushRing(loops[reg.outer].ids.map(q => off + q), loops[reg.outer].xy);
        for (const h of reg.holes) pushRing(loops[h].ids.map(q => off + q), loops[h].xy, loops[h].area);
        const tubes = [];
        for (const k of myKeys) {
          const ks = k.spec, kc = k.cfg; // each key may have its own size, shape and taper
          let role, grow, depth, dir, tipR = ks.r;
          if (k.mark) { // an engraved mark: a shallow pocket on the side it's for (each side gets its own, read the right way round)
            if (k.side !== undefined && k.side !== side) continue;
            role = 'socket'; grow = 0; depth = kc.length; dir = side;
          } else if (cfg.type === 'peg') {
            const pegSide = cfg.pegSide === 'above' ? +1 : -1;
            if (side === pegSide) { role = 'peg'; grow = 0; depth = kc.length; dir = -side; tipR = ks.r * ks.taper; }
            else { role = 'socket'; grow = ks.cs; depth = kc.length + ks.ca; dir = side; tipR = ks.r * ks.sockTip; }
          } else {
            role = 'socket'; grow = ks.cs; dir = side;
            depth = cfg.type === 'dowel' ? kc.length / 2 + ks.ca : kc.length + ks.ca;
          }
          const prof = keyProfile(ks.shape, ks.r, grow, k.angle, ks.res);
          const prof1 = keyProfile(ks.shape, tipR, grow, k.angle, ks.res);
          const ring = [], xy = [];
          for (const [px, py] of prof) { ring.push(addV(at(k.x + px, k.y + py, 0))); xy.push(k.x + px, k.y + py); }
          pushRing(ring, xy);
          tubes.push({ k, role, prof1, depth, dir, ring });
        }
        let plugTube = null;
        if (myPlug) { // the plug stands on the other side from its pocket
          const role = side === myPlug.side ? 'socket' : 'peg', rimXY = role === 'peg' ? myPlug.base : myPlug.mouth;
          const ring = rimXY.map(([x, y]) => addV(at(x, y, 0)));
          pushRing(ring, Array.from(flatOf(rimXY)));
          plugTube = { role, ring, rimXY, endXY: role === 'peg' ? myPlug.top : myPlug.floor, z: myPlug.side * (role === 'peg' ? myPlug.depth : myPlug.depth + myPlug.ca) };
        }
        const loc = earcut(flat, holes);
        let sum = 0;
        for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
        const wantCCW = (side === -1) !== !!reg.inverted; // u x v = n, so CCW faces +n; a backwards speck faces the other way
        const flip = wantCCW ? sum < 0 : sum > 0;
        const capTris = [];
        for (let i = 0; i < loc.length; i += 3) {
          if (flip) capTris.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]);
          else capTris.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]);
        }
        for (const r of rings) fixTJunctions(capTris, r);
        const xyOf = (id) => ringXY.get(id);
        splitThroughPoints(capTris, rings, xyOf);
        patchCap(capTris, rings, xyOf, wantCCW);
        for (let i = 0; i < capTris.length; i += 3) T.push3(capTris[i], capTris[i + 1], capTris[i + 2]);
        if (plugTube) prism(plugTube.ring, plugTube.rimXY, plugTube.endXY, plugTube.z, plugTube.role);
        for (const tb of tubes) {
          const z = tb.dir * tb.depth;
          const ring1 = tb.prof1.map(([px, py]) => addV(at(tb.k.x + px, tb.k.y + py, z)));
          const center = addV(at(tb.k.x, tb.k.y, z));
          const axis0 = at(tb.k.x, tb.k.y, 0);
          const m = tb.ring.length;
          for (let i = 0; i < m; i++) {
            const a = tb.ring[i], b = tb.ring[(i + 1) % m], c = ring1[(i + 1) % m], d = ring1[i];
            const A = pos(a), C = pos(c);
            const mid = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, (A[2] + C[2]) / 2];
            const along = (mid[0] - axis0[0]) * n[0] + (mid[1] - axis0[1]) * n[1] + (mid[2] - axis0[2]) * n[2];
            let rx = mid[0] - axis0[0] - n[0] * along, ry = mid[1] - axis0[1] - n[1] * along, rz = mid[2] - axis0[2] - n[2] * along;
            if (tb.role === 'socket') { rx = -rx; ry = -ry; rz = -rz; }
            pushOriented(a, b, c, [rx, ry, rz]); pushOriented(a, c, d, [rx, ry, rz]);
            const e = tb.role === 'peg' ? [n[0] * tb.dir, n[1] * tb.dir, n[2] * tb.dir] : [-n[0] * tb.dir, -n[1] * tb.dir, -n[2] * tb.dir];
            pushOriented(center, ring1[i], ring1[(i + 1) % m], e);
          }
        }
      }
      if (cfg.type === 'dowel') for (const k of myKeys) if (!k.mark) pins.push(makePin(at, k, k.spec, k.cfg.length));
    });

    // An area whose two faces end up in the same piece (the joined areas hold them together) would only be a crack.
    const shown = shownRegions(regions), pairs = [];
    for (const ri of shown) if (!skip.has(ri)) { const q = loops[regions[ri].outer].ids[0]; pairs.push([nv + q, nv + np + q, ri]); }
    const comps = splitComponents(V.a.subarray(0, V.n), T.view(), nv, spans, Fs, pairs);
    if (comps.cracked.length) {
      const names = areaNames(regions, comps.cracked), one = comps.cracked.length === 1;
      throw guardError(`The joined areas hold both sides of ${names} together, so cutting ${one ? 'it' : 'them'} would only make a crack, not separate pieces. Cut another area too, or leave ${one ? 'it' : 'them'} joined.`, 'crack', { regions: comps.cracked });
    }
    return { parts: comps, pins, shift: sec.shift, regions, keysUsed: keys.filter(k => !k.mark && k.region >= 0 && !skip.has(k.region)).length + plugs.filter(q => q.region >= 0 && !skip.has(q.region)).length, marksUsed: keys.filter(k => k.mark && k.region >= 0 && !skip.has(k.region)).length };
  }

  function makePin(at, k, spec, L) {
    const r = spec.r, ch = Math.min(0.4, r * 0.2, L * 0.1);
    const pv = [], pi = [];
    const levels = [[-L / 2, -ch], [-L / 2 + ch, 0], [L / 2 - ch, 0], [L / 2, -ch]]; // chamfered ends: the outline inset by ch
    const rings = levels.map(([z, d]) => keyProfile(spec.shape, r, d, k.angle, spec.res).map(([px, py]) => { const p = at(k.x + px, k.y + py, z); pv.push(...p); return pv.length / 3 - 1; }));
    const c0 = at(k.x, k.y, -L / 2), c1 = at(k.x, k.y, L / 2);
    pv.push(...c0); const i0 = pv.length / 3 - 1; pv.push(...c1); const i1 = pv.length / 3 - 1;
    const ctr = at(k.x, k.y, 0);
    const P = () => pv;
    const orient = (a, b, c) => {
      const A = [pv[3 * a], pv[3 * a + 1], pv[3 * a + 2]], B = [pv[3 * b], pv[3 * b + 1], pv[3 * b + 2]], C = [pv[3 * c], pv[3 * c + 1], pv[3 * c + 2]];
      const nn = cross3([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
      const m = [(A[0] + B[0] + C[0]) / 3 - ctr[0], (A[1] + B[1] + C[1]) / 3 - ctr[1], (A[2] + B[2] + C[2]) / 3 - ctr[2]];
      if (nn[0] * m[0] + nn[1] * m[1] + nn[2] * m[2] < 0) pi.push(a, c, b); else pi.push(a, b, c);
    };
    P();
    const m = rings[0].length;
    for (let l = 0; l + 1 < rings.length; l++) for (let i = 0; i < m; i++) {
      const a = rings[l][i], b = rings[l][(i + 1) % m], c = rings[l + 1][(i + 1) % m], d = rings[l + 1][i];
      orient(a, b, c); orient(a, c, d);
    }
    for (let i = 0; i < m; i++) { orient(i0, rings[0][i], rings[0][(i + 1) % m]); orient(i1, rings[3][i], rings[3][(i + 1) % m]); }
    return { positions: new Float32Array(pv), indices: new Uint32Array(pi) };
  }

  function splitComponents(V, T, nvOrig, spans, F, pairs = []) {
    const nv = V.length / 3, nt = T.length / 3;
    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let t = 0; t < nt; t++) { unite(T[3 * t], T[3 * t + 1]); unite(T[3 * t], T[3 * t + 2]); }
    const cracked = pairs.filter(([a, b]) => find(a) === find(b)).map(q => q[2]);
    const compOf = new Map();
    const comps = [];
    for (let t = 0; t < nt; t++) {
      const r = find(T[3 * t]);
      let c = compOf.get(r);
      if (c === undefined) { c = comps.length; compOf.set(r, c); comps.push({ tris: [], touched: false, spans: false }); }
      comps[c].tris.push(t);
    }
    const spanSet = spans; // flags indexed by original triangle id; original tris come first in T
    const built = comps.map((c) => {
      const map = new Map();
      const pos = [], idx = new Uint32Array(c.tris.length * 3);
      let touched = false, sp = false;
      for (let k = 0; k < c.tris.length; k++) {
        const t = c.tris[k];
        if (t < spanSet.length && spanSet[t]) sp = true;
        for (let j = 0; j < 3; j++) {
          const vi = T[3 * t + j];
          if (vi >= nvOrig) touched = true;
          let w = map.get(vi);
          if (w === undefined) { w = pos.length / 3; map.set(vi, w); pos.push(V[3 * vi], V[3 * vi + 1], V[3 * vi + 2]); }
          idx[3 * k + j] = w;
        }
      }
      const positions = new Float32Array(pos);
      const vc = volumeCentroid(positions, idx);
      const b = bounds(positions);
      const d = (vc.centroid[0] - F.o[0]) * F.n[0] + (vc.centroid[1] - F.o[1]) * F.n[1] + (vc.centroid[2] - F.o[2]) * F.n[2];
      return { positions, indices: idx, volume: vc.volume, bbox: b, side: d < 0 ? 'below' : 'above', touched, spans: sp, centroid: vc.centroid };
    });
    // Keep shells the cut never touched (eyes, inner voids) with the piece that contains them.
    const keep = built.filter(c => c.touched && c.volume > 0);
    const loose = built.filter(c => !(c.touched && c.volume > 0));
    for (const c of loose) {
      let host = null, hostVol = Infinity;
      for (const k of keep) {
        if (k.side !== c.side && !k.spans) continue;
        const bb = k.bbox;
        const inside = c.centroid[0] >= bb.min[0] && c.centroid[0] <= bb.max[0] && c.centroid[1] >= bb.min[1] && c.centroid[1] <= bb.max[1] && c.centroid[2] >= bb.min[2] && c.centroid[2] <= bb.max[2];
        if (inside && k.volume < hostVol) { host = k; hostVol = k.volume; }
      }
      if (!host && c.volume > 0) { keep.push(c); continue; }
      if (!host) host = keep.length ? keep.reduce((a, b) => (a.volume > b.volume ? a : b)) : null;
      if (!host) { keep.push(c); continue; }
      const merged = mergeMeshes([host, c]);
      host.positions = merged.positions; host.indices = merged.indices;
      host.volume = volume(merged.positions, merged.indices); host.bbox = bounds(merged.positions);
    }
    const out = keep.map(c => ({ positions: c.positions, indices: c.indices, volume: c.volume, side: c.spans ? 'both' : c.side }));
    out.cracked = cracked;
    return out;
  }
  function mergeMeshes(list) {
    let nP = 0, nI = 0;
    for (const m of list) { nP += m.positions.length; nI += m.indices.length; }
    const positions = new Float32Array(nP), indices = new Uint32Array(nI);
    let po = 0, io = 0;
    for (const m of list) {
      positions.set(m.positions, po);
      const base = po / 3;
      for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
      po += m.positions.length; io += m.indices.length;
    }
    return { positions, indices };
  }

  /* ---------- transforms ---------- */
  function transformPositions(P, fn) {
    const out = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) { const r = fn(P[i], P[i + 1], P[i + 2]); out[i] = r[0]; out[i + 1] = r[1]; out[i + 2] = r[2]; }
    return out;
  }

  /* ---------- display normals with crease splitting ---------- */
  function creasedArrays(P, I, creaseDeg) {
    const nt = I.length / 3, nv = P.length / 3;
    const cosT = Math.cos((creaseDeg * Math.PI) / 180);
    const fn = new Float32Array(nt * 3), fu = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
      const fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
      const x = ey * fz - ez * fy, y = ez * fx - ex * fz, z = ex * fy - ey * fx;
      fn[3 * t] = x; fn[3 * t + 1] = y; fn[3 * t + 2] = z;
      const l = Math.hypot(x, y, z) || 1;
      fu[3 * t] = x / l; fu[3 * t + 1] = y / l; fu[3 * t + 2] = z / l;
    }
    const start = new Uint32Array(nv + 1);
    for (let k = 0; k < I.length; k++) start[I[k] + 1]++;
    for (let i = 0; i < nv; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nv), adj = new Uint32Array(I.length);
    for (let k = 0; k < I.length; k++) adj[fill[I[k]]++] = (k / 3) | 0;
    const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) {
      const ux = fu[3 * t], uy = fu[3 * t + 1], uz = fu[3 * t + 2];
      for (let j = 0; j < 3; j++) {
        const vi = I[3 * t + j], o = 9 * t + 3 * j;
        pos[o] = P[3 * vi]; pos[o + 1] = P[3 * vi + 1]; pos[o + 2] = P[3 * vi + 2];
        let sx = 0, sy = 0, sz = 0;
        for (let q = start[vi]; q < start[vi + 1]; q++) {
          const f = adj[q];
          if (fu[3 * f] * ux + fu[3 * f + 1] * uy + fu[3 * f + 2] * uz >= cosT) { sx += fn[3 * f]; sy += fn[3 * f + 1]; sz += fn[3 * f + 2]; }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        nor[o] = sx / l; nor[o + 1] = sy / l; nor[o + 2] = sz / l;
      }
    }
    return { pos, nor };
  }

  /* ---------- export ---------- */
  function writeSTL(P, I, label) {
    const nt = I.length / 3;
    const buf = new ArrayBuffer(84 + nt * 50);
    const dv = new DataView(buf);
    const head = ('Keymaster ' + (label || '')).slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, nt, true);
    let o = 84;
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
      const fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
      let x = ey * fz - ez * fy, y = ez * fx - ex * fz, z = ex * fy - ey * fx;
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      dv.setFloat32(o, x, true); dv.setFloat32(o + 4, y, true); dv.setFloat32(o + 8, z, true); o += 12;
      for (const q of [a, b, c]) { dv.setFloat32(o, P[q], true); dv.setFloat32(o + 4, P[q + 1], true); dv.setFloat32(o + 8, P[q + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // Read a ZIP of stored entries (the ones Keymaster writes, and most tools' uncompressed ones): [{ name, data }].
  // Compressed entries are reported by name with `compressed: true` and no data, since core has no inflater.
  function readZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This isn’t a ZIP file.');
    const count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true), out = [];
    let o = cd;
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break;
      const method = dv.getUint16(o + 10, true), size = dv.getUint32(o + 20, true), full = dv.getUint32(o + 24, true), nl = dv.getUint16(o + 28, true), el = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), off = dv.getUint32(o + 42, true);
      const name = dec.decode(u8.subarray(o + 46, o + 46 + nl));
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
      out.push(method === 0 ? { name, data: u8.slice(start, start + size) } : { name, compressed: true, method, raw: u8.slice(start, start + size), size: full }); // a compressed entry carries its raw deflate data, for the app to inflate (core has no inflater)
      o += 46 + nl + el + cl;
    }
    return out;
  }
  // A 3MF's model as one mesh, in millimetres (`files`: the ZIP's entries, each { name, data } with its bytes
  // inflated). The model part is the one _rels/.rels names (3D/3dmodel.model by default); every build item is
  // placed by its transform, an object made of components takes each component's object (from this part or another,
  // as the production extension stores them) by its transform too, and a mirrored transform turns its triangles
  // round so they still face out. Units (micron to metre, inch, foot) are scaled to millimetres. Plain string
  // scanning, no DOM, so it runs in the worker. Returns { positions, indices, objects, items, unit }.
  function parse3MF(files) {
    const dec = new TextDecoder(), byName = new Map();
    for (const f of files) if (f.data) byName.set(f.name.replace(/^\/+/, '').toLowerCase(), f.data);
    const text = (name) => { const d = byName.get(String(name).replace(/^\/+/, '').toLowerCase()); return d ? dec.decode(d) : null; };
    let start = '3D/3dmodel.model';
    const rels = text('_rels/.rels');
    if (rels) { const m = rels.match(/<Relationship[^>]*Type="[^"]*3dmodel"[^>]*>/i) || rels.match(/<Relationship[^>]*Target="([^"]+\.model)"[^>]*>/i); if (m) { const t = m[0].match(/Target="([^"]+)"/i); if (t) start = t[1]; } }
    if (!text(start)) { const any = [...byName.keys()].find(n => n.endsWith('.model')); if (!any) throw new Error('This 3MF has no model inside it. Export it again from your slicer or modelling app.'); start = any; }
    const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
    const attr = (tag, name) => { const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? m[1] : null; };
    const docs = new Map();
    const docOf = (name) => {
      const key = String(name).replace(/^\/+/, '').toLowerCase();
      if (docs.has(key)) return docs.get(key);
      const xml = text(key); if (!xml) return null;
      const modelTag = (xml.match(/<model\b[^>]*>/) || [''])[0], unit = UNITS[(attr(modelTag, 'unit') || 'millimeter').toLowerCase()] || 1;
      const objects = new Map();
      const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g; let m;
      while ((m = re.exec(xml))) {
        const id = attr(m[1], 'id'), body = m[2], obj = { id, verts: null, tris: null, comps: [] };
        const mesh = body.match(/<mesh\b[\s\S]*?<\/mesh>/);
        if (mesh) {
          const v = [], t = [];
          const vr = /<vertex\b([^>]*)\/?>/g; let a; while ((a = vr.exec(mesh[0]))) v.push(+attr(a[1], 'x'), +attr(a[1], 'y'), +attr(a[1], 'z'));
          const tr = /<triangle\b([^>]*)\/?>/g; while ((a = tr.exec(mesh[0]))) t.push(+attr(a[1], 'v1'), +attr(a[1], 'v2'), +attr(a[1], 'v3'));
          obj.verts = v; obj.tris = t;
        }
        const cr = /<component\b([^>]*)\/?>/g; let c; while ((c = cr.exec(body))) obj.comps.push({ id: attr(c[1], 'objectid'), path: attr(c[1], 'p:path') || attr(c[1], 'path'), transform: attr(c[1], 'transform') });
        objects.set(id, obj);
      }
      const items = []; const ir = /<item\b([^>]*)\/?>/g; let it; while ((it = ir.exec(xml))) items.push({ id: attr(it[1], 'objectid'), path: attr(it[1], 'p:path') || attr(it[1], 'path'), transform: attr(it[1], 'transform') });
      const doc = { objects, items, unit }; docs.set(key, doc); return doc;
    };
    const root = docOf(start); if (!root) throw new Error('This 3MF’s model couldn’t be read.');
    const matOf = (s) => { if (!s) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; const v = s.trim().split(/\s+/).map(Number); return v.length === 12 && v.every(isFinite) ? v : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; };
    const mul = (a, b) => { // a then b, row vectors: p' = (p·a)·b
      const r = new Array(12);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { let s2 = i === 3 ? b[9 + j] : 0; for (let k = 0; k < 3; k++) s2 += a[3 * i + k] * b[3 * k + j]; r[3 * i + j] = s2; }
      return r;
    };
    const P = [], I = []; let objects = 0, items = 0;
    const place = (doc, id, M, depth) => {
      if (depth > 16) return;
      const obj = doc.objects.get(id); if (!obj) return;
      if (obj.verts && obj.tris && obj.tris.length) {
        const base = P.length / 3, u = doc.unit, v = obj.verts;
        for (let i = 0; i < v.length; i += 3) { const x = v[i] * u, y = v[i + 1] * u, z = v[i + 2] * u; P.push(x * M[0] + y * M[3] + z * M[6] + M[9] * u, x * M[1] + y * M[4] + z * M[7] + M[10] * u, x * M[2] + y * M[5] + z * M[8] + M[11] * u); }
        const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]), t = obj.tris, nv = v.length / 3;
        for (let i = 0; i < t.length; i += 3) { if (t[i] >= nv || t[i + 1] >= nv || t[i + 2] >= nv) continue; if (det < 0) I.push(base + t[i], base + t[i + 2], base + t[i + 1]); else I.push(base + t[i], base + t[i + 1], base + t[i + 2]); }
        objects++;
      }
      for (const c of obj.comps) { const d2 = c.path ? docOf(c.path) : doc; if (d2) place(d2, c.id, mul(matOf(c.transform), M), depth + 1); }
    };
    const list = root.items.length ? root.items : [...root.objects.keys()].map(id => ({ id }));
    for (const it of list) { const d2 = it.path ? docOf(it.path) : root; if (d2) { place(d2, it.id, matOf(it.transform), 0); items++; } }
    if (!I.length) throw new Error('This 3MF has no triangles in it. Export it again from your slicer or modelling app.');
    return { positions: new Float32Array(P), indices: new Uint32Array(I), objects, items, unit: root.unit };
  }
  // Every part in one 3MF (a ZIP of XML, as slicers open directly), each a named, coloured object, in millimetres.
  function make3MF(parts) {
    const enc = new TextEncoder(), esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const colours = parts.map(p => (p.color || '#9aa0a6').replace(/^#?/, '#').slice(0, 7));
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources>\n';
    xml += `<basematerials id="1">${colours.map((c, i) => `<base name="${esc(parts[i].name || 'part')}" displaycolor="${esc(c)}"/>`).join('')}</basematerials>\n`;
    parts.forEach((p, i) => {
      const P = p.positions, I = p.indices, parts2 = [];
      parts2.push(`<object id="${i + 2}" name="${esc(p.name || 'part')}" type="model" pid="1" pindex="${i}"><mesh><vertices>`);
      for (let v = 0; v < P.length; v += 3) parts2.push(`<vertex x="${+P[v].toFixed(4)}" y="${+P[v + 1].toFixed(4)}" z="${+P[v + 2].toFixed(4)}"/>`);
      parts2.push('</vertices><triangles>');
      for (let t = 0; t < I.length; t += 3) parts2.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>`);
      parts2.push('</triangles></mesh></object>\n');
      xml += parts2.join('');
    });
    xml += '</resources>\n<build>' + parts.map((p, i) => `<item objectid="${i + 2}"/>`).join('') + '</build>\n</model>\n';
    const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    return makeZip([{ name: '[Content_Types].xml', data: enc.encode(types) }, { name: '_rels/.rels', data: enc.encode(rels) }, { name: '3D/3dmodel.model', data: enc.encode(xml) }]);
  }
  // An assembly sheet: a page listing every part with its size, volume and joints, and which parts each joint
  // pairs with, so a kit can be put together from the printed pieces. `meta` is { name, bed, date }.
  function assemblySheet(parts, meta = {}) {
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmt1 = (v) => (Math.round(v * 10) / 10).toString();
    const byJoint = new Map();
    parts.forEach((p, i) => { for (const j of p.joints || []) { if (!byJoint.has(j.id)) byJoint.set(j.id, []); byJoint.get(j.id).push(i); } });
    const kindName = { peg: 'pegs', dowel: 'dowels', magnet: 'magnets', plug: 'plug', boss: 'bosses', none: 'no keys' };
    const pictures = parts.some(p => p.image);
    const rows = parts.map((p, i) => {
      const b = bounds(p.positions), joints = (p.joints || []).map(j => { const others = (byJoint.get(j.id) || []).filter(k => k !== i).map(k => esc(parts[k].name)); return `${j.number != null ? `<b>№ ${esc(j.number)}</b> ` : ''}${others.length ? 'with ' + others.join(', ') : 'with another part'}${j.type ? ` (${kindName[j.type] || esc(j.type)}${j.keys ? `, ${j.keys}` : ''})` : ''}`; });
      return `<tr><td>${i + 1}</td>${pictures ? `<td class="pic">${p.image ? `<img src="${p.image}" alt="${esc(p.name)}" width="160" height="120">` : ''}</td>` : ''}<td><span class="sw" style="background:${esc(p.color || '#999')}"></span>${esc(p.name)}${p.kind === 'pin' ? ' <em>(printed pin)</em>' : ''}</td><td>${fmt1(b.size[0])} × ${fmt1(b.size[1])} × ${fmt1(b.size[2])} mm</td><td>${fmt1((p.volume != null ? p.volume : volume(p.positions, p.indices)) / 1000)} cm³</td><td>${joints.length ? joints.join('<br>') : '—'}</td></tr>`;
    });
    const jointRows = [...byJoint.entries()].sort((a, b) => a[0] - b[0]).map(([id, idx]) => { const j = (parts[idx[0]].joints || []).find(x => x.id === id) || {}; return `<tr><td>${j.number != null ? '№ ' + esc(j.number) : esc(id)}</td><td>${idx.map(k => esc(parts[k].name)).join(' + ')}</td><td>${j.type ? kindName[j.type] || esc(j.type) : ''}${j.keys ? ` × ${j.keys}` : ''}</td></tr>`; });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(meta.name || 'Model')} — assembly</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>.pic img{display:block;width:160px;height:120px;border-radius:6px;background:#fff}.all img{max-width:100%;height:auto;border-radius:8px;border:1px solid #ddd}body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#222}h1{font-size:22px;margin:0 0 4px}p.meta{color:#666;margin:0 0 18px}table{border-collapse:collapse;width:100%;margin-bottom:22px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#f3f3f3;font-weight:600}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px;border:1px solid rgba(0,0,0,.2)}em{color:#777}@media print{body{margin:12mm}}</style></head><body>
<h1>${esc(meta.name || 'Model')}: assembly sheet</h1>
<p class="meta">${parts.length} ${parts.length === 1 ? 'part' : 'parts'} from Keymaster${meta.date ? ', ' + esc(meta.date) : ''}${meta.bed ? `. Printer bed ${esc(meta.bed.w)} × ${esc(meta.bed.d)} × ${esc(meta.bed.h)} mm` : ''}. Units are millimetres. Pegs go into their sockets; dowel pins and magnets go into the pockets on both faces; a plug presses into its pocket. ${byJoint.size ? 'Engraved numbers on the cut faces match the joint numbers below.' : ''}</p>
${meta.image ? `<p class="all"><img src="${meta.image}" alt="The pieces spread apart along their cuts"></p>` : ''}
<table><thead><tr><th>#</th>${pictures ? '<th></th>' : ''}<th>Part</th><th>Size</th><th>Volume</th><th>Joints</th></tr></thead><tbody>${rows.join('')}</tbody></table>
${jointRows.length ? `<h2 style="font-size:17px">Joints</h2><table><thead><tr><th>Joint</th><th>Parts</th><th>Keys</th></tr></thead><tbody>${jointRows.join('')}</tbody></table>` : ''}
</body></html>`;
  }
  // A project: every part's geometry as STL plus project.json (names, colours, pulls, joints, settings) in one ZIP,
  // so work can be saved and picked up later. `meta` is kept as given.
  function packProject(parts, meta = {}) {
    const enc = new TextEncoder(), files = [];
    const json = { app: 'Keymaster', format: 1, ...meta, parts: parts.map((p, i) => ({ name: p.name, color: p.color, kind: p.kind || 'part', pull: p.pull || null, joints: p.joints || [], file: `parts/${i}.stl` })) };
    files.push({ name: 'project.json', data: enc.encode(JSON.stringify(json)) });
    parts.forEach((p, i) => files.push({ name: `parts/${i}.stl`, data: new Uint8Array(writeSTL(p.positions, p.indices, p.name)) }));
    return makeZip(files);
  }
  function unpackProject(buf) {
    const entries = readZip(buf), byName = new Map(entries.map(e => [e.name, e]));
    const pj = byName.get('project.json');
    if (!pj || !pj.data) throw new Error('This ZIP isn’t a Keymaster project: it has no project.json.');
    const json = JSON.parse(new TextDecoder().decode(pj.data));
    if (json.app !== 'Keymaster') throw new Error('This ZIP isn’t a Keymaster project.');
    const parts = (json.parts || []).map(meta => {
      const e = byName.get(meta.file);
      if (!e || !e.data) throw new Error(`The project is missing ${meta.file}.`);
      const m = prepareMesh(parseSTL(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength)));
      return { ...meta, positions: m.positions, indices: m.indices, report: m.report };
    });
    return { ...json, parts };
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const entries = files.map(f => ({ name: enc.encode(f.name), data: f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data) }));
    let size = 22;
    for (const e of entries) { e.crc = crc32(e.data); size += 30 + e.name.length + e.data.length + 46 + e.name.length; }
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let o = 0;
    for (const e of entries) {
      e.offset = o;
      dv.setUint32(o, 0x04034b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 0x0800, true); dv.setUint16(o + 8, 0, true);
      dv.setUint16(o + 10, time, true); dv.setUint16(o + 12, date, true); dv.setUint32(o + 14, e.crc, true);
      dv.setUint32(o + 18, e.data.length, true); dv.setUint32(o + 22, e.data.length, true);
      dv.setUint16(o + 26, e.name.length, true); dv.setUint16(o + 28, 0, true);
      out.set(e.name, o + 30); out.set(e.data, o + 30 + e.name.length);
      o += 30 + e.name.length + e.data.length;
    }
    const cd = o;
    for (const e of entries) {
      dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0x0800, true);
      dv.setUint16(o + 10, 0, true); dv.setUint16(o + 12, time, true); dv.setUint16(o + 14, date, true); dv.setUint32(o + 16, e.crc, true);
      dv.setUint32(o + 20, e.data.length, true); dv.setUint32(o + 24, e.data.length, true); dv.setUint16(o + 28, e.name.length, true);
      dv.setUint16(o + 30, 0, true); dv.setUint16(o + 32, 0, true); dv.setUint16(o + 34, 0, true); dv.setUint16(o + 36, 0, true);
      dv.setUint32(o + 38, 0, true); dv.setUint32(o + 42, e.offset, true);
      out.set(e.name, o + 46);
      o += 46 + e.name.length;
    }
    dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 4, 0, true); dv.setUint16(o + 6, 0, true);
    dv.setUint16(o + 8, entries.length, true); dv.setUint16(o + 10, entries.length, true);
    dv.setUint32(o + 12, o - cd, true); dv.setUint32(o + 16, cd, true); dv.setUint16(o + 20, 0, true);
    return out;
  }

  /* ---------- sample model ---------- */
  function torusKnot(R = 30, tube = 9, tubular = 420, radial = 40, p = 2, q = 3) {
    const pos = [], idx = [];
    const curve = (u) => {
      const qu = (q / p) * u, cs = Math.cos(qu);
      return [R * (2 + cs) * 0.5 * Math.cos(u), R * (2 + cs) * 0.5 * Math.sin(u), R * Math.sin(qu) * 0.5];
    };
    for (let i = 0; i < tubular; i++) {
      const u = (i / tubular) * p * Math.PI * 2;
      const P1 = curve(u), P2 = curve(u + 0.01);
      const T = norm3([P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]]);
      let N = [P2[0] + P1[0], P2[1] + P1[1], P2[2] + P1[2]];
      const B = norm3(cross3(T, N));
      N = norm3(cross3(B, T));
      for (let j = 0; j < radial; j++) {
        const vv = (j / radial) * Math.PI * 2;
        const cx = -tube * Math.cos(vv), cy = tube * Math.sin(vv);
        pos.push(P1[0] + cx * N[0] + cy * B[0], P1[1] + cx * N[1] + cy * B[1], P1[2] + cx * N[2] + cy * B[2] + R * 0.5 + tube);
      }
    }
    for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = ((i + 1) % tubular) * radial + j, c = ((i + 1) % tubular) * radial + ((j + 1) % radial), d = i * radial + ((j + 1) % radial);
      idx.push(a, b, d, b, c, d);
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  }


  /* ---------- shapes and exact plane clips ----------
     Shapes (a cube, a ball, a tube, a cone, a ring) are added to the model to add material or to cut with, as the
     guide's Shapes tool does. They are built to be closed solids: the round ones as lathes of a profile, the cube as
     a box clipped by planes (its chamfers and roundings are more planes). clipMesh is an exact plane clip that gives
     both sides with caps that mirror each other, which the booleans are built on. */
  // Both sides of a mesh cut by a plane {o, n}: below (where (p - o)·n < 0) and above, each closed, with the same
  // cap facing opposite ways. Crossing edges get one point each, computed the same way whichever way the edge is
  // stored, and split quads take the same diagonal, so two copies of a face cut by the same plane split alike.
  // The plane is moved by a few microns when a vertex sits on it (opts.shift forces a move, so several meshes can
  // be cut by exactly the same plane); the move is reported in shift.
  function clipMesh(P, I, plane, opts = {}) {
    const nv = P.length / 3, nt = I.length / 3;
    const n = norm3(plane.n), o = plane.o;
    const b = bounds(P), scale = diag(b);
    const tol = scale * 1e-6, W = scale * 2e-5;
    const dist = new Float64Array(nv);
    for (let i = 0, j = 0; i < nv; i++, j += 3) dist[i] = (P[j] - o[0]) * n[0] + (P[j + 1] - o[1]) * n[1] + (P[j + 2] - o[2]) * n[2];
    let shift = 0;
    if (opts.shift !== undefined) shift = opts.shift;
    else {
      const near = [];
      for (let i = 0; i < nv; i++) if (dist[i] > -W && dist[i] < W) near.push(dist[i]);
      if (near.some(d => d > -tol && d < tol)) {
        near.push(-W, W); near.sort((a, b) => a - b);
        let best = -1;
        for (let k = 0; k + 1 < near.length; k++) { const gap = near[k + 1] - near[k]; if (gap > best) { best = gap; shift = (near[k] + near[k + 1]) / 2; } }
      }
    }
    if (shift) for (let i = 0; i < nv; i++) dist[i] -= shift;
    const F = frameFromNormal(n, [o[0] + n[0] * shift, o[1] + n[1] * shift, o[2] + n[2] * shift]);
    // new points on crossing edges, keyed by the edge; the lerp runs from the lexicographically smaller end
    const V = new F64List(nv * 3 + 64);
    for (let i = 0; i < P.length; i++) V.a[i] = P[i];
    V.n = P.length;
    const emap = new PairMap(nt + 8);
    const less = (a, b) => { const i = 3 * a, j = 3 * b; return P[i] < P[j] || (P[i] === P[j] && (P[i + 1] < P[j + 1] || (P[i + 1] === P[j + 1] && P[i + 2] < P[j + 2]))); };
    const edgePoint = (i, j) => {
      const lo = i < j ? i : j, hi = i < j ? j : i;
      let id = emap.get(lo, hi);
      if (id !== -1) return id;
      const a = less(lo, hi) ? lo : hi, c = a === lo ? hi : lo; // from the smaller position to the larger
      const t = dist[a] / (dist[a] - dist[c]);
      id = V.push3(P[3 * a] + t * (P[3 * c] - P[3 * a]), P[3 * a + 1] + t * (P[3 * c + 1] - P[3 * a + 1]), P[3 * a + 2] + t * (P[3 * c + 2] - P[3 * a + 2]));
      emap.set(lo, hi, id);
      return id;
    };
    const below = new F64List(I.length), above = new F64List(I.length);
    const segA = [], segB = [];
    for (let t = 0; t < nt; t++) {
      const a = I[3 * t], b2 = I[3 * t + 1], c = I[3 * t + 2];
      const da = dist[a] < 0, db = dist[b2] < 0, dc = dist[c] < 0;
      if (da === db && da === dc) { (da ? below : above).push3(a, b2, c); continue; }
      let i0, i1, i2; // i0 alone on its side, (i0, i1, i2) in the triangle's winding
      if (da === db) { i0 = c; i1 = a; i2 = b2; } else if (da === dc) { i0 = b2; i1 = c; i2 = a; } else { i0 = a; i1 = b2; i2 = c; }
      const p01 = edgePoint(i0, i1), p02 = edgePoint(i0, i2);
      const lone = dist[i0] < 0 ? below : above, pair = dist[i0] < 0 ? above : below;
      lone.push3(i0, p01, p02);
      if (less(i1, i2)) { pair.push3(p01, i1, p02); pair.push3(i1, i2, p02); } else { pair.push3(p01, i1, i2); pair.push3(p01, i2, p02); }
      if (dist[i0] < 0) { segA.push(p02); segB.push(p01); } else { segA.push(p01); segB.push(p02); }
    }
    // the section loops, chained point to point, in the plane's frame
    const np = V.n / 3;
    const next = new Int32Array(np).fill(-1);
    for (let s = 0; s < segA.length; s++) { if (next[segA[s]] !== -1) throw new Error('The surface is tangled where the plane crosses it, so it can’t be cut there.'); next[segA[s]] = segB[s]; }
    const visited = new Uint8Array(np), loops = [];
    const PA = V.a;
    for (let p0 = nv; p0 < np; p0++) {
      if (visited[p0] || next[p0] === -1) continue;
      const ids = []; let q = p0;
      while (!visited[q]) { visited[q] = 1; ids.push(q); q = next[q]; if (q === -1) throw new Error('The surface has a gap where the plane crosses it, so it can’t be cut there.'); }
      if (q !== p0) throw new Error('The surface is tangled where the plane crosses it, so it can’t be cut there.');
      if (ids.length < 3) continue;
      const xy = new Float64Array(ids.length * 2);
      for (let k = 0; k < ids.length; k++) { const j = 3 * ids[k]; const dx = PA[j] - F.o[0], dy = PA[j + 1] - F.o[1], dz = PA[j + 2] - F.o[2]; xy[2 * k] = dx * F.u[0] + dy * F.u[1] + dz * F.u[2]; xy[2 * k + 1] = dx * F.v[0] + dy * F.v[1] + dz * F.v[2]; }
      loops.push(makeLoop(ids, null, xy));
    }
    // caps: one triangulation per area, given to the below side facing +n and to the above side facing -n
    const capBelow = [], capAbove = [];
    if (loops.length) {
      const regions = buildRegions(loops);
      for (const reg of regions) {
        const ringIds = [loops[reg.outer].ids, ...reg.holes.map(h => loops[h].ids)];
        const flat = [], holes = [], ids = [], ringXY = new Map();
        for (let r = 0; r < ringIds.length; r++) {
          if (r > 0) holes.push(ids.length);
          const lp = r === 0 ? loops[reg.outer] : loops[reg.holes[r - 1]];
          for (let k = 0; k < lp.ids.length; k++) { ids.push(lp.ids[k]); flat.push(lp.xy[2 * k], lp.xy[2 * k + 1]); ringXY.set(lp.ids[k], [lp.xy[2 * k], lp.xy[2 * k + 1]]); }
        }
        const loc = earcut(flat, holes);
        let sum = 0;
        for (let i = 0; i < loc.length; i += 3) sum += tri2(flat, loc[i], loc[i + 1], loc[i + 2]);
        const wantCCW = !reg.inverted, flip = wantCCW ? sum < 0 : sum > 0;
        const tris = [];
        for (let i = 0; i < loc.length; i += 3) { if (flip) tris.push(ids[loc[i]], ids[loc[i + 2]], ids[loc[i + 1]]); else tris.push(ids[loc[i]], ids[loc[i + 1]], ids[loc[i + 2]]); }
        for (const r of ringIds) fixTJunctions(tris, r);
        const xyOf = (id) => ringXY.get(id);
        splitThroughPoints(tris, ringIds, xyOf);
        patchCap(tris, ringIds, xyOf, wantCCW);
        for (let i = 0; i < tris.length; i += 3) { capBelow.push(tris[i], tris[i + 1], tris[i + 2]); capAbove.push(tris[i], tris[i + 2], tris[i + 1]); }
      }
    }
    // each side's vertices, welded by position (a crossing point a hair from a vertex is that vertex once stored as
    // float32), with the zero-area triangles that welding leaves dropped; capFrom is where the cap's triangles start
    const wtol = Math.max(scale * 1e-7, 1e-9), inv = 1 / wtol;
    const pack = (list, cap) => {
      const nSurf = list.n, all = new Uint32Array(nSurf + cap.length);
      all.set(list.a.subarray(0, nSurf)); all.set(cap, nSurf);
      const remap = new Int32Array(np).fill(-1), keyOf = new Map(), pos = [];
      const idOf = (v) => {
        if (remap[v] !== -1) return remap[v];
        const key = `${Math.round(PA[3 * v] * inv)},${Math.round(PA[3 * v + 1] * inv)},${Math.round(PA[3 * v + 2] * inv)}`;
        let id = keyOf.get(key);
        if (id === undefined) { id = pos.length / 3; keyOf.set(key, id); pos.push(PA[3 * v], PA[3 * v + 1], PA[3 * v + 2]); }
        remap[v] = id; return id;
      };
      const idx = [], seen = new Set(); let capFrom = 0;
      for (let i = 0; i < all.length; i += 3) {
        if (i === nSurf) capFrom = idx.length;
        const a = idOf(all[i]), b2 = idOf(all[i + 1]), c = idOf(all[i + 2]);
        if (a === b2 || b2 === c || a === c) continue;
        const key = a < b2 && a < c ? `${a},${b2},${c}` : b2 < c ? `${b2},${c},${a}` : `${c},${a},${b2}`; // the same triangle twice (welding can fold two slivers together) counts once
        if (seen.has(key)) continue;
        seen.add(key);
        idx.push(a, b2, c);
      }
      if (nSurf === all.length) capFrom = idx.length;
      return { positions: new Float32Array(pos), indices: new Uint32Array(idx), capFrom };
    };
    const lo = pack(below, capBelow), hi = pack(above, capAbove);
    return { below: lo.indices.length ? { positions: lo.positions, indices: lo.indices, capFrom: lo.capFrom } : null, above: hi.indices.length ? { positions: hi.positions, indices: hi.indices, capFrom: hi.capFrom } : null, shift, crossed: segA.length > 0 };
  }
  // A box as a closed mesh
  /* ---------- booleans with a convex tool ----------
     A part and a shape joined (union), the shape taken out of the part (difference), or only their overlap kept
     (intersect), as the guide's Boolean tool. The tool is convex (a cube, a ball, a tube, a cone; a ring is cut
     into convex sectors and taken one at a time), given as a closed mesh whose faces are flat.
     The result's surface has two kinds of piece: the part's own triangles, each clipped by the tool's planes into
     the bit inside the tool and the bits outside (clipInOut); and the tool's faces, each cut by the part's section
     curves into regions that are inside or outside the part (faceRegions, a walk round a planar graph, with a
     parity test along a line for the side). Every point where a part edge meets a tool plane, or a tool edge meets
     a part triangle, is made once and shared by name, so the pieces meet exactly and nothing has to be sewn. */
  // The distinct flat faces of a closed mesh as outward planes (a cube gives 6, a 24-sided tube 26), and which
  // plane each triangle lies on
  function facePlanesOf(P, I) {
    const nt = I.length / 3, b = bounds(P), scale = diag(b), N = new Float64Array(nt * 3), area = new Float64Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], c = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2];
      const n = cross3([P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]]);
      const len = Math.hypot(n[0], n[1], n[2]); area[t] = len / 2;
      if (len > 0) { N[3 * t] = n[0] / len; N[3 * t + 1] = n[1] / len; N[3 * t + 2] = n[2] / len; }
    }
    // neighbours across an edge with the same normal are one face (a box face's two triangles, a lathe's quads)
    const parent = new Int32Array(nt); for (let t = 0; t < nt; t++) parent[t] = t;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const byEdge = new Map();
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const u = I[3 * t + e], w = I[3 * t + (e + 1) % 3], key = u < w ? u + '-' + w : w + '-' + u, o = byEdge.get(key);
      if (o === undefined) { byEdge.set(key, t); continue; }
      if (area[t] > 0 && area[o] > 0 && N[3 * t] * N[3 * o] + N[3 * t + 1] * N[3 * o + 1] + N[3 * t + 2] * N[3 * o + 2] > 1 - 5e-7) parent[find(t)] = find(o); // within a thousandth of a radian: float32 corners of a turned shape
    }
    const planes = [], of = new Int32Array(nt).fill(-1), index = new Map(), sum = [];
    for (let t = 0; t < nt; t++) {
      if (!(area[t] > scale * scale * 1e-14)) continue;
      const r = find(t); let i = index.get(r);
      if (i === undefined) { i = planes.length; index.set(r, i); planes.push(null); sum.push([0, 0, 0, 0, 0, 0, 0]); }
      const s = sum[i], w = area[t], a = 3 * I[3 * t];
      s[0] += N[3 * t] * w; s[1] += N[3 * t + 1] * w; s[2] += N[3 * t + 2] * w; s[3] += P[a] * w; s[4] += P[a + 1] * w; s[5] += P[a + 2] * w; s[6] += w;
      of[t] = i;
    }
    for (let i = 0; i < planes.length; i++) { const s = sum[i]; planes[i] = { n: norm3([s[0], s[1], s[2]]), o: [s[3] / s[6], s[4] / s[6], s[5] / s[6]] }; }
    return { planes, of };
  }
  function facePlanes(P, I) { return facePlanesOf(P, I).planes; }
  // The tool moved as a whole by a few microns so that no vertex of the part sits on any of its planes (as the flat
  // cut nudges its plane). Moving it whole keeps its corners exact: a ball's pole stays one point where its faces
  // meet, which nudging each plane on its own would break into a cluster of slivers.
  function toolShift(P, planes, scale, lo, hi) {
    const nv = P.length / 3, W = scale * 2e-5, tol = scale * 1e-6, near = [];
    for (let v = 0, j = 0; v < nv; v++, j += 3) if (P[j] >= lo[0] - W && P[j] <= hi[0] + W && P[j + 1] >= lo[1] - W && P[j + 1] <= hi[1] + W && P[j + 2] >= lo[2] - W && P[j + 2] <= hi[2] + W) near.push(v);
    // along a direction, each vertex within tol of a plane forbids a short run of shifts; the shift is taken from
    // the middle of the widest gap between the runs, and the best of a few directions wins
    let best = [0, 0, 0], bestGap = -1;
    for (const dir of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.577, 0.577, 0.577], [-0.577, 0.577, 0.577], [0.577, -0.577, 0.577], [0.577, 0.577, -0.577]]) {
      const runs = [];
      for (const pl of planes) {
        const n = pl.n, rate = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
        if (Math.abs(rate) < 1e-3) { // the direction runs along the plane: a vertex on it stays on it whatever the shift
          for (const v of near) { const d = (P[3 * v] - pl.o[0]) * n[0] + (P[3 * v + 1] - pl.o[1]) * n[1] + (P[3 * v + 2] - pl.o[2]) * n[2]; if (d > -tol && d < tol) { runs.push([-W, W]); break; } }
          continue;
        }
        const reach = W * Math.abs(rate) + tol;
        for (const v of near) {
          const d = (P[3 * v] - pl.o[0]) * n[0] + (P[3 * v + 1] - pl.o[1]) * n[1] + (P[3 * v + 2] - pl.o[2]) * n[2];
          if (d < -reach || d > reach) continue;
          const s0 = (d - tol) / rate, s1 = (d + tol) / rate; // shifts s with |d - s·rate| < tol
          runs.push(s0 < s1 ? [s0, s1] : [s1, s0]);
        }
      }
      runs.sort((x, y) => x[0] - y[0]);
      let gap = 0, at = 0, edge = -W;
      for (const r of runs) { if (r[0] > edge) { const g = Math.min(r[0], W) - edge; if (g > gap) { gap = g; at = edge + g / 2; } } if (r[1] > edge) edge = r[1]; }
      if (W > edge) { const g = W - edge; if (g > gap) { gap = g; at = edge + g / 2; } }
      if (gap > bestGap) { bestGap = gap; best = [dir[0] * at, dir[1] * at, dir[2] * at]; }
      if (gap >= 2 * tol * 4) break; // a comfortable gap: good enough
    }
    return best;
  }
  // Edges shorter than minLen collapsed one into the other, where the collapse keeps the mesh a manifold (the two
  // ends share only the two opposite corners of the edge's triangles, as reduceMesh checks), so a float32 copy of
  // the result never has two vertices in one place. Positions stay float64.
  function collapseShortEdges(P, I, minLen) {
    const nv = P.length / 3, nt = I.length / 3, min2 = minLen * minLen;
    const alias = new Int32Array(nv); for (let v = 0; v < nv; v++) alias[v] = v;
    const find = (v) => { while (alias[v] !== v) { alias[v] = alias[alias[v]]; v = alias[v]; } return v; };
    const nb = new Map(); // vertex -> Set of neighbours, by current ids
    const link = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
    const short = [];
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const a = I[3 * t + e], b = I[3 * t + (e + 1) % 3];
      link(a, b); link(b, a);
      if (a < b) { const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2]; if (dx * dx + dy * dy + dz * dz < min2) short.push(a, b); }
    }
    if (!short.length) return { positions: P, indices: I };
    for (let s = 0; s < short.length; s += 2) {
      const a = find(short[s]), b = find(short[s + 1]);
      if (a === b) continue;
      const na = nb.get(a), nbb = nb.get(b); if (!na || !nbb || !na.has(b)) continue;
      let shared = 0; for (const x of na) if (nbb.has(x)) shared++;
      if (shared !== 2) continue; // not a plain edge of two triangles: leave it
      // b goes into a
      for (const x of nbb) { if (x === a) continue; const nx = nb.get(x); nx.delete(b); nx.add(a); na.add(x); }
      na.delete(b); nb.delete(b); alias[b] = a;
    }
    const out = [];
    for (let t = 0; t < nt; t++) { const a = find(I[3 * t]), b = find(I[3 * t + 1]), c = find(I[3 * t + 2]); if (a !== b && b !== c && a !== c) out.push(a, b, c); }
    return { positions: P, indices: new Uint32Array(out) };
  }
  // Is a point inside a closed mesh: the parity of the crossings of a line up from it, from a grid of the triangles
  function insideTester(P, I) {
    const b = bounds(P), N = 48, sx = b.size[0] / N || 1, sy = b.size[1] / N || 1, bins = new Map();
    const cell = (x, y) => `${Math.floor((x - b.min[0]) / sx)},${Math.floor((y - b.min[1]) / sy)}`;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], c = 3 * I[t + 1], d = 3 * I[t + 2];
      const x0 = Math.min(P[a], P[c], P[d]), x1 = Math.max(P[a], P[c], P[d]), y0 = Math.min(P[a + 1], P[c + 1], P[d + 1]), y1 = Math.max(P[a + 1], P[c + 1], P[d + 1]);
      const i0 = Math.floor((x0 - b.min[0]) / sx), i1 = Math.floor((x1 - b.min[0]) / sx), j0 = Math.floor((y0 - b.min[1]) / sy), j1 = Math.floor((y1 - b.min[1]) / sy);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = `${i},${j}`; if (!bins.has(k)) bins.set(k, []); bins.get(k).push(t); }
    }
    return (x0, y0, z) => {
      const x = x0 + sx * 0.0137, y = y0 + sy * 0.0291; // off any edge the sample might sit on
      if (x < b.min[0] || x > b.max[0] || y < b.min[1] || y > b.max[1] || z > b.max[2]) return false;
      const list = bins.get(cell(x, y)); if (!list) return false;
      let hits = 0;
      for (const t of list) {
        const a = 3 * I[t], c = 3 * I[t + 1], d = 3 * I[t + 2];
        const ax = P[a] - x, ay = P[a + 1] - y, bx = P[c] - x, by = P[c + 1] - y, cx = P[d] - x, cy = P[d + 1] - y;
        const s1 = ax * by - ay * bx, s2 = bx * cy - by * cx, s3 = cx * ay - cy * ax;
        if ((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) continue;
        const sum = s1 + s2 + s3; if (sum === 0) continue;
        const zz = (s2 * P[a + 2] + s3 * P[c + 2] + s1 * P[d + 2]) / sum;
        if (zz > z) hits++;
      }
      return (hits & 1) === 1;
    };
  }
  // The tool as flat faces: its triangles grouped by plane, each group's outline chained (facing out), with the
  // plane across each outline edge
  function toolFaces(C, planes, of) {
    const I = C.indices, faces = planes.map(() => []), across = new Map();
    for (let t = 0; t < I.length; t += 3) { const i = of[t / 3]; if (i < 0) continue; faces[i].push(I[t], I[t + 1], I[t + 2]); for (let e = 0; e < 3; e++) across.set(I[t + (e + 1) % 3] + '>' + I[t + e], i); }
    return faces.map((tris, i) => {
      if (!tris.length) return null;
      const cnt = new Map();
      for (let k = 0; k < tris.length; k += 3) for (let e = 0; e < 3; e++) { const u = tris[k + e], w = tris[k + (e + 1) % 3]; cnt.set(u + '>' + w, (cnt.get(u + '>' + w) || 0) + 1); }
      const next = new Map();
      for (const [key] of cnt) { const [u, w] = key.split('>').map(Number); if (!cnt.has(w + '>' + u)) next.set(u, w); }
      if (!next.size) return null;
      const start = next.keys().next().value, ring = [start]; let cur = next.get(start), guard = 0;
      while (cur !== start && guard++ < next.size + 2) { ring.push(cur); cur = next.get(cur); }
      const other = ring.map((u, e) => { const w = ring[(e + 1) % ring.length], j = across.get(u + '>' + w); return j === undefined ? -1 : j; });
      return { plane: i, ring, other };
    });
  }
  // The tool is one convex solid, or several convex cells that share faces (a ring is its sectors): every cell
  // is a closed mesh whose faces are flat. Cells share a global list of planes, so a seam point on a shared plane
  // has one name whichever cell made it, and a plane two cells share (with opposite normals) is inside the tool
  // and gets no cap.
  function booleanWith(P, I, tool, op) {
    const pb = bounds(P), scale = diag(pb);
    const dist = (pl, q) => (q[0] - pl.o[0]) * pl.n[0] + (q[1] - pl.o[1]) * pl.n[1] + (q[2] - pl.o[2]) * pl.n[2];
    const planes = [], cellPlanes = [], cells = [], cellFaces = []; // planes[g] = { n, o }; cellPlanes[k][local] = { g, sign }
    if (tool.cells) { // cells given as signed planes from one exact list: their meshes are built here
      for (const pl of tool.planes) planes.push({ n: pl.n.slice(), o: pl.o.slice() });
      for (const cell of tool.cells) {
        const local = cell.map(({ g, sign }) => ({ n: sign > 0 ? planes[g].n : planes[g].n.map(x => -x), o: planes[g].o }));
        const hull = hullMesh(local);
        if (!hull.indices.length) continue;
        // which plane each hull triangle lies on
        const of = new Int32Array(hull.indices.length / 3).fill(-1), tol = scale * 1e-6;
        for (let q = 0; q < of.length; q++) {
          const a = hull.indices[3 * q], b = hull.indices[3 * q + 1], c = hull.indices[3 * q + 2];
          for (let l = 0; l < local.length && of[q] < 0; l++) { const pl = local[l]; let on = true; for (const v of [a, b, c]) if (Math.abs(dist(pl, [hull.positions[3 * v], hull.positions[3 * v + 1], hull.positions[3 * v + 2]])) > tol) { on = false; break; } if (on) of[q] = l; }
        }
        cells.push(hull); cellPlanes.push(cell.map(({ g, sign }) => ({ g, sign }))); cellFaces.push(toolFaces(hull, local, of));
      }
      if (!cells.length) throw new Error('The shape has no inside to work with.');
    } else { // one convex mesh (every face flat, no two meeting at a reflex edge): its planes are read off its faces
      const fp = facePlanesOf(tool.positions, tool.indices);
      if (!fp.planes.length) throw new Error('The shape has no inside to work with.');
      for (const pl of fp.planes) planes.push({ n: pl.n.slice(), o: pl.o.slice() });
      cells.push(tool); cellPlanes.push(fp.planes.map((pl, g) => ({ g, sign: 1 }))); cellFaces.push(toolFaces(tool, fp.planes, fp.of));
    }
    const k = planes.length, signs = new Set();
    for (const cp of cellPlanes) for (const { g, sign } of cp) signs.add(g * 2 + (sign > 0 ? 0 : 1));
    const internal = new Uint8Array(k); for (let g = 0; g < k; g++) if (signs.has(g * 2) && signs.has(g * 2 + 1)) internal[g] = 1;
    // the tool moved whole by a few microns so no part vertex sits on a plane; its corners welded across cells
    const allC = []; for (const c of cells) for (let i = 0; i < c.positions.length; i++) allC.push(c.positions[i]);
    const tb0 = bounds(allC), pad = Math.max(diag(tb0) * 0.02, 0.05);
    const shift = toolShift(P, planes, scale, tb0.min.map(v => v - pad), tb0.max.map(v => v + pad));
    for (const pl of planes) { pl.o[0] += shift[0]; pl.o[1] += shift[1]; pl.o[2] += shift[2]; }
    const nA = P.length / 3, nt = I.length / 3;
    // the shared vertex table: the part's vertices, then the tool's corners, then every seam point by name
    const V = new F64List(P.length + allC.length + 1024);
    for (let i = 0; i < P.length; i++) V.a[i] = P[i]; V.n = P.length;
    const cBase = nA, cornerIds = new Map(), cellMap = [], ctol = scale * 1e-8;
    const cornerAt = (x, y, z) => { // the tool corner already at this spot, if any (cells share corners)
      const cx = Math.floor(x / ctol), cy = Math.floor(y / ctol), cz = Math.floor(z / ctol);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) { const list = cornerIds.get(`${cx + i},${cy + j},${cz + l}`); if (list) for (const id of list) if (Math.abs(V.a[3 * id] - x) < ctol && Math.abs(V.a[3 * id + 1] - y) < ctol && Math.abs(V.a[3 * id + 2] - z) < ctol) return id; }
      return -1;
    };
    for (const c of cells) {
      const map = new Int32Array(c.positions.length / 3);
      for (let v = 0; v < map.length; v++) {
        const x = c.positions[3 * v] + shift[0], y = c.positions[3 * v + 1] + shift[1], z = c.positions[3 * v + 2] + shift[2];
        let id = cornerAt(x, y, z);
        if (id < 0) { id = V.push3(x, y, z); const key = `${Math.floor(x / ctol)},${Math.floor(y / ctol)},${Math.floor(z / ctol)}`; if (!cornerIds.has(key)) cornerIds.set(key, []); cornerIds.get(key).push(id); }
        map[v] = id;
      }
      cellMap.push(map);
    }
    // the facets to cap: each cell's faces on planes the tool doesn't share inside itself
    const facets = [], facetOf = new Map();
    for (let c = 0; c < cells.length; c++) for (const f of cellFaces[c]) {
      if (!f) continue;
      const { g, sign } = cellPlanes[c][f.plane]; if (internal[g]) continue;
      facetOf.set(c * k + g, facets.length);
      facets.push({ g, sign, cell: c, ring: f.ring.map(v => cellMap[c][v]), other: f.other.map(j => (j >= 0 ? cellPlanes[c][j].g : -1)) });
    }
    const named = new Map();
    const pointOn = (key, make) => { let id = named.get(key); if (id === undefined) { const q = make(); id = typeof q === 'number' ? q : V.push3(q[0], q[1], q[2]); named.set(key, id); } return id; };
    const pos = (id) => [V.a[3 * id], V.a[3 * id + 1], V.a[3 * id + 2]];
    // only triangles whose box meets the tool's can touch it
    const lo = tb0.min.map(v => v - pad + shift[0]), hi = tb0.max.map(v => v + pad + shift[0]);
    const vdCache = new Map(); // part vertex -> its distances to every plane
    const vdOf = (v) => { let d = vdCache.get(v); if (!d) { d = new Float64Array(k); const q = [P[3 * v], P[3 * v + 1], P[3 * v + 2]]; for (let i = 0; i < k; i++) d[i] = dist(planes[i], q); vdCache.set(v, d); } return d; };
    const edgeKey = (a, b) => (a < b ? a * nA + b : b * nA + a);
    const inside = insideTester(P, I);
    const outTris = [], inTris = []; // the part's own surface, split
    const chains = facets.map(() => []); // per facet: the directed seam edges of the inside pieces, as [idA, idB]
    const onEdgeC = new Map(); // tool edge (i-j) -> seam corners on it
    const onEdge = new Map(); // part edge -> seam points on it, so the triangle across the edge splits there too
    const eps0 = scale * 1e-9; // a seam point this close to a plane lies on it (a tool edge through a part edge, a tool corner on a part face)
    const eps1 = scale * 1e-8; // two seam corners this close are one
    const registerOn = (v) => { for (let x = 0; x < v.on.length; x++) for (let y = x + 1; y < v.on.length; y++) { const ek = `${Math.min(v.on[x], v.on[y])}-${Math.max(v.on[x], v.on[y])}`; if (!onEdgeC.has(ek)) onEdgeC.set(ek, new Set()); onEdgeC.get(ek).add(v.id); } };
    // seam points by position, so a corner that three planes share (a ring's radial face meeting two wall facets
    // along one edge) or one on a part edge is made once however many plane pairs give it
    const cellsBy = new Map(), cellKey = (x, y, z) => `${Math.floor(x / eps1)},${Math.floor(y / eps1)},${Math.floor(z / eps1)}`;
    const noteSeam = (id) => { const q = pos(id), key = cellKey(q[0], q[1], q[2]); if (!cellsBy.has(key)) cellsBy.set(key, []); cellsBy.get(key).push(id); };
    const seamNear = (q, i, j) => { // an existing corner at q that lies on both planes: the same point by another pair
      const cx = Math.floor(q[0] / eps1), cy = Math.floor(q[1] / eps1), cz = Math.floor(q[2] / eps1);
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const list = cellsBy.get(`${cx + x},${cy + y},${cz + z}`); if (list) for (const o of list) { const r = pos(o); if (Math.abs(r[0] - q[0]) < eps1 && Math.abs(r[1] - q[1]) < eps1 && Math.abs(r[2] - q[2]) < eps1 && Math.abs(dist(planes[i], r)) < eps0 && Math.abs(dist(planes[j], r)) < eps0) return o; } }
      return -1;
    };
    const whole = []; // triangles left whole, with where they go
    const clipped = []; // triangles cut by the tool's planes: their pieces
    // a polygon piece clipped by one cell: the piece inside it (or null) and the pieces outside
    const clipByCell = (piece, cp, t, tpl, dOf, vtx) => {
      let { poly, labels } = piece; const outs = [];
      for (let q = 0; q < cp.length && poly.length >= 3; q++) {
        const { g: i, sign } = cp[q];
        const ds = poly.map(v => { const d = sign * dOf(v, i); return d > -eps0 && d < eps0 ? 0 : d; });
        for (let e = 0; e < poly.length; e++) if (ds[e] === 0 && !poly[e].on.includes(i)) { poly[e].on.push(i); registerOn(poly[e]); }
        if (ds.every(d => d <= 0)) continue; // all inside this plane
        if (ds.every(d => d >= 0)) { outs.push({ poly, labels }); poly = []; break; } // all outside: the rest is outside the cell
        const inP = [], inL = [], outP = [], outL = [];
        const m = poly.length, onI = { plane: i };
        for (let e = 0; e < m; e++) {
          const u = poly[e], w = poly[(e + 1) % m], du = ds[e], dw = ds[(e + 1) % m], lab = labels[e];
          // a ring's label list runs beside its vertices: labels[e] is the edge leaving vertex e
          if (du < 0) { inP.push(u); inL.push(lab); }
          else if (du > 0) { outP.push(u); outL.push(lab); }
          else { inP.push(u); inL.push(dw > 0 ? onI : lab); outP.push(u); outL.push(dw < 0 ? onI : lab); }
          if ((du < 0 && dw > 0) || (du > 0 && dw < 0)) {
            let id;
            if (lab.edge !== undefined) { // on an edge of the part: the same point whichever triangle asks
              const [p0, q0] = lab.ends.slice().sort((x, y) => x - y);
              id = pointOn(`e${lab.edge}p${i}`, () => { const x = pos(p0), y = pos(q0), dp = vdOf(p0)[i], dq = vdOf(q0)[i], s = dp / (dp - dq); if (!onEdge.has(lab.edge)) onEdge.set(lab.edge, []); onEdge.get(lab.edge).push(V.n / 3); return [x[0] + s * (y[0] - x[0]), x[1] + s * (y[1] - x[1]), x[2] + s * (y[2] - x[2])]; });
            } else { // on a seam of plane lab.plane cut by plane i: a corner where the tool's edge passes through the triangle
              const j = lab.plane, key = `c${Math.min(i, j)}-${Math.max(i, j)}t${t}`;
              id = pointOn(key, () => {
                const x = pos(u.id), y = pos(w.id), s = du / (du - dw), q2 = [x[0] + s * (y[0] - x[0]), x[1] + s * (y[1] - x[1]), x[2] + s * (y[2] - x[2])];
                const near = seamNear(q2, i, j); if (near >= 0) return near;
                const nid = V.push3(q2[0], q2[1], q2[2]); noteSeam(nid); return nid;
              });
            }
            const nvx = vtx(id, lab.edge !== undefined ? [i] : [lab.plane, i]);
            registerOn(nvx);
            // leaving the cell: the inside ring closes along the plane from here, the outside ring carries on along the edge
            if (du < 0) { inP.push(nvx); inL.push(onI); outP.push(nvx); outL.push(lab); }
            else { outP.push(nvx); outL.push(onI); inP.push(nvx); inL.push(lab); }
          }
        }
        const dedupe = (ring, labs) => { const r = [], l = []; for (let e = 0; e < ring.length; e++) { if (ring[e].id === ring[(e + 1) % ring.length].id) continue; r.push(ring[e]); l.push(labs[e]); } return [r, l]; };
        const [inRing, inLabs] = dedupe(inP, inL), [outRing, outLabs] = dedupe(outP, outL);
        if (outRing.length >= 3) outs.push({ poly: outRing, labels: outLabs });
        poly = inRing; labels = inLabs;
      }
      return { inside: poly.length >= 3 ? { poly, labels } : null, outs };
    };
    // first pass: clip every triangle near the tool by its cells
    for (let t = 0; t < nt; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      let out = false;
      for (let ax = 0; ax < 3 && !out; ax++) { const x0 = P[3 * a + ax], x1 = P[3 * b + ax], x2 = P[3 * c + ax]; if ((x0 < lo[ax] && x1 < lo[ax] && x2 < lo[ax]) || (x0 > hi[ax] && x1 > hi[ax] && x2 > hi[ax])) out = true; }
      if (out) { whole.push(a, b, c, 0); continue; }
      const da = vdOf(a), db = vdOf(b), dc = vdOf(c);
      // which cells the triangle can touch; whole inside one, or outside every one, needs no clipping
      const touch = []; let allIn = false;
      for (let cc = 0; cc < cells.length && !allIn; cc++) {
        let inAll = true, outOne = false;
        for (const { g: i, sign } of cellPlanes[cc]) { const x = sign * da[i], y = sign * db[i], z = sign * dc[i]; if (x > 0 || y > 0 || z > 0) inAll = false; if (x > 0 && y > 0 && z > 0) { outOne = true; break; } }
        if (inAll) allIn = true; else if (!outOne) touch.push(cc);
      }
      if (allIn) { whole.push(a, b, c, 1); continue; }
      if (!touch.length) { whole.push(a, b, c, 0); continue; }
      // the triangle's plane, for the corners where tool edges pass through it
      const pa = pos(a), pb2 = pos(b), pc = pos(c), tn = norm3(cross3([pb2[0] - pa[0], pb2[1] - pa[1], pb2[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]])), tpl = { n: tn, o: pa };
      const dOf = (v, i) => (v.orig !== undefined ? vdOf(v.orig)[i] : v.on.includes(i) ? 0 : dist(planes[i], pos(v.id)));
      // the polygon: vertices { id, on: planes it lies on }, one object per point within the triangle, edges
      // labelled by what they lie on (a part edge or a plane)
      const objs = new Map();
      const vtx = (id, on) => { let o = objs.get(id); if (!o) { o = { id, on: [] }; objs.set(id, o); } for (const i of on) if (!o.on.includes(i)) o.on.push(i); return o; };
      let pieces = [{ poly: [{ id: a, orig: a, on: [] }, { id: b, orig: b, on: [] }, { id: c, orig: c, on: [] }], labels: [{ edge: edgeKey(a, b), ends: [a, b] }, { edge: edgeKey(b, c), ends: [b, c] }, { edge: edgeKey(c, a), ends: [c, a] }] }];
      const insides = [];
      for (const cc of touch) {
        const next = [];
        for (const piece of pieces) { const r = clipByCell(piece, cellPlanes[cc], t, tpl, dOf, vtx); if (r.inside) insides.push({ ...r.inside, cell: cc }); for (const o of r.outs) next.push(o); }
        pieces = next;
      }
      // the seam edges of the inside pieces, per facet
      for (const ip of insides) for (let e = 0; e < ip.poly.length; e++) { const lab = ip.labels[e]; if (lab.plane === undefined) continue; const f = facetOf.get(ip.cell * k + lab.plane); if (f !== undefined) chains[f].push([ip.poly[e].id, ip.poly[(e + 1) % ip.poly.length].id]); }
      clipped.push({ pieces, insides });
    }
    // second pass: every edge of every piece is split at the seam points on it (the other pieces' points on a seam
    // plane, the points the triangle across a part edge made on it), then fanned
    const paramsOn = (u, w, ids, skipA, skipB) => {
      const x = pos(u), y = pos(w), dx = y[0] - x[0], dy = y[1] - x[1], dz = y[2] - x[2], L2 = dx * dx + dy * dy + dz * dz, mids = [];
      if (!(L2 > 0)) return mids;
      for (const id of ids) { if (id === skipA || id === skipB) continue; const z = pos(id), s = ((z[0] - x[0]) * dx + (z[1] - x[1]) * dy + (z[2] - x[2]) * dz) / L2; if (s > 1e-9 && s < 1 - 1e-9 && !mids.some(m => m[1] === id)) mids.push([s, id]); }
      mids.sort((p1, p2) => p1[0] - p2[0]);
      return mids;
    };
    const fan = (ring, into) => {
      if (ring.length === 3) { into.push(ring[0], ring[1], ring[2]); return; }
      let cx = 0, cy = 0, cz = 0; for (const id of ring) { cx += V.a[3 * id]; cy += V.a[3 * id + 1]; cz += V.a[3 * id + 2]; }
      const ctr = V.push3(cx / ring.length, cy / ring.length, cz / ring.length);
      for (let e = 0; e < ring.length; e++) into.push(ring[e], ring[(e + 1) % ring.length], ctr);
    };
    for (let q = 0; q < whole.length; q += 4) {
      const a = whole[q], b = whole[q + 1], c = whole[q + 2], into = whole[q + 3] ? inTris : outTris;
      const ring = [];
      for (const [u, w] of [[a, b], [b, c], [c, a]]) { ring.push(u); const ids = onEdge.get(edgeKey(u, w)); if (ids) for (const m of paramsOn(u, w, ids, -1, -1)) ring.push(m[1]); }
      fan(ring, into);
    }
    for (const { pieces, insides } of clipped) {
      const allPts = [];
      for (const pc of pieces) for (const v of pc.poly) allPts.push(v);
      for (const pc of insides) for (const v of pc.poly) allPts.push(v);
      const sewn = (pc) => {
        const ring = [];
        for (let e = 0; e < pc.poly.length; e++) {
          const u = pc.poly[e], w = pc.poly[(e + 1) % pc.poly.length], lab = pc.labels[e];
          ring.push(u.id);
          const ids = lab.plane !== undefined ? allPts.filter(v => v.on.includes(lab.plane)).map(v => v.id) : onEdge.get(lab.edge);
          if (ids) for (const m of paramsOn(u.id, w.id, ids, u.id, w.id)) ring.push(m[1]);
        }
        return ring;
      };
      for (const pc of pieces) fan(sewn(pc), outTris);
      for (const pc of insides) fan(sewn(pc), inTris);
    }
    // the tool's facets, each cut by the seam chains into regions that are inside or outside the part
    const regs = [];
    for (let fi = 0; fi < facets.length; fi++) {
      const face = facets[fi], i = face.g, nOut = face.sign > 0 ? planes[i].n : planes[i].n.map(x => -x), F = frameFromNormal(nOut, planes[i].o);
      const xy = (id) => { const q = pos(id), dx = q[0] - F.o[0], dy = q[1] - F.o[1], dz = q[2] - F.o[2]; return [dx * F.u[0] + dy * F.u[1] + dz * F.u[2], dx * F.v[0] + dy * F.v[1] + dz * F.v[2]]; };
      // nodes: the facet's corners and the seam corners on its edges, in order round the outline
      const ringIds = face.ring, m = ringIds.length, outline = [];
      for (let e = 0; e < m; e++) {
        const u = ringIds[e], w = ringIds[(e + 1) % m], j = face.other[e];
        const pu = pos(u), pw = pos(w), pts = [];
        if (j >= 0) { const set = onEdgeC.get(`${Math.min(i, j)}-${Math.max(i, j)}`); if (set) for (const id of set) pts.push(id); }
        const dx = pw[0] - pu[0], dy = pw[1] - pu[1], dz = pw[2] - pu[2], L2 = dx * dx + dy * dy + dz * dz;
        const ordered = pts.map(id => { const q = pos(id); return [((q[0] - pu[0]) * dx + (q[1] - pu[1]) * dy + (q[2] - pu[2]) * dz) / L2, id]; }).filter(x => x[0] > 1e-9 && x[0] < 1 - 1e-9).sort((p1, p2) => p1[0] - p2[0]);
        outline.push(u); for (const o of ordered) if (!outline.includes(o[1])) outline.push(o[1]);
      }
      // the planar graph: the outline runs anticlockwise (facing out) and the seam chains run as the part's surface
      // gives them; faces are found by walking, turning as far left as possible
      const adj = new Map(), addEdge = (u, w) => { if (u === w) return; if (!adj.has(u)) adj.set(u, []); if (!adj.has(w)) adj.set(w, []); adj.get(u).push(w); adj.get(w).push(u); };
      for (let e = 0; e < outline.length; e++) addEdge(outline[e], outline[(e + 1) % outline.length]);
      const chainSet = new Set();
      for (const [u, w] of chains[fi]) { addEdge(u, w); chainSet.add(u + '>' + w); }
      const nodes = [...adj.keys()], XY = new Map(nodes.map(id => [id, xy(id)]));
      for (const [u, list] of adj) { const [ux, uy] = XY.get(u); const uniq = [...new Set(list)]; uniq.sort((p1, p2) => Math.atan2(XY.get(p1)[1] - uy, XY.get(p1)[0] - ux) - Math.atan2(XY.get(p2)[1] - uy, XY.get(p2)[0] - ux)); adj.set(u, uniq); }
      const used = new Set(), loops = [];
      for (const [u, list] of adj) for (const w of list) {
        const k0 = u + '>' + w; if (used.has(k0)) continue;
        const loop = [u]; let cur = u, nxt = w, guard = 0;
        while (guard++ < 100000) {
          used.add(cur + '>' + nxt); loop.push(nxt);
          const nb = adj.get(nxt), idx = nb.indexOf(cur), after = nb[(idx - 1 + nb.length) % nb.length]; // the edge just clockwise of the way back: the leftmost turn
          cur = nxt; nxt = after;
          if (cur === u && nxt === w) break;
        }
        loop.pop();
        if (loop.length >= 3) loops.push(loop);
      }
      // signed area in the facet's frame: anticlockwise loops are regions, clockwise ones holes; the loop round the
      // outside of the facet runs the outline backwards
      const area = (loop) => { let s = 0; for (let e = 0; e < loop.length; e++) { const p1 = XY.get(loop[e]), p2 = XY.get(loop[(e + 1) % loop.length]); s += p1[0] * p2[1] - p2[0] * p1[1]; } return s / 2; };
      const hasEdge = (loop, u, w) => loop.some((x, e) => x === u && loop[(e + 1) % loop.length] === w);
      const regions = loops.filter(l => area(l) > 0), holes = loops.filter(l => area(l) < 0 && !hasEdge(l, outline[1], outline[0]));
      const inRing = (loop, px, py) => { let ins = false; for (let e = 0, f = loop.length - 1; e < loop.length; f = e++) { const [x1, y1] = XY.get(loop[e]), [x2, y2] = XY.get(loop[f]); if ((y1 > py) !== (y2 > py) && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) ins = !ins; } return ins; };
      // a point just inside a hole: off the middle of its first edge, to the right (the hole lies on the right of a clockwise loop)
      const holePoint = (h) => { const [x1, y1] = XY.get(h[0]), [x2, y2] = XY.get(h[1]), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1; return [(x1 + x2) / 2 + (dy / L) * L * 1e-6, (y1 + y2) / 2 - (dx / L) * L * 1e-6]; };
      for (const reg of regions) {
        const regArea = area(reg), myHoles = [];
        for (const h of holes) { if (hasEdge(h, reg[1], reg[0])) continue; const [hx, hy] = holePoint(h); if (Math.abs(area(h)) < regArea * (1 + 1e-9) && inRing(reg, hx, hy)) { let best = true; for (const r2 of regions) if (r2 !== reg && area(r2) < regArea && area(r2) > Math.abs(area(h)) && !hasEdge(r2, h[1], h[0]) && inRing(r2, hx, hy)) { best = false; break; } if (best) myHoles.push(h); } }
        const flat = [], ids = [], hIdx = [];
        for (const id of reg) { ids.push(id); const q = XY.get(id); flat.push(q[0], q[1]); }
        for (const h of myHoles) { hIdx.push(ids.length); for (const id of h) { ids.push(id); const q = XY.get(id); flat.push(q[0], q[1]); } }
        const loc = earcut(flat, hIdx);
        if (!loc.length) continue;
        const tris = []; for (let e = 0; e < loc.length; e += 3) tris.push(ids[loc[e]], ids[loc[e + 1]], ids[loc[e + 2]]);
        for (const r of [reg, ...myHoles]) fixTJunctions(tris, r);
        // which side of the part: a region runs with the facet on its left, and the part's inside piece lies on the
        // left of each seam edge, so a region whose boundary runs against a seam edge is inside the part
        let votes = 0;
        const keys = [];
        for (const r of [reg, ...myHoles]) for (let e = 0; e < r.length; e++) { const p1 = r[e], p2 = r[(e + 1) % r.length]; if (chainSet.has(p2 + '>' + p1)) votes++; else if (chainSet.has(p1 + '>' + p2)) votes--; else keys.push(p1 + '>' + p2); }
        regs.push({ tris, votes, keys, nOut });
      }
    }
    // a region with no seam on its boundary takes its side from its neighbours: across a tool edge with no seam
    // point on it the regions on both facets are on the same side of the part; only a tool nowhere near a seam
    // (wholly in or out of the part) is tested with a line through the model
    const byKey = new Map(), rParent = new Int32Array(regs.length);
    for (let r = 0; r < regs.length; r++) { rParent[r] = r; for (const key of regs[r].keys) byKey.set(key, r); }
    const rFind = (x) => { while (rParent[x] !== x) { rParent[x] = rParent[rParent[x]]; x = rParent[x]; } return x; };
    for (let r = 0; r < regs.length; r++) for (const key of regs[r].keys) { const [u, w] = key.split('>'); const o = byKey.get(w + '>' + u); if (o !== undefined) rParent[rFind(r)] = rFind(o); }
    const compVotes = new Map();
    for (let r = 0; r < regs.length; r++) { const c = rFind(r); compVotes.set(c, (compVotes.get(c) || 0) + regs[r].votes); }
    const capIn = [], capOut = [];
    for (let r = 0; r < regs.length; r++) {
      const { tris, nOut } = regs[r]; let v = compVotes.get(rFind(r)), isIn;
      if (v !== 0) isIn = v > 0;
      else {
        const q0 = pos(tris[0]), q1 = pos(tris[1]), q2 = pos(tris[2]), mx = (q0[0] + q1[0] + q2[0]) / 3, my = (q0[1] + q1[1] + q2[1]) / 3, mz = (q0[2] + q1[2] + q2[2]) / 3;
        const nudge = nOut.map(x => -x * scale * 1e-4); // just inside the tool, off the plane
        isIn = inside(mx + nudge[0], my + nudge[1], mz + nudge[2]);
        compVotes.set(rFind(r), isIn ? 1 : -1);
      }
      const dest = isIn ? capIn : capOut; for (const id of tris) dest.push(id);
    }
    // assemble by operation: the caps face out of the tool (anticlockwise in the facet frame)
    const idx = [];
    const pushCap = (list, flip) => { for (let e = 0; e < list.length; e += 3) { if (flip) idx.push(list[e], list[e + 2], list[e + 1]); else idx.push(list[e], list[e + 1], list[e + 2]); } };
    if (op === 'intersect') { pushCap(inTris, false); pushCap(capIn, false); }
    else if (op === 'difference') { pushCap(outTris, false); pushCap(capIn, true); }
    else { pushCap(outTris, false); pushCap(capOut, false); }
    if (!idx.length) throw new Error(op === 'intersect' ? 'The shape and the part don’t overlap, so there is nothing to keep.' : 'The shape covers the whole part, so nothing would be left.');
    // seam points already share ids, so the weld only folds exact doubles. Slivers thinner than a float32 step
    // (a plane passing within microns of a vertex) are collapsed first, so no two vertices land on one float32
    // position: the next boolean, or a cut, would trip over them.
    const short = collapseShortEdges(V.a.subarray(0, V.n), new Uint32Array(idx), scale * 1e-6);
    const w = weld(short.positions, short.indices, Math.max(scale * 1e-12, 1e-12)), rep = edgeReport(w.indices);
    if (!rep.closed) throw new Error(`The result isn’t sealed where the shape meets the part (${rep.openEdges} open and ${rep.badEdges} tangled edges). Move the shape a little and try again.`);
    if (volume(w.positions, w.indices) < 0) flipAll(w.indices);
    // only the vertices a triangle uses: the tool's corners inside the part, and seam points of dropped pieces, go
    const used = new Int32Array(w.positions.length / 3).fill(-1); let nu = 0;
    for (let i = 0; i < w.indices.length; i++) if (used[w.indices[i]] < 0) used[w.indices[i]] = nu++;
    const cpos = new Float32Array(nu * 3), cidx = new Uint32Array(w.indices.length);
    for (let v = 0; v < used.length; v++) if (used[v] >= 0) { cpos[3 * used[v]] = w.positions[3 * v]; cpos[3 * used[v] + 1] = w.positions[3 * v + 1]; cpos[3 * used[v] + 2] = w.positions[3 * v + 2]; }
    for (let i = 0; i < w.indices.length; i++) cidx[i] = used[w.indices[i]];
    return { positions: cpos, indices: cidx };
  }
  // A ring is not convex: it is taken as its sectors, each the prism of the ring's profile over one step round,
  // convex cells that share their radial faces and the flat top and bottom. One list of planes serves every
  // sector (a shared plane is one object, used with either sign), so neighbouring cells agree exactly.
  function ringSectors(s) {
    const n = Math.max(8, Math.min(256, Math.round(s.segments || 64))), r = s.w / 2, ri = Math.max(0.01, Math.min(s.inner / 2, r - 0.01)), h = s.h;
    const prof = shapedCorners([[ri, -h / 2], [r, -h / 2], [r, h / 2], [ri, h / 2]], true, s.edge || 'sharp', s.edgeSize || 0);
    let cr = 0, cz = 0; for (const [pr, pz] of prof) { cr += pr; cz += pz; } cr /= prof.length; cz /= prof.length;
    const planes = [], flat = new Map(), radial = [];
    for (let i = 0; i < n; i++) { const a0 = (2 * Math.PI * i) / n; radial.push(planes.length); planes.push({ n: [Math.sin(a0), -Math.cos(a0), 0], o: [0, 0, 0] }); }
    const cells = [];
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n, am = (a0 + a1) / 2, centre = [cr * Math.cos(am), cr * Math.sin(am), cz];
      const cell = [{ g: radial[i], sign: 1 }, { g: radial[(i + 1) % n], sign: -1 }];
      for (let q = 0; q < prof.length; q++) {
        const [r0, z0] = prof[q], [r1, z1] = prof[(q + 1) % prof.length];
        if (Math.abs(z1 - z0) < 1e-9) { // flat: one plane for every sector
          if (!flat.has(q)) { flat.set(q, planes.length); planes.push({ n: [0, 0, z0 > cz ? 1 : -1], o: [0, 0, z0] }); }
          cell.push({ g: flat.get(q), sign: 1 }); continue;
        }
        const A = [r0 * Math.cos(a0), r0 * Math.sin(a0), z0], B = [r1 * Math.cos(a0), r1 * Math.sin(a0), z1], C = [r0 * Math.cos(a1), r0 * Math.sin(a1), z0];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], nn = norm3(cross3(u, v));
        if (!(Math.hypot(nn[0], nn[1], nn[2]) > 0.5)) continue;
        if ((centre[0] - A[0]) * nn[0] + (centre[1] - A[1]) * nn[1] + (centre[2] - A[2]) * nn[2] > 0) { nn[0] = -nn[0]; nn[1] = -nn[1]; nn[2] = -nn[2]; }
        cell.push({ g: planes.length, sign: 1 }); planes.push({ n: nn, o: A });
      }
      cells.push(cell);
    }
    return { planes, cells };
  }
  // The shape, placed as the app places it (turned X then Y then Z in degrees, then moved), applied to the part
  function booleanShape(P, I, sp, op) {
    const R = (() => { const [x, y, z] = sp.rot.map(v => (v * Math.PI) / 180), a = Math.cos(x), b2 = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z); return [[c * e, -c * f, d], [a * f + b2 * e * d, a * e - b2 * f * d, -b2 * c], [b2 * f - a * e * d, b2 * e + a * f * d, a * c]]; })();
    const place = (p) => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + sp.pos[0], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + sp.pos[1], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + sp.pos[2]];
    const turn = (n) => [R[0][0] * n[0] + R[0][1] * n[1] + R[0][2] * n[2], R[1][0] * n[0] + R[1][1] * n[1] + R[1][2] * n[2], R[2][0] * n[0] + R[2][1] * n[1] + R[2][2] * n[2]];
    if (sp.kind === 'ring') {
      const rs = ringSectors(sp);
      return booleanWith(P, I, { planes: rs.planes.map(pl => ({ n: turn(pl.n), o: place(pl.o) })), cells: rs.cells }, op);
    }
    const m = shapeMesh(sp), placed = new Float64Array(m.positions.length);
    for (let i = 0; i < m.positions.length; i += 3) { const q = place([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); placed[i] = q[0]; placed[i + 1] = q[1]; placed[i + 2] = q[2]; }
    return booleanWith(P, I, { positions: placed, indices: m.indices }, op);
  }

  function boxMesh(min, max) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const P = new Float64Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
    const I = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    return { positions: P, indices: I };
  }
  // The solid inside every plane {o, n} (n pointing out), as a mesh: a box round the planes, clipped by each in turn
  // The convex solid inside a set of outward planes, built face by face: each plane's face is a big square
  // clipped by every other plane, so a corner where three planes meet is one shared vertex and every face is
  // exactly flat. Closed, facing out; empty when the planes leave nothing.
  function hullMesh(planes) {
    const m = planes.length, pos = [], idx = [], corner = new Map();
    let R = 0; for (const pl of planes) R = Math.max(R, Math.hypot(pl.o[0], pl.o[1], pl.o[2])); R = R * 4 + 1;
    const eps = R * 1e-9;
    const dist = (pl, q) => (q[0] - pl.o[0]) * pl.n[0] + (q[1] - pl.o[1]) * pl.n[1] + (q[2] - pl.o[2]) * pl.n[2];
    const meet = (p1, p2, p3) => {
      const n1 = p1.n, n2 = p2.n, n3 = p3.n, d1 = n1[0] * p1.o[0] + n1[1] * p1.o[1] + n1[2] * p1.o[2], d2 = n2[0] * p2.o[0] + n2[1] * p2.o[1] + n2[2] * p2.o[2], d3 = n3[0] * p3.o[0] + n3[1] * p3.o[1] + n3[2] * p3.o[2];
      const c23 = cross3(n2, n3), c31 = cross3(n3, n1), c12 = cross3(n1, n2), det = n1[0] * c23[0] + n1[1] * c23[1] + n1[2] * c23[2];
      if (Math.abs(det) < 1e-6) return null; // the three planes share a line (a chamfer that just touches a corner)
      return [(d1 * c23[0] + d2 * c31[0] + d3 * c12[0]) / det, (d1 * c23[1] + d2 * c31[1] + d3 * c12[1]) / det, (d1 * c23[2] + d2 * c31[2] + d3 * c12[2]) / det];
    };
    // a corner is shared by the three planes through it; where more planes meet at one point the copies are welded
    const idOf = (i, j, l, q) => {
      const key = [i, j, l].sort((x, y) => x - y).join(','); let id = corner.get(key);
      if (id === undefined) { let e = meet(planes[i], planes[j], planes[l]); if (!e || Math.hypot(e[0] - q[0], e[1] - q[1], e[2] - q[2]) > R * 1e-6) e = q; id = pos.length / 3; pos.push(e[0], e[1], e[2]); corner.set(key, id); }
      return id;
    };
    for (let i = 0; i < m; i++) {
      const F = frameFromNormal(planes[i].n, planes[i].o);
      let poly = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([x, y]) => ({ q: [F.o[0] + F.u[0] * x + F.v[0] * y, F.o[1] + F.u[1] * x + F.v[1] * y, F.o[2] + F.u[2] * x + F.v[2] * y], on: -1 })); // on: the plane of the edge leaving the vertex
      for (let j = 0; j < m && poly.length >= 3; j++) {
        if (j === i) continue;
        const ds = poly.map(v => { const d = dist(planes[j], v.q); return d > -eps && d < eps ? 0 : d; }), next = [];
        for (let e = 0; e < poly.length; e++) {
          const u = poly[e], w = poly[(e + 1) % poly.length], du = ds[e], dw = ds[(e + 1) % poly.length];
          if (du < 0) next.push(u);
          else if (du === 0) next.push(dw > 0 ? { q: u.q, on: j } : u); // on the plane: the face turns along it where the edge would leave
          if ((du < 0 && dw > 0) || (du > 0 && dw < 0)) { const s = du / (du - dw), q = [u.q[0] + s * (w.q[0] - u.q[0]), u.q[1] + s * (w.q[1] - u.q[1]), u.q[2] + s * (w.q[2] - u.q[2])]; next.push(du < 0 ? { q, on: j } : { q, on: u.on }); }
        }
        poly = next;
      }
      if (poly.length < 3 || poly.some(v => v.on < 0)) continue;
      const ids = poly.map((v, e) => idOf(i, poly[(e - 1 + poly.length) % poly.length].on, v.on, v.q));
      for (let e = 1; e + 1 < ids.length; e++) if (ids[0] !== ids[e] && ids[e] !== ids[e + 1] && ids[0] !== ids[e + 1]) idx.push(ids[0], ids[e], ids[e + 1]);
    }
    if (!idx.length) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
    const w = weld(new Float64Array(pos), new Uint32Array(idx), R * 1e-8, true);
    return { positions: w.positions, indices: w.indices };
  }
  function polytopeMesh(planes, box) {
    const bp = [];
    for (let ax = 0; ax < 3; ax++) { const n0 = [0, 0, 0], n1 = [0, 0, 0]; n0[ax] = -1; n1[ax] = 1; bp.push({ n: n0, o: box.min.slice() }, { n: n1, o: box.max.slice() }); }
    return hullMesh([...planes, ...bp]);
  }
  // A profile of (r, z) points turned round the z axis in n steps. An open profile runs from the axis to the axis
  // (a ball, a tube, a cone); a closed one (closed: true) is a loop off the axis (a ring). Closed solid, facing out.
  function latheMesh(profile, n, closed = false) {
    const m = profile.length, pos = [], idx = [];
    const ringOf = [];
    for (let k = 0; k < m; k++) {
      const [r, z] = profile[k];
      if (!closed && r <= 1e-9) { ringOf.push(-1 - pos.length / 3); pos.push(0, 0, z); continue; } // a pole
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pos.push(r * Math.cos(a), r * Math.sin(a), z); }
      ringOf.push(base);
    }
    const quad = (ka, kb) => {
      const A = ringOf[ka], B = ringOf[kb];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (A < 0 && B < 0) continue;
        if (A < 0) { idx.push(-1 - A, B + i, B + j); continue; }
        if (B < 0) { idx.push(A + i, -1 - B, A + j); continue; }
        idx.push(A + i, B + i, B + j, A + i, B + j, A + j);
      }
    };
    for (let k = 0; k + 1 < m; k++) quad(k, k + 1);
    if (closed) quad(m - 1, 0);
    const P = new Float64Array(pos), I = new Uint32Array(idx);
    if (volume(P, I) < 0) flipAll(I);
    return { positions: P, indices: I };
  }
  // Replace each convex corner of a 2D polyline (or loop) by a chamfer or an arc; corners on the axis (r = 0) stay
  function shapedCorners(pts, closed, edge, size, arcSteps = 4) {
    if (!edge || edge === 'sharp' || !(size > 0)) return pts;
    const m = pts.length, out = [];
    for (let k = 0; k < m; k++) {
      const p = pts[k], prev = pts[(k - 1 + m) % m], next = pts[(k + 1) % m];
      const first = !closed && k === 0, last = !closed && k === m - 1;
      if (first || last || p[0] <= 1e-9) { out.push(p); continue; }
      const d0 = [prev[0] - p[0], prev[1] - p[1]], d1 = [next[0] - p[0], next[1] - p[1]];
      const l0 = Math.hypot(d0[0], d0[1]), l1 = Math.hypot(d1[0], d1[1]);
      const s = Math.min(size, l0 / 2, l1 / 2);
      if (s <= 1e-9) { out.push(p); continue; }
      const a = [p[0] + d0[0] / l0 * s, p[1] + d0[1] / l0 * s], c = [p[0] + d1[0] / l1 * s, p[1] + d1[1] / l1 * s];
      if (edge === 'chamfer') { out.push(a, c); continue; }
      // a round: an arc from a to c tangent to both edges, as a quadratic curve through the corner
      for (let i = 0; i <= arcSteps; i++) {
        const u = i / arcSteps, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        out.push([w0 * a[0] + w1 * p[0] + w2 * c[0], w0 * a[1] + w1 * p[1] + w2 * c[1]]);
      }
    }
    return out;
  }
  // A box with rounded edges and corners of radius r: the box (w - 2r) × (d - 2r) × (h - 2r) grown by a ball of
  // radius r, sampled over a cube-shaped grid of directions (an odd count a side, so no direction lies exactly on an
  // axis plane and the flat faces and the rounded edges are spanned by the grid's own quads).
  function roundedBoxMesh(w, d, h, r, N = 9) {
    const half = [w / 2 - r, d / 2 - r, h / 2 - r], pos = [], idx = [];
    const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]]; // (a, b, fixed axis, sign)
    for (const [a, b, c, s] of faces) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const q = [0, 0, 0]; q[a] = -1 + (2 * i) / N; q[b] = -1 + (2 * j) / N; q[c] = s;
        const l = Math.hypot(q[0], q[1], q[2]), u = [q[0] / l, q[1] / l, q[2] / l];
        pos.push(Math.sign(u[0]) * half[0] + r * u[0], Math.sign(u[1]) * half[1] + r * u[1], Math.sign(u[2]) * half[2] + r * u[2]);
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const p00 = base + i * (N + 1) + j, p10 = p00 + N + 1, p01 = p00 + 1, p11 = p10 + 1;
        // the shorter diagonal keeps the surface convex (the longer one would fold in at a rounded edge)
        const d2 = (a, b) => (pos[3 * a] - pos[3 * b]) ** 2 + (pos[3 * a + 1] - pos[3 * b + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * b + 2]) ** 2;
        if (d2(p00, p11) <= d2(p10, p01)) { if (s > 0) idx.push(p00, p10, p11, p00, p11, p01); else idx.push(p00, p11, p10, p00, p01, p11); }
        else if (s > 0) idx.push(p00, p10, p01, p10, p11, p01); else idx.push(p00, p01, p10, p10, p01, p11);
      }
    }
    const m = weld(new Float64Array(pos), new Uint32Array(idx), 1e-9, true);
    if (volume(m.positions, m.indices) < 0) flipAll(m.indices);
    return m;
  }
  // A shape centred on the origin, standing on z: { kind, w, d, h, inner, edge, edgeSize, segments }. w, d and h
  // are the full width, depth and height (the round ones use w as the diameter; a cone's top is d; a ring's hole is inner).
  function shapeMesh(s) {
    const n = Math.max(8, Math.min(256, Math.round(s.segments || 64)));
    const h = s.h, edge = s.edge || 'sharp', es = s.edgeSize || 0;
    if (s.kind === 'cube') {
      const w = s.w, d = s.d, planes = [];
      const c = Math.min(es, (edge === 'chamfer' ? 0.5 : 0.98) * Math.min(w, d, h) / 2); // chamfers from opposite edges must not meet
      if (edge === 'round' && c > 0) return roundedBoxMesh(w, d, h, c, Math.max(5, Math.min(21, Math.round(n / 6)) | 1));
      const box = { min: [-w / 2, -d / 2, -h / 2], max: [w / 2, d / 2, h / 2] };
      if (edge !== 'chamfer' || !(c > 0)) return boxMesh(box.min, box.max);
      const half = [w / 2, d / 2, h / 2], push = (nrm, pt) => planes.push({ n: norm3(nrm), o: pt });
      for (let ax = 0; ax < 3; ax++) for (const sa of [-1, 1]) for (const sb of [-1, 1]) { // the twelve edges, at 45°
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, nrm = [0, 0, 0], pt = [0, 0, 0];
        nrm[a1] = sa; nrm[a2] = sb; pt[a1] = sa * (half[a1] - c); pt[a2] = sb * half[a2];
        push(nrm, pt);
      }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) push([sx, sy, sz], [sx * (half[0] - c), sy * half[1], sz * half[2]]); // the eight corners
      return polytopeMesh(planes, box);
    }
    const r = s.w / 2;
    if (s.kind === 'ball') {
      const m = Math.max(6, Math.round(n / 2)), prof = [];
      for (let i = 0; i <= m; i++) { const a = Math.PI * i / m; prof.push([r * Math.sin(a), -r * Math.cos(a)]); }
      prof[0][0] = 0; prof[m][0] = 0;
      return latheMesh(prof, n);
    }
    if (s.kind === 'tube') return latheMesh(shapedCorners([[0, -h / 2], [r, -h / 2], [r, h / 2], [0, h / 2]], false, edge, es), n);
    if (s.kind === 'cone') { const r2 = Math.max(0, (s.d || 0) / 2); return latheMesh(shapedCorners([[0, -h / 2], [r, -h / 2], [r2, h / 2], [0, h / 2]], false, edge, es), n); }
    if (s.kind === 'ring') { const ri = Math.max(0.01, Math.min(s.inner / 2, r - 0.01)); return latheMesh(shapedCorners([[ri, -h / 2], [r, -h / 2], [r, h / 2], [ri, h / 2]], true, edge, es), n, true); }
    throw new Error(`Unknown shape: ${s.kind}`);
  }
  /* ---- The exploded view ----
     The owner on 1.95: "explode is not intelligent and parts are intersecting when exploded". Every piece used to move
     along its own pull, on its own: the body moved too, a hand and the sleeve it plugs into went separate ways, and a
     sleeve that slides down from under a cape kept sliding into the skirt. Now the pieces are read as an assembly:
     - **Mates** come from the geometry. Pieces that share a cut face share its points exactly, so every point is
       hashed by its float32 bits; two pieces are mates when they share a face's worth of points, and the triangles
       of one whose corners are all shared with the other are the joint, whose summed normal says which way it faces.
     - **A tree** per group of mated pieces: the biggest piece is the root and never moves. A piece hangs on the mate
       nearest the root it shares the biggest joint with, except that a piece which stands in the way of a mate's
       slide is carried by that mate (a hand on the end of a sleeve), so the sleeve can come off at all.
     - **A path** per piece, relative to its parent: along its slide direction (the cut's own pull when it agrees with
       the joint) only as far as nothing is in the way, then along the freest of a few directions outward. "In the
       way" is measured by lines from points spread over the piece (and over what it carries) to the first face of
       any other piece.
     - **In turn**: a parent starts once the pieces it carries have come out of their joints.
     `explodePlan` works this out once per set of parts; `explodeAt(plan, k)` gives each part's offset at amount k. */
  // The first face a ray enters (its front), between minT and maxT along it, or -1. The ray may start outside the grid.
  function castFirst(grid, P, I, o, d, maxT, minT = 0) {
    const { lo, size, dims, start, tris } = grid;
    let t0 = minT, t1 = maxT;
    for (let k = 0; k < 3; k++) {
      const a = lo[k], b = lo[k] + dims[k] * size;
      if (d[k] === 0) { if (o[k] < a || o[k] > b) return -1; continue; }
      let ta = (a - o[k]) / d[k], tb = (b - o[k]) / d[k]; if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    const idx = [0, 0, 0], step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      idx[k] = Math.min(dims[k] - 1, Math.max(0, Math.floor((o[k] + d[k] * t0 - lo[k]) / size)));
      step[k] = Math.sign(d[k]);
      if (d[k] === 0) { tMax[k] = Infinity; tDelta[k] = Infinity; continue; }
      tMax[k] = (lo[k] + (idx[k] + (step[k] > 0 ? 1 : 0)) * size - o[k]) / d[k]; tDelta[k] = Math.abs(size / d[k]);
    }
    let best = -1, guard = 0;
    while (guard++ < dims[0] + dims[1] + dims[2] + 3) {
      const c = (idx[0] * dims[1] + idx[1]) * dims[2] + idx[2];
      for (let q = start[c]; q < start[c + 1]; q++) {
        const t = tris[q], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], cc = 3 * I[3 * t + 2];
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det <= 1e-12) continue; // only a face the ray meets from its front: going into the solid
        const inv = 1 / det, tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt >= minT && tt <= maxT && (best < 0 || tt < best)) best = tt;
      }
      const tCell = Math.min(tMax[0], tMax[1], tMax[2]);
      if (best >= 0 && best <= tCell) return best;
      if (tCell > t1) return best;
      const k = tMax[0] <= tMax[1] ? (tMax[0] <= tMax[2] ? 0 : 2) : (tMax[1] <= tMax[2] ? 1 : 2);
      idx[k] += step[k]; tMax[k] += tDelta[k];
      if (idx[k] < 0 || idx[k] >= dims[k]) return best;
    }
    return best;
  }
  // About `n` points spread evenly by area over a surface, each with its face's normal: [x, y, z, nx, ny, nz, …]
  function surfaceSamples(P, I, n) {
    const nt = I.length / 3, A = new Float64Array(nt); let total = 0;
    for (let t = 0; t < nt; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const x = (P[b + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[b + 2] - P[a + 2]) * (P[c + 1] - P[a + 1]), y = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]), z = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
      A[t] = Math.hypot(x, y, z) / 2; total += A[t];
    }
    const out = []; let acc = 0.5, seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let t = 0; t < nt && total > 0; t++) {
      acc += (A[t] / total) * n;
      let first = true;
      while (acc >= 1) {
        acc -= 1;
        const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
        let u = 1 / 3, v = 1 / 3;
        if (!first) { u = rnd(); v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } u = 0.02 + 0.94 * u; v = 0.02 + 0.94 * v; }
        first = false;
        const w = 1 - u - v;
        const nx = (P[b + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[b + 2] - P[a + 2]) * (P[c + 1] - P[a + 1]), ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]), nz = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]), L = Math.hypot(nx, ny, nz) || 1;
        out.push(w * P[a] + u * P[b] + v * P[c], w * P[a + 1] + u * P[b + 1] + v * P[c + 1], w * P[a + 2] + u * P[b + 2] + v * P[c + 2], nx / L, ny / L, nz / L);
      }
    }
    return new Float64Array(out);
  }
  // Which pieces share cut faces: per pair, the points they share (as vertices of the lower-numbered piece), the
  // joint's area, and the way from the one to the other across it
  function explodeMates(pieces) {
    const n = pieces.length; let nv = 0; for (const p of pieces) nv += p.P.length / 3;
    let cap = 16; while (cap < nv * 2) cap *= 2;
    const table = new Int32Array(cap).fill(-1), ux = new Uint32Array(nv), uy = new Uint32Array(nv), uz = new Uint32Array(nv), last = new Int32Array(nv).fill(-1), cnt = new Int32Array(nv);
    let nu = 0;
    const ids = pieces.map((p, pi) => {
      const bits = new Uint32Array(p.P.buffer, p.P.byteOffset, p.P.length), m = p.P.length / 3, id = new Int32Array(m);
      for (let v = 0; v < m; v++) {
        let x = bits[3 * v], y = bits[3 * v + 1], z = bits[3 * v + 2];
        if (x === 0x80000000) x = 0; if (y === 0x80000000) y = 0; if (z === 0x80000000) z = 0;
        let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0; h = (h ^ (h >>> 15)) & (cap - 1);
        for (;;) { const e = table[h]; if (e < 0) { table[h] = nu; ux[nu] = x; uy[nu] = y; uz[nu] = z; id[v] = nu++; break; } if (ux[e] === x && uy[e] === y && uz[e] === z) { id[v] = e; break; } h = (h + 1) & (cap - 1); }
        if (last[id[v]] !== pi) { last[id[v]] = pi; cnt[id[v]]++; }
      }
      return id;
    });
    // the pieces at each point held by more than one
    const start = new Int32Array(nu + 1); for (let u = 0; u < nu; u++) start[u + 1] = start[u] + (cnt[u] > 1 ? cnt[u] : 0);
    const fill = start.slice(0, nu), who = new Int32Array(start[nu]); last.fill(-1);
    ids.forEach((id, pi) => { for (let v = 0; v < id.length; v++) { const u = id[v]; if (cnt[u] > 1 && last[u] !== pi) { last[u] = pi; who[fill[u]++] = pi; } } });
    const pairs = new Map(); // i * n + j (i < j) → { i, j, pts: [vertex of i, …], a: [area, x, y, z] of i's side, b: of j's }
    const pairOf = (i, j) => { const k = i < j ? i * n + j : j * n + i; let q = pairs.get(k); if (!q) { q = { i: Math.min(i, j), j: Math.max(i, j), pts: [], tris: [], a: [0, 0, 0, 0], b: [0, 0, 0, 0], a2: [0, 0, 0], b2: [0, 0, 0] }; pairs.set(k, q); } return q; };
    last.fill(-1);
    ids.forEach((id, pi) => {
      const P = pieces[pi].P, I = pieces[pi].I;
      for (let v = 0; v < id.length; v++) { const u = id[v]; if (cnt[u] < 2 || last[u] === pi) continue; last[u] = pi; for (let q = start[u]; q < start[u + 1]; q++) { const pj = who[q]; if (pj > pi) pairOf(pi, pj).pts.push(v); } }
      for (let t = 0; t < I.length; t += 3) {
        const ua = id[I[t]], ub = id[I[t + 1]], uc = id[I[t + 2]];
        if ((cnt[ua] > 1 ? 1 : 0) + (cnt[ub] > 1 ? 1 : 0) + (cnt[uc] > 1 ? 1 : 0) < 2) continue;
        const has = (u, pj) => { for (let r = start[u]; r < start[u + 1]; r++) if (who[r] === pj) return true; return false; };
        const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
        const x = (P[b + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[b + 2] - P[a + 2]) * (P[c + 1] - P[a + 1]), y = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]), z = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
        const seen = (pj, inA) => {
          if (pj === pi) return;
          const k = (inA ? 1 : 0) + (has(ub, pj) ? 1 : 0) + (has(uc, pj) ? 1 : 0); if (k < 2) return;
          const pr = pairOf(pi, pj), s2 = pi < pj ? pr.a2 : pr.b2; s2[0] += x / 2; s2[1] += y / 2; s2[2] += z / 2; // a face with two corners on the joint: of the joint or beside it
          if (k < 3) return;
          const sd = pi < pj ? pr.a : pr.b; sd[0] += Math.hypot(x, y, z) / 2; sd[1] += x / 2; sd[2] += y / 2; sd[3] += z / 2;
          if (pi < pj) pr.tris.push(t / 3, x / 2, y / 2, z / 2);
        };
        for (let q = start[ua]; q < start[ua + 1]; q++) seen(who[q], true);
        for (let q = start[ub]; q < start[ub + 1]; q++) if (!has(ua, who[q])) seen(who[q], false);
      }
    });
    const mates = [];
    for (const q of pairs.values()) {
      if (q.pts.length < 3) continue;
      const P = pieces[q.i].P, m = q.pts.length, c = [0, 0, 0];
      for (const v of q.pts) for (let k = 0; k < 3; k++) c[k] += P[3 * v + k] / m;
      const cov = [0, 0, 0, 0, 0, 0];
      for (const v of q.pts) { const x = P[3 * v] - c[0], y = P[3 * v + 1] - c[1], z = P[3 * v + 2] - c[2]; cov[0] += x * x; cov[1] += x * y; cov[2] += x * z; cov[3] += y * y; cov[4] += y * z; cov[5] += z * z; }
      const eig = symEig3(cov.map(x => x / m));
      const tri = q.a[0] + q.b[0];
      if (!(tri > 0) && !(m >= 8 && eig[1].l > 0.0025 * eig[0].l)) continue; // a line of points where two cuts cross is no joint
      // the way from i to j: the joint's faces on i look at j, those on j look back
      let g = [q.a[1] - q.b[1], q.a[2] - q.b[2], q.a[3] - q.b[3]], L = Math.hypot(g[0], g[1], g[2]);
      if (!(tri > 0) || !(L > 0.2 * tri)) { // no faces to go by (keys change each side's faces), or a joint that wraps right round: the points' own plane
        const nrm = eig[2].v, ci = pieces[q.i].c, cj = pieces[q.j].c, s = (cj[0] - ci[0]) * nrm[0] + (cj[1] - ci[1]) * nrm[1] + (cj[2] - ci[2]) * nrm[2];
        const g2 = [q.a2[0] - q.b2[0], q.a2[1] - q.b2[1], q.a2[2] - q.b2[2]], s2 = g2[0] * nrm[0] + g2[1] * nrm[1] + g2[2] * nrm[2]; // the faces at the joint on each side look across it
        g = nrm.map(x => x * ((s2 || s) < 0 ? -1 : 1)); L = 1;
      }
      // how deep the joint is: each connected patch of it (a plug in its socket, a face that follows a seam), measured
      // along the way that patch faces
      let deep = 0;
      if (q.tris.length) {
        const I = pieces[q.i].I, par = new Map(), find = (v) => { let r = v; while (par.get(r) !== r) r = par.get(r); while (par.get(v) !== r) { const nx = par.get(v); par.set(v, r); v = nx; } return r; };
        for (let k = 0; k < q.tris.length; k += 4) { const t = 3 * q.tris[k]; for (let e = 0; e < 3; e++) if (!par.has(I[t + e])) par.set(I[t + e], I[t + e]); const ra = find(I[t]); for (let e = 1; e < 3; e++) { const rb = find(I[t + e]); if (rb !== ra) par.set(rb, ra); } }
        const patch = new Map();
        for (let k = 0; k < q.tris.length; k += 4) { const r = find(I[3 * q.tris[k]]); let pt = patch.get(r); if (!pt) { pt = { n: [0, 0, 0], a: 0 }; patch.set(r, pt); } pt.n[0] += q.tris[k + 1]; pt.n[1] += q.tris[k + 2]; pt.n[2] += q.tris[k + 3]; pt.a += Math.hypot(q.tris[k + 1], q.tris[k + 2], q.tris[k + 3]); }
        for (const pt of patch.values()) { const l = Math.hypot(pt.n[0], pt.n[1], pt.n[2]); pt.n = l > 0.2 * pt.a ? pt.n.map(x => x / l) : g.map(x => x / L); pt.lo = Infinity; pt.hi = -Infinity; }
        for (const v of par.keys()) { const pt = patch.get(find(v)); if (!pt) continue; const h = P[3 * v] * pt.n[0] + P[3 * v + 1] * pt.n[1] + P[3 * v + 2] * pt.n[2]; if (h < pt.lo) pt.lo = h; if (h > pt.hi) pt.hi = h; }
        for (const pt of patch.values()) if (pt.a >= 0.05 * q.a[0]) deep = Math.max(deep, pt.hi - pt.lo);
      }
      // (1.96) and how far either piece reaches past the joint within its outline: a peg, a dowel's boss or a plug
      // stands out of one piece into the other, and shares no corner with it (the fit gap), so the shared faces alone
      // read a keyed joint as flat; capped at the joint's own width, so a limb beside it isn't counted
      {
        const nn = g.map(x => x / L), h0 = c[0] * nn[0] + c[1] * nn[1] + c[2] * nn[2];
        const ax = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], b0 = cross3(nn, ax), bl = Math.hypot(b0[0], b0[1], b0[2]), bu = b0.map(x => x / bl), bv = cross3(nn, bu);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const v of q.pts) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], a = x * bu[0] + y * bu[1] + z * bu[2], b = x * bv[0] + y * bv[1] + z * bv[2]; if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < v0) v0 = b; if (b > v1) v1 = b; }
        const span = Math.max(u1 - u0, v1 - v0), mg = 0.02 * span;
        let reach = 0;
        for (const [pi, sgn] of [[q.i, 1], [q.j, -1]]) {
          const Q = pieces[pi].P;
          for (let v = 0; v < Q.length; v += 3) {
            const x = Q[v], y = Q[v + 1], z = Q[v + 2], a = x * bu[0] + y * bu[1] + z * bu[2];
            if (a < u0 - mg || a > u1 + mg) continue;
            const b = x * bv[0] + y * bv[1] + z * bv[2]; if (b < v0 - mg || b > v1 + mg) continue;
            const e = sgn * (x * nn[0] + y * nn[1] + z * nn[2] - h0); if (e > reach) reach = e;
          }
        }
        deep = Math.max(deep, Math.min(reach, span));
      }
      mates.push({ i: q.i, j: q.j, pts: q.pts, centre: c, depth: deep, n: g.map(x => x / L), area: tri > 0 ? tri / 2 : Math.PI * Math.sqrt(Math.max(0, eig[0].l * eig[1].l)) * 2 });
    }
    return mates;
  }
  function explodePlan(parts, opts = {}) {
    const n = parts.length, pieces = parts.map((p) => {
      const P = p.positions instanceof Float32Array ? p.positions : Float32Array.from(p.positions), I = p.indices, b = bounds(P), c = [0, 0, 0], m = P.length / 3;
      for (let v = 0; v < m; v++) { c[0] += P[3 * v] / m; c[1] += P[3 * v + 1] / m; c[2] += P[3 * v + 2] / m; }
      const pl = p.pull ? Math.hypot(p.pull[0], p.pull[1], p.pull[2]) : 0, pull = pl > 1e-9 ? [p.pull[0] / pl, p.pull[1] / pl, p.pull[2] / pl] : null;
      return { P, I, b, c: m ? c : b.center.slice(), pull, vol: typeof p.volume === 'number' ? p.volume : volume(P, I), mates: [], parent: -1, root: -1, kids: [], legs: [], start: 0, total: 0, clear: 0, joint: 0 };
    });
    const out = { parts: [], order: [], travel: 0 };
    if (!n) return out;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pieces) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.b.min[k]); hi[k] = Math.max(hi[k], p.b.max[k]); }
    const mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), D = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, S = (opts.travel || 0.25) * D;
    out.travel = S;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit = (a) => { const L = Math.hypot(a[0], a[1], a[2]); return L > 1e-12 ? [a[0] / L, a[1] / L, a[2] / L] : null; };
    const mateOf = (i, j) => pieces[i].mates.find(e => e.to === j);
    const isAbove = (a, i) => { for (let q = pieces[i].parent, g = 0; q >= 0 && g <= n; q = pieces[q].parent, g++) if (q === a) return true; return false; }; // a is an ancestor of i
    // the way a piece's joints let it go: off its parent across their joint; for a piece hung on the root with no joint
    // to it, away from all its mates together
    const jointWay = (i) => { const p = pieces[i], e = mateOf(i, p.parent); if (e) return e.n.map(x => -x); const all = [0, 0, 0]; for (const m of p.mates) if (!isAbove(i, m.to)) for (let k = 0; k < 3; k++) all[k] -= m.n[k] * m.m.area; return unit(all); };
    // the way a piece leaves: the cut's own pull where it agrees with the joint, else the joint's
    const slideOf = (i) => { const p = pieces[i], geo = jointWay(i); return p.pull && (!geo || dot(p.pull, geo) > 0.5) ? p.pull : geo || unit([p.c[0] - mid[0], p.c[1] - mid[1], p.c[2] - mid[2]]) || [0, 0, 1]; };
    const mates = n > 1 ? explodeMates(pieces) : [];
    for (const m of mates) { pieces[m.i].mates.push({ to: m.j, m, n: m.n }); pieces[m.j].mates.push({ to: m.i, m, n: m.n.map(x => -x) }); }
    // groups of mated pieces; in each the biggest stands still
    const depth = new Int32Array(n).fill(-1);
    for (let s = 0; s < n; s++) {
      if (pieces[s].root >= 0) continue;
      const group = [s]; pieces[s].root = s;
      for (let q = 0; q < group.length; q++) for (const e of pieces[group[q]].mates) if (pieces[e.to].root < 0) { pieces[e.to].root = s; group.push(e.to); }
      let root = s; for (const i of group) if (pieces[i].vol > pieces[root].vol) root = i;
      for (const i of group) pieces[i].root = root;
      depth[root] = 0; const queue = [root];
      for (let q = 0; q < queue.length; q++) for (const e of pieces[queue[q]].mates) if (depth[e.to] < 0) { depth[e.to] = depth[queue[q]] + 1; queue.push(e.to); }
      // Each piece hangs on the mate nearest the root it shares the biggest joint with, if that mate can carry it:
      // a mate whose own slide would push the piece into another of its mates can't (the arches of a knot cut by one
      // plane: an arch that lifts can't take along the arc below it, which lies under the next arch). A piece no
      // mate can carry hangs on the root itself and leaves all its joints at once.
      const hung = new Set([root]);
      for (const i of queue) {
        if (i === root) continue;
        const cands = pieces[i].mates.filter(e => hung.has(e.to)).sort((a, b) => depth[a.to] - depth[b.to] || b.m.area - a.m.area);
        const carries = (y) => { for (let a = y; pieces[a].parent >= 0; a = pieces[a].parent) { const sl = slideOf(a); for (const e of pieces[i].mates) if (e.to !== a && !isAbove(a, e.to) && dot(sl, e.n) > 0.3) return false; } return true; };
        const by = cands.find(e => carries(e.to));
        pieces[i].parent = by ? by.to : root; hung.add(i);
      }
    }
    // ---- what is in the way ----
    const back = D * 2e-5, skim = D * 2e-3, thick = D * 0.03, budget = opts.samples || 1400;
    const gridOf = (p) => p.grid || (p.grid = meshGrid(p.P, p.I, Math.max(12, Math.min(64, Math.round(Math.cbrt(p.I.length / 3) * 1.3)))));
    const samplesOf = (p) => p.samples || (p.samples = surfaceSamples(p.P, p.I, budget));
    // How far the bodies ([{ i, off }], pieces at offsets) can go along d before more than a few of their points
    // have met one of the obstacle pieces (which stand where they are), up to maxT
    function freeDist(bodies, obstacles, d, maxT, stride = 1, joint = 0) {
      const hits = []; let lead = 0; const o = [0, 0, 0];
      const total = bodies.reduce((s, b) => s + samplesOf(pieces[b.i]).length / 6, 0);
      for (const b of bodies) {
        const sm = samplesOf(pieces[b.i]), m = sm.length / 6, st = Math.max(1, Math.round(stride * total / budget)); // what is carried shares the points, it doesn't add to them
        for (let s = 0; s < m; s += st) {
          const c = sm[6 * s + 3] * d[0] + sm[6 * s + 4] * d[1] + sm[6 * s + 5] * d[2];
          if (c < 0.05) continue; // only faces that lead the way can meet anything first
          lead++;
          o[0] = sm[6 * s] + b.off[0] - d[0] * back; o[1] = sm[6 * s + 1] + b.off[1] - d[1] * back; o[2] = sm[6 * s + 2] + b.off[2] - d[2] * back;
          const from = c < 0.3 ? back + skim : 0; // a face sliding along its own joint grazes the mate's wall: not a clash
          let best = -1;
          for (const j of obstacles) {
            const q = pieces[j], lim = best < 0 ? maxT + back : best; let t = -1, f = from;
            for (let g = 0; g < 4; g++) {
              t = castFirst(gridOf(q), q.P, q.I, o, d, lim, f);
              if (t < 0 || !(joint > 0) || t - back >= joint) break;
              // (a locked piece) on its way out of its joint it goes through a thin wall; a thick one stops it
              const th = castInward(gridOf(q), q.P, q.I, [o[0] + d[0] * (t + back), o[1] + d[1] * (t + back), o[2] + d[2] * (t + back)], d, thick);
              if (th < 0) break;
              f = t + th + 2 * back; t = -1;
            }
            if (t >= 0 && (best < 0 || t < best)) best = t;
          }
          if (best >= 0) hits.push(Math.max(0, best - back));
        }
      }
      const allow = Math.floor(lead * 0.006); // a stray point or two is noise
      if (hits.length <= allow) return maxT;
      hits.sort((a, b) => a - b);
      return Math.min(maxT, hits[allow]);
    }
    const subtree = (i) => { const list = [i]; for (let q = 0; q < list.length; q++) for (const k of pieces[list[q]].kids) list.push(k); return list; };
    const quick = !!opts.quick;
    // ---- a piece in the way of its mate's slide is carried by that mate ----
    if (!quick) {
      const sweeps = (y, x) => freeDist([{ i: y, off: [0, 0, 0] }], [x], slideOf(y), S, 2) < 0.5 * S;
      const carry = [];
      for (let y = 0; y < n; y++) {
        const py = pieces[y]; if (py.parent < 0) continue;
        for (const e of py.mates) {
          const x = e.to; if (x === py.parent || pieces[x].parent < 0 || pieces[x].parent === y) continue;
          if (sweeps(y, x) && !sweeps(x, y)) carry.push({ x, y, area: e.m.area });
        }
      }
      carry.sort((a, b) => b.area - a.area);
      const moved = new Set();
      for (const c of carry) { if (moved.has(c.x) || c.y === c.x || isAbove(c.x, c.y)) continue; pieces[c.x].parent = c.y; moved.add(c.x); }
    }
    for (let i = 0; i < n; i++) if (pieces[i].parent >= 0) pieces[pieces[i].parent].kids.push(i);
    // where a piece's own path has taken it after travelling s along it
    const along = (p, s) => { const at = [0, 0, 0]; for (const l of p.legs) { if (s <= 0) break; const t = Math.min(l.len, s); at[0] += l.d[0] * t; at[1] += l.d[1] * t; at[2] += l.d[2] * t; s -= l.len; } return at; };
    const ownAt = (p, k) => p.total > 0 ? along(p, p.total * Math.min(1, Math.max(0, (k - p.start) / (1 - p.start)))) : [0, 0, 0];
    const FIXED = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 0, -1], [-1, 0, -1], [0, 1, -1], [0, -1, -1]].map(unit);
    const add = (list, d, min = 0.98) => { if (d && !list.some(q => dot(q, d) > min)) list.push(d); };
    // the ways a piece may turn once it is out of its joint: from its parent's middle, the root's, the model's, blends
    // of those with its first leg, the joint's own direction, and a few fixed ones that lead outward
    function waysOut(i, d1) {
      const p = pieces[i], c = p.c, geo = jointWay(i), list = [];
      const rads = [pieces[p.parent].c, pieces[p.root].c, mid].map(q => unit([c[0] - q[0], c[1] - q[1], c[2] - q[2]])).filter(Boolean);
      for (const r of rads) { const h = dot(r, d1); add(list, unit([r[0] - h * d1[0], r[1] - h * d1[1], r[2] - h * d1[2]]), 0.97); } // square to the first leg
      for (const r of rads) add(list, r, 0.97);
      for (const r of rads) add(list, unit([r[0] + d1[0], r[1] + d1[1], r[2] + d1[2]]), 0.97);
      add(list, geo, 0.97);
      if (p.pull) add(list, p.pull, 0.97);
      const outward = rads[rads.length - 1] || rads[0] || d1;
      for (const f of FIXED.slice().sort((a, b) => dot(b, outward) - dot(a, outward))) if (dot(f, outward) > 0.25) add(list, f, 0.9);
      return list;
    }
    function planPiece(i) {
      const p = pieces[i];
      for (const k of p.kids) planPiece(k);
      if (p.parent < 0) {
        if (p.mates.length) return; // a root: it stands still
        // a piece on its own (a loose shell, a dowel pin): along its pull, or out from the middle
        const v = [p.b.center[0] - mid[0], p.b.center[1] - mid[1], p.b.center[2] - mid[2]];
        if (p.pull) p.legs = [{ d: p.pull, len: 0.25 * D + 0.9 * Math.max(0, dot(p.pull, v)) }];
        else { const u = unit(v); if (u) p.legs = [{ d: u, len: 0.9 * Math.hypot(v[0], v[1], v[2]) }]; }
        p.total = p.legs.reduce((s, l) => s + l.len, 0);
        return;
      }
      const geo = jointWay(i);
      if (quick) { p.legs = [{ d: slideOf(i), len: S }]; p.total = S; return; }
      const mine = subtree(i), inMine = new Set(mine), obstacles = []; for (let j = 0; j < n; j++) if (!inMine.has(j)) obstacles.push(j);
      // the first leg: the pull, the joint's own direction, or all its joints' together
      const firsts = [];
      if (p.pull && (!geo || dot(p.pull, geo) > 0.2)) add(firsts, p.pull);
      add(firsts, geo);
      { const all = [0, 0, 0]; for (const m of p.mates) if (!inMine.has(m.to)) for (let k = 0; k < 3; k++) all[k] -= m.n[k] * m.m.area; add(firsts, unit(all)); }
      if (!firsts.length) add(firsts, slideOf(i));
      // how far it must go along d to be out of its joints
      const clearAlong = (d) => { let c = 0; for (const m of p.mates) if (!inMine.has(m.to)) c = Math.max(c, m.m.depth / Math.max(0.3, -dot(d, m.n))); return Math.min(0.2 * S, c); };
      // A path with the pieces it carries where they are once it starts (at `start`); `joint`: a locked piece, which
      // may go through thin walls for that far
      const attempt = (start, joint) => {
        const place = (shift) => mine.map((j) => { const off = shift.slice(); for (let q = j; q !== i; q = pieces[q].parent) { const o = ownAt(pieces[q], start); off[0] += o[0]; off[1] += o[1]; off[2] += o[2]; } return { i: j, off }; });
        const free = (shift, d, maxT) => { const bodies = place(shift), f = freeDist(bodies, obstacles, d, maxT, 4, joint); return f < maxT * 0.999 ? f : freeDist(bodies, obstacles, d, maxT, 1, joint); };
        let d1 = firsts[0], F1 = -1;
        for (const d of firsts) { const f = free([0, 0, 0], d, S); if (f > F1 * 1.1 + 1e-9) { F1 = f; d1 = d; } if (f >= S * 0.999) break; }
        const clear = clearAlong(d1);
        if (F1 >= S * 0.999) return { start, clear, total: S, legs: [{ d: d1, len: S }] };
        // then the freest way out: from the parent's middle, the root's, the model's, blends with the first leg, the joint
        const seconds = waysOut(i, d1);
        // it turns once it is out of its joint and a little more (a tenth of the travel), so the joint opens the way it goes together
        const want = Math.min(0.97 * F1, clear + 0.1 * S);
        const Ls = [...new Set([Math.min(clear + 0.01 * S, 0.97 * F1), 0.25 * F1, 0.5 * F1, 0.75 * F1, 0.97 * F1, want].map(x => +x.toPrecision(6)))].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
        // of the ways that are free all the way, the one most outward, square to the way it came out (an L, as a hand
        // would take it off: out of the joint, then away), and a little the way it was going
        const rad = [p.c[0] - pieces[p.root].c[0], p.c[1] - pieces[p.root].c[1], p.c[2] - pieces[p.root].c[2]], rd = dot(rad, d1);
        const outward = unit([rad[0] - rd * d1[0], rad[1] - rd * d1[1], rad[2] - rd * d1[2]]) || unit(rad) || d1;
        let best = { total: F1 * 0.97, legs: [{ d: d1, len: F1 * 0.97 }] };
        for (const L of Ls) {
          const shift = [d1[0] * L, d1[1] * L, d1[2] * L]; let pick = null;
          for (const d2 of seconds) {
            if (dot(d2, d1) > 0.98) continue;
            const f = free(shift, d2, S - L), whole = f >= (S - L) * 0.999, total = L + (whole ? f : f * 0.97);
            if (whole) { const score = 0.25 * dot(d2, d1) + dot(d2, outward); if (!pick || score > pick.score + 1e-9) pick = { score, d2 }; }
            else if (!pick && total > best.total * 1.02 + 1e-9) best = { total, legs: L > 1e-9 ? [{ d: d1, len: L }, { d: d2, len: total - L }] : [{ d: d2, len: total }] };
          }
          if (pick) { best = { total: S, legs: L > 1e-9 ? [{ d: d1, len: L }, { d: pick.d2, len: S - L }] : [{ d: pick.d2, len: S }] }; break; }
        }
        return { start, clear, total: best.total, legs: best.legs };
      };
      // it starts at once if it can with what it carries still in place; else once that is out of its joints
      let wait = 0;
      for (const k of p.kids) { const c = pieces[k]; if (c.total > 0) wait = Math.max(wait, c.start + (1 - c.start) * Math.min(1, c.clear / c.total)); }
      wait = Math.min(0.35, wait);
      const waits = wait > 0 ? [0, wait / 4, wait / 2, wait] : [0];
      const tryAll = (joint) => { let best = null; for (const w of waits) { const a = attempt(w, joint); if (!best || a.total > best.total * 1.05) best = a; if (best.total >= S * 0.999) break; } return best; };
      let plan = tryAll(0);
      if (plan.total < S * 0.6) { // locked (a cut that was forced): out through the thin walls that hold it
        const joint = Math.min(0.3 * S, clearAlong(firsts[0]) + 0.02 * D);
        const l = tryAll(joint);
        if (l.total > plan.total * 1.2) { plan = l; p.joint = joint; }
      }
      p.start = plan.start; p.clear = plan.clear; p.legs = plan.legs.filter(l => l.len > 1e-9); p.total = p.legs.reduce((s, l) => s + l.len, 0);
    }
    // A piece carried by a piece that moves itself goes where both paths take it, so its own path, found against
    // everything standing still, is checked again against what it really passes: each stretch between the moments a
    // path turns is a straight line relative to each piece further up the tree. Where that meets something, the piece
    // turns another way after leaving its joint, or stops short.
    const breaks = (q, list) => { list.push(q.start); let cum = 0; for (const l of q.legs) { cum += l.len; if (q.total > 0) list.push(q.start + (1 - q.start) * Math.min(1, cum / q.total)); } };
    const cutLegs = (legs, s) => { const outLegs = []; for (const l of legs) { if (s <= 1e-9) break; outLegs.push({ d: l.d, len: Math.min(l.len, s) }); s -= l.len; } return outLegs; };
    function replan(i) {
      const p = pieces[i], chain = []; for (let q = p.parent; q >= 0; q = pieces[q].parent) chain.push(q);
      if (chain.length < 2 || !p.legs.length) return;
      const mine = subtree(i), inMine = new Set(mine);
      const below = chain.map((a, m) => new Set(subtree(m ? chain[m - 1] : i))); // what moves with the piece as seen from chain[m]
      // the moment (k) the piece, on these legs, first meets something further up the tree than its parent; 1 if never
      const blockedAt = (legs) => {
        const keep = p.legs; p.legs = legs;
        const ks = [0, 1]; breaks(p, ks); for (const a of chain) breaks(pieces[a], ks);
        const times = [...new Set(ks.filter(k => k >= 0 && k <= 1).map(k => +k.toFixed(9)))].sort((a, b) => a - b);
        let first = 1;
        for (let m = 1; m < chain.length; m++) {
          const obstacles = []; for (let j = 0; j < n; j++) if (!below[m].has(j) && (m === chain.length - 1 || isAbove(chain[m], j) || j === chain[m])) obstacles.push(j);
          const rel = (k) => { const at = ownAt(p, k); for (let q = 0; q < m; q++) { const o = ownAt(pieces[chain[q]], k); at[0] += o[0]; at[1] += o[1]; at[2] += o[2]; } return at; };
          for (let t = 0; t + 1 < times.length && times[t] < first; t++) {
            const ka = times[t], kb = times[t + 1], a = rel(ka), b = rel(kb), dl = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(dl[0], dl[1], dl[2]);
            if (len < 1e-9) continue;
            const bodies = mine.map((j) => { const off = a.slice(); for (let q = j; q !== i; q = pieces[q].parent) { const o = ownAt(pieces[q], ka); off[0] += o[0]; off[1] += o[1]; off[2] += o[2]; } return { i: j, off }; });
            const sOwn = p.total * Math.min(1, Math.max(0, (ka - p.start) / (1 - p.start)));
            const f = freeDist(bodies, obstacles, [dl[0] / len, dl[1] / len, dl[2] / len], len, 2, p.joint > sOwn ? p.joint - sOwn : 0);
            if (f < len * 0.999) { first = Math.min(first, ka + (kb - ka) * f / len); break; }
          }
        }
        p.legs = keep;
        return first;
      };
      let best = { legs: p.legs, k: blockedAt(p.legs) };
      if (best.k >= 1) return;
      const tp = pieces[p.parent].start, sPre = p.total * Math.min(1, Math.max(0, (tp - p.start) / (1 - p.start))), len1 = p.legs[0].len;
      const cuts = [...new Set([sPre, sPre + 0.5 * Math.max(0, len1 - sPre), Math.max(sPre, len1)].map(x => +Math.min(x, p.total).toPrecision(6)))].filter(x => x < p.total * 0.98);
      const ways = waysOut(i, p.legs[0].d); add(ways, p.legs[0].d, 0.97); for (const a of chain) for (const l of pieces[a].legs) add(ways, l.d, 0.97);
      search: for (const s of cuts) for (const d of ways) {
        const legs = cutLegs(p.legs, s); legs.push({ d, len: p.total - s });
        const k = blockedAt(legs);
        if (k > best.k + 1e-6) best = { legs, k };
        if (k >= 1) break search;
      }
      // still meeting something: stop short of it
      p.legs = best.k >= 1 ? best.legs : cutLegs(best.legs, 0.97 * p.total * Math.min(1, Math.max(0, (best.k - p.start) / (1 - p.start))));
    }
    for (let i = 0; i < n; i++) if (pieces[i].parent < 0) planPiece(i);
    for (let i = 0; i < n; i++) if (pieces[i].parent < 0) for (const j of subtree(i)) out.order.push(j);
    if (!quick) for (const i of out.order) replan(i);
    // (1.96) a dowel pin (no joint shared with anything, no pull) sits in a hole in each of two pieces: it goes with the
    // moving piece whose bounds it overlaps most, at half its pace and from its parent, so it slides out of both holes
    // along the joint instead of out through the pieces' walls
    const overlap = (a, b) => { let v = 1; for (let k = 0; k < 3; k++) { const d = Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]); if (!(d > 0)) return 0; v *= d; } return v; };
    for (let i = 0; i < n; i++) {
      const p = pieces[i]; if (p.parent >= 0 || p.mates.length || p.pull || p.kids.length) continue;
      let q = -1, best = 0;
      for (let j = 0; j < n; j++) { if (j === i || pieces[j].parent < 0 || !pieces[j].total) continue; const o = overlap(p.b, pieces[j].b); if (o > best) { best = o; q = j; } }
      if (q < 0) continue;
      const pq = pieces[q];
      p.parent = pq.parent; pq.parent >= 0 && pieces[pq.parent].kids.push(i);
      p.legs = pq.legs.map(l => ({ d: l.d.slice(), len: 0.5 * l.len })); p.start = pq.start; p.total = 0.5 * pq.total;
      out.order.splice(out.order.indexOf(i), 1); out.order.push(i); // (after its new parent)
    }
    out.parts = pieces.map(p => ({ parent: p.parent, root: p.root, start: p.start, total: p.total, legs: p.legs.map(l => ({ d: l.d.slice(), len: l.len })), mates: p.mates.map(e => e.to) }));
    return out;
  }
  // Each part's offset at explode amount k (0 to 1): its parent's, plus its own way along its path
  function explodeAt(plan, k) {
    const at = plan.parts.map(() => [0, 0, 0]);
    k = Math.min(1, Math.max(0, +k || 0));
    for (const i of plan.order) {
      const p = plan.parts[i], a = at[i];
      if (p.parent >= 0) { a[0] = at[p.parent][0]; a[1] = at[p.parent][1]; a[2] = at[p.parent][2]; }
      let s = p.total * Math.min(1, Math.max(0, (k - p.start) / (1 - p.start)));
      for (const l of p.legs) { if (s <= 0) break; const t = Math.min(l.len, s); a[0] += l.d[0] * t; a[1] += l.d[1] * t; a[2] += l.d[2] * t; s -= l.len; }
    }
    return at;
  }
  return {
    parseSTL, parseOBJ, prepareMesh, fillHoles, edgeReport, volume, bounds, diag,
    frameFromNormal, shiftFrame, section, analyzePlane, evaluateKeys, autoPlaceKeys, regionAt, regionSamples, pickLabelPoint, keyGeometrySpec, KEY_DEFAULTS,
    KEY_SHAPES, MAGNET_SHAPES, keyProfile, profileFit, profileArea, keyAngle, keyCfg, KEY_OVERRIDES, autoFitKeys, sizeLadder, PRINTERS, MAGNET_SIZES,
    sweepDirections, neckSweep, refineNecks, freedBy, cutHere, creaseEdges, creasePlanes, separateShells,
    segmentSurface, segmentForm, shapeDiameter, meshGrid, castInward, subdivideMesh, regionCuts, regionBorderLines, bordersFromGroups, borderLoops, regionOutlines, cutLines, borderLoopNear, cutAlongLoop, analyzeLoop, orientLoops, sunkRing, keyLevels, capHeight, planPlugs, plugShape, offsetRing, splitRegion, splitRegions, groupLoops, regionLoops, regionAtPoint, cutAlongLoops, surfacePath, drawnLoop, nearestVertex, planBedCuts, bedFit, inlayCut, loopSelection, loopFrame, readZip, parse3MF, make3MF, assemblySheet, packProject, unpackProject, reduceMesh, jointMarks, markKeys, loopHandles, smoothHandles, nearestBorderPoint, brushTriangles, sphereTriangles, sculptDab, vertexTriangles, refreshCreased, snapSelectionToRegions, growSelection, shrinkSelection, tidySelection, selectionSeg, nearestTriangle,
    thinAreas, jointThickness, slidesApart, lockedPairs, rayGrid, solidRuns, shownRegions, thinMessage, fanCentre, straightLoop,
    repairMesh, cutMesh, mergeMeshes, transformPositions, creasedArrays, writeSTL, makeZip, torusKnot, earcut,
    clipMesh, boxMesh, polytopeMesh, hullMesh, latheMesh, shapeMesh, facePlanes, booleanWith, booleanShape, ringSectors,
    segmentParts, convexOutline, faceDirections, propObjects, ownObjectPieces, regionBorderCurves, planPick, planJoints, plainData, strokeLoop, pickComponents, splitCandidates, flatSplitCandidates, flatSplit, trianglePairs, fillSelectionGaps, shellComponents, extractTriangles, touchingSets, regionPath, nearestVertices, smoothLoopVertices, smoothRegionPick, sliceRegionPick, sliceDrawnLoops, sliceByField, cutPrintCheck, unpinchGroups, limbEndPick, tubeLike, knifeEdges, pickMesh, segmentSections, explodePlan, explodeAt, explodeMates, castFirst, surfaceSamples, inheritTriangles, carryRegions, trimTongues, flatIslands, antiTwist, flatEnd,
  };
})();
if (typeof module !== 'undefined') module.exports = KMCore;
