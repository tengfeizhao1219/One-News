# 会话沟通记录（Communication Log）

> **用途**：每个会话结束时的交接记录。按时间倒序排列。
> **格式**：时间戳 + 会话标识 + 完成内容 + 变更文件 + 遗留问题 + 注意事项。

---

## [2026-07-30] 后端数据层现状自查（即席） | 会话：[BE] 后端开发

### 做了什么
- 即席自查：读 CONTEXT.md 及 cloudfunctions/ 全量代码（getNewsList/getNewsDetail/common/*、refreshNews），核对五层降级链健壮性、超时、限流、密钥安全、错误捕获
- 输出《后端数据层现状自查报告.md》至 docs/04-开发实现/，梳理不完善项、遗留事项、改进任务
- TASK_BOARD.md 阶段四新增 B-08~B-14（7 个改进任务）

### 产出物清单
| 文件 | 路径 |
|------|------|
| 自查报告 | docs/04-开发实现/后端数据层现状自查报告.md |
| 任务看板 | TASK_BOARD.md（B-08~B-14） |
| 沟通记录 | COMMLOG.md（本记录） |

### 关键结论
- **降级盲区（确定性）**：L2 内存缓存从未 `cache.set` → 100% 失效；L3 云库缓存数据源 refreshNews 依赖已搁置的百炼 Key → L3 实际不工作；实质降级链退化为 L1(天行)→L4(聚合)→L5(AI)
- **密钥安全**：三 Key 均走环境变量、无硬编码 ✅；但百炼搁置后 refreshNews 仍无谓失败，建议显式短路
- **未覆盖异常**：云函数层零单测（现有 22 用例仅覆盖 utils/）；tianApi `code===200` 类型严格比较潜在误判；超时未 abort socket；无限流/退避；无并发控制；缓存无淘汰

### 给下一棒的提醒
- 最优先修 B-08（L2 写入缺失，一行 cache.set 即可），其次 B-11（tianApi 类型 bug 威胁 L1 主源）
- B-09（L3 数据源切换）需技术负责人+产品决策，后端不擅自改架构
- 修复类（B-08/10/11/13/14）后端可直接接手；决策类（B-09/12）需升级

---

## [2026-07-30] 接力棒机制 | 会话：[主]

### 完成内容
- 新增 RELAY.md 接力棒机制 —— 实现会话间自动推进
- 更新 COLLABORATION.md 加入接力棒流程
- 更新 CONTEXT.md、TASK_BOARD.md 反映最新状态
- 完整流水线：[dev]→[test]→[主]，用户只需说「接棒」

### 变更文件
- RELAY.md — 新建（接力棒核心机制）
- COLLABORATION.md — 加入接力棒规范
- CONTEXT.md — 更新最新提交和协作框架
- TASK_BOARD.md — 增加角色列 + 流水线状态
- COMMLOG.md — 本记录

### 遗留问题
- 无

### 注意事项
- 新会话启动只需说「接棒」或「git pull，读 RELAY.md 接棒」
- 每个会话交付时必须更新 RELAY.md 指向下一棒

---

## [2026-07-29] 数据层三连击收尾 | 会话：[主]（数据层）

### 完成内容
- v11：正文清洗加固（contentExtractor 实体解码 + 噪音过滤 + 首页标题截断）
- v12：聚合（Juhe）L4 降级接入 + 分类透传修复（移除不可靠的 JUHE_TYPE_TO_APP 反向映射）
- v13：卡片摘要补全（空摘要自动抓正文首段兜底 enrichMissingSummaries）+ 标题截断加固（word-break/overflow-wrap + 摘要限 3 段）
- 部署 getNewsList / getNewsDetail 到云端；云端空摘要由 2/10 降至 0/10
- 数据层回归测试 178/178 通过；rebase origin/main 后 push（6b7598f）

### 变更文件
- cloudfunctions/common/contentExtractor.js — 新增 extractSummary
- cloudfunctions/getNewsList/index.js — 新增 enrichMissingSummaries，接入 L1/L4
- cloudfunctions/common/adapter.js — 分类透传，移除 JUHE_TYPE_TO_APP
- cloudfunctions/common/config.js — 聚合配置就绪
- pages/home/home.wxss — 标题截断加固
- pages/home/home.js — 摘要限 3 段
- CONTEXT.md / TASK_BOARD.md / RELAY.md / COMMLOG.md — 修正项目记忆（真实数据接入已落地）

### 遗留问题
- ~~百炼 API Key 轮换~~ — 已搁置（2026-07-30 用户决策）
- 聚合是否作为某分类主数据源 / 开放体育·生活等独立 tab（用户曾问，未决定）
- 前端（home.wxss/home.js）改动需用户在微信开发者工具重新编译预览才生效

### 注意事项
- 标题截断若是仍出现，多半是前端未重新编译（纯前端改动，云端无需操作）
- 如担心聚合 Key 泄露，可在聚合后台重置后重新注入 JUHE_API_KEY 环境变量

---

## [2026-07-28] 框架搭建 | 会话：[主]

### 完成内容
- 建立多会话协作框架（CONTEXT.md + COLLABORATION.md + TASK_BOARD.md + COMMLOG.md）
- 全部 46 个文档迁移到 tdrive 项目资产库
- 项目日志文档创建并上传

### 变更文件
- CONTEXT.md — 新建
- COLLABORATION.md — 新建
- TASK_BOARD.md — 新建
- COMMLOG.md — 新建（本文件）
- docs/项目日志.md — 已上传 tdrive

### 遗留问题
- 详情页阅读模式待开发（T-01）
- home.js 诊断日志待清理（T-05）

### 注意事项
- WXS 必须纯 ES5，参见 CONTEXT.md 关键开发红线
- 新会话启动流程：git pull → 读 CONTEXT.md → 读 TASK_BOARD.md → 认领任务

---

> **下一条记录请追加在上方（时间倒序）**
