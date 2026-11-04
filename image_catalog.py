"""The publishable image catalog shared by local serving and static staging."""
from __future__ import annotations

import json
from pathlib import Path


IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"})


def _image_files(image_root: Path) -> list[Path]:
    if image_root.parent.is_symlink() or image_root.is_symlink():
        return []
    return sorted(
        source for source in image_root.rglob("*")
        if source.is_file() and not source.is_symlink()
        and source.suffix.lower() in IMAGE_SUFFIXES
        and not any(part.startswith(".") for part in source.relative_to(image_root).parts)
        and source.resolve().is_relative_to(image_root)
    )


def image_files(root: Path) -> list[Path]:
    return _image_files(root.resolve() / "assets" / "img")


def legacy_image_source(root: Path, relative: Path) -> Path | None:
    """Resolve an old assets/img URL after the image has moved."""
    if relative.suffix.lower() not in IMAGE_SUFFIXES or any(part.startswith(".") for part in relative.parts):
        return None
    images = root / "assets" / "img"
    archive = root / "assets" / "legacy-images"
    if len(relative.parts) == 1:
        moved = images / "card-art" / relative.name
    elif len(relative.parts) == 2 and relative.parts[0] == "ui":
        moved = images / "player-ui" / relative.name
    else:
        moved = None
    for source in (archive / relative, moved):
        try:
            if source is not None and source.resolve() == source and source.is_file():
                return source
        except (OSError, RuntimeError):
            continue
    return None


def legacy_image_aliases(root: Path) -> dict[Path, Path]:
    """Publish old URLs without exposing them as duplicate picker entries."""
    images = root / "assets" / "img"
    archive = root / "assets" / "legacy-images"
    old_paths = {source.relative_to(archive) for source in _image_files(archive)}
    for folder, old_folder in (("card-art", Path()), ("player-ui", Path("ui"))):
        old_paths.update(old_folder / source.name for source in _image_files(images / folder)
                         if source.parent == images / folder)
    aliases = {}
    for relative in sorted(old_paths):
        target = images / relative
        if not target.exists() and (source := legacy_image_source(root, relative)) is not None:
            aliases[target] = source
    return aliases


def image_manifest(root: Path) -> dict:
    image_root = root.resolve() / "assets" / "img"
    return {"version": 1, "images": [
        {"filename": source.name, "path": source.relative_to(image_root).as_posix()}
        for source in image_files(root)
    ]}


def image_manifest_bytes(root: Path) -> bytes:
    return (json.dumps(image_manifest(root), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
