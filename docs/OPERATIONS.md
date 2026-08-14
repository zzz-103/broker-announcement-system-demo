# 安装、运行与交接操作手册

本文面向第一次接手项目、机器上没有本仓库运行环境的维护者。首次使用只需完成依赖安装、创建 `.env`、构建前端、启动 API 和一次 health 检查；完整测试、外部服务和生产部署均按需执行。

最快流程：Clone 项目 → 安装 Python/前端依赖 → 复制并修改 `.env` → 构建前端 → 启动 FastAPI → 检查 health 并登录。新 Clone 没有业务数据属于正常情况，需要时再导入可信数据包。

## 1. 开始前准备

只做本地首次启动时，准备好 Git 仓库地址以及本环境使用的管理员密码和调度 Token 即可。新 Clone 不含业务数据；需要查看真实看板内容时，再准备由本系统导出的可信 `dashboard-data.zip`。

交接边界如下：

- Git 提交负责源码、测试、文档和非敏感示例配置。
- dashboard-data ZIP 负责 5 个标准看板数据集和可选 matching baseline。
- `.env`、LLM 配置、SMTP 授权码、资格名单和 SQLite 通过受控渠道单独交付。
- 不要直接复制上一位维护者的整个开发目录；其中可能混有虚拟环境、缓存、日志和本机路径。

## 2. 准备工具

正式推荐版本：

- Git：可正常 clone/pull；
- Python：3.11；
- Node.js：至少 20.9；
- Corepack：可用；
- pnpm：由 Corepack 按项目声明提供 9.0.0，不要求全局另装；
- Docker：只有生产式 Windows Compose 部署需要。

macOS/Linux 终端执行：

```bash
git --version
python3.11 --version
node --version
corepack --version
```

Windows PowerShell 执行：

```powershell
git --version
py -3.11 --version
node --version
corepack --version
```

命令能输出版本即可继续。Python 应为 3.11.x，Node 不低于 20.9；缺少 Corepack 时，安装带 Corepack 的 Node 发行版。

## 3. Clone 项目

选择一个新的父目录，不要 clone 到旧项目目录里面。

macOS/Linux：

```bash
cd ~/work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
```

Windows PowerShell 示例：

```powershell
Set-Location D:\work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
Set-Location broker-announcement-system-demo
```

若这是正式交接，再用 `git rev-parse HEAD` 核对交付提交号。后续后端命令均从仓库根执行。

## 4. 创建 Python 虚拟环境并安装固定依赖

### 4.1 macOS/Linux

从仓库根执行：

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -c requirements-lock.txt
```

### 4.2 Windows PowerShell

从仓库根执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c requirements-lock.txt
```

安装命令退出码为 0 即可。`requirements.txt` 和 `requirements-lock.txt` 必须像上面一样同时使用。

若公司网络下载大 wheel 较慢，可以只增加读取超时后重试：

```bash
.venv/bin/python -m pip install --timeout 300 -r requirements.txt -c requirements-lock.txt
```

Windows 将 `.venv/bin/python` 换成 `.\.venv\Scripts\python.exe`。网络超时不等于依赖冲突；只有命令最终退出 0 才算安装成功。不要为绕过一次网络问题擅自修改锁定版本。

## 5. 安装前端依赖

macOS/Linux：

```bash
cd frontend
corepack pnpm install --frozen-lockfile
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
corepack pnpm install --frozen-lockfile
Set-Location ..
```

安装命令退出码为 0 即可。必须保留 `--frozen-lockfile`；若提示 lockfile 不一致，请让代码维护者修复，不要在交接机器上重写 lockfile。

项目的 `frontend/next-env.d.ts`、`.next/`、`out/` 和 `node_modules/` 都是本地生成物并已忽略。Next.js 在 dev/build 间重写 `next-env.d.ts` 是正常行为，不要把它重新加入 Git。

## 6. 创建并填写本机配置

### 6.1 复制安全模板

macOS/Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

