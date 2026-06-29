"""Lightweight, dependency-free structured logging for the offline ingest.

Phase 1: one JSON line per event to stdout (flushed), with a per-run correlation
id, so an ingest run leaves a machine-readable trail next to the existing human
`_log` prints. No third-party deps, no OpenTelemetry, no eager env reads at
import — everything is fail-open and must never change ingest exit behavior.

Toggle with TELEMETRY (default on; "0"/"false"/"off" to mute). The same
`trace_events` shape the web layer uses can later ingest these (trace_id = run_id).
"""
from __future__ import annotations

import json
import secrets
import time
import traceback as _tb
from typing import Any, Optional

SERVICE = "acq-search-retrieval-ingest"

# Imported lazily by callers; never touch os.environ at import for a value that
# could be absent. The flag itself is read per-emit so toggling is live.
import os


def telemetry_enabled() -> bool:
    return os.getenv("TELEMETRY", "1").strip().lower() not in ("0", "false", "no", "off")


def new_run_id() -> str:
    return secrets.token_hex(16)


def _emit(event: str, level: str, fields: dict) -> None:
    if not telemetry_enabled():
        return
    try:
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "service": SERVICE,
            "event": event,
            "level": level,
        }
        if fields:
            rec.update(fields)
        print(json.dumps(rec, default=str), flush=True)
    except Exception:
        pass


def log_event(event: str, level: str = "info", **fields: Any) -> None:
    _emit(event, level, fields)


def log_error(stage: str, exc: BaseException, *, failing_dependency: Optional[str] = None, **fields: Any) -> None:
    try:
        payload = {
            "stage": stage,
            "error_class": type(exc).__name__,
            "error_message": str(exc)[:500],
            "error_traceback": "".join(
                _tb.format_exception(type(exc), exc, exc.__traceback__)
            )[:4000],
            "failing_dependency": failing_dependency,
        }
        if fields:
            payload.update(fields)
        _emit("error", "error", payload)
    except Exception:
        pass
