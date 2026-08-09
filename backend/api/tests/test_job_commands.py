from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from backend.api.job_commands import JobCommandFactory


class JobCommandPathTests(unittest.TestCase):
    def test_python_resolver_keeps_virtual_environment_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            link = Path(temporary) / "python"
            try:
                link.symlink_to(Path(sys.executable))
            except OSError as exc:
                self.skipTest(f"symlink is unavailable: {exc}")
            resolved = JobCommandFactory._resolve_python_executable(str(link), Path(sys.executable))
            self.assertEqual(resolved, Path(os.path.abspath(link)))
            self.assertNotEqual(resolved, link.resolve())


if __name__ == "__main__":
    unittest.main()
