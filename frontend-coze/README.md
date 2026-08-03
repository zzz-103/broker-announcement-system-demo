# 纯前端公开看板

`frontend-coze` 是可独立部署的静态看板：只读取 `public/dashboard-data/`，不连接 FastAPI、数据库、用户系统或 LLM。招采和券商 App 更新看板共用完整版本导出的标准数据包。

## 数据包

```text
dashboard-data/
├── manifest.json
├── overview.json
├── filters.json
├── tender_projects.json
├── app_updates.json
└── ai_analysis.json
```

`manifest.json` 记录 Schema 版本、生成时间、文件名、记录数、时间范围和 SHA-256。页面启动时先校验清单；缺失、损坏、版本不兼容或校验失败会显示中文错误。

完整版本管理员可在“管理控制台 → 纯前端数据包”导出 ZIP，也可在仓库根目录运行：

```bash
python scripts/export_dashboard_data.py --zip
```

将整个目录复制到 `public/dashboard-data/`，或使用：

```bash
pnpm install-data ../backend/data/dashboard-data
pnpm data:check
```

不需要修改代码、转换 CSV 或复制用户数据库。数据包不包含密码、Token、服务器路径和 LLM 配置。

## 本地启动与构建

```bash
pnpm install
pnpm data:check
pnpm dev
pnpm ts-check
pnpm lint
pnpm build
pnpm start
```

`build` 生成静态 `out/`；`start` 仅用于本地预览。子路径部署时，构建和预览使用相同的 `NEXT_PUBLIC_BASE_PATH=/your-path`。

## 数据切换

右上角“数据包”可以查看版本、更新时间、记录数和文件状态，也可以在当前会话导入另一个完整数据包。刷新页面恢复站点默认数据。页面使用 Hash 导航（`#procurement`、`#app-watch`、`#data`），静态刷新不会因 history 路由返回 404。
