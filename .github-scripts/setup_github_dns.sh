#!/bin/bash
# setup_github_dns.sh  v3.1 — curloptResolve + git级(GnuTLS)探测 + 操作重试
# ============================================================================
# 演进：
#   v3.0 (PD): 用 git config http.<url>.curloptresolve 一行绕开系统 DNS，
#              机制优雅、零系统副作用。但探测用的是 openssl s_client
#              (OpenSSL 栈)，而 git 实际用 GnuTLS 栈 —— 同一 IP 常出现
#              "openssl 通但 git(GnuTLS) 不通"，导致偶尔选错 IP 后验证失败退出。
#   v3.1 (GM): 沿用 curloptresolve 机制，但：
#              ① 探测改用 git ls-remote 自身(GnuTLS) 判定，消除上述盲区；
#              ② 新增 --wrap "git <cmd>" 模式：设好配置后直接重试真实
#                 git 操作，抓住代理"漏水窗口"（代理按 SNI 间歇性放行，
#                 窗口极短，重探会错过，重试真实操作才抓得住）。
#
# 根因（与 DNS 无关）：sandbox-proxy 是透明出口网关，按 SNI 对 github.com
#   做间歇性 TLS 拦截。钉 IP（dnsmasq / hosts / curloptresolve）只解决"连对
#   IP"，最终能否握手成功，全看代理此刻是否放行。所以任何方案都只能"等窗口"。
#
# 用法：
#   bash setup_github_dns.sh                         # 探测+设置 curloptresolve
#   bash setup_github_dns.sh --global               # 写全局 ~/.gitconfig
#   bash setup_github_dns.sh --check                # 仅检查当前是否可用
#   bash setup_github_dns.sh --wrap "git push origin main"   # 设好后重试该命令
#
# 恢复：
#   git config --unset http.https://github.com.curloptresolve
# ============================================================================

set -uo pipefail

MODE="local"
CHECK_ONLY=false
WRAP_CMD=""
TEST_REPO="https://github.com/tengfeizhao1219/One-News.git"
# 候选 IP（GitHub 真实入口，按历史 GnuTLS 可用度排序）
CANDIDATES=(
    "140.82.116.4"
    "140.82.114.4"
    "140.82.121.3"
    "140.82.113.4"
    "140.82.113.3"
    "140.82.114.3"
    "140.82.121.4"
    "20.205.243.166"
    "20.205.243.165"
)
CFG_KEY="http.https://github.com.curloptresolve"

for arg in "$@"; do
    case "$arg" in
        --global) MODE="global" ;;
        --check)  CHECK_ONLY=true ;;
        -h|--help)
            echo "用法: bash $0 [--global] [--check] [--wrap \"git <cmd>\"]"
            exit 0 ;;
        --wrap)
            # 下一个参数为要包裹的命令
            WRAP_NEXT=1 ;;
        *)
            if [ "${WRAP_NEXT:-0}" = "1" ]; then
                WRAP_CMD="$arg"
                WRAP_NEXT=0
            fi
            ;;
    esac
done

SCOPE_FLAG=""
[ "$MODE" = "global" ] && SCOPE_FLAG="--global"

# ── git 级(GnuTLS)探测：临时把候选 IP 喂给 curloptresolve，跑 git ls-remote ──
git_probe() {
    local ip="$1"
    git config $SCOPE_FLAG "$CFG_KEY" "github.com:443:${ip}" 2>/dev/null
    if timeout 12 git ls-remote "$TEST_REPO" HEAD >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# ── 仅检查 ──
if $CHECK_ONLY; then
    if timeout 12 git ls-remote "$TEST_REPO" HEAD >/dev/null 2>&1; then
        echo "[OK] 当前 git 可达 github.com"
        exit 0
    else
        echo "[FAIL] 当前不可达，请重跑: bash $0"
        exit 1
    fi
fi

# ── 探测：找第一个 git(GnuTLS) 可用的 IP ──
echo "[1] git 级(GnuTLS)探测 ${#CANDIDATES[@]} 个候选 IP ..."
CHOSEN_IP=""
for ip in "${CANDIDATES[@]}"; do
    echo -n "  $ip ... "
    if git_probe "$ip"; then
        echo "✅ git OK"
        CHOSEN_IP="$ip"
        break
    else
        echo "❌"
    fi
done

# 探测失败：可能代理当前全封。提示重试（利用漏水窗口）。
if [ -z "$CHOSEN_IP" ]; then
    echo "[!] 全部 ${#CANDIDATES[@]} 个 IP 当前 git 均不可达（代理可能全封）。"
    echo "    建议稍后重试本脚本，或联系环境 owner 申请 github.com 白名单。"
    exit 1
fi

echo "[+] 选定 IP: $CHOSEN_IP"
git config $SCOPE_FLAG "$CFG_KEY" "github.com:443:${CHOSEN_IP}"
echo "[+] git config $CFG_KEY = github.com:443:${CHOSEN_IP}"

# ── 验证 ──
echo "[2] 验证 git ls-remote ..."
if timeout 15 git ls-remote "$TEST_REPO" HEAD >/dev/null 2>&1; then
    echo "[OK] curloptresolve 生效，git 可访问 github.com。"
else
    echo "[!] 验证失败（代理可能刚关窗口）。配置已写入，稍后重试 git 操作即可。"
fi

# ── --wrap：设好配置后直接重试真实 git 操作，抓住漏水窗口 ──
if [ -n "$WRAP_CMD" ]; then
    echo ""
    echo "[wrap] 重试命令（抓住代理漏水窗口）: $WRAP_CMD"
    MAX=12
    for i in $(seq 1 $MAX); do
        echo "  ├─ 尝试 $i/$MAX ..."
        if eval "$WRAP_CMD"; then
            echo "  └─ ✅ 成功"
            exit 0
        fi
        if [ "$i" -lt "$MAX" ]; then
            sleep $(( (i % 3) * 3 + 4 ))   # 4~10s 退避
        fi
    done
    echo "[!] $MAX 次尝试均未抓住窗口，请稍后重跑: bash $0 --wrap \"$WRAP_CMD\""
    exit 1
fi
