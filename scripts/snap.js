#!/usr/bin/env node
/**
 * dextestweb · 结构化元素清单（CLI）
 *
 *   node snap.js --config config.json --url "<页面URL>" [--tab "综合查询"] [--json out.json]
 *                [--expect-tab "综合查询"] [--fresh] [--wait 3000]
 *   node snap.js ... --diff prev.json [--fail-on-change]
 *
 * 干什么：
 *   - 把当前页面数清楚：页签、工具栏按钮（按会不会改数据分级）、表单字段、表格列、行数、
 *     分页、弹窗、分类树；每个元素都给一个 annotate.js 能直接用的 selector
 *   - --diff：和上一次快照比结构差异（回归时证明"真的没变"，而不是"我看着像没变"）
 *
 * 只读：不点按钮、不填表、不开下拉。--tab 只点页签（切视图，不改数据）。
 * 退出码：0 正常 / 1 参数或运行错误 / 2 页面身份不符 / 4 --fail-on-change 且结构有变化
 */

const fs = require('fs');
const { loadConfig, openSession, gotoPage, pageIdentity, expectPage } = require('./lib/session');
const { snapshotPage, diffSnapshots } = require('./lib/snap');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
if (!flags.config || !flags.url) {
  console.log('用法: node snap.js --config config.json --url "<页面URL>" [--tab "页签"] [--json out.json] [--diff prev.json]');
  process.exit(1);
}

const cfg = loadConfig(flags.config);
const short = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const list = (arr, n = 8) => {
  const a = arr.filter(Boolean);
  return a.length ? short(a.slice(0, n).join('、'), 120) + (a.length > n ? ` 等 ${a.length} 个` : '') : '无';
};

/** 点页签并确认真的切过去了（点了不生效是这个系统最常见的坑） */
async function clickTab(page, name) {
  for (let i = 0; i < 3; i++) {
    await page.locator('.app-main .el-tabs__item', { hasText: name }).first().click({ force: true }).catch(() => {});
    try {
      await page.waitForFunction((n) => [...document.querySelectorAll('.el-tabs__item.is-active')]
        .some((e) => (e.innerText || '').trim().includes(n)), name, { timeout: 12000 });
      return true;
    } catch (e) { await page.waitForTimeout(1200); }
  }
  return false;
}

