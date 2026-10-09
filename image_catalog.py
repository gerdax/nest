"""The publishable image catalog shared by local serving and static staging."""
import json
from pathlib import Path


IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"})


def image_files(root: Path) -> list[Path]:
    image_root = (root / "assets" / "img").resolve()
    return sorted(
        source for source in image_root.rglob("*")
        if source.is_file() and not source.is_symlink()
        and source.suffix.lower() in IMAGE_SUFFIXES
        and source.resolve().is_relative_to(image_root)
    )


def image_manifest(root: Path) -> dict:
    image_root = (root / "assets" / "img").resolve()
    return {"version": 1, "images": [
        {"filename": source.name, "path": source.relative_to(image_root).as_posix()}
        for source in image_files(root)
    ]}


def image_manifest_bytes(root: Path) -> bytes:
    return (json.dumps(image_manifest(root), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
