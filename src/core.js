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

  function weld(P, I, tol) {
    const n = P.length / 3;
    const inv = 1 / tol;
    const size = nextPow2(n * 2);
    const mask = size - 1;
    const table = new Int32Array(size).fill(-1);
    const remap = new Uint32Array(n);
    const qx = new Float64Array(n), qy = new Float64Array(n), qz = new Float64Array(n);
    const out = new Float32Array(P.length);
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
    const taper = cfg.type === 'peg' && cfg.taper ? 0.8 : 1;
    const shape = shapeFor(cfg);
    const res = profileRes(r + c);
    const sock = keyProfile(shape, r, c, 0, res);
    let sockets; // [{side:-1|+1, depth}]
    if (cfg.type === 'peg') {
      const s = cfg.pegSide === 'above' ? -1 : +1; // socket goes into the side opposite the peg
      sockets = [{ side: s, depth: cfg.length + ca }];
    } else if (cfg.type === 'dowel') sockets = [{ side: -1, depth: cfg.length / 2 + ca }, { side: +1, depth: cfg.length / 2 + ca }];
    else sockets = [{ side: -1, depth: cfg.length + ca }, { side: +1, depth: cfg.length + ca }];
    const fit = profileFit(sock);
    return { r, c, ca, taper, sockets, shape, res, outer: shape === 'round' ? r + c : fit.outer, inner: shape === 'round' ? r + c : fit.inner };
  }

  /* ---------- key shapes ----------
     Every shape is defined by its half-width r and an outward offset d, so a socket is the peg grown by exactly
     the clearance on every side (scaling would leave thin gaps on shapes like the cross). Vertex count depends
     only on the shape and res, so the top and bottom rings of a tapered key always pair up. All shapes are
     star-shaped around the key centre, which the cap fans and wall orientation in cutMesh rely on. */
  const KEY_SHAPES = ['round', 'square', 'hexagon', 'cross', 'oval', 'slot', 'dshape'];
  const MAGNET_SHAPES = ['round', 'square'];
  function shapeFor(cfg) {
    const s = KEY_SHAPES.includes(cfg.shape) ? cfg.shape : 'round';
    return cfg.type === 'magnet' && !MAGNET_SHAPES.includes(s) ? 'round' : s;
  }
  function profileRes(rad) { return Math.max(20, Math.min(56, Math.round((2 * Math.PI * rad) / 0.5))); }
  function keyProfile(shape, r, d = 0, angle = 0, res = profileRes(r + d)) {
    const R = r + d, out = [];
    const arc = (cx, cy, rad, a0, a1, n, closed) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (closed ? i / n : i / (n - 1)); out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
    switch (shape) {
      case 'square': out.push([R, -R], [R, R], [-R, R], [-R, -R]); break;
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
    const prof = keyProfile(spec.shape, spec.r, spec.c, angle, spec.res);
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
  function footprintClear(sec, reg, x, y, fp, need) {
    const c = regionClearance(sec.loops, reg, x, y);
    if (fp.round || c - fp.outer >= need) return c - fp.outer;
    if (c < fp.inner) return c - fp.inner;
    let best = Infinity;
    for (const [px, py] of fp.pts) {
      if (!regionContains(sec.loops, reg, x + px, y + py)) return -1;
      best = Math.min(best, regionClearance(sec.loops, reg, x + px, y + py));
      if (best < need) return best;
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
    return { frame: F, base, depth };
  }
  function keyScore(an, cfg, x, y, skip, spec = keyGeometrySpec(cfg), fps) {
    const m = cfg.margin;
    const ri = regionAt(an.base, x, y);
    if (ri < 0) return { ok: false, reason: 'Not on the cut face', region: -1, score: -Infinity };
    if (skip && skip.has(ri)) return { ok: false, reason: 'In an area you chose not to cut', region: ri, score: -Infinity };
    if (an.base.regions[ri].inverted) return { ok: false, reason: 'Not on the cut face', region: -1, score: -Infinity };
    if (an.base.regions[ri].nested) return { ok: false, reason: 'On a part of the model that overlaps another', region: ri, score: -Infinity };
    let fp = fps && fps[ri];
    if (!fp) { fp = footprintOf(spec, keyAngle(an.base, ri, cfg)); if (fps) fps[ri] = fp; }
    let score = footprintClear(an.base, an.base.regions[ri], x, y, fp, m);
    if (score < m) return { ok: false, reason: 'Too close to the edge', region: ri, score };
    for (const d of an.depth) {
      if (d.sec.error) continue;
      const rj = regionAt(d.sec, x, y);
      if (rj < 0) return { ok: false, reason: d.need === 'floor' ? 'Socket would break through the surface' : 'Socket would break through the side', region: ri, score: -Infinity };
      const need = d.need === 'wall' ? m * 0.75 : 0;
      const cl = footprintClear(d.sec, d.sec.regions[rj], x, y, fp, need);
      if (d.need === 'wall' && cl < need) return { ok: false, reason: 'Wall around the socket is too thin', region: ri, score: cl };
      if (d.need === 'floor' && cl < 0) return { ok: false, reason: 'Socket would break through the surface', region: ri, score: -Infinity };
      if (d.need === 'wall') score = Math.min(score, cl);
    }
    return { ok: true, reason: '', region: ri, score };
  }
  function evaluateKeys(an, keys, cfg, skip) {
    const spec = keyGeometrySpec(cfg), fps = [];
    const res = keys.map(k => keyScore(an, cfg, k.x, k.y, skip, spec, fps));
    const R = keyGeometrySpec(cfg).outer;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (Math.hypot(keys[i].x - keys[j].x, keys[i].y - keys[j].y) < 2 * R + cfg.margin) {
        for (const k of [i, j]) if (res[k].ok) res[k] = { ...res[k], ok: false, reason: 'Overlaps another key' };
      }
    }
    return res;
  }
  function autoPlaceKeys(an, cfg, perRegion, skip) {
    const keys = [];
    if (cfg.type === 'none' || an.base.error) return keys;
    const spec = keyGeometrySpec(cfg), fps = [];
    const R = spec.outer, m = cfg.margin;
    an.base.regions.forEach((reg, ri) => {
      if (skip && skip.has(ri)) return;
      if (reg.nested || reg.inverted || reg.area < Math.PI * (R + m) * (R + m)) return;
      const [x0, y0, x1, y1] = reg.bbox;
      let h = Math.max(R * 0.3, Math.sqrt(reg.area / 1400));
      while (((x1 - x0) / h) * ((y1 - y0) / h) > 5000) h *= 1.25;
      const cands = [];
      for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) {
        if (!regionContains(an.base.loops, reg, x, y)) continue;
        const s = keyScore(an, cfg, x, y, skip, spec, fps);
        if (s.ok && s.region === ri) cands.push({ x, y, score: s.score });
      }
      if (!cands.length) return;
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
    return keys;
  }

  /* ---------- the cut ---------- */
  // Every exported part must be a closed solid. Real sculpts carry microscopic defects (self-crossing folds,
  // near-duplicate points) that can still defeat the cap at one exact plane position, so check the result and,
  // if any part is open, redo the cut a hundredth of a millimetre or so either side. The keys keep their place.
  function cutMesh(P, I, F, opts) {
    const scale = opts.scale || 1, step = scale * 5e-5;
    for (const k of [0, 1, -1, 2, -2, 4, -4]) {
      const Fk = k ? shiftFrame(F, k * step) : F;
      const res = cutOnce(P, I, Fk, opts);
      if (res.parts.every(q => edgeReport(q.indices).closed) && res.pins.every(q => edgeReport(q.indices).closed)) {
        res.retries = Math.abs(k) && [0, 1, -1, 2, -2, 4, -4].indexOf(k);
        return res;
      }
    }
    throw new Error('Keymaster couldn’t make sealed pieces at this exact spot because the model has a tiny flaw here. Move the cut slightly and try again.');
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
    const keys = (cfg.type === 'none' ? [] : (opts.keys || [])).map(k => ({ ...k, region: -1 }));
    const tmpSec = { loops, regions };
    for (const k of keys) { k.region = regionAt(tmpSec, k.x, k.y); k.angle = keyAngle(tmpSec, k.region, cfg); }
    const pins = [];

    regions.forEach((reg, ri) => {
      if (skip.has(ri)) return;
      const myKeys = keys.filter(k => k.region === ri);
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
          let role, grow, depth, dir, tipR = spec.r;
          if (cfg.type === 'peg') {
            const pegSide = cfg.pegSide === 'above' ? +1 : -1;
            if (side === pegSide) { role = 'peg'; grow = 0; depth = cfg.length; dir = -side; }
            else { role = 'socket'; grow = spec.c; depth = cfg.length + spec.ca; dir = side; }
            tipR = spec.r * spec.taper;
          } else {
            role = 'socket'; grow = spec.c; dir = side;
            depth = cfg.type === 'dowel' ? cfg.length / 2 + spec.ca : cfg.length + spec.ca;
          }
          const prof = keyProfile(spec.shape, spec.r, grow, k.angle, spec.res);
          const prof1 = keyProfile(spec.shape, tipR, grow, k.angle, spec.res);
          const ring = [], xy = [];
          for (const [px, py] of prof) { ring.push(addV(at(k.x + px, k.y + py, 0))); xy.push(k.x + px, k.y + py); }
          pushRing(ring, xy);
          tubes.push({ k, role, prof1, depth, dir, ring });
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
      if (cfg.type === 'dowel') for (const k of myKeys) pins.push(makePin(at, k, spec, cfg.length));
    });

    const comps = splitComponents(V.a.subarray(0, V.n), T.view(), nv, spans, Fs);
    return { parts: comps, pins, shift: sec.shift, keysUsed: keys.filter(k => k.region >= 0 && !skip.has(k.region)).length };
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

  function splitComponents(V, T, nvOrig, spans, F) {
    const nv = V.length / 3, nt = T.length / 3;
    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let t = 0; t < nt; t++) { unite(T[3 * t], T[3 * t + 1]); unite(T[3 * t], T[3 * t + 2]); }
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
    return keep.map(c => ({ positions: c.positions, indices: c.indices, volume: c.volume, side: c.spans ? 'both' : c.side }));
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

  return {
    parseSTL, parseOBJ, prepareMesh, fillHoles, edgeReport, volume, bounds, diag,
    frameFromNormal, shiftFrame, section, analyzePlane, evaluateKeys, autoPlaceKeys, regionAt, regionSamples, pickLabelPoint, keyGeometrySpec, KEY_DEFAULTS,
    KEY_SHAPES, MAGNET_SHAPES, keyProfile, profileFit, profileArea, keyAngle,
    cutMesh, mergeMeshes, transformPositions, creasedArrays, writeSTL, makeZip, torusKnot, earcut,
  };
})();
if (typeof module !== 'undefined') module.exports = KMCore;
