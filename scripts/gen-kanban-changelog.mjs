#!/usr/bin/env node
// 看板「任务详情」数据生成器（按任务归集的最近变更 + 背景汇总）
// ===============================================================
// 数据源 ：
//   1) COMMLOG.md（全局沟通 / 变更记录）— 每条以 `## [时间戳]` 开头，
//      含标题行 + 多行正文（提交记录 / 根因 / 修复 / AC 等）。
//   2) docs/showcase/kanban/data.js（window.KANBAN_DATA，提供任务 id 列表）
// 产出   ：docs/showcase/kanban/tasklog.js
//         window.KANBAN_TASKLOG = {
//           "<任务id>": {
//             background: "该任务的背景/来由（汇总自 COMMLOG Note）",
//             log: [ {time, who, content}, ... ]   // 最新 3 条，新→旧
//           }, ...
//         }
// 关联规则：仅按「任务 id 精确匹配」——在 COMMLOG 某条（标题+正文）中
//          出现该 id（前后非 [A-Za-z0-9-]）即视为相关。命中不足 3 条则取实际条数；
//          未命中则不写入该任务（详情页回退到 note 并显示「暂无变更」）。
// 背景汇总：取该任务全部命中条数 + 最早一条（起源）+ 最近一条时间，拼为一句背景。
// 重跑   ：node scripts/gen-kanban-changelog.mjs
// ===============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');                 // 仓库根
const COMMLOG = resolve(root, 'COMMLOG.md');
const DATAJS  = resolve(root, 'docs/showcase/kanban/data.js');
const OUT = resolve(root, 'docs/showcase/kanban/tasklog.js');
const TAKE = 3;

// ---- 1. 读取任务 id 列表（来自 data.js） ----
const dataSrc = readFileSync(DATAJS, 'utf8');
const win = {};
new Function('window', dataSrc)(win);
const TASK_IDS = (win.KANBAN_DATA || []).map(d => d.id).filter(Boolean);

// ---- 2. 解析 COMMLOG：按 `## [` 切分为条目，保留标题+正文 ----
const text = readFileSync(COMMLOG, 'utf8');
const lines = text.split(/\r?\n/);
const blocks = [];
let cur = null;
for (const line of lines) {
  if (/^##\s+\[/.test(line)) {
    if (cur) blocks.push(cur);
    cur = { header: line.replace(/^##\s+/, ''), body: '' };
  } else if (cur) {
    cur.body += line + '\n';
  }
}
if (cur) blocks.push(cur);

// 已知角色词表（按优先级，用于「会话：[ROLE]」缺失时从标题回退猜测）
const ROLES = ['项目总控(PJM)', '小程序前端开发(FE)', '全栈开发(FS)', '产品设计师(PD)',
  '产品经理(PM)', '产品经理', '产品设计师', '全栈开发', '小程序前端开发', '项目总控', 'owner'];
function guessWho(content) {
  for (const r of ROLES) if (content.includes(r)) return r;
  return '';
}

function parseHeader(h) {
  // 时间戳允许「仅日期」或「日期 时间」两种写法（早期条目常只写日期）
  const tm = h.match(/\[(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\]/);
  const time = tm ? tm[1] + (tm[2] ? ' ' + tm[2] : '') : '';
  const whoM = h.match(/会话：\[([^\]]+)\]/);
  let who = whoM ? whoM[1] : '';
  const content = h
    .replace(/^\[[^\]]+\]\s*/, '')                       // 去首部 [time]
    .replace(/\s*\|\s*会话：.*$/, '')                     // 去尾部 | 会话：…（兼容 [ROLE] 与 （ROLE） 两种写法）
    .replace(/`/g, '')                                   // 去 markdown 反引号
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\s]+/u, '') // 去首部 emoji/箭头
    .trim();
  if (!who) who = guessWho(content);                 // 会话角色缺失时回退猜测
  return { time, who, content };
}

// 全部条目（新→旧，与文件顺序一致）；full = 标题+正文，用于 id 匹配
const ALL = blocks.map(b => {
  const p = parseHeader(b.header);
  return { ...p, full: b.header + '\n' + b.body };
}).filter(e => e.time && e.content);

// ---- 3. 逐任务匹配 + 汇总 ----
function idRe(id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 注意：不加 g 标志——RegExp.test 带 g 时有状态（lastIndex 前移），
  // 在数组 filter 中跨条目调用会漏匹配。
  return new RegExp('(?<![A-Za-z0-9-])' + esc + '(?![A-Za-z0-9-])');
}

function makeBackground(matched) {
  const n = matched.length;
  if (n === 0) return '';
  const oldest = matched[n - 1];                        // 最早一条 = 起源
  const newest = matched[0];                            // 最近一条
  const origin = oldest.content.length > 60 ? oldest.content.slice(0, 60) + '…' : oldest.content;
  let bg = `COMMLOG 中累计 ${n} 条相关记录。起源（${oldest.time}·${oldest.who}）：${origin}`;
  if (n > 1) bg += `；最近一次 ${newest.time}（${newest.who}）。`;
  return bg;
}

const TASKLOG = {};
for (const id of TASK_IDS) {
  const re = idRe(id);
  const matched = ALL.filter(e => re.test(e.full)).slice(0, TAKE);
  if (matched.length === 0) continue;
  TASKLOG[id] = {
    background: makeBackground(matched),
    log: matched.map(({ time, who, content }) => ({ time, who, content }))
  };
}

// ---- 4. 写出 ----
const banner =
  `// 自动生成，勿手改。来源：COMMLOG.md（按任务 id 精确匹配，每任务取最新 ${TAKE} 条 + 背景汇总自 Note）。\n` +
  `// 重新生成：node scripts/gen-kanban-changelog.mjs\n`;
writeFileSync(OUT, banner + 'window.KANBAN_TASKLOG = ' + JSON.stringify(TASKLOG, null, 2) + ';\n', 'utf8');

console.log(`✓ 已生成 ${Object.keys(TASKLOG).length}/${TASK_IDS.length} 个任务的详情数据 -> ${OUT}`);
for (const id of TASK_IDS) {
  const t = TASKLOG[id];
  console.log(`  ${id.padEnd(10)} ${t ? t.log.length + ' 条变更' : '— 未命中'}`);
}
