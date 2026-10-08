// 按本地 DragonCore 2.4.71 / VexView 2.6 客户端的按键上报格式发送 G / T。
// 仅触发服务端原有绑定，窗口继续由 window_gui 接收，不执行服务端下发的脚本。
const { gzipSync, gunzipSync } = require('zlib');
const { randomUUID } = require('crypto');
const { getDragonCore } = require('./dragoncore/runtime');
const { getProfile, keyName } = require('./dragoncore/profiles');
const { readVexSlots, dragonMenu, refreshDragonMenu, sendDragonEvent, retrieveDragonSlots,
    inventoryItem, applyCursorPacket, clickDragonInventorySlot } = require('./mod_menu_items');
const pending = new WeakSet();
const sessions = new WeakMap();
const watchedClients = new WeakSet();
// 文字已从该服客户端贴图逐项核对，不能根据文件名猜动作。
const plain = text => String(text || '').replace(/§./g, '').trim();
function parseMenu(raw, bot, profile = {}) {
    const TEXTURE_LABELS = profile.textureLabels || {};
    const value = JSON.parse(raw), base = String(value.base || '');
    if (!base || base.length > 262144) return null;
    const entries = base.split('<#>'), buttons = [], texts = [];
    const baseTexture = entries[0].split('<&>')[0];
    for (const entry of entries) {
        if (!entry.startsWith('[txt]')) continue;
        const f = entry.slice(5).split('<&>');
        texts.push({ x: Number(f[0]), y: Number(f[1]), text: plain(f.slice(3).join(' ')).slice(0, 2000) });
    }
    for (const entry of entries) {
        if (!entry.startsWith('[but]') || buttons.length >= 128) continue;
        const f = entry.slice(5).split('<&>'), id = Number(f[6]), texture = f[5] || '';
        if (!Number.isInteger(id) || id < 0 || id > 100000 || buttons.some(b => b.id === id)) continue;
        let label = plain(f[0]) || (Object.hasOwn(TEXTURE_LABELS, texture) ? TEXTURE_LABELS[texture] : '') || '';
        if (!label) label = texts.filter(t => t.x >= Number(f[1]) && t.x < Number(f[1]) + Number(f[3])
            && t.y >= Number(f[2]) && t.y < Number(f[2]) + Number(f[4])).map(t => t.text).join(' ');
        buttons.push({ id, label: label.slice(0, 120) || `未识别按钮 ${id}`, texture, supported: !!label });
    }
    return { provider: 'vexview', title: profile.menuTitles?.[baseTexture] || '服务器功能面板',
        token: randomUUID(), buttons, texts: texts.map(t => t.text).filter(Boolean), baseTexture,
        slots: readVexSlots(entries, bot),
        hasInput: entries.some(e => /^\[(?:slot|textf|textfield|input|check)/i.test(e)) };
}
async function pressMenuKey(inst, provider = 'vexview', key = 'G', selection = null) {
    const customAction = require('../adapters').getServerAdapter(inst.config)?.menuAction?.(key);
    if(customAction){
        if(pending.has(inst.bot))throw Error('菜单操作正在进行');pending.add(inst.bot);
        try{return await customAction(inst);}
        finally{pending.delete(inst.bot);}
    }
    // 兼容已运行引擎只传 provider 的调用方式。
    if (provider === 'vexview:T') { provider = 'vexview'; key = 'T'; }
    const profile = getProfile(inst.config);
    if (!profile) throw Error('此服务器未启用模组界面适配');
    const openSubmenu = String(key).toUpperCase() === profile.submenu?.alias;
    key = openSubmenu ? profile.submenu.key : keyName(key);
    provider = profile.forcedKeyProviders?.[key] || provider;
    const keyCode = { G: 34, T: 20, V: 47 }[key];
    if (provider === 'vexview' && (!profile.vexVersion || !keyCode)) throw Error('此服务器未配置 VexView 按键协议');
    const bot = inst.bot;
    if (!bot?.entity || !bot._client) throw new Error('机器人未在线');
    if (bot.version !== '1.12.2') throw new Error('当前模组菜单键仅适配 1.12.2');
    if (!['vexview', 'dragoncore'].includes(provider)) throw new Error('未知模组按键协议');
    const core = getDragonCore(inst);
    if (pending.has(bot)) throw new Error('菜单键正在发送，请稍候');
    if (bot.currentWindow) throw new Error('已有箱子界面打开，请先关闭');
    if (!selection && bot.inventory?.selectedItem) throw new Error('鼠标上还有物品，请先放回当前槽位或背包，再切换菜单');
    if (!watchedClients.has(bot._client)) {
        watchedClients.add(bot._client);
        const client = bot._client;
        const invalidate = p => {
            if (p.channel === 'dragoncore:main') {
                try { if (core.decodePacket(p)?.gui) sessions.delete(bot); } catch (_) { /* 未知包不执行 */ }
                return;
            }
            if (p.channel !== 'VexView' || !sessions.has(bot)) return;
            try {
                const packet = JSON.parse(gunzipSync(p.data, { maxOutputLength: 262144 }).toString('utf8'));
                if (packet.packet_type === 'gui' || packet.packet_type === 'close') sessions.delete(bot);
            } catch (_) { /* 未识别数据不执行 */ }
        };
        client.on('custom_payload', invalidate);
        const onCursor = p => { try { applyCursorPacket(bot,p); } catch (_) { /* 未知物品不预测 */ } };
        client.on('set_slot',onCursor);
        client.once('end', () => { client.removeListener('custom_payload', invalidate);client.removeListener('set_slot',onCursor); sessions.delete(bot); });
    }
    let selectedButton = null, selectedSlot = null, previousMenu = null;
    if (selection) {
        const session = sessions.get(bot);
        if (!session || Date.now() - session.at > 300000 || selection.token !== session.menu.token)
            throw new Error('菜单已变化或过期，请重新打开模组菜单');
        previousMenu = session.menu;
        if (session.needsRefresh && !selection.refresh) throw new Error('上次操作未确认，请先刷新槽位，不要重复点击');
        if (selection.slotKey !== undefined) {
            if (![0, 1].includes(selection.mouse)) throw new Error('仅支持左键和右键');
            selectedSlot = session.menu.slots?.find(s => s.key === selection.slotKey && s.clickable && s.loaded);
            if (!selectedSlot || (selectedSlot.kind === 'vex' && !selectedSlot.item)) throw new Error('槽位已变化或尚未读取');
            if (session.menu.provider === 'dragoncore') {
                const live = refreshDragonMenu(inst,session.menu).slots.find(s=>s.key===selectedSlot.key);
                if (!live?.loaded || live.item?.fingerprint !== selectedSlot.item?.fingerprint
                    || inventoryItem(bot.inventory?.selectedItem)?.fingerprint !== session.menu.cursor?.fingerprint)
                    throw new Error('物品或鼠标内容已变化，请先刷新槽位');
            }
        } else if (!selection.refresh) {
            selectedButton = session.menu.buttons.find(b => b.id === selection.buttonId && b.supported);
            if (!selectedButton) throw new Error('当前菜单没有这个已识别按钮');
        }
        if (session.menu.hasInput) throw new Error('该面板包含尚未适配的输入或物品槽，请在游戏客户端操作');
    }
    pending.add(bot);
    sessions.delete(bot); // 一个快照只允许一次点击，防重复提交或跨页面误点。
    const responses = [];
    const feedback = [];
    let guiParts = '', menu = selectedSlot || selection?.refresh ? { ...previousMenu, token: randomUUID() } : null;
    const onMessage = text => {
        const t = plain(text);
        if (feedback.length < 8 && t && !/公告|火焰鱼讯|获得了物品|恢复满血/.test(t)) feedback.push(t.slice(0, 500));
    };
    const onPayload = p => {
        if (!['VexView', 'dragoncore:main'].includes(p.channel)) return;
        let summary = { channel: p.channel, bytes: p.data?.length || 0 };
        if (p.channel === 'dragoncore:main') {
            try {
                const data = core.decodePacket(p);
                if (data?.gui?.action === 'opengui') {
                    menu = { ...dragonMenu(inst, data.gui.name), token: randomUUID() };
                    retrieveDragonSlots(inst, menu);
                }
                if (data?.gui?.action === 'closegui') menu = null;
            } catch (err) { feedback.push(`龙核心面板读取失败：${err.message}`); }
        }
        if (p.channel === 'VexView') {
            try {
                const data = JSON.parse(gunzipSync(p.data, { maxOutputLength: 262144 }).toString('utf8'));
                if (data.packet_type === 'gui') {
                    const part = String(data.packet_data || '');
                    if (data.packet_sub_type === 'start') guiParts = part;
                    else if (data.packet_sub_type === 'continue') guiParts += part;
                    else if (data.packet_sub_type === 'end') {
                        guiParts += part;
                        menu = parseMenu(guiParts, bot, profile); guiParts = '';
                        if (menu?.title === '服务器功能面板') menu.title = selectedButton?.label || previousMenu?.title || menu.title;
                    }
                    if (guiParts.length > 262144) guiParts = '';
                }
                if (data.packet_type === 'close') menu = null;
                summary = { ...summary, type: data.packet_type, subtype: data.packet_sub_type,
                    data: typeof data.packet_data === 'string' ? data.packet_data.slice(0, 131072) : undefined };
            } catch (_) { /* 不把未知负载当脚本执行 */ }
        }
        if (summary.type === 'hud') return; // 排除持续刷新的血量 HUD，保留实际界面负载。
        if (responses.length < 40) responses.push(summary);
    };
    bot._client.on('custom_payload', onPayload);
    bot.on('messagestr', onMessage);
    const sendButton = button => {
        const body = { packet_type: 'button', packet_sub_type: String(button.id), packet_data: 'null' };
        bot._client.write('custom_payload', { channel: 'VexView', data: gzipSync(Buffer.from(JSON.stringify(body), 'utf8')) });
        inst.uiLog(`[模组菜单键] 点击“${button.label}”，按钮 ${button.id}`);
    };
    const sendVV = down => {
        const body = { packet_type: 'key_press', packet_sub_type: 'null', packet_data: `KeyBoardPress:${keyCode}:${down ? 1 : 0}:NOGUI` };
        bot._client.write('custom_payload', { channel: 'VexView', data: gzipSync(Buffer.from(JSON.stringify(body), 'utf8')) });
    };
    try {
        if (!selection && profile.registration?.keys.includes(key) && !inst._menuChannelsRegistered) {
            bot._client.write('custom_payload', { channel: 'REGISTER', data: Buffer.from(profile.registration.channels.join('\0'), 'utf8') });
            inst._menuChannelsRegistered = true;
            await new Promise(resolve => setTimeout(resolve, profile.registration.delayMs || 0));
        }
        if (provider === 'vexview' && !inst._vexVersionSent) {
            const body = { packet_type: 'ver', packet_data: profile.vexVersion, packet_sub_type: '854:480' };
            bot._client.write('custom_payload', { channel: 'VexView', data: gzipSync(Buffer.from(JSON.stringify(body), 'utf8')) });
            inst._vexVersionSent = true;
            await new Promise(resolve => setTimeout(resolve, 800));
        }
        if (selection?.refresh) {
            if (menu.provider === 'dragoncore') retrieveDragonSlots(inst, menu);
        } else if (selectedSlot) {
            if (selectedSlot.kind === 'dragon') {
                sendDragonEvent(bot, 'DragonCore_ClickSlot', [selectedSlot.key, String(selection.mouse)]);
                retrieveDragonSlots(inst, menu);
            } else if (selectedSlot.kind === 'inventory') {
                await clickDragonInventorySlot(inst,Number(selectedSlot.key.slice(10)),selection.mouse);
                retrieveDragonSlots(inst,menu);
            } else {
                const body = { packet_type: 'slot_click', packet_sub_type: 'null',
                    packet_data: `VexSlotClick:${selection.mouse === 1 ? 'RIGHT_CLICK' : 'LEFT_CLICK'}:${selectedSlot.key}` };
                bot._client.write('custom_payload', { channel: 'VexView', data: gzipSync(Buffer.from(JSON.stringify(body))) });
            }
            inst.uiLog(`[模组菜单键] ${selection.mouse === 1 ? '右键' : '左键'}“${selectedSlot.item?.name || selectedSlot.label}”，槽位 ${selectedSlot.key}`);
        } else if (selectedButton) {
            sendButton(selectedButton);
        } else if (provider === 'vexview') {
            try { sendVV(true); await new Promise(resolve => setTimeout(resolve, 100)); }
            finally { if (bot._client.state === 'play') sendVV(false); }
        } else {
            // discriminator 64, int32 opcode 5, VarInt UTF-8 G, int32 held count 1, G。
            core.pressKey(key);
        }
        if (!selection) inst.uiLog(`[模组菜单键] 已发送 ${provider} ${key}，等待服务器界面响应`);
        const deadline=Date.now()+4000;
        do {
            await new Promise(resolve=>setTimeout(resolve,100));
            if (menu?.provider==='dragoncore' && menu.slots.filter(s=>s.kind==='dragon').every(s=>refreshDragonMenu(inst,menu).slots.find(x=>x.key===s.key)?.loaded)) break;
            if (menu?.provider==='vexview'||bot.currentWindow) break;
        } while(Date.now()<deadline);
        if (openSubmenu) {
            const button = menu?.buttons.find(b => b.supported && b.label === profile.submenu.label);
            if (!button || !menu.baseTexture.includes(profile.submenu.texture)) throw new Error('当前面板没有已确认的快捷按钮，未发送点击');
            sendButton(button);
            menu = null;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        const window = bot.currentWindow;
        if (menu?.provider === 'dragoncore') menu = refreshDragonMenu(inst, menu);
        if (menu && !window) sessions.set(bot, { menu, at: Date.now() });
        inst.uiLog(window ? `[模组菜单键] 已收到箱子窗口，id=${window.id}` : menu ? `[模组菜单键] 已收到面板，${menu.buttons.length} 个按钮` : '[模组菜单键] 尚未收到菜单窗口，请查看服务器消息');
        return { sent: true, provider, key, clickedSubmenu: openSubmenu, menu, opened: !!window,
            clicked: selectedButton?.label, feedback,
            window: window ? { id: window.id, title: window.title, slots: window.slots.length } : null, responses };
    } catch(err) {
        if (previousMenu && menu?.token && menu.guiName===previousMenu.guiName)
            sessions.set(bot,{menu:previousMenu,at:Date.now(),needsRefresh:true});
        throw err;
    } finally {
        bot._client.removeListener('custom_payload', onPayload);
        bot.removeListener('messagestr', onMessage);
        pending.delete(bot);
    }
}
function pressDragonKey(inst, key) {
    if (pending.has(inst.bot)) throw Error('菜单操作正在进行');
    return getDragonCore(inst).pressKey(key);
}
module.exports = { pressMenuKey, parseMenu, pressDragonKey };
