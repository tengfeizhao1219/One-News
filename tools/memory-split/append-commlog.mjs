#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog.mjs
 *
 * 在 Notion COMMLOG 页面(3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc)追加一段
 * "8/8 memory 拆分完成" 记录
 *
 * 用法:
 *   node tools/memory-split/append-commlog.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')

// 1. 读 token
if (!existsSync(SECRETS)) {
  console.error(`❌ 缺密钥: ${SECRETS}`)
  process.exit(1)
}
const secretsText = readFileSync(SECRETS, 'utf-8')
const tokenMatch = secretsText.match(/ntn_[A-Za-z0-9]+/)
if (!tokenMatch) {
  console.error(`❌ 没找到 Notion token`)
  process.exit(1)
}
const TOKEN = tokenMatch[0]
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'  // COMMLOG 页面

console.log(`Token: ${TOKEN.slice(0, 10)}***`)
console.log(`Page: ${PAGE_ID}`)

// 2. 构造 blocks
const blocks = [
  {
    object: 'block',
    type: 'divider',
    divider: {},
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '8/9 09:20 — FS 窗口 8/8 memory 拆分完成' } }],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: '角色:FS · sid:20260809-JZDP1NQJ0TA6' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: '任务:把 8/8 48KB 单日流水账(46 段 PM/FS/FE/PD 角色切换)按主题分桶拆到 by-window/,主体压到 8K 跨窗口大事' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '产物(本机,本工作区元数据不入仓)' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'by-window/2026-08-08-OLD-PM-PM.md (12K, 13 段) — PM 决策 + 项目盘点 + v1.1.0 发布' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'by-window/2026-08-08-OLD-FS-FS.md (11K, 7 段) — FS 调研 + Owner 简报实施 + 读全流转机制' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'by-window/2026-08-08-OLD-FE-FE.md (5K, 4 段) — FE 权责 + 状态 + 待办' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'by-window/2026-08-08-OLD-PD-PD.md (9K, 11 段) — PD 调研 + Logo 迭代 v1-v15 全史' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: '2026-08-08.md 主体:48K → 8K,留 9 段跨窗口大事' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: '2026-08-08.md.bak 备份留底(脚本 idempotent,只首次生成)' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '脚本(可复用基础设施,入仓)' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'tools/memory-split/split-2026-08-08.mjs (commit 7fc0120)' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'tools/memory-split/README.md (commit 6049f16)' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: '两个 commit 已 SSH push origin main,remote HEAD 同步 ✅' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '注意' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: '.workbuddy/ 被 .gitignore 忽略,by-window/4 份 + MEMORY.md 更新 + 8/8.md 缩都是工作区元数据,不入仓 — 各窗口本机重跑' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'MEMORY.md §七 已更新:8/8 拆分索引段 + 4 份 by-window 路径 + 4 个 sid 当前状态' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: '其余 4 窗口(PM/PD/FE/FS-old)需各自跑一次脚本才有本机 by-window;或读本条 COMMLOG 找 split 脚本重跑' } },
      ],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: 'P2 主线收口,FS 窗口可关闭。下家拍板 3 选 1 路径(优化 A / 内容完善 B-1/B-2/B-3 / 暂缓 C)由 PM 窗口推进' } },
      ],
    },
  },
]

console.log(`\n准备好 ${blocks.length} 个 blocks,开始 PATCH...`)

// 3. 推 Notion
const resp = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ children: blocks }),
})

const result = await resp.json()
console.log(`\nHTTP ${resp.status}`)
if (resp.ok) {
  console.log(`✅ Notion COMMLOG 追加 ${blocks.length} blocks 成功`)
  console.log(`   首块 id: ${result.results?.[0]?.id}`)
} else {
  console.error(`❌ Notion append 失败`)
  console.error(JSON.stringify(result, null, 2))
  process.exit(1)
}
