# 07 · 新人上手：第一次拿到这个 skill，怎么开始

> 目标：**不碰被测系统**先跑通一遍全链路，再用 1 个页面走完真实流程。
> 全程 90 分钟内能做完；做完你就有一张标注图、一段缺陷视频、一份单文件报告——不是"看懂了"，是"做出来了"。

---

## 1. 你需要准备什么（10 分钟）

| 项 | 要求 | 检查命令 |
|---|---|---|
| Node.js | ≥ 18 | `node -v` |
| Playwright + Chromium | 能启动浏览器 | `npm i playwright && npx playwright install chromium` |
| ffmpeg | 切片 / GIF / 读时长（没有会自动跳过，但出不了视频） | `ffmpeg -version` |
| 一个可登录的测试系统 | 地址 + 账号；只读账号优先 | 浏览器能打开登录页 |
| 编辑器/终端 | 写文件用 **Node `fs` 或编辑器**，别用 PowerShell 拼中文路径 | — |

> Windows 上中文路径最容易出事：脚本内部一律用 Node 写文件；命令行里传中文文件名时加双引号。

---

## 2. 30 分钟路径 A：先跑自检（不需要被测系统）

这一步**不连任何系统**，只在临时目录里造一个假页面，把「截图 → 留白标注 → 打点切片 → 内嵌 → PDF」整条链路跑一遍。它失败，说明你的环境有问题，和被测系统无关。

```bash
cd dextestweb
node scripts/selftest.js
```

预期输出（逐项 ✓）：

```
✓ 标注截图
✓ 单文件 HTML
✓ 资源已内嵌
✓ PDF
✓ 缺陷视频
✓ 视频已内嵌
```

产物在 `%TEMP%\dextestweb-selftest\`（Windows）。打开三样东西看一眼，建立"正常长什么样"的直觉：

| 文件 | 你要确认什么 |
|---|---|
| `annotated.png` | 原图没被遮；编号在左右留白，说明在下边留白，引线指到元素 |
| `report.html` | 双击就能看；图片、视频都在里面（断网也能播） |
| `*.mp4` + `-封面.jpg` | 视频上方有标题条；封面单看也能读懂 |

**没装 ffmpeg**：视频两项会自动跳过，标成"跳过（未装 ffmpeg）"——这不是失败，但真实交付前必须装。

---

## 3. 30 分钟路径 B：真实系统的一个页面（最小可跑通示例）

下面是一次**完整的**从零输入到产出。系统地址、账号、页面均为占位，照抄改值即可。

### 3.1 建配置（5 分钟）

```bash
cp templates/config.example.json config.json
```

只改这 6 处（其余保持默认，默认值就是 1600×1000 视口 + 免登录缓存）：

```json
{
  "baseUrl": "http://127.0.0.1:8080/",          // ← 换成被测系统地址
  "login": {
    "url": "http://127.0.0.1:8080/",            // ← 登录页地址
    "userSelector": "input[placeholder=\"用户名\"]",  // ← 用 F12 核对当前文案
    "passSelector": "input[placeholder=\"密码\"]",
    "username": "readonly-demo",                // ← 客户给的账号
    "password": "demo1234",
    "submitSelector": "button:has-text(\"登录\")",
    "success": "() => !location.hash.includes('login')"
  },
  "appContainer": ".app-main",                  // ← 主内容区
  "menuContainer": ".sidebar-container",        // ← 侧边菜单容器
  "readySelector": ".app-main .el-table__body tbody tr"   // ← "这页已经加载好"的标志元素
}
```

`readySelector` 是全局最重要的一个字段：**它决定你后面所有"等加载"的判断**。选一个"页面真有数据时才出现"的元素（表格行、页签、标题），不要选"一直存在"的容器。

### 3.2 登录 + 摸底（10 分钟）

```bash
node scripts/census.js --config config.json
```

看日志三件事：登录耗时、菜单项数量、生成 `census.json`。打开 `census.json`，找两类行：

- `suspectStale: true` → 点击没生效，这页的数**先别用**；
- `rows` 与 `pagination` 里的总数不一致 → 记进 `01-页清单.md`，待复核。

### 3.3 单页取证（10 分钟）

挑一页有页签的（占位示例：生产订单管理 → 页签「全部」）：

```bash
node scripts/snap.js --config config.json \
  --url "http://127.0.0.1:8080/#/page/order" \
  --tab "全部" --expect-tab "全部" --verbose --json snap-order.json

node scripts/probe.js --config config.json \
  --url "http://127.0.0.1:8080/#/page/order" \
  --expect-tab "全部" --filters "未投产,已投产" --json probe-order.json
```

两件事必须发生，否则这一步没做完：

1. `--expect-tab` 对不上时，脚本**退出码 2 + 截图**，不许继续读数（这是身份闸门）。
2. `probe-order.json` 里有"页面行数 / 分页总数 / 接口 total"三个数。

### 3.4 出一张标注图（5 分钟）

```js
// demo-annotate.js（放仓库根，跑完可删）
const { shot } = require('./scripts/lib/annotate');
const { loadConfig, openSession, gotoPage, expectPage } = require('./scripts/lib/session');

