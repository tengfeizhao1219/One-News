// 字体面板组件 — 底部半屏字号设置
// 4 档：标准(0) / 大(1) / 特大(2) / 超大(3)
// 选中即生效，点击遮罩关闭

var app = getApp()

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    currentTier: {
      type: Number,
      value: 0,
    },
  },

  data: {
    // UX-FIX06: 预览文字按档位比例缩放（28rpx 基准 × scaleMap[tier] 四舍五入取整）
    // 档位映射：标准 28×1.0=28 / 大 28×1.15≈32 / 特大 28×1.3≈36 / 超大 28×1.5=42
    tiers: [
      { value: 0, label: '标准', previewSize: 28 },
      { value: 1, label: '大',   previewSize: 32 },
      { value: 2, label: '特大', previewSize: 36 },
      { value: 3, label: '超大', previewSize: 42 },
    ],
  },

  methods: {
    /**
     * 选择档位：即时生效，无确认按钮
     */
    onSelectTier: function (e) {
      var tier = Number(e.currentTarget.dataset.tier)
      if (tier === this.data.currentTier) return

      // 通过 app 全局方法设置（持久化 + 广播）
      if (app && typeof app.setFontScale === 'function') {
        app.setFontScale(tier)
      }

      // 触发父页面更新 currentTier
      this.triggerEvent('change', { tier: tier })
    },

    /**
     * 关闭面板（点击遮罩）
     */
    onClose: function () {
      clearTimeout(this._autoCloseTimer)
      this.triggerEvent('close')
    },

    /**
     * 阻止遮罩层滚动穿透
     */
    noop: function () {},

    /**
     * 用户触摸面板内部时重置自动关闭定时器（3s）
     */
    _resetAutoClose: function () {
      var that = this
      clearTimeout(that._autoCloseTimer)
      that._autoCloseTimer = setTimeout(function () {
        that.onClose()
      }, 3000)
    },
  },

  // UX-FIX01: visible 变为 true 时启动 3s 自动关闭定时器
  observers: {
    'visible': function (val) {
      if (val) {
        this._resetAutoClose()
      } else {
        clearTimeout(this._autoCloseTimer)
      }
    },
  },
})
