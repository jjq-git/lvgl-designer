#!/usr/bin/env python3
"""reset_admin — 重置或创建管理员账号密码（应急运维脚本）。

用于管理员密码丢失、或需要强制重置时使用。
密码以 scrypt 加盐哈希存储，脚本本身不保存明文。

用法示例:
    # 交互式输入密码（推荐，密码不出现在命令历史里）
    python -m app.tools.auth.reset_admin admin

    # 直接指定密码
    python -m app.tools.auth.reset_admin admin -p 'NewPass1234'

    # 若该用户不存在则创建为 admin
    python -m app.tools.auth.reset_admin newadmin -p 'NewPass1234' --create
"""

from __future__ import annotations

import argparse
import getpass
import sys

from .db import (
    change_password,
    create_user,
    get_user_with_hash_by_username,
    update_user,
)

MIN_PASSWORD_LEN = 8


def reset_admin(
    username: str,
    password: str,
    *,
    create: bool = False,
) -> dict:
    """重置指定用户的密码，并确保其为激活状态的 admin。

    Args:
        username: 目标用户名
        password: 新密码（至少 8 位）
        create: 用户不存在时是否自动创建为 admin

    Returns:
        更新后的用户信息 dict

    Raises:
        ValueError: 密码过短，或用户不存在且未指定 --create
    """
    username = username.strip()
    if not username:
        raise ValueError("username is required")
    if len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LEN} characters")

    row = get_user_with_hash_by_username(username)
    if row is None:
        if not create:
            raise ValueError(
                f"user '{username}' not found (use --create to create a new admin)"
            )
        return create_user(username, password, role="admin", display_name=username)

    user_id = row["id"]
    # 确保账号是激活状态的 admin，再改密码
    update_user(user_id, role="admin", is_active=True)
    change_password(user_id, password)  # 同时会清除该用户所有现存会话
    return get_user_with_hash_by_username(username)  # type: ignore[return-value]


def _prompt_password() -> str:
    """交互式获取密码并二次确认。"""
    first = getpass.getpass("新密码: ")
    second = getpass.getpass("再次输入: ")
    if first != second:
        raise ValueError("两次输入的密码不一致")
    return first


def main(argv: list[str] | None = None) -> int:
    """命令行入口点。"""
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("username", help="要重置/创建的用户名（如 admin）")
    p.add_argument("-p", "--password", default=None, help="新密码；省略则交互式输入")
    p.add_argument(
        "--create",
        action="store_true",
        help="用户不存在时自动创建为 admin",
    )
    args = p.parse_args(argv)

    try:
        password = args.password if args.password is not None else _prompt_password()
        user = reset_admin(args.username, password, create=args.create)
    except ValueError as e:
        print(f"[ERROR] 失败: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001 — 顶层入口需兜底所有异常
        print(f"[ERROR] 意外错误: {e}", file=sys.stderr)
        return 1

    print(f"[OK] 已重置账号 '{user['username']}' (id={user['id']}, role={user['role']})")
    print("  该用户所有现存会话已失效，请用新密码重新登录。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
