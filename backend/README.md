# 后端云函数（Phase 1 待实现）
- `intelFetch`：self-fan-out 分片抓取编排器（复用 One News refreshNews 范式，60s 超时规避）
- `intelRssPoll`：按源 worker（复用 rssFetcher 范式，写入 intel_ingest 集合）
- 定时触发器：05 / 11 / 18 三点巡检（错峰 One News 现有同步）
- 详见《AI情报官_复用审计.md》《AI情报官_设计文档_v1.md》
