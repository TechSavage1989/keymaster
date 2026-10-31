"""Non-destructive planar cutting and integrated mating key geometry.

All lengths use the input model's units. Users must import models sized in mm.
Only closed positive-volume manifold meshes are supported in this preview.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
import math
import re

import numpy as np
import trimesh
from manifold3d import Manifold, Mesh


class GeometryError(ValueError):
    """An invalid model or operation that must not be exported."""


@dataclass(frozen=True)
class CutPlane:
    origin: tuple[float, float, float]
    normal: tuple[float, float, float]


@dataclass(frozen=True)
class KeySpec:
    u: float = 0.0
    v: float = 0.0
    diameter: float = 6.0
    depth: float = 5.0
    radial_clearance: float = 0.2
    axial_clearance: float = 0.3
    edge_margin: float = 0.8
    shape: str = "round"  # round, square, tapered or experimental snap


@dataclass(frozen=True)
class CutResult:
    peg_side: trimesh.Trimesh
    socket_side: trimesh.Trimesh
    additional_parts: tuple[trimesh.Trimesh, ...] = ()

    @property
    def parts(self) -> tuple[trimesh.Trimesh, ...]:
        return (self.peg_side, self.socket_side, *self.additional_parts)


def validate_mesh(mesh: trimesh.Trimesh) -> None:
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise GeometryError("A triangle mesh is required.")
    if not np.isfinite(mesh.vertices).all():
        raise GeometryError("Mesh contains non-finite coordinates.")
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0:
        raise GeometryError(
            "Model must be closed, consistently oriented, and positive-volume. "
            "Repair open surfaces and inverted normals before importing."
        )


def load_model(path: str | Path) -> trimesh.Trimesh:
    source = Path(path)
    if source.suffix.lower() not in {".stl", ".obj"}:
        raise GeometryError("Only STL and OBJ imports are supported in this preview.")
    if not source.is_file():
        raise GeometryError(f"File not found: {source}")
    # STL stores independent coordinates for every triangle. Consolidate shared
    # vertex records before topology checks; otherwise a valid exported solid
    # can appear to contain thousands of disconnected faces. Preserve the OBJ
    # import behavior, and never use processing as a substitute for validation.
    mesh = trimesh.load(
        source,
        force="mesh",
        process=source.suffix.lower() == ".stl",
    )
    validate_mesh(mesh)
    return mesh


def frame(plane: CutPlane) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    origin = np.asarray(plane.origin, dtype=float)
    n = np.asarray(plane.normal, dtype=float)
    if origin.shape != (3,) or n.shape != (3,) or not np.isfinite(origin).all() or not np.isfinite(n).all():
        raise GeometryError("Plane origin and normal must be finite 3D vectors.")
    length = float(np.linalg.norm(n))
    if length < 1e-12:
        raise GeometryError("Plane normal cannot be zero.")
    n /= length
    helper = np.array((0.0, 1.0, 0.0)) if abs(n[2]) > 0.9 else np.array((0.0, 0.0, 1.0))
    u = np.cross(helper, n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    return origin, n, u, v


def _as_manifold(mesh: trimesh.Trimesh) -> Manifold:
    solid = Manifold(mesh=Mesh(
        vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
        tri_verts=np.asarray(mesh.faces, dtype=np.uint32),
    ))
    if solid.is_empty() or solid.volume() <= 0:
        raise GeometryError("Manifold conversion failed; model may contain invalid intersections.")
    return solid


def _as_trimesh(solid: Manifold) -> trimesh.Trimesh:
    if solid.is_empty():
        raise GeometryError("An operation produced an empty part.")
    data = solid.to_mesh()
    mesh = trimesh.Trimesh(
        vertices=np.asarray(data.vert_properties, dtype=np.float64)[:, :3],
        faces=np.asarray(data.tri_verts, dtype=np.int64),
        process=False,
    )
    validate_mesh(mesh)
    return mesh


def _split(mesh: trimesh.Trimesh, plane: CutPlane) -> tuple[Manifold, Manifold]:
    validate_mesh(mesh)
    origin, n, _, _ = frame(plane)
    positive, negative = _as_manifold(mesh).split_by_plane(
        tuple(float(x) for x in n), float(np.dot(n, origin))
    )
    if positive.is_empty() or negative.is_empty() or positive.volume() <= 0 or negative.volume() <= 0:
        raise GeometryError("The plane must pass through solid model material, leaving two nonempty parts.")
    return negative, positive


def _split_with_gap(
    mesh: trimesh.Trimesh, plane: CutPlane, face_clearance: float = 0.0
) -> tuple[Manifold, Manifold]:
    """Remove a centered planar gap without moving/scaling the original model."""
    if not math.isfinite(face_clearance) or face_clearance < 0:
        raise GeometryError("Face clearance must be a finite nonnegative measurement.")
    if face_clearance == 0:
        return _split(mesh, plane)
    validate_mesh(mesh)
    origin, normal, _, _ = frame(plane)
    solid = _as_manifold(mesh)
    value = float(np.dot(normal, origin))
    positive, _ = solid.split_by_plane(tuple(normal), value + face_clearance / 2)
    _, negative = solid.split_by_plane(tuple(normal), value - face_clearance / 2)
    if positive.is_empty() or negative.is_empty():
        raise GeometryError("Face clearance leaves an empty piece. Reduce the cut gap.")
    return negative, positive


def _frustum_mesh(radius_base: float, radius_tip: float, height: float, sections: int = 48) -> trimesh.Trimesh:
    """Closed frustrum along local Z, oriented with the large end at the cut face."""
    angles = np.linspace(0, math.tau, sections, endpoint=False)
    lower = np.column_stack((radius_base * np.cos(angles), radius_base * np.sin(angles),
                             np.full(sections, -height / 2)))
    upper = np.column_stack((radius_tip * np.cos(angles), radius_tip * np.sin(angles),
                             np.full(sections, height / 2)))
    vertices = np.vstack((lower, upper, [0, 0, -height / 2], [0, 0, height / 2]))
    faces = []
    for i in range(sections):
        j = (i + 1) % sections
        faces.extend(((i, j, sections + j), (i, sections + j, sections + i),
                      (2 * sections, j, i), (2 * sections + 1, sections + i, sections + j)))
    mesh = trimesh.Trimesh(vertices=vertices, faces=np.asarray(faces), process=False)
    validate_mesh(mesh)
    return mesh


def _cap_triangles(negative: Manifold, plane: CutPlane) -> np.ndarray:
    origin, n, u, v = frame(plane)
    mesh = _as_trimesh(negative)
    distance = np.abs((mesh.vertices - origin) @ n)
    tolerance = max(1e-4, float(np.max(mesh.extents)) * 1e-5)
    coplanar = np.all(distance[mesh.faces] <= tolerance, axis=1)
    if not coplanar.any():
        raise GeometryError("Could not locate the solid cut face.")
    xyz = mesh.vertices[mesh.faces[coplanar]] - origin
    return np.stack((xyz @ u, xyz @ v), axis=-1)


def _inside_cap(triangles: np.ndarray, point: np.ndarray) -> bool:
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ab, ac, ap = b - a, c - a, point - a
    den = ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]
    valid = np.abs(den) > 1e-12
    x = np.zeros(len(triangles))
    y = np.zeros(len(triangles))
    x[valid] = (ap[valid, 0] * ac[valid, 1] - ap[valid, 1] * ac[valid, 0]) / den[valid]
    y[valid] = (ab[valid, 0] * ap[valid, 1] - ab[valid, 1] * ap[valid, 0]) / den[valid]
    return bool(np.any(valid & (x >= -1e-7) & (y >= -1e-7) & (x + y <= 1 + 1e-7)))


def _check_key(key: KeySpec) -> None:
    values = (key.u, key.v, key.diameter, key.depth, key.radial_clearance, key.axial_clearance, key.edge_margin)
    if not all(math.isfinite(float(number)) for number in values):
        raise GeometryError("Key measurements must be finite.")
    if key.diameter <= 0 or key.depth <= 0:
        raise GeometryError("Key diameter and depth must be positive.")
    if min(key.radial_clearance, key.axial_clearance, key.edge_margin) < 0:
        raise GeometryError("Clearances and edge margin cannot be negative.")
    if key.shape not in {"round", "square", "tapered", "snap"}:
        raise GeometryError("Supported connector shapes are round, square, tapered and experimental snap.")


def _footprint(key: KeySpec) -> np.ndarray:
    effective_diameter = key.diameter * (1.12 if key.shape == "snap" else 1.0)
    radius = effective_diameter / 2 + key.radial_clearance + key.edge_margin
    if key.shape != "square":
        angles = np.linspace(0, 2 * np.pi, 32, endpoint=False)
        perimeter = np.column_stack((np.cos(angles) * radius, np.sin(angles) * radius))
    else:
        perimeter = np.array([
            [-radius, -radius], [-radius, 0], [-radius, radius], [0, -radius],
            [0, radius], [radius, -radius], [radius, 0], [radius, radius],
        ])
    return np.vstack((np.array([[0, 0]]), perimeter)) + np.array((key.u, key.v))


def _check_placements(keys: list[KeySpec], cap: np.ndarray) -> None:
    for key in keys:
        _check_key(key)
        if not all(_inside_cap(cap, point) for point in _footprint(key)):
            raise GeometryError(f"Key at ({key.u:.2f}, {key.v:.2f}) is outside the solid cut face or too close to an edge.")
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            sep = math.hypot(a.u - b.u, a.v - b.v)
            aa = (math.sqrt(2) if a.shape == "square" else 1.12 if a.shape == "snap" else 1) * (a.diameter / 2 + a.radial_clearance)
            bb = (math.sqrt(2) if b.shape == "square" else 1.12 if b.shape == "snap" else 1) * (b.diameter / 2 + b.radial_clearance)
            if sep < aa + bb + max(a.edge_margin, b.edge_margin):
                raise GeometryError("Keys overlap or have insufficient spacing.")


def _key_solid(
    key: KeySpec, plane: CutPlane, socket: bool,
    face_clearance: float = 0.0,
) -> Manifold:
    """Generate the integral peg or matching recess, with a generous solid overlap."""
    _check_key(key)
    origin, normal, u, v = frame(plane)
    diameter = key.diameter + (2 * key.radial_clearance if socket else 0.0)
    base = (-face_clearance / 2 - min(key.depth * 0.2, 0.7)
            if not socket else face_clearance / 2 - 0.4)
    end = (face_clearance / 2 + key.depth
           + (key.axial_clearance if socket else 0.0))
    height = end - base
    if height <= 0:
        raise GeometryError("Connector has no positive insertion length.")
    if key.shape == "square":
        local = trimesh.creation.box(extents=(diameter, diameter, height))
    elif key.shape == "tapered":
        local = _frustum_mesh(diameter / 2, diameter * 0.41, height)
    else:
        local = trimesh.creation.cylinder(radius=diameter / 2, height=height, sections=48)
    transform = np.eye(4)
    transform[:3, :3] = np.column_stack((u, v, normal))
    transform[:3, 3] = origin + u * key.u + v * key.v + normal * ((base + end) / 2)
    local.apply_transform(transform)
    solid = _as_manifold(local)
    if key.shape == "snap":
        # Prototype retention shoulder. Requires an independently calibrated,
        # compliant FDM material; not mechanically rated or suitable for resin.
        lip_radius = key.diameter * 0.56 + (key.radial_clearance if socket else 0)
        lip_height = max(key.depth * 0.16, 0.45)
        shoulder = trimesh.creation.cylinder(
            radius=lip_radius, height=lip_height, sections=48
        )
        shoulder_transform = np.array(transform, copy=True)
        shoulder_transform[:3, 3] += normal * (height / 2 - lip_height / 2 - 0.05)
        shoulder.apply_transform(shoulder_transform)
        solid = solid + _as_manifold(shoulder)
    return solid


def cut_and_key(
    mesh: trimesh.Trimesh,
    plane: CutPlane,
    keys: list[KeySpec] | tuple[KeySpec, ...] = (),
    face_clearance: float = 0.0,
) -> CutResult:
    """Peg side is negative normal; socket side is positive normal.

    Radial clearance is specified per side: socket diameter = key diameter
    plus twice radial clearance. Axial clearance increases socket depth.
    """
    negative, positive = _split_with_gap(mesh, plane, face_clearance)
    specs = list(keys)
    if specs:
        origin, normal, _, _ = frame(plane)
        cap_plane = CutPlane(tuple(origin - normal * face_clearance / 2),
                             tuple(normal))
        _check_placements(specs, _cap_triangles(negative, cap_plane))
        components = len(negative.decompose())
        for key in specs:
            negative = negative + _key_solid(key, plane, False, face_clearance)
            positive = positive - _key_solid(key, plane, True, face_clearance)
            if negative.is_empty() or positive.is_empty():
                raise GeometryError("Key operation consumed a part.")
        if len(negative.decompose()) > components:
            raise GeometryError("Generated peg is not attached to the parent piece.")
    return CutResult(_as_trimesh(negative), _as_trimesh(positive))


def suggest_key(
    mesh: trimesh.Trimesh,
    plane: CutPlane,
    template: KeySpec,
    existing: list[KeySpec] | tuple[KeySpec, ...] = (),
) -> KeySpec:
    """Find a position that fits the key's sampled guard perimeter."""
    _check_key(template)
    negative, _ = _split(mesh, plane)
    cap = _cap_triangles(negative, plane)
    vec_a = cap[:, 1] - cap[:, 0]
    vec_b = cap[:, 2] - cap[:, 0]
    area = np.abs(vec_a[:, 0] * vec_b[:, 1] - vec_a[:, 1] * vec_b[:, 0])
    for idx in np.argsort(area)[::-1][:500]:
        u, v = cap[idx].mean(axis=0)
        candidate = KeySpec(float(u), float(v), template.diameter, template.depth,
                            template.radial_clearance, template.axial_clearance,
                            template.edge_margin, template.shape)
        try:
            _check_placements([*existing, candidate], cap)
            return candidate
        except GeometryError:
            continue
    raise GeometryError("No safe automatic location found. Reduce key size or place one manually.")


