# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 项目概述

券商金融科技招采情报平台 - 面向证券公司管理层和信息技术负责人的公开招采情报分析单页应用。前端直接加载 CSV 数据，无后端依赖。

### 核心依赖

- **Zustand**: 全局过滤状态管理（搜索词、时间范围、多维度筛选）
- **PapaParse**: CSV 数据解析
- **@tanstack/react-table**: 高性能表格（排序、分页）
- **ECharts (echarts-for-react)**: 图表可视化（趋势图、分布图、环形图）
- **lucide-react**: 图标库

## 目录结构

```
├── public/
│   └── data/                          # CSV 数据文件（替换数据只需替换此文件）
│       └── announcement_table.csv
├── src/
│   ├── app/
│   │   ├── page.tsx                   # 主页面（Dashboard 组装层）
│   │   ├── layout.tsx                 # 根布局
│   │   └── globals.css                # 全局样式
│   ├── components/
│   │   ├── metric-cards.tsx           # 6个核心指标卡片
│   │   ├── executive-summary.tsx      # 管理层摘要 + 数据覆盖
│   │   ├── charts.tsx                 # 趋势图 + 方向分布 + 阶段分布
│   │   ├── observation-cards.tsx      # 券商/供应商/价格观察
│   │   ├── key-project-radar.tsx      # 重点项目雷达
│   │   ├── project-table.tsx          # 项目情报明细表
│   │   ├── project-detail-drawer.tsx  # 项目详情抽屉
│   │   ├── data-definition-modal.tsx  # 数据口径说明弹窗
│   │   └── ui/                        # Shadcn UI 组件库
│   ├── store/
│   │   └── filter-store.ts            # Zustand 全局过滤状态
│   ├── lib/
│   │   ├── announcement-data.ts       # 统一数据处理层（核心）
│   │   ├── csv-loader.ts              # CSV 加载器（PapaParse）
│   │   └── utils.ts                   # 通用工具函数
│   └── types/
│       └── data.ts                    # 数据类型定义
├── DESIGN.md                          # 设计规范
├── next.config.ts                     # Next.js 配置
├── package.json                       # 项目依赖管理
└── tsconfig.json                      # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
