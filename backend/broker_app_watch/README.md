# Broker App Watch

采集券商官网公开的 App 更新记录，并将结果刷新为主看板使用的 CSV。本模块属于主后端，复用根目录 Python 环境和唯一 FastAPI，不作为独立服务运行。

## 目录与数据

```text
backend/broker_app_watch/                 采集、解析、LLM、存储和 CLI
backend/config/broker_app_watch/          券商来源、分类和非敏感配置
backend/data/broker_app_watch/raw/        原始页面 Markdown（运行产物）
backend/data/broker_app_watch/processed/  标准化和 LLM 中间结果（运行产物）
backend/data/broker_app_watch/exports/    主看板 CSV（app_releases.csv）
backend/broker_app_watch/tests/           关键路径测试和 fixtures
```

所有路径从仓库根目录推导，不依赖当前工作目录；文本使用 UTF-8。敏感配置只放根目录 `.env`，运行数据不提交 Git。

腾讯应用宝（`sj.qq.com`）来源统一使用 App 详情页 OCR；未配置 `screenshot_alt` 时，会按截图标识自动选择预览图。

## CLI

先按根目录 `requirements.txt` 或 `backend/api/requirements.txt` 安装共享依赖，然后从仓库根目录执行：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli list-sources
.venv/bin/python -m backend.broker_app_watch.cli dry-run

.venv/bin/python -m backend.broker_app_watch.cli crawl --broker gxzq
.venv/bin/python -m backend.broker_app_watch.cli crawl --all

.venv/bin/python -m backend.broker_app_watch.cli process \
  --input-dir backend/data/broker_app_watch/raw/markdown \
  --llm-config backend/config/llm_api_config.json \
  --export-path backend/data/broker_app_watch/exports/app_releases.csv

.venv/bin/python -m backend.broker_app_watch.cli refresh --all \
  --llm-config backend/config/llm_api_config.json \
  --export-path backend/data/broker_app_watch/exports/app_releases.csv
```

Windows 将解释器替换为 `.venv\Scripts\python.exe`，其余相对路径和模块命令不变。`dry-run` 不访问网站、不写入业务数据。

根目录 `scripts/run_app_watch.py` 是同一 CLI 的轻量转发入口，不包含业务逻辑。

主后端通过固定 CLI 子进程调用刷新流程，`GET /api/app-releases` 和统一 `dashboard-data` 导出层继续读取同一 CSV。刷新仍使用原子替换；失败来源沿用旧记录，LLM 只补充结构化字段，不改写原始正文。

手动任务继续使用主 API 的 `POST /api/jobs/app-watch`。如需定时刷新，在现有 `python -m backend.api.scheduler` 进程中设置 `APP_WATCH_SCHEDULER_ENABLED=true` 和独立的 `APP_WATCH_SCHEDULER_CRON`；默认关闭，不改变既有生产调度。该任务沿用主后端全局互斥锁，Cron 应避开招采 Pipeline 的运行窗口。

## 验证

```bash
.venv/bin/python -m pytest backend/broker_app_watch/tests -q -p no:cacheprovider
```
