# tools/vision — Agent 识图能力(ys365 视觉模型)

> 让不具备图像输入的 agent(如 deepseek-v4-flash)也能「看到」图片:
> 图片 → base64 → ys365 视觉模型 → 中文描述。
> 2026-08-24 建立,配合微信开发者工具 `simulator_screenshot` 可查看模拟器界面。

## 前置条件

- **Key**:`YS365_API_KEY`(存于 DSH 凭证 `~/.dsh/.credentials.yaml`,或环境变量)
- **ys365 中转**:`https://api.ys365.cyou/v1`(OpenAI 兼容),已实测可用
- 无需额外安装(node 内置 fetch)

## 用法

```bash
# 基本识图(默认模型 llama-3.2-11b-vision-instruct,自动中文描述)
node tools/vision/see-image.mjs <图片路径>

# 指定模型
node tools/vision/see-image.mjs <图片路径> nvidia/llama-3.1-nemotron-nano-vl-8b-v1

# 自定义提示词
node tools/vision/see-image.mjs <图片路径> <模型> "只提取图中的新闻标题列表"
```

## 与微信开发者工具联动(查看模拟器界面)

```bash
# 1. 截取模拟器画面(wechatide skill-cli,见 COMMLOG 2026-08-24 条目)
wechatide -c dsh simulator_screenshot --project "C:\Users\zteng\Desktop\One News"
#   → 返回 path(如 C:\Users\zteng\AppData\Local\Temp\wechatide-simulator-screenshot-xxx.jpg)

# 2. 识图
node tools/vision/see-image.mjs <上一步返回的 path>
```

## 可用视觉模型(ys365 实测)

| 模型 | 状态 | 说明 |
|---|---|---|
| `meta/llama-3.2-11b-vision-instruct` | ✅ 默认 | 中文界面识别良好(实测读出新闻标题) |
| `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` | ✅ 备选 | NVIDIA 视觉语言 |
| `nvidia/nemotron-nano-12b-v2-vl` | ✅ 备选 | 同上 |
| `deepseek-ai/deepseek-v4-flash-vision-exp` | ❌ 503 | DeepSeek 官方视觉模型,**ys365 未接入** |
| `deepseek-ai/deepseek-vl2` / `vl2.5` / `vl2-small` | ❌ 503 | 同上,待 ys365 接入后可用 |

## 注意事项

1. **curl 调用 ys365 需 `--ssl-no-revoke`**(Windows 证书吊销检查离线);node fetch 不受影响,本脚本用 fetch 正常
2. 图片过大时先压缩(建议长边 ≤1280,截图默认已是)
3. 视觉模型描述可能不 100% 精确——重要判断(如 UI 验收)可结合 `get_simulator_console`、DOM/automation 工具交叉验证
4. DeepSeek 官方视觉模型若需使用:等 ys365 接入,或单独申请 DeepSeek 官方 API key 直连