用文本编辑器打开根 `.env`，首次本地启动只需修改：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为本环境密码
SCHEDULER_TOKEN=请替换为另一个不同的值
SCHEDULER_ENABLED=false
```

不要把上面的中文占位文本或示例 `change-me` 当作真实值。`ADMIN_PASSWORD` 与 `SCHEDULER_TOKEN` 必须不同。首次启动不运行 scheduler，待调度联调时再启用。

保留本地前端来源：

```dotenv
FRONTEND_ORIGIN=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000
```

初次离线启动不需要填写百度、LLM 或 SMTP 凭据。保持以下功能关闭或留空即可：

- `BAIDU_QIANFAN_API_KEY=`；
- SMTP 用户名、发件地址和授权码留空；
- `CUSTOM_INTELLIGENCE_EMAIL_ENABLED=false`；
- 不创建真实 `backend/config/llm_api_config.json`，除非已经通过受控渠道拿到配置。

若要启用用户申请，再复制资格名单模板并用真实受控名单替换示例：

```bash
cp backend/config/user_qualification.example.csv backend/config/user_qualification.csv
```

Windows 使用：

```powershell
Copy-Item backend\config\user_qualification.example.csv backend\config\user_qualification.csv
```

`.env`、真实资格名单、运行数据库和构建产物均不应提交到 Git。

## 7. 构建前端

首次使用无需先跑整套 pytest、类型检查、lint 或静态 smoke，直接构建前端即可。

macOS/Linux：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL= corepack pnpm build
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
$env:NEXT_PUBLIC_API_BASE_URL=""
corepack pnpm build
Remove-Item Env:NEXT_PUBLIC_API_BASE_URL
Set-Location ..
```

空 `NEXT_PUBLIC_API_BASE_URL` 表示静态页面与 FastAPI 同源。命令完成并生成 `frontend/out` 即可。

## 8. 启动并做最小调试

完成生产构建后，FastAPI 会同源托管 `frontend/out`。这是一条最简单的首次启动链路。

在终端一、仓库根执行：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

不要把 `--workers 1` 改成多 worker。Session、任务状态、互斥锁和日志在进程内。

看到 `Application startup complete` 后，只做两项检查：

1. 打开 `http://127.0.0.1:8000/api/health`，应返回 `{"status":"ok"}`；
2. 打开 `http://127.0.0.1:8000/`，使用 `.env` 中的管理员账号登录。

若页面打不开，先在另一个终端检查 health：

```bash
curl --fail http://127.0.0.1:8000/api/health
```

Windows PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

health 正常但页面异常时，重新执行第 7 节构建；health 也失败时，查看启动终端最后一段报错，优先检查 `.env`、依赖安装和 8000 端口占用。首次启动无需先跑整套测试。

第一次启动和登录会按需创建被忽略的 `backend/data/users.db` 和 `backend/data/audit.db`，属于正常初始化。需要接口调试时再访问 `http://127.0.0.1:8000/docs`。用 `Ctrl+C` 停止服务。

## 9. 日常开发：后端和 Next.js 分两个终端

需要热更新时，不使用上一节的单端口方式。

终端一，从仓库根启动 FastAPI：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

终端二，进入前端目录：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 corepack pnpm dev
```

Windows：

```powershell
Set-Location frontend
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"
corepack pnpm dev
```

打开 `http://localhost:3000`。依次确认四个页面可打开，浏览器请求指向 8000 端口 API。两个终端都用 `Ctrl+C` 停止。若 3000 已占用，可临时设置 `PORT=3001`；同时把该来源加入本机 `.env` 的 `FRONTEND_ORIGIN` 并重启 API。

## 10. 从可信数据包恢复业务数据

### 10.1 导出端先准备 ZIP

在已有数据的环境中，管理员可在“管理控制台 → 数据管理”点击“导出当前包”，也可从仓库根执行：

```bash
.venv/bin/python scripts/export_dashboard_data.py --zip
```

交付前记录 ZIP 文件名、生成时间、包版本和 Manifest 中各数据集数量。通过受控方式传给新环境，不要重新解压、编辑后再压缩。

包内必须包含 Manifest 和 5 个标准数据集；Manifest 声明相应基线可用时还会包含 `matching_baseline.json` 与 `app_watch_baseline.csv`。App Watch 基线携带内容哈希、来源身份和结构化历史，可让接收设备跳过未变化来源，避免重复调用 LLM。旧包可从展示记录兼容恢复有限 App 基线，但无法还原此前已合并的多来源快照，预览页会明确提示。ZIP 不包含用户、审计、自定义情报、邮件配置、资格名单、`.env` 或 LLM 密钥。

