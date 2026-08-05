#!/usr/bin/env node
/**
 * 「一页」One News — 每晚资产库归档脚本
 *
 * 作用：
 *   1. 汇总项目全部源文件（前端页面 / 云函数 / 工具 / 配置）
 *   2. 生成结构化「项目文件清单 + 模块索引 + 简要职责说明」Markdown 档案
 *   3. 写入资产库目录（默认本地归档：docs/资产库归档/，可用环境变量切换到 TDrive 等）
 *
 * 调度：由 crontab 每晚 0 点触发
 *   0 0 * * * /root/.nvm/versions/node/v22.13.1/bin/node /workspace/One-News/scripts/migrate-to-asset-library.js >> /workspace/One-News/scripts/migrate.log 2>&1
 *
 * 环境变量：
 *   ASSET_LIBRARY_DIR   资产库写入目录（缺省：<PROJECT>/docs/资产库归档）
 *   ASSET_LIB_MODEL     整理模型名（缺省：不调 LLM；设为模型名则启用 LLM 整理）
 *   DASHSCOPE_API_KEY   百炼 Key（仅 LLM 模式需要）
 *
 * 模式：
 *   - 本地模式（默认）：纯文件清单 + 模块索引 + 职责说明，零 API 开销
 *   - LLM 模式（ASSET_LIB_MODEL 非空时）：收集文件内容 + 调用大模型生成结构化档案
 */

'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT_DIR = '/workspace/One-News'
const DEFAULT_ARCHIVE_DIR = path.join(PROJECT_DIR, 'docs', '资产库归档')
const ASSET_LIBRARY_DIR = process.env.ASSET_LIBRARY_DIR || DEFAULT_ARCHIVE_DIR
const MODEL = process.env.ASSET_LIB_MODEL || ''   // 空 = 本地模式，非空 = LLM 模式
const LANG = process.env.MIGRATE_LANG || '中文'

// ─── 收集全部项目文件（源码 + 配置 + 文档） ────────
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'miniprogram_npm', 'images', 'demo',
  path.basename(DEFAULT_ARCHIVE_DIR),
])
const INCLUDE_EXT = new Set(['.js', '.wxml', '.wxss', '.json', '.ts', '.md', '.sh'])

function walk(dir, acc) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return acc }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, acc)
    } else {
      if (INCLUDE_EXT.has(path.extname(e.name).toLowerCase())) acc.push(full)
    }
  }
  return acc
}

function getGitInfo() {
  let commit = 'N/A', branch = 'N/A', total = 0
  try { commit = require('child_process').execSync('git log -1 --format=%h', { cwd: PROJECT_DIR }).toString().trim() } catch (_) {}
  try { branch = require('child_process').execSync('git branch --show-current', { cwd: PROJECT_DIR }).toString().trim() } catch (_) {}
  try { total = parseInt(require('child_process').execSync('git rev-list --count HEAD', { cwd: PROJECT_DIR }).toString().trim(), 10) } catch (_) {}
  return { commit, branch, totalCommits: total }
}

function getFileSize(file) {
  try { return fs.statSync(file).size } catch (_) { return 0 }
}

function getFirstLine(file) {
  try {
    const head = fs.readFileSync(file, 'utf-8').slice(0, 120)
    // 取第一行非空、非注释、非 shebang
    for (const line of head.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('#') && !t.startsWith('//') && !t.startsWith('/*')) return t.slice(0, 100)
    }
    return head.split('\n')[0].trim().slice(0, 100)
  } catch (_) { return '' }
}

