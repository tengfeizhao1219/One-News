#!/bin/bash
# ============================================================
# 「一页」One News - 项目日志自动更新脚本
# 每2小时由定时任务自动触发，生成最新项目状态日志
# ============================================================

set -euo pipefail

PROJECT_DIR="/workspace/One-News"
LOG_FILE="$PROJECT_DIR/docs/项目日志.md"
TIMESTAMP=$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S %Z')

cd "$PROJECT_DIR"

# 拉取最新代码（静默模式）
git pull origin main --ff-only 2>/dev/null || true

# 获取 Git 统计
LATEST_COMMIT=$(git log -1 --format="%h" 2>/dev/null || echo "N/A")
LATEST_COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "N/A")
LATEST_COMMIT_DATE=$(git log -1 --format="%ai" 2>/dev/null || echo "N/A")
TOTAL_COMMITS=$(git rev-list --count HEAD 2>/dev/null || echo "0")

# 获取文件统计
TOTAL_FILES=$(find . -type f -not -path './.git/*' | wc -l)
CODE_FILES=$(find . -type f \( -name "*.js" -o -name "*.wxml" -o -name "*.wxss" -o -name "*.json" \) -not -path './.git/*' -not -path './node_modules/*' | wc -l)
DOC_FILES=$(find ./docs -type f -name "*.md" 2>/dev/null | wc -l)
TEST_FILES=$(find ./test -type f -name "*.js" 2>/dev/null | wc -l)

