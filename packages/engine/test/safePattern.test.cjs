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

test('validatePattern：语法非法拒绝', () => {
  assert.equal(validatePattern('(unclosed').ok, false);
  assert.equal(validatePattern('[z-a]').ok, false); // 字符类区间反序（各 V8 版本都稳定报错）
});
