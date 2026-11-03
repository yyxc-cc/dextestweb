#!/usr/bin/env node
/**
 * dextestweb · 极简 Markdown → HTML（够用版）
 *
 *   node scripts/md2html.js 报告.md [报告.html]
 *   node scripts/pack.js --html 报告.html --name "客户-模块"   # 再由 pack.js 内嵌图片出单文件
 *
 * 为什么需要：实测报告一直是 md 写的，但 pack.js 吃的是 html；没有这一步就得手工转、
 * 转完图片路径还容易错。这里只覆盖报告真正用到的语法（标题/表格/代码块/引用/列表/图片），
 * 不引第三方依赖，输出可直接进 pack.js。
 */
const fs = require('fs');
const path = require('path');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });
  s = esc(s);
  // 视频：`![一句话说明](03-重置不重查.mp4)` → 带控件的 <video>（pack.js 会内嵌成 base64）
  s = s.replace(/!\[([^\]]*)\]\(([^)]+\.(?:mp4|webm))\)/gi,
    (m, alt, src) => `<video controls autoplay loop muted playsinline title="${esc(alt)}" src="${src}"></video>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => `<img src="${src}" alt="${esc(alt)}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function convert(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let codeBuf = [];
  let listType = null;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const ln = lines[i];

    if (inCode) {
      if (/^```/.test(ln)) {
        out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
        inCode = false; codeBuf = [];
      } else codeBuf.push(ln);
      i++; continue;
    }

    if (/^```/.test(ln)) {
      closeList(); inCode = true; codeBuf = []; i++; continue;
    }

    if (!ln.trim()) { closeList(); i++; continue; }

    if (/^---+$/.test(ln.trim())) { closeList(); out.push('<hr>'); i++; continue; }

    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++; continue;
    }

    // 表格
    if (/^\|/.test(ln) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      closeList();
      const head = ln.split('|').slice(1, -1).map((c) => inline(c.trim()));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => inline(c.trim())));
        i++;
      }
      out.push('<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    // 引用
    if (/^>\s?/.test(ln)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }

    // 列表
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
      i++; continue;
    }

    // 图片单独成段
    closeList();
    out.push('<p>' + inline(ln) + '</p>');
    i++;
  }

  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  closeList();
  return out.join('\n');
}

const CSS = `
:root{--tx:#111827;--dim:#4b5563;--line:#d7dde8;--accent:#0f766e;--bg:#f6f7f9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);
  font:15px/1.75 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:48px 40px 80px;background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.06);min-height:100vh}
h1{font-size:28px;line-height:1.35;margin:0 0 24px;padding-bottom:16px;border-bottom:3px solid var(--accent)}
h2{font-size:21px;margin:44px 0 14px;padding-left:12px;border-left:4px solid var(--accent)}
h3{font-size:17px;margin:30px 0 10px;color:#0b3b38}
p{margin:12px 0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#eef4f3;font-weight:600}
tr:nth-child(even) td{background:#fafbfc}
code{background:#eef1f4;padding:1px 5px;border-radius:3px;font-size:13px;
  font-family:Consolas,"Courier New",monospace}
pre{background:#0f172a;color:#e2e8f0;padding:16px 18px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.6}
pre code{background:none;padding:0;color:inherit}
blockquote{margin:16px 0;padding:12px 16px;background:#fff7e6;border-left:4px solid #f59e0b;color:#78350f}
img{display:block;max-width:100%;height:auto;margin:18px 0 6px;border:1px solid var(--line);border-radius:6px}
video{display:block;width:100%;max-width:100%;height:auto;margin:18px 0 6px;border:1px solid var(--line);border-radius:6px;background:#000}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
ul,ol{margin:10px 0;padding-left:24px}
li{margin:4px 0}
a{color:var(--accent)}
@media print{body{background:#fff}main{box-shadow:none;padding:0;max-width:none}
  h2{page-break-after:avoid} img{page-break-inside:avoid} video{display:none}
  video+*{display:none}}
`;

function render(mdFile, htmlFile) {
  const md = fs.readFileSync(mdFile, 'utf8');
  const title = (md.match(/^#\s+(.*)$/m) || [, path.basename(mdFile)])[1];
  const base = path.dirname(mdFile);
  let body = convert(md);
  // 同名封面存在就挂成 poster：视频没自动播放时，看到的也是"结果那一帧"，不是黑块
  body = body.replace(/<video([^>]*?)src="([^"]+\.(?:mp4|webm))"/gi, (m, pre, rel) => {
    const file = path.join(base, decodeURIComponent(rel));
    const poster = file.replace(/\.(mp4|webm)$/i, '-封面.jpg');
    if (!fs.existsSync(poster)) return m;
    const relPoster = path.relative(base, poster).replace(/\\/g, '/');
    return `<video${pre}src="${rel}" poster="${relPoster}"`;
  });
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>
${body}
</main></body></html>`;
  fs.writeFileSync(htmlFile, html, 'utf8');
  return htmlFile;
}

module.exports = { render, convert };

if (require.main === module) {
  const [src, dst] = process.argv.slice(2);
  if (!src) { console.log('用法: node md2html.js 报告.md 输出.html'); process.exit(1); }
  console.log('written', render(src, dst || src.replace(/\.md$/i, '.html')));
}
