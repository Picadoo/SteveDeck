/* 监听规则正则的 ReDoS 防护单测。用户写的正则会对每条聊天 exec，
   灾难性回溯能冻结整个事件循环——validatePattern 是唯一防线，必须测住。 */
const test = require('node:test');
const assert = require('node:assert');
const { validatePattern, MAX_PATTERN_LEN } = require('../src/utils/safePattern.js');

test('validatePattern：正常正则放行', () => {
  assert.equal(validatePattern('获得金币 (\\d+)').ok, true);
  assert.equal(validatePattern('(\\d+)\\s*经验').ok, true);
  assert.equal(validatePattern('掉落 (.+) x(\\d+)').ok, true);
});

test('validatePattern：空 / 超长拒绝', () => {
  assert.equal(validatePattern('').ok, false);
  assert.equal(validatePattern(null).ok, false);
  assert.equal(validatePattern(123).ok, false);
  assert.equal(validatePattern('a'.repeat(MAX_PATTERN_LEN + 1)).ok, false);
  assert.equal(validatePattern('a'.repeat(MAX_PATTERN_LEN)).ok, true, '恰好上限放行');
});

test('validatePattern：嵌套量词（灾难性回溯）拒绝', () => {
  for (const bad of ['(a+)+', '(a*)*', '([a-z]+)+', '(\\d+)*', '((ab)+)+$']) {
    const r = validatePattern(bad);
    assert.equal(r.ok, false, `应拒绝 ${bad}`);
    assert.match(r.error, /回溯/);
  }
});

test('validatePattern：非嵌套量词的正常正则不误伤', () => {
  // 相邻但不嵌套的量词分组不是灾难性回溯，应放行
  assert.equal(validatePattern('(ab)+(cd)+').ok, true);
  assert.equal(validatePattern('\\d+ 金币').ok, true);
  assert.equal(validatePattern('(\\d+)').ok, true, '单个量词分组、外层无量词');
});

test('validatePattern：重叠交替 (a|a)+ 拒绝（审查补的绕过）', () => {
  // 组内顶层 | 且组整体加无界量词——分支重叠时 2^n 回溯。静态判重叠不可行，统一拒绝（安全侧）。
  for (const bad of ['(a|a)+$', '(x|xy)*', '(\\w|\\d)+!']) {
    assert.equal(validatePattern(bad).ok, false, `应拒绝 ${bad}`);
  }
  // 无量词的交替组正常放行；嵌套括号内的 | 不算顶层
  assert.equal(validatePattern('(foo|bar)').ok, true);
  assert.equal(validatePattern('((a|b)c)').ok, true);
});

test('validatePattern：可选量词序列 (a+)?(a+)?(a+)? 拒绝（审查补的绕过）', () => {
  // 单个/两个 (a+)? 无害放行，连续 3 个及以上组合爆炸拒绝
  assert.equal(validatePattern('(\\d+)? 金币').ok, true);
  assert.equal(validatePattern('(a+)?(b+)?').ok, true);
  assert.equal(validatePattern('(a+)?(a+)?(a+)?$').ok, false);
  assert.equal(validatePattern('(a+)?(b+)?(c+)?(d+)?$').ok, false);
});

test('validatePattern：语法非法拒绝', () => {
  assert.equal(validatePattern('(unclosed').ok, false);
  assert.equal(validatePattern('[z-a]').ok, false); // 字符类区间反序（各 V8 版本都稳定报错）
});
