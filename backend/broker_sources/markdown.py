from __future__ import annotations

import json

from .models import StandardNotice


def _front_matter_value(value: object) -> str:
    return json.dumps("" if value is None else str(value), ensure_ascii=False)


def render_notice_markdown(notice: StandardNotice) -> str:
    fields = {
        "source": notice.source_name,
        "data_source": notice.source_kind,
        "source_url": notice.source_url,
        "notice_id": notice.notice_id,
        "notice_type": notice.notice_type,
        "title": notice.title,
        "publish_date": notice.publish_date,
        "purchaser": notice.broker_name,
        "broker_key": notice.broker_key,
        "broker_name": notice.broker_name,
        "collected_at": notice.collected_at,
        "collection_status": notice.collection_status,
        "raw_list_path": notice.raw_list_path,
        "raw_detail_path": notice.raw_detail_path,
    }
    front_matter = "".join(
        f"{key}: {_front_matter_value(value)}\n" for key, value in fields.items()
    )
    return (
        f"---\n{front_matter}---\n\n"
        f"# {notice.title}\n\n"
        "## 基本信息\n\n"
        "| 字段 | 内容 |\n"
        "|---|---|\n"
        f"| 券商 | {notice.broker_name} |\n"
        f"| 发布时间 | {notice.publish_date} |\n"
        f"| 数据来源 | {notice.source_name} |\n"
        f"| 原始链接 | {notice.source_url} |\n"
        f"| 采集时间 | {notice.collected_at} |\n"
        f"| 采集状态 | {notice.collection_status} |\n\n"
        "## 公告正文\n\n"
        f"{notice.content_text.strip()}\n"
    )
