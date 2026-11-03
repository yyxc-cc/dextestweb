/**
 * dextestweb · 会话助手
 * 负责：启动浏览器（可录制）、登录（带登录态缓存）、页面身份校验、等目标内容出现、收集失败的请求。
 *
 * 两条硬规则：
 *   1. 登录态缓存到 .auth/<host>.json（Playwright storageState）。
 *      同一站点第二次起免登录；要强制重登加 --fresh。慢系统上这能省掉大半时间，
 *      也避免"登录十几次、每次都撞上后端抽风"。
 *   2. 读数之前先 expectPage() 校验"当前到底是什么页面"。
 *      点页签/点菜单不生效是很常见的前端问题，不校验就会把上一页的数据写进报告。
 */

const fs = require('fs');
const path = require('path');

function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.baseUrl = cfg.baseUrl || cfg.login.url;
  cfg.viewport = cfg.viewport || { width: 1600, height: 1000 };
  cfg.appContainer = cfg.appContainer || '.app-main';
  cfg.menuContainer = cfg.menuContainer || '.sidebar-container';
  cfg.readySelector = cfg.readySelector || `${cfg.appContainer} .el-table__body tbody tr`;
  cfg.navTimeout = cfg.navTimeout || 90000;
  cfg.waitAfterNav = cfg.waitAfterNav || 2500;
  cfg.authDir = cfg.authDir || '.auth';
  cfg.probeTimeout = cfg.probeTimeout || 60000;
  return cfg;
}

/** 登录态文件路径：默认 .auth/<host>.json，可用 config.authDir / --auth 覆盖 */
function authFile(cfg, override) {
  if (override) return path.resolve(override);
  let host = 'site';
  try { host = new URL(cfg.baseUrl).host || 'site'; } catch (e) {}
  return path.resolve(cfg.authDir, host.replace(/[^\w.-]+/g, '_') + '.json');
}

/** 等应用真的初始化完（壳子渲染出文字），而不是"DOM 里有个 .app-main"就算完 */
async function waitForAppReady(page, cfg, timeout = 45000) {
  try {
    await page.waitForFunction(({ appSel, menuSel }) => {
      const len = (el) => (el && el.innerText ? el.innerText.trim().length : 0);
      return len(document.querySelector(appSel)) > 50 || len(document.querySelector(menuSel)) > 50;
    }, { appSel: cfg.appContainer, menuSel: cfg.menuContainer }, { timeout, polling: 500 });
    return true;
  } catch (e) {
    return false;
  }
}

async function issueLogin(page, cfg) {
  await page.goto(cfg.login.url || cfg.baseUrl, { waitUntil: 'commit', timeout: cfg.navTimeout });

  // 快判：既看不到登录框、又不在登录路由、应用壳还在 → 其实已经登录了，别死等
  await page.waitForTimeout(2500);
  const quick = await page.evaluate(({ userSel, appSel }) => {
    const el = document.querySelector(userSel);
    const r = el && el.getBoundingClientRect();
    return {
      loginVisible: !!r && r.width > 0 && r.height > 0,
      app: !!document.querySelector(appSel),
      hash: location.hash || ''
    };
  }, { userSel: cfg.login.userSelector, appSel: cfg.appContainer }).catch(() => ({}));
  if (!quick.loginVisible && !(quick.hash || '').includes('login') && quick.app) return false;

  await page.waitForSelector(cfg.login.userSelector, { state: 'visible', timeout: cfg.navTimeout });
  await page.fill(cfg.login.userSelector, cfg.login.username);
  await page.fill(cfg.login.passSelector, cfg.login.password);
  await page.click(cfg.login.submitSelector);
  await page.waitForFunction(
    cfg.login.success || (() => !location.hash.includes('login')),
    null, { timeout: cfg.navTimeout }
  );
  // 登录成功后等应用初始化完再交出去：很多系统这时候还是空壳，
  // 立刻跳页面会被路由丢掉，表现为"空白页 + hash 正确"。
  await waitForAppReady(page, cfg, Math.min(cfg.navTimeout, 60000));
  await page.waitForTimeout(2000);
  return true;
}

/**
 * 探活：带着缓存的 cookie 打开首页，判断是不是还登录着。
 * 判据顺序：登录框可见 → 没登录；应用容器/菜单渲染出来 → 已登录。
 * 两者都不是（还在加载/白屏）就继续等；等满 timeout 仍无登录框，按"已登录"处理，
 * 因为真过期了，后续 goto 页面会被踢回登录页，由那边的 expectPage 兜底。
 */
