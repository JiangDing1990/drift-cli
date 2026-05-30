[English](./README.md) | **简体中文**

# drift-cli

> 在 Claude Design 与 Claude Code 之间建立双向同步通道的命令行工具

[![npm version](https://img.shields.io/npm/v/drift-cli)](https://www.npmjs.com/package/drift-cli)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 问题背景

使用 **Claude Design** 做高保真原型、**Claude Code** 实现生产代码时，两侧是同一产品意图的不同代码形态，但存放在独立目录中。任意一侧迭代后，另一侧无法感知——随时间累积形成**双向漂移（drift）**。

`drift-cli` 追踪两侧的组件级差异，生成上下文完整的同步 Prompt，让你直接粘贴给 Claude Code 或 Claude Design 完成翻译，**不直接修改任何文件**。

```
Claude Design (JSX 原型)           Claude Code (生产代码)
         │                                  │
         └──────────── drift-cli ───────────┘
              追踪变更 · 生成 Prompt · 更新基线
```

---

## 核心特性

- 🔍 **组件级追踪** — 从设计稿 JSX 文件中提取独立组件，与多个代码文件建立 1:N / N:1 映射
- 📸 **自有快照系统** — 三方版本比较（baseline vs design-current vs code-current），精确检测冲突
- 🤖 **AI 语义分析** — 调用 Claude API 分析变更意图（功能新增 / 样式调整 / 交互变化…）
- 📋 **双向 Prompt 生成** — 生成自包含的 Markdown prompt，含完整上下文，直接发给 Claude
- 🛠 **技术栈无关** — 核心同步逻辑不依赖任何框架；Next.js、Vue、Svelte 均适用
- 🔎 **技术栈自动检测** — `drift init` 时自动识别框架、语言、样式方案，写入 prompt 转换指引

---

## 安装

```bash
# npm
npm install -g drift-cli

# pnpm
pnpm add -g drift-cli

# 或在项目中本地安装
npm install --save-dev drift-cli
```

**依赖环境：** Node.js >= 18

---

## 快速上手

### 1. 初始化

```bash
drift init --design ~/Downloads/my-design --code ~/my-project
```

- 创建 `.drift/` 目录（放在你运行命令的工作目录，独立于两个项目）
- 自动检测代码侧技术栈，交互式确认
- 提取设计稿组件，扫描代码文件，建立初始快照

### 2. 建立组件映射

```bash
drift map auto               # 自动映射（文件名 + 导出名匹配）
drift map                    # 查看所有映射关系
drift map set <id> <path>    # 手动指定映射
```

### 3. 检测变更

```bash
drift diff                   # 扫描双目录，含 AI 语义分析
drift diff --no-ai           # 仅展示结构 diff，跳过 AI
drift diff --side design     # 只检测设计侧变更
```

### 4. 生成同步 Prompt

```bash
drift sync --to code         # 将设计稿变更同步到代码（复制到剪贴板）
drift sync --to design       # 将代码变更同步到设计稿
drift sync --to code --out ./prompts/    # 写入文件
drift sync --to code --component TopNav # 仅指定组件
```

### 5. 粘贴 Prompt，让 Claude 执行

将剪贴板内容粘贴到 Claude Code 或 Claude Design 对话框，等待 AI 完成修改。

### 6. 更新基线，闭合循环

```bash
drift snapshot --after-sync  # 只更新本次同步的组件
drift snapshot               # 更新所有组件基线
```

---

## 完整工作流

### Design → Code（最常见场景）

```
1. 在 Claude Design 更新设计稿，重新导出到本地目录
2. drift diff                        ← 检测变更，AI 分析意图
3. drift sync --to code --copy       ← 生成 Prompt，复制到剪贴板
4. 粘贴给 Claude Code 对话框
5. Claude Code 修改本地代码文件
6. 确认结果正确
7. drift snapshot --after-sync       ← 更新基线，状态变为 synced
```

### Code → Design（反向场景）

```
1. 修改代码文件
2. drift diff --side code            ← 检测代码侧变更
3. drift sync --to design --copy     ← 生成含反向转换指引的 Prompt
4. 粘贴给 Claude Design 对话框
5. Claude Design 更新并重新导出设计稿
6. drift snapshot --after-sync       ← 更新基线
```

### 冲突解决（两侧同时修改）

```
drift diff                           ← 显示 "⚠ CONFLICT"
drift sync --to code --component TopNav   ← 生成合并 Prompt（含两侧 diff）
# 让 Claude Code 手动合并两个变更
drift snapshot --after-sync
```

---

## 命令参考

### `drift init`

初始化 drift-cli。

```
Options:
  --design <path>   设计稿根目录（必填）
  --code <path>     代码项目根目录（必填）
  --force           强制重新初始化（覆盖现有配置）
  --skip-detect     跳过技术栈自动检测
```

### `drift map`

管理组件映射关系。

```
drift map                          # 查看所有映射（等同于 drift map list）
drift map list [--unmapped]        # 仅显示未映射的组件
drift map auto                     # 运行自动映射策略
drift map set <id> <path>          # 手动设置映射
drift map unset <id>               # 移除映射
```

### `drift status`

查看所有组件的同步状态总览。

```
Options:
  --refresh           重新扫描文件系统
  --filter <status>   按状态过滤：synced | design-ahead | code-ahead |
                      both-changed | never-synced | new-design | new-code
```

### `drift diff`

检测双目录变更，展示 diff 并进行 AI 语义分析。分析结果写入同步队列。

```
Options:
  --no-ai             跳过 AI 分析（无需 API Key）
  --side <side>       仅检测某侧：design | code
  --component <name>  仅检测指定组件
```

> **AI 分析** 需要设置环境变量 `ANTHROPIC_API_KEY`。未设置时自动降级为纯结构 diff。

### `drift sync`

读取同步队列，生成包含完整上下文的双向同步 Prompt。

```
Options:
  --to <target>        同步方向：code（设计→代码）| design（代码→设计）（必填）
  --copy               将 Prompt 复制到剪贴板（默认）
  --out <dir>          写入指定目录（每组件一个 .md 文件）
  --component <name>   仅生成指定组件的 Prompt
  --no-ai              跳过 AI 语义分析，使用通用转换指引
```

### `drift snapshot`

将当前双侧文件状态标记为新基线。**同步循环必须以此命令结束。**

```
Options:
  --component <name>  仅更新指定组件的基线
  --after-sync        仅更新 in-progress 状态的组件（推荐与 drift sync 配合使用）
```

### `drift log`

查看同步操作历史与队列状态。

```
Options:
  --component <name>  仅显示指定组件的记录
  --last <n>          仅显示最新 N 条
  --status <status>   按状态过滤：pending | in-progress | done | skipped | conflict
```

---

## 配置文件

`drift init` 在 `.drift/` 目录下生成 `drift.config.json`，可以手动编辑：

```jsonc
{
  "version": "2.0",

  "design": {
    "root": "~/Downloads/my-design",
    "include": ["**/*.jsx", "**/*.tsx"],
    "exclude": ["design-canvas.jsx"]
  },

  "code": {
    "root": "~/my-project",
    "include": ["**/*.tsx", "**/*.ts"],
    "exclude": ["**/node_modules/**", "**/dist/**"]
  },

  "ai": {
    "model": "claude-sonnet-4-20250514",   // 分析使用的模型
    "batchSize": 5,                         // 每批分析的组件数
    "maxConcurrency": 3                     // 并发 API 请求数
  },

  "project": {
    "stack": "Next.js 15 + TypeScript + Tailwind CSS",
    "conventions": [
      "组件使用 CSS Modules，文件名 *.module.scss",
      "路由使用 App Router，页面放在 src/app/ 下"
    ],
    // 由 drift init 自动生成，也可手动编辑
    "designToCodeHints": [
      "将内联样式转换为 Tailwind 类名",
      "添加 TypeScript 类型注解",
      "保留代码侧现有的工程结构和命名规范"
    ],
    "codeToDesignHints": [
      "设计稿使用浏览器原生 JSX，无需 import/export",
      "将 Tailwind 类名转换回内联样式 + CSS 变量",
      "移除 TypeScript 类型注解",
      "用静态 mock 数据替代后端 API 调用"
    ]
  }
}
```

---

## 同步状态说明

| 状态 | 含义 | 建议操作 |
|---|---|---|
| `synced` | 两侧均与基线一致 | 无需操作 |
| `design-ahead` | 设计稿更新，代码未同步 | `drift sync --to code` |
| `code-ahead` | 代码更新，设计稿未同步 | `drift sync --to design` |
| `both-changed` | 两侧均有变更（冲突） | `drift sync --to code`（生成合并 Prompt） |
| `never-synced` | 有映射但从未同步 | `drift snapshot` 建立初始基线 |
| `new-design` | 设计稿新增组件，无代码映射 | `drift map set` 建立映射 |
| `new-code` | 代码新增文件，无设计稿映射 | `drift map set` 建立映射（可选） |

---

## AI 分析

`drift diff` 和 `drift sync` 可调用 Claude API 对变更进行语义分析：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
drift diff
```

分析结果包含：

- **变更类型（intent）**：`feature-add` / `style-change` / `interaction-change` / `layout-change` / `refactor` / `props-change` / `logic-change` / `content-change`
- **影响范围（impact）**：`high` / `medium` / `low`
- **一句话摘要**
- **同步建议（syncGuide）**：具体操作步骤

未设置 API Key 时，工具依然完整工作——只是 AI 分析部分降级为通用结构 diff 和通用转换指引。

---

## `.drift/` 目录结构

```
.drift/
├── drift.config.json      # 配置（设计/代码路径、AI 设置、技术栈信息）
├── registry.json          # 组件注册表（所有提取的组件及其映射关系）
├── queue.json             # 同步队列（pending / in-progress / done / skipped）
├── snapshots/
│   ├── latest.json        # 最新快照（diff 的基准）
│   └── snap_*.json        # 历史快照
└── history/
    └── *.md               # 生成的 Prompt 历史记录
```

`.drift/` 目录与两个项目均独立，不污染代码的 git 历史，也不会被 Claude Design 的导出覆盖。

---

## 技术栈检测

`drift init` 自动检测代码侧技术栈，支持：

| 维度 | 支持 |
|---|---|
| 框架 | Next.js · Nuxt · SvelteKit · Vite+React · Vue · Angular |
| 语言 | TypeScript · JavaScript |
| 样式 | Tailwind CSS · CSS Modules · styled-components · Emotion · SCSS |
| 状态管理 | Zustand · Redux · Jotai · Pinia · TanStack Query · MobX |
| 路由 | App Router · Pages Router · React Router · Vue Router |
| 组件模式 | function 声明 · 箭头函数 |

检测结果写入 `drift.config.json`，可以手动修改。所有检测维度均可在交互确认时修正。

---

## 开发

```bash
git clone https://github.com/your-org/drift-cli
cd drift-cli
pnpm install

pnpm run build      # 构建
pnpm run dev        # 监听模式
pnpm run test       # 运行测试（watch 模式）
pnpm run test:run   # 单次运行所有测试
pnpm run lint       # TypeScript 类型检查
```

---

## License

MIT © 2026
