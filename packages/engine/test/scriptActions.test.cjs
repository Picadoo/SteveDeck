/* 脚本动作单测：动作实现是 (deps, step, ctx) 的依赖注入函数（scriptActions/），
 * 传 fake deps 即可覆盖核心逻辑——变量操作、聊天安全拦截、丢弃保留、攻击距离校验、中止响应。 */
const test = require('node:test');
const assert = require('node:assert');
const { ALL } = require('../src/modules/scriptActions/index.js');
const { evalMath } = require('../src/utils/scriptVars.js');

// fake deps 工厂：按需覆盖 bot 字段；返回 { deps, logs, sent } 供断言
function makeDeps(botOverrides = {}) {
    const logs = [];
    const sent = [];
    const bot = {
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } },
        health: 18,
        food: 9,
        inventory: { items: () => [] },
        chat: (m) => sent.push(m),
        ...botOverrides,
    };
    const botInstance = { _scriptVars: {}, savedLocations: [] };
    const deps = {
        bot,
        botInstance,
        goals: {},
        emitLog: (m) => logs.push(m),
        emitVars: () => {},
        sleep: () => Promise.resolve(),
        pollUntil: async () => true,
        waitForChat: async () => null,
        waitForGuiReady: async () => true,
        gotoWithTimeout: async () => {},
        evalMath: (expr) => evalMath(expr, (k) => botInstance._scriptVars[k]),
        evalCondition: () => true,
        executeAction: async () => {},
        executeSteps: async () => {},
        MAX_CALL_DEPTH: 5,
        SPAWN_TIMEOUT: 1000,
        GUI_WAIT_MS: 10,
    };
    return { deps, logs, sent, botInstance, bot };
}

test('set_var：$探针 / =数学 / 数字转换 / 字符串保形', async () => {
    const { deps, botInstance } = makeDeps({
        health: 17.5,
        entity: { position: { x: 10.9, y: -60.2, z: 3.5, distanceTo: () => 0 } },
    });
    await ALL.set_var(deps, { name: 'hp', value: '$health' }, {});
    assert.equal(botInstance._scriptVars.hp, 17.5);
    await ALL.set_var(deps, { name: 'px', value: '$x' }, {});
    assert.equal(botInstance._scriptVars.px, 10); // floor
    botInstance._scriptVars.n = 4;
    await ALL.set_var(deps, { name: 'calc', value: '={n} * 2 + 1' }, {});
    assert.equal(botInstance._scriptVars.calc, 9);
    await ALL.set_var(deps, { name: 'num', value: '42' }, {});
    assert.strictEqual(botInstance._scriptVars.num, 42); // 纯数字转数值
    await ALL.set_var(deps, { name: 'keep', value: '007' }, {});
    assert.strictEqual(botInstance._scriptVars.keep, '007'); // 会丢形态的保持字符串
    await ALL.set_var(deps, { name: 'txt', value: 'hello world' }, {});
    assert.strictEqual(botInstance._scriptVars.txt, 'hello world');
});

test('math_var：四则/取模与除零保护', async () => {
    const { deps, botInstance } = makeDeps();
    botInstance._scriptVars.c = 10;
    await ALL.math_var(deps, { name: 'c', op: '+', value: 5 }, {});
    assert.equal(botInstance._scriptVars.c, 15);
    await ALL.math_var(deps, { name: 'c', op: '*', value: 2 }, {});
    assert.equal(botInstance._scriptVars.c, 30);
    await ALL.math_var(deps, { name: 'c', op: '/', value: 0 }, {});
    assert.equal(botInstance._scriptVars.c, 0); // 除零 → 0 而不是 Infinity
    await ALL.math_var(deps, { name: 'c', op: '%', value: 0 }, {});
    assert.equal(botInstance._scriptVars.c, 0);
    botInstance._scriptVars.c = 7;
    await ALL.math_var(deps, { name: 'c', op: '??', value: 3 }, {});
    assert.equal(botInstance._scriptVars.c, 7); // 未知运算符 = 原值
});

test('chat/cmd：安全黑名单拦截；cmd 自动补斜杠', async () => {
    const { deps, sent, logs } = makeDeps();
    await ALL.chat(deps, { msg: '你好' }, {});
    assert.deepEqual(sent, ['你好']);
    // /op 是危险命令，应被 isChatBlocked 拦截（不发送）
    await ALL.cmd(deps, { text: 'op Steve' }, {});
    assert.equal(sent.length, 1);
    assert.ok(logs.some((l) => l.includes('拦截')));
    // 正常命令补斜杠
    await ALL.cmd(deps, { text: 'home' }, {});
    assert.deepEqual(sent[1], '/home');
});

