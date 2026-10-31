"""Non-destructive analysis and selective cutting of detachable plane-side solids.

A single plane can produce several independent positive-side sections. The
user chooses which sections become separate printable parts. Other positive
sections are Boolean-rejoined to the retained negative side, so they remain
attached instead of being cut unnecessarily.

This does not segment regions fused together on the chosen side of the plane.
Those regions must be separated by a different plane or an additional cut.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
import numpy as np
import trimesh

from .geometry import (
    CutPlane, CutResult, GeometryError, KeySpec, _as_trimesh, _cap_triangles,
    _check_placements, _inside_cap, _key_solid, _split, _split_with_gap,
    frame, validate_mesh,
)


@dataclass(frozen=True)
class SectionCandidate:
    index: int
    volume: float
    centroid: tuple[float, float, float]
    surface_area: float
    mesh: trimesh.Trimesh
    cap: np.ndarray

    @property
    def label(self) -> str:
        x, y, z = self.centroid
        return f"Section {self.index + 1} | center ({x:.1f}, {y:.1f}, {z:.1f}) mm"


def _ordered_components(solid):
    """Stable output order for UI selection and export naming."""
    parts = list(solid.decompose())
    return sorted(parts, key=lambda part: (
        -float(part.volume()),
        tuple(round(float(x), 5) for x in _as_trimesh(part).centroid),
    ))


def _cap_area(triangles: np.ndarray) -> float:
    ab = triangles[:, 1] - triangles[:, 0]
    ac = triangles[:, 2] - triangles[:, 0]
    return float(np.abs(ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]).sum() / 2)


def analyze_sections(mesh: trimesh.Trimesh, plane: CutPlane) -> tuple[SectionCandidate, ...]:
    """Analyze sections on the positive-normal side after a planar split.

    Section IDs are stable for an unchanged mesh and plane. Each candidate
    carries preview geometry for highlighting in the viewport.
    """
    _, positive = _split(mesh, plane)
    candidates = []
    for index, part in enumerate(_ordered_components(positive)):
        output = _as_trimesh(part)
        try:
            cap = _cap_triangles(part, plane)
        except GeometryError:
            # Closed solids entirely on one side are not candidates for a
            # detachable seam; keep them with the retained body instead.
            continue
        area = _cap_area(cap)
        if area <= 1e-7:
            continue
        centroid = tuple(float(v) for v in output.centroid)
        candidates.append(SectionCandidate(
            index=index, volume=float(output.volume),
            centroid=centroid, surface_area=area, mesh=output, cap=cap,
        ))
    if not candidates:
        raise GeometryError("No detachable sections intersect the selected cutting plane.")
    return tuple(candidates)


def place_keys_on_cap(
    cap: np.ndarray, template: KeySpec, count: int = 2,
    existing: Iterable[KeySpec] = (),
) -> tuple[KeySpec, ...]:
    """Suggest a spaced, safe set of locations for one selected seam only."""
    from .geometry import _check_key
    if not isinstance(count, int) or count < 1 or count > 12:
        raise GeometryError("Automatic connector count must be between 1 and 12.")
    _check_key(template)
    vertices = cap.reshape((-1, 2))
    lo, hi = vertices.min(axis=0), vertices.max(axis=0)
    candidates = [(float(u), float(v)) for u in np.linspace(lo[0], hi[0], 15)
                   for v in np.linspace(lo[1], hi[1], 15)]
    installed = list(existing)
    output = []
    for _ in range(count):
        best = None
        best_score = -1e30
        for u, v in candidates:
            trial = type(template)(
                u, v, template.diameter, template.depth, template.radial_clearance,
                template.axial_clearance, template.edge_margin, template.shape,
            )
            try:
                _check_placements([*installed, trial], cap)
            except GeometryError:
                continue
            # Favor the farthest point from existing pegs and solid edges.
            min_sep = (min(np.hypot(u - k.u, v - k.v) for k in installed)
                       if installed else float(np.min(hi - lo)))
            box_margin = min(u - lo[0], hi[0] - u, v - lo[1], hi[1] - v)
            score = min_sep + box_margin * 0.3
            if score > best_score:
                best, best_score = trial, score
        if best is None:
            raise GeometryError(
                f"Only {len(output)} connectors fit this section with the "
                "requested diameter and margin. Reduce the count or size."
            )
        installed.append(best)
        output.append(best)
    return tuple(output)


def cut_selected_sections(
    mesh: trimesh.Trimesh,
    plane: CutPlane,
    selected: Iterable[int],
    keys: Iterable[KeySpec] = (),
    face_clearance: float = 0.0,
) -> CutResult:
    """Cut only chosen detachable positive-side components.

    The unchosen positive components are rejoined to the negative side.
    Returns one retained body and at least one selected detached piece.
    Additional detached pieces are available in CutResult.additional_parts.
    """
    validate_mesh(mesh)
    selected_ids = tuple(dict.fromkeys(int(i) for i in selected))
    if not selected_ids:
        raise GeometryError("Select at least one section to detach.")
    if any(i < 0 for i in selected_ids):
        raise GeometryError("Selected section ID is invalid.")
    if face_clearance < 0 or not np.isfinite(face_clearance):
        raise GeometryError("Face clearance must be nonnegative and finite.")

    # Analysis and separation happen at zero gap for stable component IDs.
    negative, positive = _split(mesh, plane)
    components = _ordered_components(positive)
    if any(i >= len(components) for i in selected_ids):
        raise GeometryError("Selection has changed. Analyze the plane again.")
    candidates = {c.index: c for c in analyze_sections(mesh, plane)}
    if any(i not in candidates for i in selected_ids):
        raise GeometryError("A selected section does not touch the cut surface.")

    if face_clearance > 0:
        if set(selected_ids) != set(candidates):
            raise GeometryError(
                "Face gap requires all cut sections to be selected. "
                "Set face gap to zero for selective detachment."
            )
        # When every cut component detaches, the global two-plane offset
        # removes a uniform printable face gap without affecting uncut pieces.
        negative, positive = _split_with_gap(mesh, plane, face_clearance)
        components = _ordered_components(positive)
        if len(components) != len(candidates):
            raise GeometryError("Face gap changed component count. Reduce gap and analyze again.")

    retain = negative
    detached = []
    for index, part in enumerate(components):
        if index in selected_ids:
            detached.append((index, part))
        else:
            retain = retain + part

    # Assign each manually placed key to exactly one selected cut cap.
    assigned: dict[int, list[KeySpec]] = {index: [] for index in selected_ids}
    for key in keys:
        matched = [index for index in selected_ids
                   if _inside_cap(candidates[index].cap, np.array([key.u, key.v]))]
        if len(matched) != 1:
            raise GeometryError(
                f"Key at ({key.u:.2f}, {key.v:.2f}) must belong to exactly "
                "one selected cut section."
            )
        assigned[matched[0]].append(key)

    result_parts = []
    origin, normal, _, _ = frame(plane)
    cap_plane = CutPlane(tuple(origin + normal * face_clearance / 2), tuple(normal))
    for index, part in detached:
        own_keys = assigned[index]
        if own_keys:
            cap = _cap_triangles(part, cap_plane)
            _check_placements(own_keys, cap)
            for key in own_keys:
                retain = retain + _key_solid(key, plane, False, face_clearance)
                part = part - _key_solid(key, plane, True, face_clearance)
                if part.is_empty():
                    raise GeometryError("A socket consumed its selected part.")
        result_parts.append(_as_trimesh(part))
    if not result_parts:
        raise GeometryError("No detachable output was generated.")
    return CutResult(
        peg_side=_as_trimesh(retain),
        socket_side=result_parts[0],
        additional_parts=tuple(result_parts[1:]),
    )
