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
    create_user,
    create_user_with_username,
    generate_initial_password,
    hash_password,
    list_users,
    promote_user_to_admin,
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

    def test_initial_passwords_are_unique_and_not_the_legacy_default(self) -> None:
        first = generate_initial_password()
        second = generate_initial_password()
        self.assertGreaterEqual(len(first), 20)
        self.assertNotEqual(first, second)
        self.assertNotEqual(first, "123456")

    def test_created_password_matches_hash_and_duplicate_application_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {"USER_DB_PATH": str(Path(temp_dir) / "users.db")},
        ):
            user, password = create_user("Test User", "test.user@example.com", "Test")
            self.assertTrue(password)
            self.assertEqual(user.username, "test.user")
            self.assertEqual(authenticate_user(user.username, password).id, user.id)
            self.assertEqual(user.role, "user")
            promoted = promote_user_to_admin(user.id)
            self.assertEqual(promoted.role, "admin")
            self.assertEqual(authenticate_user(user.username, password).role, "admin")
            with self.assertRaises(AlreadyAdminError):
                promote_user_to_admin(user.id)

            with self.assertRaises(DuplicateUserError):
                create_user_with_username(
                    "Test User",
                    "test.user@example.com",
                    "Test",
                    username="test.user",
                )


if __name__ == "__main__":
    unittest.main()
