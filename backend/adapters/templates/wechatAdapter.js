/**
 * wechatAdapter.js — 公众号本地解析适配器（T2.5）
 * ============================================================
 * 角色：A（适配器）· T2.1 交付的模板 → 本文件落地为可运行组件
 * 覆盖源：sources-manifest.json `wechat-officials`（量子位 / 机器之心 / 数字生命卡兹克 等用户主动订阅号）
 *
 * 合规红线（调研 §5 全章，写进需求 §5.4 六条）：
 *   - 仅个人学习研究、不商用传播、不二次分发
 *   - 输出标来源公众号 + 原文链接 + 作者，不整篇搬运（摘要/翻译优先）
 *   - 最小必要：只抓用户主动订阅的号，不广撒网
 *   - 可一键关停；路径失效 → 静默降级（不报错刷屏）
 *   - 本地优先：首选本地 SQLite 解析，避免交给不可控第三方
 *
 * 技术路径（2026-08 实测，调研 §5.2/§5.3 结论）：
 *   - 首选：本地 SQLite 解析 —— 解析本机微信客户端数据库
 *       · ChatLog（vitamin5x/chatlog，2026-01 活跃，兼容微信 3.x/4.x，含 HTTP API + MCP）
 *       · wechat_db_parser（grapeot，专注公众号文章导出，支持 CSV/Markdown）
 *   - 备选：微信读书 API（wewe-rss 及活跃 fork）——需要正文做全文索引/深度摘要时启用
 *   - 不纳入：RSSHub 公众号路由、网页抓取/UI 自动化、公共第三方托管（调研已否决）
 *
 * 云端解耦（关键设计）：
 *   - 本适配器双模复用：**本地进程**（RUN_LOCAL=true）解析 SQLite / 导出文件；
 *   - 本地进程额外暴露轻量 HTTP API（见 serveLocal ），供**云端消费端** fetch；
 *   - 云端只消费本地进程暴露的 HTTP API，不直连微信服务器、不爬微信；
 *   - 本地进程不可达 → 云端静默降级（返回空数组 degraded，不报错刷屏）。
 *
 * ⚠️ 已知设计缺口（待 owner 拍部署形态）：云端 worker 运行在 CloudBase，无法直连
 *   用户设备的 127.0.0.1。公众号数据的「本地进程 → 云端」物理通道（设备凭据/上传网关/
 *   合规隧道）尚未落地，见 intel-docs 设计 §5.6 注释。本文件负责「数据从本地解析端产出、
 *   供消费端统一 fetch」的接口契约与兜底，不负责该物理通道。
 */

// ── 本地 SQLite / 导出解析（仅在本地进程运行；云端不 require better-sqlite3）──
const crypto = require('crypto')

/** sha256 摘要（guid 去重键派生的唯一来源） */
function guidFor(urlLike) {
  return `wechat:${crypto.createHash('sha256').update(String(urlLike || '')).digest('hex')}`
}

/**
 * 把一条「原始微信记录」归一化为 intel_ingest item。
 * @param {Object} r - 源记录字段（title / url|app_msg_url|link / publish_time|published_at|create_time / author / content|digest）
 * @param {string} sourceId
 */
function toItem(r, sourceId) {
  const url = r.url || r.app_msg_url || r.link || ''
  const title = r.title || '(无标题)'
  // publish_time 可能是 unix 秒；published_at/create_time 可能是 ISO
  let pub = r.published_at || r.publish_time || r.create_time || r.datetime
  if (typeof pub === 'number' && pub < 1e12) pub = new Date(pub * 1000).toISOString() // unix 秒
  else if (pub && typeof pub.toISOString === 'function') pub = pub.toISOString()
  else pub = pub ? new Date(pub).toISOString() : new Date().toISOString()
  return {
    source_id: sourceId,
    item_guid: guidFor(url || title + pub),
    title,
    url: url || '',
    published_at: pub,
    raw_content: (r.content || r.digest || '').slice(0, 5000), // 版权红线：仅作 AI 加工瞬时数据，不整篇搬运
    summary: String(r.content || r.digest || '').replace(/\s+/g, ' ').slice(0, 300),
    fetch_method: 'wechat',
    fetched_at: new Date().toISOString(),
    meta: { author: r.author || '', source_name: r.source_name || '', note: '本地 SQLite 解析，来源公众号需标注（个人学习研究，不对外传播）' },
  }
}

