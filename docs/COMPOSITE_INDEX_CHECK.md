# news_cache 复合索引核查报告（P0 优化项）

> 核查时间：2026-08-28
> 方式：通过 CloudBase MCP `readNoSqlDatabaseStructure.listIndexes` 直接读取线上集合索引
> 环境：`cloud1-1g9313w0bb791de0`

## 结论速览

| 集合 | 复合索引状态 | 判定 |
|------|------|------|
| `news_cache` | ✅ `(category, finalScore desc, createdAt desc)` 与 `(finalScore desc, createdAt desc)` 均存在且活跃 | 主查询路径索引健康，此前担忧的「索引缺失→R9 降级→DB 读翻倍」**未发生** |
| `news_cache_backup` | ⚠️ 仅 `_id_` / `_openid_1`，无 category / createdAt 索引 | stale 兜底路径会**全表扫描 + 内存排序**（影响有限，但建议补索引） |

## 一、news_cache 索引实况（共 8 条）

| 索引名 | Keys | Ops | 用途 |
|------|------|------|------|
| `category_1_finalScore_-1_createdAt_-1` | category(1), finalScore(-1), createdAt(-1) | **1909** | ✅ 主查询 `where({category, cacheExpire>now}) + orderBy(finalScore desc, createdAt desc)` 命中此索引，活跃使用 |
| `finalScore_-1_createdAt_-1` | finalScore(-1), createdAt(-1) | 0 | 覆盖 'all' 路径 `where({cacheExpire>now}) + orderBy(...)`，当前未命中（'all' 多映射为 recommend，少用） |
| `cat_expire` | category(1), cacheExpire(1) | 1442 | 新鲜度过滤（未过期数据筛选） |
| `cat_createdAt` | category(1), createdAt(1) | 145 | 分类 + 时间排序辅助 |
| `dedupKey` | dedupKey(1) | 560 | 服务端去重 |
| `id` | id(1) | 2721 | 单条详情/去重查询 |
| `_id_` | _id(1) | 23581 | 主键 |
| `_openid_1` | _openid(1) | 0 | 系统默认 |

### 含义
- `getNewsList` 主路径排序走的是正确复合索引，**一次 `.get()` 完成排序+分页，每次列表 = 1 次 DB 读**，符合 P0 优化预期。
- `#75` 在云函数内加的「复合索引缺失/异常」告警为防御性，**当前不会触发**（日志可放心忽略该关键字）。
- ✅ 此前 `#71` 去掉 `.count()` 的优化，在索引健康前提下，把每次列表稳定压到「1 次 DB 读」，对 `-501003` 的 DB 读写配额是实打实的减法。

### 可顺手清理（非紧急）
`finalScore_-1_createdAt_-1`（Ops=0）是 `category_1_finalScore_-1_createdAt_-1` 的前缀子集，**重复且从未被使用**。在 backup 索引补齐、确认 'all' 路径不会落到它之后，可删除以省索引存储（36KB × 复本）。删除属写操作，未自动执行。

## 二、news_cache_backup 索引实况（共 2 条）⚠️

| 索引名 | Keys | Ops |
|------|------|------|
| `_openid_1` | _openid(1) | 0 |
| `_id_` | _id(1) | 0 |

**无任何 category / createdAt / cacheExpire 索引。**

`getFromCacheBackup` 的查询：
```js
db.collection('news_cache_backup')
  .where(category ? { category } : {})
  .orderBy('createdAt', 'desc')
  .skip(...)
  .limit(pageSize + 1)
  .get()
```
在 backup 集合上 → **全表扫描 + 内存排序**（无 createdAt 索引时排序在内存完成，文档量大可能触发内存排序超限报错）。

**影响范围**：该路径是 `news_cache` 无未过期数据时的 stale 兜底，正常不触发；backup 为上次成功快照，数据量通常小。但属于真实隐患，建议补索引消除。

**建议补建（任选其一，推荐前者）：**
- `(category, createdAt desc)` 复合索引 —— 如需按分类过滤；
- 或 `(createdAt desc)` 单字段索引 —— 若备份仅全量兜底。

> 补索引属写操作（MCP `writeNoSqlDatabaseStructure` 或控制台），需单独确认后执行。

## 三、代码侧已做兜底（无需操作）
- `queryCache` 在组合索引排序失败时会首次 `console.error` 提示索引缺失，后续 `console.warn`（详见 `cloudfunctions/getNewsList/index.js`）。
- 监控：日志搜 `[⚠ 复合索引缺失/异常]`，命中即优先确认索引（现已确认健康，不会命中）。

## 备注
- 索引为控制台/SDK 写操作；本文档仅供核查与排障。backup 加索引需通过 MCP 或控制台执行，已单独向用户确认。
