from __future__ import annotations

from .announcement_cache import AnnouncementResponseCache
from .config import settings
from .job_manager import JobManager
from .session_store import SessionStore


job_manager = JobManager()
announcement_response_cache = AnnouncementResponseCache(max_entries=2)
session_tokens = SessionStore(settings.session_limit)
