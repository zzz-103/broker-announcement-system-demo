# 本地测试快速启动

本文用于 macOS 本地人工测试，不是生产部署方案。

## 前提条件

- Python 3.11+
- Node.js 18+
- pnpm 9+
- 项目根目录已有 `.env`
- `backend/config/llm_api_config.json` 已配置（运行真实 LLM 任务时需要）

首次使用时，在项目根目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
cd broker-app-watch
.venv/bin/python -m pip install -e ".[dev]"
cd ../frontend
pnpm install
cd ..
```

## 启动后端

终端一：

```bash
cd /Volumes/zhuzhuxia1T/broker-announcement-system-demo
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

确认后端正常：

```bash
curl http://127.0.0.1:8000/api/health
```

应返回：`{"status":"ok"}`。

## 启动前端

终端二：

```bash
cd /Volumes/zhuzhuxia1T/broker-announcement-system-demo/frontend
pnpm dev
```

打开 http://localhost:3000。

本地开发使用 `frontend/.env.local` 中的：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

不要在该变量后面追加 `/api`，前端客户端会自动拼接接口路径。

## 人工验收流程

1. 使用根目录 `.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
2. 进入管理员控制台，点击“券商 App 更新”任务。
3. 查看任务进度和实时日志，等待任务结束。
4. 打开 http://localhost:3000/app-updates。
5. 验证 App 更新数据、筛选、图表、列表和详情抽屉。
6. 回到管理员控制台，验证任务运行期间按钮禁用，以及重复启动时的冲突提示。

App 更新任务由主 FastAPI 后端通过子进程调用 `broker-app-watch`，不需要单独启动 `broker_app_watch.api.main`。它会访问真实券商网站，并调用配置的 LLM；没有有效 LLM 配置时只能验证界面和 `dry-run`，不能完成真实任务。

## 单独检查 App Watch 配置

```bash
cd /Volumes/zhuzhuxia1T/broker-announcement-system-demo/broker-app-watch
.venv/bin/python -m broker_app_watch.cli check-config
.venv/bin/python -m broker_app_watch.cli dry-run
```

`dry-run` 不访问网站，也不写入业务数据。

## 常见问题

- 后端启动失败：确认命令在项目根目录执行，并确认 `.venv` 已安装 `backend/api/requirements.txt`。
- 页面无法调用接口：确认后端仍运行，并确认 `FRONTEND_ORIGIN` 包含 `http://localhost:3000`。
- 登录失败：后端不会回退到默认密码，请检查根目录 `.env` 的 `ADMIN_PASSWORD`。
- App 页面显示尚未生成数据：先在管理员控制台运行“券商 App 更新”任务。
- 修改根目录 `.env` 后：重启后端；修改 `frontend/.env.local` 后：重启前端。

## 与生产启动的区别

本地测试运行 `pnpm dev` 即可，不需要先执行 `pnpm build`，也不需要启动 scheduler。生产部署请参考 `operate.md`。