# 获取测试统计
TOTAL_TESTS=$(grep -r "it\|test\|assert\|expect" ./test/*.js 2>/dev/null | wc -l || echo "0")

# 获取文档列表
DOC_LIST=$(find ./docs -name "*.md" -not -name "项目日志.md" 2>/dev/null | sort | while read f; do
  echo "  - \`${f#./}\`"
done)

# 获取迭代目录
ITERATIONS=$(ls -d docs/iteration-* 2>/dev/null | sort | while read d; do
  name=$(basename "$d")
  count=$(find "$d" -name "*.md" | wc -l)
  echo "  - **$name**：$count 个文档"
done)

# 获取 README 中检查清单状态
CHECKLIST_STATUS=$(grep -E '^\- \[(x| )\]' README.md 2>/dev/null | head -10 || echo "无检查清单")

cat > "$LOG_FILE" << EOF
# 「一页」项目日志

> **项目名称**：一页（One News）— 极简沉浸式微信小程序新闻阅读器  
> **自动更新**：每2小时 | **最近更新**：$TIMESTAMP  
> **项目仓库**：[tengfeizhao1219/One-News](https://github.com/tengfeizhao1219/One-News)  
> **微信 AppID**：wx1ccb4d171dd88162  
> **云环境**：cloud1-1g9313w0bb791de0  

---

## 📊 项目快照（$TIMESTAMP）

| 指标 | 数值 |
|------|------|
| Git 最新提交 | \`$LATEST_COMMIT\` — $LATEST_COMMIT_MSG |
| 提交时间 | $LATEST_COMMIT_DATE |
| 总提交数 | $TOTAL_COMMITS |
| 项目文件数 | $TOTAL_FILES |
| 代码文件数 | $CODE_FILES |
| 文档文件数 | $DOC_FILES |
| 测试文件数 | $TEST_FILES |
| 测试用例（估算） | ~$TOTAL_TESTS |

---

## 🔍 上线检查清单状态

\`\`\`
$CHECKLIST_STATUS
\`\`\`

---

## 📁 迭代文档

$ITERATIONS

---

## 📄 完整文档清单

$DOC_LIST

---

## 🧪 测试套件

EOF

# 添加测试文件详情
for t in ./test/*.js; do
  if [ -f "$t" ]; then
    name=$(basename "$t")
    lines=$(wc -l < "$t")
    echo "  - \`test/$name\` ($lines 行)" >> "$LOG_FILE"
  fi
done

cat >> "$LOG_FILE" << EOF

---

## 🏗️ 项目结构

\`\`\`
One-News/
├── pages/
│   ├── home/           # 首页（卡片流 + 侧边栏）
│   └── detail/         # 详情页（支持上下翻页浏览）
├── cloudfunctions/     # 云函数
│   ├── getNewsList/
│   ├── getNewsDetail/
│   ├── searchNews/
│   └── refreshNews/
├── utils/              # 工具函数
│   ├── constants.js
│   ├── request.js
│   └── util.js
├── mock/               # Mock 数据
│   ├── ai-news-cache.js
│   ├── news.js
│   └── simulator.js
├── test/               # 回归测试（9套，~605 用例）
├── docs/               # 项目文档
├── scripts/            # 构建/工具脚本
├── images/             # 图片资源
└── demo/               # UI Demo
\`\`\`

---

## ⚙️ 关键配置

| 配置项 | 值 |
|--------|-----|
| 数据模式 | Mock（USE_MOCK=true） |
| 当前分支 | $(git branch --show-current 2>/dev/null || echo "main") |
| 最新提交 | \`$LATEST_COMMIT\` |
| 暗色模式 | 跟随系统 |
| 主包大小 | < 2MB |

---

## 📋 待办事项（来自项目文档）

| 优先级 | 事项 | 状态 |
|--------|------|------|
| 🔴 P0 | 清理诊断日志（onCardTap/onLoad 的 console.log） | 待做 |
| 🔴 P0 | 重新实现阅读模式（详情页上下滑切新闻） | 待做 |
| 🟡 P1 | 接入真实数据（切换 USE_MOCK=false，部署云函数） | 进行中（L4 天行分类路由已跑通） |
| 🟡 P1 | SOP 更新（WXS 语法红线 + return false 禁止） | 待做 |
| 🟢 P2 | v7 回归测试更新（适配最终实现） | 待做 |
| 🟢 P2 | 轮换百炼 API Key（曾硬编码入 Git 历史，已迁入保险库）+ GitHub PAT 轮换为 fine-grained（仅 One-News 仓库 write） | 待轮换（需仓库所有者操作） |

---

## 🔄 迭代历史

| 迭代 | 主题 | 关键交付 |
|------|------|---------|
| v0 | MVP 启动 | 卡片流阅读、侧边栏、搜索、暗色模式 |
| v1 | 产品/UX 优化 | 导航点、搜索入口、产品优化、UX 优化 |
| v2 | 设计评审 | 设计规范、线框图、视觉走查 |
| v3 | 代码审计 + Mock | 18 个代码问题修复、Mock 模拟器、34 条回归测试 |
| v4 | 新闻自动更新 | 云函数架构、百炼 DeepSeek 集成、AI 缓存、475 条测试 |
| v5 | 侧边栏卡死修复 | 根因：WXS 全屏拦截 + catchtouchmove 禁滚动；7 条架构测试 |
| v6 | Bug1/Bug2 修复 | 手势楔死 + 边界加载；25 条回归测试 |
| v7 | 阅读模式 | 详情页改造、跨分类串联、Mock 数据增强（当前进行中） |

---

## 🐛 已知 Bug 记录

| # | Bug 名称 | 严重程度 | 状态 |
|---|---------|---------|------|
| 1 | 侧边栏卡死 | 🔴 阻断 | ✅ 已修复 |
| 2 | 乱码（GBK编码） | 🔴 阻断 | ✅ 已修复 |
| 3 | 手势楔死 | 🔴 阻断 | ✅ 已修复 |
| 4 | 边界无反馈 | 🟡 体验 | ✅ 已修复 |
| 5 | WXS try/catch 回归 | 🔴 阻断 | ✅ 已修复 |
| 6 | bindtap 被阻止 | 🔴 阻断 | ✅ 已修复 |
| 7 | 详情页空页面 | 🔴 阻断 | ✅ 已修复 |
| 8 | 正文段落不分段 | 🟡 体验 | ✅ 已修复 |
| 9 | 对象字面量方法丢失 | 🔴 阻断 | ✅ 已修复 |
| 10 | 暗色模式真机不生效 | 🟡 体验 | ✅ 已修复 |

---

## 🔗 重要链接

- [GitHub 仓库](https://github.com/tengfeizhao1219/One-News)
- [PRD 文档](docs/iteration-0/PRD-新闻速览小程序.md)
- [技术方案](docs/iteration-2/技术方案文档.md)
- [测试用例](docs/iteration-5/测试用例终版.md)
- [上线操作指南](上线操作指南.md)
- [变更记录](docs/changelog/变更记录.md)

EOF

# ─── 敏感信息保险库（Secrets Vault）章节（引号 heredoc，避免 $()/反引号 被展开）───
cat >> "$LOG_FILE" <<'VAULT_EOF'

---

## 🔐 敏感信息保险库（Secrets Vault）

> **密钥管理准则**：所有密钥**不进代码、不进 Git 仓库（含提交历史）、不回显**；但可集中存放于 **tdrive 项目保险库（云盘）** `vault/`，供各角色会话按需取用。

| 项 | 值 |
|----|-----|
| 保险库位置 | tdrive 项目盘 `vault/`（dir_id = `NbXEQRsesdqd`） |
| 取用方式 | tdrive `file_download` 签发临时 URL → `curl` 落地临时文件 → `git -c url...insteadOf` 注入 |
| 权限要求 | 仓库公开：`git pull` 无需令牌；仅 `git push` 需从保险库取 `github_pat` |

### 当前存放的密钥

| 密钥 | 存放位置 | 用途 | 消费方 |
|------|----------|------|--------|
| `github_pat` | tdrive `vault/github_pat`（file_id `NJZQjYLZjTkW`） | GitHub 推送代码 | git remote（token 注入，不写入 remote 配置） |
| `bailian_api_key` | 阿里百炼控制台 → 云函数环境变量 `DASHSCOPE_API_KEY` | 阿里百炼 DeepSeek 联网搜索 | `cloudfunctions/common/config.js` |
| `tian_api_key` | 天行控制台 → 云函数环境变量 `TIAN_API_KEY` | 天行数据新闻接口（L4 降级源） | `cloudfunctions/common/config.js` |

### 从保险库取 github_pat 并推送（不回显、不落盘配置）

```bash
# 1) 经 tdrive file_download 取临时下载 URL，curl 到临时文件
curl -sSL -o /tmp/gh_pat "<tdrive 临时下载 URL>"
# 2) 用 insteadOf 注入令牌推送，结束后删除临时文件
TOKEN=$(cat /tmp/gh_pat | tr -d '[:space:]')
git -c "url.https://${TOKEN}@github.com/.insteadOf=https://github.com/" push origin main
rm -f /tmp/gh_pat
```

> ⚠️ 安全：早期版本曾将百炼 Key 硬编码于 `config.js` 并推入 Git 历史，已改为仅读环境变量。**请前往阿里百炼控制台轮换该 Key**。
> ⚠️ 当前 `github_pat` 为经典 PAT（≈整账户权限），**建议轮换为 fine-grained PAT**（仅 `One-News` 仓库 write 权限），并同步更新 tdrive 保险库中的 `github_pat`。

VAULT_EOF

# ─── 天行分类路由（方案 B）章节（引号 heredoc，避免 $()/反引号 被展开）───
cat >> "$LOG_FILE" <<'TIAN_EOF'

---

## 🗞️ 天行数据 · 分类路由（方案 B）

> `getNewsList` / `searchNews` 的第 4 层降级源。因 `allnews` 聚合接口未申请（code:160）且需 `col` 参数（code:280），改为**按一页分类直连已申请的分类专属 endpoint**。

**分类路由映射**（实测全部 code=200，每条带真实 sourceUrl，零占位符）：

| 一页分类 | 天行 endpoint | 状态 |
|----------|--------------|------|
| recommend（推荐） | `generalnews`（综合） | ✅ |
| tech（科技） | `keji`（科技） | ✅ |
| international（国际） | `world`（国际） | ✅ |
| sports（体育） | `generalnews`（兜底，tiyu 未申请） | ⚠️ |
| life（生活） | `generalnews`（兜底，无对应接口） | ⚠️ |
| agriculture（农业） | `nongye`（农业） | ✅ 新增独立分类 |
| science（科学） | `sicprobe`（科学探索） | ✅ 新增独立分类 |
| all（全部） | `generalnews` | ✅ |

**已确认可用的额外接口**（暂未映射，留作扩展）：`ai`(AI) / `it`(IT) / `internet`(互联网)。
**不可用**：`allnews`(需 col 参数) / `guonei`(160 未申请) / `tiyu`(160 未申请) / `shehui`(404)。

> 前端分类表 `utils/constants.js` 现含 8 项（all/recommend/tech/international/sports/life/agriculture/science），侧边栏经 `wx:for` 自动渲染。

**关键代码点**：
- `cloudfunctions/common/config.js`：`tian.baseUrl = https://apis.tianapi.com`（host 基址）
- `cloudfunctions/common/tianApi.js`：`callTianApi({ endpoint, ... })` → `${baseUrl}/${endpoint}/index`
- `cloudfunctions/common/adapter.js`：`APP_TO_TIAN_ENDPOINT` / `TIAN_ENDPOINTS_AVAILABLE`
- 密钥：天行控制台 → 云函数环境变量 `TIAN_API_KEY`（部署云函数时配置，不进 Git）

> 详见 [变更记录 CHG-012](docs/changelog/变更记录.md)。

TIAN_EOF

# ─── 页脚 ───
cat >> "$LOG_FILE" << EOF

---

*本文档由定时任务自动生成（每2小时更新） | 最近更新：$TIMESTAMP*
EOF

echo "✅ 项目日志已更新：$LOG_FILE"
echo "   时间戳：$TIMESTAMP"
echo "   最新提交：$LATEST_COMMIT"
