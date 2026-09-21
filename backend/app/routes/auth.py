"""Unified login, session, and user administration routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..tools.auth import db
from ..tools.auth.security import AuthUser, require_admin, require_login, require_permission

router = APIRouter()
admin_router = APIRouter(dependencies=[Depends(require_permission("admin.users"))])

db.init_db()


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=200)


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=8, max_length=200)
    role: str = Field("user")
    display_name: str = Field("", max_length=120)


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, max_length=120)


class PasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=200)


class ChangePasswordRequest(BaseModel):
    old_password: str | None = Field(default=None, max_length=200)
    new_password: str | None = Field(default=None, max_length=200)
    oldPassword: str | None = Field(default=None, max_length=200)
    newPassword: str | None = Field(default=None, max_length=200)


class SetPermissionsRequest(BaseModel):
    permissions: list[str] = Field(default_factory=list)


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "is_active": user["is_active"],
        "display_name": user.get("display_name") or user["username"],
        "permissions": db.get_effective_permissions(user),
        "created_at": user.get("created_at", ""),
        "updated_at": user.get("updated_at", ""),
    }


def _normalize_role(role: str | None) -> str | None:
    if role == "normal":
        return "user"
    return role


def _password_pair(req: ChangePasswordRequest) -> tuple[str, str]:
    old_password = req.old_password if req.old_password is not None else req.oldPassword
    new_password = req.new_password if req.new_password is not None else req.newPassword
    if not old_password:
        raise HTTPException(status_code=422, detail="old password is required")
    if not new_password:
        raise HTTPException(status_code=422, detail="new password is required")
    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="new password must be at least 8 characters")
    return old_password, new_password


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    user = db.authenticate_user(req.username, req.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid username or password")
    session_id, expires_at = db.create_session(
        user["id"],
        user_agent=request.headers.get("user-agent", ""),
        ip=request.client.host if request.client else "",
    )
    response.set_cookie(
        db.SESSION_COOKIE,
        session_id,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        max_age=int((db.parse_iso(expires_at) - db.now_utc()).total_seconds()),
        path="/",
    )
    return {"success": True, "user": _public_user(user), "expires_at": expires_at}


@router.post("/logout")
async def logout(request: Request, response: Response):
    db.delete_session(request.cookies.get(db.SESSION_COOKIE, ""))
    response.delete_cookie(db.SESSION_COOKIE, path="/")
    return {"success": True}


@router.get("/me")
async def me(user: AuthUser = Depends(require_login)):
    public = _public_user(user)
    return {
        "user": public,
        "id": public["id"],
        "username": public["username"],
        "role": public["role"],
        "display_name": public["display_name"],
        "permissions": public["permissions"],
    }


@router.post("/password")
async def change_own_password(req: ChangePasswordRequest, user: AuthUser = Depends(require_login)):
    old_password, new_password = _password_pair(req)
    row = db.get_user_with_hash_by_username(user["username"])
    if row is None or not db.verify_password(old_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="old password is incorrect")
    db.change_password(user["id"], new_password)
    return {"success": True}


@admin_router.get("/permissions")
async def permissions(_admin: AuthUser = Depends(require_admin)):
    return {"permissions": db.list_permissions()}


@admin_router.get("/users")
async def users(_admin: AuthUser = Depends(require_admin)):
    return {"users": [_public_user(user) for user in db.list_users()]}


@admin_router.post("/users")
async def create_user(req: CreateUserRequest, _admin: AuthUser = Depends(require_admin)):
    try:
        user = db.create_user(req.username, req.password, _normalize_role(req.role) or "user", req.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "user": _public_user(user)}


@admin_router.patch("/users/{user_id}")
async def update_user(user_id: int, req: UpdateUserRequest, _admin: AuthUser = Depends(require_admin)):
    try:
        user = db.update_user(
            user_id,
            role=_normalize_role(req.role),
            is_active=req.is_active,
            display_name=req.display_name,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "user": _public_user(user)}


@admin_router.post("/users/{user_id}/password")
async def reset_password(user_id: int, req: PasswordRequest, _admin: AuthUser = Depends(require_admin)):
    try:
        db.change_password(user_id, req.password)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True}


@admin_router.put("/users/{user_id}/permissions")
async def set_permissions(user_id: int, req: SetPermissionsRequest, admin: AuthUser = Depends(require_admin)):
    try:
        permissions = db.set_user_permissions(user_id, req.permissions, granted_by=admin["id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "permissions": permissions}


@admin_router.delete("/users/{user_id}")
async def delete_user(user_id: int, _admin: AuthUser = Depends(require_admin)):
    try:
        db.delete_user(user_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True}
