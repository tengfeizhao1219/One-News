# API Key 环境变量管理规范

> **任务**：T-10 | **负责人**：技术负责人 | **状态**：✅ v4.0 更新（百炼→智谱+DeepSeek 双引擎）
> **范围**：微信云开发云函数环境变量（非代码硬编码）

---

## 1. 变量清单（v4.0）

| 变量名 | 用途 | 必填 | 使用位置 | 缺失行为 |
|--------|------|------|----------|----------|
| `ZHIPU_API_KEY` | 🆕 智谱 GLM-4-Flash（refreshNews 主力搜索） | ✅ **必填** | `common/zhipuSearch.js` | refreshNews 跳过智谱，降级到 DeepSeek |
| `DEEPSEEK_API_KEY` | 🆕 DeepSeek API（refreshNews 降级搜索） | ✅ **必填** | `common/zhipuSearch.js` | 智谱失败后无法降级，该分类搜索失败 |
| `TIAN_API_KEY` | L2 天行实时新闻 API（降级备选） | ⚠️ 可选 | `common/tianApi.js` | 未配置则跳过 L2，下沉 L3 |
| `JUHE_API_KEY` | L3 聚合数据降级 API | ⚠️ 可选 | `common/juheApi.js` | 未配置则跳过 L3，下沉 L4 |
| ~~`DASHSCOPE_API_KEY`~~ | ~~百炼 DeepSeek~~ | ❌ **已废弃 v4.0** | — | 保留配置不删除，避免回滚时重建 |

> ⚠️ v4.0 改造：百炼 `DASHSCOPE_API_KEY` 已被 `ZHIPU_API_KEY` + `DEEPSEEK_API_KEY` 取代。百炼 Key 保留不删，但代码不再引用。

## 2. 配置位置（微信云开发控制台）

1. 云开发 → 云函数 → 环境变量
2. 新增/编辑 `ZHIPU_API_KEY`、`DEEPSEEK_API_KEY`
3. 可移除 `DASHSCOPE_API_KEY`（或保留为空）
4. 保存后**需重新部署** `refreshNews` + `getNewsList` 云函数

## 3. 读取方式（代码侧）

- `zhipuSearch.js`：`process.env.ZHIPU_API_KEY || config.zhipu?.apiKey`
- `zhipuSearch.js`（降级）：`process.env.DEEPSEEK_API_KEY || config.deepseek?.apiKey`
- `tianApi.js`：`process.env.TIAN_API_KEY || config.tian?.apiKey`
- 代码中**禁止**明文写 Key

## 4. Key 获取地址

| 平台 | 获取地址 | 免费额度 |
|------|----------|------|
| 智谱 GLM | https://open.bigmodel.cn/ → API Keys | 永久免费 + 2000万 token |
| DeepSeek | https://platform.deepseek.com/ → API Keys | 注册送 $5，约 50次/天 |
| 天行数据 | https://www.tianapi.com/ | 100次/天免费 |
| 聚合数据 | https://www.juhe.cn/ | 100次/天免费 |

## 5. 检查清单

- [ ] `ZHIPU_API_KEY` 已配置（refreshNews 主力）
- [ ] `DEEPSEEK_API_KEY` 已配置（refreshNews 降级）
- [ ] `TIAN_API_KEY` 已配置（可选，L2 降级）
- [ ] `JUHE_API_KEY` 已配置（可选，L3 降级）
- [ ] `DASHSCOPE_API_KEY` 可清空或保留（已废弃）
- [ ] `refreshNews` / `getNewsList` 已重新部署
- [ ] 代码无明文 Key

---

> **维护**：技术负责人 | **版本**：v4.0（2026-07-31，百炼→智谱+DeepSeek 双引擎改造）
