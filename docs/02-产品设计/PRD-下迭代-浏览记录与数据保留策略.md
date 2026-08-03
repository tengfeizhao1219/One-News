# PRD — 下迭代三需求：浏览记录 / 收藏分享 30 天保留 / 未收藏 7 天保留

> **文档编号**：PRD-N06-N10-N11 | **版本**：v1.0（2026-08-03）
> **作者**：产品经理（PM）| **状态**：✅ 已评审（owner 2026-08-03 18:50 拍板）
> **范围**：RQ-06 浏览记录（增强）/ RQ-16 数据保留策略（30 天 + 7 天）/ RQ-03 收藏上云（增强）/ RQ-07 分享上报（增强）
> **开发执行要求**：全栈开发**必须严格按本文档逐条实现**，含数据模型、接口、清理策略、边界条件；实现偏差需在看板标注说明，不得擅自简化。

---

## 1. 背景与目标

### 1.1 背景

1. **浏览记录缺失**：用户阅读过的新闻无任何痕迹留存，无法"接着看"、无法回溯。
2. **数据保留无分级**：当前 `news_cache` 缓存 TTL 仅 **65 分钟**（`config.cache.dbCacheTTL`），每小时刷新即覆盖；用户**收藏/分享过的新闻也可能被新数据顶掉**，体验与数据安全均不满足。
3. **收藏/分享未上云**：收藏仅存本地 `localCache`（容量 200 条、换设备丢失、与云端数据保留机制完全脱节）；`setNewsRetained` 云函数（B-16）已存在但**标记的是已停写的 `news` 集合，前端从未调用，实际失效**。

### 1.2 目标

| # | 目标 | 验收口径 |
|---|------|---------|
| G1 | 提供「浏览记录」入口，展示近 7 天浏览历史，支持回看 | 记录、展示、去重、过期四项全过 |
| G2 | 用户收藏/分享的新闻在数据库保留 **30 天** | retained 记录 30 天内不被清理 |
| G3 | 未被收藏/未被分享的新闻在数据库最长保留 **7 天** | 普通记录 7 天后被清理 |
| G4 | 收藏上云（多端同步），分享点击即算并上报 | 收藏列表本地+云端一致 |

### 1.3 非目标（本期不做）

- ❌ 浏览记录的跨端实时同步（仅本地为主 + 云端兜底，见 §4.4）
- ❌ 个性化推荐、推送通知
- ❌ 收藏的云收藏列表 UI 重构（本期仅打通数据层，UI 复用现有侧边栏收藏列表）

---

## 2. 现状与差距分析（代码实况，开发必读）

| 项 | 现状 | 差距 |
|----|------|------|
| 主存储 | `news_cache`（refreshNews 写入列表缓存；getNewsList 读取；getNewsDetail 兜底读取） | 无分级保留，TTL 65 分钟 |
| 历史存储 | `news` 集合（v5.1 起不再写入，仅遗留查询） | `setNewsRetained` 标记此集合 = **失效** |
| 收藏 | `utils/localCache.js` key=`favorites`，上限 200，`ttl:0` 永不过期，**仅本地** | 未上云、未关联保留策略 |
| 分享 | `onShareAppMessage` 转发，无成功回调 | 无上报 |
| 保留标记 | `setNewsRetained` 云函数已存在（操作 `news` 集合 `isRetained` 字段） | **需改造为目标集合 `news_cache` 并打通前端调用** |
| 缓存清理 | `clearOldCacheExcept`（刷新时按分类清非 keepIds 记录）+ `renewCacheExpire`（双源失败续期） | 需新增按 `cacheExpire` 分级的定期清理 |

---

## 3. 需求一：浏览记录（RQ-06 增强）

### 3.1 用户故事

> 作为阅读用户，我想在侧边栏看到「浏览记录」，按时间倒序查看近 7 天看过的新闻，并点击回看，这样我不需要记住自己看过什么，也能找回没看完的内容。

