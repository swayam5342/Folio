#!/bin/sh
set -e

echo "Applying database migrations..."
alembic upgrade head

# --host "" binds every interface on BOTH IPv4 and IPv6 (asyncio opens one socket per
# family). Docker networks with IPv6 resolve "backend" to both; "::" alone would be
# IPv6-only and "0.0.0.0" IPv4-only, so nginx would fail on one of them.
# --proxy-headers so login rate limiting sees the real client IP behind nginx.
exec uvicorn app.main:app --host "" --port 8000 --proxy-headers --forwarded-allow-ips="*"
