const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { gzipSync } = require('zlib');
const { encodeDragonKey, encodeDragonEvent } = require('../src/modules/dragoncore_codec');
const { attachDragonCore } = require('../src/modules/dragoncore/runtime');
const { getProfile, configureProfile } = require('../src/modules/dragoncore/profiles');
const actions = require('../src/modules/scriptActions/mod_gui');
function string(value) { const b = Buffer.from(value); const n = Buffer.alloc(4); n.writeInt32BE(b.length); return Buffer.concat([n, b]); }
function packet(opcode, body, complete = 1) {
    const header = Buffer.alloc(8); header.writeInt32BE(opcode); header.writeInt32BE(complete, 4);
    return { channel: 'dragoncore:main', data: gzipSync(Buffer.concat([header, body])) };
}
function fixture(host = 'mc.example.test') {
    const client = new EventEmitter(), sent = []; client.state = 'play'; client.write = (type, data) => sent.push({ type, ...data });
    const config = { host, port: 25565, username: 'test' };
    config.settings = { dragonCore: configureProfile(config, { enabled: true, keys: ['G', 'T'] }) };
    const inst = { config, bot: { _client: client, entity: {}, version: '1.12.2', inventory: {} } };
    return { client, sent, inst, core: attachDragonCore(inst, client) };
}
test('按键编码保持已验证的 G 包字节，事件参数使用 UTF-8 而不是 JS 字符数', () => {
    assert.equal(encodeDragonKey('G').toString('hex'), '40000000050147000000010147');
    const event = encodeDragonEvent('DragonCore_RetrieveSlot', ['法宝槽位']);
    assert.equal(event.subarray(-13).toString('hex'), `0c${Buffer.from('法宝槽位').toString('hex')}`);
    assert.throws(() => encodeDragonEvent('event', Array(129).fill('x')), /invalid/);
    assert.throws(() => encodeDragonKey('x'.repeat(33)), /too large/);
});
test('同一连接只有一个解码器，分片、菜单观察者共用同一结果，账号数据相互隔离', () => {
    const a = fixture(), b = fixture();
    assert.equal(attachDragonCore(a.inst, a.client), a.core);
    assert.equal(a.client.listenerCount('custom_payload'), 1);
    const body = Buffer.concat([string('Gui/demo.yml'), string('字段: 值')]);
    a.client.emit('custom_payload', packet(2, body.subarray(0, 9), 0));
    a.client.emit('custom_payload', packet(2, body.subarray(9), 0));
    const last = packet(2, Buffer.alloc(0)); a.client.emit('custom_payload', last);
    assert.equal(a.core.decodePacket(last).config.text, '字段: 值');
    assert.equal(a.core.inspect().revision, 1);
    assert.equal(b.core.inspect().configs.length, 0);
    assert.equal(a.sent.length, 0);
    a.client.emit('end'); b.client.emit('end');
});
test('重新加载协议工厂会复用活跃连接，新连接仍建立独立状态', () => {
    const { inst, client, core } = fixture();
    const file = require.resolve('../src/modules/dragoncore/runtime'); delete require.cache[file];
    const updated = require(file);
    assert.equal(updated.attachDragonCore(inst, client), core);
    assert.equal(client.listenerCount('custom_payload'), 1);
    client.emit('end');
    const next = new EventEmitter(); inst.bot._client = next;
    const newCore = updated.attachDragonCore(inst, next);
    assert.notEqual(newCore, core);
    assert.equal(newCore.inspect().revision, 0);
    next.emit('end');
});
test('其他服务器被动观察不发包，必须显式绑定端点；换服后配置失效', () => {
    const { inst, core, client, sent } = fixture('other.example');
    delete inst.config.settings;
    client.emit('custom_payload', packet(2, Buffer.concat([string('__proto__'), string('只读')])));
    assert.equal(core.config('__proto__').text, '只读');
    assert.equal(Object.getPrototypeOf(core.state.dragonConfigs), null);
    assert.equal(sent.length, 0);
    assert.throws(() => core.pressKey('T'), /未启用/);
    inst.config.settings = { dragonCore: configureProfile(inst.config, { enabled: true, keys: ['R'] }) };
    assert.throws(() => core.pressKey('T'), /未配置/);
    assert.equal(core.pressKey('R').sent, true);
    inst.config.host = 'third.example'; assert.equal(getProfile(inst.config), null);
    assert.throws(() => core.pressKey('R'), /未启用/);
    client.emit('end');
});
test('等待新界面不会误用旧页面，关闭连接后清理等待监听', async () => {
    const { core, client } = fixture();
    client.emit('custom_payload', packet(100, Buffer.concat([string('灵宝'), string('opengui')])));
    const afterRevision = core.revision;
    const waiting = core.waitForGui({ name: '灵宝', afterRevision, timeoutMs: 500 });
    setImmediate(() => client.emit('custom_payload', packet(100, Buffer.concat([string('灵宝'), string('opengui')]))));
    assert.ok((await waiting).revision > afterRevision);
    assert.equal(core.events.listenerCount('packet'), 0);
    const disconnected = core.waitForGui({ name: '别的界面', timeoutMs: 500 });
    client.emit('end'); await assert.rejects(disconnected, /连接已关闭/);
    assert.equal(client.listenerCount('custom_payload'), 0);
});
test('服务器组件表达式只读记录，不执行，也不冒充新开/关闭界面', () => {
    const { core, client } = fixture();
    client.emit('custom_payload', packet(100, Buffer.concat([string('灵宝'), string('opengui')])));
    const guiRevision = core.inspect().lastGui.revision;
    client.emit('custom_payload', packet(100, Buffer.concat([string('gui-ride-view'), string("方法.设置组件值('坐骑模型','entity','00000000-fa49-3799-9f1d-bc9185841119');")])));
    assert.equal(core.inspect().currentGui, '灵宝');
    assert.equal(core.inspect().lastGui.revision, guiRevision);
    assert.equal(core.inspect().errors, 0);
    assert.equal(core.state.packets.at(-1).guiUpdate.name, 'gui-ride-view');
    client.emit('end');
});
test('只有界面回包算打开；脚本中止会撤销等待，游标持物时不发送按键', async () => {
    const { core, inst, client, sent } = fixture(); const ctx = {};
    inst.bot.inventory.selectedItem = { count: 1 };
    assert.throws(() => core.pressKey('T'), /鼠标/); assert.equal(sent.length, 0);
    inst.bot.inventory.selectedItem = null;
    const waiting = actions.dragoncore_wait_gui({ botInstance: inst, bot: inst.bot, emitLog() {} }, { name: '法宝' }, ctx);
    ctx.aborted = true; await assert.rejects(waiting, /取消/);
    assert.equal(core.events.listenerCount('packet'), 0);
    client.emit('end');
});
test('脚本点击必须有已读取快照，重名按钮不猜测也不提交', async () => {
    const { inst, client, sent } = fixture();
    const deps = { botInstance: inst, emitLog() {} };
    await assert.rejects(actions.mod_click(deps, { label: '兑换' }, {}), /先用 mod_key/);
    await assert.rejects(actions.mod_click(deps, { label: '兑换' }, { modMenu: { buttons: [
        { label: '兑换', supported: true }, { label: '兑换', supported: true },
    ] } }), /唯一/);
    assert.equal(sent.length, 0); client.emit('end');
});
