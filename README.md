# 券商招采智能分析系统

这是一个公司内部情报看板：管理员可以采集和结构化招采公告、匹配采购与结果公告、更新券商 App 数据、生成 AI 情报和邮件报告，并管理用户、审计、反馈与看板数据包。审批用户登录后可浏览招采、App 更新和自定义情报页面。

## 主要能力

- 金采网及已配置券商官网公告采集、采购/结果公告 LLM 结构化与项目匹配
- 招采看板、App 更新看板、AI 摘要与标准数据包导入/导出
- 自定义情报搜索、报告持久化、PDF 与 126 邮箱发送
- 管理员任务/SSE 日志、用户审批、反馈、审计与 AI 技术配置
- 独立定时调度器，以及 Windows Docker Compose + Nginx 发布流程

## 快速开始

需要 Git、Python 3.10+、Node.js 20+、Corepack 和 pnpm 9。Docker 仅为生产式部署必需。

```bash
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
corepack prepare pnpm@9.0.0 --activate
cd frontend && pnpm install --frozen-lockfile && cd ..
```

编辑 `.env`，至少替换 `ADMIN_PASSWORD` 和 `SCHEDULER_TOKEN`。本地开发分别启动：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

访问 `http://localhost:3000`，健康检查为 `http://127.0.0.1:8000/api/health`。新 Clone 不含业务运行数据；管理员登录后在“管理控制台 → 前端数据包”导入可信的导出 ZIP，即可恢复招采、App 更新、AI 摘要以及可选的匹配增量基线，无需重跑历史爬虫。用户、审计、自定义情报、邮件配置和密钥不在数据包内，需在目标环境单独初始化。

Windows、生产 Compose、首次配置、数据导入/导出和故障处理见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 核心链路

```text
金采网 + 券商官网
→ 来源选择与空结果保护
→ 采购/结果 LLM 结构化
→ 规则候选 + LLM 复核 + 合并
→ 留存比例校验 + 原子发布
→ 可选 AI 分析
→ dashboard-data 标准包
→ FastAPI API → Next.js 静态前端
```

App Watch 和自定义情报是独立业务模块，复用同一个后端与认证，但不改变招采数据口径。完整架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```text
backend/api/              FastAPI、认证、任务、数据包、管理和情报 API
backend/broker_sources/   券商官网招采来源
backend/llm_table/        公告结构化
backend/matching/         采购/结果匹配
backend/broker_app_watch/ App 更新采集与处理
frontend/                 唯一正式 Next.js 前端
shared/dashboard-data/    前后端共享数据包契约
scripts/                  发布与无界面数据包导出
deploy/                   生产 Compose 与 Nginx 模板
docs/                     架构和操作手册
```

运行数据、SQLite、`.env`、真实 LLM 配置、资格名单、日志和构建产物均不进入 Git。

## 常用验证

```bash
.venv/bin/python -m pytest -q
cd frontend
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

真实爬虫、搜索、LLM、SMTP 和生产发布需要对应网络与凭据；离线测试通过不代表这些外部链路已联调。

## 文档入口

- [AGENTS.md](AGENTS.md)：未来 Codex / AI Agent 的修改边界与验证规则。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：真实架构、模块职责、数据流与外部依赖。
- [docs/OPERATIONS.md](docs/OPERATIONS.md)：从零安装、启动、数据恢复、发布与排障。
