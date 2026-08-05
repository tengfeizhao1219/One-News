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
      // 第二行锚定：选中项之上恒留 1 个分类名空间；首项时不上移
      var ty = -Math.max(0, idx - anchorIndex) * itemHeight
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
      idx = Math.max(0, Math.min(len - 1, idx))
      if (idx !== this._activeIndex) {
        this._activeIndex = idx
        this._updateTranslate()
        this.triggerEvent('change', { category: this.data.categories[idx].id, index: idx })
        if (idx !== this._lastVibrateIndex) {
          this._lastVibrateIndex = idx
          this._vibrate()
        }
      }
    },

    onTouchEnd: function () {
      this._startY = undefined
      this.setData({ touching: false })
      // snap：已实时对齐，无需额外处理；300ms 过渡回弹
      this._updateTranslate()
    },
  },
})