// ─── 本地模式：生成结构化文件清单 ───────────────
function generateLocalArchive(files) {
  const git = getGitInfo()
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

  // 按目录分组
  const groups = {}
  for (const f of files) {
    const rel = path.relative(PROJECT_DIR, f)
    const dir = path.dirname(rel) || '(根目录)'
    if (!groups[dir]) groups[dir] = []
    groups[dir].push(rel)
  }

  const totalSize = files.reduce((s, f) => s + getFileSize(f), 0)
  const totalLines = files.reduce((s, f) => {
    try { return s + fs.readFileSync(f, 'utf-8').split('\n').length } catch (_) { return s }
  }, 0)

  let md = ''
  md += `# 「一页」项目档案（自动归档）\n\n`
  md += `> **生成时间**：${ts}  \n`
  md += `> **模式**：本地文件清单（未调用大模型）  \n`
  md += `> **Git 分支**：${git.branch} | **最新提交**：${git.commit} | **总提交数**：${git.totalCommits}  \n`
  md += `> **源文件数**：${files.length} | **总行数**：${totalLines} | **总大小**：${(totalSize / 1024).toFixed(1)} KB  \n`
  md += `> **目标目录**：${ASSET_LIBRARY_DIR}\n\n`
  md += `---\n\n`

  md += `## 一、项目概述\n\n`
  md += `「一页」One News 是一款极简沉浸式微信小程序新闻阅读器。`
  md += `核心体验为抖音式竖滑卡片流，用户上滑切换新闻，左滑呼出分类侧边栏。`
  md += `数据源为天行数据分类接口（L4）+ 阿里百炼 DeepSeek 联网搜索（L2 刷新），`
  md += `经由云函数 getNewsList / getNewsDetail / refreshNews 分层调度。\n\n`

  md += `## 二、模块目录清单\n\n`
  const dirs = Object.keys(groups).sort()
  for (const d of dirs) {
    md += `### 📁 ${d}\n\n`
    md += `| 文件 | 大小 | 说明 |\n`
    md += `|------|------|------|\n`
    for (const rel of groups[d]) {
      const abs = path.join(PROJECT_DIR, rel)
      const kb = (getFileSize(abs) / 1024).toFixed(1)
      const hint = getFirstLine(abs)
      md += `| \`${path.basename(rel)}\` | ${kb} KB | ${hint} |\n`
    }
    md += `\n`
  }

  md += `## 三、关键文件索引（路径 + 职责）\n\n`
  md += `| 路径 | 职责 |\n`
  md += `|------|------|\n`
  const keyFiles = [
    { path: 'app.json', role: '页面路由 + 窗口配置' },
    { path: 'app.js', role: '全局入口 + 云开发初始化 + globalData' },
    { path: 'app.wxss', role: '全局样式 + 暗色模式覆盖' },
    { path: 'pages/home/home.js', role: '首页：卡片流渲染 + 手势切换 + 侧边栏 + 刷新' },
    { path: 'pages/home/home.wxml', role: '首页模板：卡片舞台 + 骨架屏 + 侧边栏 + 引导' },
    { path: 'pages/detail/detail.js', role: '详情页：按索引加载 + 上下翻页 + 动画' },
    { path: 'pages/detail/detail.wxml', role: '详情页模板：文章渲染 + 翻页按钮 + 位置指示' },
    { path: 'cloudfunctions/getNewsList/index.js', role: 'L1-L4 分层取新闻：缓存→DB→AI→天行API→聚合降级' },
    { path: 'cloudfunctions/getNewsDetail/index.js', role: 'DB 查询单条新闻详情' },
    { path: 'cloudfunctions/refreshNews/index.js', role: '定时/手动触发：百炼联网搜索→校验→写入 DB' },
    { path: 'cloudfunctions/common/config.js', role: 'API Key 配置 + 超时/缓存/分页常量' },
    { path: 'cloudfunctions/common/tianApi.js', role: '天行分类路由：endpoint→URL→重试→错误码映射' },
    { path: 'cloudfunctions/common/adapter.js', role: '天行/聚合 → 一页统一格式 + 分类映射' },
    { path: 'cloudfunctions/common/juheApi.js', role: '聚合数据 API 封装（L4 降级源）' },
    { path: 'cloudfunctions/common/llmSearch.js', role: '百炼 DeepSeek 联网搜索 + 分类 prompt 分发' },
    { path: 'cloudfunctions/common/validator.js', role: '来源白名单校验 + 去重 + 字段完整性检查' },
    { path: 'utils/constants.js', role: '前端常量：分类表 + 手势阈值 + 分页 + 暗色主题' },
    { path: 'utils/request.js', role: '请求层：Mock/云函数双模式 + 格式化 + 错误映射' },
    { path: 'utils/util.js', role: '工具函数：相对时间格式化' },
    { path: 'scripts/update-project-log.sh', role: '项目日志自动生成（每2小时）' },
    { path: 'scripts/migrate-to-asset-library.js', role: '每晚资产库归档脚本（本文件）' },
    { path: 'docs/changelog/变更记录.md', role: '完整变更记录 CHG-001~013' },
    { path: '上线操作指南.md', role: '上线部署 checklist' },
  ]
  const seen = new Set()
  for (const kf of keyFiles) {
    if (files.some(f => path.relative(PROJECT_DIR, f) === kf.path) && !seen.has(kf.path)) {
      md += `| \`${kf.path}\` | ${kf.role} |\n`
      seen.add(kf.path)
    }
  }
  // 补充未被关键清单覆盖的其他重要文件
  for (const f of files) {
    const rel = path.relative(PROJECT_DIR, f)
    if (!seen.has(rel) && (rel.includes('cloudfunctions/') || rel.includes('test/') || rel.includes('scripts/'))) {
      md += `| \`${rel}\` | 项目文件 |\n`
      seen.add(rel)
    }
  }
  md += `\n`

  md += `## 四、核心数据流\n\n`
  md += `\`\`\`\n`
  md += `用户上滑 → WXS touch 实时渲染 → JS 回调切换卡片\n`
  md += `   └─ 触达边界 → loadMoreNews / refreshCurrentCategory\n`
  md += `\n`
  md += `getNewsList 数据流：\n`
  md += `  L1 内存缓存(5min) → L2 news_cache 云数据库 → L3 AI 静态缓存 → L4 天行分类路由\n`
  md += `   └─ 失败 → 聚合降级 (juhe)\n`
  md += `\n`
  md += `refreshNews 数据流：\n`
  md += `  定时触发 → 百炼 DeepSeek 联网搜索(8分类) → 校验去重 → 写入 news_cache\n`
  md += `\n`
  md += `详情页翻页：\n`
  md += `  首页 onCardTap → globalData.detailContext{list} → 详情页按索引加载 → 上下滑动/按钮翻页\n`
  md += `  返回 → globalData._detailReturnState → 首页定位\n`
  md += `\`\`\`\n\n`

  md += `## 五、分类路由（天行数据，方案 B）\n\n`
  md += `| 一页分类 | 天行 endpoint | 状态 |\n`
  md += `|----------|--------------|------|\n`
  md += `| recommend（推荐） | generalnews | ✅ |\n`
  md += `| tech（科技） | keji | ✅ |\n`
  md += `| international（国际） | world | ✅ |\n`
  md += `| sports（体育） | generalnews（兜底） | ⚠️ |\n`
  md += `| life（生活） | generalnews（兜底） | ⚠️ |\n`
  md += `| agriculture（农业） | nongye | ✅ |\n`
  md += `| science（科学） | sicprobe | ✅ |\n`
  md += `| all（全部） | generalnews | ✅ |\n\n`

  md += `## 六、API / 密钥依赖清单\n\n`
  md += `| 密钥 | 用途 | 消费方 | 存储 |\n`
  md += `|------|------|--------|------|\n`
  md += `| TIAN_API_KEY | 天行数据新闻接口 | getNewsList / searchNews | 保险库 tian_api_key → 云函数环境变量 |\n`
  md += `| DASHSCOPE_API_KEY | 百炼 DeepSeek 联网搜索 | refreshNews | 保险库 bailian_api_key → 云函数环境变量 |\n`
  md += `| JUHE_API_KEY | 聚合数据 L4 降级（可选） | getNewsList | 待配置 |\n`
  md += `| github_pat | GitHub 推送 | github_push 助手 | 保险库 github_pat |\n\n`

  md += `## 七、近期变更摘要\n\n`
  md += `| 变更 | 内容 |\n`
  md += `|------|------|\n`
  md += `| 取消搜索 | 移除首页搜索入口 + pages/search/ + app.json 注册，后端 searchNews 保留 |\n`
  md += `| 详情页翻页 | 支持上下滑动/按钮翻页浏览 + 位置指示 + 动画 + 返回定位 |\n`
  md += `| 日志频率 | 项目日志从每5小时改为每2小时自动更新 |\n`
  md += `| 资产库归档 | 新增每晚12点项目文件归档（本档案即由此生成） |\n`
  md += `| 分类路由 | 天行 allnews→8个分类专属 endpoint，新增农业/科学独立分类 |\n\n`

  md += `---\n\n`
  md += `*本文档由定时任务自动生成（每晚 0 点） | 生成时间：${ts}*`
  return md
}

