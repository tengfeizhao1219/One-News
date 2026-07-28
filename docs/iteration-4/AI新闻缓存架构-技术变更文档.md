# AI 新闻缓存架构 — 技术变更文档

> **迭代**：迭代4（实时新闻）— 架构重构
> **日期**：2026-07-28
> **版本**：v2.0
> **状态**：已完成开发，Mock 回归测试通过

---

## 一、变更概述

将新闻数据源从**外部 API（天行数据 + 聚合数据）** 切换为 **WorkBuddy AI 实时搜索生成的本地 JSON 缓存**，实现零费用、零延迟、零外部依赖的新闻数据架构。

### 变更动机

| 维度 | 旧方案（外部 API） | 新方案（AI 缓存） |
|------|-------------------|-------------------|
| 费用 | 按调用次数收费 | **零费用** |
| 延迟 | 500-2000ms | **0ms（本地）** |
| 稳定性 | 依赖第三方 API | **完全自主** |
| 内容质量 | 不可控 | **可筛选、可编辑** |
| 部署依赖 | 需注册 API Key | **零配置** |
| 数据新鲜度 | 实时 | 日更（手动触发） |

---

## 二、架构对比

### 旧架构

```
小程序 → 云函数 getNewsList
              ├─ 内存缓存
              ├─ 云数据库缓存
              ├─ 天行数据 API（主）
              ├─ 聚合数据 API（备）
              └─ 过期缓存 → 错误
```

### 新架构

```
WorkBuddy AI 搜索
    ↓ 生成
mock/ai-news-cache.js
    ↓ build 脚本
cloudfunctions/common/aiNewsData.js
    ↓ require
aiNewsService.js（查询/搜索/分页）
    ↓
小程序 → 云函数 getNewsList
              ├─ 内存缓存
              ├─ AI 缓存（主，零延迟）
              ├─ 云数据库缓存
              ├─ 天行数据 API（可选降级）
              ├─ 聚合数据 API（可选降级）
              └─ 过期缓存 → 错误
```

---

## 三、文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `cloudfunctions/common/aiNewsService.js` | AI 缓存查询服务：分类过滤、全文搜索、分页、统计 |
| `cloudfunctions/common/aiNewsData.js` | 云函数可加载的 AI 缓存数据（build 脚本生成） |
| `scripts/build-ai-cache.js` | 构建脚本：将 mock 缓存转换为云函数格式 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `cloudfunctions/getNewsList/index.js` | 新增第2层：AI 缓存优先查询，外部 API 降为可选备用 |
| `cloudfunctions/searchNews/index.js` | 新增第2层：AI 缓存全文搜索，外部 API 降为可选备用 |
| `utils/request.js` | Mock 模式切换为 AI 缓存数据源，支持 meta 信息透传 |
| `utils/constants.js` | 新增 AI_CACHE 配置项，USE_MOCK 支持环境变量覆盖 |
| `test/mock-regression.js` | 适配 AI 缓存数据源，新增数据质量验证用例（19条） |
| `docs/SOP-软件开发流程基准.md` | v1.4：新增第十四章 AI 新闻缓存架构规范 |

---

## 四、数据流详解

### 4.1 AI 缓存数据结构

```javascript
// mock/ai-news-cache.js
[
  {
    id: 'ai_tech_001',
    title: 'WAIC 2026世界人工智能大会闭幕...',
    summary: '2026世界人工智能大会（WAIC）于7月22日圆满闭幕...',
    category: 'tech',
    categoryName: '科技',
    source: 'CSDN',
    publishTime: '2026-07-22T16:00:00Z'
  },
  // ... 共 36 条，覆盖 5 个分类
]
```

### 4.2 云函数请求流程

```
getNewsList({ category: 'tech', pageNum: 1, pageSize: 10 })
    │
    ├─ [L1] 内存缓存命中？ → 直接返回 (< 1ms)
    │
    ├─ [L2] AI 缓存命中？   → 返回 aiNewsService.getByCategory() (< 1ms)
    │     ├─ 36条数据中过滤 category='tech' → 8条
    │     └─ 分页：pageNum=1, pageSize=10 → 返回8条
    │
    ├─ [L3] 云数据库缓存？  → 返回（上次 API 的持久化缓存）
    │
    ├─ [L4] 天行数据 API？  → 需要 TIAN_API_KEY
    │
    └─ [L5] 全部不可用      → 返回错误 ALL_DOWN
```

### 4.3 AI 缓存更新机制

```
手动触发（推荐每天一次）:
  用户 → WorkBuddy: "搜索最新新闻更新 AI 缓存"
         ├─ WebSearch: 推荐/科技/体育/国际/生活
         ├─ WebFetch: 提取结构化内容
         └─ 写入 mock/ai-news-cache.js

自动构建:
  node scripts/build-ai-cache.js
         ├─ 读取 mock/ai-news-cache.js
         ├─ 转换为 module.exports 格式
         └─ 写入 cloudfunctions/common/aiNewsData.js

验证:
  node test/mock-regression.js
         ├─ 19条自动化测试
         └─ 全部通过 → 可部署
```

---

## 五、测试结果

### Mock 回归测试（19/19 通过）

```
【场景1】normal — 正常加载 AI 缓存数据    ✅ 6/6
【场景2】搜索功能（AI 缓存）               ✅ 4/4
【场景3】error — 模拟网络错误              ✅ 3/3
【场景4】empty — 模拟空数据                ✅ 2/2
【场景5】slow — 模拟慢网络                 ✅ 1/1
【场景6】AI 缓存数据质量验证               ✅ 3/3
─────────────────────────────────────────────────
总计: 19 条 | 通过: 19 ✅ | 失败: 0 ❌
```

### 模块单元验证

| 模块 | 验证项 | 结果 |
|------|--------|------|
| aiNewsService.getByCategory | 全部分类、分页、边界值 | ✅ |
| aiNewsService.search | 英文/中文关键词、空搜索、无匹配 | ✅ |
| aiNewsService.getById | 存在/不存在的 ID | ✅ |
| aiNewsService.getStats | 版本号、分类计数 | ✅ |
| build-ai-cache.js | 构建成功，36条数据 | ✅ |

---

## 六、部署检查清单

- [x] AI 缓存数据生成（mock/ai-news-cache.js，36条）
- [x] 云函数数据构建（cloudfunctions/common/aiNewsData.js）
- [x] aiNewsService 模块创建并验证
- [x] getNewsList 云函数重写
- [x] searchNews 云函数重写
- [x] request.js 适配 AI 缓存
- [x] constants.js 新增 AI_CACHE 配置
- [x] 模拟器适配
- [x] Mock 回归测试 19/19 通过
- [x] SOP 更新至 v1.4
- [ ] 云函数部署到 CloudBase
- [ ] 真机测试（iOS + Android）
- [ ] AI 缓存首次生产验证

---

## 七、后续优化建议

1. **定时自动更新**：配置 cron job 每天自动触发 WorkBuddy 搜索更新 AI 缓存
2. **增量更新**：只搜索最新一天的新闻，与现有缓存合并去重
3. **内容扩展**：增加更多分类（娱乐、财经、教育等）
4. **图片支持**：在搜索时提取新闻配图 URL
5. **多语言**：支持英文新闻分类
