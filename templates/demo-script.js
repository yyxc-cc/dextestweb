#!/usr/bin/env node
/**
 * 缺陷视频演示 · 模板脚本
 *
 * 复制到你的工作目录，改三处：
 *   1. CONFIG    —— 你的 config.json
 *   2. OUT       —— 报告/交付目录
 *   3. 中间那段  —— 你的具体操作（只读优先）
 *
 * 用法：node demo-script.js
 * 产出：OUT/01-<标记名>.mp4 + -封面.jpg + .gif
 *
 * 关键规矩：demo.mark() 一定打在"动作发生之前"，
 * 这样 pre 秒里才有"操作前"的状态，观众才能看出"变了 / 没变"。
 */
const fs = require('fs');
const path = require('path');

// 把 LIB 指向本 skill 的 scripts/lib
const LIB = path.resolve(__dirname, '../scripts/lib');
const { loadConfig, openSession, gotoPage, expectPage } = require(LIB + '/session');
const { createDemo, finishDemo } = require(LIB + '/demo');

const CONFIG = process.env.CONFIG || './config.json';
const OUT = process.env.OUT || './交付目录';
const REC = process.env.REC || './tmp/rec';

const cfg = loadConfig(CONFIG);
fs.mkdirSync(REC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/** 取可见元素的文字（页面上常常有同名隐藏节点） */
const visText = (page, sel) => page.evaluate((q) => {
  const e = [...document.querySelectorAll(q)].filter((x) => {
    const r = x.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })[0];
  return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : '';
}, sel);

(async () => {
  const s = await openSession(cfg, { videoDir: REC });
  const page = s.page;
  const demo = createDemo(page, s.videoStart);

  // 记录会改数据的请求（用来证明"点了一下，0 个请求"）
  const posts = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() === 'POST') posts.push(r.url());
  });

  await gotoPage(page, cfg, process.env.PAGE_URL || cfg.baseUrl);
  await page.waitForTimeout(3000);
  // 有页签就过身份闸门，没有就删掉这行
  if (process.env.TAB) await expectPage(page, cfg, { tab: process.env.TAB });

  // ---------- 操作前 ----------
  const before = await visText(page, '.el-pagination__total');
  const beforeRow = await visText(page, '.app-main .el-table__body tbody tr:nth-child(1)');

  // ---------- 打标记（在动作之前！） ----------
  // 第三个参数可选：color 控制上方标题条的颜色（红=缺陷、橙=待确认、绿=正常对照）
  demo.mark('重置只清条件不重查', '条件清空、列表仍是同一条、0 个请求', { color: '#e74c3c' });

  // ---------- 动作 ----------
  posts.length = 0;
  await page.locator('.app-main .el-tab-pane:visible button', { hasText: '重置' }).first()
    .click({ force: true }).catch(() => {});
  await page.waitForTimeout(6000);

  // ---------- 操作后 ----------
  const after = await visText(page, '.el-pagination__total');
  const afterRow = await visText(page, '.app-main .el-table__body tbody tr:nth-child(1)');
  const facts = {
    before, after,
    rowsUnchanged: beforeRow === afterRow,
    apiPosts: posts.length
  };
  console.log('FACTS', JSON.stringify(facts, null, 1));

  // ---------- 收尾：自动切片 ----------
  const res = await finishDemo({
    page, ctx: s.ctx, demo, outDir: OUT,
    pre: 9, post: 8, gif: true, full: false
  });
  console.log('CLIPS', JSON.stringify(res.clips.map((c) => ({
    name: c.name, from: c.from, to: c.to,
    file: path.basename(c.file), mb: +(c.bytes / 1048576).toFixed(2)
  })), null, 1));
  fs.writeFileSync(path.join(OUT, 'demo-facts.json'), JSON.stringify({ facts, clips: res.clips }, null, 2), 'utf8');

  await s.browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
