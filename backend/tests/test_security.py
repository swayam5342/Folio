import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app import security
from app.config import settings


def test_password_hash_roundtrip():
    hashed = security.hash_password("correct horse")
    assert security.verify_password("correct horse", hashed)
    assert not security.verify_password("wrong", hashed)


def test_unknown_user_never_verifies():
    assert not security.verify_password("anything", None)


def test_token_roundtrip_and_tampering():
    user_id = uuid.uuid4()
    token = security.create_token(user_id)
    assert security.decode_token(token) == user_id
    assert security.decode_token(token[:-2] + "xx") is None
    assert security.decode_token("not-a-jwt") is None


def test_expired_and_foreign_tokens_are_rejected():
    now = datetime.now(UTC)
    expired = jwt.encode({"sub": str(uuid.uuid4()), "exp": now - timedelta(seconds=1)}, settings.JWT_SECRET, "HS256")
    foreign = jwt.encode({"sub": str(uuid.uuid4()), "exp": now + timedelta(days=1)}, "another-secret", "HS256")
    no_sub = jwt.encode({"exp": now + timedelta(days=1)}, settings.JWT_SECRET, "HS256")
    assert security.decode_token(expired) is None
    assert security.decode_token(foreign) is None
    assert security.decode_token(no_sub) is None


def test_login_rate_limiter_blocks_then_expires(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: clock[0])
    limiter = security.LoginRateLimiter(max_failures=3, window_seconds=60)

    for _ in range(3):
        assert limiter.retry_after("alice", "1.2.3.4") is None
        limiter.record_failure("alice", "1.2.3.4")
    assert limiter.retry_after("alice", "1.2.3.4") == 60
    assert limiter.retry_after("alice", "5.6.7.8") is None  # keyed per (username, ip)

    clock[0] += 61
    assert limiter.retry_after("alice", "1.2.3.4") is None


def test_login_rate_limiter_reset_clears_failures():
    limiter = security.LoginRateLimiter(max_failures=1, window_seconds=60)
    limiter.record_failure("bob", "ip")
    assert limiter.retry_after("bob", "ip")
    limiter.reset("bob", "ip")
    assert limiter.retry_after("bob", "ip") is None
