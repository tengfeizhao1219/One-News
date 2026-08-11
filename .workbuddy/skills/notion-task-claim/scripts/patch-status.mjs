#!/usr/bin/env node
/**
 * patch-status.mjs — PATCH 更新 Notion 任务（页面属性）
 *
 * 已验证：PATCH 页面属性 HTTP 200 可行（Token B）。POST 创建 database 条目才 404。
 * 用法：
 *   NOTION_TOKEN=xxx node patch-status.mjs <page_id> --status="✅ 已完成"
 *   NOTION_TOKEN=xxx node patch-status.mjs <page_id> --status="✅ 已完成" --date="2026-08-11"
 *   NOTION_TOKEN=xxx node patch-status.mjs <page_id> --owner="前端"
 *
 * 参数：
 *   <page_id>      必须。任务在 Notion database 中的 page id（query-taskboard 输出的 page= 行）
 *   --status=      更新「状态」select 字段（可空，不传则不动）
 *   --owner=       更新「负责人」select 字段（可空）
 *   --date=        更新「上次更新」date 字段（可空，默认今天）
 *   --field=NAME::value  通用自定义字段更新（可重复），如 --field="上次更新::2026-08-11"
 *
 * 环境变量：
 *   NOTION_TOKEN   必填，从 keys/SECRETS.md 读取（推荐 Token B——已验证可 PATCH 页面属性）
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';

function usageAndExit(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const pageId = args[0];
if (!pageId || !pageId.includes('-')) {
  usageAndExit('错误：缺少 page_id。用法: node patch-status.mjs <page_id> --status="✅ 已完成"');
}
if (NOTION_TOKEN === '') {
  usageAndExit('错误：未设置 NOTION_TOKEN。');
}

let status = null;
let owner = null;
let date = null;
const customFields = [];
for (const a of args.slice(1)) {
  if (a.startsWith('--status=')) status = a.slice(9);
  else if (a.startsWith('--owner=')) owner = a.slice(8);
  else if (a.startsWith('--date=')) date = a.slice(7);
  else if (a.startsWith('--field=')) customFields.push(a.slice(8).split('::'));
}

if (!status && !owner && !date && customFields.length === 0) {
  usageAndExit('错误：未指定任何要更新的字段。至少给 --status / --owner / --field 之一。');
}
if (date === null) date = new Date().toISOString().slice(0, 10); // 默认今天 YYYY-MM-DD

// 构造 properties
const properties = {};
if (status !== null) {
  properties['状态'] = { select: { name: status } };
}
if (owner !== null) {
  properties['负责人'] = { select: { name: owner } };
}
if (date !== null) {
  properties['上次更新'] = { date: { start: date } };
}
for (const [k, v] of customFields) {
  if (!k) continue;
  properties[k] = { rich_text: [{ text: { content: v } }] };
}

const todayStr = new Date().toISOString().slice(0, 10);
const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    properties,
    // 触碰「上次更新」日期，避免排序时沉底
    last_edited_time: new Date().toISOString(),
  }),
});

if (res.ok) {
  console.log(`OK  HTTP ${res.status}  已更新 page ${pageId.slice(0, 8)}…  ${JSON.stringify(properties)}`);
} else {
  const body = await res.text();
  console.error(`FAIL  HTTP ${res.status}  ${body.slice(0, 500)}`);
  process.exit(1);
}
