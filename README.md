# 券商招采智能分析系统

这是一个公司内部情报看板：管理员可以采集和结构化招采公告、匹配采购与结果公告、更新券商 App 数据、生成 AI 情报和邮件报告，并管理用户、审计、反馈与看板数据包。审批用户登录后可浏览招采、App 更新和自定义情报页面。

## 主要能力

- 金采网及已配置券商官网公告采集、采购/结果公告 LLM 结构化与项目匹配
- 招采看板、App 更新看板、AI 摘要与标准数据包导入/导出
- 自定义情报搜索、报告持久化、PDF 与可配置 SMTP 邮件发送
- 管理员任务/SSE 日志、用户审批、反馈、审计与 AI 技术配置
- 独立定时调度器，以及 Windows Docker Compose + Nginx 发布流程

## 快速开始

正式推荐 Git、Python 3.11、Node.js >=20.9 和 Corepack。项目通过 Corepack 使用 `package.json` 声明的 pnpm 9，并以 `frontend/pnpm-lock.yaml` frozen 安装；Docker 仅为生产式部署必需。

第一次接手不要只复制开发目录。先确认交付提交已经推送到接手人能访问的远端，再从空目录执行：

```bash
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
git status --short
git rev-parse --short HEAD

python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -c requirements-lock.txt
.venv/bin/python -m pip check

cd frontend
corepack pnpm --version
corepack pnpm install --frozen-lockfile
cd ..

cp .env.example .env
```

`git status --short` 应没有输出；`corepack pnpm --version` 应显示 `9.0.0`。用文本编辑器打开根 `.env`，至少把 `ADMIN_PASSWORD` 和 `SCHEDULER_TOKEN` 改为两个不同的强随机值，不要把真实凭据提交到 Git。

先做离线验收：

```bash
.venv/bin/python -m pytest -q
cd frontend
corepack pnpm run ts-check
corepack pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= corepack pnpm build
cd ..
RUN_FRONTEND_STATIC_SMOKE=1 .venv/bin/python -m pytest -q backend/api/tests/test_route_ownership.py -k static_export
```

构建完成后可先用单进程 FastAPI 同源托管生产静态页面：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

访问 `http://127.0.0.1:8000`、`http://127.0.0.1:8000/api/health` 和 `http://127.0.0.1:8000/docs`。新 Clone 不含业务运行数据；管理员登录后在“管理控制台 → 数据管理”选择可信 ZIP，先预览再确认导入，即可恢复招采、App 更新、AI 摘要以及可选的匹配增量基线。用户、审计、自定义情报、邮件配置和密钥不在数据包内，需在目标环境单独初始化。

Windows PowerShell、双终端开发启动、逐项成功标志、数据导入后的重启复核和故障处理，请严格按 [docs/OPERATIONS.md](docs/OPERATIONS.md) 执行。无需启动前端时，操作手册第 12 节给出了纯终端启动采集/Pipeline、查询日志、取消任务、设置日期窗口、LLM/采集 worker、请求节流和 Cron 调度的完整命令。

百度检索 API、共享 LLM API 和 SMTP 发件配置均可在“管理控制台 → 情报技术配置”维护。百度 Endpoint 与端口、DeepSeek/OpenAI-compatible Base URL 与端口，以及 SMTP 主机与端口均可独立调整；密钥仅返回掩码，查看原值需要二次验证管理员密码。

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
corepack pnpm run ts-check
corepack pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= corepack pnpm build
```

真实爬虫、搜索、LLM、SMTP 和生产发布需要对应网络与凭据；离线测试通过不代表这些外部链路已联调。Python 依赖统一由根 `requirements.txt` 配合 `requirements-lock.txt` constraints 安装，Docker 构建也使用同一 constraints。

最近一次独立临时 Clone 模拟以提交 `ad5dbb0`（2026-08-12）为代码基线；详细执行结果和未验证项见操作手册第 16 节。后续版本需重新验证，不把某次测试通过数量当作长期事实。

## 文档入口

- [AGENTS.md](AGENTS.md)：未来 Codex / AI Agent 的修改边界与验证规则。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：真实架构、模块职责、数据流与外部依赖。
- [docs/OPERATIONS.md](docs/OPERATIONS.md)：从零安装、启动、数据恢复、发布与排障。
