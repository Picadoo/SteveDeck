/* 积木脚本布尔表达式求值器单测：优先级 / 括号 / 结合性 / NOT。
   这是 script_engine.js 里最容易出微妙 bug 的一段（现已抽成纯函数）。 */
const test = require('node:test');
const assert = require('node:assert');
const { compare, evalBoolExpr } = require('../src/utils/scriptExpr.js');

test('compare：数值运算符', () => {
  assert.equal(compare(3, '<', 5), true);
  assert.equal(compare(5, '<', 5), false);
  assert.equal(compare(5, '<=', 5), true);
  assert.equal(compare(6, '>', 5), true);
  assert.equal(compare(5, '>=', 6), false);
  assert.equal(compare(1, '==', 1), false, '非 < > <= >= 的运算符一律 false（相等交给上层字符串比较）');
});

// 叶子求值器：把 "T"/"F" 当真假，其余按「非空即真」——足够驱动布尔结构测试
const atom = (s) => {
  const t = s.trim();
  if (t === 'T') return true;
  if (t === 'F') return false;
  throw new Error(`unexpected atom: "${t}"`); // 结构解析错了才会漏到意外 atom
};
const ev = (s) => evalBoolExpr(s, atom);

test('单 atom 与空表达式', () => {
  assert.equal(ev('T'), true);
  assert.equal(ev('F'), false);
  assert.equal(ev(''), true, '空条件视为恒真（always）');
  assert.equal(ev('   '), true);
});

test('NOT', () => {
  assert.equal(ev('!T'), false);
  assert.equal(ev('!F'), true);
  assert.equal(ev('!!T'), true);
});

test('&& / ||', () => {
  assert.equal(ev('T && T'), true);
  assert.equal(ev('T && F'), false);
  assert.equal(ev('F || T'), true);
  assert.equal(ev('F || F'), false);
});

test('优先级：|| 低于 &&', () => {
  // F && F || T  →  (F && F) || T  →  true；若误当 F && (F || T) 则为 false
  assert.equal(ev('F && F || T'), true);
  // T || F && F  →  T || (F && F)  →  true
  assert.equal(ev('T || F && F'), true);
});

test('优先级：! 高于 &&/||', () => {
  assert.equal(ev('!F && T'), true); // (!F) && T
  assert.equal(ev('!T || T'), true); // (!T) || T
});

test('括号改变优先级', () => {
  assert.equal(ev('F && (F || T)'), false); // 括号内 T，但外层 F && T = F
  assert.equal(ev('(F || T) && T'), true);
  assert.equal(ev('!(T && F)'), true); // !(F) = T
});

test('嵌套括号与多层结合', () => {
  assert.equal(ev('((T))'), true);
  assert.equal(ev('(T && (F || (T && T)))'), true);
  assert.equal(ev('T && T && F'), false, '左结合链');
  assert.equal(ev('F || F || T'), true);
});

test('括号配对：整串非单一配对括号时不误剥壳', () => {
  // "(T)&&(F)" 不是「整体一对括号」——第一个 ( 在下标 3 处 depth 归零，不能当整体去括号
  assert.equal(ev('(T) && (F)'), false);
  assert.equal(ev('(T) || (F)'), true);
});