### 3.2 功能详述（EARS）

**U1（Ubiquitous）**：THE SYSTEM SHALL 为所有已登录用户提供「浏览记录」入口（侧边栏，与收藏列表同级）。

**E1（Event-driven 记录）**：WHEN 用户进入详情页且新闻加载成功 THEN THE SYSTEM SHALL 将该条记录写入浏览历史：
- 记录字段：`{ id, title, category, categoryName, source, viewedAt }`
- **去重规则**：同一条新闻（按 `id`）重复浏览 **不新增条目**，仅将 `viewedAt` 刷新为最新时间并移到列表首位。

**E2（Event-driven 展示）**：WHEN 用户打开浏览记录页 THEN THE SYSTEM SHALL 按 `viewedAt` 倒序展示记录，每条含标题/来源/浏览时间。

**E3（Event-driven 回看）**：WHEN 用户点击某条浏览记录 THEN THE SYSTEM SHALL 跳转详情页并定位到该新闻（复用 `detailContext` 机制）。

**S1（State-driven 过期）**：WHILE 记录存在且其 `viewedAt` 距今超过 **7 天** THEN THE SYSTEM SHALL 不再展示该记录，并在下一次写入时惰性清除。

**W1（Unwanted 空态）**：IF 近 7 天无任何浏览记录 THEN THE SYSTEM SHALL 展示空态文案「暂无浏览记录」及引导（去首页看看）。

**W2（Unwanted 存储异常）**：IF 本地写入失败（Storage 超限）THEN THE SYSTEM SHALL 降级为仅内存记录，并静默重试一次；不得中断阅读流程。

### 3.3 交互细节

| 项 | 规格 |
|----|------|
| 入口 | 侧边栏「浏览记录」条目（图标 🕘，位于收藏列表上方或同级） |
| 页面路由 | `pages/history/history`（新增页面，注册于 `app.json`） |
| 列表样式 | 与收藏列表同构：标题（2 行截断）+ 来源 + 相对时间（今天 HH:mm / 昨天 / N 天前） |
| 容量上限 | 本地 200 条（LRU，超出淘汰最旧） |
| 时间窗口 | 7 天（`7 * 24 * 60 * 60 * 1000` ms） |

### 3.4 数据模型

**本地**（`utils/localCache.js`，key=`browseHistory`）：
```js
[{
  id: 'news-abc-123',        // 新闻唯一 id（与 news_cache.id 一致）
  title: '标题',              // 展示用（快照，即使云端已删仍可显示）
  category: 'tech',          // 分类 id
  categoryName: '科技',       // 分类名快照
  source: '新华社',           // 来源快照
  viewedAt: 1725270000000    // 浏览时间（去重时刷新）
}]
```

**云端兜底**（集合 `browse_history`，按 openid 维度）：
```js
{
  _openid: 'oXXXX',          // 微信 openid（云开发自动注入）
  newsId: 'news-abc-123',
  title: '标题', source: '新华社',
  viewedAt: 1725270000000,   // 浏览时间
  expireAt: 1725270000000 + 7*24*3600*1000  // 7 天后过期
}
```

**同步策略（本地为主 + 云端兜底）**：
1. 浏览记录页打开时：**先展示本地数据（秒开）**，同时拉取云端 `browse_history`（按 openid）合并去重（以 `viewedAt` 最新者为准），静默更新。
2. 每次浏览写入：本地必写；云端**异步上报**（失败静默，下次打开重试），不阻塞阅读。

### 3.5 边界与异常

| 场景 | 行为 |
|------|------|
| 同一新闻连续快速进入 N 次 | 仅 1 条记录，viewedAt 取最后一次 |
| 新闻已被云端清理（>7 天） | 本地快照仍可显示标题/来源，点击回看 → 详情页展示「新闻已失效」兜底 |
| 本地 200 条满 | LRU 淘汰最久未浏览条目 |
| 弱网/断网 | 本地照常记录展示；云端同步延迟到有网 |