/**
 * 从本地微信 SQLite / 导出文件读取「更新的公众号文章」。
 * 三路读取，按可用性择优（零云端依赖）：
 *   1) better-sqlite3 直读本机微信客户端库（ChatLog 或 wechat_db_parser 兼容表结构）
 *   2) 已导出 JSON 文件（ChatLog / 自建导出脚本产物，字段已解耦）
 *   3) 已导出 CSV 文件（wechat_db_parser 支持 CSV）
 * @param {string} localDbPath.
 * @param {Object} opts - { since, accounts, maxItems }
 * @returns {Array} 归一化 item 数组
 */
function readLocal(localDbPath, opts = {}) {
  if (!localDbPath) return []
  const fs = require('fs')
  if (fs.existsSync(localDbPath)) {
    try {
      // 1) SQLite（.db / .sqlite）→ better-sqlite3（本地进程依赖，非云端）
      const Database = require('better-sqlite3')
      const db = new Database(localDbPath, { readonly: true })
      try {
        // 探测可用表：优先 wechat_db_parser 的 message / ChatLog 的 msg_table
        const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((t) => t.name)
        const tbl = tables.find((t) => /message|msg/i.test(t)) || (tables.length ? tables[0] : null)
        if (!tbl) return []
        const cols = db.prepare(`PRAGMA table_info(${tbl})`).all().map((c) => c.name)
        const colUrl = ['app_msg_url', 'url', 'link'].find((c) => cols.includes(c))
        const colTime = ['publish_time', 'published_at', 'create_time'].find((c) => cols.includes(c))
        const colTitle = ['title'].find((c) => cols.includes(c))
        const colContent = ['content', 'digest'].find((c) => cols.includes(c))
        const colAuthor = ['author', 'user_name', 'source_name'].find((c) => cols.includes(c))
        const sel = [colTitle, colUrl, colTime, colContent, colAuthor].filter(Boolean).join(', ')
        if (!colTitle || !sel) return []
        const rows = db.prepare(`SELECT ${sel} FROM ${tbl} ORDER BY ${colTime} DESC LIMIT ?`).all(opts.maxItems || 30)
        return rows.map((r) => toItem(r, opts.sourceId))
      } finally { db.close() }
    } catch (e) {
      // better-sqlite3 未装或其库结构不兼容 → 落到导出文件路
      console.warn('[wechatAdapter] SQLite 直读失败（放行，转导出文件路由）:', e.message)
    }
  }
  // 2/3) JSON / CSV 导出
  const jsonPath = localDbPath.endsWith('.json') ? localDbPath : null
  const csvPath = localDbPath.endsWith('.csv') ? localDbPath : null
  if (jsonPath) {
    try {
      const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      const list = Array.isArray(arr) ? arr : (arr.items || [])
      return list.slice(0, opts.maxItems || 30).map((r) => toItem(r, opts.sourceId))
    } catch (e) { console.warn('[wechatAdapter] JSON 导出读取失败（放行）:', e.message); return [] }
  }
  if (csvPath) {
    try {
      const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean)
      const head = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim())
      const out = []
      for (const ln of lines.slice(1)) {
        const cells = ln.split(',').map((c) => c.replace(/^"|"$/g, '').trim())
        const rec = {}
        head.forEach((h, i) => { rec[h] = cells[i] })
        out.push(toItem(rec, opts.sourceId))
      }
      return out
    } catch (e) { console.warn('[wechatAdapter] CSV 导出读取失败（放行）:', e.message); return [] }
  }
  return []
}

