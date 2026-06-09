"""Postgres helpers. Uses the unpooled connection for migrations and DDL."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg

from config import DATABASE_URL, DATABASE_URL_UNPOOLED


@contextmanager
def connect(unpooled: bool = False) -> Iterator[psycopg.Connection]:
    url = DATABASE_URL_UNPOOLED if unpooled else DATABASE_URL
    with psycopg.connect(url, autocommit=False) as conn:
        yield conn


def apply_schema(schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    with connect(unpooled=True) as conn, conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()
