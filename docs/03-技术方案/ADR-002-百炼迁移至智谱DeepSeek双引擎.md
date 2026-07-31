# ADR-002：百炼迁移至智谱+DeepSeek 双引擎

## Status
Accepted（2026-07-31）

## Context

### 问题
1. 天行数据（原 L1）和聚合 Juhe（原 L4）的新闻质量不令人满意
2. 百炼 DeepSeek（原 refreshNews 引擎）的 `DASHSCOPE_API_KEY` 被搁置，导致 refreshNews 长期失败、L3 云库缓存空窗、降级链退化为 L1→L4→L5
3. 需要寻找免费的、支持联网搜索的大模型替代百炼

### 约束
- 微信云开发环境，仅支持 Node.js 云函数
- 必须国内直连（小程序用户无需翻墙）
- 必须支持**联网搜索**能力（非纯文本生成）
- 成本可控（免费优先）

## Decision

**采用智谱 GLM-4-Flash 作为 refreshNews 主力搜索引擎，DeepSeek API 作为降级备选。**

### 新降级链

```
L1 news_cache (智谱 refreshNews 每小时生成, 15条/分类)
  │ 空/过期
L2 天行 API（降级备选）
  │ 失败
L3 聚合 Juhe（进一步降级）
  │ 失败
L4 内存缓存
  │ 未命中
L5 AI 静态兜底
  │ 空
ALL_DOWN
```

### 对比

| 维度 | 旧方案（百炼） | 新方案（智谱+DeepSeek） |
|------|:---:|:---:|
| 主力引擎 | 百炼 DeepSeek v3.2 | 智谱 GLM-4-Flash |
| 降级引擎 | 无 | DeepSeek API |
| 免费额度 | 按量付费 | 智谱永久免费 + DeepSeek $5 赠送 |
| 每条字数 | 5 条/分类 | 15 条/分类 |
| 刷新频率 | 3 班/天 | 每小时 |
| L1 数据源 | 天行 API | news_cache（智谱生成） |

### 替代方案评估

| 方案 | 评估 |
|------|------|
| 百炼 only（旧） | Key 搁置，不可用 |
| 智谱 only | 无降级，单点故障风险 |
| DeepSeek only | 免费额度有限（~50次/天），不够 24×5 分类 |
| **智谱+DeepSeek 双引擎（选定）** | 智谱主力免费 + DeepSeek 降级兜底，最佳性价比 |

## Consequences

### 获得
- ✅ 新闻质量提升：大模型联网搜索生成，比天行 API 聚合更灵活
- ✅ 零成本：智谱永久免费，DeepSeek 仅降级时消耗
- ✅ 高频刷新：每小时更新，新闻时效性大幅提升
- ✅ 双引擎冗余：智谱失效时自动切 DeepSeek

### 放弃
- ❌ 百炼集成：`llmSearch.js` 不再使用（保留文件不删，避免回滚重建）
- ❌ 天行实时性：L1 从"实时 API"变为"缓存"，延迟可达 60min
- ❌ 简单性：双引擎增加了配置和运维复杂度

### 需要配合
- 云函数环境变量新增 `ZHIPU_API_KEY` + `DEEPSEEK_API_KEY`
- refreshNews 定时触发器改为每小时（cron: `0 * * * *`）
- 需要重新部署 `refreshNews` + `getNewsList` 两个云函数

---

> **决策者**：技术负责人 + 用户 | **日期**：2026-07-31 | **Supersedes**：无（新增 ADR）
