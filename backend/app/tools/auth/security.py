"""FastAPI dependencies for session authentication and authorization."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, Request, status

from .db import SESSION_COOKIE, get_effective_permissions, get_user_by_session, users_exist


class AuthUser(dict):
    """Dictionary user with a stable marker type for route annotations."""


def _auth_not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Auth is not initialized. Configure AUTH_BOOTSTRAP_ADMIN and AUTH_BOOTSTRAP_PASSWORD, then restart.",
    )


async def require_login(request: Request) -> AuthUser:
    if not users_exist():
        raise _auth_not_configured()
    session_id = request.cookies.get(SESSION_COOKIE, "")
    user = get_user_by_session(session_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user["permissions"] = get_effective_permissions(user)
    return AuthUser(user)


def require_permission(permission_key: str) -> Callable[[Request], AuthUser]:
    async def dependency(request: Request) -> AuthUser:
        user = await require_login(request)
        if permission_key not in user.get("permissions", []):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return user

    return dependency


async def require_admin(request: Request) -> AuthUser:
    user = await require_login(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user
