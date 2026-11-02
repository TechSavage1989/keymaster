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
  const KEY_SIZES = [12, 10, 8, 7, 6, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.6, 1.2, 1];
  const MAGNET_SIZES = [[10, 3], [8, 3], [6, 3], [5, 2], [4, 2], [3, 1.5], [3, 1], [2, 1]]; // diameter × thickness, mm
  function sizeLadder(cfg) {
    const max = cfg.sizeMax || cfg.diameter, min = cfg.sizeMin || PRINTERS[cfg.printer === 'resin' ? 'resin' : 'fdm'].min;
    if (cfg.type === 'magnet') return MAGNET_SIZES.filter(([d]) => d <= max + 1e-9 && d >= Math.min(min, 2) - 1e-9);
    const ds = [max, ...KEY_SIZES.filter(d => d < max - 1e-9 && d >= min - 1e-9)];
    const len = (d) => cfg.type === 'dowel' ? Math.max(2, Math.round(d * 2.5 * 2) / 2) : Math.max(1, Math.round(d * 1.2 * 2) / 2);
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
  // One direction's sweep: the narrow points found while following areas from slice to slice.
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
        L.push({ area: reg.area, c: planePoint(F, cx, cy), chain: -1 });
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
    const found = [];
    for (const ch of chains) {
      if (ch.length < 5) continue;
      for (let m = 2; m < ch.length - 2; m++) {
        const a = ch[m].area;
        if (a < minA || a > ch[m - 1].area || a > ch[m + 1].area) continue;
        let before = 0, after = 0;
        for (let q = Math.max(0, m - 10); q < m; q++) before = Math.max(before, ch[q].area);
        for (let q = m + 1; q < Math.min(ch.length, m + 11); q++) after = Math.max(after, ch[q].area);
        const pinch = a / Math.min(before, after);
        if (pinch < 0.6) found.push({ kind: 'neck', normal: dir.slice(), point: ch[m].c, area: a, pinch });
      }
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
  // Merge narrow points found from several directions and tilt each plane until it sits square across the neck.
  function refineNecks(P, I, found, scale, limit = 8) {
    found.sort((a, b) => a.area - b.area);
    const groups = [];
    for (const f of found) {
      const g = groups.find(g => Math.hypot(f.point[0] - g.point[0], f.point[1] - g.point[1], f.point[2] - g.point[2]) < 0.8 * Math.sqrt(Math.max(f.area, g.area)));
      if (g) { g.votes++; g.pinch = Math.min(g.pinch, f.pinch); } else groups.push({ ...f, votes: 1 });
    }
    const out = [];
    for (const g of groups) {
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
      out.push({ kind: 'neck', normal: nrm, point: p, area, width: 2 * Math.sqrt(area / Math.PI), score: (1 - g.pinch) * Math.min(1, 0.5 + 0.1 * g.votes) });
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
    const uniq = [];
    for (const o of out) if (!uniq.some(u => sameNeck(o, u))) uniq.push(o);
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
        out.push({ kind: 'crease', normal: d.slice(), point: pin, length: w, coverage, score: coverage });
      }
    }
    out.sort((a, c) => c.score - a.score);
    const uniq = [];
    for (const o of out) {
      const same = uniq.some(u => Math.abs(o.normal[0] * u.normal[0] + o.normal[1] * u.normal[1] + o.normal[2] * u.normal[2]) > 0.98 &&
        Math.abs((o.point[0] - u.point[0]) * u.normal[0] + (o.point[1] - u.point[1]) * u.normal[1] + (o.point[2] - u.point[2]) * u.normal[2]) < 2 * bin);
      if (!same) uniq.push(o);
    }
    return uniq.slice(0, limit);
  }
  // Solids that don't touch each other. Shells sitting inside another (eyes, inner parts) stay with it.
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
      return { positions, indices: idx, volume: volume(positions, idx), bbox: bounds(positions) };
    });
    shells.sort((a, b) => b.volume - a.volume);
    const inside = (a, b) => a.bbox.min.every((v, i) => v >= b.bbox.min[i] - 1e-6) && a.bbox.max.every((v, i) => v <= b.bbox.max[i] + 1e-6);
    const top = [];
    for (const s of shells) {
      const host = top.filter(h => inside(s, h)).sort((a, b) => a.volume - b.volume)[0];
      if (host) { const m = mergeMeshes([host, s]); host.positions = m.positions; host.indices = m.indices; host.volume += s.volume; }
      else top.push(s);
    }
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
  function segmentSurface(P, I, opts = {}) {
    const angle = opts.angle === undefined ? 35 : opts.angle, minFrac = opts.minFrac === undefined ? 0.003 : opts.minFrac, fold = opts.fold;
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
    const first = new Map(), pairs = [];
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
      const f = first.get(key);
      if (f === undefined) first.set(key, t);
      else { first.delete(key); pairs.push(f, t, a, b); }
    }
    const par = new Int32Array(nt);
    for (let t = 0; t < nt; t++) par[t] = t;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const cosA = Math.cos((angle * Math.PI) / 180), cosF = fold !== undefined ? Math.cos((fold * Math.PI) / 180) : cosA;
    for (let i = 0; i < pairs.length; i += 4) {
      const s = pairs[i], q = pairs[i + 1];
      const dot = N[3 * s] * N[3 * q] + N[3 * s + 1] * N[3 * q + 1] + N[3 * s + 2] * N[3 * q + 2];
      // a valley: the neighbour's centre lies on the outward side of this triangle's plane
      const valley = C && (C[3 * q] - C[3 * s]) * N[3 * s] + (C[3 * q + 1] - C[3 * s + 1]) * N[3 * s + 1] + (C[3 * q + 2] - C[3 * s + 2]) * N[3 * s + 2] > 0;
      if (dot >= (valley ? cosF : cosA)) { const x = find(s), y = find(q); if (x !== y) par[x] = y; }
    }
    // melt specks into the neighbour they share the most border with, smallest first, until none are left
    const minA = total * minFrac;
    for (let pass = 0; pass < 12; pass++) {
      const area = new Map();
      for (let t = 0; t < nt; t++) { const r = find(t); area.set(r, (area.get(r) || 0) + A[t]); }
      const border = new Map();
      for (let i = 0; i < pairs.length; i += 4) {
        const x = find(pairs[i]), y = find(pairs[i + 1]);
        if (x === y) continue;
        const a = 3 * pairs[i + 2], b = 3 * pairs[i + 3], len = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
        for (const [g, h] of [[x, y], [y, x]]) { if (!border.has(g)) border.set(g, new Map()); const m = border.get(g); m.set(h, (m.get(h) || 0) + len); }
      }
      const small = [...area.entries()].filter(([, a]) => a < minA).sort((a, b) => a[1] - b[1]);
      if (!small.length) break;
      let merged = 0;
      for (const [g] of small) {
        const r = find(g);
        if (r !== g) continue; // already merged this pass
        const m = border.get(g);
        if (!m) continue;
        let best = -1, bl = -1;
        for (const [h, len] of m) { const hr = find(h); if (hr !== g && len > bl) { bl = len; best = hr; } }
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
    const borders = [];
    for (let i = 0; i < pairs.length; i += 4) if (groupOf[pairs[i]] !== groupOf[pairs[i + 1]]) borders.push(pairs[i], pairs[i + 1], pairs[i + 2], pairs[i + 3]);
    return { groupOf, count: order.length, areas: order.map(([, a]) => a), borders: new Int32Array(borders) };
  }
  // The same result shape for any grouping of triangles (used by tests and by hand-made groupings).
  function bordersFromGroups(P, I, groupOf) {
    const nt = I.length / 3, nv = P.length / 3, first = new Map(), out = [];
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a, f = first.get(key);
      if (f === undefined) first.set(key, t); else { first.delete(key); if (groupOf[f] !== groupOf[t]) out.push(f, t, a, b); }
    }
    let count = 0; for (let t = 0; t < nt; t++) count = Math.max(count, groupOf[t] + 1);
    return { groupOf, count, borders: new Int32Array(out) };
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
    const an = { frame: F, base, depth: [], curved: { deviation: dev, heightAt: capHeightGrid(xy, h) } };
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
  function cutAlongLoop(P, I, loop, opts = {}) {
    const r = cutAlongLoops(P, I, [loop], opts);
    return { parts: r.parts, pins: r.pins, length: r.length, frame: r.frames[0] };
  }
  /* Cut along several closed lines at once. Side 1 is whatever lies on the left of the lines as they run (the
     triangles holding the lines' own directed edges); side 2 is the rest, and may come apart into several pieces.
     A single line splits a part in two; a region's whole outline, all its loops together, splits the region off
     even where the surface loops back on itself (an arm whose hand rests on the hip). Keys or a plug go on each
     line, from opts.keys and opts.plugs for one line or opts.perLoop[i] for several. */
  function cutAlongLoops(P, I, loopsIn, opts = {}) {
    const loops = loopsIn.map(l => straightLoop(P, I, l));
    if (loops.some(l => !l.closed)) throw new Error('This border doesn’t go all the way round, so it can’t split the part. Pick one that circles a limb or the edge of a sleeve.');
    const nv = P.length / 3, nt = I.length / 3, rings = loops.map(l => l.verts), L = rings.length;
    const offs = []; let nn = nv; for (const r of rings) { offs.push(nn); nn += r.length; }
    const extra = nn, M = extra + 2 * L; // centre points for fans after the copies
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
    // the triangle on each side of each line's first edge
    const want = new Map(); // directed edge -> [loop, which side]
    rings.forEach((ring, li) => { want.set(ring[0] * nv + ring[1], [li, 1]); want.set(ring[1] * nv + ring[0], [li, 2]); });
    const seeds = rings.map(() => [-1, -1]);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const w = want.get(I[3 * t + k] * nv + I[3 * t + (k + 1) % 3]); if (w) seeds[w[0]][w[1] - 1] = t; }
    if (seeds.some(s => s[0] < 0 || s[1] < 0)) throw new Error('This border runs along an edge of the surface that isn’t closed. Fill holes in the model panel first.');
    const side = new Int8Array(nt);
    const flood = (start, s) => { const st = [start]; side[start] = s; while (st.length) { const t = st.pop(); for (let k = 0; k < 3; k++) { const q = nb[3 * t + k]; if (q >= 0 && !side[q]) { side[q] = s; st.push(q); } } } };
    for (const [tA] of seeds) if (!side[tA]) flood(tA, 1);
    if (seeds.some(([, tB]) => side[tB] === 1)) throw new Error(L > 1 ? 'Cutting along this region’s outline wouldn’t free it (the surface joins up around it).' : 'Cutting along this border wouldn’t split the part in two (the surface joins up around it). Pick a border that goes right round a limb or a sleeve.');
    for (const [, tB] of seeds) if (!side[tB]) flood(tB, 2);
    // side 2 gets its own copy of every line's vertices
    const copy = new Map();
    rings.forEach((ring, li) => ring.forEach((v, i) => copy.set(v, offs[li] + i)));
    const pos = new Float32Array(M * 3);
    pos.set(P);
    for (const [v, c] of copy) { pos[3 * c] = P[3 * v]; pos[3 * c + 1] = P[3 * v + 1]; pos[3 * c + 2] = P[3 * v + 2]; }
    const tris = [[], [], []];
    for (let t = 0; t < nt; t++) {
      const s = side[t];
      let a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      if (s === 2) { if (copy.has(a)) a = copy.get(a); if (copy.has(b)) b = copy.get(b); if (copy.has(c)) c = copy.get(c); }
      tris[s].push(a, b, c);
    }
    const ek = (a, b) => (a < b ? a * M + b : b * M + a);
    const surf = new Set(), along = new Set(); // the surface's edges, apart from the lines' own (the caps meet those)
    for (const ring of rings) for (let i = 0; i < ring.length; i++) along.add(ek(ring[i], ring[(i + 1) % ring.length]));
    for (let i = 0; i < tris[1].length; i += 3) for (let k = 0; k < 3; k++) { const e = ek(tris[1][i + k], tris[1][i + (k + 1) % 3]); if (!along.has(e)) surf.add(e); }
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
      const per = opts.perLoop ? opts.perLoop[li] || {} : opts;
      const sec = { loops: [makeLoop(ring, [], xy)] }; sec.regions = buildRegions(sec.loops);
      const keys = cfg.type === 'none' || cfg.type === 'plug' ? [] : (per.keys || []).filter(k => regionAt(sec, k.x, k.y) === 0);
      const plugs = cfg.type === 'plug' ? (per.plugs || []).filter(q => q.ok) : [];
      return { ring, n, lf, F, xy, wantCCW, cap, clash, keys, plugs, joined: keys.length + plugs.length, sec };
    });
    const joined = caps.some(c => c.joined), allKeys = caps.flatMap(c => c.keys), allPlugs = caps.flatMap(c => c.plugs);
    const base1 = tris[1].length, base2 = tris[2].length;
    let pins = [];
    const makeParts = (fan) => {
      tris[1].length = base1; tris[2].length = base2; pins = [];
      let src = pos;
      caps.forEach((c, li) => {
        const { ring, n, F, xy, wantCCW, cap } = c;
        if (c.joined) { const r = curvedLoopCap(src, tris, ring, copy, xy, c.lf.h, F, wantCCW, c.keys, cfg, surf, ek, c.plugs); src = r.V; pins.push(...r.pins); }
        else if (fan[li]) {
          const c1 = extra + 2 * li, c2 = c1 + 1, [fx, fy] = fanCentre(xy);
          const fc = [0, 1, 2].map(k => F.o[k] + F.u[k] * fx + F.v[k] * fy);
          for (const cc of [c1, c2]) { src[3 * cc] = fc[0]; src[3 * cc + 1] = fc[1]; src[3 * cc + 2] = fc[2]; }
          const fanTris = [];
          for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; fanTris.push(c1, b, a); } // runs against side 1's line, like the flat cap
          tris[1].push(...fanTris);
          for (let i = 0; i < fanTris.length; i += 3) tris[2].push(c2, copy.get(fanTris[i + 2]), copy.get(fanTris[i + 1]));
        } else {
          tris[1].push(...cap);
          for (let i = 0; i < cap.length; i += 3) tris[2].push(copy.get(cap[i]), copy.get(cap[i + 2]), copy.get(cap[i + 1])); // the same cap, facing the other piece
        }
      });
      const build = (list) => {
        const map = new Map(), out = [], idx = new Uint32Array(list.length);
        for (let i = 0; i < list.length; i++) { const v = list[i]; let w = map.get(v); if (w === undefined) { w = out.length / 3; map.set(v, w); out.push(src[3 * v], src[3 * v + 1], src[3 * v + 2]); } idx[i] = w; }
        const positions = new Float32Array(out);
        return { positions, indices: idx, volume: volume(positions, idx), bbox: bounds(positions) };
      };
      const one = build(tris[1]), two = build(tris[2]);
      one.first = true;
      const rest = L > 1 ? separateShells(two.positions, two.indices) : [];
      const parts = [one, ...(rest.length ? rest : [two])];
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
    let parts = makeParts(caps.map(c => c.clash));
    if (!joined && caps.some(c => !c.clash) && !parts.every(q => edgeReport(q.indices).closed)) parts = makeParts(caps.map(() => true)); // a flat cap didn't seal: fan them instead
    if (parts.every(q => edgeReport(q.indices).closed) && parts.some(q => !(q.volume > 0))) // a line rings a dip, so the "piece" would be empty air
      throw new Error('This line goes round a dip or hollow in the surface, so cutting along it wouldn’t free a solid piece. Pick a line round something that sticks out, like a limb or a sleeve.');
    for (const q of parts) if (!edgeReport(q.indices).closed || !(q.volume > 0)) throw new Error('Keymaster couldn’t make sealed pieces along this border. Try a nearby border, or a flat cut here.');
    const tol = Math.max(1e-4, diag(bounds(P)) * 2e-6);
    // the two pieces each line separates: side 1, and the piece of side 2 holding that line's copied vertices
    const keyOf = (x, y, z) => `${x},${y},${z}`;
    const sets = parts.map(q => { const s = new Set(); for (let i = 0; i < q.positions.length; i += 3) s.add(keyOf(q.positions[i], q.positions[i + 1], q.positions[i + 2])); return s; });
    const pair = (c) => { const k = keyOf(P[3 * c.ring[0]], P[3 * c.ring[0] + 1], P[3 * c.ring[0] + 2]); const other = parts.find((q, i) => !q.first && sets[i].has(k)); return [parts.find(q => q.first), other || parts.find(q => !q.first)]; };
    for (const c of caps) {
      const [p1, p2] = pair(c), F = c.F;
      if (opts.minThickness > 0) { // neither piece may be too thin to print where they meet
        const th0 = opts.minThickness, pts = regionSamples(c.sec, 0, 300), th = jointThickness(p1, p2, F, pts, tol), area = c.sec.regions[0].area, cellArea = area / pts.length;
        for (const s of ['a', 'b']) {
          let n = 0, thin = 0, inner = 0;
          th.forEach((q, i) => { if (!q) return; n++; if (q[s] < th0) { thin++; if (pts[i].clear >= th0) inner++; } });
          if (n && (thin === n || inner * cellArea >= Math.max(Math.PI * th0 * th0, 0.4 * area)))
            throw guardError(`Cutting along this line would leave a piece thinner than ${+th0.toFixed(2)} mm, too thin to print. Pick a line round something thicker, or a flat cut here.`, 'thin');
        }
      }
      const mid = [p1, p2].map(q => volumeCentroid(q.positions, q.indices).centroid), apart = [0, 1, 2].map(k => mid[1][k] - mid[0][k]);
      if (lockedPairs([p1, p2], F.n, tol, { anyDirection: !c.joined, distance: pullDistance(cfg, c.keys, c.plugs), also: Math.hypot(...apart) > 1e-9 ? [apart] : [] }).length) {
        const wedged = L > 1 && caps.filter(d => pair(d)[1] === p2).length > 1; // held at both ends by one piece (a shin between the thigh and a shoe that stands on the same base)
        throw guardError(wedged ? 'This region is held at more than one end by the same piece, so it couldn’t be pulled out after printing. Split off one of its neighbours first, or use a flat cut.'
          : c.joined ? 'With keys, the pieces would have to slide straight apart, and here they’d catch on each other.'
          : 'The pieces on each side of this line would hook round each other, so they couldn’t be put together after printing. Pick a different line, or use a flat cut here.', 'locked');
      }
    }
    parts.sort((x, y) => y.volume - x.volume);
    return { parts, pins, length: loops.reduce((s, l) => s + l.length, 0), frames: caps.map(c => c.F), keys: allKeys, plugs: allPlugs };
  }
  // The keyed cap for a curved cut: the face that follows the line (capHeight), with a hole per key, made once and
  // shared by both pieces so they meet exactly. Round each key's socket outline the face is the same on both sides;
  // inside it, the peg's piece has a narrow ring of face out to the peg (the fit gap) and then the peg, and the
  // socket's piece has the socket. Keys are straight, along the plane's normal, sized as keyLevels describes.
  function curvedLoopCap(pos, tris, ring, copy, xy, hts, F, wantCCW1, keys, cfg, surf, ek, plugs = []) {
    const V = Array.from(pos), n = ring.length;
    const addV = (q) => { V.push(q[0], q[1], q[2]); return V.length / 3 - 1; };
    const at = (x, y, z) => [F.o[0] + F.u[0] * x + F.v[0] * y + F.n[0] * z, F.o[1] + F.u[1] * x + F.v[1] * y + F.n[1] * z, F.o[2] + F.u[2] * x + F.v[2] * y + F.n[2] * z];
    const posOf = (i) => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
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
    const flat = [], ids = [], holes = [], rings = [ring], ringXY = new Map(), other = new Map();
    for (let i = 0; i < n; i++) { ringXY.set(ring[i], [xy[2 * i], xy[2 * i + 1]]); other.set(ring[i], copy.get(ring[i])); }
    for (const q of keep) { ids.push(ring[q]); flat.push(xy[2 * q], xy[2 * q + 1]); }
    // every key or plug as four outlines: the socket's mouth and the peg's base on the face, the peg's end and the
    // socket's floor; with its length and each socket's depth
    const items = keys.map(k => {
      k.cfg = keyCfg(cfg, k); k.spec = keyGeometrySpec(k.cfg); k.angle = keyAngle(sec, 0, k.cfg);
      const ks = k.spec, at2 = (prof) => prof.map(([px, py]) => [k.x + px, k.y + py]);
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
    tris[1].push(...cap);
    for (let i = 0; i < cap.length; i += 3) tris[2].push(other.get(cap[i]), other.get(cap[i + 2]), other.get(cap[i + 1])); // the same face, facing the other piece
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
        if ((cfg.type === 'peg' || k.plug) && sg === pegSide) {
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
    if (cfg.type === 'dowel') for (const k of keys) { const zc = (k.lo + k.hi) / 2; pins.push(makePin((x, y, z) => at(x, y, z + zc), k, k.spec, k.cfg.length)); }
    return { V, pins };
  }

  /* ---------- splitting off a region ----------
     What ZBrush and Meshmixer do with a selected group: the region becomes its own piece, cut along its whole
     outline. The outline may be several loops (an arm has a shoulder loop and a cuff loop), so the cuts go one
     loop at a time, each on the piece that still holds the region, with that loop's own keys or plug. */
  function regionLoops(P, I, seg, g) { return regionOutlines(P, I, seg).filter(l => l.region === g); }
  function splitRegion(P, I, seg, g, opts = {}) {
    const loops = regionLoops(P, I, seg, g);
    if (!loops.length) throw new Error('This region covers the whole surface, so there is nothing to split it from.');
    if (loops.some(l => !l.closed)) throw new Error('This region’s outline pinches to a point somewhere, so it can’t be cut along cleanly. Try a different fold angle.');
    const r = cutAlongLoops(P, I, loops, opts);
    const mine = r.parts.findIndex(q => q.first);
    if (mine > 0) r.parts.unshift(...r.parts.splice(mine, 1)); // the region's own piece first
    for (const q of r.parts) delete q.first;
    return { ...r, loops: loops.length };
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
  function slidesApart(A, B, d, tol, D, step) {
    const F = frameFromNormal(norm3(d), [0, 0, 0]);
    const ga = rayGrid(A.positions, A.indices, F), gb = rayGrid(B.positions, B.indices, F);
    const box = (g) => [g.gx0, g.gy0, g.gx0 + g.nx * g.cell, g.gy0 + g.ny * g.cell];
    const ba = box(ga), bb = box(gb), x0 = Math.max(ba[0], bb[0]), y0 = Math.max(ba[1], bb[1]), x1 = Math.min(ba[2], bb[2]), y1 = Math.min(ba[3], bb[3]);
    if (x1 <= x0 || y1 <= y0) return true;
    const s = Math.max(step, Math.sqrt(((x1 - x0) * (y1 - y0)) / 60000)), nx = Math.ceil((x1 - x0) / s) + 1, ny = Math.ceil((y1 - y0) / s) + 1;
    const fwd = new Uint8Array(nx * ny), back = new Uint8Array(nx * ny), rest = new Uint8Array(nx * ny), grip = Math.max(tol, 0.05);
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
    const wide = (m) => {
      for (let i = 1; i + 1 < nx; i++) for (let j = 1; j + 1 < ny; j++) {
        const k = i * ny + j;
        if (m[k] && m[k - 1] && m[k + 1] && m[k - ny] && m[k + ny]) return true;
      }
      return false;
    };
    return !wide(fwd) || !wide(back) || wide(rest);
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
    const tanS = Math.tan((Math.max(0, Math.min(30, cfg.plugSlope === undefined ? 5 : cfg.plugSlope)) * Math.PI) / 180), gs = c * Math.sqrt(1 + tanS * tanS);
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
      const sh = plugShape(sec, ri, inset, round);
      if (sh.reason) return sh;
      const base = sh.ring, mouth = offsetRing(base, gs);
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
      const { base, mouth, depth, want } = best;
      const top = offsetRing(base, -depth * tanS), floor = offsetRing(top, gs);
      if (![base, top, mouth, floor].every(ringOk)) { out.push({ region: ri, ok: false, reason: 'Area too irregular for a plug' }); continue; }
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
    const skip = opts.skip || new Set();
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
        if (bad.length) throw guardError(thinMessage(base.regions, bad, opts.minThickness), 'thin', { thin: bad });
        if (thin.length) {
          joinSpecks = new Set([...skip, ...thin.map(q => q.region)]);
          if (base.regions.every((r, i) => joinSpecks.has(i))) throw guardError(`This cut only grazes the surface, so the piece it cut off would be thinner than ${+opts.minThickness.toFixed(2)} mm, too thin to print. Move the cut deeper into the model.`, 'thin', { thin });
        }
      }
    }
    const attempt = (sk) => {
      for (const k of [0, 1, -1, 2, -2, 4, -4]) {
        const Fk = k ? shiftFrame(F, k * step) : F;
        const res = cutOnce(P, I, Fk, { ...opts, skip: sk });
        if (res.parts.every(q => edgeReport(q.indices).closed) && res.pins.every(q => edgeReport(q.indices).closed)) {
          res.retries = Math.abs(k) && [0, 1, -1, 2, -2, 4, -4].indexOf(k);
          checkLocks(res, Fk, sk, opts, scale);
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
    const keys = (cfg.type === 'none' ? [] : (opts.keys || [])).map(k => ({ ...k, region: -1 }));
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
          if (cfg.type === 'peg') {
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
      if (cfg.type === 'dowel') for (const k of myKeys) pins.push(makePin(at, k, k.spec, k.cfg.length));
    });

    // An area whose two faces end up in the same piece (the joined areas hold them together) would only be a crack.
    const shown = shownRegions(regions), pairs = [];
    for (const ri of shown) if (!skip.has(ri)) { const q = loops[regions[ri].outer].ids[0]; pairs.push([nv + q, nv + np + q, ri]); }
    const comps = splitComponents(V.a.subarray(0, V.n), T.view(), nv, spans, Fs, pairs);
    if (comps.cracked.length) {
      const names = areaNames(regions, comps.cracked), one = comps.cracked.length === 1;
      throw guardError(`The joined areas hold both sides of ${names} together, so cutting ${one ? 'it' : 'them'} would only make a crack, not separate pieces. Cut another area too, or leave ${one ? 'it' : 'them'} joined.`, 'crack', { regions: comps.cracked });
    }
    return { parts: comps, pins, shift: sec.shift, regions, keysUsed: keys.filter(k => k.region >= 0 && !skip.has(k.region)).length + plugs.filter(q => q.region >= 0 && !skip.has(q.region)).length };
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
    KEY_SHAPES, MAGNET_SHAPES, keyProfile, profileFit, profileArea, keyAngle, keyCfg, KEY_OVERRIDES, autoFitKeys, sizeLadder, PRINTERS, MAGNET_SIZES,
    sweepDirections, neckSweep, refineNecks, creaseEdges, creasePlanes, separateShells,
    segmentSurface, regionBorderLines, bordersFromGroups, borderLoops, regionOutlines, cutLines, borderLoopNear, cutAlongLoop, analyzeLoop, keyLevels, capHeight, planPlugs, plugShape, offsetRing, splitRegion, regionLoops, regionAtPoint, cutAlongLoops,
    thinAreas, jointThickness, slidesApart, lockedPairs, rayGrid, solidRuns, shownRegions, thinMessage, fanCentre, straightLoop,
    cutMesh, mergeMeshes, transformPositions, creasedArrays, writeSTL, makeZip, torusKnot, earcut,
  };
})();
if (typeof module !== 'undefined') module.exports = KMCore;
