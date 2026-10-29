#!/usr/bin/env node
/**
 * dextestweb · 报告打包：单文件 HTML + PDF
 *
 *   node pack.js --html report.html [--out dist] [--name 302MOM-问题清单] [--no-pdf] [--gif-to-mp4]
 *
 * 为什么必须做单文件版：
 *   带中文文件名的相对路径，在很多查看器（各类预览面板、邮件客户端、部分看图软件）里解析失败，
 *   用户只会看到"图片打不开"。把图片/视频 base64 内嵌后，一个文件就能转发、双击即看。
 *
 * 做什么：
 *   1. <img src>/<video src> 引用的本地资源 → base64
 *   2. 大 GIF（>2MB）→ 转成循环播放的 mp4（更小、不掉帧，需要 ffmpeg）
 *   3. 注入灯箱（点图放大）+ 打印样式（白底、单列图、隐藏视频）
 *   4. 用 Playwright 的 page.pdf() 生成打印版 PDF
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--no-pdf') flags.noPdf = true;
  else if (a === '--gif-to-mp4') flags.gifToMp4 = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
}

if (!flags.html) {
  console.log('用法: node pack.js --html report.html [--out dist] [--name 报告名] [--no-pdf] [--gif-to-mp4]');
  process.exit(1);
}

const HTML = path.resolve(flags.html);
const BASE = path.dirname(HTML);
const OUT = path.resolve(flags.out || BASE);
const NAME = flags.name || path.basename(HTML, path.extname(HTML));
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
const MB = (f) => fs.statSync(f).size / 1048576;
const dataUri = (f) => `data:${MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`;
const resolveAsset = (rel) => path.join(BASE, decodeURIComponent(rel).replace(/\//g, path.sep));

let html = fs.readFileSync(HTML, 'utf8');
let stats = { inlined: 0, converted: 0, missing: 0 };

/* ---------- 1. GIF → 循环 mp4（可选，体积大时收益明显） ---------- */
html = html.replace(/<img([^>]*?)src="([^"]+\.gif)"([^>]*)>/gi, (m, pre, rel, post) => {
  const f = resolveAsset(rel);
  if (!fs.existsSync(f)) { stats.missing++; return m; }
  const big = MB(f) > 2;
  if (!flags.gifToMp4 || !big) return m;
  const mp4 = f.replace(/\.gif$/i, '.loop.mp4');
  if (!fs.existsSync(mp4)) {
    try {
      execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', f,
        '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '27',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
    } catch (e) {
      console.warn('[pack] GIF 转 mp4 失败，保留原 GIF：', rel);
      return m;
    }
  }
  stats.converted++;
  const alt = (m.match(/alt="([^"]*)"/) || [])[1] || '';
  return `<video autoplay loop muted playsinline preload="metadata" title="${alt}" src="${dataUri(mp4)}"></video>`;
});

/* ---------- 2. 内嵌视频 / 图片 ---------- */
html = html.replace(/<video([^>]*?)src="([^"]+\.(?:mp4|webm))"([^>]*)>/gi, (m, pre, rel, post) => {
  const f = resolveAsset(rel);
  if (!fs.existsSync(f)) { stats.missing++; return m; }
  stats.inlined++;
  return `<video${pre}src="${dataUri(f)}"${post}>`;
});
html = html.replace(/(src|href)="([^"]+\.(?:png|jpe?g|webp|gif|svg))"/gi, (m, attr, rel) => {
  const f = resolveAsset(rel);
  if (!fs.existsSync(f)) { stats.missing++; return m; }
  stats.inlined++;
  return `${attr}="${dataUri(f)}"`;
});