test('whisper：缺目标或缺内容不发送', async () => {
    const { deps, sent } = makeDeps();
    await ALL.whisper(deps, { target: '', msg: 'hi' }, {});
    await ALL.whisper(deps, { target: 'Alex', msg: '' }, {});
    assert.equal(sent.length, 0);
    await ALL.whisper(deps, { target: 'Alex', msg: 'hi' }, {});
    assert.deepEqual(sent, ['/msg Alex hi']);
});

test('drop_all：keep 关键词保留（含多关键词分隔）', async () => {
    const tossed = [];
    const inv = [
        { name: 'diamond_sword', type: 1, metadata: 0, count: 1 },
        { name: 'cobblestone', type: 2, metadata: 0, count: 64 },
        { name: 'iron_pickaxe', type: 3, metadata: 0, count: 1 },
        { name: 'dirt', type: 4, metadata: 0, count: 32 },
    ];
    const { deps } = makeDeps({
        inventory: { items: () => inv },
        toss: async (type) => tossed.push(type),
    });
    await ALL.drop_all(deps, { keep: 'sword, pickaxe' }, {});
    assert.deepEqual(tossed, [2, 4]); // 只丢 cobblestone 和 dirt
});

test('attack：>6 格目标拒绝攻击并提示靠近', async () => {
    const attacks = [];
    const far = {
        name: 'zombie', type: 'mob',
        position: { x: 50, y: 64, z: 0 },
    };
    const { deps, logs } = makeDeps({
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 50 } },
        nearestEntity: () => far,
        attack: (e) => attacks.push(e),
    });
    await ALL.attack(deps, { count: 3 }, {});
    assert.equal(attacks.length, 0); // 一次都没打
    assert.ok(logs.some((l) => l.includes('>6')));
});

test('attack：近距目标按 count 连击，aborted 中断', async () => {
    const attacks = [];
    const near = { name: 'zombie', type: 'mob', position: { x: 1, y: 64, z: 0 } };
    const { deps } = makeDeps({
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 1.5 } },
        nearestEntity: () => near,
        attack: (e) => attacks.push(e),
    });
    await ALL.attack(deps, { count: 3, interval: 0 }, {});
    assert.equal(attacks.length, 3);

    attacks.length = 0;
    const ctx = { aborted: false };
    deps.sleep = () => { ctx.aborted = true; return Promise.resolve(); }; // 第一击后中止
    await ALL.attack(deps, { count: 5, interval: 0.01 }, ctx);
    assert.equal(attacks.length, 1);
});

test('stop：置 ctx.aborted；wait：aborted 时立即退出', async () => {
    const { deps } = makeDeps();
    const ctx = { aborted: false };
    await ALL.stop(deps, {}, ctx);
    assert.equal(ctx.aborted, true);

    // wait 在 aborted 后不再继续等（sleep 计数验证）
    let sleeps = 0;
    deps.sleep = () => { sleeps++; return Promise.resolve(); };
    const t0 = Date.now();
    await ALL.wait(deps, { s: 0.001 }, { aborted: true });
    assert.ok(Date.now() - t0 < 100);
    assert.equal(sleeps, 0);
});

test('goto：坐标无效抛错（NaN 校验）', async () => {
    const { deps } = makeDeps();
    await assert.rejects(() => ALL.goto(deps, { x: 'abc', y: 64, z: 0 }, {}), /坐标无效/);
});

test('注册表完整性：全部动作注册且为函数', () => {
    const expected = [
        'goto', 'goto_location', 'goto_nearest', 'look', 'look_at', 'return_home', 'hold', 'sneak', 'jump',
        'chat', 'cmd', 'whisper', 'log', 'wait_chat',
        'interact', 'click_slot', 'close_gui', 'wait_gui_item', 'find_and_click_slot',
        'equip', 'equip_best_weapon', 'equip_best_tool', 'deposit', 'drop', 'drop_all', 'use_item', 'swap_hands',
        'attack', 'dig', 'place', 'craft',
        'set_var', 'math_var',
        'wait', 'wait_spawn', 'wait_until', 'stop',
    ];
    for (const name of expected) {
        assert.equal(typeof ALL[name], 'function', `缺少动作: ${name}`);
    }
});
