#!/usr/bin/env node
/**
 * query-taskboard.mjs — 查询 Notion TASK_BOARD 并结构化输出
 *
 * 数据源：Notion database（线上，唯一权威最新源）
 * 用法：
 *   NOTION_TOKEN=xxx node query-taskboard.mjs                    # 全量表格
 *   NOTION_TOKEN=xxx node query-taskboard.mjs --json             # JSON 输出
 *   NOTION_TOKEN=xxx node query-taskboard.mjs --role=前端         # 只看某负责人
 *   NOTION_TOKEN=xxx node query-taskboard.mjs --role=前端 --json
 *   NOTION_TOKEN=xxx node query-taskboard.mjs --board=<db_id>    # 指定 database
 *
 * 环境变量：
 *   NOTION_TOKEN   必填，从 keys/SECRETS.md 读取（推荐 Token B）
 *   TASK_BOARD_ID  可先用环境变量指定；否则用 --board 参数；再无则抛错
 *
 * 注意：这是"线上拉任务"的唯一入口。不要用本地 TASK_BOARD.md / 本地任务板当真相，
 *      线上 database 才是最新。详见 SKILL.md。
 */

const BOARD_ID = process.env.TASK_BOARD_ID || '';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';

function usageAndExit(msg) {
  console.error(msg);
  process.exit(1);
}

// ─── 命令行解析 ────────────────────────
let argJson = false;
let argRole = '';
let argBoard = '';
const args = process.argv.slice(2);
for (const a of args) {
  if (a === '--json') argJson = true;
  else if (a.startsWith('--role=')) argRole = a.slice(7);
  else if (a.startsWith('--board=')) argBoard = a.slice(8);
}

const dbId = argBoard || BOARD_ID;
if (NOTION_TOKEN === '') {
  usageAndExit('错误：未设置 NOTION_TOKEN。请先 export NOTION_TOKEN="$(grep -oP \'ntn_[A-Za-z0-9]+\' .workbuddy/keys/SECRETS.md | head -1)"');
}
if (dbId === '') {
  usageAndExit('错误：未指定 TASK_BOARD。请设环境变量 TASK_BOARD_ID 或传 --board=<db_id>');
}

async function queryDatabase(databaseId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      'sort': { 'timestamp': 'last_edited_time', 'direction': 'descending' },
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!res.ok) {
    const body = await res.text();
    usageAndExit(`查询失败 HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

function propText(p) {
  if (!p) return '';
  if (p.type === 'title' && p.title && p.title[0]) return p.title[0].text?.content || '';
  if (p.type === 'rich_text' && p.rich_text && p.rich_text[0]) return p.rich_text[0].plain_text || '';
  if (p.type === 'select' && p.select) return p.select.name || '';
  if (p.type === 'status' && p.status) return p.status.name || '';
  if (p.type === 'date' && p.date) return p.date.start || '';
  return '';
}

function getProp(page, name) {
  const p = page.properties?.[name];
  return propText(p);
}

function rowToObj(page) {
  return {
    id: page.id,
    title: getProp(page, '任务名') || getProp(page, 'Name') || '(无标题)',
    status: getProp(page, '状态') || '-',
    owner: getProp(page, '负责人') || '-',
    priority: getProp(page, '优先级') || '-',
    chain: getProp(page, '关联链') || '-',
    updated: getProp(page, '上次更新') || '-',
  };
}

const statusRank = { '✅ 已完成': 4, '✅': 4, '🔄 进行中': 3, '🔄': 3, '📋 待认领': 2, '📋': 2, '⏳': 1, '🚫': 0 };

function statusSortKey(s) {
  const norm = s.includes('完成') ? 4 : s.includes('进行') || s === '🔄' ? 3 : s === '📋' ? 2 : s === '⏳' ? 1 : 0;
  return norm;
}

const out = await queryDatabase(dbId);
const rows = (out.results || []).map(rowToObj);

// 角色别名：支持代号(FE)与中文（前端/FE）
const ROLE_ALIAS = {
  'fe': ['fe', '前端', 'fe前端'],
  'fs': ['fs', '全栈', '后端'],
  'pd': ['pd', '产品', '设计', '设计师', '产品设计'],
  'pm': ['pm', '产品经理', '质量'],
  'qa': ['qa', '测试', '验收'],
};
function roleMatch(owner, role) {
  const o = (owner || '').toLowerCase();
  const r = (role || '').toLowerCase();
  if (!r) return true;
  if (o.includes(r)) return true;
  // 用户输入若是某角色的别名之一，则看 owner 是否与该角色代号一致
  for (const [key, aliases] of Object.entries(ROLE_ALIAS)) {
    if (key === r || aliases.includes(r)) {
      return o === key || aliases.includes(o) || o.includes(key);
    }
  }
  return false;
}
// 过滤角色
const filtered = argRole ? rows.filter(r => roleMatch(r.owner, argRole)) : rows;

// 排序：进行中 > 待认领 > 其他，再按更新时间
function sortKey(r) { return (statusSortKey(r.status) * 1000000) + Date.parse(r.updated || 0) || 0; }
filtered.sort((a, b) => sortKey(b) - sortKey(a));

if (argJson) {
  // 附带统计
  const stats = {
    total: filtered.length,
    in_progress: filtered.filter(r => r.status.includes('进行') || r.status === '🔄').length,
    pending: filtered.filter(r => r.status === '📋').length,
  };
  console.log(JSON.stringify({ stats, tasks: filtered }, null, 2));
} else {
  console.log(`===== TASK_BOARD @ ${new Date().toLocaleString('zh-CN')} =====`);
  if (argRole) console.log(`负责人过滤：${argRole}`);
  console.log(`总任务 ${filtered.length} 项`);
  console.log('');
  filtered.forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    状态=${r.status} | 负责人=${r.owner} | 优先级=${r.priority} | 关联=${r.chain} | 更新=${r.updated}`);
    // page id 单独一行，方便后续 PATCH / 取正文
    console.log(`    page=${r.id}`);
  });
}
