#!/usr/bin/env node
/**
 * dextestweb · 自检脚本（不需要被测系统）
 *
 *   node scripts/selftest.js
 *
 * 验证三件事：
 *   1. 能启动 Chromium、注入标注覆盖层、截出带红框的图
 *   2. pack.js 能把资源内嵌成单文件 HTML
 *   3. 能生成 PDF（需要 playwright）
 *
 * 依赖：npm i playwright && npx playwright install chromium
 * 想指定浏览器：CHROME_PATH=/path/to/chrome node scripts/selftest.js
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(os.tmpdir(), 'dextestweb-selftest');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px "Microsoft YaHei",sans-serif;background:#f5f7fa}
.bar{height:52px;background:#1f2d3d;color:#fff;display:flex;align-items:center;padding:0 20px}
.app-main{padding:24px}
.el-table{width:72%;border-collapse:collapse;background:#fff}
.el-table th,.el-table td{border-bottom:1px solid #ebeef5;padding:10px 12px;text-align:left}
.el-table th{background:#fafafa;color:#909399;font-weight:600}
.el-pagination{margin-top:16px;color:#606266;width:72%}
</style></head><body>
<div class="bar">示例系统 · 自检页面</div>
<div class="app-main">
  <table class="el-table">
    <thead><tr><th>订单号</th><th>计划数量</th><th>已投数量</th></tr></thead>
    <tbody>
      <tr><td>PO_DEMO_001</td><td>4</td><td>33</td></tr>
      <tr><td>PO_DEMO_002</td><td>10</td><td>0</td></tr>
    </tbody>
  </table>
  <div class="el-pagination">共 0 条　每页 20 条</div>
</div>
</body></html>`;

(async () => {
  const { chromium } = require('playwright');
  const { shot } = require('./lib/annotate');

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent(PAGE);

  const png = path.join(DIR, '01-demo.png');
  await shot(page, png, {
    title: '自检：表格 2 行，分页却写「共 0 条」',
    sub: '这只是一个假页面，用来验证标注与打包链路',
    accent: '#e74c3c',
    boxes: [
      { sel: '.el-table tbody tr', nth: 0, tag: '第 1 行：已投 33（超计划 29）', tagPos: 'right', color: '#e74c3c' },
      { sel: '.el-pagination', tag: '分页总数 0（错）', tagPos: 'below', color: '#e67e22' }
    ],
    url: '#/demo?title=自检',
    note: '如果这张图上有红框、编号、右下角地址栏，说明标注链路正常。'
  });
  await browser.close();

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>自检报告</title><style>
:root{--bg:#0f1420;--card:#171e2c;--line:#2a3446;--tx:#e8edf6;--dim:#9aa7bd}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.7 "Microsoft YaHei",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:36px 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.shot{background:#0b111c;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:0}
.shot a{display:block;line-height:0}.shot img{width:100%;display:block}
.shot figcaption{padding:8px 12px;color:var(--dim);font-size:13px}
</style></head><body><div class="wrap">
<div class="card"><h1>dextestweb 自检报告</h1>
<p style="color:#9aa7bd">这张图由 annotate.js 生成，再由 pack.js 内嵌进本文件。</p>
<div class="grid"><figure class="shot">
<a href="01-demo.png"><img src="01-demo.png" alt="自检截图"></a>
<figcaption>① 自检截图（红框＝问题点）</figcaption></figure></div>
</div></div></body></html>`;
  const report = path.join(DIR, 'report.html');
  fs.writeFileSync(report, html);

  const pack = path.join(__dirname, 'pack.js');
  execFileSync('node', [pack, '--html', report, '--name', '自检报告', '--out', DIR], { stdio: 'inherit' });

  const single = path.join(DIR, '自检报告-单文件.html');
  const pdf = path.join(DIR, '自检报告.pdf');
  const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + 'KB';

  const checks = [
    ['标注截图', fs.existsSync(png), fs.existsSync(png) ? kb(png) : '-'],
    ['单文件 HTML', fs.existsSync(single), fs.existsSync(single) ? kb(single) : '-'],
    ['资源已内嵌', fs.existsSync(single) && fs.readFileSync(single, 'utf8').includes('data:image/png;base64'), ''],
    ['PDF', fs.existsSync(pdf), fs.existsSync(pdf) ? kb(pdf) : '-']
  ];

  console.log('\n==== 自检结果 ====');
  let ok = true;
  for (const [name, pass, extra] of checks) {
    if (!pass) ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name.padEnd(10)} ${extra}`);
  }
  console.log('产物目录：', DIR);
  console.log(ok ? '\n全部通过：标注 → 截图 → 内嵌 → PDF 链路可用。' : '\n有失败项，按上面的提示排查。');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