### 10.2 新 Clone 用管理页导入

1. 按第 8 节启动已构建的 FastAPI，或按第 9 节启动两个开发服务。
2. 用新环境 `.env` 中的管理员账号登录。
3. 进入 `/admin`，找到“数据管理”。
4. 点击“选择 ZIP 预览”，选择交付的可信 ZIP。
5. 核对包版本、生成时间、招采期间、招采数量、App 更新期间/数量和 AI 分析状态。
6. 如果出现警告，先判断是否符合交接预期；不要在不理解警告时直接导入。
7. 预览有效后点击“确认导入”。
8. 等待“导入成功”提示，确认卡片显示“当前：导入包”或 imported 来源正在使用。
9. 分别打开招采、App 更新和 AI 页面。页面会按产品规则筛选展示，页面数字不一定等于 Manifest 全量数；管理页数据源摘要应与 Manifest 一致。

### 10.3 停止、重启并复核持久化

1. 用 `Ctrl+C` 停止 API；
2. 使用第 8 或第 9 节的同一命令重新启动；
3. 重新登录；
4. 回到“数据管理”，确认当前来源仍是“导入包”；
5. 再次打开招采/App/AI 页面，确认数据仍可读取；
6. 点击“导出当前包”，将新导出的 ZIP 再做一次预览，确认它仍有效。

原始导入包、按完整 SHA-256 归档的 `origins/*.zip`、可演进当前工作包和 source 偏好保存在 `DASHBOARD_DATA_EXPORT_DIR`。选择 imported 后，成功的 App Watch、完整 Pipeline 和 AI 分析会分别提升当前工作包；未更新的数据集继续保留导入基线，内容寻址的原始导入 ZIP 保持不变。生产 Compose 必须把其所在的 `backend/data` 持久化挂载。要恢复 live 来源，只能在管理页选择可用的“实时源”；不要手工修改 `source-preference.json`。

## 11. 外部服务与调度器按需启用

### 11.1 百度、共享 LLM 和 SMTP

初次离线交接通过后，再进入“管理控制台 → 情报技术配置”逐项配置和测试：

1. 百度搜索 API Key；
2. DeepSeek/OpenAI-compatible base URL、模型和 Key；
3. SMTP 主机、端口、SSL、用户名、发件地址和授权码。

SMTP 用户名和发件地址填写同一个有效邮箱。配置保存后再点“测试已保存配置”；连接测试只完成 SMTP 登录，不发送邮件。GET 配置只返回授权码掩码，查看完整授权码需要管理员密码二次验证。

管理页配置保存在 `USER_DB_PATH`（或独立的 `CUSTOM_INTELLIGENCE_DB_PATH`），优先于 `.env` 回退值。生产必须持久化该数据库；dashboard-data ZIP 不会恢复这些配置。

### 11.2 独立调度器

只有 API 已运行、`.env` 中 `SCHEDULER_TOKEN` 在 API 和 scheduler 侧一致、且确认允许按 cron 触发任务后，才在第三个终端执行：

```bash
.venv/bin/python -m backend.api.scheduler
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m backend.api.scheduler
```

调度器是独立进程。停止 API 不会自动停止调度器，反之亦然；分别用 `Ctrl+C` 停止。

真实采集、搜索、LLM、SMTP 和完整 Pipeline 必须有明确授权、网络和凭据。离线测试通过不代表这些外部链路已经联调。

## 12. 不启动前端：仅用终端控制采集与 Pipeline

本节所有命令都从仓库根执行，不需要构建或启动 Next.js 前端。真实采集和 LLM 调用仍需事先取得授权，并准备网络、真实 `backend/config/llm_api_config.json` 和对应凭据。命令成功会写入被 Git 忽略的运行目录，操作前应确认当前环境的数据备份和发布口径。

有两种终端用法：

- **完整任务**：只启动单 worker FastAPI，再从另一个终端调用任务 API。推荐日常使用，因为它保留全局互斥、取消、SSE 日志、退出码判断、发布保护和 AI 分析。
- **单独阶段**：直接执行模块 CLI。适合限量采集、调试某个来源或控制单阶段并发；它不会自动获得 API 的全局任务锁，也不会自动完成后续匹配和安全发布。

不要同时运行任务 API 和同一数据目录上的直接 CLI。直接 CLI 可能与 API 任务并发写入；已知任务可先用状态接口检查，不确定 API 是否正在执行任务时就不要启动直接 CLI。

