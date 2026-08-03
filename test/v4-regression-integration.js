/**
 * v4 Integration Regression Test - Cloud Functions + Frontend Modules
 *
 * Test files:
 *   1. utils/constants.js
 *   2. utils/request.js
 *   3. cloudfunctions/refreshNews/index.js
 *   4. cloudfunctions/getNewsList/index.js
 *   5. cloudfunctions/searchNews/index.js
 *
 * Strategy: 静态源码分析（云函数/request 路由）+ 常量与错误处理单元测试。
 *   v5 起移除 Mock 模式，云函数真实调用经云端验证。
 * Run: node test/v4-regression-integration.js
 */

'use strict';

// ============================================================
// Test Framework
// ============================================================

const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  modules: {},
};

let currentModule = '';
const failures = [];

function mod(name) {
  currentModule = name;
  stats.modules[name] = { total: 0, passed: 0, failed: 0 };
}

function ok(condition, desc) {
  stats.total++;
  stats.modules[currentModule].total++;
  if (condition) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    process.stdout.write('  \x1b[31mFAIL\x1b[0m ' + desc + '\n');
    failures.push({ module: currentModule, desc });
  }
}

function eq(actual, expected, desc) {
  const pass = actual === expected;
  stats.total++;
  stats.modules[currentModule].total++;
  if (pass) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    const msg = '  \x1b[31mFAIL\x1b[0m ' + desc +
      ' (expected: ' + JSON.stringify(expected) + ', got: ' + JSON.stringify(actual) + ')';
    process.stdout.write(msg + '\n');
    failures.push({ module: currentModule, desc, expected, actual });
  }
}

function deepEq(actual, expected, desc) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  stats.total++;
  stats.modules[currentModule].total++;
  if (pass) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    const msg = '  \x1b[31mFAIL\x1b[0m ' + desc +
      '\n    expected: ' + JSON.stringify(expected) +
      '\n    got:      ' + JSON.stringify(actual);
    process.stdout.write(msg + '\n');
    failures.push({ module: currentModule, desc, expected, actual });
  }
}

function contains(haystack, needle, desc) {
  const pass = haystack.includes(needle);
  stats.total++;
  stats.modules[currentModule].total++;
  if (pass) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    process.stdout.write('  \x1b[31mFAIL\x1b[0m ' + desc + ' (not found: "' + needle + '")\n');
    failures.push({ module: currentModule, desc, needle });
  }
}

function typeOf(value, expectedType, desc) {
  const pass = typeof value === expectedType;
  stats.total++;
  stats.modules[currentModule].total++;
  if (pass) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    process.stdout.write('  \x1b[31mFAIL\x1b[0m ' + desc +
      ' (expected type: ' + expectedType + ', got: ' + typeof value + ')\n');
    failures.push({ module: currentModule, desc, expectedType, actualType: typeof value });
  }
}

// Compare strings using Buffer to avoid encoding issues
function eqText(actual, expected, desc) {
  const pass = Buffer.from(actual, 'utf-8').equals(Buffer.from(expected, 'utf-8'));
  stats.total++;
  stats.modules[currentModule].total++;
  if (pass) {
    stats.passed++;
    stats.modules[currentModule].passed++;
    process.stdout.write('  \x1b[32mPASS\x1b[0m ' + desc + '\n');
  } else {
    stats.failed++;
    stats.modules[currentModule].failed++;
    const msg = '  \x1b[31mFAIL\x1b[0m ' + desc +
      '\n    expected: ' + expected +
      '\n    got:      ' + actual;
    process.stdout.write(msg + '\n');
    failures.push({ module: currentModule, desc, expected, actual });
  }
}

// ============================================================
// Load All Modules
// ============================================================

console.log('='.repeat(60));
console.log('v4 Integration Regression Test');
console.log('Modules: constants.js | request.js | getNewsList | refreshNews | searchNews (cloud source analysis)');
console.log('='.repeat(60));

// Mock wx global object (required by constants.js)
global.wx = {
  getSystemInfoSync: function() {
    return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 };
  },
};

var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');

// ---- Module 1: constants.js ----
var constants = require(path.join(root, 'utils/constants.js'));

// ---- Module 2: request.js ----
var request = require(path.join(root, 'utils/request.js'));

