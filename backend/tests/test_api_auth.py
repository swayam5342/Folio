"""Auth and ownership against a real database (skipped without one)."""
import httpx
import pytest

from app.main import app

pytestmark = pytest.mark.db

PASSWORD = "a-long-password"


async def _register(client: httpx.AsyncClient, username: str) -> None:
    response = await client.post("/api/auth/register", json={"username": username, "password": PASSWORD})
    assert response.status_code == 201, response.text


async def test_register_me_logout(client, unique_username):
    await _register(client, unique_username)
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == unique_username

    assert (await client.post("/api/auth/logout")).status_code == 204
    client.cookies.clear()
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_duplicate_username_and_wrong_password(client, unique_username):
    await _register(client, unique_username)
    dup = await client.post("/api/auth/register", json={"username": unique_username, "password": PASSWORD})
    assert dup.status_code == 409

    wrong = await client.post("/api/auth/login", json={"username": unique_username, "password": "nope-nope"})
    assert wrong.status_code == 401
    ok = await client.post("/api/auth/login", json={"username": unique_username.upper(), "password": PASSWORD})
    assert ok.status_code == 200


async def test_session_cookie_is_httponly(client, unique_username):
    response = await client.post("/api/auth/register", json={"username": unique_username, "password": PASSWORD})
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


async def test_other_users_notebooks_are_404(client, unique_username):
    await _register(client, unique_username)
    created = await client.post("/api/notebooks", json={"name": "Private"})
    assert created.status_code == 201
    notebook_id = created.json()["id"]

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        await _register(other, unique_username + "_b")
        assert (await other.get(f"/api/notebooks/{notebook_id}")).status_code == 404
        assert (await other.patch(f"/api/notebooks/{notebook_id}", json={"name": "x"})).status_code == 404
        assert (await other.delete(f"/api/notebooks/{notebook_id}")).status_code == 404
        assert (await other.get(f"/api/notebooks/{notebook_id}/documents")).status_code == 404
        assert (await other.get(f"/api/notebooks/{notebook_id}/messages")).status_code == 404
        assert all(n["id"] != notebook_id for n in (await other.get("/api/notebooks")).json())

    assert (await client.get(f"/api/notebooks/{notebook_id}")).status_code == 200


async def test_requests_without_session_are_401(client):
    assert (await client.get("/api/notebooks")).status_code == 401
