#!/usr/bin/env node
/**
 * dextestweb · 自检脚本（不需要被测系统）
 *
 *   node scripts/selftest.js
 *
 * 验证四件事：
 *   1. 能启动 Chromium、截出干净图、在四周留白里排版标注
 *   2. 标注确实在原图外侧（输出宽度 = 原图宽 + 左右留白，原图像素未被覆盖）
 *   3. pack.js 能把资源内嵌成单文件 HTML
 *   4. 能生成 PDF（需要 playwright）
 *
 * 依赖：npm i playwright && npx playwright install chromium
 * 想指定浏览器：CHROME_PATH=/path/to/chrome node scripts/selftest.js
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pngSize } = require('./lib/annotate');

const DIR = path.join(os.tmpdir(), 'dextestweb-selftest');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px "Microsoft YaHei",sans-serif;background:#f5f7fa;color:#303133}
.bar{height:52px;background:#1f2d3d;color:#fff;display:flex;align-items:center;padding:0 20px;font-size:15px}
.side{position:absolute;left:0;top:52px;bottom:0;width:196px;background:#263445;color:#c8d3e0}
.side div{padding:12px 20px;font-size:14px}
.side div.on{background:#1f6feb;color:#fff}
.app-main{margin-left:196px;padding:20px 24px}
h2{font-size:18px;margin:4px 0 16px;font-weight:600}
.panel{background:#fff;border-radius:6px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.el-table{width:100%;border-collapse:collapse}
.el-table th,.el-table td{border-bottom:1px solid #ebeef5;padding:11px 12px;text-align:left}
.el-table th{background:#fafafa;color:#909399;font-weight:600;font-size:13.5px}
.el-pagination{margin-top:16px;color:#606266;font-size:13.5px}
</style></head><body>
<div class="bar">示例系统 · 生产订单管理</div>
<div class="side">
  <div class="on">生产执行管理</div><div>生产工单管理</div><div>检验执行管理</div><div>基础数据</div>
</div>
<div class="app-main">
  <h2>生产订单管理</h2>
  <div class="panel">
    <table class="el-table">
      <thead><tr><th>订单号</th><th>产品</th><th>计划数量</th><th>已投数量</th><th>状态</th></tr></thead>
      <tbody>
        <tr><td>PO_DEMO_001</td><td>轮毂</td><td>4</td><td>33</td><td>已投产</td></tr>
        <tr><td>PO_DEMO_002</td><td>支架</td><td>10</td><td>0</td><td>未投产</td></tr>
      </tbody>
    </table>
    <div class="el-pagination">共 0 条　每页 20 条</div>
  </div>
</div>
</body></html>`;

(async () => {
  const { chromium } = require('playwright');
  const { shot, closeComposer } = require('./lib/annotate');

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 760 } });
  await page.setContent(PAGE);

  const gutter = 88;
  const png = path.join(DIR, '01-demo.png');
  const missed = await shot(page, png, {
    title: '自检：表格 2 行，分页却写「共 0 条」',
    sub: '假页面，用来验证「截图不动、标注在外侧」这条链路',
    accent: '#e74c3c',
    gutter,
    boxes: [
      { sel: '.el-table tbody tr:nth-child(1) td:nth-child(4)', label: '已投 33，可计划只有 4', color: '#e74c3c' },
      { sel: '.el-pagination', label: '分页写「共 0 条」，实际 2 行', color: '#e67e22' },
      { sel: '.side .on', label: '菜单高亮：确认是哪个页面', color: '#16a085' }
    ],
    url: '#/order?title=生产订单管理',
    note: '原图一个像素都没被覆盖：编号在左右空白里，说明在下边空白里，靠细引线指到元素。'
  });
  await closeComposer();
  await browser.close();

  const shotBuf = fs.readFileSync(png);
  const out = pngSize(shotBuf);
  const expectW = 1440 + gutter * 2;

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>自检报告</title><style>
:root{--bg:#0f1420;--card:#171e2c;--line:#2a3446;--tx:#e8edf6;--dim:#9aa7bd}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.7 "Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:36px 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.shot{background:#0b111c;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:0}
.shot a{display:block;line-height:0}.shot img{width:100%;display:block}
.shot figcaption{padding:8px 12px;color:var(--dim);font-size:13px}
</style></head><body><div class="wrap">
<div class="card"><h1>dextestweb 自检报告</h1>
<p style="color:#9aa7bd">这张图由 annotate.js 生成（截图不动，标注在四周留白里），再由 pack.js 内嵌进本文件。</p>
<div class="grid"><figure class="shot">
<a href="01-demo.png"><img src="01-demo.png" alt="自检截图"></a>
<figcaption>① 自检截图（编号在边距、引线指向元素）</figcaption></figure></div>
</div></div></body></html>`;
  const report = path.join(DIR, 'report.html');
  fs.writeFileSync(report, html);

  const pack = path.join(__dirname, 'pack.js');
  execFileSync('node', [pack, '--html', report, '--name', '自检报告', '--out', DIR], { stdio: 'inherit' });

  const single = path.join(DIR, '自检报告-单文件.html');
  const pdf = path.join(DIR, '自检报告.pdf');
  const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + 'KB';

  const checks = [
    ['标注截图', fs.existsSync(png), fs.existsSync(png) ? `${out.w}×${out.h}px` : '-'],
    ['原图未被裁', out.w === expectW, `宽度 ${out.w} = 1440 + ${gutter}×2`],
    ['元素全找到', missed.length === 0, missed.length ? JSON.stringify(missed) : '3/3'],
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
  console.log(ok ? '\n全部通过：截图 → 边距标注 → 内嵌 → PDF 链路可用。' : '\n有失败项，按上面的提示排查。');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