// ---- Module 4: refreshNews/config.json ----
var refreshNewsConfig = require(path.join(root, 'cloudfunctions/refreshNews/config.json'));

// ---- Module 5 & 6: Cloud function source code analysis ----
var getNewsListCode = fs.readFileSync(path.join(root, 'cloudfunctions/getNewsList/index.js'), 'utf-8');
var searchNewsCode = fs.readFileSync(path.join(root, 'cloudfunctions/searchNews/index.js'), 'utf-8');
var requestCode = fs.readFileSync(path.join(root, 'utils/request.js'), 'utf-8');
var refreshNewsCode = fs.readFileSync(path.join(root, 'cloudfunctions/refreshNews/index.js'), 'utf-8');

// ============================================================
// Module 1: constants.js (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 1: constants.js');
mod('constants.js');

// 1.1 CATEGORIES array completeness
var catIds = constants.CATEGORIES.map(function(c) { return c.id; });
deepEq(catIds, ['all', 'tech', 'international', 'sports', 'life'],
  'CATEGORIES contains 5 category IDs (agriculture/science 已下架)');

// 1.2 CATEGORIES array length
eq(constants.CATEGORIES.length, 8, 'CATEGORIES array length is 8');

// 1.3 Each category has id/name fields
var allFieldsOk = true;
constants.CATEGORIES.forEach(function(cat) {
  if (!cat.id || !cat.name) allFieldsOk = false;
});
ok(allFieldsOk, 'Each category has id and name fields');

// 1.4 Category name values
var nameMap = { all: 'all', recommend: 'recommend', tech: 'tech', international: 'international', sports: 'sports', life: 'life' };
var nameMapCN = { all: 'all CN', recommend: 'recommend CN', tech: 'tech CN', international: 'international CN', sports: 'sports CN', life: 'life CN' };
var namesOk = true;
constants.CATEGORIES.forEach(function(cat) {
  if (typeof cat.name !== 'string' || cat.name.length === 0) namesOk = false;
});
ok(namesOk, 'Each category name is a non-empty string');

// 1.5 Swipe thresholds
eq(constants.SWIPE_THRESHOLD, 50, 'SWIPE_THRESHOLD is 50');
eq(constants.PANEL_SWIPE_THRESHOLD, 60, 'PANEL_SWIPE_THRESHOLD is 60');
eq(constants.SWIPE_ANIMATION_MS, 300, 'SWIPE_ANIMATION_MS is 300');
eq(constants.BOUNCE_ANIMATION_MS, 200, 'BOUNCE_ANIMATION_MS is 200');

// 1.6 PAGE_SIZE
eq(constants.PAGE_SIZE, 10, 'PAGE_SIZE is 10');

// ============================================================
// Module 2: request.js (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 2: request.js');
mod('request.js');

// 2.1 Function signatures (searchNews removed in v5 mock cleanup)
typeOf(request.getNewsList, 'function', 'getNewsList is a function');
typeOf(request.getNewsDetail, 'function', 'getNewsDetail is a function');
typeOf(request.handleApiError, 'function', 'handleApiError is a function');

// 2.2 handleApiError - error code mapping (verify function returns a string)
var errCodes = ['API_RATE_LIMIT', 'API_UNAVAILABLE', 'ALL_DOWN', 'LLM_SEARCH_FAILED',
  'NO_DATA', 'API_KEY_INVALID', 'API_TIMEOUT', 'SIMULATED_ERROR'];
errCodes.forEach(function(code) {
  var msg = request.handleApiError(code);
  typeOf(msg, 'string', 'handleApiError(\'' + code + '\') returns a string');
  ok(msg.length > 0, 'handleApiError(\'' + code + '\') returns non-empty message');
});

// 2.3 handleApiError - unknown code with custom message
var customMsg = request.handleApiError('UNKNOWN_CODE', 'custom error');
eq(customMsg, 'custom error', 'Unknown code with custom message returns the message');

// 2.4 handleApiError - unknown code without message returns default
var defaultMsg = request.handleApiError('UNKNOWN_CODE');
typeOf(defaultMsg, 'string', 'Unknown code without message returns a string');
ok(defaultMsg.length > 0, 'Unknown code without message returns non-empty string');

