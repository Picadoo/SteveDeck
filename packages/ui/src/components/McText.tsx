// 渲染 Minecraft 颜色/格式码：§0-§f 颜色、§l 粗 §o 斜 §n 下划线 §m 删除线 §r 复位、
// §x§R§R§G§G§B§B 与 &#RRGGBB 十六进制色。§ 与 & 都识别。
const COLORS: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
  "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF",
  c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
};

type Style = { color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };
type Seg = Style & { text: string };

// 深色背景下，把过暗的颜色（黑/深灰/深蓝等）提亮到可读，同时尽量保留色相
function liftColor(hex?: string): string | undefined {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum >= 0.4) return hex;
  const t = ((0.4 - lum) / 0.4) * 0.7; // 越暗混得越多
  r = Math.round(r + (210 - r) * t);
  g = Math.round(g + (210 - g) * t);
  b = Math.round(b + (210 - b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function parse(input: string): Seg[] {
  const segs: Seg[] = [];
  let cur: Style = {};
  let buf = "";
  const flush = () => {
    if (buf) {
      segs.push({ text: buf, ...cur });
      buf = "";
    }
  };
  const isFmt = (ch: string) => ch === "§" || ch === "&";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    // &#RRGGBB / §#RRGGBB
    if (isFmt(ch) && input[i + 1] === "#" && /^[0-9a-fA-F]{6}$/.test(input.slice(i + 2, i + 8))) {
      flush();
      cur = { ...cur, color: "#" + input.slice(i + 2, i + 8) };
      i += 7;
      continue;
    }
    // §x§R§R§G§G§B§B
    if (isFmt(ch) && (input[i + 1] === "x" || input[i + 1] === "X")) {
      let hex = "";
      let j = i + 2;
      for (let k = 0; k < 6; k++) {
        if (isFmt(input[j]) && /[0-9a-fA-F]/.test(input[j + 1] || "")) {
          hex += input[j + 1];
          j += 2;
        } else break;
      }
      if (hex.length === 6) {
        flush();
        cur = { ...cur, color: "#" + hex };
        i = j - 1;
        continue;
      }
    }
    if (isFmt(ch) && i + 1 < input.length) {
      const code = input[i + 1].toLowerCase();
      if (COLORS[code]) { flush(); cur = { color: COLORS[code] }; i++; continue; }
      if (code === "l") { flush(); cur = { ...cur, bold: true }; i++; continue; }
      if (code === "o") { flush(); cur = { ...cur, italic: true }; i++; continue; }
      if (code === "n") { flush(); cur = { ...cur, underline: true }; i++; continue; }
      if (code === "m") { flush(); cur = { ...cur, strike: true }; i++; continue; }
      if (code === "r") { flush(); cur = {}; i++; continue; }
      if (code === "k") { i++; continue; } // 乱码效果：去掉码、保留文字
    }
    buf += ch;
  }
  flush();
  return segs;
}

export default function McText({ text, onDark }: { text: string; onDark?: boolean }) {
  if (!text || (!text.includes("§") && !text.includes("&"))) return <>{text}</>;
  const segs = parse(text);
  return (
    <>
      {segs.map((s, i) => (
        <span
          key={i}
          style={{
            color: onDark ? liftColor(s.color) : s.color,
            fontWeight: s.bold ? 700 : undefined,
            fontStyle: s.italic ? "italic" : undefined,
            textDecoration:
              [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}
