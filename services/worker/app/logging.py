"""Logging JSON terstruktur (structlog)."""

import logging
import sys

import structlog


def configure_logging(env: str = "development") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)
    renderer: structlog.typing.Processor = (
        structlog.dev.ConsoleRenderer() if env == "development" else structlog.processors.JSONRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
