// 每个 Minecraft 连接一个被动接收器；不执行服务器下发的 YAML/表达式。
const { EventEmitter } = require('events');
const { createDragonDecoder, encodeDragonKey } = require('../dragoncore_codec');
const { getProfile, keyName, PROTOCOL } = require('./profiles');
const CHANNEL = 'dragoncore:main';
const clients = new WeakMap();
function attachDragonCore(inst, client, seed) {
    if (!client) throw Error('机器人没有可用的 Minecraft 连接');
    const existing = clients.get(client) || (inst._dragonCoreClient === client ? inst._dragonCore : null);
    if (existing) { clients.set(client, existing); return existing; }
    const decode = createDragonDecoder(), decoded = new WeakMap(), events = new EventEmitter();
    const state = seed || { username: inst.config.username, startedAt: Date.now(), packets: [],
        dragonConfigs: Object.create(null), dragonSlots: Object.create(null), dragonKeys: [], errors: 0 };
    state.dragonConfigs = Object.assign(Object.create(null), state.dragonConfigs);
    state.dragonSlots = Object.assign(Object.create(null), state.dragonSlots);
    let configBytes = Object.values(state.dragonConfigs).reduce((sum, x) => sum + Buffer.byteLength(x.text), 0);
    let revision = 0, lastGui = null, currentGui = null, closed = false, registered = false;
    let errors = 0, lastError;
    const decodePacket = p => {
        if (!p || p.channel !== CHANNEL) return null;
        if (decoded.has(p)) return decoded.get(p);
        // 同一数据包只解压一次；所有菜单观察者共享分片状态。
        decoded.set(p, null);
        if (!Buffer.isBuffer(p.data) || p.data.length > 4 * 1024 * 1024) throw Error('DragonCore packet too large');
        const packet = decode(p.data); decoded.set(p, packet); return packet;
    };
    const listener = p => {
        if (p?.channel !== CHANNEL) return;
        try {
            const packet = decodePacket(p); if (!packet) return;
            const at = Date.now();
            if (packet.config) {
                const { name, text } = packet.config, old = state.dragonConfigs[name];
                const size = configBytes - Buffer.byteLength(old?.text || '') + Buffer.byteLength(text);
                if (name.length > 512 || size > 16 * 1024 * 1024 || (!old && Object.keys(state.dragonConfigs).length >= 256)) throw Error('config limit');
                state.dragonConfigs[name] = { text, at }; configBytes = size;
            }
            if (packet.keys) {
                if (packet.keys.some(key => key.length > 512)) throw Error('key limit');
                state.dragonKeys = packet.keys;
            }
            if (packet.slot && packet.slot.identifier.length <= 120 && packet.slot.data.length <= 180000
                && (Object.hasOwn(state.dragonSlots, packet.slot.identifier) || Object.keys(state.dragonSlots).length < 256))
                state.dragonSlots[packet.slot.identifier] = { data: packet.slot.data, at };
            if (packet.gui) {
                if (packet.gui.name.length > 512 || packet.gui.action.length > 32) throw Error('gui limit');
                lastGui = { ...packet.gui, at, revision: revision + 1 };
                if (packet.gui.action === 'opengui') currentGui = packet.gui.name;
                else if (packet.gui.action === 'closegui') currentGui = null;
            }
            revision++;
            state.packets.push({ at, channel: CHANNEL, opcode: packet.opcode, config: packet.config?.name,
                slot: packet.slot?.identifier, gui: packet.gui, guiUpdate: packet.guiUpdate, bytes: packet.bytes, data: packet.text });
            if (state.packets.length > 40) state.packets.shift();
            events.emit('packet', packet);
        } catch (err) { state.errors++; errors++; lastError = String(err.message).slice(0, 200); state.lastError = lastError; }
    };
    const core = {
        state, events, decodePacket,
        get revision() { return revision; },
        inspect() {
            const profile = getProfile(inst.config);
            return { protocol: PROTOCOL, version: inst.bot?.version || inst.config.version, connected: !closed,
                profile: profile?.id || null, enabled: !!profile, revision, currentGui, lastGui,
                keys: [...state.dragonKeys], configuredKeys: profile?.keys || [],
                configs: Object.entries(state.dragonConfigs).map(([name, v]) => ({ name, bytes: Buffer.byteLength(v.text), at: v.at })),
                slotKeys: Object.keys(state.dragonSlots), errors, historicalErrors: state.errors - errors, lastError };
        },
        config(name) {
            if (typeof name !== 'string' || name.length > 512) throw Error('配置名无效');
            const normalized = name.replace(/\\/g, '/').toLowerCase();
            const entry = Object.entries(state.dragonConfigs).find(([n]) => n.toLowerCase() === normalized);
            if (!entry) throw Error('尚未收到此龙核心配置');
            return { name: entry[0], ...entry[1] };
        },
        pressKey(value) {
            const profile = getProfile(inst.config), key = keyName(value);
            if (!profile) throw Error('此端点未启用龙核心适配，请先配置服务器绑定');
            if (closed || client.state !== 'play' || !inst.bot?.entity || inst.bot._client !== client) throw Error('机器人未在线');
            if (inst.bot.version !== '1.12.2') throw Error('当前龙核心协议仅验证过 Minecraft 1.12.2 / DragonCore 2.4.71');
            if (!profile.keys.includes(key) && !state.dragonKeys.some(k => String(k).toUpperCase() === key)) throw Error('未配置或未收到此按键绑定');
            if (inst.bot.currentWindow || inst.bot.inventory?.selectedItem) throw Error('请先关闭箱子界面并放回鼠标物品');
            if (!registered) { client.write('custom_payload', { channel: 'REGISTER', data: Buffer.from(CHANNEL) }); registered = true; }
            const afterRevision = revision;
            client.write('custom_payload', { channel: CHANNEL, data: encodeDragonKey(key) });
            return { sent: true, key, afterRevision }; // sent 仅表示已发包，界面是否打开由回包判断。
        },
        waitForGui({ name, afterRevision = -1, timeoutMs = 4000, cancelled = () => false } = {}) {
            if (typeof name !== 'string' || !name || name.length > 512 || !Number.isInteger(afterRevision) || afterRevision < -1
                || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw Error('等待界面参数无效');
            return new Promise((resolve, reject) => {
                let done = false;
                const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll);
                    events.removeListener('packet', check); events.removeListener('closed', check); error ? reject(error) : resolve(value); };
                const check = () => {
                    if (closed || inst.bot?._client !== client || cancelled()) return finish(Error('龙核心等待已取消或连接已关闭'));
                    if (currentGui === name && lastGui?.action === 'opengui' && lastGui.revision > afterRevision) finish(null, { ...lastGui });
                };
                const timer = setTimeout(() => finish(Error(`等待龙核心界面超时：${name}`)), timeoutMs);
                const poll = setInterval(check, 100);
                events.on('packet', check); events.on('closed', check); check();
            });
        },
    };
    clients.set(client, core); client.on('custom_payload', listener);
    inst._dragonCore = core;
    inst._dragonCoreClient = client;
    client.once('end', () => { closed = true; client.removeListener('custom_payload', listener); events.emit('closed'); events.removeAllListeners(); });
    return core;
}
function getDragonCore(inst) {
    return attachDragonCore(inst, inst.bot?._client, inst._vexMenuState);
}
module.exports = { CHANNEL, attachDragonCore, getDragonCore };
