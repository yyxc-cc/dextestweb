/**
 * dextestweb · 标注截图库
 *
 * 在页面里注入固定定位的覆盖层（红框 + 编号 + 标签 + 顶部结论条 + 底部说明条 +
 * 地址栏卡片 + 证据面板），然后截图。不改页面结构、不写库、可反复调用。
 *
 * 用法：
 *   const { shot, annotate, clearOverlay } = require('./lib/annotate');
 *   await shot(page, '01-问题.png', {
 *     title: '一句话结论',
 *     sub: '补充一句（订单号、数值）',
 *     accent: '#e74c3c',
 *     boxes: [{ sel: '.el-table__body tbody tr', text: 'PO_123', tag: '已投 33', tagPos: 'right' }],
 *     note: '底部解释',
 *     url: page.url(),
 *     panel: '接口实测：\ntotalElements = 20'
 *   });
 *
 * boxes 支持的定位方式：
 *   { sel, text, nth, pick: 'last', scope }        按选择器 / 文本找元素
 *   { dialogCol: '已投数量', row: 0, tableIdx: 0 }  按"弹窗表格的列名 + 行号"取单元格
 *   { dialog: '物料建码' }                         限定在某个弹窗内找（配合 sel/text）
 *
 * tagPos：left(默认) | right | above | below | inside
 */

const CSS = `
.dx-box{position:fixed;z-index:2147483000;pointer-events:none;border-radius:7px}
.dx-badge{position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:50%;
  color:#fff;font:700 17px/30px "Microsoft YaHei",sans-serif;text-align:center;
  box-shadow:0 2px 8px rgba(0,0,0,.35)}
.dx-tag{position:absolute;color:#fff;padding:5px 11px;border-radius:5px;
  font:600 15px/1.4 "Microsoft YaHei",sans-serif;white-space:nowrap;
  box-shadow:0 2px 8px rgba(0,0,0,.3)}
.dx-title{position:fixed;left:50%;top:12px;transform:translateX(-50%);max-width:1340px;
  background:rgba(14,18,26,.94);color:#fff;padding:12px 30px;border-radius:10px;
  font:700 23px/1.35 "Microsoft YaHei",sans-serif;z-index:2147483100;text-align:center;
  box-shadow:0 8px 26px rgba(0,0,0,.35)}
.dx-title small{display:block;font-size:16px;font-weight:400;opacity:.86;margin-top:5px}
.dx-note{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);max-width:1380px;
  background:#fff;color:#111827;border:1px solid #d1d5db;border-left:6px solid #e74c3c;
  border-radius:9px;padding:11px 22px;font:500 17px/1.6 "Microsoft YaHei",sans-serif;
  box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:2147483100}
.dx-url{position:fixed;left:50%;transform:translateX(-50%);max-width:1300px;
  background:#0f172a;color:#e5e7eb;border-radius:8px;padding:8px 18px;
  font:600 17px/1.5 Consolas,monospace;z-index:2147483100;
  box-shadow:0 6px 20px rgba(0,0,0,.3)}
.dx-panel{position:fixed;right:20px;max-width:600px;background:rgba(255,255,255,.98);
  border:1px solid #cbd5e1;border-left:6px solid #f39c12;border-radius:9px;padding:13px 18px;
  font:500 15px/1.75 Consolas,"Microsoft YaHei",monospace;color:#1f2937;
  z-index:2147483100;box-shadow:0 8px 24px rgba(0,0,0,.2);white-space:pre-wrap}
`;

