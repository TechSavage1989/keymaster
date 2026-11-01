// Test-only stand-in for the parts of three.js r147 that Keymaster uses. Real math, no rendering.
(function () {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    negate() { return this.multiplyScalar(-1); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    lengthSq() { return this.dot(this); }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
    lerpVectors(a, b, t) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
    applyQuaternion(q) {
      const x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
      return this;
    }
    crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
    project(cam) {
      const B = camBasis(cam), d = this.clone().sub(cam.position);
      const x = d.dot(B.right), y = d.dot(B.up), z = Math.max(1e-6, d.dot(B.fwd));
      return this.set(x / (z * B.t * cam.aspect), y / (z * B.t), 0.5);
    }
  }
  function camBasis(cam) {
    const tgt = cam._target || new Vector3();
    const fwd = tgt.clone().sub(cam.position).normalize();
    let right = new Vector3().crossVectors(fwd, cam.up);
    if (right.lengthSq() < 1e-9) right = new Vector3(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();
    return { fwd, right, up, t: Math.tan((cam.fov * Math.PI) / 360) };
  }
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
  class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
    clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
    copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
    invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    setFromAxisAngle(a, ang) { const s = Math.sin(ang / 2); this.x = a.x * s; this.y = a.y * s; this.z = a.z * s; this.w = Math.cos(ang / 2); return this; }
    setFromUnitVectors(f, t) {
      let r = f.dot(t) + 1;
      if (r < 1e-8) {
        r = 0;
        if (Math.abs(f.x) > Math.abs(f.z)) { this.x = -f.y; this.y = f.x; this.z = 0; this.w = r; }
        else { this.x = 0; this.y = -f.z; this.z = f.y; this.w = r; }
      } else {
        this.x = f.y * t.z - f.z * t.y; this.y = f.z * t.x - f.x * t.z; this.z = f.x * t.y - f.y * t.x; this.w = r;
      }
      const l = Math.hypot(this.x, this.y, this.z, this.w); this.x /= l; this.y /= l; this.z /= l; this.w /= l;
      return this;
    }
    multiply(q) {
      const ax = this.x, ay = this.y, az = this.z, aw = this.w, bx = q.x, by = q.y, bz = q.z, bw = q.w;
      this.x = ax * bw + aw * bx + ay * bz - az * by; this.y = ay * bw + aw * by + az * bx - ax * bz;
      this.z = az * bw + aw * bz + ax * by - ay * bx; this.w = aw * bw - ax * bx - ay * by - az * bz;
      return this;
    }
  }
  class Matrix4 {
    constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    compose(p, q) {
      const X = new Vector3(1, 0, 0).applyQuaternion(q), Y = new Vector3(0, 1, 0).applyQuaternion(q), Z = new Vector3(0, 0, 1).applyQuaternion(q);
      this.elements = [X.x, X.y, X.z, 0, Y.x, Y.y, Y.z, 0, Z.x, Z.y, Z.z, 0, p.x, p.y, p.z, 1];
      return this;
    }
  }
  class Color {
    constructor(c) { this.v = c; }
    set(c) { this.v = c; return this; }
    lerp() { return this; }
    clone() { return new Color(this.v); }
  }
  class EventTarget3 {
    addEventListener(t, f) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(f); }
    dispatch(t, e) { ((this._l || {})[t] || []).forEach(f => f(e || {})); }
  }
  class Object3D extends EventTarget3 {
    constructor() {
      super();
      this.children = []; this.parent = null; this.position = new Vector3(); this.quaternion = new Quaternion();
      this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.visible = true; this.userData = {}; this.renderOrder = 0; this.matrixWorld = new Matrix4();
    }
    add(...os) { for (const o of os) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); } return this; }
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } return this; }
    traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); }
    updateMatrixWorld() { this.matrixWorld.compose(this.position, this.quaternion); }
    worldToLocal(v) { return v.sub(this.position).applyQuaternion(this.quaternion.clone().invert()); }
    localToWorld(v) { return v.applyQuaternion(this.quaternion).add(this.position); }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    setIndex(i) { this.index = i; return this; }
    setFromPoints(p) { this.points = p; return this; }
    computeBoundingSphere() {} computeBoundingBox() {}
    rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
    dispose() { this.disposed = true; }
  }
  class Material {
    constructor(p = {}) { Object.assign(this, p); this.color = new Color(p.color); }
    clone() { const m = new this.constructor(); Object.assign(m, this); m.color = this.color.clone(); return m; }
    dispose() {}
  }
  class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class Plane {
    constructor(n = new Vector3(0, 0, 1), c = 0) { this.normal = n; this.constant = c; }
    set(n, c) { this.normal.copy(n); this.constant = c; return this; }
    setFromNormalAndCoplanarPoint(n, p) { this.normal.copy(n); this.constant = -p.dot(n); return this; }
  }
  const T = {
    Vector3, Vector2, Quaternion, Matrix4, Color, Object3D, BufferGeometry, Plane, Mesh,
    Scene: class extends Object3D {},
    Group: class extends Object3D {},
    LineLoop: class extends Mesh {},
    LineSegments: class extends Mesh {},
    Line: class extends Mesh {},
    SphereGeometry: class extends BufferGeometry {},
    HemisphereLight: class extends Object3D {},
    DirectionalLight: class extends Object3D {},
    GridHelper: class extends Mesh { constructor() { super(new BufferGeometry(), new Material()); } },
    PerspectiveCamera: class extends Object3D { constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); this.up = new Vector3(0, 1, 0); } updateProjectionMatrix() {} },
    BufferAttribute: class { constructor(a, s) { this.array = a; this.itemSize = s; } },
    PlaneGeometry: class extends BufferGeometry {}, CircleGeometry: class extends BufferGeometry {},
    TorusGeometry: class extends BufferGeometry {},
    BoxGeometry: class extends BufferGeometry {}, CylinderGeometry: class extends BufferGeometry {},
    MeshBasicMaterial: class extends Material {}, MeshStandardMaterial: class extends Material {}, LineBasicMaterial: class extends Material {},
    CanvasTexture: class { constructor(c) { this.image = c; this.repeat = { set() {} }; } },
    Raycaster: class {
      constructor() { this.ray = { origin: new Vector3(), direction: new Vector3(0, 0, -1), intersectPlane(pl, target) {
        const den = pl.normal.dot(this.direction);
        if (Math.abs(den) < 1e-9) return null;
        const t = -(this.origin.dot(pl.normal) + pl.constant) / den;
        if (t < 0) return null;
        return target.copy(this.origin).add(this.direction.clone().multiplyScalar(t));
      } }; }
      setFromCamera(ndc, cam) {
        const B = camBasis(cam);
        this.ray.origin.copy(cam.position);
        this.ray.direction.copy(B.fwd).add(B.right.clone().multiplyScalar(ndc.x * B.t * cam.aspect)).add(B.up.clone().multiplyScalar(ndc.y * B.t)).normalize();
      }
      intersectObjects() { return []; }
    },
    WebGLRenderer: class {
      constructor() { this.domElement = document.createElement('canvas'); this.capabilities = { getMaxAnisotropy: () => 1 }; window.__renders = 0; }
      setPixelRatio() {} setSize() {} setClearColor() {} clearStencil() {}
      render(scene) { window.__renders++; scene.traverse(o => { if (o.onAfterRender && o.visible) o.onAfterRender(this); }); }
    },
    OrbitControls: class extends EventTarget3 { constructor(cam) { super(); this.cam = cam; this.target = new Vector3(); this.enabled = true; } update() { this.cam._target = this.target; return false; } },
    TransformControls: class extends Object3D {
      constructor() { super(); this.dragging = false; this.axis = null; }
      setSpace(s) { this.space = s; } setSize() {} setMode(m) { this.mode = m; }
      attach(o) { this.object = o; return this; } detach() { this.object = undefined; return this; }
    },
    DoubleSide: 2, BackSide: 1, FrontSide: 0, RepeatWrapping: 1000,
    AlwaysStencilFunc: 519, NotEqualStencilFunc: 517, IncrementWrapStencilOp: 34055, DecrementWrapStencilOp: 34056, ReplaceStencilOp: 7681,
  };
  window.THREE = T;
})();
