Component({
  properties: {
    // 分类列表：[{ id, name }]，可含收藏项
    categories: {
      type: Array,
      value: [],
    },
    // 当前选中分类 id
    activeId: {
      type: String,
      value: '',
    },
  },

  data: {
    itemHeight: 72,      // 每项高度 rpx
    visibleCount: 6,     // 可视项数（v5.3-final: 7→6）
    anchorIndex: 1,      // 锚定第二行（0-based，顶部留 1 个分类名空间）
    touching: false,     // 是否触摸中（激活态）
    translateY: 0,       // 列表位移
    bounceOffset: 0,     // 越界弹性偏移（FE-1 / AC-RQ15-06：首/末项继续滑轻微弹跳）
  },

  observers: {
    'categories, activeId': function (cats, activeId) {
      if (!cats || !cats.length) return
      const idx = cats.findIndex(c => c.id === activeId)
      this._activeIndex = idx >= 0 ? idx : 0
      this._updateTranslate()
    },
  },

  lifetimes: {
    attached() {
      const h = this.data.itemHeight * this.data.visibleCount
      this.setData({ wheelHeight: h, listHeight: h })
      // BUG-20260807-001: 缓存 px→rpx 系数（750rpx = windowWidth px）。
      // itemHeight/translateY 均为 rpx，而触摸事件 clientY 为 px；
      // 兜底 2 对应 375px 屏（1rpx=0.5px），其余设备按真实 windowWidth 计算。
      try {
        this._px2rpx = 750 / wx.getSystemInfoSync().windowWidth
      } catch (e) {
        this._px2rpx = 2
      }
      this._activeIndex = 0
      this._updateTranslate()
    },
  },

  methods: {
    /**
     * BUG-20260806-008（D-02 v2.6 AC-RQ15-18）：根据当前选中索引计算 translateY
     * 修正：去掉 Math.max(0,·) clamp → ty = (anchorIndex - idx) * itemHeight
     *   - idx=0（全部）：ty = 1*itemHeight（列表下移 1 行，顶部留 1 个空行空间，不贴顶）
     *   - idx=1（科技）：ty = 0（选中项在第 2 行，顶部显示「全部」）
     *   - idx=2+：ty < 0（上移，选中项恒在第 2 行）
     * 越界弹性 bounce 叠加保留（AC-RQ15-06）
     */
    _updateTranslate: function () {
      var itemHeight = this.data.itemHeight
      var anchorIndex = this.data.anchorIndex   // 1
      var idx = this._activeIndex || 0
      var bounce = this.data.bounceOffset || 0
      // BUG-008①: 不 clamp，首类时列表下移顶部留空（AC-RQ15-18）
      var ty = (anchorIndex - idx) * itemHeight + bounce
      this.setData({ translateY: ty })
    },

    /** 震动（切换分类时） */
    _vibrate: function () {
      if (wx.vibrateShort) {
        wx.vibrateShort({ type: 'light', fail: () => {} })
      }
    },

    /** 当前列表基础位移（无 bounce）：anchor 锚定位置 */
    _baseTranslate: function (idx) {
      return (this.data.anchorIndex - idx) * this.data.itemHeight
    },

    onTouchStart: function (e) {
      const touch = e.touches && e.touches[0]
      if (!touch) return
      this._startY = touch.clientY
      this._startIndex = this._activeIndex || 0
      // BUG-008③: 记录起始基础位移（含当前 bounce），拖动时连续跟手
      this._startTranslate = this._baseTranslate(this._startIndex) + (this.data.bounceOffset || 0)
      this._lastVibrateIndex = this._startIndex
      this.setData({ touching: true })
    },

    onTouchMove: function (e) {
      const touch = e.touches && e.touches[0]
      if (!touch || this._startY === undefined) return
      const deltaY = touch.clientY - this._startY
      // BUG-20260807-001: px→rpx 换算。此前 deltaY(px) 直接与 itemHeight(rpx) 混算，
      // 在 375px 屏上阈值翻倍（下滑一格不触发）、跟手减半、Math.round 边界方向不对称。
      const deltaYRpx = deltaY * (this._px2rpx || 2)
      const { itemHeight } = this.data
      const len = (this.data.categories || []).length

      // BUG-008③（AC-RQ15-20）: 连续跟手位移 —— rawTranslate 直接跟随手指（无按格跳变）
      var rawTranslate = this._startTranslate + deltaYRpx
      // 浮点请求索引（仅用于高亮/change/震动 + 边界弹性判定）
      var rawIdx = this._startIndex - deltaYRpx / itemHeight
      var clamped = Math.max(0, Math.min(len - 1, Math.round(rawIdx)))

      // 位移：正常范围连续跟手；越界叠加弹性（FE-1 / AC-RQ15-06）
      var ty, bounce = 0
      if (rawIdx < 0) {
        // 首项越界：列表下移（弹性正偏移）
        bounce = -rawIdx * itemHeight * 0.2
        if (bounce > itemHeight * 0.25) bounce = itemHeight * 0.25
        ty = this._baseTranslate(0) + bounce
      } else if (rawIdx > len - 1) {
        // 末项越界：列表上移（弹性负偏移）
        bounce = -(rawIdx - (len - 1)) * itemHeight * 0.2
        if (bounce < -itemHeight * 0.25) bounce = -itemHeight * 0.25
        ty = this._baseTranslate(len - 1) + bounce
      } else {
        // 正常范围：连续跟随手指（AC-RQ15-20 核心）
        ty = rawTranslate
      }

      if (clamped !== this._activeIndex) {
        this._activeIndex = clamped
        this.triggerEvent('change', { category: this.data.categories[clamped].id, index: clamped })
        if (clamped !== this._lastVibrateIndex) {
          this._lastVibrateIndex = clamped
          this._vibrate()
        }
      }

      // 统一 setData：位移连续 + 弹性状态同步（一次 setData 减少渲染）
      if (bounce !== this.data.bounceOffset) {
        this.setData({ bounceOffset: bounce, translateY: ty })
      } else {
        this.setData({ translateY: ty })
      }
    },

    onTouchEnd: function () {
      this._startY = undefined
      this.setData({ touching: false })
      // FE-1：松手后弹性回弹（300ms 过渡），选中锚点不变
      if (this.data.bounceOffset !== 0) {
        this.setData({ bounceOffset: 0 })
      }
      // BUG-008③（AC-RQ15-20）: 松手 snap 到最近分类（300ms 缓动，wxml transition 恢复）
      // _activeIndex 已在 move 中实时对齐，_updateTranslate 计算最终位置
      this._updateTranslate()
    },
  },
})
