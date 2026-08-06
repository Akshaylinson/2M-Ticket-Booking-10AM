from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "2M Ticket Booking"
    environment: str = "development"
    secret_key: str = "change-me-in-production"
    access_token_minutes: int = 60
    database_url: str = "sqlite:///./ticket_booking.db"
    redis_url: str = "redis://localhost:6379/0"
    booking_hold_seconds: int = 120
    max_queue_depth: int = 100_000
    docs_enabled: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def sqlite_path(database_url: str) -> Path | None:
    if database_url.startswith("sqlite:///"):
        return Path(database_url.replace("sqlite:///", "", 1))
    return None

