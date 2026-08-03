# Broker App Watch

采集券商官网公开的 App 更新记录，并将结果刷新为主看板使用的 CSV。它由主 FastAPI 按需启动，不需要作为常驻服务运行。

## 目录与数据

```text
config/brokers.yaml        券商、App、来源和解析器配置
src/broker_app_watch/      采集、解析、LLM、存储和 CLI
data/raw/markdown/         原始页面 Markdown（运行产物）
data/processed/            标准化和 LLM 中间结果（运行产物）
data/exports/               主看板 CSV（app_releases.csv）
logs/                       运行日志（运行产物）
tests/                      关键路径测试
```

所有路径从项目根目录推导，文本使用 UTF-8；运行数据、日志和本地配置不提交 Git。

## 安装

Python 3.11+：

```bash
python3.11 -m venv .venv
source .venv/bin/activate                 # Windows: .venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
cp .env.example .env                     # Windows: Copy-Item .env.example .env
```

券商和 App 只在 `config/brokers.yaml` 中维护；敏感值只放 `.env`。

## CLI

```bash
python -m broker_app_watch.cli check-config
python -m broker_app_watch.cli list-sources
python -m broker_app_watch.cli dry-run

# 抓取
python -m broker_app_watch.cli crawl --broker gxzq
python -m broker_app_watch.cli crawl --all

# 使用已有 Markdown 处理并导出主看板 CSV
python -m broker_app_watch.cli process \
  --input-dir data/raw/markdown \
  --llm-config ../backend/config/llm_api_config.json \
  --export-path data/exports/app_releases.csv

# 抓取后直接刷新
python -m broker_app_watch.cli refresh --all \
  --llm-config ../backend/config/llm_api_config.json \
  --export-path data/exports/app_releases.csv
```

`dry-run` 不访问网站、不写入业务数据。完整参数以 `python -m broker_app_watch.cli --help` 为准。

刷新流程会抓取、去重、结构化并原子替换 CSV；失败来源沿用旧记录并输出告警。LLM 只补充缺失字段和摘要分类，不改写原始正文。

## 与主看板的关系

主后端通过固定 CLI 子进程调用 App Watch，读取 `data/exports/app_releases.csv`，再由统一 `dashboard-data` 导出层生成 `app_updates.json`。纯前端不读取本目录，也不执行 Python。

独立 FastAPI 入口仅用于开发检查：

```bash
python -m uvicorn broker_app_watch.api.main:app --reload
```

生产看板使用主仓库 FastAPI 的 App Watch 接口。

## 新增来源

1. 在 `config/brokers.yaml` 增加来源条目。
2. 能用通用页面解析器时复用 `generic_html` 等现有解析器。
3. 只有页面结构确实不同才在 `parsers/broker_specific/` 增加专用解析器。
4. 图片正文可配置离线 OCR；不要引入验证码绕过、代理轮换或高并发抓取。

## 验证

```bash
python -m pytest
```

测试覆盖模块导入、路径、配置加载和 API 健康检查等关键路径。
