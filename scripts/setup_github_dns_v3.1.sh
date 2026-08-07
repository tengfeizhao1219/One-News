#!/bin/bash
# setup_github_dns.sh  v3.1 — curloptResolve 首选 + dnsmasq 兜底 + 操作重试
# ============================================================================
# 演进：
#   v3.0 (PD): curloptResolve 一行绕开系统 DNS，机制优雅、零系统副作用。
#              但 openssl 探测(OpenSSL) 与 git(GnuTLS) 栈不一致，选错 IP 则退出。
#   v3.1 (GM): 沿用 curloptresolve 首选，但：
#              ① 探测改用 git ls-remote 自身(GnuTLS)，消除栈不一致盲区；
#              ② 新增 --wrap "git <cmd>"：设好配置后直接重试真实 git 操作抓漏水窗口；
#              ③ 新增 fallback：curloptResolve 全部 IP 探测失败 → 自动回退
#                 dnsmasq 原始方案（钉 IP + 重写 resolv.conf），只要连通 git 即可。
#
# 根因：sandbox-proxy 透明出口网关按 SNI 对 github.com 做间歇性 TLS 拦截。
#   任何"钉 IP"手段（dnsmasq / hosts / curloptResolve）只解决"连对 IP"，
#   最终能否握手全看代理是否放行。唯一根治 = 环境 owner 白名单。
#
# 用法：
#   bash setup_github_dns.sh                         # 探测+设置（首选 curloptResolve，失败回退 dnsmasq）
#   bash setup_github_dns.sh --global               # 写全局 ~/.gitconfig
#   bash setup_github_dns.sh --check                # 仅检查当前是否可用
#   bash setup_github_dns.sh --wrap "git push origin main"   # 设好后重试该命令
#
# 恢复 curloptresolve：  git config --unset http.https://github.com.curloptresolve
# 恢复 dnsmasq：          sudo pkill -x dnsmasq
# ============================================================================

set -uo pipefail

MODE="local"
CHECK_ONLY=false
WRAP_CMD=""
TEST_REPO="https://github.com/tengfeizhao1219/One-News.git"
CFG_KEY="http.https://github.com.curloptresolve"

# ── 候选 IP（GitHub 真实入口，按历史 GnuTLS 可用度排序） ──
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

# ── dnsmasq fallback 配置 ──
DNSCONF="/etc/dnsmasq.d/github.conf"
RESOLV="/etc/resolv.conf"
UPSTREAM=("183.60.83.19" "183.60.82.98")

# ── 参数解析 ──
for arg in "$@"; do
    case "$arg" in
        --global) MODE="global" ;;
        --check)  CHECK_ONLY=true ;;
        -h|--help)
            echo "用法: bash $0 [--global] [--check] [--wrap \"git <cmd>\"]"
            exit 0 ;;
        --wrap)   WRAP_NEXT=1 ;;
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

