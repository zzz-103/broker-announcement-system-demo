# 世纪证券招采情报平台前端

Next.js 16、React 19、TypeScript 与 Tailwind CSS 4 构建的单页看板。开发阶段使用 Next dev；生产阶段输出静态文件，由 FastAPI 同端口托管。

## 开发

```bash
pnpm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

## 验证与生产构建

```bash
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

生产产物位于 `out/`。生产环境不要运行 `next start`，也不要在前端保存管理员密码、Token 或 LLM 配置。

所有业务请求集中在 `src/lib/api/backend-client.ts`，正式数据来自 FastAPI `GET /api/data/announcements`。Token 仅保存在 React 状态和 `sessionStorage`。
