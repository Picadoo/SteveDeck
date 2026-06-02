/* 生成一个 1024×1024 的占位应用图标（暖橙底 + 白色圆角机器人头），
   不依赖任何图像库：手写 PNG（IHDR/IDAT/IEND）+ zlib 压缩 + crc32。
   用法: node generate-icon.cjs <输出路径> */
const fs = require("fs");
const zlib = require("zlib");

const SIZE = 1024;
const out = process.argv[2] || "src-tauri/app-icon.png";

const bg = [217, 119, 87, 255]; // 强调橙 #d97757
const fg = [250, 249, 245, 255]; // 暖白
const eye = [38, 36, 33, 255]; // 深炭

const pix = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2;
const cy = SIZE / 2;
const headW = SIZE * 0.24;
const headH = SIZE * 0.2;
const radius = SIZE * 0.06;

function rounded(x, y, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH;
  return dx * dx + dy * dy <= r * r;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    let c = bg;
    if (rounded(x, y, headW, headH, radius)) {
      c = fg;
      // 两只眼睛
      const eyeY = cy - SIZE * 0.02;
      if (
        (Math.hypot(x - (cx - SIZE * 0.08), y - eyeY) < SIZE * 0.025) ||
        (Math.hypot(x - (cx + SIZE * 0.08), y - eyeY) < SIZE * 0.025)
      ) {
        c = eye;
      }
    }
    pix[i] = c[0];
    pix[i + 1] = c[1];
    pix[i + 2] = c[2];
    pix[i + 3] = c[3];
  }
}

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(SIZE * stride);
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0; // filter: none
  pix.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

fs.mkdirSync(require("path").dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
