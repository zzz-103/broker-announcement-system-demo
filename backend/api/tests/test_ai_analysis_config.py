from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.api.ai_analysis import AiAnalysisError, timeout_seconds, window_days


class AiAnalysisConfigTests(unittest.TestCase):
    def test_window_days_has_an_upper_bound(self) -> None:
        with patch.dict(os.environ, {"AI_ANALYSIS_WINDOW_DAYS": "3651"}):
            with self.assertRaises(AiAnalysisError):
                window_days()

    def test_timeout_has_an_upper_bound(self) -> None:
        with patch.dict(os.environ, {"AI_ANALYSIS_TIMEOUT_SECONDS": "601"}):
            with self.assertRaises(AiAnalysisError):
                timeout_seconds()

    def test_valid_values_are_preserved(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_ANALYSIS_WINDOW_DAYS": "90", "AI_ANALYSIS_TIMEOUT_SECONDS": "180"},
        ):
            self.assertEqual(window_days(), 90)
            self.assertEqual(timeout_seconds(), 180)


if __name__ == "__main__":
    unittest.main()
