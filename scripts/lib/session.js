/**
 * dextestweb · 会话助手
 * 负责：启动浏览器（可录制）、登录、等目标内容出现、收集失败的请求。
 *
 * 注意：登录等待条件写成"登录框消失/URL 变化"，不要用固定 sleep。
 * 慢系统建议 90~120 秒超时；page.goto 用 waitUntil:'commit' 更抗大包体卡顿。
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
  return cfg;
}

async function openSession(cfg, opts = {}) {
  const { chromium } = require('playwright');
  const videoDir = opts.videoDir;
  const browser = await chromium.launch({
    headless: cfg.headless !== false,
    executablePath: cfg.chromePath || process.env.CHROME_PATH || undefined
  });
  const ctx = await browser.newContext({
    viewport: cfg.viewport,
    locale: cfg.locale || 'zh-CN',
    recordVideo: videoDir ? { dir: videoDir, size: { width: 1280, height: 800 } } : undefined
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(cfg.navTimeout);

  const failures = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push({ status: r.status(), url: r.url() });
  });

  await page.goto(cfg.login.url || cfg.baseUrl, { waitUntil: 'commit', timeout: cfg.navTimeout });
  await page.waitForSelector(cfg.login.userSelector, { timeout: cfg.navTimeout });
  await page.fill(cfg.login.userSelector, cfg.login.username);
  await page.fill(cfg.login.passSelector, cfg.login.password);
  await page.click(cfg.login.submitSelector);
  await page.waitForFunction(
    cfg.login.success || (() => !location.hash.includes('login')),
    null, { timeout: cfg.navTimeout }
  );
  await page.waitForTimeout(3000);

  return { browser, ctx, page, failures };
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
      rows: main.querySelectorAll('.el-table__body tbody tr').length,
      pags: [...new Set(pags)],
      tabs: [...main.querySelectorAll('.el-tabs__item')].map((e) => text(e)).filter(Boolean),
      buttons: [...new Set([...main.querySelectorAll('.tool-item-button, .el-button')]
        .filter(vis).map((e) => text(e)).filter(Boolean))].slice(0, 30),
      headings: [...main.querySelectorAll('h1,h2,.page-title')].map((e) => text(e)).filter(Boolean).slice(0, 5),
      loadingMask: !!main.querySelector('.el-loading-mask'),
      textLen: text(main).length
    };
  }, cfg.appContainer);
}

module.exports = { loadConfig, openSession, waitForContent, snapshot };
