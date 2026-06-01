# Changelog

所有版本变更记录，遵循 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) 格式和 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

未来版本的开发计划见 [ROADMAP.md](./ROADMAP.md)。

---

## [0.7.0] — 2026-06-01

### 新增
- **快照内容存储**：`codeferry snapshot` 现在将组件内容（设计侧行范围切片 + 代码侧文件拼接）同步存入快照，使 `codeferry diff` 能展示真正的 baseline → current 行级 diff，而不再是"无基线内容"占位符
  - 超过 100 KB 的组件内容优雅降级（仅存 hash，diff 显示提示语）
  - 旧快照（无内容字段）自动降级为原有展示方式，不中断现有工作区
- **彩色 unified diff**：`codeferry diff` 输出现在使用 ANSI 彩色展示行级 diff
  - `+` 添加行 → 绿色，`-` 删除行 → 红色，`@@` 块头 → 青色，文件头 → 粗体
- **`--format json` 机器可读输出**：`codeferry diff --format json` 输出干净的 JSON 到 stdout，包含 `summary` + `components`（含 `designDiff`/`codeDiff` 文本字段），适合 CI 脚本、编辑器插件集成
  - JSON 模式下自动跳过 AI 分析、静默 spinner，退出码始终为 0（非零 CI 门控留 v0.8.0 的 `--ci` 标志）
- 新增 14 个单元测试（`generateComponentDiff` + `colorizeUnifiedDiff`），总测试数升至 **115 个**

### 变更
- `src/core/differ.ts` — `generateComponentDiff()` 重构为纯函数（不再有文件系统 I/O），接受 `baseline/current` 内容字符串，由调用方负责从快照读取内容
- 新增导出：`colorizeUnifiedDiff(patch: string): string`

---

## [0.6.0] — 2026-05-31

### 新增
- **Strategy 3 — HTML Bridge 映射策略**：自动解析 `designRoot/index.html` 找到 Vite/Claude Design 入口 JS 文件，追踪 1 层 `import` 语句，构建"设计文件路径段"索引，与代码文件路径结构做重叠匹配（置信度 0.50–0.80），作为 filename + export-name 策略的补充
- **AI 辅助映射 Fallback**（`src/core/ai-mapper.ts`）：当自动策略无法匹配时，批量调用 Claude API（每批最多 8 个组件），从可用代码文件列表中推断最合适的映射；置信度 < 0.5 的建议自动丢弃；无 API Key 时静默降级
- **`codeferry map suggest`**：AI 辅助交互式映射命令。先运行自动策略，再对剩余未映射组件使用 AI fallback，展示汇总建议表格，逐条交互 Accept / Skip / 手动输入路径，一次性写入 registry
  - `--no-ai`：跳过 AI 推断，仅展示自动策略候选
- **`DriftConfig.mapping.autoThreshold`**：`codeferry map auto` 置信度阈值，可在 `codeferry.config.json` 中配置（默认 0.5）
- 新增 9 个单元测试（`tests/ai-mapper.test.ts`）+ 3 个 mapper HTML bridge 测试，总测试数升至 **103 个**

### 变更
- `codeferry map auto`：自动映射现在读取 `config.mapping.autoThreshold`（默认 0.5）；未匹配时提示使用 `codeferry map suggest`
- `codeferry map auto`：description 更新，说明包含 HTML Bridge 策略

---

## [0.5.1] — 2026-05-31

### 修复
- `map.ts`：建立映射时目标文件不存在改为 fail-hard（`process.exit(1)`）；原先 warn+继续会写入空 hash，导致 `differ.ts` 永远忽略代码侧变更（静默失效）
- `diff.ts`：移除无意义的"hash 字符串→完整组件"假 baseline diff；工具目前只存 hash 不存内容，改为显示中性提示
- `snapshot.ts`：软化"假同步"警告措辞；原措辞在用户手动恢复文件等正常场景下也会误触发
- `reporter.ts` + `init.ts`：`printInitComplete` 不再自行输出 next-steps，由 `init.ts` 统一按正确顺序输出（`map auto` → `status`）
- `store.ts`：JSON 解析失败错误信息精确到具体文件路径和 `rm` 命令，不再建议删整个 `.codeferry/` 目录
- `prompt-builder.ts`：删除 `hasDetectedFields` 永假死代码分支（`tryLoadStackInfo` 只返回 hints 数组，不含 `framework`/`language` 等字段）
- `hash.ts`：`hashMultiple` 改用流式 hasher + null-byte 分隔符，消除文本分隔符的理论碰撞风险
- `path.ts`：`resolvePath` 仅展开 `~/` 前缀；`~user/path` 不再被静默错误解析
- `status.ts`：删除每次运行都输出的 `--refresh` 提示；修正所有命令文件中遗留的 `drift xxx` 旧命令名
- 文档：在 `USAGE.zh-CN.md` §18 记录 `CODEFERRY_WORKSPACE` 环境变量及 CI 使用示例

