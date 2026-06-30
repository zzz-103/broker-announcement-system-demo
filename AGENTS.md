# AGENTS.md

本仓库包含两个独立项目：`frontend` 和 `backend`。后续开发必须先阅读目标项目的实际代码，再修改文件；不得只依赖 README 或历史计划。

## 项目边界

- `frontend` 是独立 Next.js 项目，根目录为 `frontend/`。
- `backend` 是独立 Python 项目，根目录为 `backend/`。
- 不得合并两个项目的依赖、源码目录、构建产物或运行时目录。
- 不得让浏览器直接调用 Python 脚本。
- 不得让 Next.js 直接拼接并执行任意 shell 命令。
- Python 脚本只能由受控后端服务或受控运维入口以白名单参数调用。

## 依赖和运行时

- `frontend` 只能使用 `pnpm`，不得使用 npm 或 yarn 安装依赖。
- `backend` 使用 Python 3.11+ 和 `uv`。
- 新增依赖前必须确认现有依赖是否已满足需求。
- 每个阶段完成后必须运行对应测试、类型检查和构建检查。

## Secret 和安全

- 不得把 Secret、Token、密码、LLM API Key 写入代码或提交到 Git。
- 不得将 LLM API Key 放入任何 `NEXT_PUBLIC_*` 环境变量。
- 浏览器不得获得内部 LLM API Key、Python 服务 JWT 密钥、数据库路径、原始文件路径、shell 命令或任务执行参数细节。
- 日志不得打印 Secret、完整 Authorization header、LLM API Key、内部 JWT、数据库连接串或用户密码。
- 管理端能力必须校验登录、Session、角色和 CSRF/调用来源。

## 现有逻辑保护

- 不得重新实现现有爬虫逻辑。
- 不得重新实现现有增量 LLM 抽取逻辑。
- 不得用 mock 数据替代最终真实联调。
- 不得按 `markdown_file` 单字段简单去重；同一个 `markdown_file` 可能跨 broker 或因一份 Markdown 抽取多条记录而出现多行。
- 未经明确确认，不得运行全量爬虫、`--full-refresh`、`--llm-full-refresh` 或大范围覆盖性任务。
- 小范围调试必须使用限制参数，例如 `--brokers`、`--max-pages-per-broker`、`--max-links-per-broker`、`--max-files`。

## 数据发布

- 后端结构化 CSV 是真实数据源，前端静态 CSV 只能作为当前过渡形态。
- 后续联调应引入数据版本机制，避免前端或 API 读取半成品 CSV。
- 发布新数据时必须先校验字段、编码、行数、空值、重复键和聚合结果，再切换可见版本。

## 审计基线

当前审计发现：

- 前端主页面：`frontend/src/app/page.tsx`。
- 前端 AI Route：`frontend/src/app/api/ai-analysis/route.ts`。
- 前端当前读取静态 CSV：`frontend/public/data/announcement_table.csv`。
- 后端 pyproject：`backend/pyproject.toml`。
- 后端核心脚本：
  - `backend/modules/crawler_engine.py`
  - `backend/modules/llm_markdown_table_builder.py`
  - `backend/modules/run_crawler_then_llm.py`
- 后端真实结构化总表：`backend/documents/structured_announcements/announcement_table.csv`。