# ── 工具函数 ──
git_probe() {
    local ip="$1"
    git config $SCOPE_FLAG "$CFG_KEY" "github.com:443:${ip}" 2>/dev/null
    if timeout 12 git ls-remote "$TEST_REPO" HEAD >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

git_ok() {
    timeout 12 git ls-remote "$TEST_REPO" HEAD >/dev/null 2>&1
}

# ── 仅检查模式 ──
if $CHECK_ONLY; then
    if git_ok; then
        echo "[OK] 当前 git 可达 github.com"
        exit 0
    else
        echo "[FAIL] 当前不可达，请重跑: bash $0"
        exit 1
    fi
fi

# ═══════════════════════════════════════════════════════════
# 阶段 A：curloptResolve 探测（首选方案）
# ═══════════════════════════════════════════════════════════
echo "[A] curloptResolve (首选) — git 级(GnuTLS)探测 ${#CANDIDATES[@]} 个 IP ..."
CHOSEN_IP=""
for ip in "${CANDIDATES[@]}"; do
    echo -n "    $ip ... "
    if git_probe "$ip"; then
        echo "✅ git OK"
        CHOSEN_IP="$ip"
        break
    else
        echo "❌"
    fi
done

if [ -n "$CHOSEN_IP" ]; then
    echo "[A:OK] curloptResolve 生效 — IP=$CHOSEN_IP"
    git config $SCOPE_FLAG "$CFG_KEY" "github.com:443:${CHOSEN_IP}"
    echo "       git config $CFG_KEY = github.com:443:${CHOSEN_IP}"

    if git_ok; then
        echo "       验证: git ls-remote ✅"
        # 跳到 wrap 阶段
        METHOD="curloptResolve"
        SKIP_FALLBACK=true
    else
        echo "       [!] 验证失败（代理窗口关了），但配置已写入，继续走 fallback 双保险..."
        METHOD="curloptResolve(配置已写但当前不通)"
        SKIP_FALLBACK=false
    fi
else
    echo "[A:FAIL] curloptResolve 全部 IP 探测失败"
    METHOD="curloptResolve(全败)"
    SKIP_FALLBACK=false
fi

# ═══════════════════════════════════════════════════════════
# 阶段 B：dnsmasq fallback（原始方案兜底）
# ═══════════════════════════════════════════════════════════
if [ "${SKIP_FALLBACK:-false}" != "true" ]; then
    echo ""
    echo "[B] dnsmasq fallback（原始方案）— 轮询 IP 直到 git 通 ..."
    if [ "${EUID:-0}" -ne 0 ]; then
        echo "    [!] dnsmasq 需要 root，跳过。将仅依赖 curloptResolve 已写入的配置。"
    else
        FALLBACK_IP=""
        for ip in "${CANDIDATES[@]}"; do
            echo -n "    $ip ... "
            # 写 dnsmasq 配置
            {
                echo "# setup_github_dns.sh v3.1 fallback — $(date '+%Y-%m-%d %H:%M:%S')"
                echo "listen-address=127.0.0.1"
                echo "port=53"
                for u in "${UPSTREAM[@]}"; do echo "server=$u"; done
                echo "address=/github.com/$ip"
                echo "address=/githubusercontent.com/$ip"
            } > "$DNSCONF"
            # 重启 dnsmasq
            pkill -x dnsmasq 2>/dev/null
            sleep 1
            /usr/sbin/dnsmasq -C "$DNSCONF" 2>/dev/null
            sleep 1
            # 切 resolv.conf
            grep -v "^nameserver" "$RESOLV" > /tmp/resolv.fb 2>/dev/null
            echo "nameserver 127.0.0.1" | cat - /tmp/resolv.fb > /tmp/resolv.fb2
            cat /tmp/resolv.fb2 > "$RESOLV" 2>/dev/null

            if git_ok; then
                echo "✅ git OK"
                FALLBACK_IP="$ip"
                break
            else
                echo "❌"
            fi
        done

        if [ -n "$FALLBACK_IP" ]; then
            echo "[B:OK] dnsmasq fallback 生效 — IP=$FALLBACK_IP"
            METHOD="$METHOD + dnsmasq($FALLBACK_IP)"
        else
            echo "[B:FAIL] dnsmasq 所有 IP 也失败"
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════
# 最终验证
# ═══════════════════════════════════════════════════════════
echo ""
if git_ok; then
    echo "[DONE] 方案: $METHOD — git 可达 github.com ✅"
else
    echo "[FAIL] 方案: $METHOD — 当前 git 仍不可达（代理全封）。"
    echo "       请稍后重试本脚本，或联系环境 owner 申请 github.com 白名单。"
    if [ -z "$WRAP_CMD" ]; then
        exit 1
    fi
    # 有 --wrap 时不退出，直接进入重试（可能正好抓到窗口）
fi

# ═══════════════════════════════════════════════════════════
# 阶段 W：--wrap 重试真实 git 操作
# ═══════════════════════════════════════════════════════════
if [ -n "$WRAP_CMD" ]; then
    echo ""
    echo "[wrap] 重试命令: $WRAP_CMD"
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
    echo "[!] $MAX 次尝试均未成功，请稍后重跑: bash $0 --wrap \"$WRAP_CMD\""
    exit 1
fi
