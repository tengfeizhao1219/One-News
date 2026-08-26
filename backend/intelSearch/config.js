/**
 * intelSearch 配置（部署副本内嵌，与 intelProcess 同构）
 * key 从 process.env 读（函数 env 已配置 ZHIPU_API_KEY/DEEPSEEK_API_KEY）
 * 2026-08-24：移除 Qwen（owner 决策，DASHSCOPE_API_KEY 不再使用）
 */
module.exports = {
  zhipuSummary: { apiKey: process.env.ZHIPU_API_KEY || '', model: 'glm-4-flash' },
  deepseek: { apiKey: process.env.DEEPSEEK_API_KEY || '', model: 'deepseek-chat' },
  hunyuan: { enabled: true, model: 'hy3', timeout: 8000, maxInputChars: 2000 },
}
