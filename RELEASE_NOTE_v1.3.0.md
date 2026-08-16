# One News · Release Note v1.3.0

> 发布日期：2026-08-16 ｜ 上一版本：v1.2.1 ｜ 类型：Major ｜ 跨度：2026-08-10 → 08-16（100+ 个 commit）

---

## 🎉 新功能

1. **官方源 RSS 全栈直连（#35 落地）** — 新增 `rssFetcher` 服务端全栈 + `feed_meta` 种子数据（24 条启用源白名单），覆盖中新/人民/央视/新华等官方媒体，按 owner 白名单只接非敏感类，版权红线贯彻（不抓/不缓存正文、跳源站 H5）。同步部署诊断脚本 `diag-compliance.mjs`
2. **新闻生产流水线重构** — 新增 `newsFetcher`（统一源抓取，23 源扇出）+ `newsPipeline`（队列解耦：抓取 → 质量门控 → AI 摘要/解读 → 落库）两级流水线，替代单函数 refreshNews；前端下拉刷新改调 `newsFetcher` 分批增量刷新（先快返回 + 逐条写库 + getNewsDelta 短轮询），`refreshNews` 退役
3. **「一页说」AI 独立观点卡** — 后端返回独立 `aiOpinion` 字段，前端在详情页以独立观点卡呈现（owner 8/12 拍板方案 C→B 引用块落地），附「一页说」说明入口；AI 解读按原文长度伸缩（上限约 600 字）+ 详情页解读区排版精修
4. **多维质量评分体系** — 落地 `qualityScorer` 质量评分 + FinalScore 质量排序（getNewsList v7.2 接入）+ `qualityGate` 质量门 + 读法路由 `interpretLens`（按 qualityScore 路由，破解读固化、选择性生成「一页说」）；接回 Stage1 质量评分+门控
5. **全源 AI 摘要 + 解读覆盖** — 统一源抓取模块后对所有源跑 AI 摘要 + AI 解读；AI 摘要比例阈值 0.3→0.2 放宽（owner 8/12 拍板方案 B）；官方源详情页展示 AI 解读正文 + 官方源不受最低条数门槛限制；处理后删除源站原文（落库只保留 AI 产物）
6. **详情页合规改造 v1.3（B-COMPLIANCE-1 全套）** — R1/R3/R4/S1 后端必做 4 项 + R5/R6/S3/S4/S5 前端接入，`r1Blocked` 标识 + 查看原文入口 + 来源归因，A 分类违规源不上详情页
7. **数据源架构调整** — recommend 改接官方 RSS 要闻精选（owner 选项 A，仅放行可抓正文 ≥200 字条目）；聚合 API 与官方 RSS 合并为单一处理链路；接入 4 个低风险科技媒体 RSS 源；分类映射重构（sports 改名「科学探索」、recommend 多源综合新闻、体育源并入推荐）
8. **详情页官方源「出处 ↗」归因块** — 来源名并入元信息行 + 克制「可溯源」中性小标；来源条 fixed 常驻视口底部
9. **列表翻页交互（swipe 引擎）** — 翻页引擎重构：动画重排（先滚动归位→换内容→再滑入）、transform 与 scroll 解耦、刷新回调接线（后台全文刷新可触发）
10. **凌晨静默时段（quiet-hours）** — 每日 01:00-05:00 不抓取、不跑 AI，节省配额与资源（owner 2026-08-16）
11. **新闻新鲜度门禁 + 缓存衰减** — 过时新闻按新鲜度评分门禁，缓存按衰减淘汰（owner 2026-08-16）
12. **AI 阶段准入按评分排序** — pipeline AI 阶段准入门槛 + 每类 47 条硬上限截断改为**按评分排序择优**（owner 2026-08-16 决策），保证留下的都是高质量内容

## 🐛 修复

