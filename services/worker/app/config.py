"""Konfigurasi worker dari environment (.env di root repo atau di services/worker)."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WORKER_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _WORKER_DIR.parent.parent

# Variabel opsional: boleh kosong, fitur terkait dinonaktifkan dan dilaporkan di /v1/health.
OPTIONAL_ENV = (
    "redis_url",
    "supabase_secret_key",
    "supabase_jwks_url",
    "fpl_team_id",
    "fpl_session_cookie",
    "player_photo_url_template",
    "team_badge_url_template",
    "api_football_key",
    "sportmonks_api_token",
    "odds_api_key",
    "gnews_api_key",
    "newsapi_key",
    "gemini_api_key",
    "vapid_public_key",
    "vapid_private_key",
    "telegram_bot_token",
    "telegram_chat_id",
    "sentry_dsn",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _WORKER_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Umum
    app_env: str = "development"
    app_timezone: str = "Asia/Jakarta"
    app_version: str = "0.1.0"
    database_url: str
    redis_url: str = ""
    sentry_dsn: str = ""

    # Supabase
    supabase_url: str
    supabase_secret_key: str = ""
    supabase_jwks_url: str = ""
    # Hanya untuk project yang masih memakai JWT secret HS256 (legacy). Kosongkan jika memakai JWKS.
    supabase_jwt_secret: str = ""

    # FPL
    fpl_base_url: str = "https://fantasy.premierleague.com/api/"
    fpl_team_id: str = ""
    fpl_mini_league_ids: str = ""
    fpl_h2h_league_ids: str = ""
    fpl_session_cookie: str = ""
    fpl_requests_per_second: float = 1.0
    player_photo_url_template: str = ""
    player_photo_fallback_template: str = ""
    team_badge_url_template: str = ""

    # Data provider
    api_football_key: str = ""
    api_football_base_url: str = "https://v3.football.api-sports.io"
    sportmonks_api_token: str = ""
    odds_api_key: str = ""
    gnews_api_key: str = ""
    newsapi_key: str = ""
    experimental_sources: bool = False

    # AI
    gemini_api_key: str = ""
    ai_tier: str = "free"
    gemini_model: str = "gemini-3.8-flash"
    gemini_fast_model: str = "gemini-3.8-flash"
    gemini_premium_model: str = "gemini-4-argon"
    ai_daily_budget_usd: float = 3.0

    # Notifikasi
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Deadline protocol
    deadline_checkpoints_min: str = "2880,1440,360,120,60,15"

    # Scheduler
    scheduler_enabled: bool = True
    leader_retry_seconds: int = 30

    @field_validator("database_url", "supabase_url")
    @classmethod
    def _required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("wajib diisi")
        return v.strip()

    @property
    def checkpoints_min(self) -> list[int]:
        return [int(x) for x in self.deadline_checkpoints_min.split(",") if x.strip()]

    @property
    def jwks_url(self) -> str:
        return self.supabase_jwks_url or f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    def missing_optional_env(self) -> list[str]:
        return [name.upper() for name in OPTIONAL_ENV if not getattr(self, name)]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
