// INTEL-MODULE: AI 情报官 · 首次进入引导
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 流程：4 步 stepper（身份 / 领域 / 深度+语言+可试用 / 合规）→ 调 saveIntelProfile → 跳 home。
// 数据契约与 T5.2 后端对齐：
//   { userId:'owner', identities:{work,product,life}, focusTags[], depth, langPref, wantTryable, consentSigned, consentAt, updatedAt }
const app = getApp()
const { getIntelProfile, saveIntelProfile } = require('../../../utils/intelRequest')
const { getSafeBottom } = require('../../../utils/intelRender')

// 预设关注词 chip（与情报源 + 主题分类对齐；用户可在尾部自填补充）
const PRESET_FOCUS = [
  'AI 监管', '合规章节', '大模型', 'Agent', '算力',
  '多模态', '前端', '合规', '安全', '效率工具'
]

// 深度档位说明（给用户文字指引）
const DEPTH_META = {
  lite: { label: 'lite · 速览', desc: '只给你一句话结论 + 一条最小行动，适合忙碌时翻一眼。' },
  std:  { label: 'std · 标准', desc: 'SOP 五步（定义/场景映射/实践/最小行动/出处），日常推荐。' },
  deep: { label: 'deep · 深挖', desc: '更长上下文 + 多源交叉验证 + 风险/合规提示，适合关键决策。' }
}

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,
    _fontScaleValue: 1,
    _metaScaleValue: 1,

    step: 0,                     // 0..3
    stepTitles: ['身份', '关注领域', '深度与语言', '合规'],
    identities: { work: '', product: '', life: '' },
    presetFocus: PRESET_FOCUS,
    focusTags: [],
    customTag: '',               // 自填框（onInput 暂存，onAddTag 入库）
    depth: 'std',
    depthMeta: DEPTH_META,
    langPref: 'mixed',
    wantTryable: true,
    consentSigned: false,
    consentAt: '',
    submitting: false,
    errMsg: ''
  },

  /** 回填已有画像（编辑场景）：读取 getIntelProfile 预填表单，未初始化则无操作 */
  async prefillExistingProfile() {
    try {
      const p = await getIntelProfile()
      if (!p || !p.identities) return
      this.setData({
        identities: Object.assign({ work: '', product: '', life: '' }, p.identities || {}),
        focusTags: Array.isArray(p.focusTags) ? p.focusTags : [],
        depth: p.depth || 'std',
        langPref: p.langPref || 'mixed',
        wantTryable: p.wantTryable !== false,
        consentSigned: !!p.consentSigned,
        consentAt: p.consentAt || '',
      })
      console.log('[intel-onboard] 已回填已有画像')
    } catch (e) {
      console.warn('[intel-onboard] 回填画像失败:', (e && e.message) || e)
    }
  },

  onLoad() {
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
    this.prefillExistingProfile()
  },

  _isSystemDark() {
    try { return wx.getSystemInfoSync().theme === 'dark' || wx.getAppBaseInfo().theme === 'dark' } catch (e) { return false }
  },

  // ===== 输入 =====
  onInput(e) {
    const ds = e.currentTarget.dataset || {}
    const field = ds.field            // identities.work / product / life / customTag
    if (ds.group === 'identities') {
      const key = ds.key               // work/product/life
      this.setData({ [`identities.${key}`]: e.detail.value, errMsg: '' })
    } else if (field === 'customTag') {
      this.setData({ customTag: e.detail.value })
    }
  },

  // ===== Chip 多选 =====
  onChipToggle(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.focusTags.slice()
    const idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    this.setData({ focusTags: list, errMsg: '' })
  },

  // ===== 自填补充 =====
  onAddTag() {
    const t = (this.data.customTag || '').trim()
    if (!t) return
    if (this.data.focusTags.indexOf(t) >= 0) {
      this.setData({ customTag: '' })
      return
    }
    this.setData({
      focusTags: this.data.focusTags.concat([t]),
      customTag: ''
    })
  },

  // ===== 深度 / 语言 =====
  setDepth(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ depth: v })
  },
  setLang(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ langPref: v })
  },

  // ===== 可试用 开关 =====
  toggleWantTryable() {
    this.setData({ wantTryable: !this.data.wantTryable })
  },

  // ===== 合规 =====
  toggleConsent() {
    this.setData({
      consentSigned: !this.data.consentSigned,
      errMsg: ''
    })
  },

  // ===== 步骤导航 =====
  nextStep() {
    // step 0 校验：三个身份至少填一项
    if (this.data.step === 0) {
      const id = this.data.identities
      if (!id.work && !id.product && !id.life) {
        this.setData({ errMsg: '请至少填写一段身份描述' })
        return
      }
    }
    // step 1 校验：至少选 1 个关注词
    if (this.data.step === 1) {
      if (!this.data.focusTags.length) {
        this.setData({ errMsg: '请至少选择 1 个关注词' })
        return
      }
    }
    if (this.data.step < 3) {
      this.setData({ step: this.data.step + 1, errMsg: '' })
    }
  },
  prevStep() {
    if (this.data.step > 0) {
      this.setData({ step: this.data.step - 1, errMsg: '' })
    }
  },

  // ===== 提交 =====
  async onSubmit() {
    if (!this.data.consentSigned) {
      this.setData({ errMsg: '请先勾选风险告知与版权声明' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true, errMsg: '' })

    const now = new Date().toISOString()
    const profile = {
      userId: 'owner',
      identities: {
        work: (this.data.identities.work || '').trim(),
        product: (this.data.identities.product || '').trim(),
        life: (this.data.identities.life || '').trim()
      },
      focusTags: this.data.focusTags.slice(),
      depth: this.data.depth,
      langPref: this.data.langPref,
      wantTryable: this.data.wantTryable,
      consentSigned: true,
      consentAt: now,
      updatedAt: now
    }
    try {
      await saveIntelProfile(profile)
      wx.redirectTo({ url: '/pages/intel/home/home' })
    } catch (err) {
      console.warn('[intel-onboard] saveIntelProfile 失败:', err.message || err)
      this.setData({ submitting: false, errMsg: '保存失败：' + (err.message || '网络异常') })
    }
  }
})
