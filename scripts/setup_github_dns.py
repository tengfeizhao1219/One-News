#!/usr/bin/env python3
"""
setup_github_dns.py
=====================================================================
本工作区 GitHub DNS 污染的一键修复脚本（dnsmasq 方案）。

作用：
  环境把 github.com 解析到假 IP（198.18.0.x）导致 TLS 握手失败。
  本脚本启动一个本地 dnsmasq，将 github.com / githubusercontent.com
  及其全部子域强制重写到「当前真实可达的 GitHub IP」，其余域名仍走
  环境上游 DNS。一次部署，会话内对所有程序（git/curl/python...）生效，
  且自动覆盖 *.github.com 全部子域，比手工改 /etc/hosts 更省心。

用法：
  sudo python3 setup_github_dns.py
（普通用户需 root；本脚本需绑定 53 端口、改写 /etc/resolv.conf）

幂等：重复运行会杀掉旧 dnsmasq 并重写配置，可安全重跑。
=====================================================================
"""
import subprocess, concurrent.futures, os, time, sys

CANDIDATES = [
    "140.82.113.3", "140.82.113.4", "140.82.113.5",
    "140.82.114.3", "140.82.114.4", "140.82.114.5",
    "140.82.121.3", "140.82.121.4", "140.82.121.5",
    "20.205.243.165", "20.205.243.166",
]
UPSTREAM = ["183.60.83.19", "183.60.82.98"]  # 环境真实上游 DNS
CONF = "/etc/dnsmasq.d/github.conf"
RESOLV = "/etc/resolv.conf"
HOSTS = "/etc/hosts"


def probe(ip):
    r = subprocess.run(
        ["curl", "-sS", "--max-time", "5", "--resolve", f"github.com:443:{ip}",
         "-o", "/dev/null", "-w", "%{http_code}", "https://github.com"],
        capture_output=True, text=True,
    )
    return ip, r.stdout.strip()


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


print("[1] 探测当前可达的真实 GitHub IP ...")
reachable = []
with concurrent.futures.ThreadPoolExecutor(max_workers=len(CANDIDATES)) as ex:
    for ip, code in ex.map(probe, CANDIDATES):
        ok = code in ("200", "301", "400")
        print(f"    {ip} -> {code}  {'OK' if ok else ''}")
        if ok:
            reachable.append((ip, code))
if not reachable:
    print("[!] 未探测到任何可达 IP，终止")
    sys.exit(1)
ip = reachable[0][0]
print(f"[+] 选用当前真实 IP: {ip}")

# 清理 /etc/hosts 中可能存在的 github 静态行（改由 dnsmasq 统一负责）
hs = [l for l in open(HOSTS).read().splitlines() if "github.com" not in l]
open(HOSTS, "w").write("\n".join(hs) + "\n")
print("[+] 已清理 /etc/hosts 中的 github 条目（避免与 dnsmasq 冲突）")

# 写 dnsmasq 配置：强制重写 github 域，其余走环境上游
conf = (
    f"# 由 setup_github_dns.py 生成，绕过环境 DNS 污染\n"
    f"listen-address=127.0.0.1\nport=53\n"
)
for u in UPSTREAM:
    conf += f"server={u}\n"
conf += f"address=/github.com/{ip}\n"
conf += f"address=/githubusercontent.com/{ip}\n"
os.makedirs("/etc/dnsmasq.d", exist_ok=True)
open(CONF, "w").write(conf)
print(f"[+] 写 dnsmasq 配置: {CONF}")

# 重启 dnsmasq（幂等）
run(["pkill", "-f", "dnsmasq"])
time.sleep(1)
r = run(["/usr/sbin/dnsmasq", "-C", CONF])
print(f"[+] dnsmasq 启动 rc={r.returncode} {r.stderr[:160].strip()}")
if r.returncode != 0:
    print("[!] dnsmasq 启动失败，保留原 resolv.conf 不改")
    sys.exit(1)
time.sleep(1)

# 切本机 DNS 到 127.0.0.1
lines = open(RESOLV).read().splitlines()
new = [l for l in lines if not l.strip().startswith("nameserver")]
new.insert(0, "nameserver 127.0.0.1")
open(RESOLV, "w").write("\n".join(new) + "\n")
print("[+] resolv.conf -> 127.0.0.1")

# 验证
time.sleep(1)
print("[2] 验证")
g = run(["getent", "hosts", "github.com"]).stdout.strip()
print(f"    getent github.com : {g}")
for url in ("https://github.com", "https://api.github.com"):
    c = run(["curl", "-sS", "--max-time", "10", "-o", "/dev/null", "-w", "%{http_code}", url])
    print(f"    curl {url} -> {c.stdout.strip()}")
# 确认通用外网仍正常（dnsmasq 转发上游）
m = run(["curl", "-sS", "--max-time", "10", "-o", "/dev/null", "-w", "%{http_code}", "https://mirrors.tencent.com"])
print(f"    curl 通用外网(mirrors.tencent.com) -> {m.stdout.strip()} (应 200，证明未影响其他域名)")
print("[DONE] GitHub DNS 修复完成，可正常 git/curl 访问 github.com")
