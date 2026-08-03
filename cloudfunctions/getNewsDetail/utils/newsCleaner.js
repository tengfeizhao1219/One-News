/**
 * 新闻正文多层清洗流水线
 * ============================================================
 * 用于处理天行/聚合等第三方 API 返回的新闻正文中的噪音：
 *   - HTML 标签 / 实体
 *   - 分享引导语（扫码、朋友圈等）
 *   - 文末推荐阅读
 *   - 版权声明、责任编辑
 *   - 广告、JS 代码
 *   - 多余空白行
 * ============================================================
 */

/**
 * 基础 HTML 实体解码（轻量版，不依赖 he 库）
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&middot;/g, '\u00B7')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * 移除 HTML 标签和脚本
 */
function stripHtmlTags(text) {
  return text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
}

/**
 * 规范化空白字符
 */
function normalizeWhitespace(text) {
  return text
    .replace(/\u3000/g, ' ')       // 全角空格
    .replace(/\u00A0/g, ' ')       // 不间断空格
    .replace(/\r\n/g, '\n')        // Windows 换行
    .replace(/\r/g, '\n')          // Mac 旧式换行
    .replace(/[ \t]+\n/g, '\n')    // 行尾空白
    .replace(/\n[ \t]+/g, '\n')    // 行首空白
    .replace(/\n{3,}/g, '\n\n')    // 多个空行合并为两个
}

/**
 * 行内清理：去除段落中嵌入的括号包裹元信息
 *
 * 典型场景：正文段落末尾有「（责任编辑：王五）」「(编辑：张三)」
 * 这类噪音不在行首，整行过滤无法命中，需在内容级别做正则替换。
 */
