"""Regression tests for selective sculpt cutting and connector clearances."""
import numpy as np
import pytest
import trimesh

from keymaster.geometry import (
    CutPlane, GeometryError, KeySpec, _as_manifold, _as_trimesh,
    cut_and_key, export_stl, suggest_keys, validate_mesh,
)
from keymaster.segmentation import analyze_sections, cut_selected_sections, place_keys_on_cap


@pytest.fixture
def trunk():
    """A single watertight solid with two branches connected below the cut."""
    base = trimesh.creation.box(extents=(44, 16, 10))
    base.apply_translation((0, 0, -7))
    left = trimesh.creation.box(extents=(10, 12, 23))
    left.apply_translation((-12, 0, 1))
    right = trimesh.creation.box(extents=(10, 12, 23))
    right.apply_translation((12, 0, 1))
    solid = _as_manifold(base) + _as_manifold(left) + _as_manifold(right)
    output = _as_trimesh(solid)
    validate_mesh(output)
    return output


@pytest.fixture
def plane():
    return CutPlane((0.0, 0.0, 0.0), (0.0, 0.0, 1.0))


def test_two_independent_cut_candidates(trunk, plane):
    candidates = analyze_sections(trunk, plane)
    assert len(candidates) == 2
    assert candidates[0].centroid[0] < candidates[1].centroid[0]
    assert all(c.volume > 0 and c.surface_area > 0 for c in candidates)
    assert all(c.mesh.is_watertight for c in candidates)


def test_selective_separation_keeps_other_branch_attached(trunk, plane):
    result = cut_selected_sections(trunk, plane, selected=[0])
    assert len(result.parts) == 2
    assert result.socket_side.centroid[0] < 0
    validate_mesh(result.peg_side)
    validate_mesh(result.socket_side)
    assert np.isclose(sum(p.volume for p in result.parts), trunk.volume, rtol=1e-4)
    # Retained body contains right branch above the plane.
    assert result.peg_side.bounds[1, 2] > 5


def test_select_two_independent_branches(trunk, plane):
    result = cut_selected_sections(trunk, plane, selected=[0, 1])
    assert len(result.parts) == 3
    for part in result.parts:
        validate_mesh(part)
    assert np.isclose(sum(p.volume for p in result.parts), trunk.volume, rtol=1e-4)


def test_selective_key_targets_selected_cap_only(trunk, plane):
    candidates = analyze_sections(trunk, plane)
    first = candidates[0]
    key = KeySpec(u=-12, v=0, diameter=3, depth=3, radial_clearance=.2)
    result = cut_selected_sections(trunk, plane, selected=[first.index], keys=[key])
    assert len(result.parts) == 2
    validate_mesh(result.socket_side)
    validate_mesh(result.peg_side)
    assert result.peg_side.bounds[1, 2] > 5  # right pillar stays attached
    assert result.socket_side.volume < first.volume


def test_keys_outside_selected_section_are_rejected(trunk, plane):
    with pytest.raises(GeometryError, match="exactly one selected"):
        cut_selected_sections(trunk, plane, selected=[0], keys=[
            KeySpec(u=12, v=0, diameter=3, depth=3)
        ])


def test_invalid_and_empty_selections_are_rejected(trunk, plane):
    with pytest.raises(GeometryError, match="at least one"):
        cut_selected_sections(trunk, plane, [])
    with pytest.raises(GeometryError, match="changed"):
        cut_selected_sections(trunk, plane, [12])


def test_nonzero_face_gap_requires_all_components(trunk, plane):
    with pytest.raises(GeometryError, match="all cut sections"):
        cut_selected_sections(trunk, plane, [0], face_clearance=.2)
    result = cut_selected_sections(trunk, plane, [0, 1], face_clearance=.15)
    assert len(result.parts) == 3
    for part in result.parts:
        validate_mesh(part)


def test_auto_keys_fit_selected_cap(trunk, plane):
    candidate = analyze_sections(trunk, plane)[0]
    keys = place_keys_on_cap(candidate.cap, KeySpec(diameter=2, depth=3), count=2)
    assert len(keys) == 2
    result = cut_selected_sections(trunk, plane, [candidate.index], keys=keys)
    assert all(p.is_watertight for p in result.parts)


def test_face_gap_removes_measured_material_and_maintains_watertight():
    cube = trimesh.creation.box(extents=(20, 20, 20))
    plane = CutPlane((0, 0, 0), (0, 0, 1))
    gap = .2
    result = cut_and_key(cube, plane, face_clearance=gap)
    assert np.isclose(sum(p.volume for p in result.parts), cube.volume - 400 * gap, atol=1e-2)
    assert all(p.is_watertight for p in result.parts)


@pytest.mark.parametrize("shape", ["round", "square", "tapered", "snap"])
def test_connector_shapes_generate_closed_sockets(shape):
    cube = trimesh.creation.box(extents=(30, 30, 30))
    plane = CutPlane((0, 0, 0), (0, 0, 1))
    result = cut_and_key(cube, plane, keys=[KeySpec(
        diameter=4, depth=4, shape=shape
    )], face_clearance=.1)
    assert all(p.is_watertight for p in result.parts)


def test_export_additional_detached_parts(trunk, plane, tmp_path):
    result = cut_selected_sections(trunk, plane, selected=[0, 1])
    paths = export_stl(result, tmp_path, "sculpture")
    assert len(paths) == 3
    assert all(path.exists() for path in paths)
    with pytest.raises(GeometryError, match="already exists"):
        export_stl(result, tmp_path, "sculpture")


def test_fused_positive_side_reports_only_one_component(plane):
    mesh = trimesh.creation.box(extents=(20, 20, 20))
    assert len(analyze_sections(mesh, plane)) == 1
