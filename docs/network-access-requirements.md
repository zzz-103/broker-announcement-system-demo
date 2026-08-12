# 公司内网部署前外网访问依赖

> 盘点基于当前工作树的代码、配置、Dockerfile、Compose 和部署脚本；未把文档链接、测试 fixture 或示例地址直接列入生产白名单。目标是给网络/运维人员申请服务器出站访问权限，不是修改业务逻辑。

## 结论摘要

- 生产拓扑原则上是“内网用户访问网关，服务器主动访问外部服务”：本系统原则上只需要服务器主动访问外网，不需要互联网主动访问服务器；没有发现必须接收互联网主动连接的回调、Webhook、OAuth 回调或公网入站功能。
- 生产运行时的固定外部目标是：百度千帆搜索、共享 OpenAI-compatible LLM、招采公告来源、App Watch 来源，以及默认开启的 126 SMTP。邮件仍需先配置邮箱、发件地址和客户端授权码才会实际发送。固定域名详见 [`network-whitelist.csv`](network-whitelist.csv)。
- 统计口径：CSV 中有 21 个当前官方 LLM 路径下的固定生产候选域名；自建 LLM 是与官方 LLM 互斥的第 22 个候选域名；另有图片 CDN 和 301/302 最终地址两类动态目标，不能在未实测前写成固定 FQDN。
- 当前工作区的 LLM fallback 配置使用官方 `api.deepseek.com`；代码也支持管理员配置的自建 OpenAI-compatible Base URL。示例自建地址是 `cscocrm.csco.com.cn:11443`，该地址不是当前 fallback，且公共 DNS 当前无法确认其 IP。
- App Watch 的 QQ 应用商店 OCR 和平安图片 OCR 会下载外部响应中返回的图片 URL，并跟随重定向；图片/CDN/最终跳转域名不在仓库中固定，不能安全地用一个静态根域名代替。上线前应用测试任务记录最终主机名后再补白名单。
- 当前仓库没有发现写死的公网 IPv4；出现的 `127.0.0.1`、`localhost`、`backend-api`、`frontend` 和 `0.0.0.0` 均为本机、容器或监听地址。

## 部署后的网络访问模式

生产 Compose 是四个服务：`gateway:8080`、`frontend:3000`、`backend-api:8000`、`backend-scheduler`。网关把 `/api/` 和 SSE 转发到 `backend-api:8000`，其余页面转发到 `frontend:3000`；调度器只通过 `http://backend-api:8000` 调用内网定时任务接口。上述容器间连接不属于外网白名单。

浏览器前端生产构建默认使用同源 `/api`，不直接调用百度、LLM、券商网站或邮件服务。用户点击情报来源或 App 下载链接时，目标连接由用户浏览器发起，不是服务器运行时出站；这些链接不应因此加入服务器外网白名单。

服务器需要能够使用公司的 DNS（通常 UDP/TCP 53）解析白名单 FQDN。公网服务多数使用 CDN 或负载均衡，申请应优先按 FQDN + 端口放行并允许 DNS 变化，而不是长期写死一次解析得到的 IP。

## 生产运行：长期运行依赖

### AI、搜索与邮件

| 服务 | 实际访问 | 端口 | 状态与说明 |
|---|---|---:|---|
| 百度千帆普通搜索 | `https://qianfan.baidubce.com/v2/ai_search/web_search`，POST | 443 | 自定义情报中心使用；代码固定使用 `web_search`。 |
| 官方 DeepSeek/兼容 LLM | 当前 `base_url` 为 `https://api.deepseek.com`，由 OpenAI SDK 调用 `chat.completions` | 443 | 招采 LLM、匹配复核、AI 分析、App Watch 和自定义情报共享同一配置。 |
| 自建 DeepSeek/兼容 LLM | 示例 `https://cscocrm.csco.com.cn:11443/v1`，实际请求为兼容的 `chat.completions` | 11443 | 与官方地址二选一；若服务在公司内网，则应走内网规则而非外网白名单。IP、证书和是否需要代理待确认。 |
| 126 邮件 | `smtp.126.com`，`SMTP_SSL` | 465 | 默认开启邮件功能；仍需配置 126 邮箱、发件地址和客户端授权码后才能发送。不是 HTTP，不能通过 HTTP Proxy 代替直连 SMTP。 |

### 招采公告来源