### 12.1 终端启动完整任务（推荐）

终端一只启动后端 API，不启动前端：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

`--workers 1` 不得调大。这里的 FastAPI worker 是服务进程数，Session、任务状态、互斥锁和日志都在进程内；它与下面可调的采集/LLM 并发不是同一个概念。

macOS/Linux 在终端二登录并把 Token 保存在当前 shell 内存中。密码采用隐藏输入，不要把密码直接写进命令历史：

```bash
API_BASE=http://127.0.0.1:8000
printf '管理员用户名: '
IFS= read -r ADMIN_USER_INPUT
printf '管理员密码: '
IFS= read -rs ADMIN_PASSWORD_INPUT
printf '\n'

LOGIN_BODY=$(printf '%s\0%s' "$ADMIN_USER_INPUT" "$ADMIN_PASSWORD_INPUT" | \
  .venv/bin/python -c 'import json, sys; u, p = sys.stdin.buffer.read().split(b"\0", 1); print(json.dumps({"username": u.decode(), "password": p.decode(), "source": "terminal"}))')
LOGIN_RESPONSE=$(printf '%s' "$LOGIN_BODY" | curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "$API_BASE/api/login")
API_TOKEN=$(printf '%s' "$LOGIN_RESPONSE" | .venv/bin/python -c 'import json, sys; print(json.load(sys.stdin)["token"])')
unset ADMIN_PASSWORD_INPUT LOGIN_BODY LOGIN_RESPONSE
```

启动完整 Pipeline，并从响应中取得任务 ID：

```bash
JOB_RESPONSE=$(curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/jobs/pipeline")
JOB_ID=$(printf '%s' "$JOB_RESPONSE" | .venv/bin/python -c 'import json, sys; print(json.load(sys.stdin)["job_id"])')
printf 'JOB_ID=%s\n' "$JOB_ID"
```

持续查看 SSE 日志；首包包含 2KB 注释填充，刚连接时短暂无业务文本是正常现象：

```bash
curl --no-buffer --fail --silent --show-error \
  -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/jobs/$JOB_ID/events"
```

按需查询最终状态或取消任务：

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/jobs/$JOB_ID" | .venv/bin/python -m json.tool

curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/jobs/$JOB_ID/cancel" | .venv/bin/python -m json.tool
```

退出当前 shell 前执行 `unset API_TOKEN ADMIN_USER_INPUT JOB_ID JOB_RESPONSE`。任务返回 `409` 表示已有互斥任务或数据包操作；等待现有任务结束，不要通过直接 CLI 绕开互斥。

可将启动 URL 换成以下任务入口：

| 任务 | 方法与 URL | 请求体 |
| --- | --- | --- |
| 双公告采集与来源准备 | `POST /api/jobs/scraper` | 无 |
| 增量结构化与匹配 | `POST /api/jobs/llm` | 无，或 `{}` |
| 全量重建结构化与匹配 | `POST /api/jobs/llm` | `{"mode":"full_refresh","overwrite":true}`；会重跑全部 LLM 输入，谨慎使用 |
| 完整采集、结构化、匹配、发布和可选分析 | `POST /api/jobs/pipeline` | 无 |
| App 更新采集与结构化 | `POST /api/jobs/app-watch` | 无 |

完整 Pipeline 入口没有 `full_refresh` 或 worker 请求参数：它按既有增量口径运行，并从 `.env` 读取内部并发配置。表中的“全量重建”只重跑 LLM 结构化与匹配，不执行采集和正式发布。

Windows PowerShell 可用相同 API，不需要手工处理 JSON 转义：

```powershell
$ApiBase = 'http://127.0.0.1:8000'
$Credential = Get-Credential -Message '输入管理员账号和密码'
$LoginBody = @{
    username = $Credential.UserName
    password = $Credential.GetNetworkCredential().Password
    source = 'terminal'
} | ConvertTo-Json
$Login = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/login" -ContentType 'application/json' -Body $LoginBody
$Headers = @{ Authorization = "Bearer $($Login.token)" }
$Job = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/jobs/pipeline" -Headers $Headers
$Job
```

PowerShell 轮询状态和取消任务：

```powershell
do {
    $State = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/jobs/$($Job.job_id)" -Headers $Headers
    $LastEvent = $State.events | Select-Object -Last 1
    "{0}  {1}" -f $State.status, $LastEvent.message
    if ($State.status -in @('running', 'pending')) { Start-Sleep -Seconds 10 }
} while ($State.status -in @('running', 'pending'))

