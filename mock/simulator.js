/**
 * Mock 测试模拟器 — 用于回归测试中模拟各种异常场景
 *
 * 使用方法：
 *   1. 在 utils/constants.js 中设置 USE_MOCK = true
 *   2. 修改下方 SIMULATE 配置来模拟不同场景
 *   3. 运行小程序查看效果
 *
 * 场景说明：
 *   - normal: 正常加载 mock 数据
 *   - error:  模拟网络错误
 *   - empty:  模拟空数据返回
 *   - slow:   模拟慢网络（5 秒延迟）
 */

const SIMULATE = {
  // 当前场景：'normal' | 'error' | 'empty' | 'slow'
  scenario: 'normal',

  // 各场景配置
  scenarios: {
    normal: {
      delay: 200,
      shouldFail: false,
      emptyResult: false,
    },
    error: {
      delay: 200,
      shouldFail: true,
      emptyResult: false,
      errorMessage: '模拟：网络开小差了，请重试',
    },
    empty: {
      delay: 200,
      shouldFail: false,
      emptyResult: true,
    },
    slow: {
      delay: 5000,
      shouldFail: false,
      emptyResult: false,
    },
  },

  // 获取当前场景配置
  get current() {
    return this.scenarios[this.scenario] || this.scenarios.normal
  },
}

/**
 * 根据模拟器配置拦截 mock 请求
 * @param {Array} mockData - 原始 mock 数据
 * @returns {Promise<{list: Array, total: number, hasMore: boolean}>}
 */
function simulateGetNewsList(mockData, category, pageNum, pageSize) {
  const config = SIMULATE.current

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (config.shouldFail) {
        const err = new Error(config.errorMessage || '模拟错误')
        err.errorCode = 'SIMULATED_ERROR'
        reject(err)
        return
      }

      if (config.emptyResult) {
        resolve({ list: [], total: 0, hasMore: false })
        return
      }

      // 正常逻辑
      let list = [...mockData]
      if (category && category !== 'all') {
        list = list.filter(item => item.category === category)
      }
      const total = list.length
      const start = (pageNum - 1) * pageSize
      const pagedList = list.slice(start, start + pageSize)
      const hasMore = start + pageSize < total

      resolve({ list: pagedList, total, hasMore })
    }, config.delay)
  })
}

/**
 * 根据模拟器配置拦截搜索请求
 */
function simulateSearchNews(mockData, keyword, pageNum, pageSize) {
  const config = SIMULATE.current

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (config.shouldFail) {
        const err = new Error(config.errorMessage || '模拟错误')
        err.errorCode = 'SIMULATED_ERROR'
        reject(err)
        return
      }

      if (config.emptyResult) {
        resolve({ list: [], total: 0 })
        return
      }

      // 正常逻辑
      const kw = (keyword || '').toLowerCase()
      let list = mockData.filter(item =>
        item.title.toLowerCase().includes(kw) ||
        item.summary.toLowerCase().includes(kw)
      )
      const total = list.length
      const start = (pageNum - 1) * pageSize
      list = list.slice(start, start + pageSize)

      resolve({ list, total })
    }, config.delay)
  })
}

module.exports = {
  SIMULATE,
  simulateGetNewsList,
  simulateSearchNews,
}