| 目标域名 | 实际用途 | 端口 | 备注 |
|---|---|---:|---|
| `www.cfcpn.com` | 列表/详情 POST；公告附件下载代理 | 80 | 代码明确使用 HTTP，属于生产非加密访问。 |
| `www.cs.ecitic.com` | 中信证券公告列表和详情 | 443 | 官方来源。 |
| `www.hx168.com.cn` | 华西证券 `/servlet/json` 列表 API 和详情 | 443 | 列表为 POST，详情为 GET。 |
| `www.csco.com.cn` | 世纪证券公告 API | 443 | `/Handler/ContentHandler.aspx`。|

### App Watch 来源

以下域名来自 `backend/config/broker_app_watch/brokers.yaml`。其中有 `fetch_url` 的来源实际请求 `fetch_url`；没有 `fetch_url` 的来源请求 `source_url`。所有未特别标注的目标使用 HTTPS/TCP 443。

| 目标域名 | 所属来源/实际用途 | 端口 | 状态 |
|---|---|---:|---|
| `www.guosen.com.cn` | 国信软件 API | 443 | App Watch 功能启用时需要。 |
| `sj.qq.com` | 广发、华泰、中信、世纪证券多个 QQ 应用商店详情页 | 443 | 页面 OCR 还会访问响应返回的截图资源。 |
| `wap.newone.com.cn` | 招商证券 `static/config.json` | 443 | App Watch 功能启用时需要。 |
| `m.stock.pingan.com` | 平安证券配置 API | 443 | 生产镜像默认设置 `BAW_DISABLED_BROKERS=pazq`；重新启用后还需图片 CDN。 |
| `www.essence.com.cn` | 国投证券软件 API | 443 | 下载地址只被解析并写入结果，不由后端继续下载。 |
| `www.cgws.com` | 长城证券下载页面 | 443 | App Watch 功能启用时需要。 |
| `www.firstcapital.com.cn` | 第一创业下载页面 | 443 | App Watch 功能启用时需要。 |
| `www.ciccwm.com` | 中金财富 App API | 443 | 下载地址只被解析并写入结果。 |
| `www.dgzq.com.cn` | 东莞证券 App API | 443 | 下载地址只被解析并写入结果。 |
| `www.ykzq.com` | 粤开证券 App API | 443 | 下载地址只被解析并写入结果。 |
| `www.easec.com.cn` | 东亚前海证券 App API | 443 | App Watch 功能启用时需要。 |
| `www.zszq.com` | 中山证券下载页面 | 443 | App Watch 功能启用时需要。 |
| `www.ydzq.sgcc.com.cn` | 英大证券下载页面 | 80 | 代码中是 HTTP，属于生产非加密访问。 |
| `www.ytzq.com` | 银泰证券 App API | 443 | App Watch 功能启用时需要。 |

## 动态目标与跳转边界

1. `backend/broker_app_watch/collectors/http_collector.py` 对来源请求设置了 `follow_redirects=True`。当前配置没有写出固定的 301/302 最终域名；上线前应从一次低频采集的日志或抓包结果确认最终主机名，再只增加实际目标。
2. `pingan_image_ocr.py` 会遍历平安 API 返回的图片 URL；`qq_app_detail_ocr.py` 会从 QQ 页面 `<img src>` 提取截图并下载。`fetch_binary()` 也跟随重定向。因此这两项功能存在运行时动态 CDN 出站，不能只申请页面主域名后假定一定足够。
3. 国投、东莞、中金财富、粤开等解析器会保存外部下载地址，但当前代码没有调用这些下载地址。它们是展示给用户/写入数据的 URL，不是服务器运行时白名单目标；用户点击时由浏览器访问。
4. 百度搜索结果中的来源 URL由后端保存并展示，当前代码没有再抓取每篇来源文章；因此搜索结果中的任意新闻站点不应加入服务器白名单。

## 首次部署或升级阶段依赖

