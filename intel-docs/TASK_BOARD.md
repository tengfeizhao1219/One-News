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

## Phase 8 · 周报（规划中，owner 拍板后实施）

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
| T8.1 | 周报功能（intelWeekly）——独立周报推送，含：① 本周重点回顾（high 相关条目主题聚合）② 可试用清单复盘（勾选完成/效果）③ 趋势洞察（高频关键词/主题统计）④ 数据质量周报（各源抓取成功率/过滤/聚合拦截统计，反哺源管理）。实现：intelWeekly 云函数 + 周一定时器 + brief 渠道扩展（owner 2026-08-19 记录待办，后续迭代） | P/D/I | 📋 | 稳定版上线后 | 待 owner 确认推送方式与形态 |

---

## Phase 2+ · 源扩展与质量治理（owner 2026-08-20 需求，调研中）

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
| T2.6 | 源扩展调研（中文源 + 主流 AI 厂商官方 + 博客/社区） | A/K | 🔄 | 信息源调研 | ① 中文：AI 厂商官方（阿里通义/字节豆包/百度文心/腾讯混元/智谱/MiniMax/Kimi/面壁/阶跃）+ 中文媒体/社区 ② 英文：xAI/Stability/Perplexity/Cursor 等官方 + 博客/社区；输出源清单（类型/URL/语言/频率/建议）待 owner 确认后接入 |
| T2.7 | 源质量评分治理：一周抓取质量分驱动禁用不合格源（quality<6 自动停用已有，需输出周度评分报告供人工确认） | Q/I | 📋 | T2.6 | 现有 qualityScore 机制已运行，需形成「源健康周报」定期人工复核 |
| T2.8 | 抓取非 token 化：抓取层保持零 LLM（RSS/API/scrape/工具链），仅 intelProcess 处理用 LLM（现状已满足，需审计确认无 LLM 抓取路径） | I | ✅ | — | 审计通过：intelRssPoll/intelFetch/contentFetcher 零 LLM 调用 |
| T2.9 | **源接入执行计划（12:00 后逐步接入，owner 2026-08-20）**：第一批中文官方 6 源（通义千问 qwenlm.github.io/blog、智谱 zhipuai.cn/zh/research、火山引擎 volcengine.com/news、腾讯混元 hunyuan.tencent.com、MiniMax minimaxi.com/blog、Kimi moonshotai.github.io——均已测 200 可抓，写 scrape adapter）；第二批英文（xAI/Mistral/Perplexity/Cursor/Ollama + 聚合 RSS alan-turing-institute/ai-rss-feeds 的 Ai2/Mistral/Cohere/Turing 等，RSS 优先）；恢复 VentureBeat。翻译：profile.langPref=zh 已生效（英文按中文为主），强化 prompt 全部译中 | A/I | 📋 | T2.6 ✅ | 页面可抓性已测全 200；聚合 RSS feeds.opml 200 可用；12 点后分批：注册源→部署→验证 |
| T2.10 | **社区源接入（owner 2026-08-20，符合各自要求前提下）**：中文——V2EX AI（公开 API v2ex.com/api/topics/show.json?node_name=ai，零成本合规，高）、掘金 AI（API，限频）、知乎 AI 话题（反爬严，仅热榜 API 谨慎）；英文——Reddit r/LocalLLaMA + r/MachineLearning（公开 .rss 端点，低频率合规，AI 正向关键词过滤）、LessWrong（RSS，低）；注意各自 robots/API 政策与限频，抓取频率控制（不触发反爬）；放弃即刻（App 不可抓） | A | 📋 | T2.9 后 | 每源接入前复核合规要求；V2EX/Reddit 优先 |

---

## 关口检查记录（Gate Check）

| 关口 | 结果 | 检查人 | 日期 | 说明 |
|---|---|---|---|---|
| Phase 0 → Phase 1 | ✅ | O | 2026-08-18 | 协作机制五件套落盘后通过 |
| Phase 1 → Phase 2 | ✅ | O | 2026-08-18 | T1.1–T1.4 全 ✅；25 源权威清单 O 裁决对齐（A9/B4/C6/D2/E1/F3） |

- T1.4+ **方案 A 增量兜底**（08-19）：rss/news 分支按 lastSuccessCursor→sinceMs 过滤，单源本轮限 30 条，防旧文淹没。提交 `d49441f`。

---

## Phase 9 · 关注后续后端（§九，owner 2026-09-01 确认方案后实施）

| ID | 任务 | 角色 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T9.1 | `follow_up` 集合（按 openid+module+itemId 幂等 upsert，软删除保留历史） | Auto | ✅ | owner 确认「全量增量同步」 | 集合已建（2026-09-01 16:xx） |
| T9.2 | `syncFollowUp` 云函数（关注/取消/进入关注页增量同步 + get 拉取 updates） | Auto | ✅ | T9.1 | 已部署；OPENID 链路待真机验证 |
| T9.3 | `followUpCheck` 云函数（定时按 trackTime 检索：Tavily 主 + 智谱兜底 + DeepSeek 判新/摘要） | Auto | ✅ | T9.1 + env keys | 已部署 + 4 定时器（08/12/18/21 北京）；实测检索链路通（DeepSeek 话题产出 4 来源摘要） |
| T9.4 | 前端接线：detail×2 关注/取消同步 + followup-card 进入拉取合并（`utils/followUpSync.js` + `mergeUpdate`） | Auto | ✅ | T9.2/T9.3 | 33/33 单测过；IDE 编译待验证 |
| T9.5 | 真机/模拟器端到端验证（关注→云端→定时检索→红点→已读） | D/Auto | 📋 | T9.4 | 需开发者工具或真机；OPENID 上下文只能真机验证 |
| T9.6 | 可选增强：长按菜单「立即检索最新进展」（force 单话题）+ 微信订阅消息推送 | D/Auto | 📋 | 稳定后 | 站内红点先行（owner 已确认本期不做订阅消息） |
