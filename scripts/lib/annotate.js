/**
 * dextestweb · 标注截图库 v2（截图不动，标注在四周空白）
 *
 * 原则：**截图本身一个像素都不改。**
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ▍一句话结论                                    │  ← 上边距：标题 / 副标题
 *   │   补充说明（单号、数值）                        │
 *   ├────┬────────────────────────────────────┬────┤
 *   │ ①  │                                    │ ②  │  ← 左右边距：编号圆点 + 细引线
 *   │  └─▶│        原始截图（未被覆盖）          │◀─┘ │
 *   ├────┴────────────────────────────────────┴────┤
 *   │ ① 计划数量 = 4   ② 已投 33（超计划 29）        │  ← 下边距：图例
 *   │ 这个数是 7 次保存被拦截累加出来的                │     说明 / 证据面板 / 地址栏
 *   │ 地址栏  #/order/...                            │
 *   └──────────────────────────────────────────────┘
 *
 * 做法：先截干净图 → 量出目标元素的矩形 → 在另一个空白页里把图放进去、
 * 四周留白、画编号与引线 → 截这张"排版好的画布"。所以原图内容 100% 可读。
 *
 * 引线规则（为什么这么绕）：
 *   编号 → 边距里的竖直"轨道" → 贴着元素顶边进入 → 往元素里探 16px 落箭头。
 *   画面内那一段画成虚线、边距里画成实线，读者一眼能分出"这是标注线，不是界面"；
 *   进入点在元素的上内边距里，横向经过同一行的其它单元格时不会压住文字；
 *   同一行有多个标注时自动上下错开 7px，不会叠成一条。
 *
 * 用法：
 *   const { shot, clearOverlay, closeComposer } = require('./lib/annotate');
 *
 *   await shot(page, '01-问题.png', {
 *     title: '物料建码：计划 4 件，已投 33 件',
 *     sub:   '订单 PO_202610120176（轮毂）· 实际只发出 1 件',
 *     accent: '#e74c3c',                     // 红=缺陷 / 橙=待确认 / 绿=正常对照
 *     boxes: [
 *       { dialogCol: '计划数量', row: 0, label: '计划数量 = 4',        color: '#e67e22' },
 *       { dialogCol: '已投数量', row: 0, label: '已投 33（超计划 29）', color: '#e74c3c', frame: true }
 *     ],
 *     note:  '这个数是 7 次"保存被拦截"累加出来的，编码一条都没写进去。',
 *     panel: '接口实测：\ntotalElements = 20\n页面 rows = 0',
 *     url:   page.url()                      // 传 true 则自动取当前地址
 *   });
 *
 * boxes 的定位方式（与 v1 相同）：
 *   { sel, text, nth, pick: 'last', scope }        按选择器 / 文本找元素
 *   { dialogCol: '已投数量', row: 0, tableIdx: 0 }  按"弹窗表格的列名 + 行号"取单元格
 *   { dialog: '物料建码' }                         限定在某个弹窗内找（配合 sel/text）
 *
 * 新增字段：
 *   label  图例文字（旧版叫 tag，仍兼容）
 *   color  这条标注的颜色，默认取 accent
 *   side   'left' | 'right'，默认自动选离图边近的一侧
 *   frame  true = 再给元素描一圈 1.6px 外框（默认不描，只靠引线）
 *   arrow  false = 不画引线，只在边距里放一个编号
 *
 * 排版参数：gutter(左右留白，默认 88) / fullPage(整页截图，默认 false)
 */

const fs = require('fs');

const FONT = '"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif';
const MONO = 'Consolas,"Courier New",monospace';

/* ------------------------------------------------------------------ */
/* 1. 在目标页面里量矩形（不改 DOM、不注入任何东西）                     */
/* ------------------------------------------------------------------ */

