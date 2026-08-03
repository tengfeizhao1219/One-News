// 分享卡片组件 — Canvas 生成 8 分类主题色占位图 400×300
// 提供 generateImage(category, isDark) → Promise<string> 供 detail.js onShareAppMessage 使用

// S6: 「全部」与「推荐」合并为 all，分享卡片中保留 all 作为兜底分类
var CATEGORY_MAP = {
  all:          { light: '#FF3B30', dark: '#FF453A', name: '全部' },
  tech:         { light: '#007AFF', dark: '#60A5FA', name: '科技' },
  international:{ light: '#5856D6', dark: '#818CF8', name: '国际' },
  sports:       { light: '#FF9500', dark: '#F97316', name: '体育' },
  life:         { light: '#34C759', dark: '#34D399', name: '生活' },
  // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架（BUG-P1-011 闭环）
}

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
     * 生成分类主题色占位图
     * @param {string} category 分类 ID
     * @param {boolean} isDark 是否暗色模式
     * @returns {Promise<string>} base64 data URL
     */
    generateImage: function (category, isDark) {
      var that = this
      return new Promise(function (resolve, reject) {
        // 如果 Canvas 还没就绪，先等待
        if (!that._canvasReady || !that._ctx) {
          that._initCanvas()
          setTimeout(function () {
            that._doDraw(category, isDark, resolve, reject)
          }, 100)
          return
        }
        that._doDraw(category, isDark, resolve, reject)
      })
    },

    _doDraw: function (category, isDark, resolve, reject) {
      var ctx = this._ctx
      var w = this.data.canvasWidth
      var h = this.data.canvasHeight
      var info = CATEGORY_MAP[category] || CATEGORY_MAP.all
      var bg = isDark ? info.dark : info.light

      try {
        // 背景
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)

        // 品牌文字
        ctx.fillStyle = '#FFFFFF'
        ctx.font = 'bold 36px "PingFang SC", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('一页', w / 2, h / 2 - 24)

        // 分类名
        ctx.globalAlpha = 0.7
        ctx.font = '20px "PingFang SC", sans-serif'
        ctx.fillText('· ' + info.name + ' ·', w / 2, h / 2 + 24)
        ctx.globalAlpha = 1.0

        // 导出
        var dataUrl = this._canvas.toDataURL('image/png')
        resolve(dataUrl)
      } catch (e) {
        reject(e)
      }
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
