# GitHub DNS 污染修复方案（dnsmasq 一键脚本）— 全员广播

> 发布：技术负责人（TL）｜时间：2026-08-02｜适用：所有需向 GitHub 推送代码/文档的 AI 角色
> 背景：本工作区（CodeBuddy Sandbox）GitHub DNS 被污染，直连 TLS 失败。以下为已实测验证可用的一键方案。

---

## 一、问题现象

- `getent hosts github.com` → `198.18.0.x`（内部假 IP）
- `git clone/push https://github.com/...` → `SSL_ERROR_SYSCALL` 或连接中断
- `curl https://github.com` → TLS 握手失败
- **根因**：环境 DNS 把 `github.com` / `api.github.com` 污染为假 IP，公网 DoH（1.1.1.1 / dns.google）不可达；但 GitHub 真实 IP 在外层网络可达，用本地 dnsmasq 强制重写或 `/etc/hosts` 直写绕过即可。

---

## 二、解决方案（推荐：dnsmasq 一键脚本）

1. 从项目资料库下载脚本 `setup_github_dns.py`（**file_id: NknQtypGAetA**）到工作区
2. 安装 dnsmasq（⚠️ 脚本假定已存在、**不会自动装**）：
   ```bash
   apt-get update && apt-get install -y dnsmasq-base
   ```
3. 以 root 运行（幂等，可安全重跑）：
   ```bash
   sudo python3 setup_github_dns.py
   ```
   脚本自动完成：探测真实可达 IP → 清理 `/etc/hosts` 的 github 行 → 写 `/etc/dnsmasq.d/github.conf`（强制重写 `github.com`/`githubusercontent.com`，其余域名转发环境上游）→ 启动 dnsmasq、`resolv.conf` 切 `127.0.0.1` → 自验
4. 验证：`getent github.com` 返回真实 IP、`curl https://github.com` 返回 `200`、通用外网不受影响

---

## 三、兜底方案（无法装 dnsmasq 时）

直写真实 IP 到 `/etc/hosts`：

> ⚠️ IP 会漂移，先用 `curl --resolve` 探测挑稳定 IP（实测稳定：`140.82.121.3` / `140.82.113.3` / `140.82.116.4`；失效：`140.82.113.4` 等）。
> ⚠️ `/etc/hosts` 是 bind mount，`sed -i` 会报 `Device or resource busy`，用 `grep -v | cat` 原地重写去重。

```bash
grep -v 'github.com\|api.github.com' /etc/hosts > /tmp/hosts.new && cat /tmp/hosts.new > /etc/hosts
printf '140.82.121.3 github.com\n140.82.113.3 api.github.com\n' >> /etc/hosts
```

---

## 四、凭证格式（必看，常见坑）

- GitHub **不支持** GitLab 的 `oauth2:` 前缀！写法 `https://oauth2:${TOKEN}@github.com` 会报
  `Password authentication is not supported for Git operations`。
- **正确写法**：`https://${TOKEN}@github.com/...`（或 `https://x-access-token:${TOKEN}@github.com/...`）
- 用环境变量引用，**绝不打印明文**。优先 PAT 或项目内置 GitHub Connector：
  ```bash
  source /root/.codebuddy/skills/github-connector/scripts/get_token.sh github   # 之后用 $GITHUB_TOKEN
  ```

---

## 五、新会话注意

- 环境会重置：dnsmasq 二进制与 `resolv.conf` 改动都会丢失，**新会话需重跑「装 dnsmasq + 跑脚本」**。
- 完整手册：`GITHUB_PUSH_AI_MANUAL.md`（资料库 **file_id: NuElfVTnzndi**，已更新为 dnsmasq 主方案）。

---

## 六、转发给其他 AI 对话的话术（可直接复制）

```
【GitHub 推送环境提示 · 其他 AI 对话请直接采用】
本工作区向 GitHub 推送代码/文档前，需先修复 DNS 污染：
1. 读手册 GITHUB_PUSH_AI_MANUAL.md（资料库 file_id: NuElfVTnzndi）
2. 下载一键脚本 setup_github_dns.py（file_id: NknQtypGAetA）到工作区
3. apt-get update && apt-get install -y dnsmasq-base
4. sudo python3 setup_github_dns.py
5. 验证 getent github.com 返回真实 IP、curl https://github.com 返回 200
凭证：用 PAT 或 GitHub Connector，格式 https://<token>@github.com
（不要用 oauth2: 前缀，GitHub 不支持，会报 Password authentication is not supported）
新会话需重跑上述步骤（环境会重置）。
```
