#!/usr/bin/env python3
"""
setup_github_dns.py  v2.1 — 真·IP 钉死探测 + 失败重试 + 快速路径
=====================================================================
⚠️ 已废弃（2026-08-05）：GM v2.1 的 dnsmasq 重方案已被 PD 的 curloptResolve
   方案取代并演进为 setup_github_dns.sh v3.1（git 原生、零系统副作用、对真实
   git 操作重试抓漏水窗口）。本文件仅留作 fallback 参考，请勿在新会话使用。
   新会话统一用：bash .github-scripts/setup_github_dns.sh [--wrap "git ..."]
=====================================================================
背景：
  本环境 sandbox-proxy 透明出口网关把 github.com DNS 重写为
  198.18.0.x（TEST-NET-2 sinkhole），且 HTTPS CONNECT 被白名单拦截。
  走本地 dnsmasq 强制重写真实 IP 绕过。

v2.0 的致命缺陷（已修复）：
  probe_git(ip) 里 curl 用 --resolve 钉死了 ip，但 git ls-remote
  **没有**钉 IP，走的是系统 DNS。一旦系统 DNS 指向 sinkhole，git
  探测必然失败 —— 候选 ip 参数对 git 探测形同虚设。且代理全死时
  脚本直接放弃，不利用"间歇性漏水"窗口。

v2.1 的核心修复：
  - 探测真·钉 IP：临时写 /etc/hosts 把 github.com 钉到候选 IP
    （glibc 解析 hosts 优先于 DNS/dnsmasq），git ls-remote 测的
    才是"这个 IP 到底通不通"。测完还原 hosts，不污染系统。
  - 失败重试：全部 IP 死亡时，按退避间隔重试整轮探测，抓住代理
    漏水窗口（实测拦截是间歇性的）。
  - 快速路径：当前已 git 可达则跳过探测直接报 OK（除非 --force）。
  - 缓存上次好 IP：/tmp/.github_dns_lastip，重试时优先尝试。

为什么必须 git 级探测（不能只信 curl）：
  curl 用 OpenSSL，git 用 GnuTLS，二者 TLS 栈不同。curl --resolve
  通 ≠ git GnuTLS 通。所以 v2.1 的真·钉 IP 探测只用 git ls-remote
  判定，curl 仅作廉价预筛（可能有假阳，git 才是最终裁决）。

用法：
  sudo python3 setup_github_dns.py          # 标准修复（含快速路径）
  sudo python3 setup_github_dns.py --force  # 强制重新探测（忽略缓存/快速路径）
  python3 setup_github_dns.py --dry-run     # 仅探测，不修改系统（安全）
  python3 setup_github_dns.py --check       # 快速检查当前是否 git 可达

幂等：重复运行会杀旧 dnsmasq 并重写配置，可安全重跑。
=====================================================================
"""
import subprocess, os, time, sys, argparse, concurrent.futures

# ── 候选 IP（GitHub 真实入口，按历史可用度排序，140.82.121.3 实测最稳） ──
CANDIDATES = [
    "140.82.121.3", "140.82.113.3", "140.82.116.4",
    "140.82.114.3", "140.82.121.4", "140.82.114.4",
    "20.205.243.166", "20.205.243.165",
]
# 全部死时的最大重试轮数 + 退避（秒）
MAX_RETRIES = 3
BACKOFF = [8, 16]  # 第 1/2 次重试前的等待
# 环境真实上游 DNS（非 github 域名走这里，确保通用外网不受影响）
UPSTREAM = ["183.60.83.19", "183.60.82.98"]
CONF = "/etc/dnsmasq.d/github.conf"
RESOLV = "/etc/resolv.conf"
HOSTS = "/etc/hosts"
CACHE = "/tmp/.github_dns_lastip"
# 用于 git 级探测的仓库（只读操作，不影响仓库）
TEST_REPO = "https://github.com/tengfeizhao1219/One-News.git"


# ── 辅助函数 ──

