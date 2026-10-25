"""Validate Spark image + sidecar pairs (spec sections 4 and 7).

Usage:
    uv run scripts/validate_spark.py PATH [PATH ...]

Each PATH may be a sidecar (.md), an image (.webp, its sidecar is found beside it)
or a directory (every .md below it is checked). Exit code 0 means every pair is
valid; otherwise one line per problem is printed and the exit code is 1.

The Astro schema in src/content.config.js enforces the same rules at build time
(R9). Keep the two in sync.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TAGS = REPO_ROOT / "src" / "content" / "tags.yaml"

CATEGORIES = {"working-on", "saw-this", "mood"}
REQUIRED = ("title", "date", "category", "image", "alt")
KNOWN = set(REQUIRED) | {"caption", "tags", "model", "draft", "prompt"}
NAME_RE = re.compile(r"^(\d{4})-(\d{2})-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$")
KEBAB_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_WITH_OFFSET_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$"
)
DATE_NO_OFFSET_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$")
MAX_EDGE_PX = 2048
MAX_BYTES = 25 * 1024 * 1024  # Workers per-file limit
TARGET_BYTES = int(1.5 * 1024 * 1024)  # glue-code target; over it is a warning only


def load_tags(path: Path) -> set[str]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return set(data)


def read_frontmatter(md: Path) -> dict:
    """Return the YAML frontmatter of a Markdown file; raise ValueError if absent."""
    text = md.read_text(encoding="utf-8")
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not match:
        raise ValueError("no YAML frontmatter (expected a leading --- block)")
    data = yaml.safe_load(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("frontmatter is not a mapping")
    return data


def check_date(text: str) -> str | None:
    """Check the raw `date:` line, before YAML turns it into a datetime.

    Return an error message, or None if it is ISO 8601 with a UTC offset or Z.
    src/content.config.js applies the same patterns at build time.
    """
    line = re.search(r"^date:[ \t]*['\"]?([^'\"\s#]*)", text, re.M)
    if not line:
        return None  # a missing date is reported as a missing required field
    if DATE_WITH_OFFSET_RE.match(line.group(1)):
        return None
    if DATE_NO_OFFSET_RE.match(line.group(1)):
        return "needs a UTC offset, e.g. 2026-10-25T14:05:00-07:00"
    return f"not an ISO 8601 datetime: {line.group(1)!r}"


def check_image(path: Path) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for the image file."""
    errors: list[str] = []
    warnings: list[str] = []
    if not path.is_file():
        return [f"image: file not found: {path.name}"], warnings
    size = path.stat().st_size
    if size > MAX_BYTES:
        errors.append(f"image: {size} bytes exceeds the 25 MiB limit")
    elif size > TARGET_BYTES:
        warnings.append(f"image: {size / 1024 / 1024:.1f} MB is over the 1.5 MB target")
    try:
        with Image.open(path) as im:
            if im.format != "WEBP":
                errors.append(f"image: must be WebP, got {im.format}")
            if max(im.size) > MAX_EDGE_PX:
                errors.append(f"image: longest edge {max(im.size)} px exceeds {MAX_EDGE_PX} px")
    except OSError as exc:
        errors.append(f"image: unreadable ({exc})")
    return errors, warnings


def validate(md: Path, allowed_tags: set[str]) -> tuple[list[str], list[str]]:
    """Validate one sidecar and its image. Return (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    name = md.stem
    name_match = NAME_RE.match(name)
    if not name_match:
        errors.append(f"filename: {name!r} must look like YYYY-MM-DD-HHMM-kebab-slug")
    elif (md.parent.parent.name, md.parent.name) != name_match.groups():
        errors.append(f"location: expected spark/{name[:4]}/{name[5:7]}/, found {md.parent}")

    try:
        data = read_frontmatter(md)
    except (ValueError, yaml.YAMLError) as exc:
        return [f"frontmatter: {exc}"], warnings

    for field in REQUIRED:
        if data.get(field) in (None, ""):
            errors.append(f"{field}: required field is missing")

    for field in sorted(set(data) - KNOWN):
        warnings.append(f"{field}: unknown field (ignored by the site)")

    title = data.get("title")
    if title is not None and (not isinstance(title, str) or len(title) > 80):
        errors.append("title: must be a string of at most 80 characters")

    if data.get("date") is not None and (msg := check_date(md.read_text(encoding="utf-8"))):
        errors.append(f"date: {msg}")

    category = data.get("category")
    if category is not None and category not in CATEGORIES:
        errors.append(f"category: {category!r} is not one of {', '.join(sorted(CATEGORIES))}")

    alt = data.get("alt")
    if alt is not None and not isinstance(alt, str):
        errors.append("alt: must be a string")

    caption = data.get("caption")
    if caption is not None and (not isinstance(caption, str) or len(caption) > 280):
        errors.append("caption: must be a string of at most 280 characters")

    tags = data.get("tags")
    if tags is not None:
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            errors.append("tags: must be a list of strings")
        else:
            for tag in tags:
                if not KEBAB_RE.match(tag):
                    errors.append(f"tags: {tag!r} is not lowercase kebab-case")
                elif tag not in allowed_tags:
                    errors.append(f"tags: {tag!r} is not in src/content/tags.yaml")

    for field in ("model", "prompt"):
        if data.get(field) is not None and not isinstance(data[field], str):
            errors.append(f"{field}: must be a string")
    if data.get("draft") is not None and not isinstance(data["draft"], bool):
        errors.append("draft: must be true or false")

    image = data.get("image")
    if isinstance(image, str) and image:
        if Path(image).name != f"{name}.webp":
            errors.append(f"image: must be ./{name}.webp (same basename as the sidecar)")
        else:
            img_errors, img_warnings = check_image(md.parent / image)
            errors += img_errors
            warnings += img_warnings
    elif image is not None:
        errors.append("image: must be a relative path string")

    return errors, warnings


def collect(paths: list[Path]) -> list[Path]:
    """Expand CLI paths into a sorted list of sidecar files."""
    sidecars: set[Path] = set()
    for path in paths:
        if path.is_dir():
            sidecars.update(p for p in path.rglob("*.md") if not p.name.startswith("."))
        elif path.suffix == ".webp":
            sidecars.add(path.with_suffix(".md"))
        else:
            sidecars.add(path)
    return sorted(sidecars)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Spark image + sidecar pairs.")
    parser.add_argument("paths", nargs="+", type=Path, help=".md, .webp or directory")
    parser.add_argument("--tags", type=Path, default=DEFAULT_TAGS, help="path to tags.yaml")
    args = parser.parse_args(argv)

    allowed_tags = load_tags(args.tags)
    sidecars = collect(args.paths)
    if not sidecars:
        print("no sidecar files found", file=sys.stderr)
        return 1

    failed = False
    for md in sidecars:
        if not md.is_file():
            print(f"{md}: sidecar not found")
            failed = True
            continue
        errors, warnings = validate(md, allowed_tags)
        for warning in warnings:
            print(f"{md}: warning: {warning}", file=sys.stderr)
        for error in errors:
            print(f"{md}: {error}")
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
