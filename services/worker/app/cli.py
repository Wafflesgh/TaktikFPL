"""Jalankan job manual tanpa server: `uv run python -m app.cli sync_bootstrap sync_fixtures`."""

import json
import sys

from app.config import get_settings
from app.jobs import (  # noqa: F401
    build_form,
    cleanup_retention,
    deadline_checkpoint,
    gw_finalize,
    poll_event_status,
    sync_bootstrap,
    sync_fixtures,
    sync_player_history,
)
from app.logging import configure_logging
from app.scheduler.runner import JOBS


def main(argv: list[str]) -> int:
    configure_logging(get_settings().app_env)
    if not argv:
        print(f"pemakaian: python -m app.cli <job>[:k=v,...] [<job> ...]\njob: {', '.join(sorted(JOBS))}")
        return 2
    for arg in argv:
        # format: nama_job atau nama_job:kunci=nilai,kunci=nilai (mis. gw_finalize:gw=7)
        name, _, raw = arg.partition(":")
        kwargs = dict(kv.split("=", 1) for kv in raw.split(",") if kv)
        if name not in JOBS:
            print(f"job tidak dikenal: {name}")
            return 2
        stats = JOBS[name](**kwargs)
        print(json.dumps({"job": name, "stats": stats}, default=str, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
