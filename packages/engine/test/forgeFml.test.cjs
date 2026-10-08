/* FML 编解码单测：ModList 声明是 Forge 服登录的命门，编错一个字节就被服务器踢。 */
const test = require('node:test');
const assert = require('node:assert');
const { fml } = require('../src/instance/forge.js');

test('vInt: LEB128 单字节与多字节编码', () => {
  assert.deepEqual([...fml.vInt(0)], [0]);
  assert.deepEqual([...fml.vInt(1)], [1]);
  assert.deepEqual([...fml.vInt(127)], [0x7f]);
  assert.deepEqual([...fml.vInt(128)], [0x80, 0x01]);
  assert.deepEqual([...fml.vInt(300)], [0xac, 0x02]);
});

test('vStr: varint 长度前缀 + UTF-8（中文多字节按字节数计）', () => {
  const b = fml.vStr('mod');
  assert.equal(b[0], 3);
  assert.equal(b.toString('utf8', 1), 'mod');
  const cn = fml.vStr('龙核');
  assert.equal(cn[0], Buffer.byteLength('龙核', 'utf8')); // 6
});

test('buildModList ↔ parseModList 往返一致', () => {
  const mods = [
    { modid: 'dragoncore', version: '1.12.2-2.15' },
    { modid: 'forge', version: '14.23.5.2860' },
    { id: 'legacy_id_field', version: '' }, // 兼容 id 字段名
  ];
  const buf = fml.buildModList(mods);
  assert.equal(buf[0], 0x02); // ModList 判别符
  assert.deepEqual(fml.parseModList(buf), [
    'dragoncore@1.12.2-2.15',
    'forge@14.23.5.2860',
    'legacy_id_field@',
  ]);
});

test('buildModList: 空列表 = 判别符 + 数量 0', () => {
  const buf = fml.buildModList([]);
  assert.deepEqual([...buf], [0x02, 0]);
  assert.deepEqual(fml.parseModList(buf), []);
});
