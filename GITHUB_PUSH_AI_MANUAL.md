# GitHub 推送环境修复手册（AI 协作版）

> 适用：本工作区向 GitHub 推送代码/文档前，必须先把 DNS 污染修好，否则 git/curl 会报
> `gnutls_handshake() failed: The TLS connection was non-properly terminated.`
> 新会话环境会重置，每次推送前都要重跑。

---

## 一、问题根因

沙箱默认 DNS（腾讯 `183.60.83.19` / `183.60.82.98`）把 `github.com` 解析到内部代理
`198.18.0.x`。该代理的 443 端口 TLS 握手会失败，导致所有到 GitHub 的 HTTPS 请求中断。

实测：GitHub 真实 IP（如 `20.205.243.166`）可直连并返回 HTTP 200，所以只需要把域名
解析到正确 IP 即可。

---

## 二、一键修复步骤

```bash
# 1. 确保脚本在工作区（setup_github_dns.py）
# 2. 安装 dnsmasq
apt-get update && apt-get install -y dnsmasq-base

# 3. 运行一键脚本（需 root）
sudo python3 setup_github_dns.py

# 4. 验证
getent hosts github.com        # 应返回 20.205.243.166
curl -s -o /dev/null -w "%{http_code}\n" https://github.com   # 应返回 200
```

脚本做了什么：
1. 启动本地 `dnsmasq`，监听 `127.0.0.1:53`
2. 将 `github.com` 及其子域（`api` / `raw.githubusercontent.com` / `objects` 等）
   静态指向真实 IP `20.205.243.166`
3. 备份并改写 `/etc/resolv.conf`，把本机解析器指向 `127.0.0.1`
4. 其它域名仍走系统真实上游

---

## 三、推送凭证

用 PAT（个人访问令牌）或 GitHub Connector 提供的 token，格式：

```
https://<token>@github.com/<owner>/<repo>.git
```

> ⚠️ **不要用 `oauth2:` 前缀** —— GitHub 不支持，会报
> `Password authentication is not supported`。

本仓库示例（已验证可用）：

```bash
cd <工作区>
TOKEN="ghp_xxxxxxxxxxxx"   # 从共享保险库获取
git config "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf" "https://github.com/"
git pull origin main
git push origin main
git config --unset "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf"
```

---

## 四、还原（如需）

```bash
# 恢复 DNS
cp /etc/resolv.conf.bak.githubfix /etc/resolv.conf
pkill dnsmasq
```

---

## 五、常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `gnutls_handshake() failed` | DNS 污染，未跑修复脚本 | 重跑 `setup_github_dns.py` |
| `Could not resolve host` | dnsmasq 未启动或 resolv.conf 未指向 127.0.0.1 | 检查 dnsmasq 进程、`getent hosts github.com` |
| `Password authentication is not supported` | 用了 `oauth2:` 前缀 | 改回 `https://<token>@github.com` |
| `Repository not found` | 仓库名/owner 写错 | 确认是 `tengfeizhao1219/One-News` 而非 `laterqq/One-News` |
| `403` | token 无写权限 | 用保险库里 `ghp_` 前缀的 PAT（有写权限），不要用 `ghu_` 前缀（只读） |
