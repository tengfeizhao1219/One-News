#!/usr/bin/env node
/**
 * tools/memory-split/split-2026-08-08.mjs
 *
 * 把 .workbuddy/memory/2026-08-08.md (48K, 47 段) 按主题分桶拆到 by-window/
 * 拆完由调用方负责 git add + commit + SSH push + 同步 Notion
 *
 * 用法:
 *   node tools/memory-split/split-2026-08-08.mjs            # 真拆
 *   node tools/memory-split/split-2026-08-08.mjs --dry-run  # 只打 mapping 不动文件
 *
 * 桶定义(行号段,基于 8/8 文件):
 *   B2 PM 视角          — 行 24-65 (21:32 / 21:35 / 21:40 / 21:44 / 21:45 / 22:00)
 *   B3 FS 角色调研      — 行 66-127 (21:36 / 22:10 / 22:18 / 22:24 / 22:42)
 *   B4 FE 角色调研      — 行 128-195 (22:30 / 22:32 / 22:35 / 22:40)
 *   B5 PD 角色调研+Logo v1-v12 — 行 196-391 (22:48 / 22:50 / 22:52 / 22:43 / 22:47 / 22:48 / 22:49 / 23:13)
 *   B6 PM 决策+发布     — 行 392-585 (22:55 / 22:58 / 23:10 / 23:14 / 23:21 / 23:24 / 23:30 / 23:42 / 23:48)
 *   B7 协作规则升级     — 行 586-638 (23:35 / 23:40 / 23:43)
 *   B8 PD Logo v13-v15  — 行 601-664 (23:42 / 23:45 / 23:46)
 *   跨窗口大事(主体留) — 行 1-23 + 393-465 (PM 决策核心) + 587-664 (B7 + B8 核心结论)
 *
 * 实际拆分: 主体 = 跨窗口大事简版(~5KB)
 *          by-window/4 份 = B2 + B6 PM 视角 / B3 FS 视角 / B4 FE 视角 / B5+B8 PD 视角
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')  // → workspace root
const SRC = join(ROOT, '.workbuddy/memory/2026-08-08.md')
const BW_DIR = join(ROOT, '.workbuddy/memory/by-window')

const dryRun = process.argv.includes('--dry-run')

// ── 桶定义 ──
// 每桶: { out: 文件名, title: 标题, desc: 注释, sections: 段标题列表 }
const BUCKETS = [
  {
    out: '2026-08-08-OLD-PM-PM.md',
    title: '2026-08-08 · PM 窗口当日细节(旧 sid 待补登)',
    desc: '原 PM 窗口(2026-08-08 晚)的当日细节。\n原 sid 未知(2026-08-09 08:30 之前的窗口未注册 registry)。\n待 owner 补登历史 sid。',
    role: 'PM',
    sections: [
      '21:32 — 用户指定当前会话角色：PM',
      '21:35 — 用户给仓库地址：https://github.com/tengfeizhao1219/One-News',
      '21:40 — 仓库内协作机制文件分布',
      '21:44 — 用户要求从另一个空间迁移项目信息',
      '21:45 — PM 视角当前状态',
      '22:00 — 待与用户对齐的 3 选 1（PM 接棒动作）',
      '22:55 — PM 上岗第一件事:项目全局状态盘点',
      '22:58 — 用户要求任务"讲人话" + 补全任务描述',
      '23:10 — owner 拍板 3 项决策 + 落地',
      '23:14 — Q-05 推进计划 v0.1 落地 (PM A 路径开干)',
      '23:21 — owner 选 A:PD 已开新窗口,PM+PD 并行推 Q-05',
      '23:42 — 收到 v1.1.0 发布消息 + 进入"优化 + 内容完善"阶段',
      '23:48 — owner 问 git/Notion 同步状态',
    ],
  },
  {
    out: '2026-08-08-OLD-FS-FS.md',
    title: '2026-08-08 · FS 窗口当日细节(旧 sid 待补登)',
    desc: '原 FS 窗口(2026-08-08 晚)的当日细节。\n原 sid 未知,待 owner 补登。',
    role: 'FS',
    sections: [
      '21:36 — 全栈开发视角项目概况调研',
      '22:10 — 当前会话角色冲突待用户确认',
      '22:18 — 用户决定:覆盖历史,本次切 FS;并要求汇总项目情况+开发遗留事项',
      '22:24 — 汇总素材已抓全',
      '22:42 — 用户提出多会话多角色协作澄清(关键设计意图)',
      '23:24 — FS 实施 Owner 简报 v1.0 接入(完成)',
      '23:30 — 读全「任务交接流转机制」v1.1',
    ],
  },
  {
    out: '2026-08-08-OLD-FE-FE.md',
    title: '2026-08-08 · FE 窗口当日细节(旧 sid 待补登)',
    desc: '原 FE 窗口(2026-08-08 晚)的当日细节。\n原 sid 未知,待 owner 补登。',
    role: 'FE',
    sections: [
      '22:30 — 角色再切 FE (2026-08-08 第二次角色冲突)',
      '22:32 — FE 权责(本项目口径)',
      '22:35 — FE 视角项目状态(快览)',
      '22:40 — FE 待办(从历史素材筛,本轮不动手)',
    ],
  },
  {
    out: '2026-08-08-OLD-PD-PD.md',
    title: '2026-08-08 · PD 窗口当日细节(旧 sid 待补登)',
    desc: '原 PD 窗口(2026-08-08 晚)的当日细节。\n含 Logo 迭代史 v1-v15。\n原 sid 未知,待 owner 补登。',
    role: 'PD',
    sections: [
      '22:48 — 角色再切 PD (今日第三次角色切换)',
      '22:50 — PD 视角快速调研成果',
      '22:52 — 即席任务 #1: 项目 logo 设计(PD 权责内)',
      '22:43 — Logo 深化: A 字母锁 + 一页意象',
      '22:47 — 用户明确回答定位问题 + 锁定 PM 角色',
      '22:48 — 发现另一个会话窗口的产物',
      '22:49 — 用户再次问"你的角色是什么"',
      '23:13 — 用户要求盘点"手上待推进任务"',
      '23:42 — PD Logo 迭代 v13(完全跳出字形/纸张)',
      '23:45 — PD Logo 迭代 v14(6 完成稿,字面贴合)',
      '23:46 — PD Logo 迭代 v15(收敛·PD 终推)',
    ],
  },
]

// ── 工具:读全文,按 ## 段切 ──
function splitSections(text) {
  // 第一行是 # YYYY-MM-DD 标题,不算 ## 段
  // 用 ## 切片,保留每个 ## 段的内容
  const lines = text.split('\n')
  const sections = []  // { title, body (含 ## 行), startLine }
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.match(/^## /)) {
      if (current) sections.push(current)
      current = { title: line.replace(/^## /, '').trim(), lines: [line], startLine: i + 1 }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) sections.push(current)
  return sections
}

function header(bucket) {
  return `<!--
by-window/${bucket.out}
本文件 = ${bucket.desc}
对应 sessions/<old-sid>/context.md (待 owner 补登)
-->
# ${bucket.title}

> **本文件只本窗口读**。跨窗口交接写 \`whiteboard/2026-08-08.md\` 或 \`~/.workbuddy/whiteboard/commlog/\`。
> **同上下文接力**:本文件 + \`~/.workbuddy/MEMORY.md\` + \`~/.workbuddy/whiteboard/registry.json\` = 完整 session 还原。

---

`
}

// ── 干跑:打 mapping ──
function plan() {
  const text = readFileSync(SRC, 'utf-8')
  const sections = splitSections(text)
  const secByTitle = new Map()
  for (const s of sections) secByTitle.set(s.title, s)
  console.log(`\n=== ${SRC} ===`)
  console.log(`总段数: ${sections.length}`)
  console.log(`文件大小: ${(statSync(SRC).size / 1024).toFixed(1)} KB`)
  console.log()
  for (const b of BUCKETS) {
    const matched = b.sections.filter(s => secByTitle.has(s))
    const missing = b.sections.filter(s => !secByTitle.has(s))
    const totalLines = matched.reduce((acc, s) => acc + secByTitle.get(s).lines.length, 0)
    console.log(`[${b.role}] → ${b.out}`)
    console.log(`  匹配 ${matched.length}/${b.sections.length} 段,共 ${totalLines} 行`)
    if (missing.length) {
      console.log(`  ⚠️  缺:`)
      for (const m of missing) console.log(`     - ${m}`)
    }
  }
  // 校验:所有目标段都唯一存在
  const allTarget = new Set()
  let dup = 0
  for (const b of BUCKETS) for (const s of b.sections) {
    if (allTarget.has(s)) { dup++; console.log(`  ⚠️  重复分配: ${s}`) }
    allTarget.add(s)
  }
  const allSectionTitles = new Set(sections.map(s => s.title))
  const orphan = [...allSectionTitles].filter(t => !allTarget.has(t) && !t.startsWith('21:09') && !t.startsWith('21:12') && !t.startsWith('21:21') && !t.startsWith('21:25') && !t.startsWith('22:36') && !t.startsWith('22:37') && !t.startsWith('22:39') && !t.startsWith('23:35') && !t.startsWith('23:40') && !t.startsWith('23:43') && !t.startsWith('23:42') && !t.startsWith('23:48'))
  console.log(`\n未分配段(${orphan.length}):`)
  for (const o of orphan) console.log(`  - ${o}`)
  console.log(`\n重复分配: ${dup}`)
}

// ── 真拆 ──
function execute() {
  const text = readFileSync(SRC, 'utf-8')
  const sections = splitSections(text)
  const secByTitle = new Map()
  for (const s of sections) secByTitle.set(s.title, s)

  // 1. 写 4 个 by-window 文件
  for (const b of BUCKETS) {
    const matched = b.sections.filter(s => secByTitle.has(s))
    const body = matched.map(s => secByTitle.get(s).lines.join('\n')).join('\n\n')
    const out = header(b) + body + '\n'
    const outPath = join(BW_DIR, b.out)
    if (dryRun) {
      console.log(`[DRY] would write: ${outPath} (${(out.length / 1024).toFixed(1)} KB, ${matched.length} sections)`)
    } else {
      writeFileSync(outPath, out, 'utf-8')
      console.log(`✅ wrote: ${outPath} (${(out.length / 1024).toFixed(1)} KB, ${matched.length} sections)`)
    }
  }

  // 2. 缩 8/8.md 主体到 ~5KB,只留跨窗口大事
  const mainKeep = [
    '21:09 — 用户提出云端同步诉求',
    '21:12 — 用户要求读 Notion 协作文档',
    '21:21 — 用户授权 Notion Token',
    '21:25 — 协作文档要点(已对齐)',
    '23:10 — owner 拍板 3 项决策 + 落地',
    '23:42 — 收到 v1.1.0 发布消息 + 进入"优化 + 内容完善"阶段',
    '23:35 — owner 升级协作规则:默认必推+同步',
    '23:40 — git 直推 + Notion 收口完成(SSH 化)',
    '23:43 — owner 拍板「每次都记」+ remote URL 永久改 SSH',
  ]
  const keepSections = mainKeep.filter(s => secByTitle.has(s)).map(s => secByTitle.get(s).lines.join('\n'))
  const mainNew = `# 2026-08-08

> **本文件 = 跨窗口大事留底**(从 48KB 缩到 ~5KB)。
> 详细主题分流到 \`by-window/2026-08-08-OLD-{PM,FS,FE,PD}-*.md\`。
> 元协作机制要点 = \`COLLAB-MECHANISM-2026-08-08.md\`(5KB 已有)。
> 8/8 单日单窗口多角色切换流水账已下线,只留 9 段跨窗口决定。

---

${keepSections.join('\n\n')}

---

## 拆分索引(8/9 09:00 FS 窗口 · sid 20260809-JZDP1NQJ0TA6)

| 主题 | 文件 | 角色 |
|---|---|---|
| PM 决策 + 项目盘点 + v1.1.0 发布 | by-window/2026-08-08-OLD-PM-PM.md | PM |
| FS 视角项目调研 + Owner 简报实施 + 任务流转机制读全 | by-window/2026-08-08-OLD-FS-FS.md | FS |
| FE 权责对齐 + 视角项目状态 + 待办清单 | by-window/2026-08-08-OLD-FE-FE.md | FE |
| PD 切换 + 调研 + Logo 迭代 v1-v15(全史) | by-window/2026-08-08-OLD-PD-PD.md | PD |
| 跨日跨周事实(SSH/默认必推/Notion 唯一权威) | ../../MEMORY.md §X | — |
`
  if (dryRun) {
    console.log(`\n[DRY] would rewrite: ${SRC} (${(mainNew.length / 1024).toFixed(1)} KB, ${mainKeep.length} sections)`)
  } else {
    // 备份(只在原文件 size > 10KB 时备份,避免重复跑覆盖)
    const srcStat = statSync(SRC)
    if (srcStat.size > 10 * 1024) {
      const backupPath = SRC + '.bak'
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, text, 'utf-8')
        console.log(`📦 backup: ${backupPath}`)
      } else {
        console.log(`📦 backup exists, skip: ${backupPath}`)
      }
    }
    writeFileSync(SRC, mainNew, 'utf-8')
    console.log(`✅ rewrote: ${SRC} (${(mainNew.length / 1024).toFixed(1)} KB, ${mainKeep.length} sections)`)
  }
}

if (dryRun) plan()
else execute()
