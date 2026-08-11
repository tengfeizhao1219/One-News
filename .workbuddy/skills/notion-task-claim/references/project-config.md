# 项目配置 · Notion 页面与凭据索引

> 所有页面 id 均为 One News 项目级事实（非敏感，可进仓库）。
> 密钥 **不进本文件**，统一见 `{workspace}/.workbuddy/keys/SECRETS.md`。

## 通知/数据源页面

| 用途 | page_id | 说明 |
|---|---|---|
| **TASK_BOARD 任务看板**（database） | `3b66b5eb-1dd8-8107-80ef-f8546b076e4f` | **领任务唯一权威最新源**；读 = POST query；写 = PATCH 页面属性 |
| 父页面 | `3b66b5eb-1dd8-812a-91fd-f04ab916ac4b` | 所有资产父节点 |
| 速读入口页 | `3b66b5eb-1dd8-810a-a24a-e0e4dd7b266d` | 新会话必读 |
| COLLABORATION 协作协议 | `3b66b5eb-1dd8-8123-b021-e6fe3a47eb98` | 认领/执行/交付流程 |
| COMMLOG 交接广播（database） | `3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc` | 跨窗口交接、交付广播 |
| CHANGELOG | `3b66b5eb-1dd8-810b-8b67-d942e7ffb4f9` | 版本/里程碑 |

## 权限现状（2026-08-11 confirmed）

| 操作 | Token B | 说明 |
|---|---|---|
| GET / POST query database | ✅ HTTP 200 | 读任务列表可用 |
| **PATCH 页面属性**（改状态/负责人/日期） | ✅ **HTTP 200 已验证** | 更新已有任务状态可用 |
| POST 创建 database 条目 | ❌ 404 | 新建任务不可用 → 走 COMMLOG 兜底 |

## Token 选择

- 推荐 **Token B**（`One News助手`），已验证可 PATCH。
- 从环境变量注入：`export NOTION_TOKEN="$(grep -oP 'ntn_[A-Za-z0-9]+' .workbuddy/keys/SECRETS.md | head -1)"`，**不要硬编码进脚本或对话**。

## TASK_BOARD 字段约定

| 字段名 | 类型 | 常用取值 |
|---|---|---|
| 任务名 | title | 任务标题 |
| 状态 | select | `🔄 进行中` / `📋 待认领` / `✅ 已完成` / `⏳` / `🚫` |
| 负责人 | select | `PM` / `PD` / `FS` / `FE`（或中文名） |
| 优先级 | select | `P0` / `P1` / `P2` |
| 关联链 | select | 父任务代号 |
| 上次更新 | date | YYYY-MM-DD |
