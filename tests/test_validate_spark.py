"""Tests for scripts/validate_spark.py against the real samples and a broken fixture."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "validate_spark.py"
SAMPLES = ROOT / "src" / "content" / "spark"
BROKEN = (
    ROOT / "tests" / "fixtures" / "spark-broken" / "2026" / "10" / "2026-10-26-0800-broken-entry.md"
)


def run(*paths: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, paths)], capture_output=True, text=True, check=False
    )


def test_sample_entries_are_valid():
    sidecars = sorted(SAMPLES.rglob("*.md"))
    assert len(sidecars) >= 3
    result = run(SAMPLES)
    assert result.returncode == 0, result.stdout


def test_accepts_webp_path():
    webp = next(SAMPLES.rglob("*.webp"))
    assert run(webp).returncode == 0


def test_broken_fixture_reports_every_problem():
    result = run(BROKEN)
    assert result.returncode == 1
    out = result.stdout
    assert "alt: required field is missing" in out
    assert "category: 'feelings'" in out
    assert "tags: 'not-a-real-tag' is not in src/content/tags.yaml" in out
    assert "date: needs a UTC offset" in out
    assert "image: must be ./2026-10-26-0800-broken-entry.webp" in out
    # One line per problem.
    assert len(out.strip().splitlines()) == 5


@pytest.mark.parametrize("field", ["title", "date", "category", "image", "alt"])
def test_missing_required_field_fails(tmp_path, field):
    src = next(SAMPLES.rglob("*.md"))
    dst_dir = tmp_path / "2026" / "10"
    dst_dir.mkdir(parents=True)
    shutil.copy(src.with_suffix(".webp"), dst_dir)
    lines = src.read_text(encoding="utf-8").splitlines()
    (dst_dir / src.name).write_text(
        "\n".join(line for line in lines if not line.startswith(f"{field}:")) + "\n",
        encoding="utf-8",
    )
    result = run(dst_dir / src.name)
    assert result.returncode == 1
    assert f"{field}: required field is missing" in result.stdout


def test_non_webp_image_fails(tmp_path):
    from PIL import Image

    src = next(SAMPLES.rglob("*.md"))
    dst_dir = tmp_path / "2026" / "10"
    dst_dir.mkdir(parents=True)
    shutil.copy(src, dst_dir)
    Image.new("RGB", (8, 8)).save(dst_dir / f"{src.stem}.webp", format="PNG")
    result = run(dst_dir / src.name)
    assert result.returncode == 1
    assert "image: must be WebP, got PNG" in result.stdout


@pytest.mark.parametrize(
    ("date", "ok"),
    [
        ("2026-10-25T14:05:00-07:00", True),
        ("2026-10-25T21:05:00Z", True),
        ("'2026-10-25T14:05:00+02:00'", True),
        ("2026-10-25T14:05:00", False),
        ("2026-10-25 14:05:00-07:00", False),
        ("2026-10-25", False),
    ],
)
def test_date_format_matches_build_rule(tmp_path, date, ok):
    src = next(SAMPLES.rglob("*.md"))
    dst_dir = tmp_path / "2026" / "10"
    dst_dir.mkdir(parents=True)
    shutil.copy(src.with_suffix(".webp"), dst_dir)
    text = "\n".join(
        f"date: {date}" if line.startswith("date:") else line
        for line in src.read_text(encoding="utf-8").splitlines()
    )
    (dst_dir / src.name).write_text(text + "\n", encoding="utf-8")
    result = run(dst_dir / src.name)
    assert (result.returncode == 0) is ok, result.stdout
