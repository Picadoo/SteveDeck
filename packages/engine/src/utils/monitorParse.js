// 消息监听的纯解析逻辑（从 message_monitor.js 抽出，便于单测）：
// 中文单位数字解析 + 洗色码。数值抽取是「金币/经验/材料」统计的核心，解析错会让整份统计悄悄失真。
'use strict';

const UNITS = { 千: 1e3, 万: 1e4, 亿: 1e8, 兆: 1e12, 万亿: 1e12, 京: 1e16 };

/** 解析带中文单位/逗号的数字："162.41亿"→1.6241e10  "50.31兆"→5.031e13  "1,500,000"→1500000。无数字返回 null。 */
function parseNum(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, '').trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(万亿|京|千|万|亿|兆)?/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v)) return null;
  if (m[2] && UNITS[m[2]]) v *= UNITS[m[2]];
  return v;
}

/** 去 Minecraft § 色码/格式码（§ 后任意一个字符）；对 null/undefined 安全返回 ""。 */
function stripColor(s) {
  return String(s == null ? '' : s).replace(/§./gi, '');
}

module.exports = { parseNum, stripColor, UNITS };
