# 后端云函数（AI 情报官 · intel_* 命名空间）

> 实时状态：Phase 1–3 已落地（intelFetch 分片编排 / intelRssPoll 按源 worker /
> intelProcess 处理引擎 + 分层路由 + multi-engine LLM）。整体可摘除，intel_ 隔离。
> 详见《AI情报官_设计文档_v1.md》《AI情报官_实现任务拆解.md》。

## 云函数清单

| 云函数 | 目录 | 职责 | 状态 |
|---|---|---|---|
| `intelFetch` | `backend/intelFetch/` | self-fan-out 分片抓取编排器（复用 One News refreshNews，60s 超时规避） | ✅ T1.4 |
| `intelRssPoll` | `backend/intelRssPoll/` | 按源 worker：抓取→解析→去重→写 `intel_ingest`（status=pending）+ 增量游标 + 四类告警 | ✅ T1.4/T2 |
| `intelProcess` | `backend/intelProcess/` | 处理引擎：读 pending → 分层路由 → SOP 五步/轻量 → 写 `intel_staged` | ✅ T3.1–T3.4 |

## 公共模块（backend/common/）

| 模块 | 职责 | 状态 |
|---|---|---|
| `intelLLM.js` | 通用 multi-engine chat（混元前置→智谱→Qwen→DeepSeek，复用 One News interpretNews 降级链，注入自定义 SOP prompt） | ✅ T3.1 地基 |
| `intelRouter.js` | 分层路由（规则+信号词打分 high/medium/low，三重身份权重 + 合同/接口变更特殊路由） | ✅ T3.2 |
| `ensureSchema.js` | intel_* 六集合自愈建表 + 唯一索引 | ✅ T1.1 |
| `contentFetcher.js` | 零依赖 HTML 抓取（官网正文） | ✅ T1.3 |
| `adapters/` | RSS/API/Scrape/WeChat 四类源适配器模板 | ✅ T2 |

## 数据流

```
intel_ingest(status=pending)
  → [intelProcess] 分层路由
      ├─ low   → status=low（丢弃，不进今日关注）
      ├─ medium→ 轻量摘要（一句话+场景映射）
      └─ high  → SOP 五步（强模型）+ 场景映射 + 翻译
  → intel_staged(ProcessedItem)
  → 发布闸门(T4.1) 置 isCurrent 指针 → intel_current（用户可见）
```

## 定时触发器（错峰，owner 已拍 B 方案：独立定时器延迟统一处理）

| 时刻 | intelFetch 抓取 | intelRssPoll 兜底 | intelProcess 处理 |
|---|---|---|---|
| 05 档 | 05:10 | 05:15 | 05:20 |
| 11 档 | 11:10 | 11:15 | 11:20 |
| 18 档 | 17:55 | 18:00 | 18:10 |

- intelProcess 消费 `intel_ingest(status=pending)` → 分层路由 → SOP → 写 `intel_staged`。
- 成本集中在处理档，便于核算；抓取与处理错峰隔离。

## 待办 / 缺口（需 owner）

- **LLM Key（T0.3 🚫）**：intelProcess 依赖 `intelChat` 多引擎，未配 Key 时静默降级跳过；
  联调前给独立 env key。
- **微信本地通道（T2.5）**：本地 SQLite→云端 worker 的物理通道待 owner 拍部署形态。

## 部署注意

- 云函数 `intelFetch` / `intelRssPoll` / `intelProcess` 均 `require('../common/*')`，
  部署时需将 `backend/common/` 与 `backend/seedSources.js` 一并上传。
- `intel_` 所有集合/字段与 One News 阅读数据物理隔离、命名空间隔离，可整体摘除。