function findRects(payload) {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const inDialog = (name) => [...document.querySelectorAll('.el-dialog')]
    .filter((d) => vis(d) && (d.innerText || '').includes(name))[0] || null;

  const find = (spec) => {
    if (spec.dialogCol) {
      const dlg = inDialog(spec.dialog || '');
      if (!dlg) return null;
      const tables = [...dlg.querySelectorAll('.el-table')];
      const t = spec.tableIdx === -1 ? tables[tables.length - 1] : tables[spec.tableIdx || 0];
      if (!t) return null;
      const ths = [...t.querySelectorAll('.el-table__header-wrapper th .cell')]
        .map((c) => (c.innerText || '').trim());
      const ci = ths.indexOf(spec.dialogCol);
      if (ci < 0) return null;
      const tr = t.querySelectorAll('.el-table__body tbody tr')[spec.row || 0];
      return tr ? tr.querySelectorAll('td')[ci] || null : null;
    }

    let root = document;
    if (spec.scope) root = document.querySelector(spec.scope) || document;
    if (spec.dialog) root = inDialog(spec.dialog) || document;

    const pool = [...root.querySelectorAll(spec.sel || '*')].filter(vis);
    if (spec.text) {
      const exact = pool.filter((e) => (e.innerText || e.textContent || '').trim() === spec.text);
      if (exact.length) return spec.pick === 'last' ? exact[exact.length - 1] : exact[0];
      const part = pool.filter((e) => (e.innerText || e.textContent || '').trim().includes(spec.text));
      if (!part.length) return null;
      return spec.pick === 'last' ? part[part.length - 1] : part[0];
    }
    return pool[spec.nth || 0] || null;
  };

  return payload.boxes.map((spec, i) => {
    const el = find(spec);
    if (!el) return { index: i, ok: false };
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return { index: i, ok: false };
    return {
      index: i,
      ok: true,
      x: r.left + (payload.fullPage ? window.scrollX : 0),
      y: r.top + (payload.fullPage ? window.scrollY : 0),
      w: r.width,
      h: r.height
    };
  });
}

/* ------------------------------------------------------------------ */
/* 2. 只读 PNG 头拿真实像素尺寸（不引第三方图片库）                      */
/* ------------------------------------------------------------------ */

function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return { w: 0, h: 0 };
  if (buf.readUInt32BE(0) !== 0x89504e47) return { w: 0, h: 0 };
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ */
/* 3. 排版：编号怎么摆、引线怎么走                                      */
/* ------------------------------------------------------------------ */

/** 同一侧的编号至少隔 34px，避免叠在一起；超出上下边界时整体回推 */
function stagger(list, ih) {
  if (!list.length) return;
  const MIN = 34;
  const TOP = 18;
  const BOTTOM = ih - 18;
  list.sort((a, b) => a.by - b.by);
  let last = -1e9;
  for (const it of list) {
    it.by = Math.max(it.by, last + MIN);
    last = it.by;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].by > BOTTOM) list[i].by = BOTTOM;
    if (i > 0 && list[i - 1].by > list[i].by - MIN) list[i - 1].by = list[i].by - MIN;
  }
  for (const it of list) if (it.by < TOP) it.by = TOP;
}

/**
 * 计算每条标注的最终几何：编号位置、引线路径、箭头三角
 * 引线规则：编号在边距里 → 竖直"轨道"走在图片外侧 → 水平插到元素边缘 → 箭头。
 * 这样只有最后一小段水平线压在画面上（2.4px，带白色垫底），其余全在空白里。
 */
function layout(rects, iw, ih, G, accent) {
  const items = [];
  rects.forEach((r) => {
    if (!r.ok) return;
    const cx = r.x + r.w / 2;
    items.push({
      index: r.index,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      ey: r.y + r.h / 2,
      by: r.y + r.h / 2,
      side: cx < iw / 2 ? 'left' : 'right',
      color: accent,
      frame: false,
      arrow: true
    });
  });
  return { items };
}

