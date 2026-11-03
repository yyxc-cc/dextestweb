#!/usr/bin/env node
/**
 * dextestweb · 模块普查（只读）
 *
 *   node census.js --config config.json [--out census.json] [--video-dir ./raw] [--fresh]
 *
 * 做三件事：
 *   1. 登录（登录态自动缓存，第二次起免登录；--fresh 强制重登；可选全程录屏）
 *   2. 遍历侧边栏每个叶子菜单：点击 → 等目标内容 → 记录 URL / 行数 / 分页 / 标签页 / 按钮 / 页面指纹
 *   3. 汇总 4xx/5xx 请求
 *
 * 输出 census.json。跑完先看两类：
 *   - "rows > 0 但 pags 是共 0 条"：分页 bug
 *   - "suspectStale: true"：连着两个菜单的指纹一样，说明点菜单没生效，那几页的读数不可信
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, openSession, waitForContent, snapshot, pageIdentity } = require('./lib/session');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
if (!flags.config) { console.log('用法: node census.js --config config.json [--out census.json] [--fresh]'); process.exit(1); }

const cfg = loadConfig(flags.config);
const OUT = path.resolve(flags.out || 'census.json');

(async () => {
  const { browser, ctx, page, failures, reused } = await openSession(cfg, {
    videoDir: flags['video-dir'],
    fresh: !!flags.fresh,
    authFile: flags.auth
  });

  // 侧边栏叶子菜单：文本短、没有同样文本的子元素、可见
  const labels = await page.evaluate((sel) => {
    const root = document.querySelector(sel) || document.body;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const out = [];
    root.querySelectorAll('*').forEach((e) => {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 20 || !vis(e)) return;
      const kids = [...e.children].some((k) => (k.innerText || '').replace(/\s+/g, ' ').trim() === t);
      if (kids) return;
      out.push(t);
    });
    return [...new Set(out)];
  }, cfg.menuContainer);

  console.log('[census] 菜单项', labels.length, '个');

  const rows = [];
  for (const label of labels) {
    const clicked = await page.evaluate(({ sel, label }) => {
      const root = document.querySelector(sel) || document.body;
      const cands = [...root.querySelectorAll('*')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.innerText || '').replace(/\s+/g, ' ').trim() === label;
      });
      const el = cands[cands.length - 1];
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }, { sel: cfg.menuContainer, label }).catch(() => false);

    if (!clicked) { rows.push({ label, ok: false }); continue; }

    const ok = await waitForContent(page, cfg);
    await page.waitForTimeout(cfg.waitAfterNav);
    const snap = await snapshot(page, cfg);
    const id = await pageIdentity(page, cfg);

    // 指纹没变 → 大概率点菜单没生效，后面这组数就是上一页的，不能进报告
    const prev = rows[rows.length - 1];
    const suspectStale = !!(prev && prev.identity
      && prev.identity.hash === id.hash
      && JSON.stringify(prev.identity.activeTab) === JSON.stringify(id.activeTab)
      && Math.abs(prev.identity.textLen - id.textLen) < 20);

    rows.push({ label, ok, ...snap, identity: id, suspectStale });
    console.log(`[census] ${ok ? '✓' : '?'} ${label.padEnd(12)} rows=${String(snap.rows).padStart(3)}  ${snap.pags.join('/') || '-'}  tab=${id.activeTab.join(',') || '-'}${suspectStale ? '  ⚠疑似未跳转' : ''}`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    reusedLogin: reused,
    pages: rows,
    httpFailures: [...new Map(failures.map((f) => [f.status + f.url, f])).values()]
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('\n[census] 写入', OUT);

  // 立刻把最可疑的三类挑出来
  const stale = rows.filter((r) => r.suspectStale);
  if (stale.length) {
    console.log('\n⚠ 疑似点菜单未生效（这些页的读数不可信，需重跑或换点击方式）：');
    stale.forEach((s) => console.log(`  · ${s.label} (hash=${s.identity.hash || '-'})`));
  }
  const suspicious = rows.filter((r) => r.rows > 0 && r.pags.some((p) => /共\s*0\s*条/.test(p)));
  if (suspicious.length) {
    console.log('\n⚠ 行数与分页总数矛盾（优先复验）：');
    suspicious.forEach((s) => console.log(`  · ${s.label}: ${s.rows} 行 / ${s.pags.join(' ')}`));
  }
  if (result.httpFailures.length) {
    console.log('\n⚠ 4xx/5xx：');
    result.httpFailures.slice(0, 15).forEach((f) => console.log(`  · ${f.status} ${f.url}`));
  }

  await ctx.close();
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