(async () => {
  const cfg = loadConfig('config.json');
  const s = await openSession(cfg);
  await gotoPage(s.page, cfg, { url: 'http://127.0.0.1:8080/#/page/order' });
  await expectPage(s.page, cfg, { tab: '全部' });        // 身份闸门：对不上就抛异常

  await shot(s.page, '01-计划4件已投33件.png', {
    title: '生产订单：计划 4 件，已投 33 件',
    sub: '订单 PO_样例-0001（占位）· 只读抽查',
    accent: '#e74c3c',
    boxes: [
      { dialogCol: '计划数量', row: 0, label: '计划数量 = 4', color: '#e67e22' },
      { dialogCol: '已投数量', row: 0, label: '已投 33（超计划 29）', color: '#e74c3c' }
    ],
    url: s.page.url()
  });
  await s.ctx.close();
})();
```

```bash
node demo-annotate.js
```

看到一张"原图没被遮、编号在空白里"的图，你就跑通了 **路径 B 的全部环节**。

### 3.5 出片 + 打包（5 分钟，可跳过验缺口）

- 出片：复制 `templates/demo-script.js`，把中间操作换成你的，`demo.mark()` 打在**动作之前**。
- 打包：写 3 句话的报告 → `node scripts/md2html.js 03-报告.md` → `node scripts/pack.js --html 03-报告.html --name "样例-订单"`。

---

## 4. 最小示例的产物验收表

跑完路径 B，磁盘上应该长这样。**缺一项就是没跑通**：

| 产物 | 位置 | 合格判据 |
|---|---|---|
| `config.json` | 仓库根 | 第二次运行出现"复用登录态" |
| `.auth/<host>.json` | 仓库根 | 存在且非 0 字节 |
| `census.json` | 仓库根 | 有 `modules` 数组，每项含 URL 与行数 |
| `snap-order.json` | 仓库根 | 有页签 / 按钮分级 / 字段 / 列 / 分页 |
| `probe-order.json` | 仓库根 | 行数、分页 total、接口 total 三样齐全 |
| `01-xxx.png` | 任意 | 宽度 = 原图宽 + 左右留白（默认 88×2） |
| 单文件 HTML | 交付目录 | 断网双击，图片视频都正常 |

---

## 5. 卡点自查清单（照着症状找）

| 症状 | 最可能原因 | 处理 | 别再做什么 |
|---|---|---|---|
| `chromium.launch` 报找不到浏览器 | 只装了 playwright 包，没下浏览器 | `npx playwright install chromium` | 别去改代码里的 `executablePath` |
| 登录一直失败 | 选择器文案过期 / 用了 `placeholder` 旧值 | F12 复制当前 `placeholder` 或改用 `:has-text()` | 别靠 `waitForTimeout` 硬等 |
| 第二次运行仍要求登录 | `.auth` 目录被 `.gitignore` 忽略外还删了 / cookie 过期 | 删 `.auth/<host>.json` 再用 `--fresh` 重登一次 | 别在脚本里写死账号密码 |
| 页面一直"没数据" | `readySelector` 命中的是常驻容器，或页面加载 10 秒以上 | 换 `readySelector` 为目标数据元素；记耗时 | 别直接判"功能没做" |
| 点菜单没反应 | 导航被 loading 挡住 / 菜单是折叠二级 | 跑 `census.js` 看 `suspectStale` | 别连续快速点多个菜单 |
| 读数与接口对不上 | 读的是上一个页签 | 加 `--expect-tab` 复核 | 别只截一张图就定性 |
| 中文文件名乱码 / 文件建不出来 | PowerShell 拼中文路径 | 改用 Node `fs` 或编辑器 | 别在命令行里手打长中文路径 |
| `ffmpeg` 找不到 | 没装或不在 PATH | 装 ffmpeg 后重开终端 | 别把"没生成视频"写成"视频链路坏了" |
| PDF 中文变方块 | 打印时字体缺失 | 用 HTML 版交付，PDF 仅兜底 | 别为了 PDF 改图片分辨率 |
| 单文件 HTML 图片打不开 | 报告里用了相对路径没经过 `pack.js` | 必须走 `md → md2html → pack` | 别手工拼 `<img src>` |
| 视频是黑屏 / 0 字节 | 切片越界或标记打晚了 | 看 `finishDemo()` 的告警，`pre` 调大 | 别交付没自检过的 mp4 |
| `snap.js` 退出码 2 | 页签文字对不上（**这是设计行为**） | 重进页面再试；确认页签文案 | 别把退出码 2 当脚本坏了 |
| `snap.js` 退出码 4 | `--diff` 比出结构变化 | 确认是预期变更还是回归 | 别删 `--fail-on-change` 绕过门禁 |
| 遍历菜单极慢 | 系统本身慢 / 视口太大 / 每次都重登 | 复用登录态；必要时降视口 | 别并发开多个浏览器 |

---

## 6. 第一天的合格线（做完这些再谈"测得好不好"）

- [ ] `selftest.js` 六项全绿（没有 ffmpeg 时至少四项）
- [ ] `config.json` 改完能免登录复用
- [ ] `census.json` 里能指出 1 个 `suspectStale` 或行数/分页不一致的页面
- [ ] 对 1 个页面完成"身份闸门 + 结构清单 + 三方读数"
- [ ] 出 1 张留白标注图（原图零遮挡）
- [ ] 写 1 条缺陷记录，含两种证据
- [ ] 打包 1 份单文件 HTML，断网能看

---

## 7. 跑通之后读什么

| 你现在的状态 | 去读 |
|---|---|
| 会跑脚本，但不知道下一步该干嘛 | [`06-runbook.md`](06-runbook.md) 的 9 个阶段 |
| 判断不了"这个数对不对" | [`04-industry.md`](04-industry.md) 的 10 条不变量 |
| 面对一页不知道该看什么 | [`05-mom-checks.md`](05-mom-checks.md) 按分组逐条对 |
| 要测工艺/工单/委外/成本这类流程 | [`08-manufacturing-prompts.md`](08-manufacturing-prompts.md) 的环节提示模板 |
| 结论被客户一句"复现不了"顶回来 | [`02-evidence.md`](02-evidence.md) 的双证据与复现写法 |
| 报告发出去打不开 | [`03-packaging.md`](03-packaging.md) 的中文路径坑 |