function finalize(items, iw, ih, G) {
  // 1) 进入点贴着元素上沿的"内边距区"（约 1/4 高，最多 12px），不从正中穿，
  //    这样横向经过同一行的其它单元格时压在留白上，不压文字。
  items.forEach((it) => {
    // 高元素：取 1/4 高处（最多 12px）；矮元素（按钮）贴着顶边进来，避免横穿按钮文字
    it.baseY = it.y + (it.h >= 40 ? Math.min(it.h * 0.25, 12) : Math.max(3, it.h * 0.15));
    it.tipY = it.baseY;
  });

  // 2) 同一行有多个标注时，入口高度错开 7px，否则两条引线会重叠成一条，读者分不清。
  const sorted = [...items].sort((a, b) => a.baseY - b.baseY);
  let prev = -1e9;
  let slot = 0;
  for (const it of sorted) {
    if (Math.abs(it.baseY - prev) > 6) slot = 0;
    // 往上错开：行内上边距是空的，往下会碰到文字
    it.tipY = Math.max(it.baseY - slot * 7, it.y + 2);
    prev = it.baseY;
    slot++;
  }

  // 3) 引线拆成两段：
  //    外侧段（边距里）实线 —— 编号到画面边缘
  //    画面内段 虚线 —— 明确表示"这是标注线，不是界面元素"
  for (const it of items) {
    it.badgeX = it.side === 'left' ? G / 2 : G + iw + G / 2;
    if (!it.arrow) continue;
    const y = it.tipY;

    if (it.side === 'left') {
      const rail = G - 16;
      // 箭头往元素里探 16px（一般正好落在内边距里，不压文字），
      // 只在边缘停住时读者会分不清指的是这一列还是旁边那一列。
      const tip = it.x + Math.min(16, it.w * 0.4);
      const end = Math.max(tip - 12, G);
      it.outer = `M ${(G / 2 + 15).toFixed(1)} ${it.by.toFixed(1)} L ${rail} ${it.by.toFixed(1)} L ${rail} ${y.toFixed(1)} L ${G} ${y.toFixed(1)}`;
      it.inner = end > G + 1 ? `M ${G} ${y.toFixed(1)} L ${end.toFixed(1)} ${y.toFixed(1)}` : '';
      it.tri = `${tip.toFixed(1)},${y.toFixed(1)} ${(tip - 11).toFixed(1)},${(y - 6).toFixed(1)} ${(tip - 11).toFixed(1)},${(y + 6).toFixed(1)}`;
    } else {
      const rail = G + iw + 16;
      const tip = it.x + it.w - Math.min(16, it.w * 0.4);
      const end = Math.min(tip + 12, G + iw);
      it.outer = `M ${(G + iw + G / 2 - 15).toFixed(1)} ${it.by.toFixed(1)} L ${rail} ${it.by.toFixed(1)} L ${rail} ${y.toFixed(1)} L ${(G + iw)} ${y.toFixed(1)}`;
      it.inner = end < G + iw - 1 ? `M ${(G + iw)} ${y.toFixed(1)} L ${end.toFixed(1)} ${y.toFixed(1)}` : '';
      it.tri = `${tip.toFixed(1)},${y.toFixed(1)} ${(tip + 11).toFixed(1)},${(y - 6).toFixed(1)} ${(tip + 11).toFixed(1)},${(y + 6).toFixed(1)}`;
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* 4. 生成排版页                                                       */
/* ------------------------------------------------------------------ */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildHtml(o) {
  const { iw, ih, G, items, title, sub, accent, note, panel, url } = o;
  const stageW = G * 2 + iw;

  const head = (title || sub) ? `
  <div class="head">
    <div class="bar" style="background:${accent}"></div>
    ${title ? `<div class="t">${esc(title)}</div>` : ''}
    ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
  </div>` : '';

  const badges = items.map((it) => `<div class="badge" style="left:${(it.badgeX - 14).toFixed(1)}px;top:${(it.by - 14).toFixed(1)}px;background:${it.color}">${it.index + 1}</div>`).join('');

  const frames = items.filter((it) => it.frame).map((it) =>
    `<rect x="${(it.x - 3).toFixed(1)}" y="${(it.y - 3).toFixed(1)}" width="${(it.w + 6).toFixed(1)}" height="${(it.h + 6).toFixed(1)}" rx="4" fill="none" stroke="${it.color}" stroke-width="1.6" opacity=".9"/>`).join('');

  const leads = items.filter((it) => it.arrow && it.outer).map((it) =>
    `<path d="${it.outer}" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>`
    + `<path d="${it.outer}" fill="none" stroke="${it.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
    + (it.inner
      ? `<path d="${it.inner}" fill="none" stroke="#ffffff" stroke-width="5" stroke-dasharray="7 5" opacity=".8"/>`
        + `<path d="${it.inner}" fill="none" stroke="${it.color}" stroke-width="2.4" stroke-dasharray="7 5" stroke-linecap="butt"/>`
      : '')
    + `<polygon points="${it.tri}" fill="${it.color}"/>`).join('');

  const svg = `<svg class="leads" width="${stageW}" height="${ih}" viewBox="0 0 ${stageW} ${ih}">${frames}${leads}</svg>`;

  const legend = items.length ? `<ul class="legend">${items.map((it) =>
    `<li><span class="n" style="background:${it.color}">${it.index + 1}</span><span>${esc(it.label)}</span></li>`).join('')}</ul>` : '';

  const foot = (legend || panel || note || url) ? `
  <div class="foot">
    ${legend}
    ${panel ? `<div class="panel">${esc(panel)}</div>` : ''}
    ${note ? `<div class="note" style="border-left-color:${accent}">${esc(note)}</div>` : ''}
    ${url ? `<div class="url"><b>地址栏</b>　${esc(url)}</div>` : ''}
  </div>` : '';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#eef1f6}
#stage{position:relative;display:inline-block;background:#eef1f6}
.head{padding:22px 26px 18px}
.head .bar{width:66px;height:5px;border-radius:3px;margin-bottom:11px}
.head .t{font:700 25px/1.42 ${FONT};color:#0f172a;letter-spacing:-.2px}
.head .s{font:400 15.5px/1.6 ${FONT};color:#475569;margin-top:5px}
.row{position:relative;padding:0 ${G}px;line-height:0}
.row img{display:block;box-shadow:0 0 0 1px #c3ccda}
.row .leads{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.badge{position:absolute;width:28px;height:28px;border-radius:50%;color:#fff;
  font:700 16px/28px ${FONT};text-align:center;box-shadow:0 2px 7px rgba(15,23,42,.28);z-index:2}
.foot{padding:16px 26px 22px}
.legend{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-wrap:wrap;gap:8px 26px}
.legend li{display:flex;align-items:center;gap:8px;font:500 15.5px/1.5 ${FONT};color:#1e293b}
.legend .n{flex:0 0 auto;width:23px;height:23px;border-radius:50%;color:#fff;
  text-align:center;font:700 13.5px/23px ${FONT}}
.panel{margin:0 0 11px;padding:11px 15px;background:#fff;border-left:5px solid #f39c12;
  border-radius:0 8px 8px 0;font:500 14.5px/1.7 ${MONO};color:#334155;white-space:pre-wrap;
  box-shadow:0 1px 3px rgba(15,23,42,.08)}
.note{margin:0 0 11px;padding:11px 16px;background:#fff;border-left:5px solid;
  border-radius:0 8px 8px 0;font:500 16px/1.68 ${FONT};color:#1f2937;
  box-shadow:0 1px 3px rgba(15,23,42,.08)}
.url{display:inline-block;max-width:100%;background:#0f172a;color:#e2e8f0;border-radius:7px;
  padding:8px 14px;font:600 15px/1.5 ${MONO};word-break:break-all}
.url b{color:#7dd3fc;font-weight:600}
</style></head><body>
<div id="stage">
${head}
  <div class="row">
    <img src="${o.dataUri}" width="${iw}" height="${ih}" alt="">
    ${svg}
    ${badges}
  </div>
${foot}
</div>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* 5. 排版页复用（独立 context：不录进被测系统的视频里）                  */
/* ------------------------------------------------------------------ */

let cache = { k: null, ctx: null, page: null };

async function composer(host, k) {
  if (cache.page && cache.k === k) return cache.page;
  if (cache.ctx) { await cache.ctx.close().catch(() => {}); cache.ctx = null; cache.page = null; }

  const pw = require('playwright');
  const browser = host && host.context() ? host.context().browser() : null;
  const opts = { viewport: { width: 1200, height: 800 }, deviceScaleFactor: k };

  cache.ctx = browser
    ? await browser.newContext(opts)
    : await (await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })).newContext(opts);

  cache.k = k;
  cache.page = await cache.ctx.newPage();
  return cache.page;
}

async function closeComposer() {
  if (cache.ctx) await cache.ctx.close().catch(() => {});
  cache = { k: null, ctx: null, page: null };
}

/* ------------------------------------------------------------------ */
/* 6. 对外 API                                                         */
/* ------------------------------------------------------------------ */

async function clearOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-dx="1"], #dx-style').forEach((e) => e.remove());
  }).catch(() => {});
}

/**
 * 只截图、不排版：返回 { png, iw, ih, k, rects, missed }
 * 需要自己在图外做拼接时用这个。
 */
async function capture(page, cfg = {}) {
  const boxes = cfg.boxes || [];
  const fullPage = !!cfg.fullPage;
  await clearOverlay(page);

  const raw = await page.evaluate(findRects, { boxes, fullPage });
  const missed = raw.filter((r) => !r.ok).map((r) => ({ index: r.index, spec: boxes[r.index] }));

  const png = await page.screenshot({ type: 'png', fullPage, animations: 'disabled' });
  const { w, h } = pngSize(png);

  const vw = await page.evaluate(() => Math.max(
    document.documentElement.clientWidth, window.innerWidth
  )).catch(() => 0);
  const k = vw ? +(w / vw).toFixed(3) : 1;

  return {
    png,
    iw: vw || w,
    ih: Math.round(h / (k || 1)),
    k: k || 1,
    rects: raw.filter((r) => r.ok),
    missed
  };
}

/**
 * 截图 + 四周加白边排版，输出一张"原图不动、标注在外侧"的图。
 * 返回 missed 数组（有元素没找到时，脚本会打印出来，不会静默出一张空图）。
 */
async function shot(page, file, cfg = {}) {
  const caps = await capture(page, cfg);
  const G = Number(cfg.gutter || 88);
  const accent = cfg.accent || '#e74c3c';

  const items = layout(caps.rects, caps.iw, caps.ih, G, accent)
    .items.map((it, i) => {
      const spec = (cfg.boxes || [])[it.index] || {};
      if (spec.side === 'left' || spec.side === 'right') it.side = spec.side;
      it.color = spec.color || accent;
      it.label = spec.label || spec.tag || '';
      it.frame = !!spec.frame;
      it.arrow = spec.arrow !== false;
      return it;
    });

  stagger(items.filter((x) => x.side === 'left'), caps.ih);
  stagger(items.filter((x) => x.side === 'right'), caps.ih);
  finalize(items, caps.iw, caps.ih, G);

  const cp = await composer(page, caps.k > 0 ? caps.k : 1);
  const html = buildHtml({
    iw: caps.iw,
    ih: caps.ih,
    G,
    items,
    title: cfg.title || '',
    sub: cfg.sub || '',
    accent,
    note: cfg.note || '',
    panel: cfg.panel || '',
    url: cfg.url === true ? page.url() : (cfg.url || ''),
    dataUri: 'data:image/png;base64,' + caps.png.toString('base64')
  });

  await cp.setContent(html, { waitUntil: 'load' });
  await cp.evaluate(() => (document.fonts && document.fonts.ready) || true).catch(() => {});
  await cp.waitForTimeout(60);

  const size = await cp.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  });
  await cp.setViewportSize({
    width: Math.min(Math.max(size.w + 12, 360), 12000),
    height: Math.min(Math.max(size.h + 12, 300), 12000)
  });

  const el = await cp.$('#stage');
  const out = await el.screenshot({ type: 'png' });
  fs.writeFileSync(file, out);

  if (caps.missed.length) {
    console.warn('[annotate] ' + caps.missed.length + ' 个标注没找到元素：', JSON.stringify(caps.missed.map((m) => m.spec)));
  }
  console.log('[shot]', file, (out.length / 1024).toFixed(0) + 'KB',
    `原图 ${caps.iw}×${caps.ih} 未改动，标注在四周 ${G}px 留白里`);

  return caps.missed;
}

module.exports = { shot, capture, clearOverlay, closeComposer, pngSize };
