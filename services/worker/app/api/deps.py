"""Verifikasi JWT Supabase (JWKS, cache 10 menit) + pemeriksaan admin."""

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine


@dataclass
class AuthUser:
    id: str
    email: str | None = None
    claims: dict[str, Any] = field(default_factory=dict)


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=600)


def verify_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "HS256":
            # Project lama dengan JWT secret simetris (mis. Supabase lokal versi lama).
            if not settings.supabase_jwt_secret:
                raise jwt.InvalidTokenError("HS256 tanpa SUPABASE_JWT_SECRET")
            return jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated"
            )
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated")
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"token tidak valid: {exc}") from exc


def current_user(authorization: str | None = Header(default=None)) -> AuthUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "butuh Authorization: Bearer <JWT>")
    claims = verify_token(authorization.split(" ", 1)[1].strip())
    return AuthUser(id=str(claims["sub"]), email=claims.get("email"), claims=claims)


def admin_user(user: AuthUser = Depends(current_user)) -> AuthUser:
    with get_engine().connect() as conn:
        is_admin = conn.execute(
            text("select is_admin from public.users where id = cast(:id as uuid)"), {"id": user.id}
        ).scalar()
    if not is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "khusus admin")
    return user
