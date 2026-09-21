"""Persistent queue consumer for trusted LVGL builds.

Run with ``python -m app.tools.lvgl_builds.worker``. ``--once`` is intended for
health checks and scheduled drain jobs.
"""

from __future__ import annotations

import argparse
import os
import signal
import time
import uuid

from . import db, runner


POLL_SECONDS = float(os.environ.get("LVGL_BUILD_POLL_SECONDS", "1"))
_stopping = False


def _stop(_signum=None, _frame=None) -> None:
    global _stopping
    _stopping = True


def run_loop(once: bool = False) -> int:
    token = f"{os.getpid()}-{uuid.uuid4().hex}"
    processed = 0
    while not _stopping:
        db.recover_abandoned_builds()
        claimed = db.claim_next_build(token, runner.LEASE_TTL_SECONDS)
        if claimed is None:
            if once:
                break
            time.sleep(max(0.1, POLL_SECONDS))
            continue
        runner.run_build(claimed["ownerUserId"], claimed["id"], token)
        processed += 1
        if once:
            break
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="Consume queued LVGL UI builds")
    parser.add_argument("--once", action="store_true", help="process at most one queued build")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    run_loop(args.once)


if __name__ == "__main__":
    main()
