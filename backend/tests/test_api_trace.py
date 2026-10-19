"""Retrieval-trace endpoint and chat request validation."""
import uuid

import httpx
import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas import ChatRequest

PASSWORD = "a-long-password"

TRACE = {
    "question": "q",
    "standalone_query": "q",
    "variants": ["q2"],
    "hypothetical": None,
    "planner": {"llm_called": True, "cached": False, "error": None},
    "document_ids": None,
    "features": {"reranker": True},
    "candidates": [],
    "reranked": True,
    "confidence": "high",
    "top_score": 0.9,
    "abstained": False,
    "timings_ms": {"search": 12.5},
    "total_ms": 40.0,
    "tokens": {"planner": None, "answer": None},
}


def test_document_filter_must_not_be_empty():
    assert ChatRequest(question="q").document_ids is None
    ids = [uuid.uuid4()]
    assert ChatRequest(question="q", document_ids=ids).document_ids == ids
    # Empty is a deliberate "search no sources" scope; null means all sources.
    assert ChatRequest(question="q", document_ids=[]).document_ids == []
    with pytest.raises(ValidationError):
        ChatRequest(question="q", document_ids=["not-a-uuid"])


async def _store_message(notebook_id: str, trace: dict | None) -> uuid.UUID:
    from app.database import AsyncSessionLocal
    from app.models import Message, MessageRole

    async with AsyncSessionLocal() as db:
        message = Message(
            notebook_id=uuid.UUID(notebook_id), role=MessageRole.assistant, content="a", sources=[],
            confidence="high", trace=trace,
        )
        db.add(message)
        await db.commit()
        return message.id


@pytest.mark.db
async def test_trace_is_owner_only(client, unique_username):
    assert (await client.post("/api/auth/register", json={"username": unique_username, "password": PASSWORD})).status_code == 201
    notebook_id = (await client.post("/api/notebooks", json={"name": "Traced"})).json()["id"]
    with_trace = await _store_message(notebook_id, TRACE)
    without_trace = await _store_message(notebook_id, None)

    response = await client.get(f"/api/messages/{with_trace}/trace")
    assert response.status_code == 200, response.text
    assert response.json()["message_id"] == str(with_trace)
    assert response.json()["variants"] == ["q2"]
    assert (await client.get(f"/api/messages/{without_trace}/trace")).status_code == 404

    messages = (await client.get(f"/api/notebooks/{notebook_id}/messages")).json()
    assert messages[0]["confidence"] == "high" and messages[0]["abstained"] is False
    assert "trace" not in messages[0]

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        await other.post("/api/auth/register", json={"username": unique_username + "_b", "password": PASSWORD})
        assert (await other.get(f"/api/messages/{with_trace}/trace")).status_code == 404


@pytest.mark.db
async def test_reindex_unknown_document_is_404(client, unique_username):
    await client.post("/api/auth/register", json={"username": unique_username, "password": PASSWORD})
    assert (await client.post(f"/api/documents/{uuid.uuid4()}/reindex")).status_code == 404
