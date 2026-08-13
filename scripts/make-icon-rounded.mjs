import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * 给方形不透明 PNG 生成 macOS 风格的透明圆角版本（供 Dock 图标使用）。
 * macOS Dock 不会自动给自定义图标加圆角，正式 .icns 的圆角都是画进图里的；
 * 这里把圆角外区域处理为透明，达到同样效果。
 *
 * 用法: node scripts/make-icon-rounded.mjs [输入png] [输出png] [圆角半径比例，默认 0.225]
 */

const [input = 'packages/desktop/resources/icon.png', output = input, ratioArg = '0.225'] = process.argv.slice(2);
const cornerRatio = Number(ratioArg);

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
  // 四个圆角区域：距对应圆心距离 ≤ r
  const cx = x < r ? r : x >= w - r ? w - r - 1 : x;
  const cy = y < r ? r : y >= h - r ? h - r - 1 : y;
  if (cx !== x && cy !== y) {
    const dx = x - (cx === r ? r - 0.5 : w - r - 0.5);
    const dy = y - (cy === r ? r - 0.5 : h - r - 0.5);
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function main() {
  const { width, height, channels, pixels } = decodePng(readFileSync(input));
  const r = Math.round(Math.min(width, height) * cornerRatio);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 4x4 子像素采样圆角矩形覆盖率作为 alpha
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (insideRoundedRect(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, width, height, r)) hit++;
        }
      }
      const alpha = Math.round((hit / 16) * 255);
      const src = (y * width + x) * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = pixels[src];
      rgba[dst + 1] = pixels[src + 1];
      rgba[dst + 2] = pixels[src + 2];
      rgba[dst + 3] = alpha;
    }
  }
  writeFileSync(output, encodePng(width, height, rgba));
  // 自校验：回读生成的 PNG，打印四角与中心 alpha（角应接近 0、中心 255）
  const back = decodePng(readFileSync(output));
  const a = (x, y) => back.pixels[(y * back.width + x) * back.channels + 3];
  console.log(`已生成 ${output}: ${width}x${height} RGBA，圆角半径 ${r}px（${cornerRatio}）`);
  console.log(
    `alpha 校验: 四角 [${a(0, 0)}, ${a(width - 1, 0)}, ${a(0, height - 1)}, ${a(width - 1, height - 1)}] 中心 ${a(width >> 1, height >> 1)}`
  );
}

main();
