import json
import os
from pathlib import Path
from typing import Any

import pytest

# Settings wajib diisi; test unit tidak menyentuh DB sungguhan.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")

FIXTURES = Path(__file__).parent / "fixtures"


def load(rel: str) -> Any:
    return json.loads((FIXTURES / rel).read_text(encoding="utf-8"))


@pytest.fixture
def bootstrap() -> dict[str, Any]:
    return load("fpl/bootstrap-static.json")


@pytest.fixture
def fixtures_payload() -> list[dict[str, Any]]:
    return load("fpl/fixtures.json")


@pytest.fixture
def event_status() -> dict[str, Any]:
    return load("fpl/event-status.json")
