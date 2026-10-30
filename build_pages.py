#!/usr/bin/env python3
"""Stage the project player, project studio and independent dice tool."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

from image_catalog import image_files, image_manifest_bytes


ROOT = Path(__file__).resolve().parent
RUNTIME_FILES = (
    "index.html",
    "errors.js",
    "player.html",
    "editor/preview.js",
    "editor/storage.js",
    "engine/CardDeck.js",
    "engine/CheckSurface.js",
    "engine/DeckInteractionMotion.js",
    "engine/DeckEntranceSequence.js",
    "engine/InventoryPickup.js",
    "engine/artworkColorize.js",
    "engine/artworkReload.js",
    "engine/cardBacks.js",
    "engine/PointerInput.js",
    "engine/geometry.js",
    "engine/motion.js",
    "engine/motionProfile.js",
    "engine/presentationReadiness.js",
    "engine/inventoryContext.js",
    "engine/MovementHistory.js",
    "engine/renderer.js",
    "engine/cssScale.js",
    "engine/cardSizing.js",
    "engine/card-deck.css",
    "demo/InventoryStrip.js",
    "demo/inventory.css",
)
# Preserve this developer tool in source; no active host imports it.
DEBUG_ONLY_FILES = frozenset({"studio/drawer-debug.js"})

IMPORT_RE = re.compile(r"\b(?:from\s+|import\s+)['\"]([^'\"\r\n]+)['\"]")
URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
ASSET_RE = re.compile(r"\b((?:assets/(?:img|fonts)/(?:[\w.-]+/)*)?[\w.-]+\.(?:png|ttf))")


def fail(message: str) -> None:
    raise SystemExit(f"build_pages.py: {message}")


def local_reference(value: str, base: Path) -> Path | None:
    value = value.strip()
    if not value or value.startswith(("data:", "http:", "https:", "#", "mailto:")):
        return None
    path = urlsplit(value).path
    return (base / path).resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new or empty directory to populate")
    parser.add_argument("--include-dice", action="store_true", help="compatibility flag; the dice tool is included by default")
    parser.add_argument("--include-editor", action="store_true", help="compatibility flag; the project studio is included by default")
    args = parser.parse_args()

    output = args.output.expanduser().resolve()
    if output == ROOT or output == ROOT.parent or output == Path(output.anchor):
        fail(f"refusing unsafe output directory: {output}")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        fail(f"output must be a new or empty directory: {output}")
    output.mkdir(parents=True, exist_ok=True)

    copied: set[Path] = set()

    def copy_repo_file(relative: str) -> Path:
        source = ROOT / relative
        if not source.is_file():
            fail(f"required runtime file is missing: {relative}")
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.add(target)
        return target

    runtime_files = list(RUNTIME_FILES)
    # Include project/studio runtime and retained v1 chapter/editor dependencies.
    # Motion tuning stays independent of the authoring interface.
    for folder in ("chapter", "player", "project", "studio"):
        runtime_files.extend(source.relative_to(ROOT).as_posix() for source in sorted((ROOT / folder).rglob("*")) if source.is_file() and source.suffix in {".js", ".css"})
    runtime_files.append("editor.html")
    runtime_files.extend(source.relative_to(ROOT).as_posix() for source in sorted((ROOT / "editor").rglob("*")) if source.is_file() and source.suffix in {".js", ".css"})
    runtime_files = [name for name in dict.fromkeys(runtime_files) if name not in DEBUG_ONLY_FILES]
    for relative in runtime_files:
        copy_repo_file(relative)

    # Runtime CSS and modules refer to these files through repository-relative URLs.
    text_sources = [ROOT / name for name in runtime_files if name.endswith((".css", ".js", ".html"))]
    assets: set[Path] = set()
    for source in text_sources:
        content = source.read_text(encoding="utf-8")
        for match in ASSET_RE.finditer(content):
            filename = match.group(1)
            folder = "fonts" if filename.endswith(".ttf") else "img"
            asset = ROOT / filename if filename.startswith("assets/") else ROOT / "assets" / folder / filename
            if not asset.is_file():
                fail(f"referenced runtime asset is missing: {asset.relative_to(ROOT)}")
            assets.add(asset)
    # Imported chapter JSON selects artwork dynamically even without the editor.
    # Publish usable images, keeping layered source documents out of the site.
    assets.update(image_files(ROOT))
    for source in sorted(assets):
        relative = source.relative_to(ROOT)
        copy_repo_file(relative.as_posix())

    (output / "assets" / "image-manifest.json").write_bytes(image_manifest_bytes(ROOT))

    for source in sorted((ROOT / "dice").rglob("*")):
        if source.is_file():
            copy_repo_file(source.relative_to(ROOT).as_posix())
    copy_repo_file("dice.html")

    (output / ".nojekyll").write_text("", encoding="utf-8")
    # Confirm every local static URL and module dependency resolves in the staged tree.
    missing: list[str] = []
    for staged in sorted(copied):
        source = ROOT / staged.relative_to(output)
        if "vendor" in staged.relative_to(output).parts:
            continue  # Third-party bundles use dynamic worker/asset URLs; copied intact.
        if source.suffix not in {".html", ".css", ".js"}:
            continue
        content = staged.read_text(encoding="utf-8")
        refs = [m.group(1) for m in IMPORT_RE.finditer(content)]
        if source.suffix == ".css":
            refs.extend(m.group(2) for m in URL_RE.finditer(content))
        if source.suffix == ".html":
            refs.extend(re.findall(r"(?:src|href)=[\"']([^\"']+)[\"']", content))
        for ref in refs:
            if "${" in ref:
                continue
            resolved = local_reference(ref, staged.parent)
            if resolved is None:
                continue
            if resolved.is_dir():
                resolved = resolved / "index.html"
            if not resolved.is_file():
                missing.append(f"{staged.relative_to(output)} -> {ref}")
    if missing:
        fail("staged references are missing:\n  " + "\n  ".join(missing))

    files = [p for p in output.rglob("*") if p.is_file()]
    total_size = sum(p.stat().st_size for p in files)
    print(f"Staged {len(files)} files ({total_size:,} bytes) in {output}")
    print(f"Verified local HTML, module and CSS references; copied {len(assets)} artwork/font assets.")


if __name__ == "__main__":
    main()
