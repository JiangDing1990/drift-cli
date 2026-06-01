[English](./README.md) | **简体中文**

# codeferry

> 在 Claude Design 与 Claude Code 之间建立双向同步通道的命令行工具

[![npm version](https://img.shields.io/npm/v/codeferry)](https://www.npmjs.com/package/codeferry)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 问题背景

使用 **Claude Design** 做高保真原型、**Claude Code** 实现生产代码时，两侧是同一产品意图的不同代码形态，但存放在独立目录中。任意一侧迭代后，另一侧无法感知——随时间累积形成**双向漂移（drift）**。

`codeferry` 追踪两侧的组件级差异，生成上下文完整的同步 Prompt，让你直接粘贴给 Claude Code 或 Claude Design 完成翻译，**不直接修改任何文件**。

```
Claude Design (JSX 原型)           Claude Code (生产代码)
         │                                  │
         └──────────── codeferry ───────────┘
              追踪变更 · 生成 Prompt · 更新基线
```

---

## 核心特性

- 🔍 **组件级追踪** — 从设计稿 JSX 文件中提取独立组件，与多个代码文件建立 1:N / N:1 映射
- 📸 **自有快照系统** — 三方版本比较（baseline vs design-current vs code-current），精确检测冲突
- 🤖 **AI 语义分析** — 调用 Claude API 分析变更意图（功能新增 / 样式调整 / 交互变化…）
- 📋 **双向 Prompt 生成** — 生成自包含的 Markdown prompt，含完整上下文，直接发给 Claude
- 🛠 **技术栈无关** — 核心同步逻辑不依赖任何框架；Next.js、Vue、Svelte 均适用
- 🔎 **技术栈自动检测** — `codeferry init` 时自动识别框架、语言、样式方案，写入 prompt 转换指引
- 🗂 **多工作区支持** — 在单个 `.codeferry/` 目录下管理多组 design↔code 配对，通过 `codeferry workspace` 管理

---

## 安装

```bash
# npm
npm install -g codeferry

# pnpm
pnpm add -g codeferry

# 或在项目中本地安装
npm install --save-dev codeferry
```

**依赖环境：** Node.js >= 18

---

## 快速上手

> **需要详细使用示例？** → [完整使用教程](./docs/USAGE.zh-CN.md) 覆盖所有场景，包含带注释的终端输出，涵盖冲突解决、批量同步、反向同步（code→design）和常见问题排查。

### 1. 初始化

```bash
codeferry init --design ~/Downloads/my-design --code ~/my-project
```

- 创建 `.codeferry/` 目录（放在你运行命令的工作目录，独立于两个项目）
- 自动检测代码侧技术栈，交互式确认
- 提取设计稿组件，扫描代码文件，建立初始快照

### 2. 建立组件映射

```bash
codeferry map auto               # 自动映射（文件名 + 导出名匹配）
codeferry map                    # 查看所有映射关系
codeferry map set <id> <path>    # 手动指定映射
```

### 3. 检测变更

```bash
codeferry diff                   # 扫描双目录，含 AI 语义分析
codeferry diff --no-ai           # 仅展示结构 diff，跳过 AI
codeferry diff --side design     # 只检测设计侧变更
```

### 4. 生成同步 Prompt

```bash
codeferry sync --to code         # 将设计稿变更同步到代码（复制到剪贴板）
codeferry sync --to design       # 将代码变更同步到设计稿
codeferry sync --to code --out ./prompts/    # 写入文件
codeferry sync --to code --component TopNav # 仅指定组件
```

### 5. 粘贴 Prompt，让 Claude 执行

将剪贴板内容粘贴到 Claude Code 或 Claude Design 对话框，等待 AI 完成修改。

### 6. 更新基线，闭合循环

```bash
codeferry snapshot --after-sync  # 只更新本次同步的组件
codeferry snapshot               # 更新所有组件基线
```

---

## 完整工作流

### Design → Code（最常见场景）

```
1. 在 Claude Design 更新设计稿，重新导出到本地目录
2. codeferry diff                        ← 检测变更，AI 分析意图
3. codeferry sync --to code --copy       ← 生成 Prompt，复制到剪贴板
4. 粘贴给 Claude Code 对话框
5. Claude Code 修改本地代码文件
6. 确认结果正确
7. codeferry snapshot --after-sync       ← 更新基线，状态变为 synced
```

### Code → Design（反向场景）

```
1. 修改代码文件
2. codeferry diff --side code            ← 检测代码侧变更
3. codeferry sync --to design --copy     ← 生成含反向转换指引的 Prompt
4. 粘贴给 Claude Design 对话框
5. Claude Design 更新并重新导出设计稿
6. codeferry snapshot --after-sync       ← 更新基线
```

### 冲突解决（两侧同时修改）

```
codeferry diff                           ← 显示 "⚠ CONFLICT"
codeferry sync --to code --component TopNav   ← 生成合并 Prompt（含两侧 diff）
# 让 Claude Code 手动合并两个变更
codeferry snapshot --after-sync
```

---

## 命令参考

### `codeferry init`

初始化 codeferry。

```
Options:
  --design <path>   设计稿根目录（必填）
  --code <path>     代码项目根目录（必填）
  --force           强制重新初始化（覆盖现有配置）
  --skip-detect     跳过技术栈自动检测
```

### `codeferry map`

管理组件映射关系。

```
codeferry map                          # 查看所有映射（等同于 codeferry map list）
codeferry map list [--unmapped]        # 仅显示未映射的组件
codeferry map auto                     # 运行自动映射策略
codeferry map set <id> <path>          # 手动设置映射
codeferry map unset <id>               # 移除映射
```

### `codeferry status`

查看所有组件的同步状态总览。

```
Options:
  --refresh           重新扫描文件系统
  --filter <status>   按状态过滤：synced | design-ahead | code-ahead |
                      both-changed | never-synced | new-design | new-code
```

### `codeferry diff`

检测双目录变更，展示 diff 并进行 AI 语义分析。分析结果写入同步队列。

```
Options:
  --no-ai             跳过 AI 分析（无需 API Key）
  --side <side>       仅检测某侧：design | code
  --component <name>  仅检测指定组件
  --format <fmt>      输出格式：text（默认）| json（机器可读）
  --ci                CI 门控模式：JSON 输出，存在可操作漂移时退出码为 1
```

> **AI 分析** 需要设置环境变量 `ANTHROPIC_API_KEY`。未设置时自动降级为纯结构 diff。

### `codeferry sync`

读取同步队列，生成包含完整上下文的双向同步 Prompt。

```
Options:
  --to <target>        同步方向：code（设计→代码）| design（代码→设计）（必填）
  --copy               将 Prompt 复制到剪贴板（默认）
  --out <dir>          写入指定目录（每组件一个 .md 文件）
  --component <name>   仅生成指定组件的 Prompt
  --no-ai              跳过 AI 语义分析，使用通用转换指引
```

### `codeferry snapshot`

将当前双侧文件状态标记为新基线。**同步循环必须以此命令结束。**

```
Options:
  --component <name>  仅更新指定组件的基线
  --after-sync        仅更新 in-progress 状态的组件（推荐与 codeferry sync 配合使用）
```

### `codeferry log`

查看同步操作历史与队列状态。

```
Options:
  --component <name>  仅显示指定组件的记录
  --last <n>          仅显示最新 N 条
  --status <status>   按状态过滤：pending | in-progress | done | skipped | conflict
```

### `codeferry workspace`（别名：`ws`）

在单个 `.codeferry/` 目录下管理多组 design↔code 工作区。

```
codeferry workspace list                    # 列出所有工作区（默认子命令）
codeferry workspace current                 # 显示当前活跃工作区名称
codeferry workspace use <name>              # 切换活跃工作区
codeferry workspace create <name>           # 创建并初始化新工作区
  Options: --design <path>  --code <path>
codeferry workspace remove <name>           # 删除工作区（--force 才能删除 'default'）
```

**工作区解析优先级**（从高到低）：
1. 任意命令的 `-w / --workspace <name>` 参数
2. `CODEFERRY_WORKSPACE` 环境变量
3. `.codeferry/state.json`（由 `workspace use` 写入）
4. 兜底 `"default"`

```bash
# 单次使用其他工作区，不改变持久状态
codeferry status -w mobile-app

# CI 中通过环境变量指定工作区
CODEFERRY_WORKSPACE=mobile-app codeferry diff --no-ai
```

### `codeferry watch`

持续监听设计稿与代码目录，文件变更时自动打印漂移状态。

```
Options:
  --debounce <ms>   文件变更后延迟触发扫描的毫秒数（默认 800）
```

```bash
codeferry watch                  # 启动监听
codeferry watch --debounce 1500  # 大型项目使用更长防抖
```

---

## 配置文件

`codeferry init` 在 `.codeferry/` 目录下生成 `codeferry.config.json`，可以手动编辑：

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
    // 由 codeferry init 自动生成，也可手动编辑
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
| `design-ahead` | 设计稿更新，代码未同步 | `codeferry sync --to code` |
| `code-ahead` | 代码更新，设计稿未同步 | `codeferry sync --to design` |
| `both-changed` | 两侧均有变更（冲突） | `codeferry sync --to code`（生成合并 Prompt） |
| `never-synced` | 有映射但从未同步 | `codeferry snapshot` 建立初始基线 |
| `new-design` | 设计稿新增组件，无代码映射 | `codeferry map set` 建立映射 |
| `new-code` | 代码新增文件，无设计稿映射 | `codeferry map set` 建立映射（可选） |

---

## AI 分析

`codeferry diff` 和 `codeferry sync` 可调用 Claude API 对变更进行语义分析：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
codeferry diff
```

分析结果包含：

- **变更类型（intent）**：`feature-add` / `style-change` / `interaction-change` / `layout-change` / `refactor` / `props-change` / `logic-change` / `content-change`
- **影响范围（impact）**：`high` / `medium` / `low`
- **一句话摘要**
- **同步建议（syncGuide）**：具体操作步骤

未设置 API Key 时，工具依然完整工作——只是 AI 分析部分降级为通用结构 diff 和通用转换指引。

---

## `.codeferry/` 目录结构

```
.codeferry/
├── state.json                        # 当前活跃工作区指针
└── workspaces/
    ├── default/                      # 默认工作区（由 codeferry init 创建）
    │   ├── codeferry.config.json     # 配置（设计/代码路径、AI 设置、技术栈信息）
    │   ├── registry.json             # 组件注册表（所有提取的组件及其映射关系）
    │   ├── queue.json                # 同步队列（pending / in-progress / done / skipped）
    │   ├── snapshots/
    │   │   ├── latest.json           # 最新快照（diff 的基准）
    │   │   └── snap_*.json           # 历史快照
    │   └── history/
    │       └── *.md                  # 生成的 Prompt 历史记录
    └── mobile-app/                   # 额外工作区（由 codeferry workspace create 创建）
        └── ...
```

`.codeferry/` 目录与两个项目均独立，不污染代码的 git 历史，也不会被 Claude Design 的导出覆盖。

> **从 v0.4.x 升级？** 升级后第一次运行任意命令，工具会自动将旧的平铺 `.codeferry/` 结构迁移到 `workspaces/default/`，无数据丢失。

---

## 技术栈检测

`codeferry init` 自动检测代码侧技术栈，支持：

| 维度 | 支持 |
|---|---|
| 框架 | Next.js · Nuxt · SvelteKit · Vite+React · Vue · Angular |
| 语言 | TypeScript · JavaScript |
| 样式 | Tailwind CSS · CSS Modules · styled-components · Emotion · SCSS |
| 状态管理 | Zustand · Redux · Jotai · Pinia · TanStack Query · MobX |
| 路由 | App Router · Pages Router · React Router · Vue Router |
| 组件模式 | function 声明 · 箭头函数 |

检测结果写入 `codeferry.config.json`，可以手动修改。所有检测维度均可在交互确认时修正。

---

## 开发

```bash
git clone https://github.com/JiangDing1990/codeferry
cd codeferry
pnpm install

pnpm run build      # 构建
pnpm run dev        # 监听模式
pnpm run test       # 运行测试（watch 模式）
pnpm run test:run   # 单次运行所有测试
pnpm run lint       # TypeScript 类型检查
```

---

## 文档索引

| 文档 | 说明 |
|---|---|
| [完整使用教程](./docs/USAGE.zh-CN.md) | 所有场景的完整演练，含带注释的终端输出 |
| [架构设计](./docs/ARCHITECTURE.md) | 系统设计、模块拆分、数据模型 |
| [路线图](./ROADMAP.md) | 开发计划：v0.5.0 → v1.0.0 |
| [更新日志](./CHANGELOG.md) | 版本发布历史 |
| [贡献指南](./CONTRIBUTING.md) | 开发环境搭建和 PR 流程 |

---

## 路线图

完整的开发计划（v0.6.0–v1.0.0 特性规划）见 [ROADMAP.md](./ROADMAP.md)。

---

## 贡献

欢迎提 Issue 和 PR。架构设计详情见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

开发环境搭建、提交规范和 PR 流程详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## License

MIT © 2026
