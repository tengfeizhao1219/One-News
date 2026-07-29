/**
 * v4 Integration Regression Test - Cloud Functions + Frontend Modules
 *
 * Test files:
 *   1. utils/constants.js
 *   2. utils/request.js
 *   3. mock/simulator.js
 *   4. mock/news.js
 *   5. cloudfunctions/refreshNews/index.js
 *   6. cloudfunctions/getNewsList/index.js
 *   7. cloudfunctions/searchNews/index.js
 *
 * Strategy: Mock mode, no real cloud function or external API calls
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
console.log('Modules: constants.js | request.js | simulator.js | news.js | refreshNews | getNewsList | searchNews');
console.log('='.repeat(60));

// Mock wx global object (required by constants.js)
global.wx = {
  getSystemInfoSync: function() {
    return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 };
  },
};

// Enable TEST_MODE so USE_MOCK becomes true
process.env.TEST_MODE = 'true';

var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');

// ---- Module 1: constants.js ----
var constants = require(path.join(root, 'utils/constants.js'));

// ---- Module 2: request.js ----
var request = require(path.join(root, 'utils/request.js'));

// ---- Module 3: simulator.js & news.js ----
var simulator = require(path.join(root, 'mock/simulator.js'));
var mockNews = require(path.join(root, 'mock/news.js'));

// ---- Module 4: refreshNews/config.json ----
var refreshNewsConfig = require(path.join(root, 'cloudfunctions/refreshNews/config.json'));

// ---- Module 5 & 6: Cloud function source code analysis ----
var getNewsListCode = fs.readFileSync(path.join(root, 'cloudfunctions/getNewsList/index.js'), 'utf-8');
var searchNewsCode = fs.readFileSync(path.join(root, 'cloudfunctions/searchNews/index.js'), 'utf-8');
var refreshNewsCode = fs.readFileSync(path.join(root, 'cloudfunctions/refreshNews/index.js'), 'utf-8');

// ============================================================
// Module 1: constants.js (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 1: constants.js');
mod('constants.js');

// 1.1 CATEGORIES array completeness
var catIds = constants.CATEGORIES.map(function(c) { return c.id; });
deepEq(catIds, ['all', 'recommend', 'tech', 'international', 'sports', 'life', 'agriculture', 'science'],
  'CATEGORIES contains all 8 category IDs');

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

// 1.5 USE_MOCK
eq(constants.USE_MOCK, true, 'USE_MOCK is true under TEST_MODE');

// 1.6 Swipe thresholds
eq(constants.SWIPE_THRESHOLD, 50, 'SWIPE_THRESHOLD is 50');
eq(constants.PANEL_SWIPE_THRESHOLD, 60, 'PANEL_SWIPE_THRESHOLD is 60');
eq(constants.SWIPE_ANIMATION_MS, 300, 'SWIPE_ANIMATION_MS is 300');
eq(constants.BOUNCE_ANIMATION_MS, 200, 'BOUNCE_ANIMATION_MS is 200');

// 1.7 PAGE_SIZE
eq(constants.PAGE_SIZE, 10, 'PAGE_SIZE is 10');

// 1.8 AI_CACHE config
typeOf(constants.AI_CACHE, 'object', 'AI_CACHE is an object');
ok(constants.AI_CACHE.version !== undefined, 'AI_CACHE.version is defined');
ok(constants.AI_CACHE.generatedAt !== undefined, 'AI_CACHE.generatedAt is defined');
ok(constants.AI_CACHE.refreshIntervalHours !== undefined, 'AI_CACHE.refreshIntervalHours is defined');
eq(constants.AI_CACHE.refreshIntervalHours, 24, 'AI_CACHE.refreshIntervalHours is 24');

// ============================================================
// Module 2: request.js (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 2: request.js');
mod('request.js');

// 2.1 Function signatures
typeOf(request.getNewsList, 'function', 'getNewsList is a function');
typeOf(request.searchNews, 'function', 'searchNews is a function');
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

// 2.5 USE_MOCK mode: getNewsList returns Promise
var listResult = request.getNewsList({ category: 'all', pageNum: 1, pageSize: 10 });
typeOf(listResult, 'object', 'getNewsList returns an object (Promise)');
typeOf(listResult.then, 'function', 'getNewsList result has .then method');

// 2.6 USE_MOCK mode: searchNews returns Promise
var searchResult = request.searchNews({ keyword: 'AI', pageNum: 1, pageSize: 10 });
typeOf(searchResult, 'object', 'searchNews returns an object (Promise)');
typeOf(searchResult.then, 'function', 'searchNews result has .then method');

// 2.7 Module exports completeness
['getNewsList', 'getNewsDetail', 'searchNews', 'handleApiError'].forEach(function(key) {
  ok(request[key] !== undefined, 'request.js exports ' + key);
});

// ============================================================
// Module 3: Mock simulator (10 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 3: mock/simulator + news.js');
mod('mock/simulator + news.js');

// 3.1 mockNews data count
eq(mockNews.length, 17, 'mockNews contains 17 items');

// 3.2 Category distribution
var catCounts = {};
mockNews.forEach(function(item) {
  catCounts[item.category] = (catCounts[item.category] || 0) + 1;
});
// Actual distribution: recommend=3, tech=4, international=3, sports=3, life=4
deepEq(catCounts, { recommend: 3, tech: 4, international: 3, sports: 3, life: 4 },
  'Category distribution: recommend=3/tech=4/international=3/sports=3/life=4');

// 3.3 Field completeness for each item
var newsFields = ['id', 'title', 'summary', 'category', 'categoryName', 'source', 'time'];
var allFieldsOk2 = true;
mockNews.forEach(function(item) {
  newsFields.forEach(function(f) {
    if (item[f] === undefined || item[f] === null || item[f] === '') allFieldsOk2 = false;
  });
});
ok(allFieldsOk2, 'Each item has id/title/summary/category/categoryName/source/time');

// 3.4 SIMULATE config completeness
typeOf(simulator.SIMULATE, 'object', 'SIMULATE is an object');
eq(simulator.SIMULATE.scenario, 'normal', 'Default scenario is normal');
['normal', 'error', 'empty', 'slow'].forEach(function(s) {
  ok(simulator.SIMULATE.scenarios[s] !== undefined, 'SIMULATE.scenarios contains ' + s);
});

// 3.5 Function signatures
typeOf(simulator.simulateGetNewsList, 'function', 'simulateGetNewsList is a function');
typeOf(simulator.simulateSearchNews, 'function', 'simulateSearchNews is a function');

// 3.6 Error scenario config
eq(simulator.SIMULATE.scenarios.error.shouldFail, true, 'Error scenario shouldFail is true');
eq(simulator.SIMULATE.scenarios.error.emptyResult, false, 'Error scenario emptyResult is false');

// 3.7 Empty scenario config
eq(simulator.SIMULATE.scenarios.empty.shouldFail, false, 'Empty scenario shouldFail is false');
eq(simulator.SIMULATE.scenarios.empty.emptyResult, true, 'Empty scenario emptyResult is true');

// 3.8 Slow scenario config
eq(simulator.SIMULATE.scenarios.slow.delay, 5000, 'Slow scenario delay is 5000');

// ============================================================
// Module 4: refreshNews Cloud Function (15 items)
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Module 4: refreshNews cloud function');
mod('refreshNews');

// 4.1 exports.main
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

// 5.8 Cache TTL config
contains(getNewsListCode, 'config.cache.memoryTTL', 'Memory cache uses memoryTTL');
contains(getNewsListCode, 'cache.set(memoryKey,', 'Writes to L1 memory cache');

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
// Async Tests: Mock Simulator Actual Execution
// ============================================================
console.log('\n' + '-'.repeat(40));
console.log('Async Tests: Mock Simulator Runtime Verification');
mod('async-tests');

function runAsyncTests() {
  return Promise.resolve().then(function() {

    // -- getNewsList pagination (pageSize=5) --
    return simulator.simulateGetNewsList(mockNews, 'all', 1, 5).then(function(result) {
      eq(result.list.length, 5, 'Pagination pageSize=5 returns 5 items');
      eq(result.total, 17, 'Pagination total is 17');
      ok(result.hasMore === true, 'Page 1 hasMore is true');
    });

  }).then(function() {

    // -- getNewsList page 2 (pageSize=10) --
    return simulator.simulateGetNewsList(mockNews, 'all', 2, 10).then(function(result) {
      eq(result.list.length, 7, 'Page 2 pageSize=10 returns 7 items (remainder)');
      eq(result.total, 17, 'Page 2 total is still 17');
      ok(result.hasMore === false, 'Page 2 hasMore is false');
    });

  }).then(function() {

    // -- getNewsList category filter: tech --
    return simulator.simulateGetNewsList(mockNews, 'tech', 1, 10).then(function(result) {
      eq(result.list.length, 4, 'tech category returns 4 items');
      eq(result.total, 4, 'tech category total is 4');
      result.list.forEach(function(item) {
        eq(item.category, 'tech', 'Filtered item ' + item.id + ' category is tech');
      });
    });

  }).then(function() {

    // -- getNewsList category filter: life --
    return simulator.simulateGetNewsList(mockNews, 'life', 1, 10).then(function(result) {
      eq(result.list.length, 4, 'life category returns 4 items');
      eq(result.total, 4, 'life category total is 4');
    });

  }).then(function() {

    // -- getNewsList non-existent category --
    return simulator.simulateGetNewsList(mockNews, 'nonexistent', 1, 10).then(function(result) {
      eq(result.list.length, 0, 'Non-existent category returns empty list');
      eq(result.total, 0, 'Non-existent category total is 0');
    });

  }).then(function() {

    // -- searchNews keyword search --
    return simulator.simulateSearchNews(mockNews, 'AI', 1, 10).then(function(result) {
      ok(result.list.length > 0, 'Search "AI" has results');
      result.list.forEach(function(item) {
        var title = (item.title || '').toLowerCase();
        var summary = (item.summary || '').toLowerCase();
        ok(title.includes('ai') || summary.includes('ai'),
          'Search result "' + item.title.substring(0, 30) + '..." contains keyword AI');
      });
    });

  }).then(function() {

    // -- searchNews keyword search: Chinese --
    return simulator.simulateSearchNews(mockNews, 'AI', 1, 5).then(function(result) {
      eq(result.list.length, 3, 'Search "AI" returns 3 items');
    });

  }).then(function() {

    // -- searchNews no match keyword --
    return simulator.simulateSearchNews(mockNews, 'xyznotfound999', 1, 10).then(function(result) {
      eq(result.list.length, 0, 'No-match keyword returns empty list');
    });

  }).then(function() {

    // -- searchNews pagination --
    return simulator.simulateSearchNews(mockNews, 'AI', 1, 2).then(function(result) {
      ok(result.list.length <= 2, 'Search pagination result <= pageSize');
    });

  }).then(function() {

    // -- simulator error scenario --
    var origScenario = simulator.SIMULATE.scenario;
    simulator.SIMULATE.scenario = 'error';
    return simulator.simulateGetNewsList(mockNews, 'all', 1, 10).then(function() {
      ok(false, 'Error scenario should throw (should not reach here)');
    }).catch(function(err) {
      ok(err.errorCode === 'SIMULATED_ERROR', 'Error scenario throws SIMULATED_ERROR');
    }).then(function() {
      simulator.SIMULATE.scenario = origScenario;
    });

  }).then(function() {

    // -- simulator empty scenario --
    var origScenario = simulator.SIMULATE.scenario;
    simulator.SIMULATE.scenario = 'empty';
    return simulator.simulateGetNewsList(mockNews, 'all', 1, 10).then(function(result) {
      eq(result.list.length, 0, 'Empty scenario returns empty list');
      eq(result.total, 0, 'Empty scenario total is 0');
    }).then(function() {
      simulator.SIMULATE.scenario = origScenario;
    });

  }).then(function() {

    // -- simulator empty scenario: searchNews --
    var origScenario = simulator.SIMULATE.scenario;
    simulator.SIMULATE.scenario = 'empty';
    return simulator.simulateSearchNews(mockNews, 'AI', 1, 10).then(function(result) {
      eq(result.list.length, 0, 'Empty scenario searchNews returns empty list');
      eq(result.total, 0, 'Empty scenario searchNews total is 0');
    }).then(function() {
      simulator.SIMULATE.scenario = origScenario;
    });

  }).then(function() {

    // -- request.getNewsList full mock chain --
    return request.getNewsList({ category: 'all', pageNum: 1, pageSize: 5 }).then(function(result) {
      typeOf(result.list, 'object', 'request.getNewsList returns list (Array)');
      ok(result.list.length > 0, 'request.getNewsList returns non-empty list');
      typeOf(result.total, 'number', 'request.getNewsList returns total (number)');
      typeOf(result.hasMore, 'boolean', 'request.getNewsList returns hasMore (boolean)');
      typeOf(result.meta, 'object', 'request.getNewsList returns meta (object)');
      eq(result.meta.source, 'ai_cache_mock', 'meta.source is ai_cache_mock');
    });

  }).then(function() {

    // -- request.searchNews full mock chain --
    return request.searchNews({ keyword: 'AI', pageNum: 1, pageSize: 5 }).then(function(result) {
      typeOf(result.list, 'object', 'request.searchNews returns list (Array)');
      typeOf(result.total, 'number', 'request.searchNews returns total (number)');
    });

  }).then(function() {

    // -- formatNewsItem verification via request data --
    return request.getNewsList({ category: 'all', pageNum: 1, pageSize: 1 }).then(function(result) {
      var item = result.list[0];
      ['id', '_id', 'title', 'summary', 'category', 'categoryName', 'source', 'time', 'publishTime'].forEach(function(f) {
        ok(item[f] !== undefined, 'formatNewsItem includes field ' + f);
      });
    });

  }).then(function() {

    // -- getNewsList with category filter via request --
    return request.getNewsList({ category: 'tech', pageNum: 1, pageSize: 10 }).then(function(result) {
      ok(result.list.length > 0, 'request.getNewsList with tech category returns items');
      result.list.forEach(function(item) {
        eq(item.category, 'tech', 'Item ' + item.id + ' category is tech');
      });
    });

  }).then(function() {

    // -- searchNews empty keyword via request (should still work with mock) --
    return request.searchNews({ keyword: '', pageNum: 1, pageSize: 10 }).then(function(result) {
      typeOf(result.list, 'object', 'request.searchNews with empty keyword returns list');
      typeOf(result.total, 'number', 'request.searchNews with empty keyword returns total');
    });

  }).then(function() {
    printSummary();
  });
}

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

// Run async tests
runAsyncTests().catch(function(err) {
  console.error('Async test runtime error:', err);
  process.exit(1);
});