// ─── LLM 模式（暂未启用，待模型名确认） ──────────
async function organizeWithLLM(corpus) {
  const apiKey = process.env.DASHSCOPE_API_KEY || ''
  if (!apiKey) {
    const vaultPath = '/root/.secrets/bailian_api_key'
    try { apiKey = fs.readFileSync(vaultPath, 'utf-8').trim() } catch (_) {}
  }
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY，无法调用大模型')
  if (!MODEL) throw new Error('未设置 ASSET_LIB_MODEL')

  const system = `你是资深软件归档助手。请用${LANG}输出结构化「项目档案」Markdown。`
  const user = `以下是微信小程序项目全部源文件（${corpus.files.length}个）：\n\n${corpus.text}`

  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3 }),
  })
  if (!resp.ok) throw new Error(`百炼返回 ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || ''
}

// ─── 主流程 ───────────────────────────────────
async function main() {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  console.log(`[migrate] 开始归档 | ${ts} | 模式=${MODEL ? 'LLM(' + MODEL + ')' : '本地清单'} | 目标=${ASSET_LIBRARY_DIR}`)

  fs.mkdirSync(ASSET_LIBRARY_DIR, { recursive: true })
  const rawFiles = walk(PROJECT_DIR, [])
  console.log(`[migrate] 收集源文件 ${rawFiles.length} 个`)

  let archive
  if (MODEL) {
    // LLM 模式
    const corpus = buildCorpus(rawFiles)
    archive = await organizeWithLLM(corpus)
  } else {
    // 本地模式
    archive = generateLocalArchive(rawFiles)
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const outFile = path.join(ASSET_LIBRARY_DIR, `项目档案-${dateStr}.md`)
  fs.writeFileSync(outFile, archive, 'utf-8')
  console.log(`[migrate] ✅ 已写入：${outFile}（${archive.length} 字符）`)
}

// ─── buildCorpus（LLM 模式用） ─────────────────
const MAX_FILE_CHARS = 6000, MAX_TOTAL_CHARS = 120000
function buildCorpus(rawFiles) {
  const parts = []
  let total = 0
  for (const f of rawFiles) {
    if (total >= MAX_TOTAL_CHARS) break
    let content = ''
    try { content = fs.readFileSync(f, 'utf-8') } catch (_) { continue }
    if (content.length > MAX_FILE_CHARS) content = content.slice(0, MAX_FILE_CHARS) + '\n…(截断)'
    parts.push(`\n===== ${path.relative(PROJECT_DIR, f)} =====\n${content}`)
    total += content.length
  }
  return { files: rawFiles.map(f => path.relative(PROJECT_DIR, f)), text: parts.join('\n') }
}

main().catch(err => {
  console.error('[migrate] ❌ 归档失败：', err.message)
  process.exit(1)
})
