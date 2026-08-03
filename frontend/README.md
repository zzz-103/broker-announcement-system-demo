# 完整前端

Next.js 16、React 19、TypeScript 和 Tailwind CSS 4 的正式看板。开发阶段使用 Next dev，生产阶段输出 `out/`，由 FastAPI 同端口托管。

## 开发与构建

```bash
pnpm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

生产环境不要运行 `next start`，也不要在前端保存管理员密码、Token 或 LLM 配置。

## 结构约定

- `src/features/`：采购看板、App Watch 和管理员控制台入口。
- `src/lib/api/`：集中管理 FastAPI、SSE、契约和数据包请求。
- `src/components/`：看板表格、图表、筛选器和详情抽屉。
- `../shared/dashboard-data/`：与 `frontend-coze` 共用的 Schema。

页面只接收标准化数据结构；清洗、去重、归一化、分类、统计和排序字段在后端导出层完成。

## 视觉基线

金融数据产品应保持专业、克制、高信息密度：深蓝导航、科技蓝交互、青绿色金额、浅灰背景和轻边框；避免大面积渐变、夸张阴影、霓虹效果和普通后台模板感。字体优先使用 PingFang SC、Microsoft YaHei 和系统无衬线字体，金额使用等宽数字。

## 认证与部署约束

API 请求集中在 `src/lib/api/backend-client.ts`；Token 只保存在 React 状态和 `sessionStorage`。401 清理登录态，409 显示冲突提示。前端必须兼容静态导出，不新增依赖常驻 Node.js 的 Route Handler 或 Server Action。
