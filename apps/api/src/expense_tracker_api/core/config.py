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
    test_database_url: str = "postgresql+psycopg://paisa:paisa@127.0.0.1:54329/paisa_test"
    jwt_secret: str = Field(default="", repr=False)
    environment: str = "development"
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=365)
    ai_provider: str = "anthropic"
    anthropic_api_key: str = Field(default="", repr=False)
    ai_model_fast: str = "claude-haiku-5-5"
    ai_model_smart: str = "claude-sonnet-5-5"
    ai_timeout_seconds: int = Field(default=30, ge=1, le=180)
    ai_requests_per_minute: int = Field(default=10, ge=1, le=1000)
    ai_requests_per_day: int = Field(default=200, ge=1, le=100000)
    attachment_dir: str = "./var/attachments"
    attachment_quota_bytes: int = Field(default=104857600, ge=5242880)
    sync_tombstone_days: int = Field(default=90, ge=1, le=3650)


settings = Settings()

if not settings.jwt_secret:
    settings.jwt_secret = "local-only-initialize-env-before-running-paisa-api"

DATABASE_URL = settings.database_url
TEST_DATABASE_URL = settings.test_database_url
JWT_SECRET = settings.jwt_secret
ACCESS_TOKEN_MINUTES = settings.access_token_minutes
REFRESH_TOKEN_DAYS = settings.refresh_token_days
MAX_SYNC_CHANGES = 500
MAX_SYNC_PULL_LIMIT = 1000
MAX_SYNC_REQUEST_BYTES = 1_048_576
AI_PROVIDER = settings.ai_provider
ANTHROPIC_API_KEY = settings.anthropic_api_key
AI_MODEL_FAST = settings.ai_model_fast
AI_MODEL_SMART = settings.ai_model_smart
AI_TIMEOUT_SECONDS = settings.ai_timeout_seconds
AI_REQUESTS_PER_MINUTE = settings.ai_requests_per_minute
AI_REQUESTS_PER_DAY = settings.ai_requests_per_day
ATTACHMENT_DIR = settings.attachment_dir
ATTACHMENT_QUOTA_BYTES = settings.attachment_quota_bytes
SYNC_TOMBSTONE_DAYS = settings.sync_tombstone_days