---

## [0.5.0] — 2026-05-31

### 新增
- **多工作区支持**：在单个 `.codeferry/` 目录下管理多组 design+code 配对
- **`codeferry workspace`（别名 `ws`）** 子命令组：
  - `workspace list`：列出所有工作区及其配置摘要
  - `workspace create <name>`：创建并初始化新工作区（支持 `--design`、`--code`）
  - `workspace use <name>`：切换当前活跃工作区
  - `workspace current`：显示当前工作区名称
  - `workspace remove <name>`：删除工作区（`default` 需要 `--force`）
- **全局 `-w / --workspace` 参数**：所有命令支持 `codeferry status -w mobile-app` 单次覆盖当前工作区
- **工作区解析优先级**：`-w` 参数 > `CODEFERRY_WORKSPACE` 环境变量 > `state.json` > `"default"`
- **自动迁移**：旧版本平铺 `.codeferry/` 结构自动迁移为 `workspaces/default/` 子目录（无感知）
- **`WorkspaceManager`**（`src/state/workspace.ts`）：工作区生命周期管理
- **`resolveStore()`**（`src/state/resolve-store.ts`）：共享 helper，消除命令文件重复 boilerplate
- 22 个新增单元测试（`tests/workspace.test.ts`），总测试数 90 个

---

## [0.4.0] — 2026-05-31

### 变更
- npm 包名从 `drift-cli` 更名为 `codeferry`（CLI 命令 `codeferry` 不变）
- GitHub 仓库迁移至 `JiangDing1990/codeferry`
- **首次发布到 npm**：`npm install -g codeferry`

---

## [0.4.0] — 2026-05-30

### 新增
- **`codeferry log`** 命令：查看同步队列历史，支持 `--component`、`--last <n>`、`--status` 过滤
- 同步队列状态分组展示（CONFLICT → IN-PROGRESS → PENDING → DONE → SKIPPED）
- `codeferry log` 输出统计栏：总计 / done / in-progress / pending / skipped / conflict 计数
- 分页提示：`--last` 截断时显示"仅显示最新 N 条，共 M 条记录"

### 修复
- `codeferry log` 分组标题使用 ANSI-safe `toUpperCase`（避免 chalk 转义序列中 `m` 变 `M` 破坏终端颜色）
- `codeferry log --last` 分页计数使用 `filteredTotal`（筛选后的数量），而非全量队列长度

---

## [0.3.0] — 2026-05-30

### 新增
- **`codeferry sync`** 命令：生成双向同步 Prompt（`--to code` / `--to design`），支持剪贴板输出（`--copy`）或文件输出（`--out <dir>`）
- **`codeferry diff` AI 分析集成**：自动调用 Claude API 进行语义分析，结果展示在 diff 输出中
- **AI 分析器**（`src/core/analyzer.ts`）：
  - 批量并发分析（`p-limit` 控制并发），指数退避重试（仅 429/500/529）
  - 无 API Key 时优雅降级，返回默认结果
  - 大文件截断（超过 8000 字符自动截断并注明）
- **双向 Prompt 生成器**（`src/output/prompt-builder.ts`）：
  - 方向感知内容路由（`design-to-code` / `code-to-design`）
  - 动态注入技术栈转换指引（来自 StackDetector）
  - 包含 AI 分析结果（intent / impact / syncGuide）
- **同步队列管理**：`codeferry diff` 写入 pending 队列，`codeferry sync` 更新为 in-progress
- **`codeferry snapshot --after-sync`**：仅更新队列中 in-progress 的组件，自动标记为 done

