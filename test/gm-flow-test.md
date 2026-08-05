# ~~GM 流程测试文件~~（已废弃）

> ⚠️ **已废弃（2026-08-05）**：Git 管理专家（GM）角色已取消，全员直连 GitHub（v4.0）。本测试验证的「`.git-staging/pm.ready` → GM 统一提交」链路已不存在。
> 当前规则：各角色直接 `git pull/add/commit/push` 自己职责范围内的文件，无代提交环节。
> 本文件保留作历史记录，可删除。

> **用途**（历史）：验证「产品经理 → `.git-staging/pm.ready` → GM 统一提交」完整链路。
> **创建时间**：2026-08-04 17:46
> **创建人**：产品经理（PM）
> **测试目的**（历史）：确认 GM 能读取 staging 标记 → git add/commit/push → 清除标记。

## 测试预期（历史）

| 步骤 | 预期 |
|------|------|
| 1. GM 读取 `.git-staging/pm.ready` | 看到本文件在 files 清单中 |
| 2. GM 执行 `git pull --rebase` | 无冲突或正常合并 |
| 3. GM 执行 `git add`（或 add -A） | 本文件进入暂存区 |
| 4. GM 执行 `git commit` | 提交信息含「GM」+ 摘要 |
| 5. GM 执行 `git push` | 推送成功 |
| 6. GM 清除 `pm.ready` | `.git-staging/pm.ready` 被删除 |

## 验证方式（历史）

- 提交后本文件应出现在远端仓库 `test/gm-flow-test.md`。
- 若 GM 回复 commit hash，则链路验证通过 ✅。

---
*本文档为测试专用，验证后可删除。*
