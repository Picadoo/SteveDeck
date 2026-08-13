// 真实连接冒烟（自包含）：自动启停本地 vanilla → 引擎真实连接 → 全链路验证。
// 场景：控制面/进服状态/聊天/AI观察/模块开关/脚本引擎（变量/循环/插值/条件/聊天）/断线自动重连+模块恢复。
// 用法：pnpm test:live（首次自动下载官方 server.jar，需要 Java 17+）
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ensureServerFiles, resetWorld, startServer, RUN_DIR, MC_PORT, MC_VERSION } from './vanilla.mjs';

const require = createRequire(import.meta.url);
const ENGINE = path.resolve(RUN_DIR, '../../../packages/engine');

// 引擎数据目录每次清空：测试自包含，不受上次残留 bot 配置影响
const DATA_DIR = path.join(RUN_DIR, 'engine-data');
rmSync(DATA_DIR, { recursive: true, force: true });
process.env.MCBOT_DATA_DIR = DATA_DIR;

const { startEngine } = require(path.join(ENGINE, 'dist/index.js'));
const { io } = require(path.join(ENGINE, 'node_modules/socket.io-client'));

const TOKEN = 'livetest';
const PORT = 8797;
const URL = `http://127.0.0.1:${PORT}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function emitAck(client, ev, payload, timeout = 8000) {
    return new Promise((res) => {
        let done = false;
        client.emit(ev, payload, (r) => { done = true; res(r); });
        setTimeout(() => { if (!done) res(null); }, timeout);
    });
}

(async () => {
    console.log('=== 准备本地 vanilla 测试服 ===');
    await ensureServerFiles();
    resetWorld();
    let server = await startServer();
    console.log(`  [vanilla] 就绪 127.0.0.1:${MC_PORT}（${MC_VERSION}）`);

    const engine = await startEngine({ port: PORT, token: TOKEN });
    let failures = 0;
    const check = (name, cond, extra) => {
        if (cond) console.log('  ✓', name, extra ?? '');
        else { console.error('  ✗', name, extra ?? ''); failures++; }
    };

    const client = io(URL, { auth: { token: TOKEN }, reconnection: false });
    const state = { logs: [], status: null, snapshot: null, scriptStatus: [], scriptVars: {} };
    client.on('bot:log', (p) => {
        state.logs.push(p.line);
        console.log('  [日志]', p.line.time ?? '', String(p.line.text).slice(0, 110));
    });
    client.on('bot:status', (p) => (state.status = p.bot));
    client.on('bots:snapshot', (p) => (state.snapshot = p));
    client.on('script_status', (p) => state.scriptStatus.push(p.status));
    client.on('script_vars', (p) => (state.scriptVars = p.vars || {}));
    await new Promise((res) => { client.on('connect', res); setTimeout(res, 3000); });
    check('控制面连接', client.connected);

    const findBot = (id) => (state.status?.id === id ? state.status : (state.snapshot?.bots || []).find((x) => x.id === id));
    const waitOnline = async (id, seconds) => {
        for (let i = 0; i < seconds * 2; i++) {
            await delay(500);
            const b = findBot(id);
            if (b?.online && b.health != null) return b;
        }
        return null;
    };

    // ===== 场景 1：建 bot 连接进服 =====
    const addRes = await emitAck(client, 'bot:add', {
        username: 'TestSteve', host: '127.0.0.1', port: MC_PORT, version: MC_VERSION, auth: 'offline',
        settings: { reconnectDelay: 2 }, // 重连场景加速：2s 起步
    });
    check('bot:add', !!addRes?.ok, addRes?.error);
    const id = addRes?.data?.id;
    await emitAck(client, 'bot:reconnect', { id });

    const online = await waitOnline(id, 60);
    check('进服在线（spawn + 状态摘要）', !!online);
    if (online) {
        check(`协商版本 = ${MC_VERSION}`, online.version === MC_VERSION, `(${online.version})`);
        check('生命值有效', typeof online.health === 'number' && online.health > 0, `(${online.health}/${online.maxHealth})`);
        check('坐标有效', online.pos && typeof online.pos.x === 'number', online.pos && `(${Math.round(online.pos.x)},${Math.round(online.pos.y)},${Math.round(online.pos.z)})`);
    }

    // ===== 场景 2：聊天 + AI 观察 =====
    const chat = await emitAck(client, 'bot:chat', { id, message: 'SteveDeck 冒烟测试：你好，本地测试服！' });
    check('bot:chat 发送', !!chat?.ok, chat?.error);
    const obs = await emitAck(client, 'ai:observe', { id });
    const o = obs?.data?.observation ?? obs?.data ?? null;
    check('ai:observe 返回且含自身状态', !!obs?.ok && !!o?.self && typeof o.self.health === 'number', obs?.error);

    // ===== 场景 3：脚本引擎全链路 =====
    const smokeScript = {
        name: '冒烟脚本',
        trigger: { type: 'manual' },
        steps: [
            { do: 'set_var', name: 'count', value: '0' },
            { do: 'repeat', times: 3, steps: [{ do: 'math_var', name: 'count', op: '+', value: 1 }] },
            { do: 'set_var', name: 'greet', value: '第{count}轮' },
            {
                do: 'if', cond: 'var count >= 3',
                then: [{ do: 'chat', msg: '脚本冒烟通过 count={count}' }],
                else: [{ do: 'chat', msg: '脚本冒烟失败分支' }],
            },
            { do: 'wait', s: 0.5 },
        ],
    };
    const sv = await emitAck(client, 'script:save', { id, script: smokeScript });
    check('script:save', !!sv?.ok, sv?.error);
    const st = await emitAck(client, 'script:start', { id, name: '冒烟脚本' });
    check('script:start', !!st?.ok, st?.error);
    let scriptDone = false;
    for (let i = 0; i < 40; i++) {
        await delay(500);
        if (state.scriptStatus.includes('stopped')) { scriptDone = true; break; }
    }
    check('脚本运行结束（running → stopped）', scriptDone, `(${state.scriptStatus.join(',')})`);
    check('循环+数学变量 count=3', String(state.scriptVars.count) === '3', `(count=${state.scriptVars.count})`);
    check('变量插值 greet=第3轮', state.scriptVars.greet === '第3轮', `(greet=${state.scriptVars.greet})`);
    check('条件分支选对 + 聊天真实到服（回显）', state.logs.some((l) => String(l.text).includes('count=3')));

    // ===== 场景 4：模块运行反馈（「开了看不出效果」的修复验证：无动作时也能看出原因） =====
    const tog = await emitAck(client, 'module:toggle', { id, module: 'combat', active: true });
    check('开启战斗模块（settings 持久化）', !!tog?.ok, tog?.error);
    await delay(800);
    const cst = await emitAck(client, 'module:action', { id, module: 'combat', action: 'stats' });
    check('战斗模块上报活动状态（空服=警戒中）', !!cst?.ok && String(cst?.data?.activity || '').includes('警戒'), `(${cst?.data?.activity})`);
    const fol = await emitAck(client, 'module:toggle', { id, module: 'follow', active: true, config: { mode: 'nearest_player', distance: 3 } });
    check('开启跟随模块', !!fol?.ok, fol?.error);
    await delay(800);
    const fst = await emitAck(client, 'module:action', { id, module: 'follow', action: 'stats' });
    check('跟随模块上报活动状态（无玩家=待命）', !!fst?.ok && String(fst?.data?.activity || '').includes('待命'), `(${fst?.data?.activity})`);
    await emitAck(client, 'module:toggle', { id, module: 'follow', active: false });

    // ===== 场景 5：定时广告 + 盯人监听（真实发送/真实命中） =====
    const adv = await emitAck(client, 'module:toggle', {
        id, module: 'auto_chat', active: true,
        config: { messages: ['出售钻石剑，私聊我', '收购绿宝石'], intervalSec: 10 },
    });
    check('开启定时广告', !!adv?.ok, adv?.error);
    let sawAd = false;
    for (let i = 0; i < 20; i++) { // 开启 3s 后发第一条，等回显
        await delay(500);
        if (state.logs.some((l) => String(l.text).includes('出售钻石剑'))) { sawAd = true; break; }
    }
    check('广告消息真实发送（服务器回显）', sawAd);
    const ast = await emitAck(client, 'module:action', { id, module: 'auto_chat', action: 'stats' });
    check('广告模块上报活动（轮播+倒计时）', !!ast?.ok && String(ast?.data?.activity || '').includes('轮播'), `(${ast?.data?.activity})`);
    await emitAck(client, 'module:toggle', { id, module: 'auto_chat', active: false });

    // 盯人命中 → Webhook 推手机：起本地接收器当 generic 终点，全链路真实验证
    const hooks = [];
    const hookSrv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => { try { hooks.push(JSON.parse(body)); } catch { hooks.push({ raw: body }); } res.end('ok'); });
    });
    await new Promise((r) => hookSrv.listen(18790, '127.0.0.1', r));
    const notifyCfg = await fetch(`${URL}/api/notify/config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, url: 'http://127.0.0.1:18790/hook', preset: 'generic', events: { watch: true } }),
    }).then((r) => r.json());
    check('通知配置保存（开启盯人命中事件）', notifyCfg?.enabled === true && notifyCfg?.events?.watch === true);

    const pw = await emitAck(client, 'module:toggle', {
        id, module: 'player_watch', active: true, config: { names: ['TestSteve'], notify: true },
    });
    check('开启盯人监听（含推送）', !!pw?.ok, pw?.error);
    await emitAck(client, 'bot:chat', { id, message: '盯人监听测试消息' });
    await delay(2000);
    const wlog = await emitAck(client, 'module:action', { id, module: 'player_watch', action: 'log' });
    const hits = wlog?.data?.hits || [];
    check('盯人命中记录（含名字的消息入册）', !!wlog?.ok && hits.some((h) => String(h.text).includes('盯人监听测试')), `(命中 ${hits.length} 条)`);
    check('命中推送到 Webhook（kind=watch 真实到达）', hooks.some((h) => h?.kind === 'watch' && String(h?.message || '').includes('盯人监听测试')), `(收到 ${hooks.length} 条)`);
    await emitAck(client, 'module:toggle', { id, module: 'player_watch', active: false });
    hookSrv.close();

    // ===== 场景 6：断线自动重连 + 模块状态恢复（挂机产品的命根子路径） =====
    await delay(500);

    console.log('  [场景] 杀掉服务器，验证断线检测与重连排定…');
    const logCountBefore = state.logs.length;
    await server.stop();
    let sawReconnectPlan = false;
    for (let i = 0; i < 30; i++) {
        await delay(500);
        if (state.logs.slice(logCountBefore).some((l) => /将在 .*秒后重连/.test(String(l.text)))) { sawReconnectPlan = true; break; }
    }
    check('断线后排定自动重连（指数退避日志）', sawReconnectPlan);

    console.log('  [场景] 重启服务器，验证自动连回…');
    server = await startServer(); // 世界已生成，秒级就绪
    const back = await waitOnline(id, 90);
    check('服务器恢复后自动连回（无人工干预）', !!back);

    // restoreModules 延迟 3.5s 激活模块——多等一拍再验证战斗模块自动恢复
    await delay(6000);
    const restored = findBot(id);
    check('重连后战斗模块自动恢复（restoreModules）', restored?.modules?.combat === true, `(combat=${restored?.modules?.combat})`);

    // ===== 收尾 =====
    await emitAck(client, 'bot:stop', { id });
    await delay(800);
    await emitAck(client, 'bot:delete', { id });
    client.close();
    engine.server.close();
    await server.stop();
    await delay(300);
    console.log(failures === 0 ? '\n真实连接冒烟 ALL PASS ✅' : `\n${failures} FAIL ❌`);
    process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
    console.error('TEST ERROR', e);
    process.exit(1);
});
