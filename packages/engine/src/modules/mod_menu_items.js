// 定制 GUI 只解析静态组件和原版 ItemStack 数据，不解释/执行服务器 YAML 中的函数。
const path = require('path');
const { createHash } = require('crypto');
const { encodeDragonEvent } = require('./dragoncore_codec');
const { getDragonCore } = require('./dragoncore/runtime');
const { getProfile } = require('./dragoncore/profiles');
const plain = s => String(s || '').replace(/§./g, '').replace(/&[0-9a-fk-or]/gi, '').trim();
const fingerprint = value => createHash('sha256').update(value).digest('hex');
function inventoryItem(item) {
    if (!item) return null;
    const display = item.nbt?.value?.display?.value;
    return { name: plain(display?.Name?.value) || item.displayName || item.name, count: item.count,
        texture: item.name,
        lore: (display?.Lore?.value?.value || []).map(plain).join('\n'),
        fingerprint: fingerprint(JSON.stringify([item.type,item.metadata,item.count,item.nbt])) };
}
function applyCursorPacket(bot, packet) {
    if (packet.windowId !== -1 || packet.slot !== -1) return;
    const mf = path.dirname(require.resolve('mineflayer'));
    const Item = require(require.resolve('prismarine-item', { paths: [mf] }))(bot.registry || bot.version);
    bot.inventory.selectedItem = Item.fromNotch(packet.item);
    if (bot.currentWindow) bot.currentWindow.selectedItem = bot.inventory.selectedItem;
}
let proto;
function itemData(data, bot) {
    if (!data || data.length < 2 || data.length > 131072) throw new Error('物品数据长度无效');
    if (!proto) {
        const mf = path.dirname(require.resolve('mineflayer'));
        proto = require(require.resolve('minecraft-protocol', { paths: [mf] })).createDeserializer({ state: 'play', isServer: false, version: '1.12.2' }).proto;
    }
    const { value, size } = proto.read(data, 0, 'slot');
    if (size !== data.length) throw new Error('物品数据未完整解析');
    if (value.blockId < 0) return null;
    const display = value.nbtData?.value?.display?.value;
    return { name: plain(display?.Name?.value) || bot?.registry?.items[value.blockId]?.displayName || `物品 ${value.blockId}`,
        texture: bot?.registry?.items?.[value.blockId]?.name || bot?.registry?.itemsById?.[value.blockId]?.name,
        count: value.itemCount, lore: (display?.Lore?.value?.value || []).slice(0, 80).map(plain).join('\n'), fingerprint: fingerprint(data) };
}
function readVexSlots(entries, bot) {
    const slots = [];
    for (const entry of entries) {
        if (!entry.startsWith('[slo]') || slots.length >= 256) continue;
        const f = entry.slice(5).split('<&>'), id = Number(f[0]);
        if (!Number.isInteger(id) || id < 0 || id > 100000) continue;
        try {
            const bytes = JSON.parse(f[3]);
            if (!Array.isArray(bytes) || bytes.length > 131072 || !bytes.every(n => Number.isInteger(n) && n >= -128 && n <= 255)) throw new Error('invalid bytes');
            slots.push({ key: String(id), kind: 'vex', label: `格子 ${id}`, item: itemData(Buffer.from(bytes), bot), loaded: true, clickable: true });
        } catch (_) { slots.push({ key: String(id), kind: 'vex', label: `格子 ${id}（解析失败）`, loaded: false, clickable: false }); }
    }
    return slots;
}
function dragonMenu(inst, guiName) {
    const configs = (inst.bot?._client ? getDragonCore(inst).state : inst._vexMenuState)?.dragonConfigs || {};
    const entry = Object.entries(configs).find(([name]) => name.toLowerCase() === `gui/${guiName}.yml`.toLowerCase());
    if (!entry) throw new Error('已收到龙核心界面，但缺少对应配置');
    const slots = [], texts = [];
    let component = null;
    for (const line of entry[1].text.split(/\r?\n/)) {
        const heading = line.match(/^([^\s#][^:]*):\s*$/);
        if (heading) { component = { name: heading[1] }; continue; }
        if (!component) continue;
        const field = line.match(/^ {2}(identifier|texts):\s*(.+)$/);
        if (!field) continue;
        const value = field[2].replace(/^(['"])(.*)\1$/, '$2').trim();
        if (field[1] === 'identifier' && component.name.endsWith('_slot') && /^[\p{L}\p{N}_ -]{1,120}$/u.test(value)) {
            slots.push({ key: value, kind: /^container_\d+$/.test(value) ? 'inventory' : 'dragon',
                label: /^container_/.test(value) ? component.name.replace(/_slot$/, '') : value.replace(/槽位$/, ''),
                loaded: false, clickable: !/^container_/.test(value) || /^container_(?:[5-9]|[1-3]\d|4[0-4])$/.test(value) });
        } else if (field[1] === 'texts' && component.name.endsWith('_label') && !/方法\.|界面变量|[(){}]/.test(value)) texts.push(plain(value));
    }
    return refreshDragonMenu(inst, { provider: 'dragoncore', guiName, title: getProfile(inst.config)?.guiTitle?.(guiName) || guiName,
        buttons: [], texts: [...new Set(texts)], slots: slots.slice(0, 128), hasInput: false });
}
function refreshDragonMenu(inst, menu) {
    return { ...menu, cursor: inventoryItem(inst.bot.inventory?.selectedItem), slots: menu.slots.map(slot => {
        if (slot.kind === 'inventory') {
            const item = inst.bot.inventory?.slots[Number(slot.key.slice(10))];
            return { ...slot, loaded: true, item: inventoryItem(item) };
        }
        const raw = (inst.bot?._client ? getDragonCore(inst).state : inst._vexMenuState)?.dragonSlots?.[slot.key];
        if (!raw || raw.at < (menu.requestedAt || 0)) return { ...slot, item: null, loaded: false };
        try { return { ...slot, item: itemData(Buffer.from(raw.data, 'base64'), inst.bot), loaded: true }; }
        catch (_) { return { ...slot, item: null, loaded: false }; }
    }) };
}
function sendDragonEvent(bot, event, args) {
    bot._client.write('custom_payload', { channel: 'dragoncore:main', data: encodeDragonEvent(event, args) });
}
function retrieveDragonSlots(inst, menu) {
    menu.requestedAt = Date.now();
    for (const slot of menu.slots.filter(s => s.kind === 'dragon')) sendDragonEvent(inst.bot, 'DragonCore_RetrieveSlot', [slot.key]);
}
async function clickDragonInventorySlot(inst, slot, mouse) {
    const bot = inst.bot;
    if (bot.currentWindow || !Number.isInteger(slot) || slot < 5 || slot > 44 || ![0,1].includes(mouse)) throw new Error('背包窗口或槽位已变化');
    const serverSlots = new Map();let cursor;
    const capture = p => {
        if (p.windowId === -1 && p.slot === -1) cursor = p;
        else if ([0,-2].includes(p.windowId) && p.slot >= 0 && p.slot < bot.inventory.slots.length) serverSlots.set(p.slot,p.item);
    };
    const captureItems = p => {
        if (p.windowId === 0 && Array.isArray(p.items)) p.items.forEach((item,index)=>{ serverSlots.set(index,item); });
    };
    bot._client.on('set_slot',capture);
    bot._client.on('window_items',captureItems);
    try { await bot.clickWindow(slot,mouse,0);await new Promise(r=>setTimeout(r,150)); }
    finally {
        bot._client.removeListener('set_slot',capture);
        bot._client.removeListener('window_items',captureItems);
        const mf = path.dirname(require.resolve('mineflayer'));
        const Item = require(require.resolve('prismarine-item', { paths: [mf] }))(bot.registry || bot.version);
        for (const [index,item] of serverSlots) bot.inventory.updateSlot(index,Item.fromNotch(item));
        if (cursor) applyCursorPacket(bot,cursor);
    }
}
module.exports = { readVexSlots, dragonMenu, refreshDragonMenu, sendDragonEvent, retrieveDragonSlots,
    inventoryItem, applyCursorPacket, clickDragonInventorySlot };