### 修复
- `codeferry diff` 的 `--no-ai` flag 处理：commander 将 `--no-ai` 转换为 `opts.ai = false`，正确映射为 `noAi: !opts.ai`
- `codeferry sync` 的内容方向路由 bug：`code-to-design` 方向下代码内容/设计内容位置互换
- `codeferry snapshot --after-sync` 误标记历史同步组件：改为在快照前提取 `inProgressIds`，仅标记本次进行中的组件
- `buildStackContext` 在 StackInfo 无检测字段时无法展示 `config.project.stack`：改用 `hasDetectedFields` 布尔判断

---

## [0.2.0] — 2026-05-30

### 新增
- **`codeferry map`** 命令：映射关系管理（`list` / `auto` / `set` / `unset`）
- **Mapper**（`src/core/mapper.ts`）：两阶段自动映射策略
  - 策略一：文件名模糊匹配（PascalCase → kebab-case 规范化，支持路径段匹配）
  - 策略二：导出名正则匹配（`export function` / `export const` / `export { ... }`）
  - 双策略命中时置信度提升，最终选择最高置信候选
- **StackDetector**（`src/core/stack-detector.ts`）：代码侧技术栈自动检测
  - 检测框架（Next.js / Nuxt / SvelteKit / Vite+React / Vue / Angular）
  - 检测语言（TypeScript / JavaScript）
  - 检测样式方案（Tailwind / CSS Modules / styled-components / Emotion / SCSS）
  - 检测状态管理（Zustand / Redux / Jotai / Pinia / TanStack Query / MobX）
  - 检测路由（App Router / Pages Router / React Router / Vue Router）
  - 检测组件模式（function 声明 / 箭头函数，采样前 10 个文件）
  - 生成 `designToCodeHints` 和 `codeToDesignHints`
- **Differ**（`src/core/differ.ts`）：三方版本比较引擎
  - 七种同步状态：`synced` / `design-ahead` / `code-ahead` / `both-changed` / `never-synced` / `new-design` / `new-code`
  - 文件级 hash 快速过滤 + 组件级 hash 精确比较（避免 Claude Design 全量覆盖误报）
- **`codeferry status`** 命令：同步状态总览，支持 `--filter` 按状态过滤
- **`codeferry diff --no-ai`**：纯结构 diff（不调用 AI），组件内容预览

### 单元测试
- `mapper.test.ts`：10 个测试，覆盖文件名匹配、导出名匹配、置信度合并、空文件
- `differ.test.ts`：13 个测试，覆盖七种状态判定、`refreshHashes` 变更检测

---

## [0.1.0] — 2026-05-30

### 新增
- **项目脚手架**：TypeScript + ESM + tsup 构建 + vitest 测试
- **`codeferry init`** 命令：交互式初始化向导
  - 技术栈检测与确认（可修正、可跳过）
  - 项目约定收集
  - 设计稿组件提取
  - 代码文件扫描
  - 初始快照生成
- **StateStore**（`src/state/store.ts`）：`.codeferry/` 目录管理，原子化 JSON 读写（tmp → rename）
- **Scanner**（`src/core/scanner.ts`）：双目录文件扫描，SHA-256 hash + mtime，支持 fast-glob 规则
- **Extractor**（`src/core/extractor.ts`）：设计稿组件边界提取
  - 花括号深度计数算法（不依赖 AST）
  - 组件分类：`page` / `shared` / `helper`
  - 组件内/跨文件依赖检测
- **Hash 工具**（`src/utils/hash.ts`）：`hashContent` / `hashFile` / `hashMultiple`
- **组件注册表**：组件级追踪（设计文件位置 + 代码映射 + 三方版本 hash）
- **Reporter**（`src/output/reporter.ts`）：终端 spinner、状态图标、状态标签
- **`codeferry snapshot`** 命令：baseline 更新，支持 `--component` 单组件模式

### 单元测试
- `extractor.test.ts`：7 个测试，覆盖组件提取、hash 一致性、依赖检测
- `scanner.test.ts`：5 个测试，覆盖文件扫描、glob 过滤、hash 变更检测