| 目标 | 阶段 | 端口 | 依据与处理建议 |
|---|---|---:|---|
| `github.com` | 部署/升级 | 443 | 当前 `origin` 是 GitHub；`scripts/deploy-release.ps1` 每次发布会 `git fetch origin`。如公司使用内部 Git 镜像，应替换为实际镜像并不申请 GitHub。 |
| `registry.npmmirror.com` | 本地/显式 pnpm 前端依赖 | 443 | `frontend/.npmrc` 明确指定；如果在 `frontend/` 目录直接执行 pnpm，会访问此源。 |
| 默认 npm registry（FQDN 待确认） | Docker 前端构建 | 443 | 当前 `frontend.Dockerfile` 在 `pnpm fetch` 之后才复制 `frontend/`，因此 `.npmrc` 不一定参与干净镜像构建；需以构建日志或 Docker 构建环境确认实际 registry。 |
| `pypi.org` | 后端镜像构建/本地安装 | 443 | Dockerfile 和 requirements 未指定 pip index，属于 pip 默认源；实际若有 `pip.conf`/内部镜像应以现场配置为准。 |
| `files.pythonhosted.org` | 后端镜像构建/本地安装 | 443 | pip 下载 wheel 的常见默认分发域名；需与实际 pip index/镜像核对。 |
| Docker Registry/Mirror（仓库未固定 FQDN） | Docker 镜像构建 | 443 | `FROM python:3.11-slim`、`node:22-alpine`、`nginx:1.27-alpine` 和 Compose 中的 `nginx:1.27-alpine` 使用未限定 registry 的镜像名；请按 Docker daemon 的 registry mirror 实际配置申请。 |
| Linux 软件源（仓库未固定 FQDN） | 后端镜像构建 | 80/443 | `backend.Dockerfile` 执行 `apt-get update/install`；源地址来自基础镜像内部配置，不在本仓库固定。应在构建机预构建，或确认基础镜像内的 Debian 源后再申请。 |

生产发布脚本使用 `docker compose ... --pull never` 启动容器，因此运行中的生产服务不应因为 Compose 自动拉取镜像而需要 Docker Registry。推荐在可联网构建机完成镜像、依赖和安全扫描，再把镜像导入内网服务器。

## 仅开发/测试环境

- `localhost`、`127.0.0.1`、`backend-api`、`frontend` 和 `http://localhost:8000` 等仅用于本地开发、Compose 内部健康检查或调度器内网调用，不申请外网权限；这些属于开发/测试地址，不得误用于生产外联配置。
- `NEXT_PUBLIC_API_BASE_URL` 在生产构建中应为空，浏览器使用同源 `/api`；开发环境可指向本地 FastAPI。
- `BrowserCollector` 明确是 disabled/unimplemented placeholder；当前没有实际 Playwright 浏览器采集，也没有因浏览器执行脚本而产生的服务器第三方资源白名单。前端的 `@playwright/test` 仅出现在锁文件依赖语境中，不是生产运行时浏览器服务。
- `ui.shadcn.com`、`nextjs.org` 等只出现在工具配置、注释或文档中，已排除出生产白名单。

## 代理与企业 HTTPS 解密

### HTTP/HTTPS Proxy

- App Watch 的 `httpx` 调用和百度 `httpx.Client` 没有在项目中关闭环境代理，通常可通过 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 由部署环境接入代理；上线前应在不带真实 API Key 的情况下验证代理行为。
- 招采官方来源的 `backend/broker_sources/http_client.py` 和 CFCPN 的 `cfcpn_scraper/client.py` 都明确设置 `requests.Session.trust_env = False`，不会读取环境代理变量。它们需要直连外网，或由网络侧提供透明代理/改造后的受控出口；本任务不修改业务代码。
- OpenAI SDK 使用的代理由 SDK/底层 HTTP 客户端版本决定，仓库没有自有代理参数。若 LLM 必须经代理，需在部署环境按实际 SDK 版本验证，不要把代理账号密码写入代码或报告。
- 126 SMTP 是 TCP 465 的 TLS 直连，HTTP Proxy 不能代替 SMTP；如公司禁止直连 SMTP，应提供公司 SMTP Relay，并确认改用的主机、端口和 TLS 方式。

### HTTPS SSL 解密/企业 CA

- App Watch 图片/页面请求和邮件 TLS 上下文明确从 `certifi` 构造 CA；企业 SSL 解密证书不在 certifi 时会校验失败。应把企业 CA 以受控方式加入运行镜像/CA bundle，或配置受支持的自定义 CA，不要关闭证书校验。
- `httpx` 的 App Watch 请求显式传入基于 certifi 的 SSLContext，单纯设置系统环境变量可能不足；需在镜像或代码允许的 CA bundle 位置验证。
- `requests` 招采客户端关闭了 `trust_env`，其代理和 CA 环境变量也不能假定会生效；应验证系统 CA/镜像 CA 或使用网络透明代理。
- Python SMTP 同样显式使用 certifi CA。Node/pnpm 构建阶段需要按公司规范配置 Node/npm/pnpm 的企业 CA（例如受控 `cafile`/`NODE_EXTRA_CA_CERTS`），当前仓库没有专用配置。未来若启用真实 Browser/Playwright，还需要单独配置浏览器代理和企业 CA；当前没有该运行链路。

