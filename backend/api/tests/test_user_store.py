from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api.user_store import (
    AlreadyAdminError,
    DuplicateUserError,
    authenticate_user,
    apply_for_user,
    create_user,
    create_user_with_username,
    demote_user_to_user,
    generate_initial_password,
    hash_password,
    list_users,
    NotAdminError,
    promote_user_to_admin,
    ReservedAdminUsernameError,
)


class UserStoreSecurityTests(unittest.TestCase):
    def test_legacy_user_table_is_migrated_with_user_role(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {"USER_DB_PATH": str(Path(temp_dir) / "users.db")},
        ):
            db_path = Path(temp_dir) / "users.db"
            with sqlite3.connect(db_path) as connection:
                connection.execute(
                    """
                    CREATE TABLE approved_users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL UNIQUE,
                        department TEXT NOT NULL,
                        username TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO approved_users (name, email, department, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    ("Legacy User", "legacy@example.com", "Test", "legacy", hash_password("legacy-password"), "2026-08-12T00:00:00+00:00"),
                )
            users, total, _ = list_users(1, 10)
            self.assertEqual(total, 1)
            self.assertEqual(users[0].role, "user")

    def test_initial_password_is_fixed(self) -> None:
        self.assertEqual(generate_initial_password(), "123456")

    def test_created_password_matches_hash_and_duplicate_application_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {"USER_DB_PATH": str(Path(temp_dir) / "users.db")},
        ):
            user, password = create_user("Test User", "test.user@example.com", "Test")
            self.assertEqual(password, "123456")
            self.assertEqual(user.username, "test.user")
            self.assertEqual(authenticate_user(user.username, password).id, user.id)
            self.assertEqual(user.role, "user")
            promoted = promote_user_to_admin(user.id)
            self.assertEqual(promoted.role, "admin")
            self.assertEqual(authenticate_user(user.username, password).role, "admin")
            with self.assertRaises(AlreadyAdminError):
                promote_user_to_admin(user.id)

            demoted = demote_user_to_user(user.id)
            self.assertEqual(demoted.role, "user")
            self.assertEqual(authenticate_user(user.username, password).role, "user")
            with self.assertRaises(NotAdminError):
                demote_user_to_user(user.id)

            with self.assertRaises(DuplicateUserError):
                create_user_with_username(
                    "Test User",
                    "test.user@example.com",
                    "Test",
                    username="test.user",
                )

    def test_registration_and_admin_entry_use_the_same_initial_password(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qualification_path = root / "user_qualification.csv"
            qualification_path.write_text(
                "姓名中文,邮箱,邮箱前缀\n注册用户,registered@csco.com.cn,registered\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {
                    "USER_DB_PATH": str(root / "users.db"),
                    "USER_QUALIFICATION_CSV_PATH": str(qualification_path),
                },
            ):
                _, admin_password = create_user("管理员录入", "admin-entry@example.com", "测试部门")
                _, registration_password = apply_for_user(
                    "注册用户",
                    "registered@csco.com.cn",
                    "测试部门",
                )

            self.assertEqual(admin_password, "123456")
            self.assertEqual(registration_password, "123456")

    def test_super_admin_username_is_reserved_and_hidden_from_user_list(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {
                "ADMIN_USERNAME": "admin",
                "USER_DB_PATH": str(Path(temp_dir) / "users.db"),
            },
        ):
            with self.assertRaises(ReservedAdminUsernameError):
                create_user("冒充超级管理员", "admin@example.com", "测试部门")

            create_user("普通用户", "normal@example.com", "测试部门")
            db_path = Path(temp_dir) / "users.db"
            with sqlite3.connect(db_path) as connection:
                connection.execute(
                    "INSERT INTO approved_users (name, email, department, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        "历史同名账号",
                        "legacy-admin@example.com",
                        "测试部门",
                        "admin",
                        hash_password("legacy-password"),
                        "admin",
                        "2026-08-12T00:00:00+00:00",
                    ),
                )
            users, total, _ = list_users(1, 10)
            self.assertEqual(total, 1)
            self.assertEqual([user.username for user in users], ["normal"])


if __name__ == "__main__":
    unittest.main()
