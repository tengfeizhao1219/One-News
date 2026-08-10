#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fscf2.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-CF2「首页边界刷新假提示修复」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fscf2.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'

if (!existsSync(SECRETS)) {
  console.error(`❌ 缺密钥: ${SECRETS}`)
  process.exit(1)
}
const secretsText = readFileSync(SECRETS, 'utf-8')
const TOKEN = secretsText.match(/ntn_[A-Za-z0-9]+/)?.[0] || ''
if (!TOKEN) {
  console.error('❌ SECRETS.md 里没找到 ntn_ 开头的 token')
  process.exit(1)
}

const children = [
  { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '[FS-CF2] 17:40 首页边界刷新假提示修复（owner 反馈 bug，commit 7cf89f5）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '问题：首页第一张下滑提示"已更新8条"、最后一页上滑提示"已加载N条"，但实际只是重读数据库，未真抓新新闻，属欺骗读者 bug' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '修复1（顶部下滑）：refreshCurrentCategory 改为先真调 refreshNews 云函数传 {category:"recommend"}（工人模式同步返回真实 inserted）固定刷推荐分类，再重拉当前浏览分类第1页整页替换；提示基于真实 inserted：>0→"已更新X条"、0→"暂无新增"、失败→"刷新未完成请重试"，绝不虚报' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '修复2（底部上滑）：loadMoreNews 翻底提示由"已加载N条"改为"已加载更多"（翻页仅读库既有分页内容，非抓新，不得虚报条数）；无数据仍"已经到底啦"' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '说明：刷新=整页替换第1页（不加量），新抓内容挤占列表头部；翻页=增量追加历史。两语义互不混淆。仅改前端 home.js 两方法，无需改后端' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '下游动作：owner 重新部署前端小程序即生效。注意：固定刷 recommend，若 recommend 外部搜索源(智谱)超时可能返回"刷新未完成"（诚实提示，不会假报）' } }] } },
]

const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ children }),
})
const text = await res.text()
if (res.ok) {
  const j = JSON.parse(text)
  console.log(`COMMLOG 追加成功：${j.results.length} blocks`)
} else {
  console.log(`COMMLOG 追加失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
}
