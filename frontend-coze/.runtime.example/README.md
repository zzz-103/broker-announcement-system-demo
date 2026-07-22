# `.runtime` 初始化说明

本地首次执行 `pnpm sync-data` 后启动 Next.js，服务端会在 `.runtime/` 中自动创建用户、会话、登录审计和反馈 JSON 文件。

`.runtime/` 不属于公开静态资源，也不应提交到仓库。正式接入 Coze 时，请替换认证和存储适配层。