function annotateInPage(cfg) {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const inDialog = (name) => [...document.querySelectorAll('.el-dialog')]
    .filter((d) => vis(d) && (d.innerText || '').includes(name))[0] || null;

  const find = (spec) => {
    // 1) 弹窗表格的某一列
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

    // 2) 选择器 / 文本（可限定 scope 或 dialog）
    let root = document;
    if (spec.scope) root = document.querySelector(spec.scope) || document;
    if (spec.dialog) root = inDialog(spec.dialog) || document;

    let pool = [...root.querySelectorAll(spec.sel || '*')].filter(vis);
    if (spec.text) {
      const exact = pool.filter((e) => (e.innerText || e.textContent || '').trim() === spec.text);
      if (exact.length) return spec.pick === 'last' ? exact[exact.length - 1] : exact[0];
      const part = pool.filter((e) => (e.innerText || e.textContent || '').trim().includes(spec.text));
      if (!part.length) return null;
      return spec.pick === 'last' ? part[part.length - 1] : part[0];
    }
    return pool[spec.nth || 0] || null;
  };

  const missed = [];

  (cfg.boxes || []).forEach((b, i) => {
    const el = find(b);
    if (!el) { missed.push({ index: i, spec: b }); return; }

    const color = b.color || '#e74c3c';
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'dx-box';
    box.dataset.dx = '1';
    box.style.cssText += `left:${Math.max(r.left - 6, 2)}px;top:${Math.max(r.top - 6, 2)}px;` +
      `width:${r.width + 12}px;height:${Math.min(r.height + 12, 720)}px;` +
      `border:3px solid ${color};box-shadow:0 0 0 3px ${color}26`;

    const badge = document.createElement('div');
    badge.className = 'dx-badge';
    badge.style.background = color;
    badge.textContent = String(i + 1);
    box.appendChild(badge);

    if (b.tag) {
      const tag = document.createElement('div');
      tag.className = 'dx-tag';
      tag.style.background = color;
      tag.textContent = b.tag;
      const pos = b.tagPos || 'left';
      if (pos === 'right') { tag.style.left = r.width + 16 + 'px'; tag.style.top = '0px'; }
      else if (pos === 'below') { tag.style.left = '0px'; tag.style.top = r.height + 14 + 'px'; }
      else if (pos === 'above') { tag.style.left = '0px'; tag.style.bottom = r.height + 16 + 'px'; }
      else if (pos === 'inside') { tag.style.left = '10px'; tag.style.top = '10px'; }
      else { tag.style.right = r.width + 14 + 'px'; tag.style.top = '0px'; }
      box.appendChild(tag);
    }
    document.body.appendChild(box);
  });

  const add = (cls, extra, html) => {
    const el = document.createElement('div');
    el.className = cls;
    el.dataset.dx = '1';
    el.style.cssText += extra;
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };

  if (cfg.title) {
    const accent = cfg.accent || '#e74c3c';
    add('dx-title', `border-bottom:4px solid ${accent}`,
      cfg.title + (cfg.sub ? `<small>${cfg.sub}</small>` : ''));
  }
  if (cfg.note) {
    add('dx-note', `border-left-color:${cfg.accent || '#e74c3c'}`, cfg.note);
  }
  if (cfg.url) {
    const bottom = cfg.note ? 108 : 18;
    add('dx-url', `bottom:${bottom}px`,
      `<span style="color:#7dd3fc">地址栏</span>　${cfg.url.replace(/&/g, '&amp;')}`);
  }
  if (cfg.panel) {
    add('dx-panel', `top:${cfg.title ? 104 : 20}px`, cfg.panel.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;'));
  }

  return missed;
}

async function clearOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-dx="1"]').forEach((e) => e.remove());
  }).catch(() => {});
}

async function annotate(page, cfg) {
  await clearOverlay(page);
  await page.evaluate((css) => {
    let st = document.getElementById('dx-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'dx-style';
      document.head.appendChild(st);
    }
    st.textContent = css;
  }, CSS);

  const missed = await page.evaluate(annotateInPage, cfg);
  await page.waitForTimeout(300);
  if (missed.length) {
    console.warn('[annotate] 有 ' + missed.length + ' 个框没找到元素：', JSON.stringify(missed));
  }
  return missed;
}

async function shot(page, file, cfg) {
  const missed = await annotate(page, cfg);
  await page.screenshot({ path: file });
  console.log('[shot]', file);
  return missed;
}

module.exports = { annotate, shot, clearOverlay, CSS };
