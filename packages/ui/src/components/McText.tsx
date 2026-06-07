// 渲染 Minecraft 颜色/格式码：§0-§f 颜色、§l 粗 §o 斜 §n 下划线 §m 删除线 §r 复位、
// §x§R§R§G§G§B§B 与 &#RRGGBB 十六进制色。§ 与 & 都识别。
import { memo, useMemo } from "react";
import { useStore } from "@/store/useStore";

const COLORS: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
  "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF",
  c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
};

type Style = { color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };
type Seg = Style & { text: string };

// 按背景明暗微调颜色保证可读：深底把过暗色提亮、浅底把过亮色压暗，尽量保留色相。
function adjustColor(hex: string | undefined, darkBg: boolean): string | undefined {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (darkBg) {
    if (lum >= 0.4) return hex; // 够亮，不动
    const t = ((0.4 - lum) / 0.4) * 0.7; // 越暗朝亮灰混得越多
    r = Math.round(r + (220 - r) * t);
    g = Math.round(g + (220 - g) * t);
    b = Math.round(b + (220 - b) * t);
  } else {
    if (lum <= 0.55) return hex; // 够暗，不动
    const t = ((lum - 0.55) / 0.45) * 0.78; // 越亮压得越暗
    r = Math.round(r * (1 - t));
    g = Math.round(g * (1 - t));
    b = Math.round(b * (1 - t));
  }
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

// UICORE-7：McText 在聊天/名字/Lore/计分板/Tab 到处高频渲染（热路径）。
// memo 跳过 props 未变时的重渲；useMemo 缓存 parse —— 只随 text 变，主题切换不重解析（只重算颜色）。
function McTextInner({ text, onDark }: { text: string; onDark?: boolean }) {
  // 跟随主题：浅色主题压暗亮色，深色主题提亮暗色；onDark 强制按深底处理（如物品提示框始终深底）
  const theme = useStore((s) => s.theme);
  const darkBg = !!onDark || theme === "dark";
  const segs = useMemo(
    () => (text && (text.includes("§") || text.includes("&")) ? parse(text) : null),
    [text],
  );
  if (!segs) return <>{text}</>;
  return (
    <>
      {segs.map((s, i) => (
        <span
          key={i}
          style={{
            color: adjustColor(s.color, darkBg),
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

const McText = memo(McTextInner);
export default McText;