---

## 4. 需求二：收藏/分享的新闻保留 30 天（RQ-03/RQ-07/RQ-16）

### 4.1 用户故事

> 作为用户，我收藏或分享的新闻，希望 30 天内随时能打开看，不被系统自动清理。

### 4.2 收藏上云（RQ-03 增强）

**U2（Ubiquitous）**：THE SYSTEM SHALL 将用户收藏行为同步至云端（按 openid 维度），本地 `favorites` 列表继续作为展示与离线兜底。

**E4（Event-driven 收藏）**：WHEN 用户点击收藏（♡→♥）THEN THE SYSTEM SHALL：
1. 本地写入 `favorites`（现状逻辑保留）；
2. **调用云端 `setUserFavorite({ newsId, title, category, categoryName, source, picUrl, favorited: true })`**；
3. 同时调用 **`setNewsRetained({ newsId, retained: true })`** 将该新闻标记为 30 天保留；
4. 任一云端调用失败：本地收藏成功、**toast「已收藏（待同步）」**，进入待同步队列下次重试（队列容量 50，超限丢弃最旧）。

**E5（Event-driven 取消收藏）**：WHEN 用户取消收藏（♥→♡）THEN THE SYSTEM SHALL 调用 `setUserFavorite({ newsId, favorited: false })` 删除云端收藏记录；本地同步移除。**注**：取消收藏**不**自动取消 retained（该新闻可能被其他用户收藏/分享，见 §4.4）。

**S2（State-driven 多端同步）**：WHEN 小程序启动/侧边栏收藏列表打开 THEN THE SYSTEM SHALL 拉取云端收藏列表，与本地合并（以云端为准，本地缺失的补入），并清理本地中云端已取消的条目。

**W3（Unwanted 未登录/云端异常）**：IF 云端调用失败超过 3 次 THEN THE SYSTEM SHALL 降级为纯本地收藏（恢复现状行为），并在下次成功调用时自动重连。

### 4.3 分享上报（RQ-07 增强）

**E6（Event-driven 分享）**：WHEN 用户点击详情页分享按钮（`onShareAppMessage` 触发）THEN THE SYSTEM SHALL 调起微信转发卡片 **并调用 `setNewsRetained({ newsId, retained: true })`** 将该新闻标记为 30 天保留。

> **口径说明**：微信转发无成功回调（owner 2026-08-03 拍板），「点击分享按钮」即判定为「分享过」，无需确认真实转发。上报失败静默重试（与收藏同一待同步队列）。

### 4.4 保留策略（30 天判定）

**D1（判定规则）**：一条新闻满足以下任一条件即标记 `isRetained = true`，保留 **30 天**：
- 被当前用户收藏（E4-3）；
- 被当前用户点击分享（E6）；
- 被**任意**用户收藏/分享（`setNewsRetained` 全局标记，非 openid 维度）。

**D2（标记持久性）**：`isRetained` 一旦为 true，**refreshNews 刷新写入时不得覆盖**（写入逻辑须保留已有文档的 `isRetained`/`retainedAt`）；取消收藏不自动取消标记（D1 语义：曾收藏/曾分享即保留）。

**D3（到期处理）**：retained 记录的 `cacheExpire = retainedAt + 30 天`；到期后按普通记录处理（可被清理）。

---

## 5. 需求三：未被收藏/未被分享的新闻保留 7 天（RQ-16）

### 5.1 策略定义

**U3（Ubiquitous）**：THE SYSTEM SHALL 保证 `news_cache` 中**未被收藏且未被分享**的新闻（`isRetained !== true`）在数据库中最长保留 **7 天**。

- 写入时：`cacheExpire = now + 7 * 24 * 3600 * 1000`（现状 65 分钟 → **调整为 7 天**）
- 读取时：`getNewsList`/`getNewsDetail` 继续按 `cacheExpire > now` 过滤（现状逻辑不变）
- retained 记录：`cacheExpire = now + 30 * 24 * 3600 * 1000`（§4.4 D3）

