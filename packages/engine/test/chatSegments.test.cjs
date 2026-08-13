/* 聊天 JSON 组件解析单测：RPG 服「可点击/可悬浮」消息是日志页核心交互，解析错会丢按钮或样式。 */
const test = require('node:test');
const assert = require('node:assert');
const { flattenChatText, extractHoverText, extractChatSegments } = require('../src/utils/chatSegments.js');

test('flattenChatText: 字符串/数组/嵌套 extra 展平', () => {
  assert.equal(flattenChatText(null), '');
  assert.equal(flattenChatText('hi'), 'hi');
  assert.equal(flattenChatText(['a', { text: 'b' }]), 'ab');
  assert.equal(flattenChatText({ text: 'x', extra: [{ text: 'y', extra: ['z'] }] }), 'xyz');
});

test('extractHoverText: show_item 提取物品 id', () => {
  assert.equal(extractHoverText({ action: 'show_item', contents: { id: 'minecraft:diamond_sword' } }), '[物品] diamond_sword');
  assert.equal(extractHoverText({ action: 'show_item', value: 'minecraft:stick' }), '[物品] stick');
});

test('extractHoverText: show_text 展平并洗掉色码；空值返回 undefined', () => {
  assert.equal(extractHoverText({ action: 'show_text', value: '§a点击§b传送' }), '点击传送');
  assert.equal(extractHoverText({ action: 'show_text', contents: { text: '提示', extra: ['!'] } }), '提示!');
  assert.equal(extractHoverText(null), undefined);
  assert.equal(extractHoverText({ action: 'show_text' }), undefined);
});

test('extractChatSegments: click/hover 与样式沿 extra 继承', () => {
  const out = [];
  extractChatSegments({
    text: '点我',
    color: 'gold',
    clickEvent: { action: 'run_command', value: '/warp home' },
    extra: [{ text: '（子片段继承）' }, { text: '换色', color: 'red' }],
  }, {}, out);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].click, { action: 'run_command', value: '/warp home' });
  assert.equal(out[1].click.value, '/warp home'); // 继承父 click
  assert.equal(out[1].color, 'gold');
  assert.equal(out[2].color, 'red'); // 子级覆盖颜色
});

test('extractChatSegments: snake_case 事件名（1.20+ click_event）也识别', () => {
  const out = [];
  extractChatSegments({ text: 'go', click_event: { action: 'suggest_command', value: '/spawn' } }, {}, out);
  assert.equal(out[0].click.action, 'suggest_command');
});

test('extractChatSegments: 片段数量上限 150（恶意超深树不炸）', () => {
  const deep = { text: 'x', extra: [] };
  let cur = deep;
  for (let i = 0; i < 500; i++) { const n = { text: 'x', extra: [] }; cur.extra.push(n); cur = n; }
  const out = [];
  extractChatSegments(deep, {}, out);
  assert.ok(out.length <= 151);
});
