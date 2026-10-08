/* auto_chat（定时广告）与 player_watch（盯人监听）单测：
 * 模块是 (botInstance) => void 的挂载函数，用 fake botInstance/bot 驱动——
 * 覆盖轮播顺序、间隔下限、安全拦截、命中匹配、环形缓冲、通知开关。 */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const mountAutoChat = require('../src/modules/auto_chat.js');
const mountPlayerWatch = require('../src/modules/player_watch.js');

function makeInstance() {
    const bot = new EventEmitter();
    bot.entity = {};
    bot.sent = [];
    bot.chat = (m) => bot.sent.push(m);
    const inst = {
        bot,
        timers: [],
        cleanupHooks: [],
        logs: [],
        uiLog(msg) { this.logs.push(msg); },
        notified: [],
        notifyEvent(kind, text) { this.notified.push({ kind, text }); },
    };
    return inst;
}

test('auto_chat：配置层——空白消息过滤、timer 生命周期', () => {
    const inst = makeInstance();
    mountAutoChat(inst);
    inst.toggleAutoChat(true, { messages: ['A', '  ', 'B'], intervalSec: 60 });
    const task = inst.autoChatTask;
    assert.equal(task.messages.length, 2); // 空白被过滤
    assert.equal(task.active, true);
    assert.equal(inst.timers.length, 1);
    inst.toggleAutoChat(false);
    assert.equal(task.active, false);
    assert.equal(inst.timers.length, 0); // 关闭时 timer 从实例移除
});

test('auto_chat：间隔下限 10s 强制收敛；随机模式标记', () => {
    const inst = makeInstance();
    mountAutoChat(inst);
    inst.toggleAutoChat(true, { messages: ['x'], intervalSec: 1, random: true });
    assert.equal(inst.autoChatTask.intervalSec, 10); // 1s → 下限 10s
    assert.equal(inst.autoChatTask.random, true);
    inst.toggleAutoChat(false);
});

test('auto_chat：定时到点真实发送（含黑名单拦截）', async () => {
    const inst = makeInstance();
    mountAutoChat(inst);
    // /op 会被 isChatBlocked 拦截；正常文本照发
    inst.toggleAutoChat(true, { messages: ['收购钻石', '/op me'], intervalSec: 60 });
    const task = inst.autoChatTask;
    task.nextAt = Date.now() - 1; // 立刻到点
    await new Promise((r) => setTimeout(r, 1100)); // 等 1s 心跳 tick
    assert.deepEqual(inst.bot.sent, ['收购钻石']);
    assert.equal(task.sent, 1);
    // 下一条轮到 /op me → 拦截不发送
    task.nextAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(inst.bot.sent, ['收购钻石']); // 没有新增
    assert.ok(inst.logs.some((l) => l.includes('拦截')));
    inst.toggleAutoChat(false);
});

test('auto_chat：stats 文案与 lastMsg 截断', () => {
    const inst = makeInstance();
    mountAutoChat(inst);
    let s = inst.getAutoChatStats();
    assert.ok(s.activity.includes('未配置'));
    inst.toggleAutoChat(true, { messages: ['hello'], intervalSec: 30 });
    s = inst.getAutoChatStats();
    assert.ok(s.activity.includes('轮播中'));
    assert.ok(s.activity.includes('30s'));
    inst.toggleAutoChat(false);
});

test('player_watch：名字命中进环形缓冲，新的在前；未命中忽略', () => {
    const inst = makeInstance();
    mountPlayerWatch(inst);
    inst.togglePlayerWatch(true, { names: ['Alex'] });
    inst.bot.emit('message', { toString: () => '<Alex> 卖钻石' });
    inst.bot.emit('message', { toString: () => '<Bob> 路过' });
    inst.bot.emit('message', { toString: () => '系统: Alex 加入了游戏' });
    const log = inst.getPlayerWatchLog();
    assert.equal(log.total, 2);
    assert.equal(log.hits.length, 2);
    assert.ok(log.hits[0].text.includes('加入了游戏')); // reverse：最新在前
    assert.equal(log.hits[0].name, 'Alex');
});

test('player_watch：环形缓冲上限 200 条', () => {
    const inst = makeInstance();
    mountPlayerWatch(inst);
    inst.togglePlayerWatch(true, { names: ['N'] });
    for (let i = 0; i < 230; i++) {
        inst.bot.emit('message', { toString: () => `N 说话 ${i}` });
    }
    const log = inst.getPlayerWatchLog();
    assert.equal(log.total, 230);
    assert.equal(log.hits.length, 200);
    assert.ok(log.hits[0].text.includes('229')); // 最新保留
    assert.ok(log.hits[199].text.includes('30')); // 最旧的 0..29 被挤出
});

test('player_watch：notify 开关控制 webhook 推送', () => {
    const inst = makeInstance();
    mountPlayerWatch(inst);
    inst.togglePlayerWatch(true, { names: ['Alex'], notify: false });
    inst.bot.emit('message', { toString: () => 'Alex 在线' });
    assert.equal(inst.notified.length, 0);
    inst.togglePlayerWatch(true, { names: ['Alex'], notify: true });
    inst.bot.emit('message', { toString: () => 'Alex 又说话了' });
    assert.equal(inst.notified.length, 1);
    assert.equal(inst.notified[0].kind, 'watch');
    assert.ok(inst.notified[0].text.includes('Alex'));
});

test('player_watch：关闭后不再记录；cleanup 解绑监听', () => {
    const inst = makeInstance();
    mountPlayerWatch(inst);
    inst.togglePlayerWatch(true, { names: ['Alex'] });
    inst.bot.emit('message', { toString: () => 'Alex 1' });
    inst.togglePlayerWatch(false);
    inst.bot.emit('message', { toString: () => 'Alex 2' });
    assert.equal(inst.getPlayerWatchLog().total, 1);
    // cleanup 后监听器移除
    for (const h of inst.cleanupHooks) h();
    assert.equal(inst.bot.listenerCount('message'), 0);
});
