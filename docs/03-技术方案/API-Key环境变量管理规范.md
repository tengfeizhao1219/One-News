# API Key 环境变量管理规范

> **任务**：T-10 | **负责人**：技术负责人 | **状态**：✅ 规范就绪
> **范围**：微信云开发云函数环境变量（非代码硬编码）

---

## 1. 变量清单

| 变量名 | 用途 | 必填 | 使用位置 | 缺失行为 |
|--------|------|------|----------|----------|
| `TIAN_API_KEY` | L1 天行实时新闻 API | ✅ **必填** | `common/tianApi.js`、`common/config.js` | 抛 `API_KEY_INVALID`，降级链下沉 |
| `JUHE_API_KEY` | L4 聚合数据降级 API | ⚠️ 可选 | `common/juheApi.js`、`common/config.js` | 未配置则跳过 L4，下沉 L5 |
| `DASHSCOPE_API_KEY` | 百炼 DeepSeek（refreshNews 生成 AI 缓存） | ⚠️ 仅生成期需要 | `common/llmSearch.js`、`common/config.js` | 未配置则 `refreshNews` 失败（`LLM_SEARCH_FAILED`），但**不影响 getNewsList 运行时**（L5 读已生成静态 JSON） |

> ⚠️ 注意：`DASHSCOPE_API_KEY` **不用于 getNewsList/getNewsDetail 运行时**，仅 `refreshNews`/`llmSearch` 生成 AI 缓存时使用。此前技术文档未记录该变量（本次补齐）。

## 2. 配置位置（微信云开发控制台）
1. 云开发 → 云函数 → 选择 `getNewsList` / `getNewsDetail` / `refreshNews`（或环境级环境变量）
2. 配置 → 环境变量 → 新增/编辑键值对
3. 保存后**需重新部署对应云函数**生效

## 3. 读取方式（代码侧）
- 统一经 `common/config.js`：`apiKey: process.env.XXX || ''`
- `llmSearch.js` 额外 `process.env.DASHSCOPE_API_KEY || config.bailian?.apiKey || ''`
- 代码中**禁止**明文写 Key；缺失时显式抛 `API_KEY_INVALID` 而非静默失败

## 4. 轮换 / 安全
- **轮换**：在对应平台（天行/聚合/阿里云百炼）重置 Key → 控制台更新环境变量 → 重新部署云函数。旧 Key 立即失效，无需改代码。
- **安全**：
  - 环境变量仅存于云开发后台，不进 git（已在 `.gitignore`/规范约束）。
  - 若怀疑聚合 Key 泄露：聚合后台重置 → 重新注入 `JUHE_API_KEY`。
  - 百炼 Key 轮换按 2026-07-30 用户决策**搁置**，如需启用见 PM。
- **本地调试**：`USE_MOCK=true` 时走 Mock，无需任何 Key。

## 5. 检查清单
- [ ] `TIAN_API_KEY` 已配置且有效（L1 正常）
- [ ] `JUHE_API_KEY` 已配置（可选，建议配以便 L4 降级）
- [ ] `DASHSCOPE_API_KEY` 已配置（保障 AI 缓存可刷新）
- [ ] 三个云函数均已重新部署使环境变量生效
- [ ] 代码无明文 Key（`grep -rn "process.env" common/` 核对）
