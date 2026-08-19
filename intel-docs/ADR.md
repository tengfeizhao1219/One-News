# ADR · AI 情报官架构决策记录（Decision Log）

> **目的**：owner 拍板与关键技术决策的结构化存档，决策可追溯。
> **规则**：owner 拍板 → O 当次记录（日期/决策/理由/备选/影响）。
> 本库由 ai-collab v2 升级时（2026-08-19）从 COMMLOG/文档历史提炼，后续由 O 维护。

---

## ADR 列表

| 编号 | 日期 | 决策 | 状态 | 关联 |
| ADR-1 | 2026-08-18 | 采用「文件即通信」多角色协作机制（O/I/A/P/D/Q/K） | ✅ | AI情报官_协作机制.md |
| ADR-2 | 2026-08-18 | 25 源权威清单：A9/B4/C6/D2/E1/F3（剔 semianalysis/one_useful_thing，补量子位+公众号） | ✅ | 信息源调研 |
| ADR-3 | 2026-08-19 | 固定节点（05/11/18）无条件抓 + RSS 增量兜底（方案 A） | ✅ | TASK_BOARD T1.4 |
| ADR-4 | 2026-08-19 | 数据质量闸门 ④.5：definition 必填，空则 rejected 留痕 | ✅ | intelProcess |
| ADR-5 | 2026-08-19 | main 为规范分支，intel-officer 退役并入 main | ✅ | 部署注意事项 |
| ADR-6 | 2026-08-18 | 巡检频率 05:00/11:00/18:00（决策 21） | ✅ | 设计 §5.9/§7.3 |
| ADR-7 | 2026-08-18 | 公众号合规本地解析（SQLite 首选，不接 RSSHub/网页抓取） | ✅ | 调研 §5 |
| ADR-8 | 2026-08-18 | LLM 走独立 intelProcess 云函数 + 独立 Key（分账核算） | ✅ | 设计 §4 |
| ADR-9 | 2026-08-19 | 反爬 UA 策略（marktechpost 403）——待 owner 定 | 🔄 | T2.2 |

---

## ADR 详情

### ADR-1 · 采用多角色协作机制

- **日期**：2026-08-18
- **决策**：项目由 AI 多角色协作完成（O/I/A/P/D/Q/K），沟通介质为约定文件（无 IM、无会议），owner 仅拍板与提供凭证。
- **理由**：AI 会话无持久记忆；One News 项目已验证「文件即通信」框架可行。
- **备选**：单会话全程（上下文会耗尽）。
- **影响**：全员遵守 Git 纪律与文件更新规则；新会话先读五件套。
- **记录人**：O

### ADR-2 · 25 源权威清单对齐

- **日期**：2026-08-18
- **决策**：信源按 A9/B4/C6/D2/E1/F3 共 25 源定稿；剔除 semianalysis、one_useful_thing，补量子位 + 公众号；id 统一下划线，seedSources 与 manifest 100% 一致。
- **理由**：调研阶段 25/25 源实测可用；O 裁决解决 A 角色与调研文档的数量分歧。
- **影响**：T2.x 适配器、seedSources、manifest 三处数据源必须一致（check 项）。
- **记录人**：O / Q

### ADR-3 · 固定节点无条件抓 + RSS 增量兜底

- **日期**：2026-08-19
- **决策**：定时器（05/11/18）一到即抓全部启用源，不看 lastFetchTime/pollSeconds 间隔；rss/news 分支按 lastSuccessCursor→sinceMs 只收增量，单源限 30 条。
- **理由**：固定节点保证准时性；增量防旧文淹没新文、空烧 LLM。
- **备选**：按轮询间隔抓（准时性差）；全量重抓（空烧 LLM）。
- **影响**：intelRssPoll listDueFeeds→listEnabledFeeds（提交 d85ae00）；增量过滤（提交 d49441f）。
- **记录人**：O

### ADR-4 · 数据质量闸门 ④.5

- **日期**：2026-08-19
- **决策**：intelProcess 写 staged 前强校验 parsed.definition 必填，空则 markIngest rejected{reason:'definition-empty'}；intelDispatcher 降级剔除双保险。
- **理由**：根治「定义待补充」占位卡，源头拦截低质产出。
- **影响**：staged 只收高质量条目；rejected 留痕可复盘（提交 9d6e8e9）。
- **记录人**：O

### ADR-5 · main 为规范分支

- **日期**：2026-08-19
- **决策**：owner 拍板「main 为规范分支」，intel-officer 独有内容并入 main 后分支退役。
- **理由**：单一事实源；feature 分支长期存活导致多副本同步混乱。
- **影响**：后续所有改动基于 main；微信开发者工具导入分支选 main。
- **记录人**：O

### ADR-9 · 反爬 UA 策略（待定）

- **日期**：2026-08-19
- **决策**：marktechpost 对 worker 的 IntelOfficer bot UA 返 403，浏览器 UA 则 200+br。
- **状态**：🔄 待 owner 定 UA 策略（影响 T2.2 该源可抓性）。
- **备选**：① 浏览器 UA（合规风险待评估）；② 换源；③ 降频。
- **记录人**：A