Invoke-RestMethod -Method Post -Uri "$ApiBase/api/jobs/$($Job.job_id)/cancel" -Headers $Headers
```

### 12.2 完整任务的日期、请求并发和工作量控制

完整任务从根 `.env` 读取以下参数。修改后必须重启 API；不要只重启前端或 scheduler。

| 参数 | 默认示例 | 作用 |
| --- | --- | --- |
| `SCRAPER_LOOKBACK_DAYS` | `20` | 金采网采集起点为调度时区“当天减 N 天”；只接受 1–365 |
| `OFFICIAL_SOURCE_SINCE_DATE` | `2026-04-01` | 券商官网直采的最早公告日期，格式必须为 `YYYY-MM-DD` |
| `LLM_WORKERS` | `4` | 采购/结果公告结构化线程数；也作为未单独配置时的 LLM 请求并发和匹配并发默认值 |
| `LLM_MATCHING_WORKERS` | `4` | 采购/结果关联的 LLM 双重复核线程数 |
| `MATCHING_MAX_CANDIDATES` | `5` | 每条结果公告最多交给匹配阶段的候选数；它不是进程数，但会影响 LLM 工作量 |
| `PIPELINE_ANALYSIS_ENABLED` | `true` | 完整 Pipeline 发布后是否生成 AI 分析 |
| `PIPELINE_ANALYSIS_DAYS` | `30` | AI 分析统计窗口天数 |

例如只回看最近 7 天、将两个 LLM 阶段都限制为 2 个工作线程：

```dotenv
SCRAPER_LOOKBACK_DAYS=7
OFFICIAL_SOURCE_SINCE_DATE=2026-08-06
LLM_WORKERS=2
LLM_MATCHING_WORKERS=2
```

`LLM_WORKERS` 和 `LLM_MATCHING_WORKERS` 必须是大于等于 1 的整数。并发越高，外部 API 限流、费用和本机内存压力越大；不确定上游配额时先用 `1` 或 `2`。完整 Pipeline 内部会并行运行“金采网分支”和“券商官网分支”，这两个固定分支不通过 FastAPI `--workers` 调整。

### 12.3 直接控制券商官网采集

采集全部已启用官网来源，限制日期、页数和详情并发：

```bash
.venv/bin/python -u -m backend.broker_sources.cli collect \
  --since-date 2026-08-01 \
  --max-pages 20 \
  --workers 4 \
  --resume
```

只采集指定券商，可重复传 `--broker`。当前配置 key 可在 `backend/broker_sources/sources.json` 查看，例如：

```bash
.venv/bin/python -u -m backend.broker_sources.cli collect \
  --broker citic_securities \
  --broker huaxi_securities \
  --since-date 2026-08-01 \
  --max-pages 10 \
  --workers 2 \
  --resume
```

`--workers` 是每个官网采集器下载公告详情的线程数；默认 8。`--resume` 从未完成 checkpoint 继续，`--overwrite` 会重新下载已有详情，后者只在确认需要覆盖时使用。采集完后若要生成 Pipeline 使用的统一、去重输入，再执行：

```bash
.venv/bin/python -u -m backend.broker_sources.cli prepare
```

### 12.4 直接控制金采网采集时间和节流

采购公告和结果公告必须分别运行。以下示例从指定日期开始、最多检查 100 条，并控制详情请求、翻页、批次休息和 403 冷却时间：

```bash
.venv/bin/python -u backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper.py \
  --notice-type procurement \
  --since-date 2026-08-01 \
  --max-items 100 \
  --delay-min 20 --delay-max 40 \
  --page-delay-min 3 --page-delay-max 6 \
  --batch-size 20 --batch-rest-min 60 --batch-rest-max 120 \
  --forbidden-cooldown-min 90 --forbidden-cooldown-max 180 \
  --max-consecutive-403 2 \
  --output-dir output \
  --update --resume

