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
      this._activeIndex = 0
      this._updateTranslate()
    },
  },

  methods: {
    /** 根据当前选中索引计算 translateY（顶部第二行锚定，owner v5.3-final 裁定） */
    _updateTranslate: function () {
      var itemHeight = this.data.itemHeight
      var anchorIndex = this.data.anchorIndex   // 1
      var idx = this._activeIndex || 0
      var bounce = this.data.bounceOffset || 0  // FE-1：越界弹性偏移叠加
      // 第二行锚定：选中项之上恒留 1 个分类名空间；首项时不上移
      var ty = -Math.max(0, idx - anchorIndex) * itemHeight + bounce
      this.setData({ translateY: ty })
    },

    /** 震动（切换分类时） */
    _vibrate: function () {
      if (wx.vibrateShort) {
        wx.vibrateShort({ type: 'light', fail: () => {} })
      }
    },

    onTouchStart: function (e) {
      const touch = e.touches && e.touches[0]
      if (!touch) return
      this._startY = touch.clientY
      this._startIndex = this._activeIndex || 0
      this._lastVibrateIndex = this._startIndex
      this.setData({ touching: true })
    },

    onTouchMove: function (e) {
      const touch = e.touches && e.touches[0]
      if (!touch || this._startY === undefined) return
      const deltaY = touch.clientY - this._startY
      const { itemHeight } = this.data
      const len = (this.data.categories || []).length
      // 手指下移 → 列表下移 → 选中项索引减小；反之增大
      const deltaIndex = Math.round(deltaY / itemHeight)
      let idx = this._startIndex - deltaIndex
      const clamped = Math.max(0, Math.min(len - 1, idx))

      // FE-1（AC-RQ15-06）：首/末项继续滑 → 轻微弹性偏移（bounce），不切换分类
      var bounce = 0
      if (idx !== clamped) {
        // overscroll>0 = 越过末项（请求索引更大）；overscroll<0 = 越过首项
        var overscroll = idx - clamped
        var maxBounce = itemHeight * 0.25   // 视觉位移上限（72rpx 项高 → 18rpx）
        // 越界方向与列表位移相反：首项越界（idx<0）列表下移（bounce>0），末项越界列表上移（bounce<0）
        bounce = -overscroll * itemHeight * 0.2
        if (bounce > maxBounce) bounce = maxBounce
        if (bounce < -maxBounce) bounce = -maxBounce
      }
      var bounceChanged = bounce !== this.data.bounceOffset
      if (bounceChanged) {
        this.setData({ bounceOffset: bounce })
      }

      if (clamped !== this._activeIndex) {
        this._activeIndex = clamped
        this._updateTranslate()
        this.triggerEvent('change', { category: this.data.categories[clamped].id, index: clamped })
        if (clamped !== this._lastVibrateIndex) {
          this._lastVibrateIndex = clamped
          this._vibrate()
        }
      } else if (bounceChanged) {
        // 仅越界偏移变化时刷新位移（含 bounce 归零场景）
        this._updateTranslate()
      }
    },

    onTouchEnd: function () {
      this._startY = undefined
      this.setData({ touching: false })
      // FE-1：松手后弹性回弹（300ms 过渡），选中锚点不变
      if (this.data.bounceOffset !== 0) {
        this.setData({ bounceOffset: 0 })
      }
      // snap：已实时对齐，无需额外处理；300ms 过渡回弹
      this._updateTranslate()
    },
  },
})
