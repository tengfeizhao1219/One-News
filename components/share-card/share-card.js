// 分享卡片组件 — Canvas 生成分享卡片图 400×300
// 提供：
//   generateImage(category, isDark)                    → 分类主题色占位图（向后兼容）
//   generateShareImage({category,isDark,title,summary}) → AI 摘要分享图（FS-02 主路径）
// 供 detail.js onShareAppMessage 使用（同步读取缓存 dataUrl）

// S6: 「全部」与「推荐」合并为 all，分享卡片中保留 all 作为兜底分类
var CATEGORY_MAP = {
  all:          { light: '#FF3B30', dark: '#FF453A', name: '全部' },
  tech:         { light: '#007AFF', dark: '#60A5FA', name: '科技' },
  international:{ light: '#5856D6', dark: '#818CF8', name: '国际' },
  sports:       { light: '#FF9500', dark: '#F97316', name: '科学探索' },
  life:         { light: '#34C759', dark: '#34D399', name: '社会' },
  // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架（BUG-P1-011 闭环）
}

// 标题最多 2 行；摘要最多 6 行（超出画布高度省略）
var TITLE_MAX_LINES = 2
var SUMMARY_MAX_LINES = 6

Component({
  properties: {
    canvasWidth: { type: Number, value: 400 },
    canvasHeight: { type: Number, value: 300 },
  },

  data: {},

  lifetimes: {
    attached: function () {
      this._canvasReady = false
      this._initCanvas()
    },
  },

  methods: {
    _initCanvas: function () {
      var that = this
      var query = this.createSelectorQuery()
      query.select('#share-canvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          if (res && res[0] && res[0].node) {
            that._canvas = res[0].node
            that._ctx = that._canvas.getContext('2d')
            that._canvas.width = that.data.canvasWidth
            that._canvas.height = that.data.canvasHeight
            that._canvasReady = true
          }
        })
    },

    /**
     * 生成分类主题色占位图（向后兼容；无摘要时降级）
     * @param {string} category 分类 ID
     * @param {boolean} isDark 是否暗色模式
     * @returns {Promise<string>} base64 data URL
     */
    generateImage: function (category, isDark) {
      return this.generateShareImage({ category: category, isDark: isDark, title: '', summary: '' })
    },

    /**
     * 生成 AI 摘要分享图（FS-02 主路径）
     * 绘制：分类主题色背景 + 品牌小标 + 新闻标题（≤2 行）+ AI 摘要正文（≤6 行）+ 分类角标
     * @param {object} opts { category, isDark, title, summary }
     * @returns {Promise<string>} base64 data URL
     */
    generateShareImage: function (opts) {
      var that = this
      opts = opts || {}
      return new Promise(function (resolve, reject) {
        // 如果 Canvas 还没就绪，先等待
        if (!that._canvasReady || !that._ctx) {
          that._initCanvas()
          setTimeout(function () {
            that._doDraw(opts, resolve, reject)
          }, 100)
          return
        }
        that._doDraw(opts, resolve, reject)
      })
    },

    _doDraw: function (opts, resolve, reject) {
      var ctx = this._ctx
      var w = this.data.canvasWidth
      var h = this.data.canvasHeight
      var isDark = opts.isDark
      var category = opts.category
      var info = CATEGORY_MAP[category] || CATEGORY_MAP.all
      var bg = isDark ? info.dark : info.light
      var title = (opts.title || '').toString().trim()
      var summary = (opts.summary || '').toString().trim()

      try {
        // 背景
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)

        // 品牌小标（左上角）
        ctx.fillStyle = '#FFFFFF'
        ctx.globalAlpha = 0.9
        ctx.font = 'bold 22px "PingFang SC", sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('一页', 24, 20)
        ctx.globalAlpha = 1.0

        // 标题（≤2 行，超出省略）
        if (title) {
          ctx.fillStyle = '#FFFFFF'
          ctx.font = 'bold 26px "PingFang SC", sans-serif'
          var titleLines = this._wrapText(ctx, title, w - 48, 34)
          titleLines = titleLines.slice(0, TITLE_MAX_LINES)
          titleLines.forEach(function (line, i) {
            ctx.fillText(line, 24, 56 + i * 34)
          })
        }

        // AI 摘要（≤6 行，超出省略号）
        if (summary) {
          ctx.fillStyle = '#FFFFFF'
          ctx.globalAlpha = 0.92
          ctx.font = '18px "PingFang SC", sans-serif'
          var summaryStartY = (title ? 56 + Math.min(titleLines.length, TITLE_MAX_LINES) * 34 + 10 : 60)
          var summaryLines = this._wrapText(ctx, summary, w - 48, 26)
          summaryLines = summaryLines.slice(0, SUMMARY_MAX_LINES)
          var that = this
          summaryLines.forEach(function (line, i) {
            var display = line
            if (i === summaryLines.length - 1 && that._overflow(ctx, summary, w - 48, 26, SUMMARY_MAX_LINES)) {
              display = that._truncateWithEllipsis(ctx, line, w - 48)
            }
            ctx.fillText(display, 24, summaryStartY + i * 26)
          })
          ctx.globalAlpha = 1.0
        }

        // 分类角标（右下角）
        ctx.fillStyle = '#FFFFFF'
        ctx.globalAlpha = 0.7
        ctx.font = '16px "PingFang SC", sans-serif'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText('· ' + info.name + ' ·', w - 24, h - 16)
        ctx.globalAlpha = 1.0

        // 导出
        var dataUrl = this._canvas.toDataURL('image/png')
        resolve(dataUrl)
      } catch (e) {
        reject(e)
      }
    },

    /**
     * 按画布宽度换行（返回行数组）
     */
    _wrapText: function (ctx, text, maxWidth, lineHeight) {
      var chars = Array.from(text)
      var lines = []
      var current = ''
      for (var i = 0; i < chars.length; i++) {
        var test = current + chars[i]
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current)
          current = chars[i]
        } else {
          current = test
        }
      }
      if (current) lines.push(current)
      return lines.length ? lines : ['']
    },

    /**
     * 判断是否发生溢出（行数超过上限 → 需要省略号）
     */
    _overflow: function (ctx, text, maxWidth, lineHeight, maxLines) {
      var lines = this._wrapText(ctx, text, maxWidth, lineHeight)
      return lines.length > maxLines
    },

    /**
     * 单行截断 + 省略号
     */
    _truncateWithEllipsis: function (ctx, line, maxWidth) {
      if (ctx.measureText(line).width <= maxWidth) return line
      var chars = Array.from(line)
      var ellipsis = '…'
      var out = ''
      for (var i = 0; i < chars.length; i++) {
        var test = out + chars[i] + ellipsis
        if (ctx.measureText(test).width > maxWidth) {
          return out + ellipsis
        }
        out += chars[i]
      }
      return out + ellipsis
    },

    /**
     * 获取分类色（供外部引用）
     */
    getCategoryColor: function (category, isDark) {
      var info = CATEGORY_MAP[category] || CATEGORY_MAP.all
      return isDark ? info.dark : info.light
    },
  },
})