.venv/bin/python -u backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper.py \
  --notice-type result \
  --since-date 2026-08-01 \
  --max-items 100 \
  --delay-min 20 --delay-max 40 \
  --page-delay-min 3 --page-delay-max 6 \
  --batch-size 20 --batch-rest-min 60 --batch-rest-max 120 \
  --forbidden-cooldown-min 90 --forbidden-cooldown-max 180 \
  --max-consecutive-403 2 \
  --output-dir output \
  --update --resume
```

这里的 `output` 会由脚本解析到自身目录下的正式输出目录。金采网采集器没有并发 `workers` 参数，而是通过请求间隔、翻页间隔、批次休息和 403 熔断控制访问速度。`--end-page` 可限制结束页，`--known-pages-stop` 可控制增量模式连续多少个旧页后停止；先用 `--help` 查看完整参数。不要为了追求速度把所有间隔设为 0。

### 12.5 直接控制 LLM 结构化和 App Watch

单独处理已经准备好的采购公告，可同时限制工作线程、在途 API 请求数、单请求超时和请求启动间隔：

```bash
.venv/bin/python -u -m backend.llm_table.llm_markdown_table_builder \
  --notice-type procurement \
  --input-dir backend/python-http-www-cfcpn-com-jcw/output/selected/procurement/notices \
  --output-dir backend/data/staging \
  --llm-config backend/config/llm_api_config.json \
  --workers 4 \
  --max-concurrent-requests 2 \
  --timeout-seconds 120 \
  --min-interval-seconds 1 \
  --incremental \
  --prune-missing-files
```

处理结果公告时把 `--notice-type` 改为 `result`，输入目录改为 `.../selected/result/notices`，输出目录改为 `backend/data/staging/result`。`--workers` 控制本地线程，`--max-concurrent-requests` 是外部 LLM 同时在途请求上限；后者可小于线程数。`--full-refresh --overwrite` 会忽略现有索引并重跑全部输入，只在明确需要全量重建时使用。

App Watch 可先离线检查配置和计划，再按需采集或执行带 LLM 的完整刷新：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli list-sources
.venv/bin/python -m backend.broker_app_watch.cli dry-run
.venv/bin/python -u -m backend.broker_app_watch.cli crawl --all
.venv/bin/python -u -m backend.broker_app_watch.cli refresh \
  --all \
  --llm-config backend/config/llm_api_config.json \
  --export-path backend/data/broker_app_watch/exports/app_releases.csv
```

`dry-run` 不联网。当前 App Watch CLI 没有 worker 或请求间隔参数，不要给它传入不存在的参数。

App Watch 支持券商官网/API、指定页面、OCR 来源和 Apple 公开 Lookup API。新增 Apple 来源时必须固定 `track_id`，并配置对应的 `apps.apple.com` 公开页作为 `source_url`；不要用搜索关键词动态选择 App。正式 CSV 保留原始平台记录，看板按版本事件合并。官方没有披露可靠变更时摘要保持为空，页面显示“官方未披露本次更新内容”，不要以产品介绍或下载元数据补齐。

直接运行结构化或 App Watch 不等于完整招采发布。规则候选、LLM 双重复核、合并和安全发布的路径参数相互依赖；需要正式更新 `backend/data/announcement_table.csv` 时，使用 12.1 的完整 Pipeline，避免手工拼接阶段遗漏发布保护。

### 12.6 定时运行、时区和 scheduler 进程控制

定时任务仍不需要前端，但需要单 worker API 持续运行。根 `.env` 示例：

```dotenv
SCHEDULER_ENABLED=true
SCHEDULER_TIMEZONE=Asia/Shanghai
SCHEDULER_CRON=0 7 * * mon-fri
SCHEDULER_API_URL=http://127.0.0.1:8000
SCHEDULER_TOKEN=请替换为与API一致的独立强随机值

APP_WATCH_SCHEDULER_ENABLED=true
APP_WATCH_SCHEDULER_CRON=30 7 * * mon-fri
```

`SCHEDULER_CRON` 和 `APP_WATCH_SCHEDULER_CRON` 都是 5 段表达式：`分 时 日 月 星期`。时间按 `SCHEDULER_TIMEZONE` 解释。

| 目标时间 | Cron |
| --- | --- |
| 每天 07:00 | `0 7 * * *` |
| 每周日 12:00 | `0 12 * * sun` |
| 工作日 07:00 | `0 7 * * mon-fri` |
| 每 30 分钟 | `*/30 * * * *` |

