# AI 信息源扩展调研（T2.6 · 2026-08-20）

> 目标：扩充中文源 + 主流 AI 厂商官方 + 博客/社区。全部 URL 已核实（web 调研）。
> 现状：23 源 active（A6/B3/C6/D2/F6）；质量分自动停用 3 源（techcrunch 0.3/theverge 3.5/HN 0）。

## 一、中文 AI 厂商官方源（用户最缺，全部建议接入，均无 RSS 需 scrape）

| 源 | 类型 | URL | 频率 | 优先级 |
|---|---|---|---|---|
| 通义千问/Qwen | 官方blog+HF | qwenlm.github.io/blog；huggingface.co/Qwen | 周 | 高 |
| 智谱AI | 官方blog | zhipuai.cn/zh/research；z.ai/blog | 周 | 高 |
| 火山引擎/豆包 | 官方新闻 | volcengine.com/news | 日-周 | 高 |
| 腾讯混元 | 官方blog | cloud.tencent.com/developer 专栏；hunyuan.tencent.com | 周 | 高 |
| MiniMax | 官方blog | minimaxi.com/blog；minimax.io/news | 周 | 高 |
| 月之暗面 Kimi | 官方blog | moonshotai.github.io；moonshot.cn | 月 | 高 |
| 面壁智能 | 官方blog | openbmb.cn/community/blogs | 月 | 高 |
| 阶跃星辰 | 官方 | platform.stepfun.com；stepfun.com | 月 | 高 |
| 商汤日日新 | 官方新闻 | sensetime.com/cn/news | 月 | 高 |
| 百度文心 | 官方新闻 | home.baidu.com 新闻动态 | 月 | 高 |
| 讯飞星火 | 官方新闻 | iflytek.com 新闻中心；xinghuo.xfyun.cn | 周 | 高 |

## 二、英文 AI 厂商官方（无原生 RSS，可引第三方 feed 或爬取）

xAI(x.ai/blog)、Mistral(mistral.ai/news)、Perplexity(perplexity.ai/hub/blog)、Cursor(cursor.com/changelog)、OpenRouter(openrouter.ai/blog)、Together AI、Fireworks AI、Cohere、vLLM(blog.vllm.ai)、Ollama(ollama.com/blog + GitHub releases)、Stability AI —— 优先级：xAI/Mistral/Perplexity/Cursor/Ollama 高，其余中。

## 三、中文媒体/社区

InfoQ 中文 AI(infoq.cn)、CSDN AI、36氪 AI(36kr.com/information/AI)、V2EX AI（公开 API v2ex.com/api/topics/show.json?node_name=ai，零成本，高）、掘金 AI(API 可用)、知乎 AI（反爬严，热榜 API）、新智元(aiera.com.cn，主公众号)、虎嗅/爱范儿（反爬中）｜**放弃**：即刻（App 内不可抓）、AI前线（仅公众号）

## 四、英文博客/社区/研究

Simon Willison（原生 RSS，AI 高频，**高**）、Lilian Weng Lil'Log（RSS）、Sebastian Raschka（RSS）、karpathy、Reddit r/LocalLLaMA + r/MachineLearning（公开 RSS，**高**）、a16z AI（原生 RSS）、VentureBeat AI（feed 有效，**建议恢复**）、TechCrunch AI（feed 有效，质量过滤后恢复）、LessWrong｜**放弃**：The Information（付费墙）、即刻

## 五、RSS 捷径（减少自建爬虫）

- github.com/alan-turing-institute/ai-rss-feeds（mistral/cohere/anthropic 等 feeds.opml）
- github.com/Olshansk/rss-feeds、github.com/0xSMW/rss-feeds

## 六、落地建议（分批）

- **第一批（中文官方 5-6 个）**：通义千问、智谱、火山引擎、腾讯混元、MiniMax、Kimi —— 写 scrape adapter
- **第二批（英文 + RSS 捷径）**：xAI、Mistral、Perplexity、Cursor、Ollama、Simon Willison、r/LocalLLaMA —— RSS 捷径优先
- **恢复**：VentureBeat AI（质量过滤后）
- 质量治理：quality<6 自动停用已生效（3 源）；周度质量报告并入 T8.1 周报
