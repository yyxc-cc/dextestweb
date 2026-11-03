/**
 * dextestweb · 缺陷视频演示（demo）
 *
 * 目标：**发现 bug 的那一下，就能交出一段能直接播的短视频**——不用回头补录、
 * 不用手工拖时间轴。做法是：
 *   1. 整个会话从打开浏览器就开始录（openSession 的 videoDir）
 *   2. 发现缺陷时打一个标记 `demo.mark('重置不重查')`
 *   3. 收尾时 finishDemo()：按标记前后各留几秒自动切片，生成 mp4 + 封面 + GIF
 *
 * 为什么整段录、再切：
 *   - 缺陷是走查中"撞见"的，事先不知道哪一秒会发生；
 *   - 事后补录会漏掉"操作前"的状态，说服力差一半；
 *   - 切片保留原始帧，时间戳对得上，能当证据。
 *
 * 只负责"录和切"，不点页面。标记要打在**动作发生前**（这样 pre 秒里能看到操作前状态）。
 *
 * 可选：caption=true（默认）会在画面上方加一条留白标题条（标题=标记名，副标题=备注），
 * 画面本身一个像素都不覆盖——和截图标注同一条原则。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

/** 文件名安全化：中文保留，去掉路径分隔符与报错字符 */
function safeName(s) {
  return String(s || 'clip')
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, '')
    .slice(0, 40);
}

/** 读视频宽高（同样不依赖 ffprobe） */
function probeSize(file) {
  for (const bin of [FFPROBE, FFMPEG]) {
    try {
      const args = bin === FFMPEG
        ? ['-hide_banner', '-i', file]
        : ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file];
      const out = execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const m = out.match(/(\d{2,5})[x,](\d{2,5})/);
      if (m) return { width: +m[1], height: +m[2] };
    } catch (e) {
      const txt = (e.stdout || '') + (e.stderr || '');
      const m = txt.match(/,\s*(\d{2,5})x(\d{2,5})[\s,]/);
      if (m) return { width: +m[1], height: +m[2] };
    }
  }
  return null;
}