先按 12.1 启动 API，再在另一个终端启动 scheduler：

```bash
.venv/bin/python -m backend.api.scheduler
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m backend.api.scheduler
```

修改 Cron、时区或 Token 后必须重启 scheduler。每个调度项最多同时运行一个实例，错过的触发会合并，允许的误触发宽限为 1 小时；API 侧还有全局任务互斥，因此 Pipeline 与 App Watch 时间重叠时，后触发者会收到 `409` 并跳过，不会强行并跑。为减少冲突，应把两个 Cron 错开，并按最长历史运行时间预留间隔。

只运行一个 scheduler 进程或 Compose 副本，不要对 `backend-scheduler` 执行 scale。`max_instances=1` 只约束单个 scheduler 进程，多个副本之间没有跨进程协调。

本地后端 Compose 也可以只启动 API 和 scheduler，不启动任何前端服务：

```bash
docker compose up -d backend-api backend-scheduler
docker compose logs -f backend-api backend-scheduler
docker compose stop backend-scheduler
```

停止 API 不会自动停止独立 scheduler，反之亦然。终端直接运行时分别用 `Ctrl+C`；Compose 运行时分别用 `docker compose stop backend-api` 和 `docker compose stop backend-scheduler`。

### 12.7 参数自查和长期入口

代码升级后，以实际 `--help` 为准，不从旧文档猜参数：

```bash
.venv/bin/python -m backend.broker_sources.cli collect --help
.venv/bin/python backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper.py --help
.venv/bin/python -m backend.llm_table.llm_markdown_table_builder --help
.venv/bin/python -m backend.matching.llm_matcher --help
.venv/bin/python -m backend.broker_app_watch.cli --help
```

长期人工入口如下：

| 入口 | 用途 | 使用方式 |
| --- | --- | --- |
| `scripts/export_dashboard_data.py` | 无界面导出标准数据包 | 从仓库根用当前后端 Python 执行 |
| `scripts/deploy-release.ps1` | Windows 构建、发布、健康检查与回滚 | 必须显式传 `-Version` 和 `-DeployDir` |
| `python -m backend.api.scheduler` | 定时触发完整 Pipeline / App Watch | API 必须已运行，Token、时区和 Cron 由 `.env` 控制 |
| `python -m backend.broker_sources.cli` | 官网公告采集与来源准备 | 支持日期、页数和详情 worker 控制 |
| `python -m backend.broker_app_watch.cli` | App 更新检查、采集和结构化 | 先运行 `check-config`、`dry-run` |

金采网、LLM 结构化和 matching 仍是正式 Pipeline 内部阶段，由 `JobCommandFactory` 以固定路径和参数调用；本节列出的单阶段 CLI 是运维/调试入口，不建立第二套 Pipeline 包装脚本。前端命令统一由 `frontend/package.json` 管理，仓库不维护重复的 `.sh`、`.cmd` 或旧平台启动包装。

## 13. Windows 生产部署

源码目录与生产运行目录分开。首次准备 `D:\broker-system`：

1. 将 `deploy/docker-compose.example.yml` 复制为 `D:\broker-system\docker-compose.yml`；
2. 创建生产 `.env`，设置 `BROKER_VERSION`、`BROKER_PUBLIC_URL`、管理员密码、调度 Token 和所需配置；
3. 创建 `runtime\data`、`runtime\scraper-output`、`runtime\app-watch-data`、`runtime\config`；
4. 在 `runtime\config` 放置受限的 `llm_api_config.json` 和 `user_qualification.csv`；
5. 首次部署时，在 API 启动前将现有 `users.db`、`audit.db` 放入 `runtime\data`；这些文件与 `.env` 均应通过受控渠道交付并限制为仅部署账号可读写；
6. 执行 `docker compose config`，确认三服务配置能展开且没有缺失变量。

发布前确认源码分支、提交号和工作树：

```powershell
Set-Location D:\broker-announcement-system-demo
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin
git status --branch --short
```

`git status --short` 必须无输出，交付提交必须已在远端。`frontend/package.json` 版本必须等于发布版本。然后执行：

```powershell
.\scripts\deploy-release.ps1 -Version 1.9.0 -DeployDir D:\broker-system
```

