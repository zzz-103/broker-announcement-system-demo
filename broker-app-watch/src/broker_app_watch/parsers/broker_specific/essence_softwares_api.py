"""Parser for the Essence/国投证券 /api/softwares endpoint (mobile apps only)."""

import json

from markdownify import markdownify

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class EssenceSoftwaresApiParser(Parser):
    """按平台分组保留移动端 App 的版本信息，仅收录配置指定的平台组。"""

    # 标量字段的展示顺序与标题，均直接取自接口原值不做改写。
    _SCALAR_FIELDS = (
        ("版本", "ver"),
        ("更新日期", "time"),
        ("运行环境", "env"),
        ("支持语言", "lang"),
        ("适用客户", "fitCust"),
    )

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 国投证券接口返回的内容不是有效 JSON") from exc

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise ValueError(f"{source.broker_code} 国投证券接口缺少顶层 data 对象")

        platform_groups = source.parser_options.get("platform_groups")
        if not isinstance(platform_groups, dict) or not platform_groups or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in platform_groups.items()
        ):
            raise ValueError(
                f"{source.broker_code} 的 platform_groups 配置必须是“平台名: 分组键”的字符串映射"
            )

        sections: list[ParsedSection] = []
        metadata: dict[str, str] = {}
        for platform, group_key in platform_groups.items():
            apps = data.get(group_key)
            if not isinstance(apps, list) or not apps:
                raise ValueError(
                    f"{source.broker_code} 国投证券接口缺少{platform}分组“{group_key}”，"
                    f"来源：{source.source_url}"
                )
            for app in apps:
                if not isinstance(app, dict):
                    continue
                name = str(app.get("name") or source.app_name).strip()
                sections.append(
                    ParsedSection(
                        heading=f"{platform} · {name}",
                        content=self._app_content(app),
                    )
                )
            metadata[f"{platform}_数量"] = str(len(apps))

        if not sections:
            raise ValueError(f"{source.broker_code} 国投证券接口未解析出任何 App，来源：{source.source_url}")

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata=metadata,
        )

    def _app_content(self, app: dict[str, object]) -> str:
        lines: list[str] = []
        for label, field in self._SCALAR_FIELDS:
            value = app.get(field)
            if value is not None and str(value).strip():
                lines.append(f"- {label}：{str(value).strip()}")

        size = self._file_size_mb(app)
        if size is not None:
            lines.append(f"- 文件大小：{size}")

        download = app.get("dlLinkMain")
        if download is not None and str(download).strip():
            lines.append(f"- 下载地址：{str(download).strip()}")
        md5 = app.get("dlLinkMainMd5")
        if md5 is not None and str(md5).strip():
            lines.append(f"- MD5：{str(md5).strip()}")

        parts: list[str] = []
        if lines:
            parts.append("\n".join(lines))

        remark = app.get("remark")
        if remark is not None and str(remark).strip():
            introduction = markdownify(str(remark), heading_style="ATX", bullets="-").strip()
            if introduction:
                parts.append(f"软件介绍：\n\n{introduction}")

        return clean_text("\n\n".join(parts)) or "（页面未提供内容）"

    @staticmethod
    def _file_size_mb(app: dict[str, object]) -> str | None:
        raw = app.get("dlLinkMainFilesize")
        if raw is None:
            raw = app.get("filesize")
        try:
            size_bytes = int(str(raw))
        except (TypeError, ValueError):
            return None
        if size_bytes <= 0:
            return None
        return f"{round(size_bytes / 1024 / 1024, 1)} MB（{size_bytes} 字节）"
