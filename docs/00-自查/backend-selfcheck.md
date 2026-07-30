# 后端职责自查（任务 A-06）

> **角色**：后端开发 [BE] ｜ **日期**：2026-07-30 ｜ **模式**：即席/直连（不占用当前棒，主线仍为 PM/阶段一）
> **范围**：`cloudfunctions/`（getNewsList 五层降级 / getNewsDetail / common/* / refreshNews）、数据源（天行+聚合+云库+AI 兜底）、接口稳定性
> **依据**：`CONTEXT.md`、`TASK_BOARD.md`、`cloudfunctions/` 全量代码、`docs/04-开发实现/`（既有测试报告）

---

## ① 不完善（逻辑健壮性缺口）

### 降级链降级盲区（最严重）
- **L2 内存缓存从未写入（确定性失效）**：`getNewsList` 的 L2 路径仅 `cache.get(memoryKey)`，全文件无任何 `cache.set`，L2 永远 miss，直接跳过进 L3。
- **L3 云库缓存数据源已停用（确定性失效）**：L3 读取的 `news_cache` 由 `refreshNews` 写入，而 `refreshNews` 依赖**已搁置的百炼 Key** → `news_cache` 长期为空/过期 → L3 实际不工作。
- **双集合分裂**：`news`（供 `getNewsDetail`，由 L1 成功后 `syncNewsToCollection` 写入）与 `news_cache`（供 L3，由 `refreshNews` 写入）两套管道无同步，L1 成功结果不回流 L3。
- **实质降级链 = L1(天行) → L4(聚合) → L5(AI 静态)**，L2/L3 名存实亡。

### 请求层健壮性
- **超时未 abort 底层 socket**：`tianApi`/`juheApi` 超时仅 `reject`，未 `req.destroy()`，存在连接泄漏风险。
- **无响应体大小上限**：API 封装未限制下载字节（`contentExtractor` 自身有 2MB 上限，但 API 层没有）。
- **HTTP 非 200 未处理**：不检查 `res.statusCode`，429/500 仍尝试 `JSON.parse`，可能误判为 `API_INVALID_RESPONSE`。

### 类型 / 逻辑 bug
- **`tianApi` 的 `result.code === 200` 严格相等**：天行若返回字符串 `"200"` 会误判为错误 → L1 主源偶发失败、频繁降级。应宽松比较 `Number(result.code) === 200`。

### 重试策略缺陷
- **`callWithRetry` 不区分错误类型**：对 `API_KEY_INVALID`/`API_RATE_LIMIT` 等不应重试的错误也重试，浪费配额与延迟。

### 限流缺失
- **无全局限流/退避**：天行免费版有每日/每分钟配额，聚合有 QPS 限制，高并发或多分类轮询易触发次数不足（150）频繁降级。

### 首屏性能
- **`enrichMissingSummaries` 阻塞主响应且并发无控**：对缺摘要条目并发抓外站正文（每条 3s 超时），最坏延迟 ≈ 3s×批次，直接拉长首屏。

### 缓存无淘汰
- **`cache.js` 的 Map 无 LRU/最大条目限制**：`category × page` 组合持续累积，`_store` 无限增长，云函数实例内存有限，有内存膨胀风险。

---

## ② 遗留事项

### 降级盲区
- L2 内存缓存功能性失效（无 `set`）；L3 云库缓存数据源（百炼）停用，L3 实际不工作；`news`/`news_cache` 双集合分裂，L1 结果不回流 L3。

### 密钥安全
- ✅ 三套 Key（天行 `TIAN_API_KEY` / 聚合 `JUHE_API_KEY` / 百炼 `DASHSCOPE_API_KEY`）均从环境变量读取，无硬编码；天行 Key 日志已脱敏（`***`）。
- ⚠️ 百炼 Key 已搁置，但 `refreshNews` 仍尝试调用 → 每次产生 `LLM_SEARCH_FAILED` 无谓失败与日志噪音，建议搁置期显式短路。

### 未覆盖异常
- **云函数层零单元测试**：现有 `docs/04-开发实现/单元测试报告.md` 仅覆盖 `utils/`（22 用例），`cloudfunctions/` 下降级链、分类映射、摘要兜底、正文抽取等核心逻辑**无任何单测保护**。
- 上述类型比较、socket 未 abort、响应无上限、重试不分类型、无限流、无并发控制、缓存无淘汰等均未处理。

---

## ③ 待做（建议新增任务，B-新序号从 B-08 起；后端可直接接手项已标注 ✅）

| ID | 任务 | 优先级 | 接手方 | 建议方案 |
|----|------|--------|--------|----------|
| **B-08** | 修复 L2 内存缓存写入缺失 | 🔴 | ✅ 后端 | `getNewsList` L1 成功后 `cache.set(memoryKey, data, {ttl})` |
| **B-09** | 重建 L3 云库缓存数据源（news_cache 依赖百炼已搁置） | 🔴 | ⚠️ 需 TL+产品决策 | A 恢复百炼；B 让 L1 天行结果同步写 `news_cache`；**建议 B** |
| **B-10** | 云函数层单元测试补全 | 🔴 | ✅ 后端（B-04 子项） | 为 adapter/降级链/contentExtractor/enrichMissingSummaries 补单测 |
| **B-11** | 修复 tianApi `code===200` 类型 bug + HTTP状态码/超时abort/响应上限 | 🔴 | ✅ 后端 | 宽松比较；检查 statusCode；`req.destroy()`；加响应上限 |
| **B-12** | 接入限流/退避（额度保护） | 🟡 | ⚠️ 需 TL 定策略 | 令牌桶或按分钟计数，超限走降级 |
| **B-13** | 百炼 Key 搁置期 refreshNews 显式短路 | 🟡 | ✅ 后端 | apiKey 为空直接返回，消除无谓失败 |
| **B-14** | enrichMissingSummaries 并发控制 | 🟡 | ✅ 后端 | 批次并发限制或首屏返回后异步补摘要 |

**范围内能直接接手**：B-08 / B-10 / B-11 / B-13 / B-14。
**需升级决策**：B-09（架构）、B-12（策略）、百炼是否恢复（产品）。

**最优先**：B-08（确定性 bug、一行修复、零争议、立即补强降级链）；B-11（威胁 L1 主源稳定性）紧随。