/* ---------- 3. 灯箱 + 打印样式 ---------- */
const EXTRA = `
<style>
  .gifwrap video{width:100%;border-radius:6px;display:block}
  .print-note{display:none}
  #pack-lb{position:fixed;inset:0;background:rgba(5,8,14,.94);display:none;z-index:99999;
    align-items:center;justify-content:center;padding:24px;cursor:zoom-out}
  #pack-lb.on{display:flex}
  #pack-lb img{max-width:96vw;max-height:92vh;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  #pack-lb .hint{position:absolute;top:16px;right:22px;color:#cbd5e1;font-size:13px}
</style>
<style media="print">
  :root{--bg:#fff;--card:#fff;--line:#d7dde8;--tx:#111827;--dim:#4b5563}
  body{background:#fff;color:#111827}
  .wrap{max-width:none;padding:0}
  .toc{display:flex;margin-bottom:16px}
  .toc a{background:#f3f5f9;border-color:#cbd5e1;color:#1f2937}
  .selfnote{display:none}
  .card{border:1px solid #d7dde8;padding:14px 16px;margin-bottom:10px;break-inside:auto}
  .facts{background:#f7f8fa}
  .shot{background:#fff;border-color:#d7dde8;break-inside:avoid}
  .shot a{text-align:center;background:#fff}
  .shot img{width:auto;max-width:100%;max-height:104mm;margin:0 auto}
  .shot figcaption{color:#4b5563}
  .shot figcaption b,.lead,h3{color:#111827}
  .small{color:#4b5563}
  .grid{grid-template-columns:1fr;gap:6px}
  video,.gifwrap,.cols{display:none}
  .print-note{display:block;font-size:12px;color:#6b7280;margin:2px 0 10px}
  a{color:#1d4ed8;text-decoration:none}
  section + section{break-before:page}
  h1{font-size:21px}h2{font-size:16px}h3{font-size:14px;break-after:avoid}
  .warn{background:#fdf8ee;border-left-color:#b45309;color:#4b3b0f}
  .warn.bad{background:#fdf3f3;border-left-color:#b91c1c;color:#5b1a1a}
  .warn.ok{background:#f2fbf6;color:#14532d}
  code{color:#0b4f7a;background:#f1f5f9;border-color:#e2e8f0}
  .lvl{color:#fff !important}
</style>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var lb = document.createElement('div');
  lb.id = 'pack-lb';
  lb.innerHTML = '<div class="hint">点击任意处关闭（Esc）</div><img alt="">';
  document.body.appendChild(lb);
  var im = lb.querySelector('img');
  function close(){ lb.classList.remove('on'); im.removeAttribute('src'); }
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  document.querySelectorAll('.shot a').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var i = a.querySelector('img');
      if (!i) return;
      ev.preventDefault();
      im.src = i.currentSrc || i.src;
      lb.classList.add('on');
    });
  });
});
</script>`;

if (!html.includes('pack-lb')) html = html.replace('</body>', EXTRA + '\n</body>');
html = html.replace(/<h3>视频复现<\/h3>/g,
  '<h3>视频复现</h3><p class="print-note">（PDF 版不含视频；动态复现请看单文件 HTML，或各子文件夹里的 mp4）</p>');

fs.mkdirSync(OUT, { recursive: true });
const single = path.join(OUT, NAME + '-单文件.html');
fs.writeFileSync(single, html);
console.log('[single]', single, MB(single).toFixed(2) + 'MB',
  `内嵌 ${stats.inlined} 个资源，GIF→mp4 ${stats.converted} 个，缺失 ${stats.missing} 个`);

if (stats.missing) console.warn('[single] 有资源缺失，检查上面的相对路径是否写错');

/* ---------- 4. PDF ---------- */
if (!flags.noPdf) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.warn('[pdf] 未安装 playwright，跳过 PDF'); process.exit(0); }

  const exe = process.env.CHROME_PATH || undefined;
  (async () => {
    const browser = await chromium.launch({ headless: true, executablePath: exe });
    const page = await browser.newPage();
    const url = 'file:///' + single.replace(/\\/g, '/').replace(/ /g, '%20');
    await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    await page.waitForTimeout(1500);
    const pdf = path.join(OUT, NAME + '.pdf');
    await page.pdf({
      path: pdf, format: 'A4', printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' }
    });
    await browser.close();
    console.log('[pdf]', pdf, MB(pdf).toFixed(2) + 'MB');
  })();
}
