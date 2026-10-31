"""Fail on unreviewed root files, including in extracted source archives."""
from __future__ import annotations

import argparse
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent.parent
FILES = {"README.md", "AGENTS.md", "DEVELOPMENT_HANDOFF.md", "pyproject.toml", ".gitignore"}
DIRS = {".github", "src", "tests", "scripts", "docs"}
GENERATED = {".git", ".venv", ".pytest_cache", "__pycache__", "dist", "build", ".idea", ".vscode"}


def unexpected(root: Path) -> list[str]:
    bad = []
    for p in root.iterdir():
        if p.is_dir():
            if p.name not in DIRS and p.name not in GENERATED and not p.name.endswith(".egg-info"):
                bad.append(p.name + "/")
        elif p.name not in FILES and not p.name.endswith((".pyc", ".log")):
            bad.append(p.name)
    return sorted(bad)


def self_test():
    with tempfile.TemporaryDirectory() as location:
        root = Path(location)
        for name in FILES:
            (root / name).write_text("test", encoding="utf-8")
        assert not unexpected(root), "clean fixture should pass"
        (root / "unapproved-root-file.tmp").write_text("bad", encoding="utf-8")
        assert "unapproved-root-file.tmp" in unexpected(root), "negative control must fail"


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        self_test()
        print("Negative and positive controls passed.")
    issues = unexpected(ROOT)
    if issues:
        raise SystemExit("Unexpected root entries: " + ", ".join(issues))
    print("Root allowlist passed.")
