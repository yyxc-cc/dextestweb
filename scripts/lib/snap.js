/**
 * dextestweb · 结构化元素清单（snap）
 *
 * 解决的问题：每测一个新页面，都要现写一堆选择器去数"有几个页签、几个按钮、几列、
 * 字段叫什么"。同一句话在不同页面重复劳动，还容易数错（隐藏页签里的同名按钮、
 * 被 fixed 列复制的表头、嵌套 form-item 导致字段算两遍）。
 *
 * 这里一次性把"页面上有什么"抽成稳定 JSON：
 *   - 每个元素都带可直接喂给 annotate.js 的 selector（box），取证时不用再猜
 *   - 按钮按"会不会改数据"分级（mutate / reset / read / nav），只读测试时一眼知道哪些不能点
 *   - 输出版本号 dxsnap/v1，可存档、可 diff（回归时证明"页面结构真的没变"）
 *
 * 只读：不点击、不输入、不打开下拉，只读 DOM 与几何信息。
 */

const SCHEMA = 'dxsnap/v1';

/**
 * 在页面里跑：返回结构化清单。
 * 注意这个函数会被序列化后送进浏览器，不能引用外部变量。
 */
function collect(payload) {
  const { appSel, maxTree, maxRows, includeHidden } = payload;
  const main = document.querySelector(appSel) || document.body;
  const vis = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  };
  const tx = (e, n) => (e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 120) : '');
  const cls = (e) => (e && e.classList ? [...e.classList] : []);
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));

  // 唯一 CSS 路径：优先 id，其次 class + nth-of-type；生成后自检唯一性
  const cssPath = (el, root) => {
    const seg = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== root) {
      const id = cur.id;
      if (id && /^[A-Za-z][\w-]{2,}$/.test(id) && document.querySelectorAll('#' + esc(id)).length === 1) {
        seg.unshift('#' + esc(id));
        break;
      }
      let s = cur.tagName.toLowerCase();
      const cs = cls(cur).filter((c) => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
      if (cs.length) s += '.' + cs.map(esc).join('.');
      const par = cur.parentElement;
      if (par && par !== root) {
        const same = [...par.children].filter((x) => x.tagName === cur.tagName);
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      seg.unshift(s);
      cur = par;
    }
    return seg.join(' > ');
  };

  const rootSel = appSel;
  const mkSel = (el, root) => {
    if (!el) return null;
    if (root && root !== main) {
      const p = cssPath(el, root);
      return p || null;                       // 弹窗内的元素：相对弹窗
    }
    const p = cssPath(el, main);
    if (!p) return null;
    if (p.startsWith('#')) return p;           // 命中了唯一 id，本身就是全页锚点
    return rootSel + ' > ' + p;               // 主页面：带容器前缀，方便全页 query
  };
  // 自检：选择器是否真的只命中一个可见元素
  const selOk = (sel, root) => {
    if (!sel) return false;
    try {
      const scope = root || document;
      return [...scope.querySelectorAll(sel)].filter(vis).length === 1;
    } catch (e) { return false; }
  };
  const box = (el, root, text) => {
    const sel = mkSel(el, root);
    if (!sel) return null;
    const b = { sel };
    if (text) b.text = text;
    return selOk(sel, root) ? b : null;
  };
  // 短选择器优先：'.tool-item-button' + 文字，比几百字符的层级路径可读、耐改版
  const boxBy = (shortSel, text, el, root) => {
    const t = (text || '').trim();
    if (shortSel && t) {
      try {
        const scope = root || document;
        const pool = [...scope.querySelectorAll(shortSel)].filter(vis)
          .filter((x) => (x.innerText || x.textContent || '').replace(/\s+/g, ' ').trim() === t);
        if (pool.length === 1) return { sel: shortSel, text: t };
      } catch (e) { /* 组合选择器写错就退回路径 */ }
    }
    return box(el, root, t || undefined);
  };

  /* ---------------- 表单字段 ---------------- */
  const CONTROL = 'input, textarea, select, .el-select, .el-date-editor, .el-switch, .el-radio-group, .el-checkbox-group';
  const fieldOf = (ctrl, rootIsh) => {
    const item = ctrl.closest('.el-form-item, .dee-form-item');
    const labEl = item && item.querySelector('.el-form-item__label, .dee-form-item__label, label');
    let label = tx(labEl, 60).replace(/[:：*＊\s]+$/g, '').trim();
    let control = ctrl;
    if (!label) {
      const ph = ctrl.getAttribute && ctrl.getAttribute('placeholder');
      label = ph ? String(ph).replace(/^请输入|^请选择/, '').trim() : '';
    }
    const tag = ctrl.tagName.toLowerCase();
    let type = 'input';
    if (tag === 'textarea') type = 'textarea';
    else if (tag === 'select' || cls(ctrl).includes('el-select')) type = 'select';
    else if (cls(ctrl).includes('el-date-editor')) type = 'date';
    else if (cls(ctrl).includes('el-switch')) type = 'switch';
    else if (cls(ctrl).includes('el-radio-group')) type = 'radio';
    else if (cls(ctrl).includes('el-checkbox-group')) type = 'checkbox-group';
    else if (tag === 'input') {
      const t = (ctrl.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') type = t;
      else if (t === 'password') type = 'password';
      else if (t === 'number') type = 'number';
      if (ctrl.readOnly) type = 'readonly';
    }
    const inner = ctrl.matches && ctrl.matches('input, textarea') ? ctrl : ctrl.querySelector('input, textarea');
    let value = '';
    if (inner) value = inner.value || '';
    if (type === 'select' && !value) value = tx(ctrl.querySelector('.el-select__placeholder, .el-input__inner'), 60);
    const required = !!(item && (cls(item).includes('is-required') || (labEl && /[*＊]/.test(labEl.innerText || ''))));
    return {
      label: label || '(无标签)',
      type,
      value: String(value).slice(0, 80),
      required,
      disabled: !!(ctrl.disabled || cls(ctrl).includes('is-disabled') || (item && cls(item).includes('is-disabled'))),
      placeholder: (ctrl.getAttribute && ctrl.getAttribute('placeholder')) || (inner && inner.getAttribute('placeholder')) || '',
      sel: mkSel(ctrl, rootIsh),
      itemSel: item ? mkSel(item, rootIsh) : null,
      labelSel: labEl ? mkSel(labEl, rootIsh) : null,
      box: labEl
        ? boxBy('.el-form-item__label, .dee-form-item__label, label', label, labEl, rootIsh)
        : box(ctrl, rootIsh),
      rect: (() => { const r = ctrl.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()
    };
  };

  const collectFields = (root) => {
    const out = [];
    const seen = new Set();
    for (const c of [...root.querySelectorAll(CONTROL)].filter(vis)) {
      if (c.closest('.el-table')) continue;                    // 表格里的勾选框不算表单
      if (c.closest('.el-pagination')) continue;               // 跳页输入框
      const item = c.closest('.el-form-item, .dee-form-item') || c;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(fieldOf(c, root === main ? null : root));
    }
    return out;
  };

  /* ---------------- 页签 ---------------- */
  const tabs = [...main.querySelectorAll('.el-tabs__item')].filter(vis).map((e) => {
    const t = tx(e, 40);
    return { text: t, active: cls(e).includes('is-active'), disabled: cls(e).includes('is-disabled'), box: boxBy('.el-tabs__item', t, e, null) };
  });

  /* ---------------- 工具栏按钮 ---------------- */
  const RISK = [
    ['mutate', /新建|新增|添加|创建|保存|提交|删除|移除|导入|上传|作废|审核|审批|发布|启用|禁用|完成|确定|确认|修改|编辑|更新|同步|下发|回写/],
    ['reset', /重置|清空/],
    ['read', /查询|搜索|导出|下载|刷新|打印|详情|查看|展开|收起|筛选|排序/],
    ['nav', /上一页|下一页|返回|关闭|取消|首页|末页/]
  ];
  const riskOf = (t) => {
    for (const [k, re] of RISK) if (re.test(t)) return k;
    return 'other';
  };
  const btnText = (e) => tx(e, 40);
  const toolbarAll = [...main.querySelectorAll('.tool-item-button, .el-button, button')]
    .filter((e) => vis(e) && !e.closest('.el-table') && !e.closest('.el-pagination') && !e.closest('.el-dialog'))
    .map((e) => {
      // 只保留最外层容器，去掉 button 里再套 span 的重复项
      const host = e.closest('.tool-item-button') || e;
      return { el: host, text: btnText(host) || btnText(e) };
    })
    .filter((x) => x.text);
  const seenBtn = new Set();
  const toolbar = [];
  for (const b of toolbarAll) {
    if (seenBtn.has(b.el)) continue;
    seenBtn.add(b.el);
    const r = b.el.getBoundingClientRect();
    toolbar.push({
      text: b.text,
      risk: riskOf(b.text),
      disabled: cls(b.el).includes('is-disabled') || b.el.hasAttribute('disabled'),
      box: boxBy(cls(b.el).includes('tool-item-button') ? '.tool-item-button' : '.el-button', b.text, b.el, null),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    });
  }

  /* ---------------- 表格 ---------------- */
  const pagText = (() => {
    const ps = [...main.querySelectorAll('.el-pagination')].filter(vis).map((p) => tx(p, 200));
    return ps;
  })();
  const totalOf = (texts) => {
    for (const t of texts) {
      const m = t.match(/共\s*([\d,]+)\s*条/);
      if (m) return m[1].replace(/,/g, '');
    }
    return null;
  };
  const tables = [...main.querySelectorAll('.el-table')].filter(vis).map((t, i) => {
    const hw = t.querySelector(':scope > .el-table__header-wrapper') || t.querySelector('.el-table__header-wrapper');
    const bw = t.querySelector(':scope > .el-table__body-wrapper') || t.querySelector('.el-table__body-wrapper');
    const ths = hw ? [...hw.querySelectorAll('thead th')].filter(vis) : [];
    const headers = ths.map((th) => {
      const cell = th.querySelector('.cell') || th;
      const text = tx(cell, 60);
      return {
        text,
        sortable: cls(th).includes('is-sortable') || !!th.querySelector('.caret-wrapper'),
        width: Math.round(th.getBoundingClientRect().width),
        box: text ? boxBy('.el-table__header-wrapper th .cell', text, cell, null) : null
      };
    });
    const rows = bw ? [...bw.querySelectorAll('tbody tr')].filter(vis).length : 0;
    const empty = [...t.querySelectorAll('.el-table__empty-text')].filter(vis).map((e) => tx(e, 40))[0] || '';
    return {
      index: i,
      headers,
      columns: headers.length,
      rows,
      emptyText: empty,
      checkbox: !!t.querySelector('thead .el-checkbox'),
      total: totalOf(pagText),
      box: selOk(mkSel(t, main), null) ? { sel: mkSel(t, main) } : null
    };
  });

  /* ---------------- 分页 ---------------- */
  const pagination = [...main.querySelectorAll('.el-pagination')].filter(vis).map((p) => ({
    text: tx(p, 200),
    total: totalOf([tx(p, 200)]),
    page: (p.querySelector('.el-pager li.is-active, .el-pager li.active') && tx(p.querySelector('.el-pager li.is-active, .el-pager li.active'), 10)) || '',
    sizes: [...p.querySelectorAll('.el-select')].filter(vis).map((s) => tx(s, 20)).filter(Boolean)
  }));

  /* ---------------- 弹窗 ---------------- */
  const dialogs = [...document.querySelectorAll('.el-dialog__wrapper, .el-overlay')]
    .filter((w) => vis(w) && w.querySelector('.el-dialog'))
    .map((w) => {
      const dlg = w.querySelector('.el-dialog');
      const titleEl = dlg.querySelector('.el-dialog__title');
      const title = tx(titleEl || dlg.querySelector('.el-dialog__header'), 60);
      const r = dlg.getBoundingClientRect();
      const dfields = collectFields(dlg);
      // 弹窗里的选择器是相对弹窗的，必须带上 dialog 名，annotate 才知道去哪个弹窗里找
      for (const f of dfields) {
        f.dialog = title;
        if (f.box) f.box = { dialog: title, ...f.box };
      }
      const tpath = titleEl ? mkSel(titleEl, dlg) : null;
      const dbtns = [...dlg.querySelectorAll('.el-button, button')]
        .filter((b) => vis(b) && !b.closest('.el-table'))
        .map((b) => {
          const t = btnText(b);
          const bsel = t ? box(b, dlg, t) : null;
          return {
            text: t,
            risk: riskOf(t),
            disabled: b.disabled || cls(b).includes('is-disabled'),
            box: bsel ? { dialog: title, ...bsel } : null
          };
        })
        .filter((b) => b.text);
      return {
        title,
        titleBox: tpath ? { dialog: title, sel: tpath } : null,
        fields: dfields,
        buttons: dbtns,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      };
    });

  /* ---------------- 分类树 ---------------- */
  let tree = [];
  for (const ts of ['.el-tree-node__content', '.dee-tree-node', '[class*="tree-node"]']) {
    const nodes = [...main.querySelectorAll(ts)].filter(vis);
    if (!nodes.length) continue;
    tree = nodes.slice(0, maxTree).map((n) => {
      let level = 0;
      let p = n.parentElement;
      while (p && p !== main) {
        if (p.classList && p.classList.contains('el-tree-node')) level++;
        p = p.parentElement;
      }
      return {
        text: tx(n, 60),
        level,
        selected: cls(n).includes('is-current') || cls(n.parentElement || n).includes('is-current'),
        expanded: !!(n.parentElement && cls(n.parentElement).includes('is-expanded')),
        box: boxBy('.el-tree-node__content', tx(n, 60), n, null)
      };
    }).filter((x) => x.text);
    break;
  }

  const fields = collectFields(main);

  return {
    appContainer: appSel,
    activeTab: [...main.querySelectorAll('.el-tabs__item.is-active')].filter(vis).map((e) => tx(e, 40)),
    tabs,
    toolbar,
    fields,
    tables,
    pagination,
    dialogs,
    tree,
    emptyText: [...main.querySelectorAll('.el-table__empty-text')].filter(vis).map((e) => tx(e, 40))[0] || '',
    loadingMask: !!main.querySelector('.el-loading-mask'),
    headings: [...main.querySelectorAll('h1,h2,h3,.page-title')].filter(vis).map((e) => tx(e, 60)).filter(Boolean).slice(0, 5)
  };
}

/** 调页面取数，补上身份信息与统计 */
async function snapshotPage(page, cfg, opts = {}) {
  const raw = await page.evaluate(collect, {
    appSel: cfg.appContainer || '.app-main',
    maxTree: opts.maxTree || 80,
    maxRows: opts.maxRows || 50,
    includeHidden: false
  });

  const id = await page.evaluate(({ appSel, menuSel }) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const text = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector(appSel) || document.body;
    const menu = menuSel ? document.querySelector(menuSel) : null;
    return {
      hash: decodeURIComponent(location.hash || ''),
      url: location.href,
      title: document.title,
      menu: menu
        ? [...menu.querySelectorAll('[class*="is-active"], .active')].filter(vis).map(text).filter((t) => t && t.length <= 24).slice(0, 6)
        : [],
      textLen: text(main).length
    };
  }, { appSel: cfg.appContainer || '.app-main', menuSel: cfg.menuContainer });

  const riskSummary = { mutate: [], reset: [], read: [], nav: [], other: [] };
  for (const b of raw.toolbar) (riskSummary[b.risk] || (riskSummary[b.risk] = [])).push(b.text);
  for (const d of raw.dialogs) for (const b of d.buttons) (riskSummary[b.risk] || (riskSummary[b.risk] = [])).push(d.title + ' / ' + b.text);

  const tableRows = raw.tables.reduce((n, t) => n + t.rows, 0);
  const tableCols = raw.tables.reduce((n, t) => n + t.columns, 0);

  return {
    schema: SCHEMA,
    at: new Date().toISOString(),
    identity: id,
    activeTab: raw.activeTab,
    counts: {
      tabs: raw.tabs.length,
      toolbar: raw.toolbar.length,
      fields: raw.fields.length,
      tables: raw.tables.length,
      columns: tableCols,
      rows: tableRows,
      dialogs: raw.dialogs.length,
      treeNodes: raw.tree.length
    },
    riskSummary,
    ...raw
  };
}

/* ---------------- diff ---------------- */

function diffList(a, b, keyFn) {
  const A = new Map((a || []).map((x) => [keyFn(x), x]));
  const B = new Map((b || []).map((x) => [keyFn(x), x]));
  const added = [...B.keys()].filter((k) => !A.has(k));
  const removed = [...A.keys()].filter((k) => !B.has(k));
  const changed = [];
  for (const [k, va] of A) {
    const vb = B.get(k);
    if (!vb) continue;
    if (JSON.stringify(va) !== JSON.stringify(vb)) changed.push(k);
  }
  return { added, removed, changed };
}

/**
 * 两份快照的差异。只比"会影响结论"的东西：身份、页签、按钮、字段、列、行数、总数。
 * 几何位置、时间戳、选择器路径不参与比较（页面滚动/重排会产生噪声）。
 */
function diffSnapshots(a, b) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const norm = (s) => ({
    tabs: uniq((s.tabs || []).map((t) => t.text)),
    toolbar: uniq((s.toolbar || []).map((t) => t.text)),
    fields: (s.fields || []).map((f) => ({ k: f.label, v: f.type + (f.required ? '|必填' : '') })),
    columns: uniq((s.tables || []).flatMap((t) => (t.headers || []).map((h) => h.text))),
    rows: (s.tables || []).map((t) => t.rows),
    totals: (s.tables || []).map((t) => t.total),
    dialogs: uniq((s.dialogs || []).map((d) => d.title)),
    activeTab: s.activeTab || [],
    hash: (s.identity || {}).hash || ''
  });
  const A = norm(a);
  const B = norm(b);
  const setDiff = (x, y) => ({ added: y.filter((v) => !x.includes(v)), removed: x.filter((v) => !y.includes(v)) });

  const fieldDiff = diffList(A.fields, B.fields, (x) => x.k);

  const buttons = setDiff(A.toolbar, B.toolbar);
  const tabs = setDiff(A.tabs, B.tabs);
  const columns = setDiff(A.columns, B.columns);
  const columnsOrder = {
    from: (a.tables || []).map((t) => (t.headers || []).map((h) => h.text).filter(Boolean)),
    to: (b.tables || []).map((t) => (t.headers || []).map((h) => h.text).filter(Boolean)),
    changed: JSON.stringify((a.tables || []).map((t) => (t.headers || []).map((h) => h.text).filter(Boolean).join('|')))
      !== JSON.stringify((b.tables || []).map((t) => (t.headers || []).map((h) => h.text).filter(Boolean).join('|')))
  };
  const dialogs = setDiff(A.dialogs, B.dialogs);
  const rowsChanged = JSON.stringify(A.rows) !== JSON.stringify(B.rows);
  const totalsChanged = JSON.stringify(A.totals) !== JSON.stringify(B.totals);

  const changed = !!(buttons.added.length || buttons.removed.length || tabs.added.length || tabs.removed.length
    || fieldDiff.added.length || fieldDiff.removed.length || fieldDiff.changed.length
    || columns.added.length || columns.removed.length || columnsOrder.changed || dialogs.added.length || dialogs.removed.length
    || rowsChanged || totalsChanged || JSON.stringify(A.activeTab) !== JSON.stringify(B.activeTab));

  return {
    changed,
    identity: {
      hash: { from: A.hash, to: B.hash, changed: A.hash !== B.hash },
      activeTab: { from: A.activeTab, to: B.activeTab, changed: JSON.stringify(A.activeTab) !== JSON.stringify(B.activeTab) }
    },
    tabs,
    toolbar: buttons,
    fields: fieldDiff,
    columns,
    columnsOrder,
    dialogs,
    rows: { from: A.rows, to: B.rows, changed: rowsChanged },
    totals: { from: A.totals, to: B.totals, changed: totalsChanged }
  };
}

module.exports = { SCHEMA, snapshotPage, diffSnapshots, collect };
