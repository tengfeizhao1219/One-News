// see-image.mjs —— 通过 ys365 视觉模型识图
// ============================================================
// 用法:
//   node see-image.mjs <图片路径> [模型] [提示词]
// 默认模型: meta/llama-3.2-11b-vision-instruct
// 可用视觉模型(ys365 实测): meta/llama-3.2-11b-vision-instruct(默认,中文界面识别良好)
//   nvidia/llama-3.1-nemotron-nano-vl-8b-v1 / nvidia/nemotron-nano-12b-v2-vl(备选)
// Key 来源(按优先级): ① 环境变量 YS365_API_KEY ② DSH 凭证 ~/.dsh/.credentials.yaml
//   (DeepSeek 官方视觉模型 V4-Flash-Vision-Exp / VL2 系列: ys365 未接入, 503 no channel)
// ============================================================
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const imagePath = process.argv[2]
if (!imagePath) { console.error('usage: node see-image.mjs <image> [model] [prompt]'); process.exit(1) }
const model = process.argv[3] || 'meta/llama-3.2-11b-vision-instruct'
const prompt = process.argv[4] || '请详细描述这张图片的内容：整体界面、文字、元素布局、状态。如果是小程序界面，说明当前页面结构、可见文字、按钮、数据展示情况。用中文回答。'

// 读 key: 环境变量 → DSH credentials
let key = process.env.YS365_API_KEY || ''
if (!key) {
  const credPath = join(homedir(), '.dsh', '.credentials.yaml')
  if (existsSync(credPath)) {
    const cred = readFileSync(credPath, 'utf-8')
    const m = cred.match(/YS365_API_KEY\s*:\s*["']?([^"'\s]+)/)
    if (m) key = m[1]
  }
}
if (!key) { console.error('no YS365_API_KEY (env or ~/.dsh/.credentials.yaml)'); process.exit(1) }

// 图片 → base64 data URL
const buf = readFileSync(imagePath)
const ext = imagePath.split('.').pop().toLowerCase()
const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
const dataUrl = `data:${mime};base64,${buf.toString('base64')}`

const body = {
  model,
  messages: [
    { role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] },
  ],
  max_tokens: 1024,
  temperature: 0.3,
}

const res = await fetch('https://api.ys365.cyou/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const j = await res.json()
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, JSON.stringify(j).slice(0, 500))
  process.exit(1)
}
console.log(`模型: ${model} | 图片: ${imagePath} (${Math.round(buf.length / 1024)} KB)`)
console.log('--- 识别结果 ---')
console.log(j.choices?.[0]?.message?.content || '(空)')
