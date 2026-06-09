"""Vercel Blob upload via the public HTTP API.

Docs: https://vercel.com/docs/vercel-blob

PUT https://blob.vercel-storage.com/<pathname>?addRandomSuffix=false
  Authorization: Bearer $BLOB_READ_WRITE_TOKEN
  x-content-type: image/jpeg
  body: file bytes

Response JSON includes the public url field we want.
"""
from __future__ import annotations

from pathlib import Path

import httpx

from config import BLOB_READ_WRITE_TOKEN

BLOB_API = "https://blob.vercel-storage.com"
TIMEOUT = httpx.Timeout(30.0, read=60.0)


def upload_file(local_path: Path, remote_pathname: str, content_type: str = "image/jpeg") -> str:
    if not BLOB_READ_WRITE_TOKEN:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not set")

    url = f"{BLOB_API}/{remote_pathname}"
    headers = {
        "authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}",
        "x-content-type": content_type,
        "x-access": "public",
        "x-api-version": "7",
    }
    with local_path.open("rb") as f:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.put(url, headers=headers, content=f.read())
    if resp.status_code >= 400:
        raise RuntimeError(f"Blob upload failed: {resp.status_code} {resp.text}")
    data = resp.json()
    return data["url"]