def run(cmd, timeout=None):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def git_reachable(repo=TEST_REPO, timeout=15):
    """用当前系统 DNS 解析跑 git ls-remote，返回 (ok, detail)"""
    try:
        r = subprocess.run(["git", "ls-remote", repo, "HEAD"],
                           capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "git timeout"
    if r.stdout.strip() and len(r.stdout.strip().split()[0]) == 40:
        return True, "git=OK"
    if "gnutls" in (r.stderr + r.stdout).lower():
        return False, "GnuTLS handshake failed"
    return False, f"git exit={r.returncode}"


def hosts_pin(ip):
    """临时把 github.com / githubusercontent.com 钉到 ip，返回原始内容备份。
    glibc 解析 /etc/hosts 优先于 DNS/dnsmasq，故 git 会解析到该 ip。"""
    orig = open(HOSTS).read()
    kept = [l for l in orig.splitlines()
            if "github.com" not in l and "githubusercontent" not in l]
    kept.append(f"{ip}\tgithub.com")
    kept.append(f"{ip}\tgithubusercontent.com")
    open(HOSTS, "w").write("\n".join(kept) + "\n")
    return orig


def hosts_restore(orig):
    try:
        open(HOSTS, "w").write(orig)
    except Exception:
        pass  # 还原失败也继续，dnsmasq 才是最终态


def probe_ip_truth(ip, repo=TEST_REPO, timeout=15):
    """真·钉 IP 探测：临时把 github.com 钉到 ip，跑 git ls-remote。
    返回 (ip, ok, detail)。测完还原 /etc/hosts。"""
    orig = hosts_pin(ip)
    try:
        ok, detail = git_reachable(repo, timeout)
        return ip, ok, detail
    finally:
        hosts_restore(orig)


def curl_prefilter(ip, timeout=8):
    """廉价预筛：curl --resolve 钉 IP 测 TLS 层，返回 (ip, ok, detail)。
    注意：curl(OpenSSL) 通 ≠ git(GnuTLS) 通，仅作预筛，git 才是裁决。"""
    r = subprocess.run(
        ["curl", "-sS", "--max-time", str(timeout), "--resolve",
         f"github.com:443:{ip}", "-o", "/dev/null", "-w", "%{http_code}",
         "https://github.com"],
        capture_output=True, text=True, timeout=timeout + 2,
    )
    code = r.stdout.strip()
    ok = code in ("200", "301", "302", "400")
    return ip, ok, f"curl={code or 'TIMEOUT'}"


def save_cache(ip):
    try:
        open(CACHE, "w").write(ip)
    except Exception:
        pass


def load_cache():
    try:
        ip = open(CACHE).read().strip()
        return ip if ip in CANDIDATES else None
    except Exception:
        return None


def rewrite_dns(ip):
    """用指定 IP 重写 dnsmasq 配置并重启"""
    lines = [
        f"# 由 setup_github_dns.py v2.1 生成 — {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "listen-address=127.0.0.1",
        "port=53",
    ]
    for u in UPSTREAM:
        lines.append(f"server={u}")
    lines.append(f"address=/github.com/{ip}")
    lines.append(f"address=/githubusercontent.com/{ip}")

    os.makedirs("/etc/dnsmasq.d", exist_ok=True)
    with open(CONF, "w") as f:
        f.write("\n".join(lines) + "\n")

    run(["pkill", "-x", "dnsmasq"])
    time.sleep(1)
    r = run(["/usr/sbin/dnsmasq", "-C", CONF])
    if r.returncode != 0:
        return False, f"dnsmasq 启动失败: {r.stderr[:120].strip()}"
    time.sleep(1)
    return True, "dnsmasq 启动成功"


def fix_resolv_conf():
    """切本机 DNS 到 127.0.0.1（resolv.conf 是 bind mount，用 cat 方式写）"""
    try:
        lines = open(RESOLV).read().splitlines()
        new_lines = [l for l in lines if not l.strip().startswith("nameserver")]
        new_lines.insert(0, "nameserver 127.0.0.1")
        tmp = "/tmp/resolv.new"
        with open(tmp, "w") as f:
            f.write("\n".join(new_lines) + "\n")
        with open(tmp, "r") as src:
            content = src.read()
        with open(RESOLV, "w") as dst:
            dst.write(content)
        os.unlink(tmp)
        return True
    except Exception:
        return False


def clean_hosts():
    """清理 /etc/hosts 中 github 条目（避免与 dnsmasq 冲突）"""
    try:
        hs = [l for l in open(HOSTS).read().splitlines()
              if "github.com" not in l and "githubusercontent" not in l]
        with open(HOSTS, "w") as f:
            f.write("\n".join(hs) + "\n")
    except Exception:
        pass


def detect_round():
    """一轮探测：返回 git 可达的 IP 列表（按候选顺序）。
    流程：并发 curl 预筛 → 顺序 git 真·钉 IP 探测 curled-OK 的子集。"""
    # 阶段 1：并发 curl 预筛（廉价、不碰 hosts）
    print(f"  [1/2] curl 预筛 {len(CANDIDATES)} 个候选 IP（并发）...")
    curl_ok = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(CANDIDATES)) as ex:
        futures = {ex.submit(curl_prefilter, ip): ip for ip in CANDIDATES}
        for fut in concurrent.futures.as_completed(futures):
            ip, ok, detail = fut.result()
            mark = "✅" if ok else "❌"
            print(f"        {mark} {ip:18s} {detail}")
            if ok:
                curl_ok.append(ip)
    if not curl_ok:
        print("  [!] curl 预筛全灭，跳过 git 探测")
        return []

    # 阶段 2：顺序 git 真·钉 IP 探测（hosts 钉死，逐一还原）
    print(f"  [2/2] git 真·钉 IP 探测 {len(curl_ok)} 个 curl-OK IP（顺序）...")
    reachable = []
    for ip in curl_ok:
        ip2, ok, detail = probe_ip_truth(ip)
        mark = "✅" if ok else "❌"
        print(f"        {mark} {ip2:18s} {detail}")
        if ok:
            reachable.append(ip2)
    return reachable


