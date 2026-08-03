# 券商招采智能分析系统

一个由 FastAPI、Next.js 和 Python 采集流水线组成的内部看板系统。仓库同时包含两个前端：

- `frontend/`：完整版本，连接 FastAPI，提供登录、任务控制、实时日志和管理功能。
- `frontend-coze/`：纯前端版本，只读取静态 `dashboard-data`，可独立部署到外网。

## 先做什么

### macOS 本地开发

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
cd frontend && pnpm install && cd ..
cp .env.example .env
```

终端一启动后端，终端二启动完整前端：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

打开 `http://localhost:3000`。真实爬虫、LLM 和 App Watch 任务需要相应私密配置；只看页面时可使用已有样例数据。

### 纯前端看板

```bash
cd frontend-coze
pnpm install
pnpm data:check
pnpm dev
```

它不需要后端、数据库或登录。`pnpm build` 生成可静态部署的 `out/`，`pnpm start` 仅用于本地预览。

## 标准数据包

完整版本管理员可在“管理控制台 → 纯前端数据包”导出，也可在仓库根目录执行：

```bash
python scripts/export_dashboard_data.py --zip
```

生成的 `dashboard-data/` 包含 `manifest.json`、`overview.json`、`filters.json`、
`tender_projects.json`、`app_updates.json` 和 `ai_analysis.json`。将整个目录复制到
`frontend-coze/public/dashboard-data/` 后即可使用，不需要改代码或转换字段。

## 代码与数据边界

```text
backend/api/                 FastAPI、认证、任务、数据包导出
backend/data/                正式 CSV/JSON 和导出的 dashboard-data
backend/broker_sources/      券商官网来源选择与采集
backend/python-*/            金采网公告爬虫
broker-app-watch/            券商 App 更新采集与结构化
frontend/src/features/       完整前端业务模块
frontend-coze/src/           纯前端静态看板
shared/dashboard-data/       两个前端共用的 Schema
```

复杂清洗、去重、归一化、分类、统计和排序字段在后端导出层完成；前端只做筛选、简单排序、分页和展示。

## 常用验证

```bash
./.venv/bin/python -m unittest discover -s backend/api -p 'test*.py'
cd frontend && pnpm run ts-check && pnpm run lint:build
cd ../frontend-coze && pnpm data:check && pnpm ts-check && pnpm lint
```

生产静态构建：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

## 文档导航

- [运行与发布](docs/operations.md)：本地启动、静态部署、Windows 发布和排障。
- [架构边界](docs/architecture.md)：模块职责和标准数据包流程。
- [完整前端](frontend/README.md)：正式看板开发与样式约束。
- [纯前端](frontend-coze/README.md)：数据包复制、校验和静态部署。
- [官网来源采集](backend/broker_sources/README.md)：券商官网与金采网的来源选择。
- [金采网爬虫](backend/python-http-www-cfcpn-com-jcw/README.md)：公告抓取命令和输出目录。
- [App Watch](broker-app-watch/README.md)：券商 App 更新采集与刷新。

`AGENTS.md` 及各目录下的 `AGENTS.md` 是开发约束，不是运行手册；修改代码前请先阅读对应文件。
