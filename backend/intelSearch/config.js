/**
 * intelSearch 配置（部署副本内嵌，与 intelProcess 同构）
 * key 从 process.env 读（函数 env 已配置 ZHIPU_API_KEY/DEEPSEEK_API_KEY/DASHSCOPE_API_KEY）
 */
module.exports = {
  zhipuSummary: { apiKey: process.env.ZHIPU_API_KEY || '', model: 'glm-4-flash' },
  qwen: { apiKey: process.env.DASHSCOPE_API_KEY || '', model: 'qwen3.7-flash' },
  deepseek: { apiKey: process.env.DEEPSEEK_API_KEY || '', model: 'deepseek-chat' },
  hunyuan: { enabled: true, model: 'hy3', timeout: 8000, maxInputChars: 2000 },
}
