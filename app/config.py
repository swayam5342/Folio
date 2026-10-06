from pydantic_settings import BaseSettings, SettingsConfigDict

JWT_SECRET_PLACEHOLDER = "change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://raguser:ragpass@localhost:5432/notebooklm"

    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIM: int = 384

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # Auth
    JWT_SECRET: str = JWT_SECRET_PLACEHOLDER
    JWT_EXPIRE_DAYS: int = 7
    COOKIE_SECURE: bool = False  # set true when served over HTTPS

    # Uploads
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 50

    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    TOP_K: int = 6
    HISTORY_MESSAGES: int = 6

    def validate_secrets(self) -> None:
        """Called at startup so a missing secret fails loudly instead of silently signing tokens with a known key."""
        if not self.JWT_SECRET or self.JWT_SECRET == JWT_SECRET_PLACEHOLDER:
            raise RuntimeError(
                "JWT_SECRET is not set. Generate one with "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` and put it in .env"
            )


settings = Settings()
