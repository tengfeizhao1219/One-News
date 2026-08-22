# Git 推送规范（多 AI 协作 / 高频开发场景）

> 版本：v1.0（2026-08-22）
> 适用范围：**所有**向 `One-News` 仓库推送的 AI / 工具（DeepSeek、WorkBuddy、手动 git）。
> 背景：2026-08 出现 GitHub **secondary rate limit（滥用冷却）**——高频 push（实测峰值 10 次/时、2 天 138 次）触发 git 写操作挂起/超时（`SSL_ERROR_SYSCALL` / `Empty reply` / HTTP2 framing），读操作仍正常。

---

## 1. 根因（数据实证）

| 指标 | 实测值 | 触发阈值参考 |
|---|---|---|
| 近 3 天提交 | 247 次（日峰值 95） | — |
| 近 2 天 push | 138 次 | — |
| 峰值频率 | **10 次/小时** | GitHub 滥用检测对高频写敏感 |
| 持续窗口 | 25.5h 不间断 | — |

GitHub 两级限流：
- **标准 rate limit**：API 层，我们正常（59/60 剩余）——非主因
- **Secondary Rate Limit（滥用检测）**：检测"自动化/过频模式"，对 **git 写操作临时冷却**——表现为 push 挂起、超时、`abuse detection mechanism triggered`。**与症状完全吻合**。

> 与 WorkBuddy 时期"前期好、后期频繁推后出问题"一致：任何工具只要高频 push 到同一仓库，都会触发。

---

## 2. 强制机制（已落地）

### 2.1 标准推送入口：`scripts/git_push.sh`（必用）

```bash
bash scripts/git_push.sh            # 推送 main，带间隔保护 + 退避
bash scripts/git_push.sh --force    # 跳过间隔保护（紧急修复，慎用）
```

内置行为：
1. **推送间隔保护**：同仓库 60s 内不重复 push（冷却防滥用），超时自动等待
2. **指数退避**：失败 10s→30s→60s→120s 重试，最多 5 次
3. **HTTP/1.1 强制**：规避 HTTP2 framing 层错误
4. **成功判定**：真实推送成功 / 远端已含 HEAD（竞态窗口）均算成功
5. **门禁前置**：pre-push hook 自动跑 `check_intel.sh`

### 2.2 通用 git 命令的替代

任何场景下，**禁止裸 `git push` 到 main**，统一用：

```bash
git add ... && git commit -m "..."
bash scripts/git_push.sh
```

（提交仍可用 git commit；推送一律走脚本。）

### 2.3 pre-push 门禁（已有）

`.git/hooks/pre-push` 自动跑 `scripts/check_intel.sh`（冲突标记扫描 + 关键逻辑存在性校验），失败拒推。

---

## 3. 最佳实践（降触发频率）

1. **合并提交再推**：多个小改动攒 3-5 个 commit 推一次，push 频率从 10 次/时降到 2-3 次/时。
2. **失败后冷静**：push 超时后等 60-120s 再试，**不要立即重试轰炸**（冷却期通常 1 分钟起）。
3. **检查是否已推送**：疑似失败先 `git fetch` 对比 HEAD，远端已含则无需重推。
4. **紧急修复**才用 `--force`（跳过间隔保护），用完恢复常规节奏。

---

## 4. 故障排查速查

| 现象 | 原因 | 处置 |
|---|---|---|
| push 卡死无输出 | 滥用冷却 / 沙箱代理 | 等 5-10 分钟，用 `git_push.sh` 重试 |
| `SSL_ERROR_SYSCALL` / `Empty reply` | 网络抖动 / HTTP2 | 脚本已强制 HTTP/1.1 |
| `HTTP2 framing layer` | HTTP2 层 | `git config http.version HTTP/1.1` |
| `abuse detection mechanism triggered` | 高频触发冷却 | 停 10-30 分钟，降低推送频率 |
| 读操作正常、写操作超时 | 冷却窗口 | 等待，勿重试轰炸 |

---

## 5. 协作纪律

- **多 AI 并行**：所有改动先 `git pull`（以线上为准），改后即提交，推送走 `git_push.sh`。
- **推送频率纪律**：默认攒批推送（3-5 个 commit / 次），非紧急不单条推。
- **禁止**：`git push --force` 覆盖他人提交（main 分支）。
- 本规范随仓库分发（`intel-docs/GIT推送规范.md`），任何 AI 推送前应先读。
