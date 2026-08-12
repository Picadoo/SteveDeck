// 轻量 ReDoS 防护(API-3/MODB-7)：用户在监听规则里写的正则会对每条聊天 exec，
// 灾难性回溯(如 (a+)+$ )可冻结整个事件循环、拖垮所有 bot。Node 内置正则无超时。
//
// 取舍：不引 re2（原生依赖，会破坏自包含桌面打包），改用「长度上限 + 嵌套量词启发式」
// 覆盖最常见的 ReDoS 形态。属 best-effort：单主人信任模型下足够，且不误伤普通监听正则。
const MAX_PATTERN_LEN = 200;

// 嵌套量词检测：对一个「内部本身含无界量词（加号/星号/下界重复 {n,}）」的分组再整体加量词
// → 指数级回溯。例：(a+)+  (a*)*  ([a-z]+)+  (\d+)*  ((ab)+)+  (.+)+
//
// 用括号配对扫描而非单条正则——单正则的 [^)]* 跨不过内层括号，会漏掉 ((a+)+)+ 这类
// 跨括号的双层嵌套（补测时发现的真实盲区）。扫描时跳过转义与字符类，避免把 [(] 或 \( 误当分组。
// best-effort：字符类内的字面量化字符可能导致「误拒」（如 ([a+])+），但误拒是安全侧，可接受。
function hasCatastrophicNesting(p) {
  const stack = []; // 每个未闭合 '(' 的起始下标
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") { i++; continue; } // 跳过转义字符（\( \) \+ 都是字面量）
    if (c === "[") {
      // 跳过字符类：内部的 ( ) + * 都是字面量，不参与分组/量词结构
      i++;
      while (i < p.length && p[i] !== "]") {
        if (p[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(") {
      stack.push(i);
    } else if (c === ")") {
      const start = stack.pop();
      if (start == null) continue; // 括号不配对，交给 new RegExp 报语法错
      const next = p[i + 1];
      const quantified = next === "+" || next === "*" || next === "{";
      if (!quantified) continue; // 分组整体没有再加量词 → 安全
      const inner = p.slice(start + 1, i);
      // 分组内部含无界量词(+/*)或下界重复 {n,} → 「量词套量词」，指数回溯
      if (/[+*]/.test(inner) || /\{\d+,\}?/.test(inner)) return true;
    }
  }
  return false;
}

function validatePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return { ok: false, error: "正则为空" };
  }
  if (pattern.length > MAX_PATTERN_LEN) {
    return { ok: false, error: `正则过长(>${MAX_PATTERN_LEN} 字符)，已拒绝` };
  }
  if (hasCatastrophicNesting(pattern)) {
    return { ok: false, error: "疑似灾难性回溯(嵌套量词，如 (a+)+)，已拒绝" };
  }
  try {
    new RegExp(pattern);
  } catch (e) {
    return { ok: false, error: "正则无效: " + e.message };
  }
  return { ok: true };
}

module.exports = { validatePattern, hasCatastrophicNesting, MAX_PATTERN_LEN };
