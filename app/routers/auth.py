from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import Credentials, LoginRequest, UserOut
from app.security import (
    SESSION_COOKIE,
    create_token,
    hash_password,
    login_limiter,
    verify_password,
)

router = APIRouter(prefix="/auth")


def _set_session(response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_token(user.id),
        max_age=settings.JWT_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
        path="/",
    )


def _client_ip(request: Request) -> str:
    # Behind nginx the real client is in X-Real-IP; direct access falls back to the socket peer.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


@router.post("/register", response_model=UserOut, status_code=201)
async def register(payload: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = User(username=payload.username, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="That username is already taken")
    await db.refresh(user)
    _set_session(response, user)
    return user


@router.post("/login", response_model=UserOut)
async def login(payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    retry_after = login_limiter.retry_after(payload.username, ip)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {retry_after // 60 + 1} minutes.",
            headers={"Retry-After": str(retry_after)},
        )

    user = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if not verify_password(payload.password, user.password_hash if user else None):
        login_limiter.record_failure(payload.username, ip)
        raise HTTPException(status_code=401, detail="Wrong username or password")

    login_limiter.reset(payload.username, ip)
    _set_session(response, user)
    return user


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.COOKIE_SECURE)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
