#!/bin/bash
# setup_github_dns.sh  v3.0 — 单行 git config，零依赖，零副作用
# ============================================================================
# 背景：
#   沙箱环境的 sandbox-proxy 对 github.com 做了 DNS 劫持（→ 198.18.0.x）
#   且对 GnuTLS 的 TLS 握手不稳定（同一 IP、OpenSSL 能通、GnuTLS 不通）。
#   GM 的 v2.0 方案需要 dnsmasq + resolv.conf bind mount 写入，步骤多、
#   易失败、影响面大。
#
# v3.0 原理：
#   git 内嵌 libcurl，支持 CURLOPT_RESOLVE —— 在发起连接前直接喂 DNS 结果，
#   完全绕过系统 DNS。本脚本：
#     1. 用系统 openssl 探测哪个 GitHub IP 的 TLS 握手能通过
#     2. 将该 IP 写入 git config http.https://github.com.curloptresolve
#     3. 仅影响当前仓库，不影响系统其他 github.com 流量
#
# 用法：
#   bash setup_github_dns.sh              # 在当前仓库配置
#   bash setup_github_dns.sh --global     # 全局配置（所有仓库生效）
#   bash setup_github_dns.sh --check      # 仅检查，不修改
#
# 恢复：
#   git config --unset http.https://github.com.curloptresolve
#
# 提交历史：v1.0 (GM) → v2.0 (GM, git ls-remote 探测) → v3.0 (PD, curloptResolve)
# ============================================================================

set -euo pipefail

MODE="local"
CHECK_ONLY=false
CANDIDATES=(
    "140.82.113.4"
    "140.82.114.4"
    "140.82.116.4"
    "140.82.114.3"
    "140.82.121.3"
    "140.82.121.4"
    "20.205.243.166"
    "20.205.243.165"
)

for arg in "$@"; do
    case "$arg" in
        --global) MODE="global" ;;
        --check) CHECK_ONLY=true ;;
        -h|--help)
            echo "用法: bash $0 [--global] [--check]"
            echo "  (无参数)  当前仓库配置"
            echo "  --global  全局配置（~/.gitconfig）"
            echo "  --check   仅检查当前 IP 是否可用"
            exit 0
            ;;
    esac
done

# ── 探测：找到第一个 openssl TLS 握手成功的 IP ──
echo "[1] 探测 GitHub IP（openssl s_client）..."
CHOSEN_IP=""
for ip in "${CANDIDATES[@]}"; do
    echo -n "  $ip ... "
    result=$(timeout 8 openssl s_client -connect "${ip}:443" \
        -servername github.com </dev/null 2>&1)
    if echo "$result" | grep -q "Verify return code: 0 (ok)"; then
        echo "✅ OK"
        CHOSEN_IP="$ip"
        break
    else
        echo "❌"
    fi
done

if [ -z "$CHOSEN_IP" ]; then
    echo "[!] 全部 ${#CANDIDATES[@]} 个 IP 均不可用。"
    echo "    建议联系环境 owner 申请 github.com 白名单。"
    exit 1
fi

echo "[+] 选定 IP: $CHOSEN_IP"

if $CHECK_ONLY; then
    exit 0
fi

# ── 应用 ──
SCOPE_FLAG=""
[ "$MODE" = "global" ] && SCOPE_FLAG="--global"

git config $SCOPE_FLAG http.https://github.com.curloptresolve "github.com:443:${CHOSEN_IP}"
echo "[+] git config http.https://github.com.curloptresolve = github.com:443:${CHOSEN_IP}"

# ── 验证 ──
echo "[2] 验证 git ls-remote..."
if timeout 20 git ls-remote https://github.com/tengfeizhao1219/One-News.git HEAD >/dev/null 2>&1; then
    echo "[OK] git 操作正常，修复完成。"
else
    echo "[!] git 验证失败，请检查网络。"
    echo "    撤销: git config $SCOPE_FLAG --unset http.https://github.com.curloptresolve"
    exit 1
fi
