"""Parser for Apple's public iTunes Lookup API (current iOS release)."""

import json
from datetime import datetime

from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.core.config import BrokerSource
from backend.broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class AppleLookupApiParser(Parser):
    """Extract one configured App's current iOS version and release notes."""

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} Apple Lookup 返回的内容不是有效 JSON") from exc
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list) or not results:
            raise ValueError(f"{source.broker_code} Apple Lookup 未返回 App 记录")

        expected_track_id = str(source.parser_options.get("track_id") or "").strip()
        item = next(
            (
                candidate
                for candidate in results
                if isinstance(candidate, dict)
                and (not expected_track_id or str(candidate.get("trackId") or "") == expected_track_id)
            ),
            None,
        )
        if item is None:
            raise ValueError(f"{source.broker_code} Apple Lookup 未返回配置的 track_id")

        version = str(item.get("version") or "").strip()
        released_at = str(item.get("currentVersionReleaseDate") or "").strip()
        release_date = self._date(released_at)
        notes = clean_text(str(item.get("releaseNotes") or ""))
        if not version:
            raise ValueError(f"{source.broker_code} Apple Lookup 记录缺少版本号")

        lines = [f"- 版本：{version}"]
        if release_date:
            lines.append(f"- 更新日期：{release_date}")
        lines.append("- 平台：iOS")
        if notes:
            lines.extend(("", "更新说明：", "", notes))
        else:
            lines.extend(("", "官方未披露本次更新内容。"))

        track_id = str(item.get("trackId") or expected_track_id)
        bundle_id = str(item.get("bundleId") or "").strip()
        return ParsedDocument(
            title=source.app_name,
            sections=[ParsedSection(heading=f"iOS · {source.app_name}", content="\n".join(lines))],
            source_metadata={
                "apple_track_id": track_id,
                "apple_bundle_id": bundle_id,
            },
        )

    @staticmethod
    def _date(value: str) -> str:
        if not value:
            return ""
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return ""