def quick_check():
    """快速检查当前 github.com 解析是否 git 可达"""
    try:
        r = run(["getent", "hosts", "github.com"], timeout=3)
        parts = r.stdout.strip().split()
        current = parts[0] if parts else "N/A"
    except Exception:
        current = "N/A"
    print(f"当前 DNS: github.com → {current}")
    ok, detail = git_reachable(timeout=10)
    if ok:
        print(f"[OK] git ls-remote 成功 — 当前配置可用")
        return True
    print(f"[FAIL] {detail} — 需要重新探测并切换 IP")
    return False


# ── 主流程 ──

def main():
    parser = argparse.ArgumentParser(description="GitHub DNS 修复脚本 v2.1")
    parser.add_argument("--dry-run", action="store_true", help="仅探测，不修改系统")
    parser.add_argument("--check", action="store_true", help="快速检查当前 IP 是否可用")
    parser.add_argument("--force", action="store_true", help="强制重新探测（忽略快速路径/缓存）")
    args = parser.parse_args()

    if os.geteuid() != 0 and not (args.check or args.dry_run):
        print("[!] 警告：非 root，dnsmasq/resolv.conf 写入可能失败。请 sudo 运行。")

    # ── 快速检查模式 ──
    if args.check:
        sys.exit(0 if quick_check() else 1)

    # ── 快速路径：当前已通则跳过（除非 --force） ──
    if not args.force:
        ok, detail = git_reachable(timeout=10)
        if ok:
            cur = run(["getent", "hosts", "github.com"], timeout=3).stdout.strip().split()[0] \
                if run(["getent", "hosts", "github.com"], timeout=3).stdout.strip() else "?"
            print(f"[OK] 当前已 git 可达（{detail}），无需修复。当前 IP={cur}")
            print("     如需强制重探，加 --force")
            sys.exit(0)

    # ── 探测 + 应用（带重试） ──
    tried_cache = False
    for attempt in range(MAX_RETRIES):
        if attempt > 0:
            wait = BACKOFF[attempt - 1] if attempt - 1 < len(BACKOFF) else BACKOFF[-1]
            print(f"\n[↻] 第 {attempt} 次重试，等待 {wait}s 抓住代理漏水窗口...")
            time.sleep(wait)

        print(f"\n=== 探测轮次 {attempt + 1}/{MAX_RETRIES} ===")
        reachable = detect_round()

        if reachable:
            # git 可达的 IP 按候选顺序；若缓存 IP 在其中则优先
            cached = load_cache()
            if cached and cached in reachable and not tried_cache:
                reachable.remove(cached)
                reachable.insert(0, cached)
                tried_cache = True

            print(f"\n[+] git 真·可达: {len(reachable)}/{len(CANDIDATES)} 个 — {reachable}")
            if args.dry_run:
                print("\n[DRY-RUN] 仅探测，不修改系统。")
                sys.exit(0)

            # 应用阶段：逐个尝试，最终用 git 验证（此时走 dnsmasq）
            used_ip = None
            for ip in reachable:
                print(f"\n[apply] 尝试 IP: {ip}")
                ok, msg = rewrite_dns(ip)
                if not ok:
                    print(f"    [!] {msg}")
                    continue
                print(f"    [+] {msg}")
                if not fix_resolv_conf():
                    print(f"    [!] resolv.conf 写入失败（bind mount）")
                    continue
                time.sleep(1)
                vok, vdetail = git_reachable(timeout=15)
                if vok:
                    used_ip = ip
                    save_cache(ip)
                    break
                print(f"    [!] 应用后 git 验证失败（{vdetail}），换下一个")

            if used_ip:
                clean_hosts()
                # 最终验证
                print(f"\n[DONE] GitHub DNS 修复完成 — IP={used_ip} — git 可正常访问")
                g = run(["getent", "hosts", "github.com"]).stdout.strip()
                print(f"    getent github.com: {g}")
                vok, vdetail = git_reachable(timeout=15)
                print(f"    git ls-remote: {'OK' if vok else 'FAIL'} ({vdetail})")
                m = run(["curl", "-sS", "--max-time", "10", "-o", "/dev/null",
                         "-w", "%{http_code}", "https://mirrors.tencent.com"])
                print(f"    curl 通用外网: {m.stdout.strip()} (应 200)")
                sys.exit(0)
            # 应用到全部可达 IP 都失败 → 进入下一轮重试
            print(f"\n[!] 本轮所有 git 可达 IP 应用后均失败，准备重试")
            continue

        print(f"\n[!] 本轮探测全灭（{len(CANDIDATES)} 个 IP 均不可达）")

    print(f"\n[FATAL] {MAX_RETRIES} 轮探测均失败，代理当前完全拦截 github.com。")
    print("    建议：稍后重试（利用漏水窗口），或联系环境 owner 申请 github.com 白名单。")
    sys.exit(1)


if __name__ == "__main__":
    main()
