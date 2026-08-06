#!/usr/bin/env node
// 看板「最近变更」自动生成器
// ===============================================================
// 数据源 ：仓库根目录 COMMLOG.md（全局沟通 / 变更记录）
//         每条变更以 `## [时间戳]` 开头，例如：
//         ## [2026-08-06 11:40] 📋 PD 处理 · owner 反馈：<内容> | 会话：[产品设计师(PD)]
// 产出   ：docs/showcase/kanban/changelog.js
//         写入 window.KANBAN_CHANGELOG = [{time, who, content}, ...]（取最新 3 条）
// 用途   ：看板（独立页 + 主页内第 4 个 Tab）渲染「最近变更」区块时读取该变量，
//         免去每次手工挑选 / 排版 3 条变更记录。
// 重跑   ：node scripts/gen-kanban-changelog.mjs
// 解析规则（逐条取首行）：
//   - time    : 中括号里的 `YYYY-MM-DD HH:MM`
//   - who     : `会话：[<角色>]` 中的角色（含缩写，如 产品设计师(PD)）
//   - content : 去掉首部 `## [time]` 前缀与尾部 ` | 会话：[ROLE]` 后缀后剩余的标题文本
//              （兼容标题内含全角冒号 / 无冒号 / 会话边界无空格等多种写法）
// ===============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');                 // 仓库根
const COMMLOG = resolve(root, 'COMMLOG.md');
const OUT = resolve(root, 'docs/showcase/kanban/changelog.js');
const TAKE = 3;

const text = readFileSync(COMMLOG, 'utf8');
const lines = text.split(/\r?\n/);
const headers = lines.filter(l => /^##\s+\[/.test(l)).slice(0, TAKE);

const entries = headers.map(h => {
  const time = (h.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/) || [])[1] || '';
  const whoM = h.match(/会话：\[([^\]]+)\]/);
  const who = whoM ? whoM[1] : '';
  // 去掉首部 `## [time]` 与尾部 ` | 会话：[ROLE]`，其余即变更标题
  const content = h
    .replace(/^##\s+\[[^\]]+\]\s*/, '')
    .replace(/\s*\|\s*会话：\[[^\]]*\]\s*$/, '')
    .replace(/`/g, '')                                                          // 去 markdown 反引号
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\s]+/u, '') // 去首部 emoji/箭头/变体选择器
    .trim();
  return { time, who, content };
}).filter(e => e.time && e.content);

const banner = `// 自动生成，勿手改。来源：COMMLOG.md（最新 ${TAKE} 条）。重新生成：node scripts/gen-kanban-changelog.mjs\n`;
writeFileSync(OUT, banner + 'window.KANBAN_CHANGELOG = ' + JSON.stringify(entries, null, 2) + ';\n', 'utf8');

console.log(`✓ 已生成 ${entries.length} 条变更日志 -> ${OUT}`);
entries.forEach((e, i) => console.log(`  ${i + 1}. [${e.time}] ${e.who} · ${e.content.slice(0, 44)}`));