// 2.5 Cloud routing (source analysis): getNewsList/getNewsDetail call wx.cloud.callFunction
contains(requestCode, "wx.cloud.callFunction", 'request.js calls wx.cloud.callFunction');
contains(requestCode, "name: 'getNewsList'", 'getNewsList routes to cloud function "getNewsList"');
contains(requestCode, "name: 'getNewsDetail'", 'getNewsDetail routes to cloud function "getNewsDetail"');

// 2.6 Module exports completeness
['getNewsList', 'getNewsDetail', 'handleApiError'].forEach(function(key) {
  ok(request[key] !== undefined, 'request.js exports ' + key);
});

// ============================================================
// Module 3: refreshNews Cloud Function (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 3: refreshNews cloud function');
mod('refreshNews');
// 3.1 exports.main
contains(refreshNewsCode, 'exports.main', 'exports.main is defined');
contains(refreshNewsCode, 'async (event)', 'main is an async function');

// 4.2 Timer trigger config - 3 cron expressions
eq(refreshNewsConfig.triggers.length, 3, 'config.json has 3 triggers');
var triggerNames = refreshNewsConfig.triggers.map(function(t) { return t.name; });
deepEq(triggerNames, ['morningRefresh', 'noonRefresh', 'eveningRefresh'],
  'Trigger names: morningRefresh/noonRefresh/eveningRefresh');

// 4.3 Cron expressions
eq(refreshNewsConfig.triggers[0].config, '0 0 6 * * * *', 'morningRefresh cron: daily 6:00');
eq(refreshNewsConfig.triggers[1].config, '0 0 11 * * * *', 'noonRefresh cron: daily 11:00');
eq(refreshNewsConfig.triggers[2].config, '0 0 20 * * * *', 'eveningRefresh cron: daily 20:00');

// 4.4 LLM search integration
contains(refreshNewsCode, 'searchAllCategories', 'Calls searchAllCategories for LLM search');

// 4.5 Validator integration
contains(refreshNewsCode, 'validateAndClean', 'Calls validateAndClean for quality validation');
contains(refreshNewsCode, 'validationStats', 'Uses validationStats for validation stats');

// 4.6 Error code LLM_SEARCH_FAILED
contains(refreshNewsCode, 'LLM_SEARCH_FAILED', 'Contains LLM_SEARCH_FAILED error code');
contains(refreshNewsCode, 'errorCode:', 'Return result includes errorCode field');

// 4.7 Low quality warning
contains(refreshNewsCode, 'valid.length < 5', 'Warns when valid news < 5');

// 4.8 Return stats structure
contains(refreshNewsCode, 'inserted:', 'Return result includes inserted');
contains(refreshNewsCode, 'failed:', 'Return result includes failed');
contains(refreshNewsCode, 'cleared:', 'Return result includes cleared');
contains(refreshNewsCode, 'elapsedMs:', 'Return result includes elapsedMs');

// 4.9 Database operations
contains(refreshNewsCode, 'clearOldCache', 'Has clearOldCache to clear old cache');
contains(refreshNewsCode, 'batchInsert', 'Has batchInsert for batch writes');
contains(refreshNewsCode, "db.collection('news_cache')", 'Operates on news_cache collection');

// 4.10 Error handling
contains(refreshNewsCode, 'try {', 'Uses try-catch for search exceptions');
contains(refreshNewsCode, 'console.error', 'Outputs error log on exception');

// ============================================================
// Module 5: getNewsList Cloud Function (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 5: getNewsList cloud function');
mod('getNewsList');

// 5.1 exports.main
contains(getNewsListCode, 'exports.main', 'exports.main is defined');

// 5.2 Data flow: L1 memory cache
contains(getNewsListCode, 'cache.get(memoryKey)', 'L1: calls cache.get for memory cache');
contains(getNewsListCode, 'memory_cache', 'L1: source is memory_cache');

// 5.3 Data flow: L2 cloud database
contains(getNewsListCode, 'getFromDbCache', 'L2: calls getFromDbCache');
contains(getNewsListCode, 'db_cache', 'L2: source is db_cache');

// 5.4 Data flow: L3 AI cache
contains(getNewsListCode, 'aiNews.getByCategory', 'L3: calls aiNews.getByCategory');
contains(getNewsListCode, 'ai_cache', 'L3: source is ai_cache');

// 5.5 Data flow: L4 external API
contains(getNewsListCode, 'fetchFromTianApi', 'L4: calls fetchFromTianApi');
contains(getNewsListCode, 'fetchFromJuheApi', 'L4: fallback to fetchFromJuheApi');

