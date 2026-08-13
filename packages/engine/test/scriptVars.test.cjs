/* 脚本变量插值 + 安全数学求值单测：所有步骤执行前都过这层，插值错 = 全部动作参数错。 */
const test = require('node:test');
const assert = require('node:assert');
const { resolveVars, resolveStep, evalMath } = require('../src/utils/scriptVars.js');

const vars = { n: 5, name: '钻石', zero: 0, empty: '', flag: false };
const getVar = (k) => vars[k];

test('resolveVars: 基本插值与多变量', () => {
  assert.equal(resolveVars('有 {n} 个{name}', getVar), '有 5 个钻石');
  assert.equal(resolveVars('{n}+{n}', getVar), '5+5');
});

test('resolveVars: 未定义变量原样保留；falsy 值（0/空串/false）正常代入', () => {
  assert.equal(resolveVars('{nope}', getVar), '{nope}');
  assert.equal(resolveVars('{zero}|{empty}|{flag}', getVar), '0||false');
});

test('resolveVars: 非字符串输入原样返回；不递归展开变量值里的 {x}', () => {
  assert.equal(resolveVars(42, getVar), 42);
  assert.equal(resolveVars(null, getVar), null);
  const g = (k) => (k === 'a' ? '{b}' : 'B');
  assert.equal(resolveVars('{a}', g), '{b}'); // 一次替换，不再展开 {b}
});

test('resolveStep: 只插值 string 字段，其余类型透传', () => {
  const out = resolveStep({ do: 'chat', msg: '{name}x{n}', count: 3, arr: ['{n}'], nested: { m: '{n}' } }, getVar);
  assert.equal(out.msg, '钻石x5');
  assert.equal(out.count, 3);
  assert.deepEqual(out.arr, ['{n}']);      // 数组不深入
  assert.deepEqual(out.nested, { m: '{n}' }); // 嵌套对象不深入
});

test('evalMath: 四则/括号/取模/小数 + 变量插值后求值', () => {
  assert.equal(evalMath('1+2*3', getVar), 7);
  assert.equal(evalMath('({n}+1)*2', getVar), 12);
  assert.equal(evalMath('10%3', getVar), 1);
  assert.equal(evalMath('0.1+0.2', getVar), 0.30000000000000004);
});

test('evalMath: 白名单外字符不求值（防注入），语法错回退原串', () => {
  assert.equal(evalMath('process.exit(1)', getVar), 'process.exit(1)');
  assert.equal(evalMath('1+alert(2)', getVar), '1+alert(2)');
  assert.equal(evalMath('{name}+1', getVar), '钻石+1'); // 插值出中文 → 不过白名单 → 原样
  assert.equal(evalMath('((1+', getVar), '((1+'); // 语法错 → 回退原串
  assert.equal(evalMath('1++*2', getVar), '1++*2'); // 同上
});
