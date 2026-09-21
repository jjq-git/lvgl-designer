"""FastAPI M2M bearer authentication, independent of browser sessions."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Header, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db


bearer = HTTPBearer(auto_error=False, scheme_name="LvglIoTServiceBearer")


def require_scope(scope: str) -> Callable[..., dict]:
    async def dependency(
        credentials: HTTPAuthorizationCredentials | None = Security(bearer),
        tenant_id: str = Header("", alias="X-IoT-Tenant", max_length=160),
    ) -> dict:
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "m2m-auth-required", "message": "valid service credentials and tenant mapping are required"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        principal = db.authenticate(credentials.credentials, tenant_id)
        if principal is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "m2m-auth-invalid", "message": "valid service credentials and tenant mapping are required"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        if scope not in principal["scopes"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "m2m-scope-required", "message": f"service scope {scope} is required"},
            )
        return principal

    return dependency