1. **官方源正文 GBK 乱码** — 央视网等 GBK 旧站：`contentFetcher` / `getNewsDetail` 两处 `fetchWebPage` 各加自包含 `decodeBuffer`（BOM → `<meta charset>` 探测 → 响应头 → `TextDecoder('gbk')`/iconv-lite → UTF-8 兜底），正文不再 Mojibake
2. **详情页时间 `NaN月NaN日`** — 写入端/读取端统一 `publishTime || pubDate` 时间字段归一化 + 前端 `formatRelativeTime` 日期合法性校验（非法返回空串），根治时间错乱
3. **新闻重复落库（多轮根治）** — ① newsFetcher id 统一为 urlFp；② newsPipeline 按 dedupKey（link/标题）upsert 去重 + 同批次内存去重；③ 补 TTL 物理清理（删 >7 天留存）+ 跨批次竞态去重兜底；④ getNewsList 加服务端去重（按 sourceUrl/标题每组只留一条），斩断用户可见重复链路
4. **category 硬上限收敛（方案A）** — 单轮 AI 量由 ~200 条收敛到每类硬上限（recommend ≤15 / 其余 ≤8）+ publish 末端兜底，端到端 cache 精确 47 条
5. **官方 RSS 孤儿分类被丢弃 bug** — recommend 白名单误杀修复；http 源 `channel.title.trim` 崩溃修复；官方 RSS 源不受最低条数门槛
6. **AI 解读链路修复** — AI 解读 ≈ 摘要根因（读法路由改 qualityScore + 超时/门槛放宽 + 速览补解读）；AI 解读半开连接挂起（独立强制超时兜底）；juhe 大面积无 AI 解读根因（三方源正文补全）
7. **前端丢字段导致官方源标记/一页说观点卡不渲染** — `formatNewsItem` 补透传官方源/观点字段
8. **详情页数据断链** — 当前新闻强制走 `getNewsDetail`（R2）；AI 解读徽标 / 查看原文 / 时间元信息修复（D-04 v0.2 + D-02 v0.2）
9. **首页刷新假提示** — 顶部下滑真刷推荐分类 + 翻底提示诚实化
10. **兜底页文案** — 数据库空时「极简新闻速览…值得关注的新闻」更新为「极简资讯速览…值得关注的资讯」
11. **阶段A 诊断 P0/P1 止血修复（14 项，2026-08-16）** — feedback 列表/创建、阅读引擎、首页、newsFetcher/newsPipeline 健壮性、内容抓取编码等 14 处根因修复
12. **AI 摘要/解读覆盖率再优化（2026-08-16）** — staging 批次处理与降级链优化，进一步提高摘要/解读覆盖
13. **公共层去重 + 健壮性加固** — validator→fingerprint 能力迁移、CI 工作流接入、feedback 等云函数统一模板

## 🔧 工程化 / 稳定性

- **修复 tcb 部署通道（ROOT CAUSE 级）** — 新增 `cloudbaserc.json`（`functionRoot: cloudfunctions`）根治「deploy 显示成功但跑旧代码」；部署金标准验证改为下载云端代码比对（不信 deploy 日志路径）；遇网关 API 冲突改 `code update` 通道绕过
- **敏感词合规分软/硬黑名单** — ⑥ 合规拆分为软/硬两级，硬黑名单接早先整理的敏感词汇过滤表，接入公共层 `common/` 统一维护入口
- **云环境隔离** — 前端按运行身份路由 prod/preview 环境
- **AI 引擎降级链补全** — 混元降级到最后一位（外部 Key 链优先）；为全部引擎补全失败原因日志（降级诊断闭环）
- **完整可观测性** — 正文补全日志附 source 字段；混元解读成功日志补充，消除降级盲区
- **cloudbaserc 补全 9 个活跃函数部署清单 + newFetcher hourly 定时器** — 部署清单对齐云端现状，运行时统一（pipeline=Nodejs18.15，其余=Nodejs16.13），最小变更避免抖动
- **索引管理规范化** — 移除 initSchema 无效 createIndex 调用（wx-server-sdk 4.x 不支持），news_cache 5 个索引改由控制台/tcb 管理
- **CI 工作流接入**（.github/workflows/ci.yml）

## 📋 部署需知

- **云函数需重新部署**（本次含新增/重构云函数）：`newsFetcher`、`newsPipeline`、`rssFetcher`、`getNewsDelta`、`initSchema` 为本次新增/重构，已补全 9 个活跃函数部署清单 + `newsFetcher` hourly 定时器；`refreshNews` 已退役（不再抓取，可保留空壳或下线）；存量 `getNewsList` / `getNewsDetail` 需更新
- **运行时对齐**：pipeline=Nodejs18.15，其余函数=Nodejs16.13（cloudbaserc 已对齐云端现状）
- **新增集合/数据**：`news_ingest`（共享底座）、`news_raw_official`、`news_raw`、`news_staging`、`news_cache`（流水线产物表）；`feed_meta` 种子需导入（24 源）；`news_cache` 5 个索引由控制台/tcb 管理（wx-server-sdk 4.x 不支持代码内建索引）
- **环境变量**：聚合源 `TIAN_API_KEY` / `JUHE_API_KEY` 必须注入 `newsFetcher` / `newsPipeline` 运行环境，否则聚源全降级为官方 RSS（juhe 有日配额，耗尽优雅跳过次日志恢复）
- **定时任务**：`newsFetcher` hourly 定时器（含凌晨 01:00-05:00 静默）、`newsPipeline` 定时器
- **敏感词表**：合规过滤依赖 `common/` 敏感词表，部署时确保同步
- 前端重新上传发布即可（含本次版本日志更新）

## ✅ 验证

- 详情页合规 v1.3 端到端（`5a450a7`）落地
- 方案A 端到端干净全量抓：cache 恰 **47 条**（精确卡上限），≤47 PASS
- 去重多轮验证：cache 41 条、四类重复组全 0、过期 0；getNewsList 服务端去重兜底用户可见路径
- AI 解读覆盖率优化验证：ai_interpretation 7.4% → 59%（常规源 178 中 105 带正文），带「一页说」共 90 条；剩余由混元 429 硬瓶颈限制，非代码截断
- 保正文兜底验证：干净重抓 108 条 content 空 = 0（0.0%），contentSource = ai_summary 99 + ai_interpretation 9
- 分类契约一致性测试（QA-B2 / v11-category-contract）+ FE 暗色可见性契约（v13）+ 云函数单元测试（b10）在案
