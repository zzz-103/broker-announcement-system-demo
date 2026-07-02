# 券商招采智能分析系统启动操作文档

> 适用环境：Windows 10 / Windows 11、PowerShell、本地或公司内网部署。
>
> 默认项目目录：`D:\broker-announcement-system-demo`
>
> 默认后端地址：`http://localhost:8000`
>
> 默认前端地址：`http://localhost:3000`

---

## 1. 系统组成

本系统由三部分组成：

1. **FastAPI 后端服务**

   * 管理员登录认证。
   * 启动爬虫和 LLM 任务。
   * 通过 SSE 实时返回任务日志。
   * 向前端提供看板数据接口。

2. **Next.js 前端**

   * 管理员登录。
   * 运行爬虫和 LLM。
   * 实时查看任务日志。
   * 展示结构化招采数据看板。

3. **Python 数据处理脚本**

   * 爬虫将公告保存为 Markdown。
   * LLM 将 Markdown 转换为结构化 CSV。
   * FastAPI 读取 CSV 并提供给前端。

核心数据流：

```text
运行爬虫
→ 生成 backend/python-http-www-cfcpn-com-jcw/output/notices/*.md
→ 运行 LLM
→ 生成 backend/data/announcement_table.csv
→ FastAPI 返回 JSON 数据
→ 前端自动刷新看板
```

---

## 2. 启动前准备

### 2.1 检查项目目录

打开 PowerShell：

```powershell
cd D:\broker-announcement-system-demo
Get-ChildItem
```

项目根目录至少应包含：

```text
backend/
frontend/
.env.example
.venv/
```

主要文件应存在：

```text
backend/api/main.py
backend/api/job_manager.py
backend/api/requirements.txt
backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper.py
backend/llm_table/llm_markdown_table_builder.py
backend/config/llm_api_config.json
frontend/package.json
```

可使用以下命令检查：

```powershell
Test-Path .\backend\api\main.py
Test-Path .\backend\python-http-www-cfcpn-com-jcw\cfcpn_scraper.py
Test-Path .\backend\llm_table\llm_markdown_table_builder.py
Test-Path .\frontend\package.json
```

以上结果应为 `True`。

### 2.2 检查 Python

项目使用两个 Python 环境：

* 根目录 `.venv`：运行 FastAPI 和 LLM。
* 爬虫目录下的 `.venv`：运行爬虫。

检查根目录 Python：

```powershell
Test-Path D:\broker-announcement-system-demo\.venv\Scripts\python.exe
```

检查爬虫 Python：

```powershell
Test-Path D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\.venv\Scripts\python.exe
```

两个结果都应为 `True`。

### 2.3 检查 Node.js 和 pnpm

```powershell
node --version
npm --version
pnpm --version
```

如果 `node` 不存在，请先安装 Node.js LTS。

如果 Node.js 已安装但 `pnpm` 不存在：

```powershell
npm install --global pnpm
pnpm --version
```

如果 PowerShell 阻止执行 `pnpm.ps1`：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
pnpm --version
```

该执行策略只影响当前 PowerShell 窗口。

---

## 3. 首次配置后端环境变量

### 3.1 创建根目录 `.env`

在项目根目录运行：

```powershell
cd D:\broker-announcement-system-demo
Copy-Item .env.example .env
notepad .env
```

如果 `.env` 已存在，不要直接覆盖，先备份：

```powershell
Copy-Item .env .env.backup
```

### 3.2 建议配置

请根据实际路径修改，下面是 Windows 本地运行示例：

```env
# 管理员账号
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请设置一个内部使用的强密码

# 允许访问后端的前端地址
FRONTEND_ORIGIN=http://localhost:3000

# 爬虫
SCRAPER_PYTHON_EXECUTABLE=D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\.venv\Scripts\python.exe
SCRAPER_SCRIPT_PATH=D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\cfcpn_scraper.py
SCRAPER_WORKING_DIR=D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw

# LLM
LLM_PYTHON_EXECUTABLE=D:\broker-announcement-system-demo\.venv\Scripts\python.exe
LLM_SCRIPT_PATH=D:\broker-announcement-system-demo\backend\llm_table\llm_markdown_table_builder.py
LLM_WORKING_DIR=D:\broker-announcement-system-demo\backend\llm_table
LLM_INPUT_DIR=D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\output\notices
LLM_OUTPUT_DIR=D:\broker-announcement-system-demo\backend\data
LLM_CONFIG_PATH=D:\broker-announcement-system-demo\backend\config\llm_api_config.json
LLM_WORKERS=4