### 5.2 清理机制

**E7（Event-driven 周期清理）**：WHEN refreshNews 执行（手动/定时）THEN THE SYSTEM SHALL 执行分级清理：
1. 删除 `cacheExpire < now` 的普通记录（7 天过期）；
2. 删除 `cacheExpire < now` 的 retained 记录（30 天过期）；
3. 清理按分类分批执行（每批 ≤ 100 条），避免云函数超时；
4. 清理后更新 `sync_logs` 统计（removed 数量）。

**改造要求**：
- `config.cache.dbCacheTTL`：65 分钟 → 7 天（普通）/ 30 天（retained，写入时按标记覆盖）
- `clearOldCacheExcept`：保留「防顶掉 keepIds」逻辑，但**不得删除 `isRetained === true` 的记录**（无论是否在 keepIds）
- `renewCacheExpire`（双源失败续期）：仅续期普通记录；retained 记录保持自身 30 天到期

### 5.3 成本与性能约束

| 指标 | 约束 |
|------|------|
| 预估存量 | 每小时 7 分类 × 10 条 ≈ 70 条；7 天 ≈ **1.2 万条**（30 天 retained 另计） |
| 云数据库配额 | 需全栈开发评估（免费额度 2GB 需确认），若超限提供降级方案（如普通记录 3 天） |
| 清理耗时 | 单次清理 ≤ 2s（云函数 3s 预算内），分批执行 |
| 查询性能 | `getNewsList` 查询必须带 `cacheExpire > now` 索引（现状已有，验证索引覆盖） |

---

## 6. 数据模型总览

| 集合 | 变更 | 字段 |
|------|------|------|
| `news_cache`（主） | **TTL 策略变更 + isRetained 支持** | 现有字段 + `isRetained: bool`、`retainedAt: number`；`cacheExpire` 语义：普通 7 天 / retained 30 天 |
| `favorites`（新） | **新增** | `_openid`、`newsId`、`title`、`category`、`categoryName`、`source`、`picUrl`、`favoritedAt`（唯一键：`_openid + newsId`） |
| `browse_history`（新） | **新增** | `_openid`、`newsId`、`title`、`source`、`viewedAt`、`expireAt`（唯一键：`_openid + newsId`） |
| `news`（历史） | **冻结** | 不再写入；`setNewsRetained` 原逻辑废弃，保留兼容查询 |
| `system_kv` | 不变 | 限流等 |

---

## 7. 接口设计（云函数）

### 7.1 改造 `setNewsRetained`
```js
// 输入：{ newsId: string, retained: boolean }
// 行为：操作 news_cache 集合（不再操作 news）
//  - retained=true:  更新 { isRetained: true, retainedAt: now, cacheExpire: now + 30d }
//  - retained=false: 更新 { isRetained: false, retainedAt: null, cacheExpire: now + 7d }（不物理删除）
// 输出：{ code: 0, data: { newsId, isRetained, updated } }
```

### 7.2 新增 `setUserFavorite`
```js
// 输入：{ newsId, title, category, categoryName, source, picUrl, favorited: bool }
// 行为：favorites 集合按 _openid + newsId 写入/删除（upsert 语义）
// 输出：{ code: 0, data: { newsId, favorited } }
```

### 7.3 新增 `getUserFavorites`
```js
// 输入：{ }（openid 由云环境注入）
// 行为：按 _openid 返回收藏列表（倒序），分页（pageSize ≤ 50）
// 输出：{ code: 0, data: { list: [...], total } }
```

### 7.4 新增 `recordBrowse`（浏览云端兜底）
```js
// 输入：{ newsId, title, source }
// 行为：browse_history 按 _openid + newsId upsert（viewedAt=now, expireAt=now+7d）；超 7 天记录清理
// 输出：{ code: 0 }
```

