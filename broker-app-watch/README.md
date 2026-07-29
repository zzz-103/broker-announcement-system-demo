# Broker App Watch

用于采集和分析中国券商官网手机端 App 更新记录的 Python 项目。当前支持 10 家券商来源，采集层保存页面原文，刷新命令将其结构化为主看板使用的 CSV。

## 已支持来源

| 券商代码 | 券商 | App | 采集方式 | 解析器 |
| --- | --- | --- | --- | --- |
| `gxzq` | 国信证券 | 国信金太阳 | api | `guosen_software_api` |
| `gfzq` | 广发证券 | 广发易淘金 | http | `generic_html` |
| `zszq` | 招商证券 | 招商证券 APP | api | `cmschina_config_json` |
| `pazq` | 平安证券 | 平安证券 | api | `pingan_image_ocr` |
| `gtzq` | 国投证券 | 国投证券 | api | `essence_softwares_api` |
| `cgws` | 长城证券 | 长城证券手机 App | http | `cgws_download_html` |
| `firstcapital` | 第一创业 | 一创智富通 | http | `generic_html` |
| `ciccwm` | 中金财富 | 中金财富 | api | `ciccwm_appdown_api` |
| `dgzq` | 东莞证券 | 东莞证券手机 App | api | `dgzq_soft_api` |
| `ykzq` | 粤开证券 | 粤开证券手机 App | api | `ykzq_cms_article` |

完整来源定义见 `config/brokers.yaml`。

## 目录说明

```text
config/                         券商来源、分类和配置示例
src/broker_app_watch/core/      路径、配置和日志
src/broker_app_watch/collectors/ 采集器接口与轻量实现
src/broker_app_watch/parsers/   解析器接口与通用解析器
src/broker_app_watch/pipeline/  抓取、标准化、去重、分析流程骨架
src/broker_app_watch/storage/   数据模型与 Repository 接口
src/broker_app_watch/llm/       可替换客户端接口和输出 Schema
src/broker_app_watch/api/       独立的 FastAPI 入口
data/                           原始、处理后和导出数据
logs/                           运行日志
scripts/                        日常任务薄入口
tests/                          关键路径快速测试
```

所有应用路径均从项目根目录推导，不依赖命令执行时的当前目录。文本按 UTF-8 读写，并使用 `pathlib` 兼容 macOS 与 Windows。

## 环境准备

要求 Python 3.11 或更高版本。

### macOS

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
cp .env.example .env
cp config/settings.example.yaml config/settings.yaml
```

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
Copy-Item config/settings.example.yaml config/settings.yaml
```

`.env` 和 `config/settings.yaml` 是可选的本地配置。未创建时，程序使用安全默认值和示例配置。

## 配置

券商、App 和来源维护在 `config/brokers.yaml`：

```yaml
brokers:
  - broker_code: demo_broker
    broker_name: 示例券商
    app_name: 示例证券 App
    source_url: https://example.com/mobile/releases
    source_type: http
    parser: generic_html
    enabled: true
```

应用设置可从 `config/settings.yaml` 和 `.env` 读取；环境变量以 `BAW_` 开头，例如 `BAW_LOG_LEVEL=DEBUG`。敏感值只应写入 `.env`。

## CLI

安装后可使用命令入口，也可直接使用模块调用：

```bash
python -m broker_app_watch.cli check-config
python -m broker_app_watch.cli list-sources
python -m broker_app_watch.cli dry-run
python scripts/run_daily.py
```

`dry-run` 只检查并展示计划，不访问网站、不写入业务数据。

抓取单个或全部已启用来源（券商代码见上方表格）：

```bash
python -m broker_app_watch.cli crawl --broker gxzq
python -m broker_app_watch.cli crawl --broker gfzq
python -m broker_app_watch.cli crawl --all
```

Markdown 输出在 `data/raw/markdown/{broker_code}/`，例如：

```text
成功：1
失败：0

gxzq -> data/raw/markdown/gxzq/20260723_103000_gxzq_国信金太阳.md
```

爬虫仅保留目标页面的完整文字、段落和列表，不做摘要、分类或改写。

生成主看板数据（由主 FastAPI 通过子进程调用）：

```bash
python -m broker_app_watch.cli refresh \
  --all \
  --llm-config ../backend/config/llm_api_config.json \
  --export-path data/exports/app_releases.csv
```

刷新会先抓取全部已启用来源，再使用 OpenAI-compatible Chat Completions 接口生成结构化记录。成功券商会替换其历史记录；失败券商在已有导出数据时沿用旧记录并输出告警。CSV 使用同目录临时文件原子替换，刷新失败不会破坏上一版文件。

## FastAPI

```bash
python -m uvicorn broker_app_watch.api.main:app --reload
```

启动后可访问：

- `GET /health`：健康检查。
- `GET /api/releases`：独立服务的开发占位接口；生产看板使用主仓库 FastAPI 的 `GET /api/app-releases`。

## 数据目录

- `data/raw/`：原始 HTML、JSON 或页面快照。
- `data/processed/releases/`：标准化版本记录。
- `data/processed/llm/`：符合固定 Pydantic Schema 的 LLM 输出。
- `data/exports/`：CSV、JSON、Markdown 等导出文件，其中 `app_releases.csv` 是主看板读取的数据文件。

这些目录中的运行产物、`logs/` 中的日志和本地数据库均被 Git 忽略，只提交目录占位文件。

## 后续扩展

新增券商通常只需在 `config/brokers.yaml` 增加来源。页面结构可被通用解析器覆盖时复用 `generic_html`；确需特殊逻辑时，在 `parsers/broker_specific/` 新增专用解析器并注册名称。静态页面优先使用 HTTP Collector，动态页面才启用备用 Browser Collector。

正文以图片呈现（如平安证券 `pazq`）的来源，可将 `parser` 设为 `pingan_image_ocr`：采集器按 `request_method: POST` 与 `request_json` 拉取图片列表，解析器下载各图片并用 RapidOCR（离线）识别中文原文，仅提取文字不做改写；`parser_options.min_score` 可按置信度过滤噪声（默认 `0.0` 保留全部）。

存储层保留轻量 Repository 协议；当前生产导出使用 CSV，不引入数据库。LLM 层使用本地 OpenAI-compatible HTTP 客户端和固定结构化 Schema，不绑定模型 SDK。

## 测试

```bash
python -m pytest
```

测试仅覆盖模块导入、项目相对路径、配置加载和 API 健康检查。