## 需要人工确认的事项

以下事项无法仅从当前代码和仓库配置中确定，需要结合生产开关、构建机配置、网络出口和一次低频采集结果确认：

1. 生产最终使用官方 `api.deepseek.com` 还是内网自建 LLM；若自建，确认内网 IP、TCP 11443、证书链、是否经过代理，以及是否真的属于外网白名单。
2. 部署服务器是否启用 App Watch 定时任务、是否保留默认禁用的平安来源；邮件功能默认开启，但只有配置邮箱、发件地址和客户端授权码后才会实际发送。
3. 对每个启用的 App Watch 来源做一次小规模 DNS/HTTPS/重定向核对，记录 `final_url`、QQ/平安图片 CDN 和最终跳转域名；不要直接放行整个券商根域或全互联网。
4. 确认内网是否提供 npm、pip、Docker、Debian 和 Git 镜像；若提供，应把 CSV 中部署阶段的待确认项替换成内部 FQDN。
5. 确认公司的 HTTPS 出口代理、企业 CA 注入方式和 DNS 策略；特别是招采/CFCPN `trust_env=False` 与 certifi 固定 CA 的限制。
6. 当前 `.env` 和 `backend/config/llm_api_config.json` 是未跟踪/被忽略的运行配置，包含凭据字段；未在本报告复制任何值。应在部署前通过密钥管理或受限挂载注入，并轮换已暴露或曾进入共享目录的凭据。`.env` 中还发现未被当前代码引用的 `TAVILY_API_KEY`，它不构成当前运行时白名单目标，应删除或确认其来源。

## 逐项检查结果

| 检查项 | 结果 |
|---|---|
| 固定公网 IP | 未发现代码中写死的公网 IPv4；仅有 loopback、容器名和监听地址。 |
| 生产 HTTP 非加密访问 | 发现：`www.cfcpn.com` 和 `www.ydzq.sgcc.com.cn`；需网络/业务确认是否只能保持 HTTP。容器内部 HTTP 不属于外网风险。 |
| 公网回调/Webhook/公网入站 | 未发现；网关是内网用户访问入口，不需要互联网主动访问服务器。 |
| Browser Collector/Playwright 第三方资源 | 当前未实现/未启用；App Watch 是 Python HTTP 客户端，但会主动下载 QQ/平安响应中的图片资源。 |
| 百度/LLM Base URL 统一性 | LLM 通过共享 `LLMApiConfig` 统一；百度实际 Endpoint 在 `qianfan_search.py` 固定为 `web_search`。`.env.example` 的 `BAIDU_QIANFAN_ENDPOINT` 仍是旧的 `chat/completions` 示例且未被实际代码读取，存在误配置风险。 |
| 开发地址误用于生产 | 生产 Dockerfile 将前端 Base URL 置空；但需确保生产 `.env` 不设置 `NEXT_PUBLIC_API_BASE_URL` 为本地地址，且不直接暴露 backend/frontend 容器端口。 |
| 敏感 API Key/密码 | 未发现写入 tracked README/源码的真实值；发现未跟踪运行配置 `.env`、`backend/config/llm_api_config.json` 含凭据字段，需受限管理，报告不含敏感值。 |
| 完全离线部署可行性 | 可以：提前构建并扫描 backend/frontend/nginx 镜像，使用 `--pull never`、内网导入镜像；或提前准备 pip wheel、pnpm store 和基础镜像。源码升级脚本的 GitHub fetch 仍需在联网构建/发布机完成，或改用内部 Git 镜像。 |

## 代码与配置依据

- 招采来源：`backend/broker_sources/sources.json`、`backend/broker_sources/collectors/`、`backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper/`。
- App Watch：`backend/config/broker_app_watch/brokers.yaml`、`backend/broker_app_watch/collectors/http_collector.py`、`backend/broker_app_watch/parsers/broker_specific/`。
- 百度/LLM/邮件：`backend/api/qianfan_search.py`、`backend/llm_table/llm_client.py`、`backend/api/ai_analysis.py`、`backend/api/custom_intelligence_service.py`、`backend/api/intelligence_email.py`。
- 生产部署：`backend.Dockerfile`、`frontend.Dockerfile`、`deploy/docker-compose.example.yml`、`deploy/nginx.conf`、`scripts/deploy-release.ps1`、`frontend/.npmrc`。
