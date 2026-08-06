# 券商招采智能分析系统

一个由 FastAPI、Next.js 和 Python 采集流水线组成的内部看板系统。

- `frontend/`：唯一正式前端，连接 FastAPI，提供登录、任务控制、实时日志、看板和管理功能。
- `backend/`：FastAPI 后端，负责认证、任务与 SSE、数据接口和静态托管。

## 先做什么

### macOS 本地开发

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
cd frontend && pnpm install && cd ..
cp .env.example .env
```

终端一启动后端，终端二启动前端：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

需要运行定时任务时，在第三个终端从仓库根目录启动现有调度器：

```bash
.venv/bin/python -m backend.api.scheduler
```

打开 `http://localhost:3000`。真实爬虫、LLM 和 App Watch 任务需要相应私密配置；只看页面时可使用已有样例数据。

## 标准数据包

后端把正式 CSV/JSON 一次转换为标准化 `dashboard-data` 数据包（Manifest、统计、SHA-256 校验），正式前端通过受保护的 `/api/dashboard-data/*` 接口读取，不再直接解析原始 CSV。管理员可在“管理控制台 → 前端数据包”导出 ZIP，也可在仓库根目录执行：

```bash
python scripts/export_dashboard_data.py --zip
```

数据包包含 `manifest.json`、`overview.json`、`filters.json`、
`tender_projects.json`、`app_updates.json` 和 `ai_analysis.json`，不包含用户表、
密码、Token、服务器路径或 LLM 配置。

## 代码与数据边界

```text
backend/api/                 FastAPI、认证、任务、数据包导出
backend/data/                正式 CSV/JSON 和导出的 dashboard-data
backend/broker_sources/      券商官网来源选择与采集
backend/broker_app_watch/    券商 App 更新采集与结构化
backend/config/broker_app_watch/  App 来源与分类配置
backend/data/broker_app_watch/    App raw/processed/exports 运行数据
backend/python-*/            金采网公告爬虫
frontend/src/features/       正式前端业务模块
shared/dashboard-data/       标准数据包 Schema
```

复杂清洗、去重、归一化、分类、统计和排序字段在后端导出层完成；前端只做筛选、简单排序、分页和展示。

App 更新模块从仓库根目录手动检查或 dry-run：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli dry-run
```

Windows 使用 `.venv\Scripts\python.exe` 替换解释器路径。正式刷新仍由主 FastAPI 任务入口调用；可选定时入口复用 `python -m backend.api.scheduler`。

## 常用验证

```bash
./.venv/bin/python -m unittest discover -s backend/api -p 'test*.py'
cd frontend && pnpm run ts-check && pnpm run lint:build
```

生产静态构建：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

## 文档导航

- [运行与发布](docs/operations.md)：本地启动、Windows 发布和排障。
- [架构边界](docs/architecture.md)：模块职责和标准数据包流程。
- [正式前端](frontend/README.md)：看板开发与样式约束。
- [官网来源采集](backend/broker_sources/README.md)：券商官网与金采网的来源选择。
- [金采网爬虫](backend/python-http-www-cfcpn-com-jcw/README.md)：公告抓取命令和输出目录。
- [App Watch](backend/broker_app_watch/README.md)：券商 App 更新采集与刷新。

`AGENTS.md` 及各目录下的 `AGENTS.md` 是开发约束，不是运行手册；修改代码前请先阅读对应文件。
