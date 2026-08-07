// 生成 docs/tasks/<id>.md（GitHub 源，GitHub 渲染漂亮）+ docs/tasks/<id>.html（自包含渲染页，GitHub Pages 直接打开）
// 数据源：tasks.json（任务元数据）+ tasklog.js（window.KANBAN_TASKLOG 背景与最近3条变更）
// 用法：node scripts/gen-task-docs.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO = 'tengfeizhao1219/One-News';
const BOARD_URL = `https://tengfeizhao1219.github.io/One-News/showcase/kanban/`;
const tasksJson = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/showcase/kanban/tasks.json', import.meta.url)), 'utf8'));

// 载入 tasklog.js 的 window.KANBAN_TASKLOG
const tasklogSrc = readFileSync(fileURLToPath(new URL('../docs/showcase/kanban/tasklog.js', import.meta.url)), 'utf8');
const w = {};
const fn = new Function('window', tasklogSrc + '\nreturn window.KANBAN_TASKLOG;');
const TASKLOG = fn(w) || {};

const SYM = { done: '✅', doing: '🔄', wait: '⏳', block: '🚫', cancel: '❌' };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').trim();
const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const outDir = fileURLToPath(new URL('../docs/tasks/', import.meta.url));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let n = 0;
for (const t of tasksJson.tasks) {
  const tl = TASKLOG[t.id] || null;
  const bg = (tl && tl.background) ? tl.background : (t.note || '暂无背景说明（COMMLOG 中未检索到该任务 ID）。');
  const log = tl ? tl.log : [];
  const statusLine = `${SYM[t.status] || ''} ${t.status}`;

  const rows = [
    ['任务 ID', t.id], ['标题', t.title], ['负责', t.role], ['优先级', t.prio],
    ['状态', statusLine], ['关联链', t.link], ['更新', t.updated], ['备注', t.note || '—'],
  ].map(([k, v]) => `| ${k} | ${esc(v)} |`).join('\n');

  const logMd = log.length
    ? log.map(e => `- **${esc(e.time)}** · ${esc(e.who || '—')}：${esc(e.content)}`).join('\n')
    : `> 暂无变更记录（COMMLOG 中未检索到任务 ID ${t.id}）。`;

  // ===== Markdown（GitHub 源）=====
  const md = `# ${t.id} · ${t.title}

> ${statusLine} · 负责：**${esc(t.role)}** · 优先级：**${esc(t.prio)}** · 关联链：${esc(t.link)} · 更新：${esc(t.updated)}

| 字段 | 值 |
|---|---|
${rows}

## 📖 任务背景
${esc(bg)}

## 🕘 最近变更（COMMLOG 最新 3 条）
${logMd}

---
- 📊 [返回看板](${BOARD_URL})
- 📄 [在 GitHub 查看本任务源码](https://github.com/${REPO}/blob/main/docs/showcase/kanban/tasks.json)
`;
  writeFileSync(fileURLToPath(new URL(`./${t.id}.md`, 'file://' + outDir)), md);

  // ===== HTML（自包含渲染页，GitHub Pages 直接打开）=====
  const rowHtml = [
    ['任务 ID', t.id], ['标题', t.title], ['负责', t.role], ['优先级', t.prio],
    ['状态', statusLine], ['关联链', t.link], ['更新', t.updated], ['备注', t.note || '—'],
  ].map(([k, v]) => `<tr><td><b>${escHtml(k)}</b></td><td>${escHtml(v)}</td></tr>`).join('');
  const logHtml = log.length
    ? '<ul>' + log.map(e => `<li><b>${escHtml(e.time)}</b> · ${escHtml(e.who || '—')}：${escHtml(e.content)}</li>`).join('') + '</ul>'
    : `<p><i>暂无变更记录（COMMLOG 中未检索到任务 ID ${escHtml(t.id)}）。</i></p>`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(t.id)} · ${escHtml(t.title)}</title>
<style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,Roboto,sans-serif;max-width:780px;margin:34px auto;padding:0 18px;color:#1c1b19;line-height:1.62;background:#fafaf8}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#6b6862;font-size:13px;margin-bottom:18px}
  table{border-collapse:collapse;width:100%;margin:8px 0 18px;font-size:14px}
  td,th{border:1px solid #e7e2d8;padding:7px 11px;vertical-align:top} td:first-child{width:92px;background:#f3f1ec;color:#6b6862}
  h2{font-size:16px;margin:22px 0 8px;border-left:3px solid #007aff;padding-left:9px}
  .bg{background:#fff;border:1px solid #e7e2d8;border-radius:10px;padding:12px 14px;font-size:14px}
  ul{background:#fff;border:1px solid #e7e2d8;border-radius:10px;padding:12px 26px;font-size:13.5px}
  li{margin:6px 0}.foot{margin-top:26px;color:#6b6862;font-size:13px}
  a{color:#007aff;text-decoration:none}.foot a:hover{text-decoration:underline}
</style></head>
<body>
<h1>${escHtml(t.id)} · ${escHtml(t.title)}</h1>
<p class="sub">${escHtml(statusLine)} · 负责：${escHtml(t.role)} · 优先级：${escHtml(t.prio)} · 关联链：${escHtml(t.link)} · 更新：${escHtml(t.updated)}</p>
<table>${rowHtml}</table>
<h2>📖 任务背景</h2><div class="bg">${escHtml(bg)}</div>
<h2>🕘 最近变更（COMMLOG 最新 3 条）</h2>${logHtml}
<p class="foot">· <a href="${BOARD_URL}">返回看板</a> · <a href="https://github.com/${REPO}/blob/main/docs/showcase/kanban/tasks.json">在 GitHub 查看本任务源码</a></p>
</body></html>
`;
  writeFileSync(fileURLToPath(new URL(`./${t.id}.html`, 'file://' + outDir)), html);
  n++;
}
console.log(`generated ${n} task docs (md + html) -> docs/tasks/`);
