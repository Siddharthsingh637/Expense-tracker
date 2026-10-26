from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_DIR = Path(__file__).resolve().parents[3]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_DIR / ".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://expense_tracker:expense_tracker@localhost:5432/expense_tracker"
    database_url_unpooled: str | None = None
    migration_database_url: str | None = None
    test_database_url: str = "postgresql+psycopg://paisa:paisa@127.0.0.1:54329/paisa_test"
    jwt_secret: str = Field(default="", repr=False)
    environment: str = "development"
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081"
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=365)
    ai_provider: str = "muse"
    model_api_key: str = Field(default="", repr=False)
    model_api_base_url: str = "https://api.meta.ai"
    anthropic_api_key: str = Field(default="", repr=False)
    ai_model_fast: str = "muse-spark-1.3"
    ai_model_smart: str = "muse-spark-1.3"
    ai_timeout_seconds: int = Field(default=30, ge=1, le=180)
    ai_requests_per_minute: int = Field(default=10, ge=1, le=1000)
    ai_requests_per_day: int = Field(default=200, ge=1, le=100000)
    attachment_dir: str = "./var/attachments"
    attachment_quota_bytes: int = Field(default=104857600, ge=5242880)
    sync_tombstone_days: int = Field(default=90, ge=1, le=3650)


settings = Settings()

if not settings.jwt_secret:
    settings.jwt_secret = "local-only-initialize-env-before-running-paisa-api"

def _sqlalchemy_url(url: str) -> str:
    """Use the installed psycopg v3 driver for standard Postgres URLs."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


DATABASE_URL = _sqlalchemy_url(settings.database_url)
MIGRATION_DATABASE_URL = _sqlalchemy_url(
    settings.migration_database_url or settings.database_url_unpooled or settings.database_url
)
TEST_DATABASE_URL = settings.test_database_url
JWT_SECRET = settings.jwt_secret
ACCESS_TOKEN_MINUTES = settings.access_token_minutes
REFRESH_TOKEN_DAYS = settings.refresh_token_days
MAX_SYNC_CHANGES = 500
MAX_SYNC_PULL_LIMIT = 1000
MAX_SYNC_REQUEST_BYTES = 1_048_576
AI_PROVIDER = settings.ai_provider
MODEL_API_KEY = settings.model_api_key
MODEL_API_BASE_URL = settings.model_api_base_url.rstrip("/")
ANTHROPIC_API_KEY = settings.anthropic_api_key
AI_MODEL_FAST = settings.ai_model_fast
AI_MODEL_SMART = settings.ai_model_smart
AI_TIMEOUT_SECONDS = settings.ai_timeout_seconds
AI_REQUESTS_PER_MINUTE = settings.ai_requests_per_minute
AI_REQUESTS_PER_DAY = settings.ai_requests_per_day
ATTACHMENT_DIR = settings.attachment_dir
ATTACHMENT_QUOTA_BYTES = settings.attachment_quota_bytes
SYNC_TOMBSTONE_DAYS = settings.sync_tombstone_days
CORS_ORIGINS = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
