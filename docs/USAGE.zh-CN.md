[English](./USAGE.md) | **简体中文**

# codeferry — 完整使用教程

> 本教程通过带注释的终端输出，详细演示每一个功能和使用场景。  
> 如需概览，请查阅 [README](../README.zh-CN.md)。

---

## 目录

1. [前置条件](#1-前置条件)
2. [安装](#2-安装)
3. [项目初始化 — `codeferry init`](#3-项目初始化--drift-init)
4. [组件映射 — `codeferry map`](#4-组件映射--drift-map)
5. [建立基线快照 — `codeferry snapshot`](#5-建立基线快照--drift-snapshot)
6. [场景 A — Design → Code（最常见场景）](#6-场景-a--design--code最常见场景)
7. [场景 B — Code → Design（反向同步）](#7-场景-b--code--design反向同步)
8. [场景 C — 冲突解决（两侧同时修改）](#8-场景-c--冲突解决两侧同时修改)
9. [场景 D — 批量同步（多个组件）](#9-场景-d--批量同步多个组件)
10. [场景 E — 单组件精准操作](#10-场景-e--单组件精准操作)
11. [场景 F — 无 AI 模式](#11-场景-f--无-ai-模式)
12. [场景 G — 同步全新设计稿组件](#12-场景-g--同步全新设计稿组件)
13. [场景 H — 代码侧新增文件（new-code）](#13-场景-h--代码侧新增文件new-code)
14. [查看同步状态 — `codeferry status`](#14-查看同步状态--drift-status)
15. [查看同步历史 — `codeferry log`](#15-查看同步历史--drift-log)
16. [配置文件详解](#16-配置文件详解)
17. [重新初始化与重置](#17-重新初始化与重置)
18. [多工作区管理 — `codeferry workspace`](#18-多工作区管理--codeferry-workspace)
19. [环境变量](#19-环境变量)
20. [常见问题排查](#20-常见问题排查)
21. [FAQ](#21-faq)

---

## 1. 前置条件

| 依赖 | 版本 | 说明 |
|---|---|---|
| **Node.js** | >= 18.0.0 | 推荐使用 LTS 版本 |
| **Claude Design** | 任意 | JSX 原型设计稿的来源 |
| **Anthropic API Key** | 可选 | 启用 AI 语义分析，没有也能完整使用 |

**开始前的目录结构：**

```
~/Downloads/my-design/          ← Claude Design 导出目录
  components/
    pages.jsx                   ← 设计侧 JSX（一个文件包含多个组件）
    shared.jsx
    extras.jsx

~/my-project/                   ← 生产代码目录（任意框架）
  src/
    app/
      account/page.tsx
      gallery/page.tsx
    components/
      shared/index.tsx
```

> **关于 Claude Design 导出格式：** 每个文件是零依赖的 JSX，在浏览器中通过 Babel Standalone 实时编译。一个文件通常包含多个页面级组件。codeferry 原生支持这种格式。

---

## 2. 安装

### 全局安装（推荐）

```bash
# npm
npm install -g codeferry

# pnpm
pnpm add -g codeferry

# 验证安装
codeferry --version
# 0.4.0
```

### 项目内本地安装

```bash
npm install --save-dev codeferry
# 然后通过 npx drift <命令> 使用
```

### 从源码安装

```bash
git clone https://github.com/JiangDing1990/codeferry.git
cd codeferry
pnpm install
pnpm run build
npm link     # 将 drift 命令链接到全局
```

---

## 3. 项目初始化 — `codeferry init`

`codeferry init` 是一次性的项目配置步骤，会创建 `.codeferry/` 状态目录、检测技术栈、提取设计稿组件、扫描代码文件、并生成初始快照。

### 基本用法

```bash
# 在任意目录运行，.codeferry/ 创建在当前工作目录
codeferry init \
  --design ~/Downloads/my-design/components \
  --code   ~/my-project
```

### 完整的交互式流程

```
$ codeferry init --design ~/Downloads/picture-hub/components --code ~/danqing

- 创建 .codeferry/ 目录...
✔ 已创建 .codeferry/ 目录

- 正在分析代码侧技术栈...
✔ 技术栈检测完成

  技术栈检测结果

  ✔ 框架         Next.js 15.0.0       （高置信 · package.json dependencies）
  ✔ 语言         TypeScript           （高置信 · tsconfig.json 存在）
  ✔ 样式         Tailwind CSS         （高置信 · tailwind.config.ts）
  ? 状态管理       TanStack Query       （中置信 · package.json dependencies）
  ? 路由         App Router           （中置信 · 目录结构推断）
  ? 组件模式       function 声明          （中置信 · 采样 10 文件）

? 以上检测结果是否正确？
❯ 确认并继续
  修正某些项
  全部手动填写
  跳过（不配置技术栈信息）
```

**选择「确认并继续」** — 检测结果准确时。

**选择「修正某些项」** — 需要纠正个别维度时：

```
? 选择需要修正的项：（空格选择，回车确认）
◻ 框架         Next.js 15
◻ 语言         TypeScript
◻ 样式         Tailwind CSS
◼ 状态管理      TanStack Query → 请输入正确的状态管理方案：zustand
◻ 路由         App Router

✔ 技术栈信息已更新
```

**选择「跳过」** — 在非交互环境中运行时（或直接加 `--skip-detect`）：

```bash
codeferry init --design ~/Downloads/my-design --code ~/my-project --skip-detect
```

### 确认后的补充约定收集

```
? 是否有其他项目约定需要告知同步工具？
  （这些信息会注入到 Prompt 中，帮助 AI 更准确地翻译代码）
  例如："CSS 类名使用 BEM 命名"、"组件在 features/ 目录下按功能分组"

> 组件使用 CSS Modules，文件名 *.module.scss
> 路由使用 App Router，页面文件放在 src/app/ 下
> （回车结束）

✔ 已保存 2 条项目约定

- 正在提取设计稿组件...
✔ 设计稿组件提取完成
✔ 扫描了 18 个文件，提取了 139 个组件
  分类：29 pages、69 shared、41 helpers

- 正在扫描代码文件...
✔ 代码文件扫描完成：66 个文件

✔ 初始化完成
  组件注册：139 个
  初始快照：snap_2026-05-31T04-12-15

ℹ 下一步：运行 codeferry map auto 自动建立组件映射关系
```

### 初始化后的 `.codeferry/` 目录

```
.codeferry/
├── codeferry.config.json      # 配置：路径、AI 设置、技术栈信息
├── registry.json          # 139 个组件（映射关系尚未建立）
├── queue.json             # 空的同步队列
└── snapshots/
    └── latest.json        # 初始快照（记录了所有文件哈希）
```

### 命令参数

| 参数 | 说明 |
|---|---|
| `--design <path>` | 设计稿根目录（必填） |
| `--code <path>` | 代码项目根目录（必填） |
| `--force` | 强制重新初始化（会覆盖已有 `.codeferry/`） |
| `--skip-detect` | 跳过技术栈检测（适合 CI 或脚本化场景） |

---

## 4. 组件映射 — `codeferry map`

映射关系将设计稿组件与对应的代码文件关联起来。没有映射，codeferry 就无法生成同步 Prompt。

### 第一步 — 运行自动映射

```bash
codeferry map auto
```

输出示例：

```
- 正在对 139 个未映射组件运行自动映射...
✔ 自动映射完成：49 个成功，90 个未匹配

┌──────────────────────┬──────────────────────────────────┬──────────┬────────────────────────────┐
│ 组件                 │ 匹配的代码文件                   │ 置信度   │ 理由                       │
├──────────────────────┼──────────────────────────────────┼──────────┼────────────────────────────┤
│ AccountPage          │ src/app/(dashboard)/account/pag… │ 60%      │ 文件名 + 导出名匹配        │
│ TopNav               │ src/components/shared/index.tsx  │ 95%      │ 导出名精确匹配 "TopNav"    │
│ Seal                 │ src/components/shared/index.tsx  │ 95%      │ 导出名精确匹配 "Seal"      │
│ GalleryPage          │ src/server/api/routers/gallery.… │ 85%      │ 文件名匹配 "gallery"       │
│ LoginPage            │ src/app/(auth)/login/page.tsx    │ 60%      │ 文件名 + 导出名匹配        │
└──────────────────────┴──────────────────────────────────┴──────────┴────────────────────────────┘

? 确认以上 49 个映射关系并写入注册表？（Y/n）Y

✔ 注册表已更新
✔ 映射完成：49 个组件已建立映射关系
  90 个组件未找到匹配，可用 codeferry map set 手动指定
```

### 第二步 — 查看映射表

```bash
codeferry map            # 完整映射表
codeferry map --unmapped # 仅显示未映射的组件
```

完整映射表示例（节选）：

```
┌─────────────────────────┬──────────────────────┬──────────────────────────────────┬─────────────┬────────────┐
│ 组件                    │ 设计稿文件           │ 代码文件                         │ 状态        │ 映射来源   │
├─────────────────────────┼──────────────────────┼──────────────────────────────────┼─────────────┼────────────┤
│ AccountPage             │ extras.jsx:3-162     │ src/app/(dashboard)/account/…    │ never-synced│ auto 60%   │
│ TopNav                  │ shared.jsx:6-27      │ src/components/shared/index.tsx  │ never-synced│ auto 95%   │
│ GalleryPage             │ other-pages.jsx:81…  │ src/server/api/routers/gallery…  │ never-synced│ auto 85%   │
│ WorkDetailPage          │ extras.jsx:449-536   │ src/lib/ai.ts                    │ never-synced│ auto 50%   │
│ TemplatesGrid           │ （未映射）           │ —                                │ new-design  │ —          │
└─────────────────────────┴──────────────────────┴──────────────────────────────────┴─────────────┴────────────┘
```

### 第三步 — 修正错误的映射

自动映射有时会指向错误的文件（例如 `GalleryPage` 映射到了 API router 而非 page 组件）。手动修正：

```bash
# 语法：codeferry map set "<文件>::<组件名>" "<相对代码路径>"
codeferry map set "other-pages.jsx::GalleryPage" "src/app/(dashboard)/gallery/page.tsx"
codeferry map set "extras.jsx::WorkDetailPage"   "src/app/(dashboard)/gallery/[id]/page.tsx"
codeferry map set "admin.jsx::AdminPage"         "src/app/(admin)/admin/page.tsx"
```

输出：

```
✔ 已手动设置映射：GalleryPage → src/app/(dashboard)/gallery/page.tsx
✔ 已手动设置映射：WorkDetailPage → src/app/(dashboard)/gallery/[id]/page.tsx
✔ 已手动设置映射：AdminPage → src/app/(admin)/admin/page.tsx
```

### 第四步 — 处理剩余未映射组件

```bash
codeferry map --unmapped
```

对于暂时没有代码对应物的组件，可以跳过：

```bash
# 移除一个错误的自动映射（让它保持 new-design 状态）
codeferry map unset "extras3.jsx::UnmappedWidget"

# 多个设计稿组件可以映射到同一个代码文件
codeferry map set "admin.jsx::AdminSidebar"  "src/app/(admin)/admin/content.tsx"
codeferry map set "admin.jsx::AdminTopBar"   "src/app/(admin)/admin/content.tsx"
codeferry map set "admin.jsx::AdminHeader"   "src/app/(admin)/admin/content.tsx"
```

### 组件 ID 格式

每个组件都有一个由来源文件和组件名构成的稳定 ID：

```
<相对设计稿文件路径>::<组件名>
```

示例：
- `extras.jsx::AccountPage`
- `shared.jsx::TopNav`
- `other-pages.jsx::GalleryPage`

随时可以用 `codeferry map` 查询 ID。

---

## 5. 建立基线快照 — `codeferry snapshot`

建立映射后，必须拍一次基线快照。这会记录当前两侧文件的 hash，之后的 `codeferry diff` 才能知道"什么是没变的"。

```bash
codeferry snapshot
```

输出：

```
- 正在更新所有已映射组件的基线快照...
✔ 基线更新完成：49 个组件
  90 个未映射组件已跳过
✔ 快照已保存：snap_2026-05-31T04-12-15
  状态已锁定为 synced 基线，下次 codeferry diff 将从此处开始比较
```

此时 `codeferry status` 会显示：

```
✔ synced 49  ·  ◐ design-ahead 0  ·  ◑ code-ahead 0  ·  ⚠ conflict 0
```

> **重要：** 跳过这一步的话，所有组件会停留在 `never-synced` 状态，`codeferry diff` 也不会报告任何变更。

---

## 6. 场景 A — Design → Code（最常见场景）

这是日常最常见的流程：设计师在 Claude Design 中更新了原型，需要将变更同步到生产代码。

### 完整演练

**第一步 — 在 Claude Design 中更新设计稿**

在 Claude Design 对话中描述你想要的变更，Claude Design 重新生成 JSX 文件并覆盖本地导出目录。

本例假设 `extras.jsx` 中的 `AccountPage` 安全设置部分新增了一行「API 令牌」管理。

**第二步 — 检测变更**

```bash
codeferry diff
```

设置了 `ANTHROPIC_API_KEY` 时（AI 语义分析模式）：

```
- 正在扫描双目录变更...
✔ 扫描完成：1 个设计变更，0 个代码变更 · 1 个组件受影响

  codeferry diff — design ↔ code

  ✔ synced 48  ◐ design-ahead 1  ◑ code-ahead 0  ⚠ conflict 0


  ◐ DESIGN AHEAD  AccountPage  (design-ahead)
  design: extras.jsx:3-162
  code:   src/app/(dashboard)/account/page.tsx

  变更类型：feature-add
  影响程度：medium
  摘要：在安全设置面板中新增了「API 令牌」管理入口

  同步建议：
    1. 在 SecurityTab 的 items 数组中新增：
       { key: "token", t: "API 令牌", d: "已生成 2 个访问令牌", a: "管理" }
    2. 在 handleAction() 里为 "token" 分支添加处理，
       暂时显示「开发中」Modal（类似现有的 2FA Modal）
    3. 可选：新增 ApiTokenModal 组件，参考 DeviceModal 的实现

ℹ 1 个组件设计侧领先 — 运行 codeferry sync --to code 同步到代码
```

未设置 `ANTHROPIC_API_KEY` 时（纯结构 diff 模式）：

```
  ◐ DESIGN AHEAD  AccountPage  (design-ahead)

  ◐ 设计侧当前内容（节选）：
    { t: 'API 令牌', d: '已生成 2 个访问令牌', a: '管理', k: 'token' },

  Diff（相对基线）：
    +                  { t: 'API 令牌', d: '已生成 2 个访问令牌', a: '管理', k: 'token' },
```

**第三步 — 生成同步 Prompt**

```bash
# 复制到剪贴板（默认）
codeferry sync --to code

# 或写入文件
codeferry sync --to code --out ./prompts/
```

输出：

```
- 正在扫描双目录变更（Design → Code）...
✔ 扫描完成

  codeferry sync — Design → Code

  找到 1 个组件需要同步：
    ◐ AccountPage  extras.jsx

- 正在读取组件内容...
✔ 内容读取完成
- 正在生成 Prompt...
✔ Prompt 已复制到剪贴板

ℹ 下一步：

  1. 将剪贴板内容粘贴给 Claude Code
  2. 等待 Claude Code 完成修改
  3. 确认修改结果符合预期
  4. 运行 codeferry snapshot --after-sync 更新同步基线
```

**第四步 — 粘贴给 Claude Code**

打开 Claude Code 会话（或你的 AI 编程助手），粘贴剪贴板内容。生成的 Prompt 包含：
- 完整的设计稿组件源码（含新增的 API 令牌行）
- 完整的生产代码（`SecurityTab` 函数，包含 TypeScript 类型和 tRPC hooks）
- 技术栈上下文（Next.js、Tailwind、TypeScript）
- 框架特定的转换指引（将设计稿内联样式 → Tailwind 类名等）
- AI 生成的逐步操作建议

Claude Code 会按照现有代码规范，在 `SecurityTab` 中添加 API 令牌项。

**第五步 — 审查变更**

Claude Code 完成修改后，在编辑器中确认结果符合预期。

**第六步 — 闭合循环**

```bash
codeferry snapshot --after-sync
```

输出：

```
- 正在更新 in-progress 状态组件的基线...
✔ 基线更新完成：1 个组件（AccountPage）
✔ 快照已保存：snap_2026-05-31T10-44-22
  1 个组件已标记为 synced
```

此时 `codeferry status` 回到 `✔ synced 49`。

---

## 7. 场景 B — Code → Design（反向同步）

当工程师直接在代码里增加了功能（绕过了设计稿原型），你需要将变更同步回设计稿。

### 完整演练

**第一步 — 修改代码**

假设开发者在 `account/page.tsx` 的 `PrefsTab` 中添加了暗色模式切换功能。

**第二步 — 检测代码侧变更**

```bash
codeferry diff --side code
```

```
- 正在扫描代码侧变更...
✔ 扫描完成：0 个设计变更，1 个代码变更 · 1 个组件受影响

  ◑ CODE AHEAD  AccountPage  (code-ahead)
  design: extras.jsx:3-162
  code:   src/app/(dashboard)/account/page.tsx

  变更类型：feature-add
  摘要：在 PrefsTab 中新增了暗色模式切换
```

**第三步 — 生成反向同步 Prompt**

```bash
codeferry sync --to design
```

生成的 Prompt 会指示 Claude Design：
- 理解生产代码中暗色模式切换的实现逻辑
- 将其转换为浏览器原生 JSX（无 import/export，内联样式，无 TypeScript 类型）
- 用静态 mock 状态替代 tRPC/API 调用
- 保持设计稿现有的视觉风格不变

**第四步 — 粘贴给 Claude Design**

将 Prompt 粘贴到 Claude Design 对话框。Claude Design 会更新设计稿原型并重新导出文件。

**第五步 — Claude Design 重新导出后，更新基线**

```bash
# 确保 Claude Design 已将新文件写入磁盘后再执行！
codeferry snapshot --after-sync
```

> **顺序很重要：** 必须先等 Claude Design 导出完成（文件写入磁盘），再运行 `codeferry snapshot`。否则快照记录的是旧文件的 hash，下次 `codeferry diff` 会误报为「代码侧领先」。

---

## 8. 场景 C — 冲突解决（两侧同时修改）

当设计稿和代码**自上次基线以来都发生了修改**，codeferry 就会检测到冲突，无法自动决定哪一侧优先。

### 冲突是什么样子

```bash
codeferry diff
```

```
  ⚠ CONFLICT  TopNav  (both-changed)
  design: shared.jsx:6-27
  code:   src/components/shared/index.tsx

  变更类型：both-changed
  摘要：设计侧新增了搜索图标；代码侧新增了通知角标

  设计侧 Diff（相对基线）：
    + <SearchIcon size={20} />

  代码侧 Diff（相对基线）：
    + <NotificationBadge count={unreadCount} />
```

### 解决流程

**第一步 — 生成合并 Prompt**

```bash
codeferry sync --to code --component "shared.jsx::TopNav"
```

冲突 Prompt 包含：
- 设计侧 diff（新增搜索图标）
- 代码侧 diff（新增通知角标）
- 明确指令：**合并两个变更，不能丢弃任何一侧**

**第二步 — 粘贴给 Claude Code**

Claude Code 会将搜索图标（来自设计稿）和通知角标（来自代码）合并到同一个 `TopNav` 组件中。

**第三步 — 确认合并结果后更新基线**

```bash
codeferry snapshot --after-sync
```

> **小技巧：** 对于复杂的冲突，也可以手动编辑代码文件完成合并，然后直接运行 `codeferry snapshot --component "shared.jsx::TopNav"` 标记为已解决。

---

## 9. 场景 D — 批量同步（多个组件）

当设计稿经过一次大版本更新，多个组件都需要同步时，可以一次性处理所有。

```bash
codeferry diff
```

```
  ✔ synced 35  ◐ design-ahead 8  ◑ code-ahead 2  ⚠ conflict 1
```

**一次性同步所有 design-ahead 组件：**

```bash
codeferry sync --to code --out ./prompts/
```

```
- 正在扫描双目录变更（Design → Code）...
✔ 扫描完成

  8 个组件需要同步：
    ◐ AccountPage     extras.jsx
    ◐ CreatePage      create.jsx
    ◐ GalleryPage     other-pages.jsx
    ◐ LoginPage       login.jsx
    ◐ SearchPage      search.jsx
    ◐ TopNav          shared.jsx
    ◐ Footer          shared.jsx
    ◐ PricingPage     pricing.jsx

- 正在写入 8 个 Prompt 文件到 ./prompts/...
✔ 已写入 8 个文件到 ./prompts/
  → AccountPage_d2c_2026-05-31.md
  → CreatePage_d2c_2026-05-31.md
  → GalleryPage_d2c_2026-05-31.md
  ...
```

打开每个 `.md` 文件，逐一（或并行开多个 Claude Code 会话）粘贴给 Claude Code。

所有变更完成后：

```bash
codeferry snapshot --after-sync
```

> **操作建议：** 优先处理 `impact: high` 的组件（`codeferry diff` 的 AI 分析结果中会标注），这些通常是核心页面或公共组件，影响面最大。

---

## 10. 场景 E — 单组件精准操作

当你只关心某一个组件时，所有命令都支持 `--component` 参数：

```bash
# 只检测某个组件
codeferry diff --component "extras.jsx::AccountPage"

# 只生成某个组件的 Prompt
codeferry sync --to code --component "extras.jsx::AccountPage" --copy

# 只更新某个组件的基线
codeferry snapshot --component "extras.jsx::AccountPage"
```

适用场景：
- 快速迭代单个 UI 元素
- 在批量同步前预览某个 Prompt 的内容
- 手动解决了某个冲突后，只更新该组件的基线

---

## 11. 场景 F — 无 AI 模式

没有 `ANTHROPIC_API_KEY`，或希望跳过 API 调用加快执行速度时：

```bash
codeferry diff --no-ai              # 仅结构 diff，不调用 API
codeferry sync --to code --no-ai   # 使用通用转换指引（不分析变更意图）
```

无 AI 模式下，Prompt 仍然包含：
- 完整的设计稿组件源码
- 完整的代码文件内容
- 技术栈上下文（来自 `codeferry.config.json` 的配置）
- 框架特定的转换规则（`codeferry init` 时生成）

缺少的内容：
- 变更意图分类（`feature-add`、`style-change` 等）
- 影响程度评估
- 逐步操作建议

无 AI 模式对绝大多数常规变更已经足够。AI 模式在处理复杂的业务逻辑变更或冲突解决时更有价值。

### 配置 AI 分析

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# 永久配置，加入 shell profile：
echo 'export ANTHROPIC_API_KEY="sk-ant-api03-..."' >> ~/.zshrc
source ~/.zshrc
```

---

## 12. 场景 G — 同步全新设计稿组件

当 Claude Design 创建了一个全新页面，代码库中还没有对应文件时。

**第一步 — `codeferry diff` 后会显示：**

```
  + NEW DESIGN (3) — 未映射到代码文件
    TemplateEditPage   extras.jsx:539-684
    CommentSection     author.jsx:668-733
    BrushSelector      create.jsx:120-180
```

**第二步 — 将其映射到一个目标路径（文件可以暂时不存在）：**

```bash
codeferry map set "extras.jsx::TemplateEditPage" "src/app/(dashboard)/templates/[id]/edit/page.tsx"
```

即使目标文件还不存在，也可以提前建立映射。

**第三步 — 生成创建 Prompt：**

```bash
codeferry sync --to code --component "extras.jsx::TemplateEditPage"
```

由于代码目标文件不存在，Prompt 会指示 Claude Code **创建**该文件。Claude Code 会按照项目约定（TypeScript 类型、App Router 规范、tRPC 接入方式）完整搭建新路由。

**第四步 — 文件创建后更新基线：**

```bash
codeferry snapshot --component "extras.jsx::TemplateEditPage"
```

---

## 13. 场景 H — 代码侧新增文件（new-code）

当工程团队创建了设计稿中没有对应原型的新文件时。

```
codeferry status

  + NEW CODE (5) — 未映射到设计稿
    src/app/api-docs/page.tsx
    src/app/help/page.tsx
    src/components/admin/DangerZone.tsx
    ...
```

这些文件出现在状态报告中，但 codeferry 不会主动同步它们，除非你显式建立映射。

**选项 1 — 映射到设计稿中现有的最近组件：**

```bash
codeferry map set "other-pages.jsx::HelpPage" "src/app/help/page.tsx"
```

**选项 2 — 保持未映射（codeferry 将其标记为 `new-code`，不做任何操作）：**

无需任何操作，它们会一直处于 `new-code` 状态，直到你需要为止。

---

## 14. 查看同步状态 — `codeferry status`

`codeferry status` 提供全局状态概览，不需要重新扫描文件系统。

```bash
codeferry status              # 显示缓存状态
codeferry status --refresh    # 先重新扫描文件系统，再显示
```

```
  codeferry status — design ↔ code

  Totals: 49 mapped · 90 unmapped design · 35 unmapped code

  ✔ synced 43  ·  ◐ design-ahead 3  ·  ◑ code-ahead 1  ·  ⚠ conflict 1  ·  ○ never-synced 1

  ⚠ 冲突 (1)
    TopNav       shared.jsx ↔ src/components/shared/index.tsx
    design: +搜索图标   code: +通知角标

  ◐ 设计侧领先 (3)
    AccountPage  extras.jsx → src/app/(dashboard)/account/page.tsx   +API令牌
    CreatePage   create.jsx → src/app/(dashboard)/create/page.tsx    笔刷面板更新
    PricingPage  pricing.jsx → src/app/pricing/page.tsx              新套餐布局

  ◑ 代码侧领先 (1)
    PrefsTab     extras.jsx ← src/app/(dashboard)/account/page.tsx   暗色模式切换
```

**按状态过滤：**

```bash
codeferry status --filter design-ahead    # 只看设计侧领先
codeferry status --filter conflict        # 只看冲突
codeferry status --filter never-synced    # 只看从未同步的
codeferry status --filter new-design      # 只看新增设计组件
```

---

## 15. 查看同步历史 — `codeferry log`

```bash
codeferry log                            # 所有历史（最新在前）
codeferry log --last 5                   # 最新 5 条
codeferry log --component "extras.jsx::AccountPage"   # 某个组件
codeferry log --status done              # 只看已完成的同步
```

```
  codeferry log — 同步历史

  [2026-05-31 10:44]  AccountPage       design→code   done     feature-add   新增 API 令牌管理
  [2026-05-30 15:22]  TopNav            design→code   done     style-change  添加搜索图标
  [2026-05-30 09:11]  GalleryPage       design→code   done     layout-change 网格→瀑布流
  [2026-05-29 18:03]  CreatePage        conflict      done     both-changed  合并笔刷选择器
  [2026-05-28 22:15]  PricingPage       design→code   pending  feature-add   新套餐卡片
```

---

## 16. 配置文件详解

配置文件位于 `.codeferry/codeferry.config.json`，可直接编辑。

```jsonc
{
  "version": "2.0",

  // 设计侧 — Claude Design 导出目录
  "design": {
    "root": "~/Downloads/picture-hub/components",
    "include": ["**/*.jsx", "**/*.tsx", "**/*.html", "**/*.css"],
    "exclude": [
      "design-canvas.jsx"   // 排除画布容器本身（非业务组件）
    ]
  },

  // 代码侧 — 生产项目目录
  "code": {
    "root": "~/danqing",
    "include": ["**/*.tsx", "**/*.ts"],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/prisma/**",       // 排除 Prisma 生成文件
      "**/*.test.*",        // 排除测试文件
      "**/*.spec.*"
    ]
  },

  // AI 设置
  "ai": {
    "model": "claude-sonnet-4-20250514",  // 语义分析使用的模型
    "batchSize": 5,                        // 每批分析的组件数
    "maxConcurrency": 3                    // 并发 API 请求数
  },

  // 项目上下文 — 注入到所有同步 Prompt 中
  "project": {
    // 由 codeferry init 自动检测，技术栈变化时可手动修改
    "stack": "Next.js 15 + TypeScript + Tailwind CSS",

    // 自由格式的项目约定，原文注入到 Prompt 中
    "conventions": [
      "组件使用 CSS Modules，文件名 *.module.scss",
      "路由使用 App Router，页面文件放在 src/app/ 下",
      "服务端状态：tRPC + TanStack Query（api.xxx.useQuery）",
      "身份验证：next-auth v5 (beta)"
    ],

    // Design → Code 方向的转换指引
    // 由技术栈信息自动生成，也可手动定制
    "designToCodeHints": [
      "将内联样式转换为 Tailwind 类名",
      "添加 TypeScript 类型注解",
      "用 tRPC API 调用（api.xxx.useQuery）替换静态 mock 数据",
      "用 next/link 替换 <a href> 内部导航",
      "去掉 React.useState 的 React. 前缀，改用 useState from 'react'",
      "保留代码侧现有的工程结构和命名规范"
    ],

    // Code → Design 方向的转换指引
    "codeToDesignHints": [
      "设计稿使用浏览器原生 JSX，不需要 import/export 语句",
      "将 Tailwind 类名转换为等价的内联样式",
      "移除 TypeScript 类型注解",
      "将 tRPC 查询调用替换为硬编码的静态 mock 数据数组",
      "将 next/link 替换为普通 <a href> 标签",
      "将 next/image 替换为普通 <img> 标签"
    ]
  }
}
```

### 自定义 include/exclude 规则

默认扫描两侧的 `**/*.jsx`、`**/*.tsx`、`**/*.ts`。可以根据项目结构精确控制：

```jsonc
"code": {
  "include": ["src/**/*.tsx", "src/**/*.ts"],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "src/server/**",          // 排除纯服务端代码
    "src/types/**",           // 排除纯类型文件
    "**/*.stories.*"          // 排除 Storybook stories
  ]
}
```

---

## 17. 重新初始化与重置

### 仅更新技术栈检测（保留映射和快照）

如果你将样式方案从 CSS Modules 迁移到了 Tailwind，可以更新技术栈信息，而不影响已有的映射和快照：

```bash
# 直接编辑 codeferry.config.json
vi .codeferry/codeferry.config.json
# 修改 project.stack 和 project.designToCodeHints 等字段
# 下一次 codeferry sync 会自动使用新的配置
```

### 强制重新初始化

```bash
codeferry init --force
# 重新走完整的 init 流程，包括技术栈检测
```

> **注意：** `--force` 会重新提取所有组件，但保留已有的映射文件（`registry.json` 中的映射部分）。如果想完全清空，请手动删除 `.codeferry/`。

### 完整重置

```bash
rm -rf .codeferry/
codeferry init --design ~/Downloads/my-design --code ~/my-project
codeferry map auto
codeferry snapshot
```

### 仅更新约定（无需重新初始化）

直接编辑 `codeferry.config.json`：

```json
"conventions": [
  "已迁移到 Tailwind CSS v4，尽量少用 @apply",
  "组件目录从 src/components/ 迁移到 src/features/"
]
```

无需重新初始化，下次 `codeferry sync` 就会使用新的约定。

---

## 18. 多工作区管理 — `codeferry workspace`

如果你同时维护多组 design+code 配对（例如 Web 端和移动端），可以在同一个 `.codeferry/` 目录下创建多个工作区，每个工作区拥有独立的配置、注册表和快照。

### 创建第二个工作区

```bash
# 创建并初始化名为 mobile-app 的工作区
codeferry workspace create mobile-app --design ~/mobile-design --code ~/mobile-src

# 等效写法（workspace 别名为 ws）
codeferry ws create mobile-app --design ~/mobile-design --code ~/mobile-src
```

### 列出所有工作区

```bash
codeferry workspace list
# 输出示例：
#  WORKSPACE     DESIGN              CODE                COMPONENTS
#  default       ./design            ./src               12
# *mobile-app    ./mobile-design     ./mobile-src        8
# (* 表示当前活跃工作区)
```

### 切换工作区

```bash
codeferry workspace use default      # 持久切换（写入 state.json）
codeferry workspace current          # 查看当前工作区

# 单次覆盖（不改变持久状态）
codeferry status -w mobile-app
codeferry diff -w default
```

### 删除工作区

```bash
codeferry workspace remove mobile-app         # 交互式确认
codeferry workspace remove mobile-app --force # 跳过确认
codeferry workspace remove default --force    # default 工作区只能用 --force 删除
```

### 工作区解析优先级

```
-w 参数 > CODEFERRY_WORKSPACE 环境变量 > state.json > "default"
```

### 从旧版本自动迁移

v0.4.x 使用平铺的 `.codeferry/` 结构。升级到 v0.5.0+ 后，第一次运行任意命令时会**自动迁移**：

```
.codeferry/codeferry.config.json  →  .codeferry/workspaces/default/codeferry.config.json
.codeferry/registry.json          →  .codeferry/workspaces/default/registry.json
.codeferry/snapshots/             →  .codeferry/workspaces/default/snapshots/
（其他文件同理）
```

迁移完成后会输出提示：`ℹ 已将现有配置迁移到 'default' 工作区`。迁移幂等，重复运行不会重复执行。

---

## 19. 环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 可选 | 启用 `codeferry diff` 和 `codeferry sync` 的 AI 语义分析 |
| `CODEFERRY_WORKSPACE` | 可选 | 指定活跃工作区，等效于每条命令加 `-w <名称>` 参数 |

```bash
# 临时设置（仅当前会话）
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# 永久设置（添加到 ~/.zshrc 或 ~/.bashrc）
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc

# 项目级设置（.env 文件 — 不要提交到 git！）
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env
# codeferry 会自动读取 .env 文件
```

### `CODEFERRY_WORKSPACE` — 多工作区 CI 场景

在 CI 环境中，使用环境变量比每次传 `-w` 参数更方便：

```bash
# 在 CI pipeline 中为不同工作区分别运行检查
CODEFERRY_WORKSPACE=web codeferry diff --no-ai
CODEFERRY_WORKSPACE=mobile codeferry diff --no-ai

# 等效的 CLI 参数写法
codeferry diff --no-ai -w web
codeferry diff --no-ai -w mobile
```

优先级（从高到低）：`-w` 参数 > `CODEFERRY_WORKSPACE` > `.codeferry/state.json` > `default`

---

## 20. 常见问题排查

### `codeferry init` 技术栈检测全部是低置信度或空白

**症状：** 所有维度显示「低置信」或「未检测到」。

**原因和修复：**

```bash
# 错误：--code 指向了子目录，而非项目根目录
codeferry init --design ~/design --code ~/my-project/src   # ✗

# 正确：指向包含 package.json 的项目根目录
codeferry init --design ~/design --code ~/my-project       # ✓

# 验证 package.json 存在
ls ~/my-project/package.json   # 必须存在

# 或者跳过检测，手动编辑配置
codeferry init --skip-detect
vi .codeferry/codeferry.config.json
```

### `codeferry diff` 在我更新了设计稿后显示没有变更

**原因 1 — 还没拍快照：**

```bash
codeferry snapshot   # 先建立基线
codeferry diff       # 之后才能看到变更
```

**原因 2 — 文件被 exclude 规则排除了：**

检查 `codeferry.config.json` 中的 `design.include` 是否包含你修改的文件扩展名：

```jsonc
"include": ["**/*.jsx", "**/*.tsx"]  // 确认扩展名匹配
```

**原因 3 — 设计稿文件不在 `design.root` 目录下：**

```bash
cat .codeferry/codeferry.config.json | grep '"root"'
# 确认 design.root 路径正确
```

### 自动映射把 GalleryPage 指向了 API router 而非 page 组件

**症状：** `GalleryPage` 映射到 `src/server/api/routers/gallery.ts` 而不是 `src/app/(dashboard)/gallery/page.tsx`。

**修复：**

```bash
codeferry map set "other-pages.jsx::GalleryPage" "src/app/(dashboard)/gallery/page.tsx"
```

**原因：** 文件名相似度策略对 `gallery.ts` 和 `gallery/page.tsx` 评分相近。App Router 的路由分组语法 `(dashboard)` 进一步降低了路径匹配分数。这是已知问题，将在 v0.6.0 中优化。

### `codeferry sync` 剪贴板输出为空

**症状：** 命令显示成功但粘贴时没有内容。

**修复：**

```bash
# 改用写入文件的方式
codeferry sync --to code --out ./prompts/
# 手动打开 .md 文件
```

### `codeferry snapshot --after-sync` 提示更新了 0 个组件

**原因：** `codeferry sync` 会将组件标记为 `in-progress`。但如果你之前运行了不带 `--after-sync` 的 `codeferry snapshot`，它已经清空了队列。

**修复：**

```bash
# 直接指定组件强制更新
codeferry snapshot --component "extras.jsx::AccountPage"
```

### 组件提取的行范围不正确

**症状：** `AccountPage` 显示为第 3-120 行，但实际上到第 162 行才结束。

**原因：** 提取器使用花括号深度计数算法。嵌套极深的条件块（如包含很多嵌套 div 的 Modal）可能干扰边界检测。

**修复：** 检查设计稿 JSX 中是否有不匹配的花括号（注释掉的闭合括号是常见的问题来源）。提取器对标准 Claude Design 输出非常可靠，但非标准格式可能会出现边界误判。

---

## 21. FAQ

**Q：codeferry 会直接修改我的代码文件吗？**  
A：不会。codeferry 只生成 Markdown 格式的 Prompt 文件。所有代码修改都由你将 Prompt 粘贴给 Claude Code 或 Claude Design 后，由 AI 完成。codeferry 是一个「Prompt 工厂」，不会触碰你的源代码。

**Q：应该在哪个目录运行 `codeferry init`？**  
A：任意目录都可以，`.codeferry/` 会在你的**当前工作目录**创建。一个常见的做法是在两个项目的共同父目录运行：

```
~/projects/             ← 在这里运行 codeferry init
  design-exports/       ← --design 指向这里
  my-app/               ← --code 指向这里
  .codeferry/               ← 自动创建在这里
```

**Q：能和 Vue 或 Svelte 项目一起用吗？**  
A：可以。核心同步引擎与框架无关。技术栈检测支持 Vue + Nuxt 和 Svelte + SvelteKit。生成的 Prompt 会包含对应框架的转换指引。

**Q：设计稿导出了 HTML 文件怎么办？**  
A：codeferry 会扫描 HTML 文件中的 `<script type="text/babel">` 块，从中提取 JSX 组件。在 `design.include` 里加上 `**/*.html` 即可启用此功能。

**Q：AI 分析总是超时，怎么办？**  
A：减小批处理大小：

```json
"ai": {
  "batchSize": 2,
  "maxConcurrency": 1
}
```

或者对常规变更直接跳过 AI：

```bash
codeferry diff --no-ai
codeferry sync --to code --no-ai
```

**Q：多个开发者能共享同一个 `.codeferry/` 目录吗？**  
A：设计上面向单开发者使用。如果需要团队协作，建议将 `codeferry.config.json` 和 `registry.json` 提交到 git（这是稳定的配置状态），但把 `queue.json` 和 `snapshots/` 加入 `.gitignore`（这是个人的临时状态）。

**Q：如何更新 codeferry？**  
A：`npm update -g codeferry` 或 `pnpm update -g codeferry`。

**Q：Claude Design 覆盖导出了所有文件，会不会所有组件都变成 design-ahead？**  
A：不会。codeferry 先比对文件级 hash 做快速过滤，只对文件内容确实发生变化的重新提取组件 hash。即使 Claude Design 重写了 20 个 JSX 文件，`codeferry diff` 也只会报告内容真正变化的组件，不会产生误报。

**Q：能在 CI 中使用 codeferry 吗？**  
A：可以，适合用于漂移检测（不适合执行同步）：

```bash
# 在 CI 中检测是否有未同步的漂移
codeferry diff --no-ai
if codeferry status | grep -q "design-ahead\|code-ahead\|conflict"; then
  echo "检测到漂移！请运行 codeferry sync 进行同步。"
  exit 1
fi
```

**Q：如果我的 API Key 被消耗完了会怎样？**  
A：codeferry 会自动降级为无 AI 模式。你会看到提示：`未设置 ANTHROPIC_API_KEY 或 API 调用失败，跳过 AI 分析（使用通用指引）`。其余功能完全正常。

**Q：`.codeferry/` 目录应该加入 `.gitignore` 吗？**  
A：取决于你的使用方式。推荐配置：

```gitignore
# .gitignore

# 提交配置和映射表（团队共享）
# .codeferry/codeferry.config.json
# .codeferry/registry.json

# 忽略临时状态
.codeferry/queue.json
.codeferry/snapshots/
.codeferry/history/
```

---

*← 返回 [README](../README.zh-CN.md) · 另请参阅：[架构设计](./ARCHITECTURE.md) · [路线图](../ROADMAP.md)*
