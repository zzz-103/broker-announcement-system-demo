# Coze 展示版前端

这是独立的 Coze 展示版前端，不修改也不依赖本地 frontend 和 backend 运行任务。

## 本地启动与构建

pnpm install
pnpm dev
pnpm ts-check
pnpm build
pnpm start

pnpm start 在 pnpm build 后用 Node 内置静态服务器提供 out/，不运行 FastAPI。

## 替换展示数据

将已经脱敏并审核过的文件替换到 public/data/：

- announcement_table.csv
- ai-analysis.json
- manifest.json

公开文件不得包含 Windows 绝对路径、raw_json_path、内网地址、API Key 或调试字段。

## 本地用户服务

src/lib/local-platform-service.ts 是本地预览适配层，用户、登录记录和反馈只保存于当前浏览器的 localStorage。登录页的“首次建管”需要手动输入演示管理员信息，不包含预置生产账号。

导入 Coze 后，应将该文件替换为 Coze 身份认证和数据库服务适配；不要把本地演示认证用于正式对公部署。当前演示用户不会跨浏览器或设备共享。
