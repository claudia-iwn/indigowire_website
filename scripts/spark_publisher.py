"""Spark publisher: commit and push new image + sidecar pairs (spec section 7).

STUB (M3). Not implemented yet; running it only prints this message. The real
service will watch src/content/spark/, pick pairs from `git status --porcelain`,
validate them with validate_spark.py, `git add` only valid pairs by explicit path,
then commit and push with the repo's deploy key.

Usage (planned):
    uv run scripts/spark_publisher.py --once [--dry-run]
"""

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--once", action="store_true", help="run one publish pass and exit")
    parser.add_argument("--dry-run", action="store_true", help="show what would be committed")
    parser.parse_args(argv)
    print("spark_publisher.py is a stub until milestone M3; nothing was published.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
