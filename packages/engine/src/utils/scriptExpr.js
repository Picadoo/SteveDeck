// 积木脚本的布尔表达式求值器 + 比较运算符——从 script_engine.js 抽出的纯逻辑部分。
// 表达式语法只处理 && || ! 和括号；叶子（atom，如 health<10 / inventory_has 钻石）的实际求值
// 交给调用方传入的 evalAtom 回调（那部分依赖 bot 运行时状态，不纯）。
//
// 抽出来的意义：优先级（|| 最低 → && → ! → 括号）、从右向左结合、括号配对判断，是全脚本引擎里
// 最容易出微妙 bug、又最难靠肉眼在 1300 行文件里发现的一段。独立成纯函数后可完整单测。


/** 数值比较运算符。非法运算符返回 false（调用方语义：条件不成立）。 */
function compare(a, op, b) {
  switch (op) {
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    default: return false;
  }
}

/**
 * 求值布尔表达式，优先级 || < && < ! < 括号 < atom。
 * @param {string} s 表达式字符串（调用方应已做变量替换/trim）
 * @param {(atom: string) => boolean} evalAtom 叶子条件求值器
 * @returns {boolean}
 */
function evalBoolExpr(s, evalAtom) {
  s = s.trim();
  if (!s) return true;

  // 顶层 ||（最低优先级，从右向左找——保证左结合：a||b||c = (a||b)||c）。
  // 注意从 length-1 起扫（而非 length-2）：|| 是双字符，末位 s[i+1] 为 undefined 天然不误匹配，
  // 但末位字符必须参与 depth 计数——否则以 ')' 结尾的表达式（如 "A && (B || C)"）会漏算一层括号，
  // 把括号内的 ||/&& 误当顶层切分（这是抽出来补测时发现的真实 bug）。
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === ')') depth++;
    else if (c === '(') depth--;
    else if (depth === 0 && c === '|' && s[i + 1] === '|') {
      return evalBoolExpr(s.slice(0, i), evalAtom) || evalBoolExpr(s.slice(i + 2), evalAtom);
    }
  }
  // 顶层 &&
  depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === ')') depth++;
    else if (c === '(') depth--;
    else if (depth === 0 && c === '&' && s[i + 1] === '&') {
      return evalBoolExpr(s.slice(0, i), evalAtom) && evalBoolExpr(s.slice(i + 2), evalAtom);
    }
  }
  // NOT
  if (s.startsWith('!')) return !evalBoolExpr(s.slice(1), evalAtom);
  // 括号：仅当整串是一对配对括号时剥壳（避免把 "(a)&&(b)" 误当整体去括号）
  if (s.startsWith('(') && s.endsWith(')')) {
    let d = 0, balanced = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') d--;
      if (d === 0 && i < s.length - 1) { balanced = false; break; }
    }
    if (balanced) return evalBoolExpr(s.slice(1, -1), evalAtom);
  }
  return evalAtom(s);
}

module.exports = { compare, evalBoolExpr };
