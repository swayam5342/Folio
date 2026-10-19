import json
import logging
import re

import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse, StreamingResponse
from starlette.routing import Route

from app.observability import JsonFormatter, RequestContextMiddleware, StageTimer, request_id_var


async def _plain(request):
    return PlainTextResponse(request_id_var.get() or "")


async def _stream(request):
    async def body():
        yield b"a"
        yield b"b"

    return StreamingResponse(body(), status_code=201)


@pytest.fixture
def http():
    app = RequestContextMiddleware(Starlette(routes=[Route("/plain", _plain), Route("/stream", _stream)]))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_generates_request_id_and_exposes_it_to_handlers(http):
    response = await http.get("/plain")
    request_id = response.headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", request_id)
    assert response.text == request_id


async def test_keeps_wellformed_incoming_id_and_replaces_bad_one(http):
    kept = await http.get("/plain", headers={"X-Request-ID": "abc-123.x_y"})
    assert kept.headers["x-request-id"] == "abc-123.x_y"

    replaced = await http.get("/plain", headers={"X-Request-ID": "has space" + "x" * 70})
    assert re.fullmatch(r"[0-9a-f]{32}", replaced.headers["x-request-id"])


async def test_logs_streamed_responses_with_status(http, caplog):
    with caplog.at_level(logging.INFO, logger="folio.request"):
        response = await http.get("/stream")
    assert response.text == "ab"
    record = next(r for r in caplog.records if r.name == "folio.request")
    assert record.status == 201
    assert record.path == "/stream"
    assert record.duration_ms >= 0


def test_json_formatter_includes_request_id_and_extra_fields():
    record = logging.LogRecord("folio", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    record.timings_ms = {"embed": 1.5}
    token = request_id_var.set("req-1")
    try:
        payload = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)
    assert payload["msg"] == "hello world"
    assert payload["request_id"] == "req-1"
    assert payload["timings_ms"] == {"embed": 1.5}
    assert payload["level"] == "INFO"


def test_stage_timer_records_each_stage_even_on_error():
    timer = StageTimer()
    with timer.stage("first"):
        pass
    with pytest.raises(RuntimeError), timer.stage("second"):
        raise RuntimeError
    assert set(timer.timings_ms) == {"first", "second"}
    assert timer.total_ms >= timer.timings_ms["first"]
