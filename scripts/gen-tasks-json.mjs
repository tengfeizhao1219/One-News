// 生成 docs/showcase/kanban/tasks.json（看板的可变、可 API 改写权威任务源）
// 从兜底快照 data.js 的 KANBAN_META / KANBAN_DATA 转换，并为每任务补 doc 字段。
// 用法：node scripts/gen-tasks-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataJsPath = fileURLToPath(new URL('../docs/showcase/kanban/data.js', import.meta.url));
const outPath = fileURLToPath(new URL('../docs/showcase/kanban/tasks.json', import.meta.url));
const REPO = 'tengfeizhao1219/One-News';

const src = readFileSync(dataJsPath, 'utf8');
// data.js 形如 `window.KANBAN_META = {...}; window.KANBAN_DATA = [...];`
const sandbox = {};
const fn = new Function('window', src + '\nreturn { meta: window.KANBAN_META, data: window.KANBAN_DATA };');
const { meta, data } = fn(sandbox);

const tasks = data.map(t => ({
  id: t.id,
  title: t.title,
  col: t.col,
  role: t.role,
  prio: t.prio,
  status: t.status,
  link: t.link,
  note: t.note,
  updated: t.updated,
  doc: `https://github.com/${REPO}/blob/main/docs/tasks/${t.id}.md`,
}));

const out = { meta, tasks };
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${tasks.length} tasks -> ${outPath}`);
