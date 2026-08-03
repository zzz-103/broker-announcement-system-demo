import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";

const syntaxRules = [
  {
    selector: 'JSXOpeningElement[name.name="head"]',
    message:
      "禁止使用 head 标签，优先使用 metadata。三方 CSS、字体等资源可以在 globals.css 中顶部通过 @import 引入或者使用 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入；json-ld 可阅读 Next.js 文档。",
  },
];

const nextConfigRestrictedSyntaxRules = [
  {
    selector:
      "Property[key.name=/^(root|outputFileTracingRoot)$/] > Literal[value=/^\\//]",
    message:
      "禁止在 next.config 中写死绝对路径，请改用动态环境变量或项目相对路径。",
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "no-restricted-syntax": ["error", ...syntaxRules],
    },
  },
  {
    files: ["next.config.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...nextConfigRestrictedSyntaxRules],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "server.js",
    "dist/**",
    "scripts/**/*.js",
  ]),
]);
