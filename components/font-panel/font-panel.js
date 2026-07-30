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
      this.triggerEvent('close')
    },

    /**
     * 阻止遮罩层滚动穿透
     */
    noop: function () {},
  },
})