def suggest_keys(
    mesh: trimesh.Trimesh, plane: CutPlane,
    template: KeySpec, count: int = 2,
    existing: list[KeySpec] | tuple[KeySpec, ...] = (),
) -> tuple[KeySpec, ...]:
    """Suggest a spaced set of keyed positions on the real manifold cap.

    Independent candidates are validated against every existing key; a warning
    is raised rather than placing unsafe or overlapping connections.
    """
    if not isinstance(count, int) or count < 1 or count > 12:
        raise GeometryError("Automatic key count must be from 1 to 12.")
    _check_key(template)
    negative, _ = _split(mesh, plane)
    cap = _cap_triangles(negative, plane)
    triangles = cap.reshape((-1, 2))
    lo, hi = triangles.min(axis=0), triangles.max(axis=0)
    xs = np.linspace(lo[0], hi[0], 13)
    ys = np.linspace(lo[1], hi[1], 13)
    centroid = (lo + hi) / 2
    positions = sorted(
        ((float(x), float(y)) for x in xs for y in ys),
        key=lambda p: -float(np.linalg.norm(np.asarray(p) - centroid)),
    )
    # Select far-apart valid positions first, rather than clustering on a
    # single triangulation centroid.
    chosen = list(existing)
    suggested: list[KeySpec] = []
    for _ in range(count):
        best = None
        best_score = -float("inf")
        for u, v in positions:
            candidate = replace(template, u=u, v=v)
            try:
                _check_placements([*chosen, candidate], cap)
            except GeometryError:
                continue
            distances = [math.hypot(u - k.u, v - k.v) for k in chosen]
            clearance_from_box = min(
                u - lo[0], hi[0] - u, v - lo[1], hi[1] - v
            )
            # Encourage spacing but avoid invalid near-edge locations.
            score = (min(distances) if distances else clearance_from_box)
            score += clearance_from_box * 0.1
            if score > best_score:
                best_score, best = score, candidate
        if best is None:
            raise GeometryError(
                f"Only {len(suggested)} safe automatic keys fit. "
                "Reduce key diameter/count or select manual placements."
            )
        chosen.append(best)
        suggested.append(best)
    return tuple(suggested)


def export_stl(result: CutResult, destination: str | Path, stem: str) -> tuple[Path, Path]:
    folder = Path(destination)
    folder.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_") or "model"
    paths = [
        folder / f"{name}_A_peg.stl",
        folder / f"{name}_B_socket.stl",
    ]
    paths.extend(
        folder / f"{name}_{chr(ord('C') + i)}_part_{i + 2:02d}.stl"
        for i in range(len(result.additional_parts))
    )
    if any(path.exists() for path in paths):
        raise GeometryError("Export already exists. Choose a different folder or name.")
    parts = result.parts
    for part in parts:
        validate_mesh(part)
    for path, part in zip(paths, parts):
        path.write_bytes(part.export(file_type="stl"))
    return tuple(paths)
