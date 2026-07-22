# Coze 展示版前端

这是独立的 Coze 展示版前端，只读取本地项目生成的脱敏数据，不修改原 `frontend/`、`backend/` 或正式数据。

## 真实数据同步

正式招采数据来源固定为：

`backend/data/announcement_table.csv`

执行：

```bash
pnpm sync-data
```

命令会复制并脱敏正式 CSV、同步存在的 `backend/data/ai-analysis.json`、更新 `public/data/manifest.json`，并生成不提交的 `migration/users-import.json`。

公开数据不得包含 Windows 或 Unix 绝对路径、`raw_json_path`、内网地址、API Key、密码、Token 或调试字段。

## 本地启动与构建

```bash
pnpm install
pnpm sync-data
pnpm dev
pnpm exec tsc --noEmit
pnpm build
pnpm start
```

Route Handler 需要 Next.js 服务端运行模式；`pnpm start` 使用 `next start`，不使用旧的静态文件服务器。

## 本地认证规则

- 管理员：`admin / 098765`
- 所有导入普通用户初始密码：`123456`
- 新注册用户初始密码：`123456`
- 新注册用户默认待审批，管理员审批后才能登录。
- 密码只以服务端摘要保存；会话使用 HttpOnly Cookie。
- `.runtime/` 位于项目目录之外的公开资源路径之外，保存用户、会话、登录审计和反馈 JSON。

固定密码仅用于本地迁移验证，不能直接用于正式公网认证。

## Coze 迁移说明

迁移到 Coze 时，需要替换 `src/lib/server-platform.ts` 和 `src/app/api/` 下的本地认证、会话和文件存储 Route Handler，改接 Coze 服务端身份认证及持久化存储。不要将当前固定密码或本地 JSON 存储直接用于正式部署。
