#!/usr/bin/env node
/**
 * dextestweb · 视频切片 / GIF / 抽帧 / 联络表
 *
 *   node clip.js cut   <video> <start> <duration> <out.mp4> [--width 960] [--crf 23]
 *   node clip.js gif   <video> <start> <duration> <out.gif>  [--width 960] [--fps 8] [--crop 1240:720:180:150]
 *   node clip.js frame <video> <time> <out.png>
 *   node clip.js sheet <video> --times 36,48,60 --out sheet.png [--width 620] [--cols 6]
 *
 * 约定：
 *   - 切点从"动作前 2 秒"开始，结果出现后再留 3~5 秒。
 *   - GIF 走两遍调色板；palettegen 必须 -frames:v 1，否则报 "Could not get frame filename number 2"。
 *   - GIF > 3MB 时用 --crop / 降 --fps / 降 --width，通常 9MB → 500KB。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else pos.push(a);
}

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const run = (args) => execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const num = (v, d) => (v === undefined ? d : Number(v));

function cut(src, start, dur, out) {
  const width = num(flags.width, 0);
  const vf = width ? ['-vf', `scale=${width}:-2:flags=lanczos`] : [];
  run(['-ss', String(start), '-i', src, '-t', String(dur), ...vf,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(num(flags.crf, 23)),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
  console.log('[cut]', out, (fs.statSync(out).size / 1048576).toFixed(2) + 'MB');
}

function gif(src, start, dur, out) {
  const width = num(flags.width, 960);
  const fps = num(flags.fps, 8);
  const crop = flags.crop ? `crop=${flags.crop},` : '';
  const chain = `${crop}fps=${fps},scale=${width}:-2:flags=lanczos`;
  const pal = path.join(path.dirname(path.resolve(out)), '.palette.png');

  run(['-ss', String(start), '-i', src, '-t', String(dur),
    '-vf', `${chain},palettegen=stats_mode=diff`, '-frames:v', '1', pal]);
  run(['-ss', String(start), '-i', src, '-t', String(dur), '-i', pal,
    '-lavfi', `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    '-loop', '0', out]);
  fs.rmSync(pal, { force: true });

  const mb = fs.statSync(out).size / 1048576;
  console.log('[gif]', out, mb.toFixed(2) + 'MB');
  if (mb > 3) console.log('[gif] 偏大：加 --crop、--fps 6、--width 760 再跑一次');
}

function frame(src, time, out) {
  run(['-ss', String(time), '-i', src, '-frames:v', '1', out]);
  console.log('[frame]', out);
}

function sheet(src) {
  const times = String(flags.times || '').split(',').map(Number).filter((n) => !isNaN(n));
  if (!times.length) throw new Error('--times 必填，例如 --times 36,48,60');
  const width = num(flags.width, 620);
  const cols = num(flags.cols, Math.min(times.length, 6));
  const rows = Math.ceil(times.length / cols);
  const out = flags.out || 'sheet.png';
  const dir = path.join(path.dirname(path.resolve(out)), '.frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  times.forEach((t, i) => {
    run(['-ss', String(t), '-i', src, '-frames:v', '1', path.join(dir, `f${String(i).padStart(2, '0')}.png`)]);
  });

  run(['-i', path.join(dir, 'f%02d.png'),
    '-vf', `scale=${width}:-2,tile=${cols}x${rows}:padding=6:margin=6`, '-frames:v', '1', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[sheet]', out, times.map((t, i) => `${i + 1}=${t}s`).join(' '));
}

try {
  if (cmd === 'cut') cut(pos[0], pos[1], pos[2], pos[3]);
  else if (cmd === 'gif') gif(pos[0], pos[1], pos[2], pos[3]);
  else if (cmd === 'frame') frame(pos[0], pos[1], pos[2]);
  else if (cmd === 'sheet') sheet(pos[0]);
  else {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
