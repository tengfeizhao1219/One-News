#!/usr/bin/env node
/**
 * tools/logo-design/append-commlog-logo.mjs
 * 在 Notion COMMLOG 页面(3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc)追加
 * "Logo v1.0 资产入库" 记录（owner 拍板 v34.2 终稿）
 *
 * 用法:
 *   node tools/logo-design/append-commlog-logo.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')

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

const blocks = [
  { object: 'block', type: 'divider', divider: {} },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '8/9 17:45 — PD 窗口 Logo v1.0 资产入库（owner 拍板 v34.2 终稿）' } }],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: '角色:PD · sid:20260809-75Y756213AT0' } }],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: '任务:19→34 轮迭代终稿落地为 8 个 SVG 资产 + README 设计规范,入库+推送+COMMLOG' } }],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '终稿版式（owner 拍板，勿改）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '主标 wordmark：One 大字居中 → 蓝线 + ONE·NEWS 同行（蓝线左文字右）→ 副副标「每天 · 一页 · 极致阅读体验」居中' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '头像 avatar：One 居中上方 → 蓝线 + NEWS 紧贴蓝线右端（左右结构非上下叠）；32×32 仅保留 O' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '启动屏横排：左主标左对齐 24px + 右 slogan 右对齐 24px（两侧严格等边距）；slogan「一页，让阅读轻松一点」+ 副标 Pure reading, One News' } }],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '产物（已入仓，commit 73b5f69）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'assets/logo/logo-wordmark-light/dark.svg（640×200 主标浅/深）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'assets/logo/logo-avatar-120-light/dark.svg（微信头像 120×120 浅/深）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'assets/logo/logo-avatar-circle-light/dark.svg（圆形社交头像浅/深，整块垂直居中）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'assets/logo/logo-splash-light/dark.svg（启动屏横排 640×120 浅/深）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'assets/logo/README.md — 文件清单/版式规范/使用规则（SVG 源文件+关键场景 PNG 导出）/自动应用指引' } }],
    },
  },
  {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: '下游动作（待确认后派发）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '页面使用点梳理 → 确认后出设计文档给 FS/FE 实现（见 TASK_BOARD）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '新增页面自动应用 → 建议 components/logo/ 组件（wordmark/avatar/splash 三形态 + 自动深浅切换）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '微信小程序头像（管理后台）：需 144×144 PNG，用 avatar-120-dark 导出 2x' } }],
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
      rich_text: [{ type: 'text', text: { content: 'SVG 文字依赖设备字体，关键场景（微信头像/分享卡片）必须导出 PNG/JPG；小程序 image 组件可直引本地 SVG（基础库 2.3.0+）' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: '深浅色跟随项目 theme.json darkmode，引用约定 {{isDark ? \'-dark\' : \'\'}} 与 assets/icons 一致' } }],
    },
  },
  {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: 'slogan 文案 owner 拍板锁定，改动需重新确认' } }],
    },
  },
]

console.log(`\n准备好 ${blocks.length} 个 blocks,开始 PATCH...`)

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
