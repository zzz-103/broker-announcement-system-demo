# 前端项目约束

## 技术与架构

- Next.js 16 App Router、React 19、TypeScript 5、Tailwind CSS 4。
- Zustand 管理认证与筛选状态；TanStack Table 负责表格；ECharts 使用按需模块注册。
- 开发使用 Next dev，生产使用 `output: "export"`，静态产物由 FastAPI 托管。
- 前端不得直接读取 CSV、执行 Python、调用外部 LLM 或访问后端文件系统。
- 所有业务 API 与 SSE 调用集中在 `src/lib/api/backend-client.ts`。

## 依赖管理

- 仅允许 pnpm，禁止 npm 或 yarn。
- 新增依赖前先确认现有模块无法满足需求。
- 生产前端不得新增 Next Route Handler、Server Action、cookies 或其他需要 Node.js 常驻运行的能力，除非任务明确改变部署架构。

## 编码规范

- 使用 TypeScript 严格类型心智；禁止隐式 `any`、`as any`、未使用导入和未声明标识符。
- API 响应、SSE 事件和组件 Props 必须有明确类型。
- 优先复用现有组件与 `src/lib/announcement-data.ts` 数据处理逻辑，不复制近似实现。
- 不大改现有看板样式、业务统计口径或筛选行为。

## 浏览器与认证

- Token 只能保存在 React 状态和 `sessionStorage`，禁止 `localStorage`。
- 401 必须清理登录状态；409 显示明确冲突提示。
- SSE 使用带 Bearer Header 的 `fetch` 流读取，维护跨 chunk buffer；组件卸载时仅中止前端读取。
- 浏览器 API 必须在客户端事件或 effect 中访问，禁止在服务端渲染阶段直接读取 `window`。

## 静态导出与 UI

- `next/image` 使用静态导出兼容配置；新增路由必须可以在构建期生成。
- 禁止 JSX `<head>`，使用 metadata。
- 基础交互优先复用现有 shadcn/Radix Dialog 与 Button 风格。
- 数据加载失败不得白屏，重任务组件继续使用动态加载。

## 验证

```bash
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

只有静态构建真实退出 0 才能声称前端构建通过。
