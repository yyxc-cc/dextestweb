#!/usr/bin/env node
/**
 * dextestweb · 单页取证
 *
 *   node probe.js --config config.json --url "<页面URL>" [--filters "未接收,检验中"] [--wait 8000]
 *                 [--shot out.png] [--json out.json]
 *
 * 用法要点：
 *   - 先不带 --filters 跑一遍，看默认状态
 *   - 再带筛选逐个点，确认"是默认空"还是"真的空"
 *   - 输出里 rows vs pags 不一致，就是分页 bug 的候选
 *
 * 点击筛选用的选择器：.task-state-item / .el-tabs__item / 文本完全匹配的可点击元素，依次尝试。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, openSession, waitForContent, snapshot } = require('./lib/session');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
if (!flags.config || !flags.url) {
  console.log('用法: node probe.js --config config.json --url "<页面URL>" [--filters "A,B"] [--shot out.png]');
  process.exit(1);
}

const cfg = loadConfig(flags.config);
const filters = flags.filters ? String(flags.filters).split(',').map((s) => s.trim()).filter(Boolean) : [];

async function clickByText(page, label) {
  return page.evaluate((label) => {
    const sels = ['.task-state-item', '.el-tabs__item', '.el-radio-button', '.el-check-tag'];
    for (const s of sels) {
      const el = [...document.querySelectorAll(s)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.innerText || '').replace(/\s+/g, ' ').trim() === label;
      })[0];
      if (el) { el.click(); return s; }
    }
    const any = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 20 || r.width > 300 || r.height < 10 || r.height > 80) return false;
      if (e.children.length >= 3) return false;
      if (e.closest('.el-table, table, .el-form')) return false;   // 别把表格单元格/输入项当筛选
      if (getComputedStyle(e).cursor !== 'pointer') return false;   // 可点的才算
      return (e.innerText || '').replace(/\s+/g, ' ').trim() === label;
    })[0];
    if (any) { any.click(); return 'text'; }
    return null;
  }, label).catch(() => null);
}

(async () => {
  const { browser, ctx, page, failures } = await openSession(cfg);

  await page.goto(flags.url, { waitUntil: 'commit', timeout: cfg.navTimeout });
  await waitForContent(page, cfg);
  await page.waitForTimeout(Number(flags.wait || cfg.waitAfterNav));

  const result = { url: flags.url, default: await snapshot(page, cfg), filters: [], httpFailures: [] };

  for (const f of filters) {
    const how = await clickByText(page, f);
    await page.waitForTimeout(Number(flags.wait || 5000));
    const snap = await snapshot(page, cfg);
    result.filters.push({ filter: f, clickedBy: how, ...snap });
    console.log(`[probe] ${f.padEnd(8)} rows=${String(snap.rows).padStart(3)} ${snap.pags.join(' ') || '(无分页)'}`);
  }

  result.httpFailures = [...new Map(failures.map((x) => [x.status + x.url, x])).values()];
  console.log('\n[probe] 默认状态:', JSON.stringify({ rows: result.default.rows, pags: result.default.pags, tabs: result.default.tabs }));

  const zeroButRows = [result.default, ...result.filters].filter((s) => s.rows > 0 && (s.pags || []).some((p) => /共\s*0\s*条/.test(p)));
  if (zeroButRows.length) {
    console.log('⚠ 有行但分页写"共 0 条"：分页 total 没接（记录为 P2，附行数与接口 total 对照）');
  }
  if (!result.default.rows && !result.filters.some((f) => f.rows > 0)) {
    console.log('⚠ 所有筛选都是 0 行：先确认有无 loading、换筛选、刷新重进，再判定"没数据"');
  }
  if (result.httpFailures.length) {
    console.log('⚠ 失败请求：');
    result.httpFailures.slice(0, 10).forEach((f) => console.log(`  · ${f.status} ${f.url}`));
  }

  if (flags.shot) {
    await page.screenshot({ path: flags.shot });
    console.log('[probe] 截图', flags.shot);
  }
  if (flags.json) {
    fs.writeFileSync(flags.json, JSON.stringify(result, null, 2));
    console.log('[probe] JSON', flags.json);
  }

  await ctx.close();
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