### 7.5 新增 `getBrowseHistory`
```js
// 输入：{ }（openid 注入）
// 行为：按 _openid 返回 browse_history（viewedAt 倒序，仅未过期，≤ 200 条）
// 输出：{ code: 0, data: { list: [...] } }
```

> **注意**：以上云函数全部采用 **v4.1 平铺自包含风格**（不依赖 common/），与现有 `setNewsRetained` 一致。

---

## 8. 前端改动清单

| 文件 | 改动 |
|------|------|
| `pages/detail/detail.js` | ① 收藏时调用 `setUserFavorite` + `setNewsRetained(true)`，取消收藏调用 `setUserFavorite(false)`；② 分享按钮点击上报 `setNewsRetained(true)`；③ 待同步队列（容量 50） |
| `pages/detail/detail.js` | ④ 浏览记录写入（loadNews 成功后 `browseHistory` upsert + `recordBrowse` 异步上报） |
| `pages/history/history.js/.wxml/.wxss/.json` | **新增页面**：浏览记录列表（本地秒开 + 云端合并）、空态、点击回看 |
| `components/sidebar`（侧边栏） | 新增「浏览记录」入口条目 |
| `utils/localCache.js` | 新增 `browseHistory` 命名空间使用（复用现有 LRU/TTL，无需改库） |
| `utils/request.js` 或新 `utils/cloud.js` | 云函数调用封装（callFunction 包装 + 失败重试/队列） |
| `app.json` | 注册 `pages/history/history` |
| 收藏列表（侧边栏收藏 UI） | 打开时拉取 `getUserFavorites` 合并（S2） |

---

## 9. 后端改动清单

| 文件 | 改动 |
|------|------|
| `cloudfunctions/refreshNews/config.js` | `dbCacheTTL`：65 分钟 → 7 天（普通）；新增 `retainedTTL: 30 天` |
| `cloudfunctions/refreshNews/index.js` | ① 写入时保留已有 `isRetained`/`retainedAt`（不得覆盖）；② retained 记录 `cacheExpire = retainedAt + 30d`；③ 新增分级清理（§5.2 E7）；④ `clearOldCacheExcept` 跳过 `isRetained===true`；⑤ `renewCacheExpire` 仅续期普通记录 |
| `cloudfunctions/setNewsRetained/index.js` | 改造目标集合 `news` → `news_cache`（§7.1） |
| `cloudfunctions/getNewsList/index.js` | 验证/优化 `cacheExpire > now` 索引覆盖；返回字段含 `isRetained`（供前端展示可选「已收藏」态） |
| 新增 `setUserFavorite` / `getUserFavorites` / `recordBrowse` / `getBrowseHistory` | 4 个新云函数（§7.2~7.5），含 `config.json` 与 `package.json` |

---

## 10. 埋点

| 事件 | 触发 | 字段 |
|------|------|------|
| `browse_record` | 详情页加载成功 | `{ newsId, category, from: 'history'|'home'|'sidebar' }` |
| `favorite_cloud_sync` | 收藏/取消收藏云端调用 | `{ newsId, action: 'add'|'remove', result: 'ok'|'fail' }` |
| `share_retained` | 分享按钮点击 | `{ newsId, result: 'ok'|'fail' }` |
| `cleanup_job` | refreshNews 分级清理 | `{ removedNormal, removedRetained, durationMs }` |

---

## 11. 验收标准（开发自测 + PM 验收共用）

### 11.1 浏览记录（RQ-06）
| # | 用例 | 期望 |
|---|------|------|
| H-01 | 浏览 3 条新闻后打开浏览记录 | 按时间倒序显示 3 条，含标题/来源/相对时间 |
| H-02 | 重复浏览同一新闻 | 不新增条目，viewedAt 刷新、置顶 |
| H-03 | 构造 8 天前的记录 | 不展示；触发写入时被惰性清除 |
| H-04 | 无记录时打开 | 空态文案 + 引导 |
| H-05 | 点击记录回看 | 跳转详情页并加载对应新闻 |
| H-06 | 断网浏览 + 打开记录 | 本地数据正常展示 |
| H-07 | 换设备（云端兜底） | 登录后打开记录页，云端历史合并出现 |

