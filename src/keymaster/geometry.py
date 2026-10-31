"""Non-destructive planar cutting and integrated mating key geometry.

All lengths use the input model's units. Users must import models sized in mm.
Only closed positive-volume manifold meshes are supported in this preview.
"""
from __future__ import annotations

from dataclasses import dataclass
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
    shape: str = "round"


@dataclass(frozen=True)
class CutResult:
    peg_side: trimesh.Trimesh
    socket_side: trimesh.Trimesh


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
    mesh = trimesh.load(source, force="mesh", process=False)
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
    if key.shape not in {"round", "square"}:
        raise GeometryError("Supported key shapes are round and square.")


def _footprint(key: KeySpec) -> np.ndarray:
    radius = key.diameter / 2 + key.radial_clearance + key.edge_margin
    if key.shape == "round":
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
            aa = (math.sqrt(2) if a.shape == "square" else 1) * (a.diameter / 2 + a.radial_clearance)
            bb = (math.sqrt(2) if b.shape == "square" else 1) * (b.diameter / 2 + b.radial_clearance)
            if sep < aa + bb + max(a.edge_margin, b.edge_margin):
                raise GeometryError("Keys overlap or have insufficient spacing.")


def _key_solid(key: KeySpec, plane: CutPlane, socket: bool) -> Manifold:
    origin, n, u, v = frame(plane)
    diameter = key.diameter + (2 * key.radial_clearance if socket else 0.0)
    start = -0.35 if socket else -min(key.depth * 0.2, 0.7)
    end = key.depth + (key.axial_clearance if socket else 0.0)
    height = end - start
    if key.shape == "round":
        shape = trimesh.creation.cylinder(radius=diameter / 2, height=height, sections=48)
    else:
        shape = trimesh.creation.box(extents=(diameter, diameter, height))
    transform = np.eye(4)
    transform[:3, :3] = np.column_stack((u, v, n))
    transform[:3, 3] = origin + u * key.u + v * key.v + n * ((start + end) / 2)
    shape.apply_transform(transform)
    return _as_manifold(shape)


def cut_and_key(
    mesh: trimesh.Trimesh,
    plane: CutPlane,
    keys: list[KeySpec] | tuple[KeySpec, ...] = (),
) -> CutResult:
    """Peg side is negative normal; socket side is positive normal.

    Radial clearance is specified per side: socket diameter = key diameter
    plus twice radial clearance. Axial clearance increases socket depth.
    """
    negative, positive = _split(mesh, plane)
    specs = list(keys)
    if specs:
        _check_placements(specs, _cap_triangles(negative, plane))
        components = len(negative.decompose())
        for key in specs:
            negative = negative + _key_solid(key, plane, False)
            positive = positive - _key_solid(key, plane, True)
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


def export_stl(result: CutResult, destination: str | Path, stem: str) -> tuple[Path, Path]:
    folder = Path(destination)
    folder.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_") or "model"
    paths = (folder / f"{name}_A_peg.stl", folder / f"{name}_B_socket.stl")
    if any(path.exists() for path in paths):
        raise GeometryError("Export already exists. Choose a different folder or name.")
    validate_mesh(result.peg_side)
    validate_mesh(result.socket_side)
    for path, mesh in zip(paths, (result.peg_side, result.socket_side)):
        path.write_bytes(mesh.export(file_type="stl"))
    return paths
