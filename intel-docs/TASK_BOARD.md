# TASK_BOARD · AI 情报官任务看板

> 状态机：📋 待认领 → 🔄 进行中（填认领人）→ ✅ 完成（为下一角色建/激活任务）→ 🚫 阻塞；失败 → 🔁 重试中 / ⛔ 放弃。关口前先跑 `python3 scripts/check.py intel-docs`。
> 维护者：全员认领；O 主控做关口检查。配合 `RELAY.md`（计划跟踪）与 `COMMLOG.md`（沟通记录）使用。

---

## Phase 0 · 环境与资源就绪

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T0.1 | 本地仓库克隆 + 接入准备 | I | ✅ | — | `onenews-clone` 已克隆、6 假设已校准 |
| T0.2 | Notion token / 资料库 / 同步机制 | K/O | ✅ | — | token 已给、库已建、9 文档已同步、后台守护每 60s 轮询 |
| T0.3 | LLM Key（intelProcess 独立 key） | O | 🚫 待 owner | — | 不影响 Phase 1–6 写码，Phase 3 联调前给 |
| T0.4 | 微信云开发平台账号/环境 | O | 🚫 待 owner | — | 部署时用；本地写码不受影响 |
| T0.5 | 协作机制文件五件套落盘 | K | 🔄 | — | 协作机制/ROLE_CARDS/CONTEXT 已写；TASK_BOARD/COMMLOG/RELAY 本次补齐 |

## Phase 1 · 基础设施与脚手架

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T1.1 | `intel_*` 集合 + 自愈建表 | I | ✅ | 复用审计 | 仿 `ensureSchema`，`intel_ingest/intel_staged/intel_current/intel_sources/intel_health/intel_profile` 六集合 + 唯一索引 |
| T1.2 | `seedSources.js` 25 源注册 + 幂等播种 | I | ✅ | 信息源调研 §4 | 仿 `seedFeeds`，25 源取调研映射总表（A9/B6/C6/D2/E1/F1，四类 adapter） |
| T1.3 | `contentFetcher.js` → `backend/common/` | I | ✅ | 复用审计 🟢直接 | 复制零依赖部分（fetchWebPage/extractContentFromHtml/isInvalidDesc）+ `intel_` 注释 |
| T1.4 | `intelFetch` self-fan-out + `intelRssPoll` 按源 worker + 3 定时器 | I | ✅ | T1.1–1.3 | 含 §5.8 超时防护 + lastSuccessCursor 续传；定时器 05:10/11:10/17:40 与 05:15/11:15/17:45 错峰；Dispatcher 18:00 准时发布（ADR-10）。**2026-08-19 owner 拍板**：定时档固定节点无条件抓全部启用源，移除 `listDueFeeds` pollSeconds 间隔判定 → `listEnabledFeeds`（提交 `d85ae00`，见设计 §5.8）|

## Phase 2 · 抓取层（适配器）

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T2.1 | 25 源适配器清单（manifest） | A | ✅ | 信息源调研 §4/§5 | 交付 `backend/adapters/`：sources-manifest.json（25 源）+ 四类适配器模板 + README；id 已与 seedSources 对齐 |
| T2.2 | RSS 直连适配器（17 源） | A | 📋 | T2.1 ✅ | 仿 `rssFetcher` worker；模板已就绪 |
| T2.3 | API 适配器（HN / arXiv / Google News RSS） | A | 📋 | T2.1 ✅ | 差异化抓取；模板已就绪 |
| T2.4 | 官网抓取适配器（Anthropic/Meta/The Batch/The Neuron/机器之心） | A | 📋 | T2.1 ✅ | 复用 `contentFetcher.js`；模板已就绪 |
| T2.5 | 公众号本地 SQLite 解析 | A | 📋 | T2.1 ✅ | 首选本地 SQLite / 备选微信读书；模板已就绪 |

## Phase 3 · 处理层（LLM 阅读引擎）

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T3.1 | `intelProcess` 云函数 + 独立 LLM key | P | 📋 | T0.3 | 分账核算 |
| T3.2 | SOP 五步 + 分层路由（廉价模型筛 70%+） | P | 📋 | T3.1 | 强模型只跑高相关 |
| T3.3 | 「落到你这里」画像关联生成 | P | 📋 | T3.2 | 三身份命中式叙述 |
| T3.4 | 「上手试试」真实调研 + 链接校验 | P | 📋 | T3.2 | 禁瞎编；仅放已验证官方源 |

## Phase 4 · 推送层

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T4.1 | 发布闸门（staged→isCurrent 指针） | I | 📋 | T1.4 | §5.9 |
| T4.2 | 订阅通知（微信订阅消息/服务通知） | D | 📋 | T4.1 | 合规首屏勾选 |
| T4.3 | 情报首页/详情/状态三件套真实页面 | D | ✅ | UI 规范 | 12 文件已落地 `pages/intel/` |
| T4.4 | 「我的」页（信源/画像/推送档位） | D | 📋 | T5.1 | FAB 落地页 |

## Phase 5 · 初始化与画像

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T5.1 | 初始化引导（身份/领域/深度/合规） | D | 📋 | T0.4 | 合规勾选前置 |
| T5.2 | 画像存储 + 修改 | P | 📋 | T5.1 | `intel_profile` 集合 |

## Phase 6 · 联调与校验

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T6.1 | 端到端联调（抓取→处理→推送→小程序） | I/A/P/D | 📋 | 全前序 | — |
| T6.2 | Q 交叉校验 + 隔离红线审计 | Q | 📋 | T6.1 | INTEL-BRIDGE 可摘除验证 |

## Phase 7 · 文档与交付

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T7.1 | 文档同步 Notion 收口 | K | ✅ | — | 9 文档已同步 + 守护 |
| T7.2 | 代码实时同步 GitHub | I/O | ✅ | — | 已推送 `One-News` 仓库 `intel-officer` 分支 + git 守护每 60s 自动同步 |

---

## 关口检查记录（Gate Check）

| 关口 | 结果 | 检查人 | 日期 | 说明 |
|---|---|---|---|---|
| Phase 0 → Phase 1 | ✅ | O | 2026-08-18 | 协作机制五件套落盘后通过 |
| Phase 1 → Phase 2 | ✅ | O | 2026-08-18 | T1.1–T1.4 全 ✅；25 源权威清单 O 裁决对齐（A9/B4/C6/D2/E1/F3） |

- T1.4+ **方案 A 增量兜底**（08-19）：rss/news 分支按 lastSuccessCursor→sinceMs 过滤，单源本轮限 30 条，防旧文淹没。提交 `d49441f`。