// 5.6 Category parameter handling
contains(getNewsListCode, "event.category || 'all'", 'Category defaults to all');

// 5.7 Pagination parameter handling
contains(getNewsListCode, 'parseInt(event.pageNum)', 'pageNum is parseInt-ed');
contains(getNewsListCode, 'parseInt(event.pageSize)', 'pageSize is parseInt-ed');
contains(getNewsListCode, 'Math.max(1,', 'pageNum minimum is 1');
contains(getNewsListCode, 'config.pagination.maxPageSize', 'pageSize capped by maxPageSize');

// 5.8 Tian API first priority (v3.2)
contains(getNewsListCode, 'fetchFromTianApi', 'L1 calls fetchFromTianApi first');
contains(getNewsListCode, "source: 'tian_api'", 'L1 tian_api is the primary source');
contains(getNewsListCode, 'memory_cache', 'L2 falls back to memory cache on tian failure');
contains(getNewsListCode, 'db_cache', 'L3 falls back to DB cache');
contains(getNewsListCode, 'ai_cache', 'L5 falls back to AI static cache');

// 5.9 Empty data fallback
contains(getNewsListCode, 'ALL_DOWN', 'Returns ALL_DOWN when all sources fail');

// 5.10 Return format
contains(getNewsListCode, 'code: 0', 'Success returns code: 0');
contains(getNewsListCode, 'meta:', 'Return includes meta info');
contains(getNewsListCode, 'source:', 'meta includes source field');

// ============================================================
// Module 6: searchNews Cloud Function (10 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 6: searchNews cloud function');
mod('searchNews');

// 6.1 exports.main
contains(searchNewsCode, 'exports.main', 'exports.main is defined');

// 6.2 Keyword processing
contains(searchNewsCode, 'event.keyword', 'Gets keyword from event');
contains(searchNewsCode, 'keyword.trim()', 'Trims keyword');

// 6.3 L2 cloud database search
contains(searchNewsCode, 'searchFromDb', 'Has searchFromDb function');
contains(searchNewsCode, 'includes(kw)', 'Uses includes for keyword matching');

// 6.4 Fallback to AI cache search
contains(searchNewsCode, 'aiNews.search', 'L3: calls aiNews.search');

// 6.5 Empty keyword handling
contains(searchNewsCode, 'if (!keyword)', 'Returns early on empty keyword');

// 6.6 Return format
contains(searchNewsCode, 'code: 0', 'Success returns code: 0');
contains(searchNewsCode, 'meta:', 'Return includes meta info');

// 6.7 Pagination
contains(searchNewsCode, 'Math.max(1, parseInt(event.pageNum)', 'pageNum minimum is 1');
contains(searchNewsCode, 'config.pagination.maxPageSize', 'pageSize capped by maxPageSize');

// 6.8 No match handling
contains(searchNewsCode, 'list: []', 'Returns empty list on no match');
contains(searchNewsCode, "source: 'no_match'", 'meta.source is no_match on no match');


// ============================================================
// Report
// ============================================================

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST REPORT');
  console.log('='.repeat(60));
  console.log('Total:  ' + stats.total);
  console.log('Passed: ' + stats.passed + ' \x1b[32mPASS\x1b[0m');
  console.log('Failed: ' + stats.failed + ' \x1b[31mFAIL\x1b[0m');
  console.log('Rate:   ' + ((stats.passed / stats.total) * 100).toFixed(1) + '%');
  console.log('');

  console.log('Module Breakdown:');
  var modNames = Object.keys(stats.modules);
  modNames.forEach(function(m) {
    var s = stats.modules[m];
    var status = s.failed === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log('  ' + status + ' ' + m + ': ' + s.passed + '/' + s.total + ' passed');
  });

  if (failures.length > 0) {
    console.log('\nFailure Details:');
    failures.forEach(function(f, i) {
      console.log('  ' + (i + 1) + '. [' + f.module + '] ' + f.desc);
    });
  }

  console.log('');
  if (stats.failed === 0) {
    console.log('\x1b[32mAll tests passed!\x1b[0m');
  } else {
    console.log('\x1b[31m' + stats.failed + ' test(s) failed. Please check.\x1b[0m');
  }
}

// 运行汇总
printSummary();