async function isLoggedIn(page, cfg, timeout = cfg.probeTimeout || 60000) {
  try { await page.goto(cfg.baseUrl, { waitUntil: 'commit', timeout: cfg.navTimeout }); } catch (e) {}

  const state = () => page.evaluate(({ userSel, appSel, menuSel }) => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      login: vis(document.querySelector(userSel)),
      app: !!document.querySelector(appSel) || !!document.querySelector(menuSel),
      hash: location.hash || ''
    };
  }, { userSel: cfg.login.userSelector, appSel: cfg.appContainer, menuSel: cfg.menuContainer })
    .catch(() => ({ login: false, app: false, hash: '' }));

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const st = await state();
    if (st.login || st.hash.includes('login')) return false;
    if (st.app) {
      // 有壳子不等于能用：等文字渲染出来，否则随后跳页面会被路由丢掉
      if (await waitForAppReady(page, cfg, Math.max(3000, deadline - Date.now()))) return true;
      break;
    }
    await page.waitForTimeout(800);
  }
  const last = await state();
  return !last.login && !last.hash.includes('login');
}

async function openSession(cfg, opts = {}) {
  const { chromium } = require('playwright');
  const videoDir = opts.videoDir;
  const browser = await chromium.launch({
    headless: cfg.headless !== false,
    executablePath: cfg.chromePath || process.env.CHROME_PATH || undefined
  });
  const vp = cfg.viewport || { width: 1600, height: 1000 };
  // 视频尺寸必须跟视口同比例，否则 Playwright 会加黑边、切片后画面被压扁。
  const capW = opts.videoWidth || 1280;
  const k = Math.min(1, capW / vp.width);
  const videoSize = {
    width: Math.round(vp.width * k / 2) * 2,
    height: Math.round(vp.height * k / 2) * 2
  };

  const stateFile = authFile(cfg, opts.authFile);
  const canReuse = !opts.fresh && cfg.reuseAuth !== false && fs.existsSync(stateFile);

  const ctx = await browser.newContext({
    viewport: cfg.viewport,
    locale: cfg.locale || 'zh-CN',
    storageState: canReuse ? stateFile : undefined,
    recordVideo: videoDir ? { dir: videoDir, size: videoSize } : undefined
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(cfg.navTimeout);
  // 录像从新页打开就开始，标记/切片都以这个时刻为 0 点
  const videoStart = videoDir ? Date.now() : null;

  const failures = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push({ status: r.status(), url: r.url() });
  });

  let reused = false;
  if (canReuse) reused = await isLoggedIn(page, cfg, opts.probeTimeout || cfg.probeTimeout);

  if (!reused) {
    const didLogin = await issueLogin(page, cfg);
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      // indexedDB 也要存：不少后台把页面配置/组件缓存放在 IndexedDB 里，
      // 只存 cookie + localStorage 会出现"能进系统、但直接打开某个页面是空白"。
      await ctx.storageState({ path: stateFile, indexedDB: true });
      console.log(`[session] ${didLogin ? '登录成功' : '检测到已是登录态'}，登录态已缓存 → ${stateFile}`);
    } catch (e) {
      console.log(`[session] 登录态写入失败（不影响本次运行）：${e.message}`);
    }
  } else {
    console.log(`[session] 复用登录态 → ${stateFile}（要强制重登加 --fresh）`);
  }

  return { browser, ctx, page, failures, authFile: stateFile, reused, videoStart };
}