# 看板数据
ANNOUNCEMENT_CSV_PATH=D:\broker-announcement-system-demo\backend\data\announcement_table.csv
```

注意：

* 不要将真实管理员密码和 LLM API Key 提交到 Git。
* 路径必须指向真实存在的文件或目录。
* 修改 `.env` 后需要重启 FastAPI。
* `FRONTEND_ORIGIN` 必须与浏览器实际访问的前端地址一致。

### 3.3 检查关键路径

```powershell
Test-Path D:\broker-announcement-system-demo\.venv\Scripts\python.exe
Test-Path D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\.venv\Scripts\python.exe
Test-Path D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\cfcpn_scraper.py
Test-Path D:\broker-announcement-system-demo\backend\llm_table\llm_markdown_table_builder.py
Test-Path D:\broker-announcement-system-demo\backend\config\llm_api_config.json
```

每一项都应返回 `True`。

---

## 4. 首次配置前端环境变量

进入前端目录：

```powershell
cd D:\broker-announcement-system-demo\frontend
```

创建 `.env.local`：

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

确认内容为：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

注意：

* 修改 `.env.local` 后需要重启 Next.js。
* 不要在前端环境变量中保存管理员密码或 LLM API Key。

---

## 5. 首次安装依赖

### 5.1 安装 FastAPI 依赖

在项目根目录运行：

```powershell
cd D:\broker-announcement-system-demo
.\.venv\Scripts\python.exe -m pip install -r backend\api\requirements.txt
```

检查后端语法：

```powershell
.\.venv\Scripts\python.exe -m py_compile backend\api\main.py backend\api\job_manager.py
```

没有输出通常表示检查通过。

### 5.2 安装前端依赖

```powershell
cd D:\broker-announcement-system-demo\frontend
pnpm install
```

建议首次运行前执行构建检查：

```powershell
pnpm build
```

构建成功后再启动开发服务。

---

## 6. 日常启动步骤

每次启动系统需要打开两个 PowerShell 窗口。

### 6.1 启动 FastAPI 后端

打开第一个 PowerShell：

```powershell
cd D:\broker-announcement-system-demo
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
```

看到类似以下内容表示后端已启动：

```text
Uvicorn running on http://0.0.0.0:8000
Application startup complete
```

在浏览器访问健康检查：

```text
http://localhost:8000/api/health
```

也可以打开接口文档：

```text
http://localhost:8000/docs
```

接口文档中应包含：

```text
POST /api/login
POST /api/jobs/scraper
POST /api/jobs/llm
GET  /api/jobs/{job_id}
GET  /api/jobs/{job_id}/events
GET  /api/data/announcements
GET  /api/health
```

### 6.2 启动 Next.js 前端

打开第二个 PowerShell：

```powershell
cd D:\broker-announcement-system-demo\frontend
pnpm exec next dev
```

终端会显示前端地址，通常为：

```text
http://localhost:3000
```

在浏览器打开该地址。

### 6.3 登录系统

使用根目录 `.env` 中配置的账号：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

登录成功后进入主看板和管理控制台。

---

## 7. 首次生成看板数据

如果系统第一次启动，还没有生成 CSV，看板会显示：

```text
尚未生成看板数据，请先运行爬虫和 LLM。
```

此时页面和管理控制台仍可正常使用。

### 7.1 运行爬虫

在管理控制台点击：

```text
运行爬虫
```

正常表现：

* 按钮进入运行状态。
* 页面逐步显示实时日志。
* 运行期间不能重复启动爬虫或 LLM。
* 完成后显示成功或失败。

检查 Markdown 输出：

```powershell
Get-ChildItem D:\broker-announcement-system-demo\backend\python-http-www-cfcpn-com-jcw\output\notices -Filter *.md |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10 Name, Length, LastWriteTime
```

看到 `.md` 文件后，表示爬虫已有可供 LLM 处理的输入。

### 7.2 检查 LLM 配置

确认配置文件存在：

```powershell
Test-Path D:\broker-announcement-system-demo\backend\config\llm_api_config.json
```

结果应为 `True`。

确认配置文件内的以下内容可用：

* API Endpoint。
* API Key。
* 模型名称。

不要在聊天记录、截图或 Git 中暴露真实 API Key。

### 7.3 运行 LLM

在管理控制台点击：

```text
运行 LLM
```

正常表现：

* 按钮进入运行状态。
* 页面实时显示处理日志。
* 运行期间不能启动爬虫。
* 成功后生成或更新 CSV。
* 看板自动重新读取数据，无需手动刷新整个页面。

检查 CSV：

```powershell
Get-Item D:\broker-announcement-system-demo\backend\data\announcement_table.csv |
    Select-Object FullName, Length, LastWriteTime
```

文件存在且长度大于 0，说明结构化数据已生成。

---

## 8. 正常关闭系统

分别切换到前端和后端 PowerShell 窗口，按：

```text
Ctrl + C
```

停止服务。

关闭系统前，应尽量避免爬虫或 LLM 仍处于运行状态。

---

## 9. 常见问题排查

### 9.1 `node` 或 `npm` 无法识别

原因：Node.js 未安装，或安装后 PowerShell 未刷新环境变量。

检查：

```powershell
where.exe node
where.exe npm
```

安装 Node.js LTS 后，关闭并重新打开 PowerShell。

### 9.2 `pnpm` 无法识别

```powershell
npm install --global pnpm
pnpm --version
```

如果被执行策略阻止：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
pnpm.cmd --version
```