/** 时间窗过滤（若调用方给了 since） */
function filterSince(items, since) {
  if (!since) return items
  const ts = new Date(since).getTime()
  return items.filter((it) => new Date(it.published_at).getTime() >= ts)
}

/**
 * 统一适配器接口：fetch(source, opts) -> { items, degraded? }
 * 双模：
 *   - 本地进程（RUN_LOCAL=true）：直读本地 SQLite / 导出文件（readLocal）
 *   - 云端消费端（默认）：fetch 本地进程暴露的 HTTP API；不可达 → 空数组静默降级
 * @param {Object} source - sources-manifest.json 源定义（wechatConfig 必填）
 * @param {Object} opts - { since: Date, maxItems: number, sourceId }
 */
async function fetch(source, opts = {}) {
  const cfg = source.wechatConfig || {}
  const sourceId = opts.sourceId || source.id || cfg.sourceId || 'wechat_officials'
  const localEnabled = String(process.env.RUN_LOCAL || 'false').toLowerCase() === 'true'

  // ── 本地模式：直读 SQLite / 导出文件 ──
  if (localEnabled) {
    const dbPath = cfg.localDb || process.env.WECHAT_LOCAL_DB // manifest 中 localDb = {WECHAT_LOCAL_DATA_DIR}/wechat.db
    if (!dbPath) return { items: [], error: '未配置 WECHAT_LOCAL_DB' }
    let items = readLocal(dbPath, { since: opts.since, accounts: cfg.accounts || [cfg.account], maxItems: opts.maxItems || 30, sourceId })
    items = filterSince(items, opts.since)
    return { items }
  }

  // ── 云端模式：消费本地进程 HTTP API ──
  // 物理通道未落地时（本地进程不在可连地址），fetch 必然失败 → 走静默降级。
  const localApiBase = process.env.WECHAT_LOCAL_API_BASE || 'http://127.0.0.1:8787' // ChatLog 默认 HTTP API 端口
  const http = require(localApiBase.startsWith('https') ? 'https' : 'http')
  return new Promise((resolve) => {
    const sinceTs = opts.since ? Math.floor(new Date(opts.since).getTime() / 1000) : 0
    const url = `${localApiBase}/api/items?since=${sinceTs}&limit=${opts.maxItems || 30}`
    const req = http.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return resolve({ items: [], degraded: true, reason: `local API HTTP ${res.statusCode}` })
      }
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          const list = Array.isArray(data) ? data : (data.items || [])
          resolve({ items: list.map((r) => toItem(r, sourceId)) })
        } catch (e) {
          resolve({ items: [], degraded: true, reason: 'local-api-invalid-json' })
        }
      })
    })
    req.on('error', () => resolve({ items: [], degraded: true, reason: 'local-process-unreachable' }))
    req.on('timeout', () => { req.destroy(); resolve({ items: [], degraded: true, reason: 'local-process-timeout' }) })
    req.end()
  })
}

/**
 * 本地 HTTP 服务（仅本地进程调用，供云端消费端 fetch /api/items）。
 * 用 Node 原生 http 起一个最小服务：GET /api/items?since=&limit=
 * @param {string} localDbPath - SQLite / 导出文件路径
 * @param {Object} opts - { port, sourceId }
 * @returns {http.Server}
 */
function serveLocal(localDbPath, opts = {}) {
  const { port = 8787 } = opts
  const http = require('http')
  const sourceId = opts.sourceId || 'wechat_officials'
  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/items')) {
      try {
        const u = new URL(req.url, 'http://localhost')
        const since = u.searchParams.get('since')
        const limit = Number(u.searchParams.get('limit')) || 30
        let items = readLocal(localDbPath, { maxItems: limit, sourceId })
        if (since) items = filterSince(items, new Date(Number(since) * 1000))
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ items }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
      return
    }
    res.writeHead(404).end()
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`[wechatAdapter] 本地数据服务已启动 http://127.0.0.1:${port}/api/items`)
  })
  return server
}

module.exports = { fetch, readLocal, serveLocal, toItem, guidFor }
