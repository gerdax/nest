#!/usr/bin/env python3
"""Stage the small static site needed to publish the nest playground."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
RUNTIME_FILES = (
    "index.html",
    "playground.css",
    "playground.js",
    "engine/CardDeck.js",
    "engine/PointerInput.js",
    "engine/geometry.js",
    "engine/motion.js",
    "engine/lid.js",
    "engine/MovementHistory.js",
    "engine/renderer.js",
    "engine/card-deck.css",
    "demo/ScenarioController.js",
)
IMPORT_RE = re.compile(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]")
URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
ASSET_RE = re.compile(r"\b([\w.-]+\.(?:png|ttf))")


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

    for relative in RUNTIME_FILES:
        copy_repo_file(relative)

    # The CSS and demo refer to these files through repository-relative URLs.
    text_sources = [ROOT / name for name in RUNTIME_FILES if name.endswith((".css", ".js", ".html"))]
    assets: set[Path] = set()
    for source in text_sources:
        content = source.read_text(encoding="utf-8")
        for match in ASSET_RE.finditer(content):
            filename = match.group(1)
            folder = "fonts" if filename.endswith(".ttf") else "img"
            asset = ROOT / "assets" / folder / filename
            if not asset.is_file():
                fail(f"referenced demo asset is missing: {asset.relative_to(ROOT)}")
            assets.add(asset)
    for source in sorted(assets):
        relative = source.relative_to(ROOT)
        copy_repo_file(relative.as_posix())

    (output / ".nojekyll").write_text("", encoding="utf-8")
    # Confirm every local static URL and module dependency resolves in the staged tree.
    missing: list[str] = []
    for staged in sorted(copied):
        source = ROOT / staged.relative_to(output)
        if source.suffix not in {".html", ".css", ".js"}:
            continue
        content = staged.read_text(encoding="utf-8")
        refs = [m.group(1) for m in IMPORT_RE.finditer(content)]
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
    print(f"Verified local HTML, module, CSS, image, and font references; copied {len(assets)} referenced assets.")


if __name__ == "__main__":
    main()
