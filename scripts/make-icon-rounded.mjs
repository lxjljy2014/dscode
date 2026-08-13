import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * 生成 macOS 风格的 Dock 图标 PNG：
 * 1. 内容缩放：Apple 图标网格安全区约为画布的 80%（1024 画布内容 824），四周留白约 10%；
 *    源图满铺画布时在 Dock 里会显得过大，这里按 contentScale 双线性缩小并居中。
 * 2. 透明圆角：macOS Dock 不会自动给自定义图标加圆角，正式 .icns 的圆角是画进图里的；
 *    这里把圆角外区域处理为透明（4x4 超采样抗锯齿）。
 *
 * 用法: node scripts/make-icon-rounded.mjs [输入png] [输出png] [圆角半径比例=0.225] [内容占比=0.8]
 */

const [input = 'packages/desktop/resources/icon.png', output = input, ratioArg = '0.225', scaleArg = '0.8'] =
  process.argv.slice(2);
const cornerRatio = Number(ratioArg);
const contentScale = Number(scaleArg);

// ---------- PNG 解码（仅支持 8bit RGB/RGBA 非隔行） ----------

function decodePng(buf) {
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = chunks.find(c => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  if (ihdr[8] !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 格式: bitDepth=${ihdr[8]} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      out[x] = v;
    }
  }
  return { width, height, channels, pixels };
}

// ---------- PNG 编码（RGBA，filter 0） ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 圆角透明遮罩（4x4 超采样抗锯齿） ----------

function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  const inLeft = x < r;
  const inRight = x >= w - r;
  const inTop = y < r;
  const inBottom = y >= h - r;
  if (!inLeft && !inRight) return true;
  if (!inTop && !inBottom) return true;
  // 角区域：距对应圆心的距离 ≤ r
  const cx = inLeft ? r - 0.5 : w - r - 0.5;
  const cy = inTop ? r - 0.5 : h - r - 0.5;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function alphaAt(x, y, w, h, r) {
  let hit = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (insideRoundedRect(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, w, h, r)) hit++;
    }
  }
  return Math.round((hit / 16) * 255);
}

// 双线性采样源图（中心对齐映射，边缘 clamp）
function sampleBilinear(src, sw, sh, channels, fx, fy) {
  const sx = Math.min(Math.max(fx, 0), sw - 1.001);
  const sy = Math.min(Math.max(fy, 0), sh - 1.001);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const x1 = Math.min(x0 + 1, sw - 1);
  const y1 = Math.min(y0 + 1, sh - 1);
  const out = [];
  for (let c = 0; c < channels; c++) {
    const p00 = src[(y0 * sw + x0) * channels + c];
    const p10 = src[(y0 * sw + x1) * channels + c];
    const p01 = src[(y1 * sw + x0) * channels + c];
    const p11 = src[(y1 * sw + x1) * channels + c];
    out.push(
      Math.round(p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty)
    );
  }
  return out;
}

function main() {
  const src = decodePng(readFileSync(input));
  const size = Math.min(src.width, src.height);
  const r = Math.round(size * cornerRatio);
  const content = Math.round(size * contentScale);
  const offset = Math.round((size - content) / 2);

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dst = (y * size + x) * 4;
      const inContent = x >= offset && x < offset + content && y >= offset && y < offset + content;
      if (inContent) {
        // 内容区：源图中心对齐双线性采样，映射到内容框内
        const fx = ((x - offset + 0.5) * src.width) / content - 0.5;
        const fy = ((y - offset + 0.5) * src.height) / content - 0.5;
        const c = sampleBilinear(src.pixels, src.width, src.height, src.channels, fx, fy);
        rgba[dst] = c[0];
        rgba[dst + 1] = c[1];
        rgba[dst + 2] = c[2];
        rgba[dst + 3] = alphaAt(x, y, size, size, r);
      } else {
        // 边距区：透明
        rgba[dst + 3] = 0;
      }
    }
  }
  writeFileSync(output, encodePng(size, size, rgba));
  // 自校验：回读生成的 PNG，打印四角/中心/内容边缘 alpha
  const back = decodePng(readFileSync(output));
  const a = (x, y) => back.pixels[(y * back.width + x) * back.channels + 3];
  console.log(`已生成 ${output}: ${size}x${size} RGBA，圆角半径 ${r}px（${cornerRatio}），内容 ${content}px（${contentScale}，四周留白 ${offset}px）`);
  console.log(
    `alpha 校验: 四角 [${a(0, 0)}, ${a(size - 1, 0)}, ${a(0, size - 1)}, ${a(size - 1, size - 1)}] 中心 ${a(size >> 1, size >> 1)} 内容边缘 ${a(offset, size >> 1)}`
  );
}

main();
