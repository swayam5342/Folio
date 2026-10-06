"""Password hashing, session tokens, and a small login rate limiter."""
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

SESSION_COOKIE = "session"
_ALGORITHM = "HS256"

# Used to keep login timing the same whether or not the username exists.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    """Pass password_hash=None for an unknown user; still burns a bcrypt check so timing doesn't leak existence."""
    if password_hash is None:
        bcrypt.checkpw(password.encode(), _DUMMY_HASH.encode())
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=settings.JWT_EXPIRE_DAYS)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[_ALGORITHM])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


class LoginRateLimiter:
    """
    Counts failed logins per (username, ip) in a sliding window. In-memory, so
    it assumes a single backend process — fine for this deployment.
    """

    def __init__(self, max_failures: int = 10, window_seconds: int = 15 * 60):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: tuple[str, str], now: float) -> deque[float]:
        q = self._failures[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def retry_after(self, username: str, ip: str) -> int | None:
        """Seconds until another attempt is allowed, or None if not blocked."""
        now = time.monotonic()
        with self._lock:
            q = self._prune((username, ip), now)
            if len(q) >= self.max_failures:
                return max(1, int(self.window - (now - q[0])))
        return None

    def record_failure(self, username: str, ip: str) -> None:
        with self._lock:
            self._failures[(username, ip)].append(time.monotonic())

    def reset(self, username: str, ip: str) -> None:
        with self._lock:
            self._failures.pop((username, ip), None)


login_limiter = LoginRateLimiter()
