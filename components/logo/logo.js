// Logo 组件 v1.0（PD 2026-08-09 终稿）
// 用法：<logo mode="wordmark" size="360" />  /  <logo mode="avatar" />  /  <logo mode="splash" dark />
// 形态：wordmark / avatar / avatar-circle / splash
// 自动跟随 app.globalData.effectiveTheme 切换浅深底；dark 属性可强制深底。

// mode 白名单——防拼错
var VALID_MODES = ['wordmark', 'avatar', 'avatar-circle', 'splash']

Component({
  options: {
    // 视觉组件应隔离样式，避免被页面污染
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 四种形态（wordmark 主标 / avatar 头像 / avatar-circle 圆形头像 / splash 启动屏横排）
    mode: {
      type: String,
      value: 'wordmark',
    },
    // 宽度 rpx（等比缩放，高度按 SVG 比例自动）
    size: {
      type: Number,
      value: 120,
    },
    // 强制深底（缺省 false → 跟随 app.globalData.effectiveTheme）
    dark: {
      type: Boolean,
      value: false,
    },
    // 流体宽度（true 时 width:100% 铺满父容器，忽略 size）
    fluid: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isDark: false,
  },

  lifetimes: {
    attached: function () {
      this._applyTheme()
    },
    detached: function () {
      try {
        if (wx.offThemeChange) wx.offThemeChange(this._onThemeChange)
      } catch (e) { /* ignore */ }
    },
  },
  observers: {
    // dark 属性变化或 app 主题刷新时重算
    'mode, dark': function () {
      this._applyTheme()
    },
  },

  methods: {
    /**
     * 计算当前应用深浅底：
     * 优先 dark 属性强制；否则读 app.globalData.effectiveTheme（单一事实源）。
     * 监听系统主题切换，跟随模式变化时实时刷新。
     */
    _applyTheme: function () {
      var dark = !!this.data.dark
      if (!dark) {
        try {
          var app = getApp()
          if (app && app.globalData && app.globalData.effectiveTheme) {
            dark = app.globalData.effectiveTheme === 'dark'
          }
        } catch (e) {
          try {
            var info = wx.getSystemInfoSync()
            dark = info.theme === 'dark'
          } catch (e2) { /* ignore */ }
        }
      }
      this.setData({ isDark: dark })

      // 注册系统主题监听（幂等）
      try {
        if (wx.onThemeChange && !this._themeBound) {
          this._themeBound = true
          this._onThemeChange = function (res) {
            // 仅跟随 app 主题时才需刷新（dark 强制时忽略系统切换）
            if (this.data.dark) return
            // note: onThemeChange 在组件内不触发 app.applyTheme 的广播，
            // 但 effectiveTheme 会变；直接重读
            this._applyTheme()
          }.bind(this)
          wx.onThemeChange(this._onThemeChange)
        }
      } catch (e) { /* ignore */ }
    },

    /**
     * 供外部在页面 onShow 里刷新（页面从设置页返回时主题可能已变）。
     * 页面可在 onShow 调 this.selectComponent('#x').refreshTheme()
     */
    refreshTheme: function () {
      this._applyTheme()
    },
  },
})
