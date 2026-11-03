#!/usr/bin/env node
/**
 * dextestweb · 单页取证
 *
 *   node probe.js --config config.json --url "<页面URL>" [--filters "未接收,检验中"] [--wait 8000]
 *                 [--expect-tab "CT"] [--expect-hash "/page/xxx"] [--expect-text "物料编号"]
 *                 [--shot out.png] [--json out.json] [--fresh]
 *
 * 用法要点：
 *   - 先不带 --filters 跑一遍，看默认状态
 *   - 再带筛选逐个点，确认"是默认空"还是"真的空"
 *   - 输出里 rows vs pags 不一致，就是分页 bug 的候选
 *   - 带页签的页面**务必**加 --expect-tab：点页签不生效时，它会直接拦下来并截图，
 *     不会把上一个页签的数据当成这个页签的结论
 *
 * 点击筛选用的选择器：.task-state-item / .el-tabs__item / 文本完全匹配的可点击元素，依次尝试。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, openSession, gotoPage, snapshot, pageIdentity, expectPage } = require('./lib/session');

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
  const { browser, ctx, page, failures } = await openSession(cfg, {
    fresh: !!flags.fresh,
    authFile: flags.auth
  });

  const nav = await gotoPage(page, cfg, flags.url);
  if (!nav.ok) console.log('⚠ 目标内容没出现（等不到 readySelector），下面读数可能不可信');
  if (nav.reloaded) console.log('  （直接跳转没渲染出来，已重新加载/重进一次——可记成观察项）');
  await page.waitForTimeout(Number(flags.wait || cfg.waitAfterNav));

  // 页面身份闸门：不匹配就别读数了，先解决"我读的是哪一页"
  const expect = {
    tab: flags['expect-tab'],
    notTab: flags['expect-not-tab'],
    hash: flags['expect-hash'],
    menu: flags['expect-menu'],
    text: flags['expect-text']
  };
  let identity;
  try {
    identity = Object.values(expect).some(Boolean)
      ? await expectPage(page, cfg, expect, { shot: flags['mismatch-shot'] || 'page-mismatch.png' })
      : await pageIdentity(page, cfg);
  } catch (e) {
    console.error('✗ ' + e.message);
    console.error('  身份快照：' + JSON.stringify(e.identity));
    if (e.shot) console.error('  已截图：' + e.shot);
    console.error('  这一步的读数已作废。先解决"到底停在哪一页"，再跑一次。');
    await ctx.close();
    await browser.close();
    process.exit(2);
  }
  console.log('[probe] 页面身份:', JSON.stringify({ hash: identity.hash, tab: identity.activeTab, menu: identity.menu }));

  const result = { url: flags.url, identity, default: await snapshot(page, cfg), filters: [], httpFailures: [] };

  for (const f of filters) {
    const how = await clickByText(page, f);
    await page.waitForTimeout(Number(flags.wait || 5000));
    const snap = await snapshot(page, cfg);
    const idNow = await pageIdentity(page, cfg);
    // 点了筛选后页签变了，说明点错了元素（比如同名按钮落在别的页签里）
    if (flags['expect-tab'] && idNow.activeTab.length && !idNow.activeTab.some((t) => t.includes(flags['expect-tab']))) {
      console.log(`⚠ 点「${f}」之后激活页签变成 ${JSON.stringify(idNow.activeTab)}，不是「${flags['expect-tab']}」——这次读数作废`);
    }
    result.filters.push({ filter: f, clickedBy: how, identity: idNow, ...snap });
    console.log(`[probe] ${f.padEnd(8)} rows=${String(snap.rows).padStart(3)} ${snap.pags.join(' ') || '(无分页)'}  tab=${idNow.activeTab.join(',') || '-'}`);
  }

  result.httpFailures = [...new Map(failures.map((x) => [x.status + x.url, x])).values()];
  console.log('\n[probe] 默认状态:', JSON.stringify({ rows: result.default.rows, pags: result.default.pags, tab: result.default.activeTab, tabs: result.default.tabs }));

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
