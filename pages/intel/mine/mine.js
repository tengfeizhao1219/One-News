// INTEL-MODULE: AI 情报官 · 我的
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// T5.1 接入：
//   - 「我的身份画像」改为可点「编辑画像」按钮 → 跳 onboard
//   - 「合规」改为授权状态卡 + 撤销授权按钮
// 数据契约与 T5.2 后端对齐：getIntelProfile / saveIntelProfile。
const app = getApp()
const { getIntelProfile, saveIntelProfile } = require('../../../utils/intelRequest')
const { getSafeBottom } = require('../../../utils/intelRender')

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐原生胶囊 menuTop）
    _fontScaleValue: 1,    // 字体缩放（对齐 One News，注入 CSS --font-scale）
    _metaScaleValue: 1,
    // T5.1 画像概览
    profile: null,
    consentSigned: false,
    consentAt: '',
    identitiesSummary: '',
    focusTagsSummary: '',
    loadingProfile: false
  },

  onLoad() {

    // 状态栏文字颜色跟随主题：亮色黑/暗色白（One News 页面 onLoad 同款，intel 页此前缺失导致亮色下状态栏白字）
    const _app = getApp()
    if (_app && _app.setNavBarColor) {
      _app.setNavBarColor((_app.globalData && _app.globalData.effectiveTheme) || 'light')
    }
    let statusBarHeight = 20
    let menuTop = 44
    let menuHeight = 32
    try {
      const info = wx.getSystemInfoSync()
      statusBarHeight = info.statusBarHeight || 20
    } catch (e) {}
    const g = app.globalData || {}
    if (typeof g.menuTop === 'number') menuTop = g.menuTop
    if (typeof g.menuHeight === 'number') menuHeight = g.menuHeight
    this.setData({
      themeClass: g.themeClass || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight,
      topBarH: menuTop,
      menuHeight,
      // 底部安全区（px）：env() 真机失效，JS 计算注入 --safe-bottom
      safeBottom: getSafeBottom(),
      _fontScaleValue: (typeof g._fontScaleValue === 'number') ? g._fontScaleValue : 1,
      _metaScaleValue: (typeof g._metaScaleValue === 'number') ? g._metaScaleValue : 1
    })
  },

  onShow() {
    // 主题跟随兜底：重新显示时同步 One News 设置的深浅色
    const g = app.globalData || {}
    if (g.themeClass && this.data.themeClass !== g.themeClass) {
      this.setData({ themeClass: g.themeClass, isDark: g.effectiveTheme === 'dark' })
    }
    // 从 onboard 编辑后返回时刷新画像概览
    this._refreshProfile()
  },

  async _refreshProfile() {
    if (this.data.loadingProfile) return
    this.setData({ loadingProfile: true })
    try {
      const p = await getIntelProfile()
      if (!p) {
        this.setData({
          profile: null,
          consentSigned: false,
          consentAt: '',
          identitiesSummary: '',
          focusTagsSummary: '',
          loadingProfile: false
        })
        return
      }
      const ids = p.identities || {}
      const idParts = []
      if (ids.work) idParts.push('工作：' + ids.work)
      if (ids.product) idParts.push('产品：' + ids.product)
      if (ids.life) idParts.push('生活：' + ids.life)
      this.setData({
        profile: p,
        consentSigned: !!p.consentSigned,
        consentAt: p.consentAt || '',
        identitiesSummary: idParts.join(' · '),
        focusTagsSummary: (p.focusTags || []).join(' / '),
        loadingProfile: false
      })
    } catch (err) {
      console.warn('[intel-mine] getIntelProfile 失败:', err.message || err)
      this.setData({ loadingProfile: false })
    }
  },

  _isSystemDark() {
    try { return wx.getSystemInfoSync().theme === 'dark' || wx.getAppBaseInfo().theme === 'dark' } catch (e) { return false }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/intel/home/home' }) })
  },

  // ===== T5.1 接入：编辑画像 =====
  goEditProfile() {
    wx.navigateTo({ url: '/pages/intel/onboard/onboard' })
  },

  // ===== T5.1 接入：撤销授权 =====
  async revokeConsent() {
    if (!this.data.profile) {
      wx.showToast({ title: '暂无画像可撤销', icon: 'none' })
      return
    }
    // 二次确认，避免误触
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '撤销授权',
        content: '撤销后将停止为你生成新的情报摘要，已生成的不会自动删除。确定撤销？',
        confirmText: '撤销',
        confirmColor: '#FF3B30',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!ok) return

    try {
      const now = new Date().toISOString()
      const updated = Object.assign({}, this.data.profile, {
        consentSigned: false,
        consentAt: '',
        updatedAt: now
      })
      await saveIntelProfile(updated)
      this.setData({
        profile: updated,
        consentSigned: false,
        consentAt: ''
      })
      wx.showToast({ title: '已撤销授权', icon: 'success' })
    } catch (err) {
      console.warn('[intel-mine] 撤销授权失败:', err.message || err)
      wx.showToast({ title: '撤销失败，请重试', icon: 'none' })
    }
  }
})
