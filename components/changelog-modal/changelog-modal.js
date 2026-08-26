// changelog-modal v1.0（FS 2026-08-09 · 代码层联动 PD Logo v1.0）
// 用法：<changelog-modal visible="{{showModal}}" latest="{{latest}}" bindclose="onClose" />
// 属性：
//   visible  - Boolean，是否展示弹窗
//   latest   - Object，当前版本日志对象 {version,date,sections}（可选，缺省显示 currentVersion）
// 事件：close - 用户点击遮罩 / 知道了

var app = getApp()
var changelog = require('../../config/changelog')

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    latest: {
      type: Object,
      value: null,
    },
  },

  data: {
    // 弹窗内容
    version: '',
    date: '',
    sections: [],
    isDark: false,
    progressPercent: 0,   // 2026-08-26: 顶部横条进度(版本日志滚动),替代侧边滚动条
    // 动画
    animShow: false,
  },

  observers: {
    // visible 变化 → 入场 / 离场动画
    visible: function (v) {
      var self = this
      if (v) {
        this.setData({ isDark: this._isSystemDark() })
        // 刷新 logo 组件主题：modal 常驻 DOM，attached 只执行一次。
        // 手动切换主题后打开弹窗时，logo 内部 isDark 可能滞留旧值，
        // 主动调用 refreshTheme 让其重新读取 app.globalData.effectiveTheme。
        var logoComp = this.selectComponent('#modal-logo')
        if (logoComp && typeof logoComp.refreshTheme === 'function') {
          logoComp.refreshTheme()
        }
        var latest = this.data.latest || {
          version: changelog.currentVersion,
        }
        // 如果 latest 只有 version 字段，补全日期 + sections
        if (!latest.sections) {
          var found = changelog.versions.find(function (item) {
            return item.version === latest.version
          }) || null
          if (found) {
            latest = found
          }
        }
        this.setData({
          version: latest.version,
          date: latest.date || '',
          sections: latest.sections || [],
          animShow: true,
        })
        // 延迟一帧后触发滚动监听（防抖）
        setTimeout(function () {
          if (self.data.scrollHeight) {
            self.setData({ showScrollTip: false })
          }
        }, 300)
      } else {
        this.setData({ animShow: false })
      }
    },
    latest: function () {
      if (this.data.visible) this.setData({})
    },
  },

  methods: {
    _isSystemDark: function () {
      try {
        if (app && app.globalData && app.globalData.effectiveTheme) {
          return app.globalData.effectiveTheme === 'dark'
        }
        var info = wx.getSystemInfoSync()
        return info.theme === 'dark'
      } catch (e) {
        return false
      }
    },

    // 点击遮罩关闭（阻止冒泡在卡片上）
    onOverlayTap: function () {
      this.triggerEvent('close')
    },

    onCardTap: function (e) {
      // 阻止冒泡 → 卡片点击不关闭
      e.stopPropagation ? e.stopPropagation() : null
    },

    onKnowTap: function () {
      this.triggerEvent('close')
    },

    // 顶部横条进度(2026-08-26 家族化:替代侧边滚动条)
    onScroll: function (e) {
      if (!this._cmClient) {
        var self = this
        wx.createSelectorQuery().in(this).select('.cm-body').boundingClientRect().exec(function (res) {
          if (res && res[0] && res[0].height > 0) self._cmClient = res[0].height
        })
      }
      var st = e.detail.scrollTop
      var sh = e.detail.scrollHeight
      var max = sh - (this._cmClient || 520)
      var pct = max > 0 ? Math.min(100, parseFloat((st / max * 100).toFixed(1))) : 0
      if (pct !== this._lastPct) {
        this._lastPct = pct
        this.setData({ progressPercent: pct })
      }
    },

    // 刷新主题（页面从设置页返回时调用）
    refreshTheme: function () {
      this.setData({ isDark: this._isSystemDark() })
    },
  },
})
