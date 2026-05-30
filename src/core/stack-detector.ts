import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import { resolvePath } from '../utils/path.js';
import type { StackInfo, DetectedItem, Confidence } from '../types/index.js';

function item(value: string, confidence: Confidence, evidence: string): DetectedItem {
  return { value, confidence, evidence };
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectStack(codeRoot: string): Promise<StackInfo> {
  const root = resolvePath(codeRoot);
  const info: StackInfo = {
    designToCodeHints: [],
    codeToDesignHints: [],
  };

  // read package.json
  const pkg = await readJson(join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies as Record<string, string> ?? {}), ...(pkg?.devDependencies as Record<string, string> ?? {}) };

  // ── Framework detection ──
  if (deps['next']) {
    info.framework = item(`Next.js ${deps['next'].replace(/^\^|~/, '')}`, 'high', 'package.json dependencies');
  } else if (deps['nuxt']) {
    info.framework = item(`Nuxt ${deps['nuxt'].replace(/^\^|~/, '')}`, 'high', 'package.json dependencies');
  } else if (deps['svelte'] || deps['@sveltejs/kit']) {
    info.framework = item('SvelteKit', 'high', 'package.json dependencies');
  } else if (deps['react']) {
    if (deps['vite']) {
      info.framework = item('Vite + React', 'high', 'package.json dependencies');
    } else {
      info.framework = item('React', 'medium', 'package.json dependencies (无明确框架)');
    }
  } else if (deps['vue']) {
    info.framework = item('Vue', 'high', 'package.json dependencies');
  } else if (deps['angular'] || deps['@angular/core']) {
    info.framework = item('Angular', 'high', 'package.json dependencies');
  }

  // ── Language detection ──
  if (await fileExists(join(root, 'tsconfig.json'))) {
    info.language = item('TypeScript', 'high', 'tsconfig.json 存在');
  } else if (await fileExists(join(root, 'jsconfig.json'))) {
    info.language = item('JavaScript', 'high', 'jsconfig.json 存在');
  } else {
    const tsFiles = await fg('**/*.{ts,tsx}', { cwd: root, ignore: ['**/node_modules/**'], onlyFiles: true });
    if (tsFiles.length > 0) {
      info.language = item('TypeScript', 'medium', `发现 ${tsFiles.length} 个 .ts/.tsx 文件`);
    } else {
      info.language = item('JavaScript', 'low', '默认推断');
    }
  }

  // ── Styling detection ──
  const tailwindConfigs = await fg('tailwind.config.{js,ts,mjs,cjs}', { cwd: root });
  if (tailwindConfigs.length > 0) {
    info.styling = item('Tailwind CSS', 'high', tailwindConfigs[0]);
  } else if (deps['styled-components']) {
    info.styling = item('styled-components', 'high', 'package.json dependencies');
  } else if (deps['@emotion/react'] || deps['@emotion/styled']) {
    info.styling = item('Emotion', 'high', 'package.json dependencies');
  } else {
    const cssModules = await fg('**/*.module.{css,scss,less}', { cwd: root, ignore: ['**/node_modules/**'] });
    if (cssModules.length > 0) {
      info.styling = item('CSS Modules', 'medium', `发现 ${cssModules.length} 个 .module.css 文件`);
    } else if (deps['sass'] || deps['node-sass']) {
      info.styling = item('SCSS/Sass', 'medium', 'package.json dependencies');
    }
  }

  // ── State management detection ──
  if (deps['zustand']) {
    info.stateManagement = item('Zustand', 'high', 'package.json dependencies');
  } else if (deps['@reduxjs/toolkit'] || deps['redux']) {
    info.stateManagement = item('Redux', 'high', 'package.json dependencies');
  } else if (deps['jotai']) {
    info.stateManagement = item('Jotai', 'high', 'package.json dependencies');
  } else if (deps['pinia']) {
    info.stateManagement = item('Pinia', 'high', 'package.json dependencies');
  } else if (deps['@tanstack/react-query']) {
    info.stateManagement = item('TanStack Query', 'medium', 'package.json dependencies (服务端状态)');
  } else if (deps['mobx']) {
    info.stateManagement = item('MobX', 'high', 'package.json dependencies');
  }

  // ── Routing detection ──
  if (info.framework?.value.startsWith('Next.js')) {
    if (await fileExists(join(root, 'src/app')) || await fileExists(join(root, 'app'))) {
      info.routing = item('App Router', 'medium', '目录结构推断');
    } else if (await fileExists(join(root, 'src/pages')) || await fileExists(join(root, 'pages'))) {
      info.routing = item('Pages Router', 'medium', '目录结构推断');
    }
  } else if (deps['react-router'] || deps['react-router-dom']) {
    info.routing = item('React Router', 'high', 'package.json dependencies');
  } else if (deps['vue-router']) {
    info.routing = item('Vue Router', 'high', 'package.json dependencies');
  }

  // ── Component pattern detection ──
  // sample a few code files to detect function vs arrow vs class
  const sampleFiles = await fg('**/*.{tsx,jsx,vue,svelte}', {
    cwd: root,
    ignore: ['**/node_modules/**', '**/dist/**'],
    onlyFiles: true,
  });
  if (sampleFiles.length > 0) {
    let fnCount = 0;
    let arrowCount = 0;
    const sampled = sampleFiles.slice(0, 10);
    for (const f of sampled) {
      try {
        const content = await readFile(join(root, f), 'utf8');
        fnCount += (content.match(/export\s+(default\s+)?function\s+/g) ?? []).length;
        arrowCount += (content.match(/export\s+(const|default)\s+\w+\s*=\s*\(/g) ?? []).length;
      } catch { /* skip */ }
    }
    if (fnCount + arrowCount > 0) {
      if (fnCount > arrowCount) {
        info.componentPattern = item('function 声明', 'medium', `采样 ${sampled.length} 文件`);
      } else {
        info.componentPattern = item('箭头函数', 'medium', `采样 ${sampled.length} 文件`);
      }
    }
  }

  // ── Generate hints ──
  info.designToCodeHints = generateDesignToCodeHints(info);
  info.codeToDesignHints = generateCodeToDesignHints(info);

  return info;
}

export function generateDesignToCodeHints(info: StackInfo): string[] {
  const hints: string[] = [];

  if (info.styling?.value === 'Tailwind CSS') {
    hints.push('将内联样式转换为 Tailwind 类名');
  } else if (info.styling?.value === 'CSS Modules') {
    hints.push('将内联样式提取到对应的 .module.css 文件中');
  } else if (info.styling?.value === 'styled-components' || info.styling?.value === 'Emotion') {
    hints.push('将内联样式转换为 CSS-in-JS 样式对象');
  } else if (info.styling?.value.includes('SCSS')) {
    hints.push('将内联样式提取到对应的 .scss 文件中');
  }

  if (info.language?.value === 'TypeScript') {
    hints.push('添加 TypeScript 类型注解');
  }

  if (info.framework?.value.startsWith('Next.js')) {
    hints.push('将 React.useState 改为 import { useState } from \'react\'');
  } else if (info.framework?.value.includes('Vue')) {
    hints.push('将 JSX 组件转换为 Vue SFC (.vue) 模板语法');
    hints.push('将 React hooks 逻辑转换为 Vue Composition API');
  } else if (info.framework?.value.includes('Svelte')) {
    hints.push('将 JSX 组件转换为 Svelte (.svelte) 组件语法');
    hints.push('将 React hooks 逻辑转换为 Svelte 响应式声明');
  }

  hints.push('保留代码侧现有的工程结构和命名规范');

  return hints;
}

export function generateCodeToDesignHints(info: StackInfo): string[] {
  const hints: string[] = [
    '设计稿使用浏览器原生 JSX（Babel standalone 编译），无需 import/export',
    '所有组件使用全局 function 声明',
    '使用 React.useState / React.useEffect 等全局引用',
  ];

  if (info.styling?.value === 'Tailwind CSS') {
    hints.push('将 Tailwind 类名转换回内联样式 + CSS 变量');
  } else if (info.styling?.value === 'CSS Modules') {
    hints.push('将 CSS Modules 样式转换为内联样式');
  }

  if (info.language?.value === 'TypeScript') {
    hints.push('移除 TypeScript 类型注解');
  }

  if (info.framework?.value.includes('Vue')) {
    hints.push('将 Vue SFC 模板转换回 JSX 组件');
  } else if (info.framework?.value.includes('Svelte')) {
    hints.push('将 Svelte 组件转换回 JSX 组件');
  }

  hints.push('用静态 mock 数据替代后端 API 调用');

  return hints;
}

export function formatStackForPrompt(info: StackInfo): string {
  const parts: string[] = [];

  if (info.framework) parts.push(`框架: ${info.framework.value}`);
  if (info.language) parts.push(`语言: ${info.language.value}`);
  if (info.styling) parts.push(`样式: ${info.styling.value}`);
  if (info.stateManagement) parts.push(`状态管理: ${info.stateManagement.value}`);
  if (info.routing) parts.push(`路由: ${info.routing.value}`);
  if (info.componentPattern) parts.push(`组件模式: ${info.componentPattern.value}`);

  return parts.join(' · ');
}
