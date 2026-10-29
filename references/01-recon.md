# 01 · 摸骨架：没有文档，怎么在 1 小时内知道系统有什么

目标不是"看懂业务"，而是拿到一张可核对的表：

```
菜单 → 路由(URL) → 页面标题 → 标签页 → 表格行数 → 分页总数 → 工具按钮 → 接口
```

后面所有"这个功能有没有做"的判断，都靠这张表撑住。

## 1. 登录与首屏

- 登录选择器按 placeholder / label 找，别按 class（class 会变）：`input[placeholder="用户名"]`
- 登录成功的判据用 URL 变化或工作台元素出现，**不要用固定 sleep**
- 首屏截一张全景图：菜单层级、顶栏、面包屑都在里面，后面写报告要引用

## 2. 抓接口（比翻页面快十倍）

```js
const hits = [];
page.on('response', async (r) => {
  if (!r.url().includes('/api/')) return;
  hits.push({ status: r.status(), url: r.url(), method: r.request().method() });
});
```

重点看两类：

1. **列表查询**：通常叫 `*/search`、`*/page`、`*/list`。返回里的 `totalElements` / `total` / `count` 就是"库里到底有多少条"，是页面分页的对照组。
2. **4xx/5xx**：404 的静态资源、404 的业务接口（例如类型树）、502/504（后端扛不住）。这些不用复现，直接记下来就是证据。

> 有些系统接口并不在 `/api/` 下，用 `r.request().resourceType() === 'xhr' || 'fetch'` 兜底。

## 3. 遍历菜单

```js
// 侧边栏叶子项：文本短、可见、没有同文本的子元素
const labels = await page.evaluate((sel) => {
  const root = document.querySelector(sel);
  const out = [];
  root.querySelectorAll('*').forEach((e) => {
    const t = (e.innerText || '').trim();
    const r = e.getBoundingClientRect();
    if (!t || t.length > 20 || !r.width || !r.height) return;
    if ([...e.children].some((k) => (k.innerText || '').trim() === t)) return;
    out.push(t);
  });
  return [...new Set(out)];
}, '.sidebar-container');
```

每个菜单点一次，**等待目标内容出现**再取数。用 `scripts/census.js` 一次跑完。

要点：

- 菜单点击后可能先进"旧页面"，`rows` 还是上一页的数——所以等待条件必须绑定"新页面的特征"（标签页文案、表头列名、页面标题）。
- 标签页（`.el-tabs__item`）要单独点一遍，很多系统的"另一个功能"藏在标签页里，不在左侧菜单。
- 顶部工具栏按钮用 `.tool-item-button` / `.el-button`，行内操作在表格最后一列，两边都要看，否则会得出"这页没有按钮"的错误结论。

## 4. 四个数怎么读

| 指标 | 怎么取 | 异常信号 |
|---|---|---|
| 行数 | `.el-table__body tbody tr` 的可见数量 | 0 行 + 无 loading + 接口有数据 → 前端问题 |
| 分页总数 | **只取可见**的 `.el-pagination` 里的 `共 N 条` | 行数 > 0 但写 `共 0 条` → 分页 total 没接 |
| 标签页 | `.el-tabs__item` 文本 | 页面标题与菜单名不一致 → 路由复用，注意别测错页 |
| 按钮 | 顶部 + 行内 | 顶部没有不代表没功能，可能在行内"操作"列 |

> 隐藏的分页（`display:none` 或宽高 0）会骗人，务必过滤 `getBoundingClientRect().width > 0`。

## 5. 记录模型/数据量

如果系统暴露了模型管理、字典、或接口文档（Swagger / `/api/es/modeltree` 之类），把实体名和记录数抄下来：

```
DxProdOrder 1365 / MaDxProdWorkOrder 35 / MaDxProdJobTask 216 / MaExtProcessInspectTask 20
```

这份数字后面有两个用处：

- 页面 0 条 vs 接口 20 条 → 立刻定位是"没数据"还是"没显示"
- 客户问"你们测的是不是空库" → 直接甩数字

## 6. 没有入口的页面

有时客户说"这个模块我们有"，但菜单里找不到。两种可能：

1. **权限没开**（账号角色不够）→ 记录"未见入口，疑似权限"，不要下"没做"的结论
2. **路由存在但没挂菜单** → 从已访问页面的 hash 规律猜（`#/page/<uuid>?title=xxx`），或者从接口返回的菜单树里找

猜路由要谨慎：找到能打开 ≠ 功能可用。打开后仍按第 3 步取四个数。

## 7. 慢系统的特殊处理

- `page.goto` 用 `waitUntil: 'commit'`，再显式等登录框；大包体（几 MB 的 `app.js`）会让 `domcontentloaded` 超时
- 超时给到 90~120 秒；单次菜单切换实测记录秒数（这是性能证据）
- 慢不代表坏：把"点了 4 秒还是空白"单独记成性能/交互问题，不要混进功能缺失
