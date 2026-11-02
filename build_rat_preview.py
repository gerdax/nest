#!/usr/bin/env python3
"""Stage an isolated static player of the saved rat encounter (no publishing)."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlsplit

from build_pages import IMPORT_RE, URL_RE
from image_catalog import image_manifest_bytes

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "saved-projects/rat-alternative.json"
FACTORY = "const exampleFactory=exampleName==='rat'?createAlternativeRatCombatProject:exampleName==='rat-classic'?createRatCombatProject:null;"
SESSION = "const session=exampleFactory?null:await openProjectSession({readonly:true});"
# Match complete literal image paths, including JPEG/WebP; never expand template URLs.
IMAGE_RE = re.compile(r"assets/img/[^\s\"'`<>();]+?\.(?:png|jpe?g|webp|gif|svg)(?:[?#][^\s\"'`<>();]*)?", re.I)
BARE_IMAGE_RE = re.compile(r"[\"'`]([\w%.-]+\.(?:png|jpe?g|webp|gif|svg))[\"'`]", re.I)


def fail(message: str) -> None:
    raise SystemExit(f"build_rat_preview.py: {message}")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new or empty directory outside the source tree")
    output = parser.parse_args().output.expanduser().resolve()
    if output.is_relative_to(ROOT) or ROOT.is_relative_to(output):
        fail(f"refusing output inside or above the source tree: {output}")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        fail(f"output must be a new or empty directory: {output}")

    raw = SOURCE.read_bytes()
    snapshot = json.loads(raw)
    source_player = (ROOT / "studio/player.js").read_text(encoding="utf-8")
    if source_player.count(FACTORY) != 1 or source_player.count(SESSION) != 1:
        fail("player startup changed; review snapshot injection before staging")
    subprocess.run([sys.executable, str(ROOT / "build_pages.py"), str(output)], check=True)
    for metadata in output.rglob('.DS_Store'):
        metadata.unlink()

    (output / "rat-alternative.json").write_bytes(raw)
    # A standalone module avoids fetch/localStorage startup and preserves JSON semantics,
    # including arbitrary strings and keys such as __proto__, without HTML embedding.
    module = "export default JSON.parse(" + json.dumps(raw.decode("utf-8"), ensure_ascii=True) + ");\n"
    (output / "project/rat-alternative-snapshot.js").write_text(module, encoding="utf-8")
    patched = "import snapshot from '../project/rat-alternative-snapshot.js';\n" + source_player.replace(
        FACTORY, "const exampleFactory=()=>structuredClone(snapshot);"
    )
    (output / "studio/player.js").write_text(patched, encoding="utf-8")
    (output / "index.html").write_text(
        '<!doctype html>\n<html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta http-equiv="refresh" content="0;url=./player.html">'
        '<title>Rat encounter</title><a href="./player.html">Play rat encounter</a></html>\n',
        encoding="utf-8",
    )

    # Keep every font and the complete independent dice distribution.
    for font in sorted((ROOT / "assets/fonts").rglob("*")):
        if font.is_file():
            target = output / font.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(font, target)

    texts = {p: p.read_text(encoding="utf-8") for p in output.rglob("*")
             if p.is_file() and p.suffix in {".html", ".css", ".js"}}
    keep = set()

    def retain(ref: str) -> None:
        path = output / unquote(urlsplit(ref).path)
        path = path.resolve()
        if not path.is_relative_to(output / "assets/img") or not path.is_file():
            fail(f"referenced artwork is missing or unsafe: {ref}")
        keep.add(path)

    for value in strings(snapshot):
        # Authored image paths may include spaces or parentheses. Match the
        # complete value before scanning prose/CSS-style references below.
        if value.startswith(("./assets/img/", "assets/img/")) and Path(unquote(urlsplit(value).path)).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}:
            retain(value.removeprefix("./"))
        for match in IMAGE_RE.finditer(value):
            retain(match.group())
    for text in texts.values():
        for match in IMAGE_RE.finditer(text):
            if "${" not in match.group():
                retain(match.group())
        for match in BARE_IMAGE_RE.finditer(text):
            retain("assets/img/" + match.group(1))
    image_root = output / "assets/img"
    for image in image_root.rglob("*"):
        if image.is_file() and image.resolve() not in keep:
            image.unlink()
    for directory in sorted(image_root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    (output / "assets/image-manifest.json").write_bytes(image_manifest_bytes(output))

    missing = []
    for path, text in texts.items():
        if "vendor" in path.relative_to(output).parts:
            continue  # Dice vendor distribution is copied intact by build_pages.py.
        refs = [m.group(1) for m in IMPORT_RE.finditer(text)]
        if path.suffix == ".css":
            refs.extend(m.group(2) for m in URL_RE.finditer(text))
        if path.suffix == ".html":
            refs.extend(re.findall(r"(?:src|href)=[\"']([^\"']+)[\"']", text))
        for ref in refs:
            parsed = urlsplit(ref)
            if parsed.scheme or parsed.netloc or not parsed.path or "${" in ref:
                continue
            target = ((output if parsed.path.startswith("/") else path.parent) / unquote(parsed.path.lstrip("/"))).resolve()
            if target.is_dir():
                target /= "index.html"
            if not target.is_relative_to(output) or not target.is_file():
                missing.append(f"{path.relative_to(output)} -> {ref}")
    if missing:
        fail("staged references are missing:\n  " + "\n  ".join(missing))
    rat = next((item for item in snapshot.get("library", []) if item.get("id") == "rat"), {})
    provenance = {"source": SOURCE.relative_to(ROOT).as_posix(),
                  "sha256": hashlib.sha256(raw).hexdigest(), "name": snapshot.get("name"),
                  "ratHP": rat.get("health"), "artworkFiles": len(keep)}
    (output / "build-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files = [p for p in output.rglob("*") if p.is_file()]
    print(f"Rat preview: {len(files)} files ({sum(p.stat().st_size for p in files):,} bytes), {len(keep)} images in {output}")
    print(f"Snapshot SHA256: {provenance['sha256']}; rat HP: {provenance['ratHP']}")
    print("Verified snapshot artwork and local HTML, CSS/font and module references after pruning.")


if __name__ == "__main__":
    main()