(async () => {
  const { browser, ctx, page } = await openSession(cfg, { fresh: !!flags.fresh, authFile: flags.auth });

  const nav = await gotoPage(page, cfg, flags.url);
  if (!nav.ok) console.log('⚠ 目标内容没出现（等不到 readySelector），清单可能不完整');
  if (nav.reloaded) console.log('  （直接跳转没渲染出来，已重载/重进一次）');
  await page.waitForTimeout(Number(flags.wait || cfg.waitAfterNav));

  // 可选：切页签（只读操作），切不过去就按身份不符处理
  if (flags.tab) {
    const ok = await clickTab(page, flags.tab);
    if (!ok) {
      await page.screenshot({ path: 'tab-mismatch.png' }).catch(() => {});
      console.error(`✗ 页签切换失败：「${flags.tab}」没变成激活态（已截图 tab-mismatch.png）`);
      console.error('  故意没有继续读数——否则会把上一个页签的字段当成这个页签的结论。');
      await ctx.close(); await browser.close();
      process.exit(2);
    }
    await page.waitForTimeout(Number(flags.wait || cfg.waitAfterNav));
  }

  // 身份闸门
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
      ? await expectPage(page, cfg, expect, { shot: flags['mismatch-shot'] || 'snap-mismatch.png' })
      : await pageIdentity(page, cfg);
  } catch (e) {
    console.error('✗ ' + e.message);
    console.error('  身份快照：' + JSON.stringify(e.identity));
    if (e.shot) console.error('  已截图：' + e.shot);
    await ctx.close(); await browser.close();
    process.exit(2);
  }

  const snap = await snapshotPage(page, cfg, { maxTree: Number(flags['max-tree'] || 80) });
  snap.identity = Object.assign({}, identity, snap.identity || {});
  snap.argv = { url: flags.url, tab: flags.tab || null, expect: Object.fromEntries(Object.entries(expect).filter(([, v]) => v)) };

  // ---------- 打印摘要 ----------
  const c = snap.counts;
  const mut = snap.riskSummary.mutate || [];
  const res = snap.riskSummary.reset || [];
  const rd = snap.riskSummary.read || [];
  console.log(`[snap] ${short(identity.title || '-', 40)}  ${identity.hash || ''}`);
  console.log(`  页签   ${snap.activeTab.join(',') || '(无)'}  （共 ${c.tabs} 个：${list(snap.tabs.map((t) => t.text), 8)}）`);
  console.log(`  工具栏 ${c.toolbar} 个  | 可点(读) ${rd.length}：${list(rd, 6)}`);
  if (mut.length) console.log(`  ⚠ 会改数据 ${mut.length} 个（只读测试别点）：${list(mut, 10)}`);
  if (res.length) console.log(`  ⚠ 重置/清空 ${res.length} 个（点了可能触发"只清 UI 不重查"）：${list(res, 6)}`);
  if (snap.tables.length) {
    for (const t of snap.tables) {
      console.log(`  表格${snap.tables.length > 1 ? '#' + (t.index + 1) : ''}   ${t.columns} 列 × ${t.rows} 行` +
        `${t.total ? '  共 ' + t.total + ' 条' : ''}${t.emptyText ? '  空态：' + t.emptyText : ''}` +
        `${t.checkbox ? '  [有勾选列]' : ''}`);
      if (flags.verbose) console.log('          列：' + list(t.headers.map((h) => h.text), 30));
    }
  } else {
    console.log('  表格   0（这一页不是列表页，或还没渲染出来）');
  }
  if (snap.fields.length) {
    console.log(`  字段   ${snap.fields.length} 个：` +
      list(snap.fields.map((f) => f.label + (f.type === 'select' ? '(下拉)' : f.type === 'date' ? '(日期)' : '') + (f.required ? '*' : '')), 14));
  }
  if (snap.tree.length) {
    console.log(`  树     ${snap.tree.length} 个可见节点，当前：${list(snap.tree.filter((t) => t.selected).map((t) => t.text), 4)}`);
  }
  if (snap.dialogs.length) {
    for (const d of snap.dialogs) {
      console.log(`  弹窗   「${d.title}」 ${d.fields.length} 字段 / ${d.buttons.length} 按钮：${list(d.buttons.map((b) => b.text), 6)}`);
    }
  } else {
    console.log('  弹窗   0');
  }
  if (snap.loadingMask) console.log('  ⚠ 页面还有 loading 遮罩，读数可能不完整');

  // ---------- diff ----------
  let diff = null;
  if (flags.diff) {
    const prev = JSON.parse(fs.readFileSync(flags.diff, 'utf8'));
    diff = diffSnapshots(prev, snap);
    console.log(`\n[snap-diff] 基线：${prev.at || '(无时间)'}  ${prev.identity && prev.identity.hash ? prev.identity.hash : ''}`);
    if (!diff.changed) {
      console.log('  结论：页面结构与基线一致（页签/按钮/字段/列/行数/总数都没变）');
    } else {
      console.log('  结论：结构有变化');
      if (diff.identity.activeTab.changed) console.log(`  页签   ${diff.identity.activeTab.from.join(',')} → ${diff.identity.activeTab.to.join(',')}`);
      if (diff.identity.hash.changed) console.log(`  URL    ${diff.identity.hash.from} → ${diff.identity.hash.to}`);
      if (diff.tabs.added.length || diff.tabs.removed.length) console.log(`  页签   +${diff.tabs.added.length} -${diff.tabs.removed.length}：+${list(diff.tabs.added, 6)} -${list(diff.tabs.removed, 6)}`);
      if (diff.toolbar.added.length || diff.toolbar.removed.length) console.log(`  按钮   +${diff.toolbar.added.length} -${diff.toolbar.removed.length}：+${list(diff.toolbar.added, 6)} -${list(diff.toolbar.removed, 6)}`);
      if (diff.fields.added.length || diff.fields.removed.length || diff.fields.changed.length) {
        console.log(`  字段   +${diff.fields.added.length} -${diff.fields.removed.length} 改${diff.fields.changed.length}：+${list(diff.fields.added, 8)} -${list(diff.fields.removed, 8)}`);
      }
      if (diff.columns.added.length || diff.columns.removed.length) console.log(`  列     +${diff.columns.added.length} -${diff.columns.removed.length}：+${list(diff.columns.added, 8)} -${list(diff.columns.removed, 8)}`);
      else if (diff.columnsOrder.changed) console.log('  列顺序 变了（列名没增减，但排列不同）');
      if (diff.rows.changed) console.log(`  行数   ${diff.rows.from.join('/')} → ${diff.rows.to.join('/')}`);
      if (diff.totals.changed) console.log(`  总数   ${diff.totals.from.join('/')} → ${diff.totals.to.join('/')}`);
    }
  }

  if (flags.json || flags.out) {
    const out = flags.json || flags.out;
    fs.writeFileSync(out, JSON.stringify(diff ? { snapshot: snap, diff } : snap, null, 2));
    console.log(`[snap] JSON ${out}`);
  }

  await ctx.close();
  await browser.close();

  if (flags['fail-on-change'] && diff && diff.changed) process.exit(4);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
