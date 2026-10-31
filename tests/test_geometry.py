import numpy as np
import pytest
import trimesh

from keymaster.geometry import (
    CutPlane, GeometryError, KeySpec, cut_and_key,
    export_stl, frame, suggest_key, validate_mesh,
)


@pytest.fixture
def cube():
    return trimesh.creation.box(extents=[20, 20, 20])


@pytest.fixture
def plane():
    return CutPlane((0, 0, 0), (0, 0, 1))


def test_frame(plane):
    _, normal, u, v = frame(plane)
    assert np.allclose(normal, (0, 0, 1))
    assert np.allclose(u, (1, 0, 0))
    assert np.allclose(v, (0, 1, 0))


def test_cut_without_keys(cube, plane):
    halves = cut_and_key(cube, plane)
    assert halves.peg_side.is_watertight
    assert halves.socket_side.is_watertight
    assert np.isclose(halves.peg_side.volume + halves.socket_side.volume, cube.volume, rtol=1e-4)
    assert halves.peg_side.centroid[2] < 0
    assert halves.socket_side.centroid[2] > 0


@pytest.mark.parametrize("shape", ["round", "square"])
def test_capped_pieces_with_key(cube, plane, shape):
    result = cut_and_key(cube, plane, [KeySpec(diameter=4, depth=4, shape=shape)])
    validate_mesh(result.peg_side)
    validate_mesh(result.socket_side)
    assert result.peg_side.bounds[1, 2] >= 3.9


def test_reject_invalid_placement(cube, plane):
    with pytest.raises(GeometryError, match="outside|edge"):
        cut_and_key(cube, plane, [KeySpec(u=9, v=9)])


def test_reject_overlapping_keys(cube, plane):
    with pytest.raises(GeometryError, match="overlap"):
        cut_and_key(cube, plane, [KeySpec(), KeySpec(u=1)])


def test_reject_negative_clearance(cube, plane):
    with pytest.raises(GeometryError, match="Clearances"):
        cut_and_key(cube, plane, [KeySpec(radial_clearance=-0.1)])


def test_reject_plane_outside(cube):
    with pytest.raises(GeometryError, match="plane must pass"):
        cut_and_key(cube, CutPlane((0, 0, 30), (0, 0, 1)))


def test_reject_open_mesh(cube, plane):
    cube.update_faces(np.arange(len(cube.faces) - 1))
    with pytest.raises(GeometryError, match="closed"):
        cut_and_key(cube, plane)


def test_auto_place(cube, plane):
    key = suggest_key(cube, plane, KeySpec(diameter=3, depth=3))
    cut_and_key(cube, plane, [key])


def test_export_no_overwrite(cube, plane, tmp_path):
    parts = cut_and_key(cube, plane)
    a, b = export_stl(parts, tmp_path, "Test Model")
    assert a.exists() and b.exists()
    assert a.name == "Test_Model_A_peg.stl"
    with pytest.raises(GeometryError, match="already exists"):
        export_stl(parts, tmp_path, "Test Model")