### 9.3 前端登录失败

检查：

1. FastAPI 是否正在运行。
2. `.env` 中的管理员账号密码是否正确。
3. 修改 `.env` 后是否重启了 FastAPI。
4. 浏览器请求是否发往：

```text
http://localhost:8000/api/login
```

### 9.4 前端提示无法连接后端

检查健康接口：

```text
http://localhost:8000/api/health
```

检查前端 `.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

修改后重启：

```powershell
pnpm dev
```

### 9.5 浏览器出现 CORS 错误

检查后端 `.env`：

```env
FRONTEND_ORIGIN=http://localhost:3000
```

该地址必须与浏览器访问前端的地址完全一致，包括协议和端口。

修改后重启 FastAPI。

### 9.6 页面提示尚未生成数据

这不是服务故障，说明以下文件尚不存在：

```text
backend/data/announcement_table.csv
```

依次运行：

```text
运行爬虫 → 运行 LLM
```

### 9.7 页面只显示错误提示，其他组件不显示

当前版本应当在无数据时仍显示完整页面和管理控制台。

若再次发生，检查前端是否存在因 404、空数组或无数据而整页提前 `return` 的逻辑。

### 9.8 启动任务返回 409

含义：已有爬虫或 LLM 任务正在运行。

当前首版设计中，两种任务互斥：

* 爬虫运行时不能启动 LLM。
* LLM 运行时不能启动爬虫。

等待当前任务结束后再操作。

### 9.9 爬虫启动失败

重点检查 `.env`：

```env
SCRAPER_PYTHON_EXECUTABLE=...
SCRAPER_SCRIPT_PATH=...
SCRAPER_WORKING_DIR=...
```

使用 `Test-Path` 验证：

```powershell
Test-Path $env:SCRAPER_PYTHON_EXECUTABLE
Test-Path $env:SCRAPER_SCRIPT_PATH
Test-Path $env:SCRAPER_WORKING_DIR
```

如果 `.env` 未加载，可直接使用完整路径检查。

### 9.10 LLM 启动失败

重点检查：

```env
LLM_PYTHON_EXECUTABLE=...
LLM_SCRIPT_PATH=...
LLM_WORKING_DIR=...
LLM_INPUT_DIR=...
LLM_OUTPUT_DIR=...
LLM_CONFIG_PATH=...
```

另外确认：

* 输入目录中存在 Markdown。
* LLM 配置文件存在。
* API Key 有效。
* 模型 Endpoint 可访问。
* API 配额充足。

### 9.11 FastAPI 端口被占用

检查 8000 端口：

```powershell
netstat -ano | findstr :8000
```

结束占用进程，或临时使用其他端口：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8001 --reload
```

同时修改前端 `.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001
```

### 9.12 前端端口被占用

Next.js 可能自动选择其他端口。

如果前端变为 `http://localhost:3001`，后端 `.env` 也要同步修改：

```env
FRONTEND_ORIGIN=http://localhost:3001
```

然后重启 FastAPI。

---

## 10. 推荐的日常快速启动顺序

### PowerShell 窗口 1：后端

```powershell
cd D:\broker-announcement-system-demo
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
```

### PowerShell 窗口 2：前端

```powershell
cd D:\broker-announcement-system-demo\frontend
pnpm dev
```

### 浏览器

```text
http://localhost:3000
```

### 使用顺序

```text
登录
→ 查看已有看板
→ 需要更新时运行爬虫
→ 爬虫成功后运行 LLM
→ 等待看板自动刷新
```

---

## 11. 启动验收清单

启动完成后逐项确认：

* [ ] `http://localhost:8000/api/health` 可访问。
* [ ] `http://localhost:3000` 可访问。
* [ ] 管理员可以成功登录。
* [ ] 刷新页面后当前登录会话仍然有效。
* [ ] 无数据时完整页面和管理控制台仍然显示。
* [ ] “运行爬虫”能够显示实时日志。
* [ ] “运行 LLM”能够显示实时日志。
* [ ] 爬虫和 LLM 不能同时运行。
* [ ] LLM 成功后生成 `backend/data/announcement_table.csv`。
* [ ] LLM 成功后看板自动刷新。
* [ ] 浏览器控制台无关键 JavaScript 错误。
* [ ] FastAPI 终端无未处理异常。

全部通过后，表示本地前后端联调启动成功。

---

## 12. 安全注意事项

本项目面向公司内部使用，但仍应遵守以下规则：

* 不要在前端代码中写入管理员密码。
* 不要将 `.env`、`.env.local` 或真实 LLM 配置提交到 Git。
* 不要将 API Key 输出到浏览器日志或任务日志。
* 不要允许前端传入任意脚本路径或系统命令。
* 内网部署时仍建议使用 HTTPS 或通过公司统一网关访问。
* 管理员密码泄露后应立即修改并重启 FastAPI，使旧会话失效。