### 11.2 收藏/分享 30 天保留（RQ-03/RQ-07/RQ-16）
| # | 用例 | 期望 |
|---|------|------|
| F-01 | 收藏一条新闻 | 本地 favorites + 云端 favorites 均有；`news_cache` 该条 `isRetained=true`，`cacheExpire=now+30d` |
| F-02 | 取消收藏 | 本地与云端 favorites 删除；`isRetained` **保持 true**（曾收藏即保留） |
| F-03 | 点击分享按钮 | `isRetained=true`，`cacheExpire=now+30d` |
| F-04 | refreshNews 刷新后 | 被收藏新闻**不被覆盖/清理**，`isRetained` 保留 |
| F-05 | 收藏后第 31 天（模拟） | 记录可被清理（retained 到期） |
| F-06 | 云端调用失败 | 本地收藏成功 + toast「已收藏（待同步）」+ 队列重试 |
| F-07 | 侧边栏收藏列表打开 | 云端收藏合并，本地缺失补入、云端已删移除 |

### 11.3 未收藏/未分享 7 天保留（RQ-16）
| # | 用例 | 期望 |
|---|------|------|
| C-01 | 普通新闻写入 | `cacheExpire = now + 7d`（非 65 分钟） |
| C-02 | 模拟 7 天后清理 | 普通记录被删除 |
| C-03 | retained 记录 7 天后 | **不被**清理（30 天到期才清理） |
| C-04 | `clearOldCacheExcept` 触发 | 不删除 `isRetained=true` 记录 |
| C-05 | 双源失败续期 | 仅普通记录续期，retained 保持自身到期 |
| C-06 | 清理耗时 | 单次 ≤ 2s，分批执行，`sync_logs` 有统计 |

### 11.4 回归（不破坏现状）
| # | 用例 | 期望 |
|---|------|------|
| R-01 | 收藏列表现有 UI（localCache 200 条） | 展示逻辑不变（数据层增强） |
| R-02 | 分享转发卡片 | 标题+摘要+封面正常（onShareAppMessage 行为不变） |
| R-03 | 首页/详情列表加载 | 7 天 TTL 下查询正常，无性能回退 |
| R-04 | 自动化回归 | `test/v11-category-contract.js` 25/25 仍通过 |

---

## 12. 风险与待确认

| # | 风险 | 说明 | 处置 |
|---|------|------|------|
| R1 | **存储配额** | 7 天 TTL ≈ 1.2 万条，30 天 retained 另计；云数据库免费额度 2GB | 全栈开发评估；若超限，普通记录降级 3 天并报 PM |
| R2 | **browse_history 写入量** | 每篇浏览 1 次云端写入，高频用户产生大量文档 | 每条 7 天过期 + 惰性清理；必要时批量上报 |
| R3 | **setNewsRetained 全局标记** | 标记非 openid 维度，所有用户共享（一个用户收藏 = 全网保留） | 符合 owner「曾收藏即保留」语义；取消收藏不撤销 |
| R4 | **云函数超时** | 清理分批 ≤ 2s/批 | 若超时，拆为独立定时触发器（备选） |

---

## 13. 交付物与验收流程

1. **开发**：全栈开发严格按本文档 §6~§9 实现，提交时标注对应章节号；
2. **自测**：按 §11 自测清单执行，结果写入 `docs/05-测试验收/`；
3. **PM 验收**：开发完成后 PM 按 §11 逐条验收，输出验收报告；
4. **回归**：§11.4 回归用例 + 既有自动化测试全绿后方可合入。
