#!/usr/bin/env python3
"""Build the Chrome Web Store upload zip for Mealshark."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"

PACKAGE_FILES = (
    "manifest.json",
    "src/content.css",
    "src/content.js",
    "src/page-hook.js",
    "src/popup.css",
    "src/popup.html",
    "src/popup.js",
    "assets/icons/icon-16.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
)


def read_manifest() -> dict:
    with (ROOT / "manifest.json").open(encoding="utf-8") as manifest_file:
        return json.load(manifest_file)


def validate_package_files() -> None:
    missing_files = [path for path in PACKAGE_FILES if not (ROOT / path).is_file()]

    if missing_files:
        print("Missing package files:", file=sys.stderr)
        for path in missing_files:
            print(f"  {path}", file=sys.stderr)
        raise SystemExit(1)


def validate_manifest_description(manifest: dict) -> None:
    description = manifest.get("description", "")

    if len(description) > 132:
        print(
            f"manifest.json description is {len(description)} characters; Chrome allows at most 132.",
            file=sys.stderr,
        )
        raise SystemExit(1)


def build_zip() -> Path:
    manifest = read_manifest()
    validate_manifest_description(manifest)
    validate_package_files()

    version = manifest.get("version")
    if not version:
        print("manifest.json is missing version.", file=sys.stderr)
        raise SystemExit(1)

    DIST_DIR.mkdir(exist_ok=True)
    zip_path = DIST_DIR / f"mealshark-{version}.zip"
    zip_path.unlink(missing_ok=True)

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as archive:
        for relative_path in PACKAGE_FILES:
            archive.write(ROOT / relative_path, relative_path)

    return zip_path


def main() -> None:
    zip_path = build_zip()
    size = zip_path.stat().st_size

    print(f"Built {zip_path.relative_to(ROOT)} ({size:,} bytes)")
    print("Included files:")
    with ZipFile(zip_path) as archive:
        for name in archive.namelist():
            print(f"  {name}")


if __name__ == "__main__":
    main()
