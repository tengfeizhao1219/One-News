// 版本日志数据源（v1.0 · 2026-08-09）
// 唯一事实源：关于页/设置页/启动页首次打开弹窗均从此读取。
// 结构：versions[] → 每项含 version / date / sections[] → 每段 type(新功能|优化|修复) + items[]
// 维护：每次发版前追加一个版本对象到数组头部（最新版在前）。

module.exports = {
  // 当前线上版本号（与小程序后台提交审核时填写的版本号保持一致）
  // 全版本统一加 v 前缀（关于页/设置页/分享文案/弹窗头部均显示 vX.Y.Z）
  currentVersion: 'v2.0',

  versions: [
    {
      version: 'v2.0',
      date: '2026-08-26',
      sections: [
        {
          type: 'feature',
          label: '新增功能',
          items: [
            { title: '新增 AI 情报官模块', desc: '可对感兴趣的资讯实时全网深挖，重要情报随手沉淀' },
            { title: '实时全网深挖', desc: '对关注资讯一键全网深挖，汇聚多角度信息' },
          ],
        },
        {
          type: 'optimization',
          label: '优化',
          items: [
            { title: '进一步提升用户体验', desc: 'AI 情报官阅读 / 深挖 / 收藏交互与 One News 详情页打磨' },
          ],
        },
      ],
    },
    {
      version: 'v1.0.2',
      date: '2026-08-16',
      sections: [
        {
          type: 'feature',
          label: '新增功能',
          items: [
            { title: '来源更权威、覆盖更及时', desc: '官方媒体直接接入，重要事件站内一键读完' },
            { title: '每条都带 AI 摘要', desc: '划几秒就能抓住要点，不用通读全文' },
            { title: '每条都有 AI 解读', desc: '把背景、影响讲清楚，让你快速看懂这条新闻' },
            { title: '「一页说」独立观点', desc: '有价值的内容帮你看懂这件事意味着什么' },
          ],
        },
        {
          type: 'fix',
          label: '修复',
          items: [
            { title: '不再重复刷屏', desc: '同一篇新闻不再反复出现，刷到的都是新内容' },
          ],
        },
      ],
    },
    {
      version: 'v1.2.1',
      date: '2026-08-10',
      sections: [
        {
          type: 'fix',
          label: '修复',
          items: [
            { title: '修复空白页', desc: '关于页/设置页空白页（config 打包误排除）' },
            { title: '修复首页卡片布局', desc: '内容垂直居中、标题不被状态栏遮挡、AI 摘要完整展示' },
            { title: '修复 logo 浅色路径', desc: '浅色模式下 logo 图标路径补修' },
          ],
        },
        {
          type: 'optimization',
          label: '优化',
          items: [
            { title: '工程化', desc: '拆分私有配置，根治 project.config.json 冲突与部署报错' },
          ],
        },
      ],
    },
    {
      version: 'v1.2.0',
      date: '2026-08-09',
      sections: [
        {
          type: 'feature',
          label: '新功能',
          items: [
            { title: 'AI 摘要升级', desc: '接入云开发混元大模型，免费额度优先，失败自动降级' },
            { title: '摘要来源角标', desc: '首页显示当前摘要是 AI / 来源 / 正文 / 标题' },
            { title: '品牌 Logo 落地', desc: '首页 / 详情 / 关于 / 启动页统一品牌视觉' },
            { title: '分享增强', desc: '首页 / 详情 / 关于页支持发送给朋友 + 朋友圈' },
          ],
        },
      ],
    },
    {
      version: 'v1.0.1',
      date: '2026-08-09',
      sections: [
        {
          type: 'feature',
          label: '新功能',
          items: [
            { title: 'AI 摘要升级', desc: '接入混元大模型，优先用免费额度，失败自动降级' },
            { title: '摘要来源角标', desc: '首页显示当前摘要是「AI / 来源 / 正文 / 标题」' },
            { title: '品牌 Logo 落地', desc: '首页 / 详情 / 关于 / 启动页统一品牌视觉' },
            { title: '分享增强', desc: '首页 / 详情 / 关于页支持发送给朋友 + 朋友圈' },
          ],
        },
        {
          type: 'fix',
          label: '修复',
          items: [
            { title: '首页「假摘要」顶掉正文首段', desc: '有正文时必然显示正文首段，不再被原 description 覆盖' },
          ],
        },
      ],
    },
    {
      version: 'v1.1.0',
      date: '2026-08-08',
      sections: [
        {
          type: 'feature',
          label: '新功能',
          items: [
            { title: '分享好友 / 朋友圈', desc: '详情页支持分享给微信好友或朋友圈' },
            { title: '收藏功能', desc: '支持收藏新闻，本地缓存 30 天' },
            { title: '浏览历史', desc: '自动记录最近 7 天的浏览历史' },
          ],
        },
        {
          type: 'optimization',
          label: '优化',
          items: [
            { title: '深色模式完善', desc: '手动深色模式下全站变量一致性修复' },
            { title: '字号无障碍缩放', desc: '正文 4 档可调，元信息跟涨但封顶 1.15' },
          ],
        },
      ],
    },
    {
      version: 'v1.0.0',
      date: '2026-08-07',
      sections: [
        {
          type: 'feature',
          label: '新功能',
          items: [
            { title: '一页 One News 正式上线', desc: '极简沉浸式新闻阅读，打开即读，零干扰' },
            { title: '4 大分类', desc: '科技 / 国际 / 科学探索 / 社会，每小时更新' },
            { title: 'AI 三级摘要降级', desc: '智谱 → Qwen → DeepSeek，失败自动降级' },
          ],
        },
      ],
    },
  ],
}
