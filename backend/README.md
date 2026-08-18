# 后端云函数（AI 情报官 · intel_* 命名空间）

> 实时状态：Phase 1–3 已落地（intelFetch 分片编排 / intelRssPoll 按源 worker /
> intelProcess 处理引擎 + 分层路由 + multi-engine LLM）。**Phase 4 推送/UI 部分已落地
> （Channels 渠道抽象 + getIntelBrief 读取云函数）**。整体可摘除，intel_ 隔离。
> 详见《AI情报官_设计文档_v1.md》《AI情报官_实现任务拆解.md》。

## 云函数清单

| 云函数 | 目录 | 职责 | 状态 |
|---|---|---|---|
| `intelFetch` | `backend/intelFetch/` | self-fan-out 分片抓取编排器（复用 One News refreshNews，60s 超时规避） | ✅ T1.4 |
| `intelRssPoll` | `backend/intelRssPoll/` | 按源 worker：抓取→解析→去重→写 `intel_ingest`（status=pending）+ 增量游标 + 四类告警 | ✅ T1.4/T2 |
| `intelProcess` | `backend/intelProcess/` | 处理引擎：读 pending → 分层路由 → SOP 五步/轻量 → 写 `intel_staged` | ✅ T3.1–T3.4 |
| `intelBrief` | `backend/intelBrief/` | **读端**：读 `intel_current`(isCurrent=true) → Channels 层 OneNewsChannel 渲染 → 供「AI 情报」首页拉取 | ✅ T4.x |
| `intelDispatcher` | `backend/intelDispatcher/` | 发布闸门（T4.1）：读 `intel_staged` 未发布 → 三层巡检编排（05 初版/11 追加/18 汇总结案）→ 组装 rolling brief → 升级 `isCurrent` 指针 | ✅ T4.1 |

## 公共模块（backend/common/）

| 模块 | 职责 | 状态 |
|---|---|---|
| `intelLLM.js` | 通用 multi-engine chat（混元前置→智谱→Qwen→DeepSeek，复用 One News interpretNews 降级链，注入自定义 SOP prompt） | ✅ T3.1 地基 |
| `intelRouter.js` | 分层路由（规则+信号词打分 high/medium/low，三重身份权重 + 合同/接口变更特殊路由） | ✅ T3.2 |
| `ensureSchema.js` | intel_* 六集合自愈建表 + 唯一索引 | ✅ T1.1 |
| `contentFetcher.js` | 零依赖 HTML 抓取（官网正文） | ✅ T1.3 |
| `channels/` | **Channels 渠道抽象层（§7.6/§7.8）**：IntelChannel 基类 + OneNewsChannel 实现 + 注册表 | ✅ T4.x |
| `adapters/` | RSS/API/Scrape/WeChat 四类源适配器模板 | ✅ T2 |

## 数据流

```
intel_ingest(status=pending)
  → [intelProcess] 分层路由
      ├─ low   → status=low（丢弃，不进今日关注）
      ├─ medium→ 轻量摘要（一句话+场景映射）
      └─ high  → SOP 五步（强模型）+ 场景映射 + 翻译
  → intel_staged(ProcessedItem, releasedAt=空)
  → [intelDispatcher 发布闸门 T4.1]
      ├─ 05 增量初版 / 11 增量追加 / 18 汇总结案（§7.3）
      ├─ 组装 Brief（今日关注 + 本周可试用清单，§6.3 固定模板）
      └─ 升级 isCurrent 指针 → intel_current（用户可见）
```

`intelDispatcher` 细节：
- **模式自动判定**：按当前北京时刻自动落 05(初版)/11(追加)/18(汇总结案)；也支持 `event.mode` 覆盖（联调/补发）。
- **集合**：读 `intel_staged`（status=staged 且 releasedAt 空、high/medium）→ 写 `intel_current`（Brief，`isCurrent` 指针）→ `intel_config` 文档 `intel_current_issue` 记 `{ currentIssueId, date, version }`。
- **今日关注**：当日高/中相关 items，逐条 §6.3 五步卡片，合同/接口变更条目置顶，其余按场景命中强度降序。
- **本周可试用清单**：当周 `tryable=true` 滚动去重（周一清零）。
- **健康度兜底（§7.7）**：源全失败→「部分源今日未更新（待验证）」；处理大面积失败→「今日无可靠更新」占位；指针升级失败→重试 3 次+告警+下期巡检自动补发。
- **无新增不发布**（"有则汇报、无则不打扰"）；18 后当日 brief 锁定，次日 05 新建。

