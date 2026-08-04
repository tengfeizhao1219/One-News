# Git Staging 目录

> **用途**：各角色产出文件后，在此目录写入 staging 标记，由 Git 管理专家（GM）统一提交。
> **规则**：只有 GM 可以清除此目录中的标记文件。各角色只写入，不删除。

## Staging 标记格式

每个角色产出文件后，写入 `<role>.ready` JSON 文件：

```json
{
  "role": "PM",
  "timestamp": "2026-08-04T08:45:00+08:00",
  "summary": "更新需求池，移除 mock 数据相关需求描述",
  "files": ["docs/01-需求规划/需求池.md"],
  "ready": true
}
```

## 角色标识

| 角色 | 文件名 |
|------|--------|
| 产品经理 | `pm.ready` |
| 产品设计师 | `pd.ready` |
| 全栈开发 | `fs.ready` |
| 项目经理 | `pjm.ready` |

## 工作流程

1. 各角色产出文件后 → 写入 `<role>.ready`
2. GM 检查 staging → `git add -A` → `git commit` → `git push`
3. GM 清除已提交的标记

> **重要**：各角色**禁止**自行执行 `git add/commit/push/merge/rebase`，只能 `git pull`。
> Git 管理专家（GM）是唯一有权执行 git 写操作的角色。
