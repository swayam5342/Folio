"""Shared test setup.

Settings are read when `app.config` is first imported, so the environment is
prepared here before any app module loads. Tests marked `db` talk to a real
Postgres (TEST_DATABASE_URL, migrations applied); they are skipped when it
isn't reachable so the unit tests still run anywhere.
"""
import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest

os.environ["JWT_SECRET"] = "test-secret-not-for-production-use-0123456789"
os.environ.setdefault("LOG_FORMAT", "text")
if test_db := os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = test_db

import httpx  # noqa: E402

from app.config import settings  # noqa: E402


def _database_reachable() -> bool:
    import asyncpg

    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

    async def probe() -> bool:
        try:
            conn = await asyncpg.connect(dsn, timeout=2)
        except (OSError, asyncpg.PostgresError, TimeoutError):
            return False
        try:
            return bool(await conn.fetchval("SELECT to_regclass('public.users') IS NOT NULL"))
        finally:
            await conn.close()

    return asyncio.run(probe())


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not any("db" in item.keywords for item in items) or _database_reachable():
        return
    skip = pytest.mark.skip(reason="no migrated Postgres reachable (set TEST_DATABASE_URL)")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client bound to the app in-process (lifespan not run: no model loading)."""
    from app.database import engine
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    # Each test runs on its own event loop; pooled asyncpg connections can't cross loops.
    await engine.dispose()


@pytest.fixture
def unique_username() -> str:
    return f"t_{uuid.uuid4().hex[:12]}"