function removeInlineBracketedMeta(text) {
  if (!text) return ''
  return text
    // 中文括号：全角（责任编辑：王五）→ 去除整个括号单元
    .replace(/[（(]\s*(责任编辑|编辑|作者|责编|审核|校对|监制|记者|通讯员)[：:]\s*\S{0,20}\s*[）)]/gi, '')
    // 行尾悬挂的括号（可能不成对）："正文……（责任编辑：王五"  → 去除
    .replace(/[（(]\s*(责任编辑|编辑|作者|责编|审核|校对|监制|记者|通讯员)[：:]\s*\S{0,20}$/gim, '')
    // 纯冒号形态行尾悬挂："正文……责任编辑：王五"
    .replace(/\s*(责任编辑|编辑|作者|责编|审核|校对|监制|记者|通讯员)[：:]\s*\S{0,20}\s*$/gim, '')
}

/**
 * 删除噪音行（分享引导、推荐阅读、版权声明、广告等）
 *
 * 使用行级匹配：每行单独检查，匹配到噪音行则整行移除。
 * 这样可以精确删除单行噪音，而不影响周围有效内容。
 */
function removeNoiseLines(text) {
  const noiseLinePatterns = [
    // ── 分享 / 关注引导 ──
    /^(扫码|长按|点击|打开|分享)[\s\S]{0,30}(朋友圈|微信|群|好友|分享)/i,
    /^(关注|订阅|添加)[\s\S]{0,30}(公众号|频道|微信|微博)/i,
    /^(转发|收藏)[\s\S]{0,20}(朋友圈|微信|微博)/i,

    // ── 推荐阅读（整行）──
    /^(推荐阅读|相关阅读|更多阅读|猜你喜欢|热门推荐|精彩推荐|为您推荐)[：:]/i,
    /^(相关新闻|相关文章|延伸阅读|扩展阅读|深度阅读)[：:]/i,

    // ── 括号包裹的责任编辑/编辑/作者（行首、行中、行尾均可）──
    /[（(]?(责任编辑|编辑|作者|责编|审核|校对|监制)[：:][^）)]*[）)]?/i,
    // ── 版权 / 来源（行首）──
    /^(版权声明|免责声明|特别声明|本文来源|文章来源)[：:]/i,
    /^(声明|责编|审核|校对|监制)[：:]/i,
    /^(本文|本网|本站)(内容|稿件|图片|版权|来源)/i,
    /^未经(许可|授权|允许)/i,

    // ── 广告 / 商务 ──
    /^(广告合作|商务合作|广告投放|广告热线|联系方式)[：:]/i,
    /^(招商|赞助|冠名)[：:]/i,

    // ── 纯空白行 / 分隔符行 ──
    /^[-=*_#]{5,}$/,
    /^[·•●○◎◇◆□■△▲※]{3,}$/,

    // ── 评论引导 ──
    /^(评论|留言)[\s\S]{0,20}(评论|留言|说两句)/i,
    /^以上(为|是|内容)/i,
    /^(欢迎|期待)[\s\S]{0,20}(留言|评论|讨论)/i,

    // ── 标签 / 关键词 ──
    /^(标签|关键词|话题)[：:]/i,

    // ── 页脚信息 ──
    /^返回(顶部|首页|上一页)/i,
    /^下一页[：:]/i,
    /^(当前|第)\d+页/i,
  ]

  const lines = text.split('\n')
  const cleaned = lines.filter(line => {
    const trimmed = line.trim()
    // 空行保留（后续统一处理）
    if (trimmed.length === 0) return true
    // 检查是否匹配噪音模式
    for (const pattern of noiseLinePatterns) {
      if (pattern.test(trimmed)) return false
    }
    return true
  })

  return cleaned.join('\n')
}

/**
 * 删除以"推荐阅读"等关键词开头的段落及其后续所有内容
 * （适用于噪音集中在文末的场景）
 */
function removeTrailingNoise(text) {
  const trailingPatterns = [
    /推荐阅读[：:][\s\S]*$/i,
    /相关阅读[：:][\s\S]*$/i,
    /更多阅读[：:][\s\S]*$/i,
    /猜你喜欢[：:][\s\S]*$/i,
    /热门推荐[：:][\s\S]*$/i,
    /特别推荐[：:][\s\S]*$/i,
    /广告合作[：:][\s\S]*$/i,
    /商务合作[：:][\s\S]*$/i,
    /版权声明[：:][\s\S]*$/i,
    /免责声明[：:][\s\S]*$/i,
  ]

  let result = text
  for (const pattern of trailingPatterns) {
    result = result.replace(pattern, '')
  }
  return result
}

/**
 * 从段落数组中提取前 N 段有意义的内容
 * 跳过短到不像正文的段落（如纯标点、单字）
 */
function extractMeaningfulParagraphs(paragraphs, minLength, maxCount) {
  const result = []
  for (const p of paragraphs) {
    const trimmed = p.trim()
    if (trimmed.length >= minLength) {
      result.push(trimmed)
      if (result.length >= maxCount) break
    }
  }
  return result
}

/**
 * 删除与标题重复、或纯元信息行（时间+来源）、或仅含来源名的段落
 * （v5.5：解决详情页"标题重复 + 来源元信息"问题）
 *
 * @param {string} text - 已经过前面清洗的段落文本（多行）
 * @param {Object} [options]
 * @param {string} [options.title] - 新闻标题（去除与标题相同/高度相似的段落）
 * @param {string} [options.source] - 新闻来源（去除仅含来源名的段落）
 * @returns {string}
 */
function removeRedundantParagraphs(text, options = {}) {
  if (!text) return ''
  const title = (options.title || '').trim()
  const source = (options.source || '').trim()

  const normalize = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()
  const titleNorm = normalize(title)
  const sourceNorm = normalize(source)

  const lines = text.split('\n')
  const cleaned = lines.filter(line => {
    const trimmed = line.trim()
    if (!trimmed) return true // 保留空行（后续段落规范化处理）

    // 元信息行检测（满足 A AND (B OR C) 则删除）：
    //  A. 包含日期模式（YYYY-MM-DD）
    //  B. 包含来源/作者/编辑/责编等关键词
    //  C. 段落较短（< 60 字）
    const hasDate = /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(trimmed)
    const hasSourceKeyword = /(来源|author|作者|编辑|责编|发表时间|发布日期|time|date)/i.test(trimmed)
    const isShort = trimmed.length < 60
    if (hasDate && (hasSourceKeyword || isShort)) return false

    // 1. 删与标题完全相同或高度相似（去除空白后比较）
    if (titleNorm && titleNorm.length >= 4) {
      const tn = normalize(trimmed)
      if (tn === titleNorm) return false
      // 段落仅是标题的子串或超串（极短且包含标题）
      if (tn.length >= 4 && (tn.includes(titleNorm) || titleNorm.includes(tn))) {
        return false
      }
    }

    // 2. 删纯元信息行（已在上面处理）

    // 3. 删仅含来源名的段落
    if (sourceNorm && sourceNorm.length >= 2) {
      const sn = normalize(trimmed)
      if (sn === sourceNorm) return false
      if (sn === normalize('来源：' + source) || sn === normalize('author：' + source)) return false
      // 段落极短（≤ 6 字）且包含来源名，视为噪音
      if (trimmed.length <= 6 && trimmed.includes(source)) return false
    }

    return true
  })

  return cleaned.join('\n')
}

/**
 * 主清洗函数
 *
 * @param {string} rawContent  原始正文（可能含 HTML）
 * @param {Object} [options]
 * @param {number} [options.maxLength=3000]  最大输出字符数
 * @param {boolean} [options.preserveParagraphs=true]  是否保留段落结构
 * @param {string} [options.title]  新闻标题（用于去除标题重复段落）
 * @param {string} [options.source]  新闻来源（用于去除来源元信息）
 * @returns {string}  清洗后的纯文本正文
 */
function cleanNewsContent(rawContent, options = {}) {
  if (!rawContent || typeof rawContent !== 'string') return ''

  const maxLength = options.maxLength || 3000
  const preserveParagraphs = options.preserveParagraphs !== false

  let text = rawContent

  // 第 1 层：HTML 实体解码
  text = decodeHtmlEntities(text)

  // 第 2 层：去除 HTML 标签
  text = stripHtmlTags(text)

  // 第 3 层：规范化空白
  text = normalizeWhitespace(text)

  // 第 4 层：行级噪音删除
  text = removeNoiseLines(text)

  // 第 5 层：尾部噪音删除
  text = removeTrailingNoise(text)

  // 第 5.2 层（v5.10 新增）：行内括号包裹元信息清理
  // 处理 "正文内容（责任编辑：王五）" 这类嵌在段落中的噪音
  text = removeInlineBracketedMeta(text)

  // 第 5.5 层（v5.5 新增）：去除标题重复 + 元信息 + 仅含来源的段落
  text = removeRedundantParagraphs(text, {
    title: options.title,
    source: options.source,
  })

  // 第 6 层：段落规范化
  if (preserveParagraphs) {
    const paragraphs = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    text = paragraphs.join('\n\n')
  } else {
    text = text.replace(/\n+/g, ' ').trim()
  }

  // 第 7 层：长度截断
  if (text.length > maxLength) {
    // 在最后一个完整句号/段落处截断
    const truncated = text.substring(0, maxLength)
    const lastPeriod = Math.max(
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('\n\n'),
      truncated.lastIndexOf('. '),
    )
    const cutPoint = lastPeriod > maxLength * 0.5 ? lastPeriod + 1 : maxLength
    text = text.substring(0, cutPoint).trim()
  }

  return text || ''
}

/**
 * 快速清洗（用于摘要），比完整清洗轻量
 * 仅做 HTML 标签移除 + 实体解码 + 空白规范化
 */
function cleanSummary(rawContent, maxLength = 200) {
  if (!rawContent || typeof rawContent !== 'string') return ''

  let text = rawContent

  // 解码 HTML 实体
  text = decodeHtmlEntities(text)

  // 去除 HTML 标签
  text = text.replace(/<[^>]+>/g, '')

  // 规范化空白
  text = text
    .replace(/\u3000/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 截断
  if (text.length > maxLength) {
    const truncated = text.substring(0, maxLength)
    const lastPeriod = truncated.lastIndexOf('。')
    text = lastPeriod > 0 ? truncated.substring(0, lastPeriod + 1) : truncated + '...'
  }

  return text
}

/**
 * 判断清洗后的内容是否"有效"（不是垃圾内容）
 * @returns {{ valid: boolean, reason: string }}
 */
function validateCleanedContent(text) {
  if (!text || text.trim().length < 30) {
    return { valid: false, reason: '内容过短（<30字符）' }
  }
  if (text.trim().length < 100 && !text.includes('。')) {
    return { valid: false, reason: '无完整句子' }
  }
  // 检查是否全是噪音关键词
  const noiseOnlyPatterns = [
    /^[\s\S]{0,50}(来源|转载|版权|声明|免责)[\s\S]{0,50}$/i,
    /^(推荐|相关|更多)[\s\S]{0,30}(阅读|新闻|文章)$/i,
  ]
  for (const pattern of noiseOnlyPatterns) {
    if (pattern.test(text.trim())) {
      return { valid: false, reason: '内容疑似纯噪音' }
    }
  }
  return { valid: true, reason: '' }
}

module.exports = {
  cleanNewsContent,
  cleanSummary,
  validateCleanedContent,
  decodeHtmlEntities,
  stripHtmlTags,
  normalizeWhitespace,
  removeNoiseLines,
  removeRedundantParagraphs,
  removeInlineBracketedMeta,
}