脚本使用 buildx 将 backend/frontend 统一构建为 `linux/amd64`，验证三个 Compose 服务和镜像架构，更新生产 `.env`，重建容器，检查 API、首页和 `version.json`，失败时尝试回滚。frontend 镜像已包含 Nginx、静态文件和反向代理配置；生产访问默认为 `http://localhost:8080`。不要在生产运行目录执行 `git pull`，也不要绕过脚本直接更新版本。

根 `docker-compose.yml` 只有 backend-api/backend-scheduler，适合后端开发验证；完整生产拓扑以 `deploy/docker-compose.example.yml` 为准。FastAPI 始终保持一个 worker。

## 14. 常见故障按顺序排查

- `git status --short` 刚 Clone 就有输出：确认是否 clone 到旧目录、是否运行过会改 tracked 文件的旧脚本；不要直接删除不认识的文件。
- 找不到 Python 3.11：安装 3.11 后重新创建 `.venv`，不要让 3.10/3.12 的虚拟环境冒充正式交接环境。
- pip 下载超时：保留 requirements + constraints，使用 `--timeout 300` 重试或配置公司批准的镜像；不要擅自改版本。
- frozen lockfile 失败：确认 Git 提交正确；不要在交接机上运行会改 lockfile 的安装命令。
- 后端无法启动：从仓库根运行，确认 `.env` 已创建、管理员密码已替换、8000 端口未占用，然后查看启动终端最后一段报错。
- 前端无法连接 API：检查 `NEXT_PUBLIC_API_BASE_URL`、`FRONTEND_ORIGIN` 和端口；后端重启后需重新登录。
- 页面 404：确认已按第 7 节执行前端构建且 `frontend/out` 存在，然后重启 API。
- 当前没有可用看板数据：新 Clone 的正常初始状态；导入可信 dashboard-data ZIP，不要为补历史数据直接重跑完整 Pipeline。
- 导入失败：使用系统原样导出的 ZIP，检查 Manifest/schema/hash/count、可选 baseline 和 64 MiB 限制；不要自行重打包混入数据库或密钥。
- 导入后重启丢失：检查 `DASHBOARD_DATA_EXPORT_DIR` 是否位于持久化的 `backend/data` 下，生产 Compose 是否挂载 `./runtime/data:/app/backend/data`。
- 任务返回 409：已有互斥任务或数据包操作；等待完成，或通过管理页取消对应任务。
- App Watch 配置失败：先运行 `check-config` 和 `dry-run`；dry-run 不联网，可用于区分配置问题和网络问题。
- 搜索/LLM 失败：在“情报技术配置”检查服务端 Key、模型、base URL 和连接测试；503 常见于未配置，504 为上游超时。
- 邮件失败：确认主机/端口/SSL、用户名/发件地址、授权码和网络放行；不要把授权码打印到终端或提交到 Git。
- Docker 构建或启动失败：确认 Docker Compose v2、buildx、运行目录模板和受限配置齐全，先执行 `docker compose config`，再查看三个服务日志。本项目没有 Redis/Celery。

## 15. 正式交接清单

以下清单用于正式交接，不是首次本地启动的前置步骤：

- [ ] 交付提交号与新 Clone 的 `git rev-parse HEAD` 一致，并且远端可访问；
- [ ] Python 和前端依赖安装成功；
- [ ] `.env` 已使用新环境的两个不同秘密值，未提交真实凭据；
- [ ] 前端构建成功，FastAPI 单 worker 启动，health 正常且管理员可以登录；
- [ ] 可信 ZIP 预览、导入成功，source 为 imported；
- [ ] API 重启后 imported 来源和数据仍可读取；
- [ ] 外部采集/搜索/LLM/SMTP/生产发布中未执行的项目已明确写成“未验证”；
- [ ] 母仓库执行 `git status --short` 无输出，没有把 `.env`、SQLite、ZIP、构建产物或缓存加入 Git。

## 16. 历史验证说明

仓库曾在 MAC 测试环境独立临时 Clone 中完成依赖安装、前端构建、单 worker FastAPI 启动、管理员登录和数据包导入验证。该记录仅说明链路曾可用，不能代表在Windows环境中可用，不能替代当前环境的 health 与登录检查；真实爬虫、搜索、LLM、SMTP、调度器和生产发布仍须在获得授权后分别验证。
