/* 消息监听数值解析单测：中文单位换算 / 逗号 / 负数 / 边界。
   parseNum 出错会让金币/经验/材料统计整体失真，是最该测的一块纯逻辑。 */
const test = require('node:test');
const assert = require('node:assert');
const { parseNum, stripColor } = require('../src/utils/monitorParse.js');

test('parseNum：中文单位换算', () => {
  assert.equal(parseNum('162.41亿'), 1.6241e10);
  assert.equal(parseNum('50.31兆'), 5.031e13);
  assert.equal(parseNum('3千'), 3000);
  assert.equal(parseNum('5万'), 50000);
  assert.equal(parseNum('1京'), 1e16);
  assert.equal(parseNum('2万亿'), 2e12, '「万亿」在 alternation 里排最前，不会被拆成「万」');
});

test('parseNum：逗号千分位 / 负数 / 无单位', () => {
  assert.equal(parseNum('1,500,000'), 1500000);
  assert.equal(parseNum('-50兆'), -5e13);
  assert.equal(parseNum('42'), 42);
  assert.equal(parseNum('3.14'), 3.14);
});

test('parseNum：从混杂文本里抽第一个数字', () => {
  assert.equal(parseNum('获得金币 250 枚'), 250);
  assert.equal(parseNum('  88万  '), 880000);
});

test('parseNum：无数字 / 空 / null 返回 null', () => {
  assert.equal(parseNum('没有数字'), null);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum(null), null);
  assert.equal(parseNum(undefined), null);
});

test('stripColor：去色码、对空安全', () => {
  assert.equal(stripColor('§a金币§r'), '金币');
  assert.equal(stripColor('§x§1§2§3abc'), 'abc');
  assert.equal(stripColor('plain'), 'plain');
  assert.equal(stripColor(null), '');
});
