"""Apply Postgres schema and create Qdrant collections. Idempotent.

Run from the project root:
    python -m ingest.scripts.init_infra
Or from ingest/:
    python scripts/init_infra.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running as a script directly from ingest/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import apply_schema  # noqa: E402
from vectors import ensure_collections  # noqa: E402

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"


def main() -> int:
    print(f"Applying schema from {SCHEMA} ...")
    apply_schema(SCHEMA)
    print("  Postgres schema OK")

    print("Ensuring Qdrant collections ...")
    status = ensure_collections()
    for name, state in status.items():
        print(f"  {name}: {state}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