/** 等"目标内容真的出现"，超时也不抛异常，返回是否成功 */
async function waitForContent(page, cfg, selector) {
  const sel = selector || cfg.readySelector;
  try {
    await page.waitForSelector(sel, { timeout: cfg.navTimeout });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 页面指纹：当前到底是什么页面。
 * 报告里的每个读数都应该带上它——出问题时先看这个字段，能立刻分清
 * "系统错了" 还是 "我们读错了页"。
 */
async function pageIdentity(page, cfg) {
  return page.evaluate(({ appSel, menuSel }) => {
    const vis = (e) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const text = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector(appSel) || document.body;
    const menu = menuSel ? document.querySelector(menuSel) : null;
    const body = text(main);
    return {
      hash: decodeURIComponent(location.hash || ''),
      title: document.title,
      activeTab: [...main.querySelectorAll('.el-tabs__item.is-active')].filter(vis).map(text),
      tabs: [...main.querySelectorAll('.el-tabs__item')].filter(vis).map(text).filter(Boolean),
      menu: menu
        ? [...menu.querySelectorAll('.is-active, .active, [class*="is-active"]')]
            .filter(vis).map(text).filter((t) => t && t.length <= 24).slice(0, 6)
        : [],
      headings: [...main.querySelectorAll('h1,h2,h3,.page-title')].filter(vis).map(text).filter(Boolean).slice(0, 4),
      textLen: body.length,
      text: body.slice(0, 400)
    };
  }, { appSel: cfg.appContainer, menuSel: cfg.menuContainer });
}

/**
 * 读数前的闸门。expect 支持：
 *   { tab: 'CT', notTab: '射线', hash: '/page/xxx', menu: '资源管理', text: '物料编号' }
 * 不匹配就抛异常（附带截图），调用方应直接放弃本次读数，而不是往下写报告。
 */
async function expectPage(page, cfg, expect = {}, opts = {}) {
  const id = await pageIdentity(page, cfg);
  const reasons = [];
  const includes = (arr, v) => arr.some((x) => String(x).includes(v));

  if (expect.tab && !includes(id.activeTab, expect.tab)) {
    reasons.push(`激活页签应为「${expect.tab}」，实为 ${JSON.stringify(id.activeTab)}`);
  }
  if (expect.notTab && includes(id.activeTab, expect.notTab)) {
    reasons.push(`激活页签不该是「${expect.notTab}」`);
  }
  if (expect.hash && !id.hash.includes(expect.hash)) {
    reasons.push(`URL 应包含「${expect.hash}」，实为 ${id.hash}`);
  }
  if (expect.menu && !includes(id.menu, expect.menu)) {
    reasons.push(`菜单高亮应为「${expect.menu}」，实为 ${JSON.stringify(id.menu)}`);
  }
  if (expect.text && !id.text.includes(expect.text)) {
    reasons.push(`页面文本应包含「${expect.text}」`);
  }
  if (!reasons.length) return id;

  const err = new Error('页面身份不符：' + reasons.join('；'));
  err.identity = id;
  err.reasons = reasons;
  const shot = opts.shot || 'page-mismatch.png';
  try {
    await page.screenshot({ path: shot });
    err.shot = shot;
  } catch (e) {}
  throw err;
}

/**
 * 打开指定页面，并确保"这一页真的渲染出来了"。
 * 坑：Vue + hash 路由的系统在已经进过系统之后，直接 goto 一个新 hash 常常不触发渲染
 * ——hash 对了，页面是空白的；而 reload 有时又会把路由打回首页。
 * 所以按三步走：直接进 → reload → 回 about:blank 再整页进，哪一步拿到目标内容就停。
 * 返回 { ok, reloaded }，reloaded=true 说明这系统对直接跳转不友好（可记成观察项）。
 */
async function gotoPage(page, cfg, url, opts = {}) {
  const sel = opts.selector || cfg.readySelector;
  const boot = opts.bootTimeout || 15000;
  const wait = async (t) => {
    try { await page.waitForSelector(sel, { timeout: t }); return true; } catch (e) { return false; }
  };

  await page.goto(url, { waitUntil: 'commit', timeout: cfg.navTimeout });
  if (await wait(boot)) return { ok: true, reloaded: false };

  // 已经加载完了还是没内容 → 大概率忽略了这次 hash 跳转，重载一次
  await page.waitForTimeout(1500);
  try { await page.reload({ waitUntil: 'commit', timeout: cfg.navTimeout }); } catch (e) {}
  if (await wait(Math.min(cfg.navTimeout, 45000))) return { ok: true, reloaded: true };

  // 最后手段：回空白页重新整页进，让目标 hash 成为初始路由
  try {
    await page.goto('about:blank');
    await page.goto(url, { waitUntil: 'commit', timeout: cfg.navTimeout });
  } catch (e) {}
  const ok = await wait(Math.min(cfg.navTimeout, 45000));
  return { ok, reloaded: true };
}

/** 一个页面的四个关键数：行数、可见分页、标签页、按钮 */
async function snapshot(page, cfg) {
  return page.evaluate((appSel) => {
    const main = document.querySelector(appSel) || document.body;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const text = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const pags = [...main.querySelectorAll('.el-pagination')].filter(vis)
      .map((p) => (text(p).match(/共\s*\d+\s*条/) || [])[0]).filter(Boolean);
    return {
      url: decodeURIComponent(location.hash),
      rows: [...main.querySelectorAll('.el-table__body tbody tr')].filter(vis).length,
      pags: [...new Set(pags)],
      tabs: [...main.querySelectorAll('.el-tabs__item')].filter(vis).map((e) => text(e)).filter(Boolean),
      activeTab: [...main.querySelectorAll('.el-tabs__item.is-active')].filter(vis).map((e) => text(e)),
      buttons: [...new Set([...main.querySelectorAll('.tool-item-button, .el-button')]
        .filter(vis).map((e) => text(e)).filter(Boolean))].slice(0, 30),
      headings: [...main.querySelectorAll('h1,h2,.page-title')].filter(vis).map((e) => text(e)).filter(Boolean).slice(0, 5),
      loadingMask: !!main.querySelector('.el-loading-mask'),
      textLen: text(main).length
    };
  }, cfg.appContainer);
}

module.exports = {
  loadConfig,
  openSession,
  waitForContent,
  waitForAppReady,
  gotoPage,
  snapshot,
  pageIdentity,
  expectPage,
  authFile,
  isLoggedIn
};