function probeDuration(file) {
  // 不依赖 ffprobe（很多机器只装了 ffmpeg）：从 ffmpeg -i 的 stderr 里读 Duration
  for (const bin of [FFPROBE, FFMPEG]) {
    try {
      const out = execFileSync(bin, bin === FFMPEG ? ['-hide_banner', '-i', file] : ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const d = parseFloat(out.trim());
      if (Number.isFinite(d) && d > 0) return d;
    } catch (e) {
      const txt = (e.stdout || '') + (e.stderr || '');
      const m = txt.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    }
  }
  return null;
}

function run(args) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

/**
 * 创建标记器。
 * @param page Playwright Page
 * @param videoStart openSession 返回的 videoStart（毫秒时间戳，视频从这一刻开始）
 */
function createDemo(page, videoStart) {
  const t0 = videoStart || Date.now();
  const marks = [];

  return {
    page,
    t0,
    marks,
    /** 打标记：请在"点下按钮/执行动作之前"调用。color 可选：红=缺陷、橙=待确认、绿=正常对照 */
    mark(name, note, opts = {}) {
      const t = Math.max(0, (Date.now() - t0) / 1000);
      const m = { name, note: note || '', color: opts.color || '#e74c3c', t: +t.toFixed(2) };
      marks.push(m);
      console.log(`[demo] 标记「${name}」@ ${m.t}s → 收尾时会切这附近`);
      return m;
    },
    elapsed() { return +((Date.now() - t0) / 1000).toFixed(1); }
  };
}

/** 标题条渲染：用浏览器排版（中文字体稳），输出 PNG，供 ffmpeg 贴到画面外的留白里 */
async function renderCaption(browser, { title, sub, width, height, file, color = '#e74c3c' }) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;background:#0f172a;color:#f8fafc;
      font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;
      height:${height}px;display:flex;flex-direction:column;justify-content:center;
      padding:0 20px;border-bottom:3px solid ${color}}
    .t{font-size:${Math.round(height * 0.30)}px;font-weight:700;line-height:1.2;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .s{font-size:${Math.round(height * 0.19)}px;color:#9fb0c8;line-height:1.3;margin-top:2px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`);
  await p.screenshot({ path: file, type: 'png' });
  await c.close();
  return file;
}

/**
 * 收尾：关页 → 拿视频 → 按标记切片 → 出封面/GIF。
 *
 * @param opts.outDir     片段输出目录（一般就是报告目录）
 * @param opts.pre        标记点往前留几秒（默认 8：够看到操作前的状态）
 * @param opts.post       标记点往后留几秒（默认 10：够看到结果稳定）
 * @param opts.gif        是否同时出 GIF（默认 true，报告里当"会动的缩略图"）
 * @param opts.full       是否把整段走查也转成 mp4（默认 false，原始 webm 留在 videoDir）
 * @param opts.indexStart 编号起点（默认 1，文件名形如 01-重置不重查.mp4）
 * @param opts.caption    是否在画面上方加留白标题条（默认 true；标题=标记名，副标题=备注）
 * @returns {Promise<{raw:string, clips:Array, full:string|null}>}
 */
async function finishDemo({ page, ctx, demo, outDir, pre = 8, post = 10, gif = true, full = false, indexStart = 1, caption = true }) {
  if (!page.video) throw new Error('这个会话没有开录像：openSession(cfg, { videoDir: ... }) 才能用 demo');
  const video = page.video();
  const endWall = Date.now();

  await page.close().catch(() => {});
  await ctx.close();

  const raw = await video.path();          // close 之后才拿得到最终文件
  if (!raw || !fs.existsSync(raw)) throw new Error('拿不到录像文件（videoDir 是否可写？）');
  const dur = probeDuration(raw);
  // 标记录的是"从 openSession 起算"的墙钟；视频可能晚几秒才真正开录（首帧到达才计时）。
  // 用 结束墙钟 - 视频时长 反推视频 0 点，避免切出来的片段整体偏移、错过点击那一下。
  const offset = dur ? Math.max(0, (endWall - dur * 1000 - demo.t0) / 1000) : 0;
  if (offset > 0.5) console.log(`[demo] 视频比墙钟晚 ${offset.toFixed(1)}s 开录，已按此校准切口`);
  fs.mkdirSync(outDir, { recursive: true });

  const clips = [];
  let i = indexStart;
  const browser = ctx.browser();
  const size = probeSize(raw);
  const capH = size ? Math.max(56, Math.round(size.height * 0.095 / 2) * 2) : 72;
  for (const m of demo.marks) {
    // 夹取：起点不能越过视频末尾（否则 ffmpeg 静默出一个空文件）
    let start = Math.max(0, m.t - offset - pre);
    if (dur) start = Math.min(start, Math.max(0, dur - 1.5));
    let len = pre + post;
    if (dur) len = Math.min(len, Math.max(1, dur - start));
    const base = String(i).padStart(2, '0') + '-' + safeName(m.name);
    const file = path.join(outDir, base + '.mp4');
    const poster = path.join(outDir, base + '-封面.jpg');

    try {
      run(['-ss', start.toFixed(2), '-i', raw, '-t', len.toFixed(2),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-an', '-movflags', '+faststart', file]);

      // 标题条：加在画面上方，画面本身不动（和截图"标注在留白里"同一条原则）
      if (caption && size) {
        const capPng = path.join(outDir, base + '-标题条.png');
        try {
          await renderCaption(browser, {
            title: m.name,
            sub: m.note || '',
            width: size.width,
            height: capH,
            file: capPng,
            color: m.color
          });
          const capped = path.join(outDir, base + '-capped.mp4');
          run(['-i', file, '-i', capPng, '-filter_complex',
            `[0:v]pad=iw:ih+${capH}:0:${capH}:black[v];[v][1:v]overlay=0:0,format=yuv420p`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an',
            '-movflags', '+faststart', capped]);
          fs.unlinkSync(file);
          fs.renameSync(capped, file);
          fs.unlinkSync(capPng);
        } catch (e) {
          console.warn(`[demo] 标题条没贴上（保留原片）：${e.message}`);
        }
      }

      // 封面取"结果已经稳定"的那一帧（片段结束前 2.5 秒），而不是动作发生的瞬间
      run(['-ss', Math.max(0.3, len - 2.5).toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '2', poster]);

      let gifFile = null;
      if (gif) {
        gifFile = path.join(outDir, base + '.gif');
        run(['-i', file, '-vf', 'fps=7,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
          gifFile]);
        // GIF 过大就降规格，报告里不塞 10MB 的动图
        if (fs.statSync(gifFile).size > 3 * 1024 * 1024) {
          run(['-i', file, '-vf', 'fps=6,scale=680:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer', gifFile]);
        }
      }

      clips.push({
        name: m.name,
        note: m.note,
        markAt: m.t,
        from: +start.toFixed(2),
        to: +(start + len).toFixed(2),
        file,
        poster,
        gif: gifFile,
        bytes: fs.statSync(file).size
      });
      // 自检：切口对了没有？太短基本就是起点越界/校准失败，宁可报出来也别交付黑屏
      const got = probeDuration(file);
      if (got != null && got < Math.min(3, len * 0.6)) {
        console.warn(`[demo] ⚠ 片段只有 ${got.toFixed(1)}s（应约 ${len.toFixed(1)}s）——标记点可能超出录像范围`);
      }
      console.log(`[demo] 切片 ${path.basename(file)}  ${(got ?? len).toFixed(1)}s  ${(fs.statSync(file).size / 1048576).toFixed(1)}MB`);
    } catch (e) {
      console.warn(`[demo] 切「${m.name}」失败：${e.message}`);
    }
    i++;
  }

  let fullFile = null;
  if (full) {
    fullFile = path.join(outDir, '00-完整走查.mp4');
    try {
      run(['-i', raw, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', fullFile]);
    } catch (e) {
      console.warn('[demo] 整段转 mp4 失败：' + e.message);
      fullFile = null;
    }
  }

  return { raw, duration: dur, clips, full: fullFile };
}

/**
 * 报告里插视频的标准写法（md2html / pack.js 都认）：
 *   ![重置只清条件不重查](03-重置不重查.mp4)
 * 封面同目录、同名 `-封面.jpg` 时，md2html 会自动挂到 poster 上。
 */
function reportSnippet(clip, relDir) {
  const rel = (p) => (relDir ? path.relative(relDir, p).replace(/\\/g, '/') : path.basename(p));
  return `![${clip.name}](${rel(clip.file)})`;
}

module.exports = { createDemo, finishDemo, reportSnippet, safeName, probeDuration, probeSize, renderCaption };
