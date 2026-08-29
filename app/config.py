from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    TOKEN: str
    TMDB_API_KEY: str
    HISTORY_CLEAR_LIMIT: int = 10
    DB_PATH: str = "bot_data.db"
    LOG_LEVEL: str = "INFO"

    WATCH_LINK_TEMPLATE: str = ""

    TRUST_PROXY_HEADERS: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # type: ignore[call-arg]
