from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api.user_store import (
    DuplicateUserError,
    authenticate_user,
    create_user,
    create_user_with_username,
    generate_initial_password,
)


class UserStoreSecurityTests(unittest.TestCase):
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

            with self.assertRaises(DuplicateUserError):
                create_user_with_username(
                    "Test User",
                    "test.user@example.com",
                    "Test",
                    username="test.user",
                )


if __name__ == "__main__":
    unittest.main()