## 小程序「AI 情报」首页读取契约（getIntelBrief + Channels 渲染）

- **读端**：`getIntelBrief` 优先读 `intel_config.intel_current_issue.currentIssueId` 指针，回退按
  `intel_current` 的 `isCurrent=true`；读到 Brief 后交 Channels 层 `OneNewsChannel` 端渲染。
- **前端封装**：`utils/intelRequest.js` 的 `getIntelBrief()`（云函数同名单向调用）。
- **页面**：`pages/intel/home/home.js`（onLoad 拉取）→ 今日关注卡片流 + 本周可试用清单 +
  「数据截至 HH:MM」+ 源健康提示（§7.6）；后端未就绪时保留演示缓存不对空页。

`OneNewsChannel.render(brief)` 输出 payload（对齐 intelDispatcher 真实落库结构）：

```jsonc
{
  "ok": true, "channel": "oneNews",
  "date": "2026-08-18", "version": 3, "mode": "summary", "locked": true,
  "dataAsOf": { "hhmm": "18:02", "generatedAt": "...", "label": "数据截至 18:02" }, // 数据截至 HH:MM
  "focusItems": [   // 今日关注卡片流（SOP 五步已由 Dispatcher 折叠进 card，此处端提取）
    { "id","title","url","sourceName","publishedAt",
      "definition","sceneMapping","practice","minAction",     // 从 card Markdown 提取
      "card","contract","sceneTags","sceneHits","relevance","rank" }
  ],
  "tryable": [ { "id","title","minAction","url","done" } ],   // 本周可试用清单（可勾选）
  "health": { "level":"degraded"|"all-failed", "title":"部分源今日未更新（待验证）", "detail" } | null,
  "hasContent": false, "placeholder": false, "banner": "",
  "empty": { "message" }                                      // 空态占位
}
```

> 注意：`intelDispatcher` 把 SOP 五步折叠进 `items[].card`（§6.3 固定模板）；`OneNewsChannel`
> 从 card 提取一句话/最小行动等前端字段，不要求后端再展开 —— 这正是 Channel「端适配」的价值，
> 将来接微信/WhatsApp 复用同一 Brief 换渲染逻辑即可（§7.8）。

## 定时触发器（错峰，owner 已拍 B 方案：独立定时器延迟统一处理）

| 时刻 | intelFetch 抓取 | intelRssPoll 兜底 | intelProcess 处理 | intelDispatcher 发布 |
|---|---|---|---|---|
| 05 档 | 05:10 | 05:15 | 05:20 | 05:30（初版） |
| 11 档 | 11:10 | 11:15 | 11:20 | 11:30（追加） |
| 18 档 | 17:55 | 18:00 | 18:10 | 18:30（汇总结案） |

- intelProcess 消费 `intel_ingest(status=pending)` → 分层路由 → SOP → 写 `intel_staged`。
- intelDispatcher 在目标时刻组装发布（发布闸门），处理需**先于或并行于**发布完成；错峰隔离避免相互拖慢。
- 成本集中在处理档，便于核算。

## 待办 / 缺口（需 owner）

- **LLM Key（T0.3 🚫）**：intelProcess 依赖 `intelChat` 多引擎，未配 Key 时静默降级跳过；
  联调前给独立 env key。
- **微信本地通道（T2.5）**：本地 SQLite→云端 worker 的物理通道待 owner 拍部署形态。

## 部署注意

- 云函数 `intelFetch` / `intelRssPoll` / `intelProcess` / `intelDispatcher` / `intelBrief` 均 `require('../common/*')`，
  部署时需将 `backend/common/` 与 `backend/seedSources.js` 一并上传。
- `intel_` 所有集合/字段与 One News 阅读数据物理隔离、命名空间隔离，可整体摘除。
