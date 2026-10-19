#!/bin/sh
set -e

echo "Applying database migrations..."
alembic upgrade head

# --proxy-headers so login rate limiting sees the real client IP behind nginx.
# --no-access-log: the app logs every request itself, with request id and duration.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" --no-access-log
