/**
 * 脚本引擎 - 双模式（AI JSON / 玩家可视化）
 * 支持：顺序执行、条件判断（含 && || !）、循环、子脚本调用（带参数）、触发器、变量插值
 */
const logger = require('../utils/logger');
const { goals } = require('mineflayer-pathfinder');
const { isChatBlocked } = require('../utils/chatSafety');
const { findMatchingSlot, slotText } = require('../utils/guiMatch');
const { customName } = require('../utils/items');
const { ServerEvents } = require('@mcbot/protocol'); // 事件名统一走协议常量，杜绝两端字符串漂移

const MAX_CALL_DEPTH = 5;
const GOTO_TIMEOUT = 60000;
const SPAWN_TIMEOUT = 30000;
const GUI_WAIT_MS = 800;
const GUI_POLL_MS = 200;
const GUI_MAX_WAIT = 5000;
const WAIT_UNTIL_POLL = 500;
const MAX_TOTAL_STEPS = 100000;  // 单次脚本运行总步数上限（死循环保险）

module.exports = (botInstance) => {
    const bot = botInstance.bot;

    botInstance._scripts = {};
    botInstance._runningScript = null;
    botInstance._triggerTimer = null;
    botInstance._scriptVars = {};
    botInstance._scheduleFired = {};   // "HH:MM" -> dateStringYMD
    botInstance._lastVarsEmit = 0;

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg: `[脚本] ${msg}`, time: new Date().toLocaleTimeString()
        });
    };

    const emitStatus = (name, status, detail) => {
        botInstance.io.to(botInstance._room).to('admin').emit(ServerEvents.SCRIPT_STATUS, {
            user: bot.username, ownerId: botInstance.config.ownerId,
            name, status, detail
        });
    };

    const emitProgress = (path, action, loopIter) => {
        botInstance.io.to(botInstance._room).to('admin').emit(ServerEvents.SCRIPT_PROGRESS, {
            user: bot.username, ownerId: botInstance.config.ownerId,
            path, action, loopIter
        });
    };

    const emitError = (path, action, message) => {
        botInstance.io.to(botInstance._room).to('admin').emit(ServerEvents.SCRIPT_ERROR, {
            user: bot.username, ownerId: botInstance.config.ownerId,
            path, action, message
        });
    };

    const emitVars = () => {
        const now = Date.now();
        if (now - botInstance._lastVarsEmit < 300) return; // 节流 300ms
        botInstance._lastVarsEmit = now;
        botInstance.io.to(botInstance._room).to('admin').emit(ServerEvents.SCRIPT_VARS, {
            user: bot.username, ownerId: botInstance.config.ownerId,
            vars: { ...botInstance._scriptVars }
        });
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ==================== 变量插值 ====================
    function resolveVars(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/\{(\w+)\}/g, (_, name) => {
            const v = botInstance._scriptVars[name];
            return v !== undefined ? String(v) : `{${name}}`;
        });
    }

    function resolveStep(step) {
        const out = {};
        for (const k of Object.keys(step)) {
            const v = step[k];
            if (typeof v === 'string') out[k] = resolveVars(v);
            else out[k] = v;
        }
        return out;
    }

    // 安全数学表达式：只允许数字、运算符、括号
    function evalMath(expr) {
        const resolved = resolveVars(String(expr));
        if (!/^[\d\s+\-*/()%.]+$/.test(resolved)) return resolved;
        try {
            return Function(`"use strict"; return (${resolved})`)();
        } catch { return resolved; }
    }

    // ==================== 通用轮询等待 ====================
    async function pollUntil(fn, timeout, ctx) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (ctx.aborted) return false;
            if (fn()) return true;
            await sleep(WAIT_UNTIL_POLL);
        }
        return false;
    }

    // ==================== 等待聊天（支持正则捕获） ====================
    function waitForChat(pattern, isRegex, timeout, ctx) {
        return new Promise((resolve) => {
            let regex = null;
            if (isRegex) {
                try { regex = new RegExp(pattern); } catch (e) { /* fallback to plain */ }
            }
            const timer = setTimeout(() => {
                bot.removeListener('message', onMsg);
                resolve(null);
            }, timeout);

            const onMsg = (jsonMsg) => {
                if (ctx.aborted) {
                    clearTimeout(timer);
                    bot.removeListener('message', onMsg);
                    resolve(null);
                    return;
                }
                const raw = jsonMsg.toString().replace(/§./gi, '');
                if (regex) {
                    const m = raw.match(regex);
                    if (m) {
                        clearTimeout(timer);
                        bot.removeListener('message', onMsg);
                        resolve({ text: raw, groups: Array.from(m) });
                    }
                } else if (raw.includes(pattern)) {
                    clearTimeout(timer);
                    bot.removeListener('message', onMsg);
                    resolve({ text: raw, groups: null });
                }
            };
            bot.on('message', onMsg);
        });
    }

    // ==================== 条件解析（支持 && || ! 括号） ====================
    function evalCondition(cond) {
        if (!cond || cond === 'always') return true;
        if (!bot || !bot.entity) return false;
        try {
            const resolved = resolveVars(String(cond)).trim();
            if (!resolved) return true;
            return evalExpr(resolved);
        } catch (e) {
            emitLog(`条件解析失败: ${cond}`);
            return false;
        }
    }

    function evalExpr(s) {
        s = s.trim();
        if (!s) return true;

        // 顶层 || (最低优先级，从右向左找)
        let depth = 0;
        for (let i = s.length - 2; i >= 0; i--) {
            const c = s[i];
            if (c === ')') depth++;
            else if (c === '(') depth--;
            else if (depth === 0 && c === '|' && s[i + 1] === '|') {
                return evalExpr(s.slice(0, i)) || evalExpr(s.slice(i + 2));
            }
        }
        // 顶层 &&
        depth = 0;
        for (let i = s.length - 2; i >= 0; i--) {
            const c = s[i];
            if (c === ')') depth++;
            else if (c === '(') depth--;
            else if (depth === 0 && c === '&' && s[i + 1] === '&') {
                return evalExpr(s.slice(0, i)) && evalExpr(s.slice(i + 2));
            }
        }
        // NOT
        if (s.startsWith('!')) return !evalExpr(s.slice(1));
        // 括号
        if (s.startsWith('(') && s.endsWith(')')) {
            // 确认括号配对
            let d = 0, balanced = true;
            for (let i = 0; i < s.length; i++) {
                if (s[i] === '(') d++;
                else if (s[i] === ')') d--;
                if (d === 0 && i < s.length - 1) { balanced = false; break; }
            }
            if (balanced) return evalExpr(s.slice(1, -1));
        }
        return evalAtom(s);
    }

    function evalAtom(c) {
        c = c.trim();
        let m;

        m = c.match(/^health\s*([<>]=?)\s*(\d+\.?\d*)$/);
        if (m) return compare(bot.health, m[1], parseFloat(m[2]));

        m = c.match(/^food\s*([<>]=?)\s*(\d+\.?\d*)$/);
        if (m) return compare(bot.food, m[1], parseFloat(m[2]));

        if (c === 'inventory_full') {
            return bot.inventory.slots.filter((s, i) => i >= 9 && i <= 44 && !s).length === 0;
        }

        m = c.match(/^inventory_has\s+(.+)$/);
        if (m) {
            const name = m[1].trim().toLowerCase();
            return bot.inventory.items().some(item => item.name.toLowerCase().includes(name));
        }

        m = c.match(/^inventory_count\s+(.+?)\s*([<>]=?)\s*(\d+)$/);
        if (m) {
            const name = m[1].trim().toLowerCase();
            const total = bot.inventory.items()
                .filter(item => item.name.toLowerCase().includes(name))
                .reduce((sum, item) => sum + item.count, 0);
            return compare(total, m[2], parseInt(m[3]));
        }

        if (c === 'players_nearby') return hasNearbyPlayers();
        if (c === 'no_players_nearby') return !hasNearbyPlayers();

        m = c.match(/^holding\s+(.+)$/);
        if (m) {
            const held = bot.heldItem;
            return held && held.name.toLowerCase().includes(m[1].trim().toLowerCase());
        }

        if (c === 'gui_open') return !!bot.currentWindow;
        if (c === 'gui_closed') return !bot.currentWindow;

        m = c.match(/^gui_has\s+(.+)$/);
        if (m && bot.currentWindow) {
            // 同时搜 name + lore，菜单按钮关键信息常在 lore 里
            return findMatchingSlot(bot.currentWindow.slots, m[1].trim(), { matchLore: true }) >= 0;
        }

        m = c.match(/^gui_slot_has\s+(\d+)\s+(.+)$/);
        if (m && bot.currentWindow) {
            const slot = parseInt(m[1]);
            const name = m[2].trim().toLowerCase();
            const item = bot.currentWindow.slots[slot];
            return !!item && slotText(item, true).includes(name);
        }

        if (c === 'alive') return bot.health > 0;
        if (c === 'dead') return bot.health <= 0;

        m = c.match(/^var\s+(\w+)\s*([<>=!]+)\s*(.+)$/);
        if (m) {
            const varVal = botInstance._scriptVars[m[1]];
            const rawCmp = m[3].trim();
            const cmpVal = isNaN(rawCmp) ? rawCmp : parseFloat(rawCmp);
            if (m[2] === '==' || m[2] === '=') return varVal == cmpVal;
            if (m[2] === '!=') return varVal != cmpVal;
            const aNum = Number(varVal), bNum = Number(cmpVal);
            if (!isNaN(aNum) && !isNaN(bNum)) return compare(aNum, m[2], bNum);
            return false;
        }

        emitLog(`未知条件: ${c}`);
        return false;
    }

    function compare(a, op, b) {
        switch (op) {
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
            default: return false;
        }
    }

    function hasNearbyPlayers() {
        return Object.values(bot.entities).some(e =>
            e.type === 'player' && e.username !== bot.username &&
            bot.entity.position.distanceTo(e.position) <= 16
        );
    }

    // ==================== GUI 智能等待 ====================
    async function waitForGuiReady(ctx) {
        if (!bot.currentWindow) return false;
        let lastSlotHash = '';
        let stableCount = 0;
        const startTime = Date.now();

        while (Date.now() - startTime < GUI_MAX_WAIT) {
            if (ctx.aborted) return false;
            if (!bot.currentWindow) return false;
            const currentHash = bot.currentWindow.slots
                .map(s => s ? `${s.name}:${s.count}` : '_').join('|');
            if (currentHash === lastSlotHash) {
                stableCount++;
                if (stableCount >= 2) return true;
            } else {
                stableCount = 0;
                lastSlotHash = currentHash;
            }
            await sleep(GUI_POLL_MS);
        }
        return true;
    }

    // 寻路助手：带超时（实现抽到 utils/gotoWithTimeout 供 automine/window_gui 复用，
    // 修「不可达目标裸 goto 永久挂起」族 bug；此处保留旧签名做薄包装）。
    const sharedGotoWithTimeout = require('../utils/gotoWithTimeout');
    async function gotoWithTimeout(goal, timeoutMs) {
        const ms = timeoutMs && timeoutMs > 0 ? timeoutMs : GOTO_TIMEOUT;
        return sharedGotoWithTimeout(bot, goal, ms);
    }

    // ==================== 动作执行器 ====================
    async function executeAction(rawStep, ctx) {
        if (ctx.aborted || !bot.entity) return;
        const step = resolveStep(rawStep);     // 所有 string 字段先解析变量
        const action = step.do;

        switch (action) {
            case 'goto': {
                if (step.target) {
                    const t = String(step.target);
                    let entity;
                    if (t.startsWith('player:')) {
                        const name = t.slice(7);
                        entity = bot.players[name]?.entity;
                    } else if (t.startsWith('entity:')) {
                        const name = t.slice(7).toLowerCase();
                        entity = bot.nearestEntity(e => (e.name || '').toLowerCase().includes(name));
                    }
                    if (!entity) throw new Error(`找不到目标: ${t}`);
                    emitLog(`走向 ${t}`);
                    await gotoWithTimeout(new goals.GoalFollow(entity, parseFloat(step.distance) || 2), Number(step.timeout) * 1000);
                    break;
                }
                const x = Number(step.x), y = Number(step.y), z = Number(step.z);
                if (isNaN(x) || isNaN(y) || isNaN(z)) throw new Error('goto 坐标无效');
                emitLog(`走到 (${x}, ${y}, ${z})`);
                const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
                await gotoWithTimeout(goal, Number(step.timeout) * 1000);
                break;
            }

            case 'goto_location': {
                const locName = step.name || step.location || '';
                const loc = (botInstance.savedLocations || []).find(l => l.name === locName);
                if (!loc) { emitLog(`未找到保存的地点: ${locName}`); break; }
                emitLog(`前往地点「${locName}」(${loc.x}, ${loc.y}, ${loc.z})`);
                const locGoal = new goals.GoalBlock(loc.x, loc.y, loc.z);
                await gotoWithTimeout(locGoal, Number(step.timeout) * 1000);
                break;
            }

            case 'chat': {
                const msg = step.msg || '';
                if (isChatBlocked(msg)) { emitLog('消息被安全策略拦截'); break; }
                emitLog(`发送: ${msg}`);
                bot.chat(msg);
                break;
            }

            case 'cmd': {
                const text = step.text || step.cmd || '';
                if (!text) break;
                const final = text.startsWith('/') ? text : '/' + text;
                if (isChatBlocked(final)) { emitLog(`命令被安全策略拦截: ${final}`); break; }
                emitLog(`命令: ${final}`);
                bot.chat(final);
                break;
            }

            case 'whisper': {
                const target = step.target || step.player;
                const msg = step.msg || '';
                if (target && msg) {
                    const final = `/msg ${target} ${msg}`;
                    if (isChatBlocked(final)) { emitLog('私聊被安全策略拦截'); break; }
                    emitLog(`私聊 ${target}: ${msg}`);
                    bot.chat(final);
                }
                break;
            }

            case 'wait': {
                const ms = (Number(step.s) || Number(step.seconds) || 1) * 1000;
                emitLog(`等待 ${ms / 1000}秒`);
                const end = Date.now() + ms;
                while (Date.now() < end && !ctx.aborted) {
                    await sleep(Math.min(500, end - Date.now()));
                }
                break;
            }

            case 'wait_spawn': {
                emitLog('等待重生...');
                const timeout = (Number(step.timeout) * 1000) || SPAWN_TIMEOUT;
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        bot.removeListener('spawn', onSpawn);
                        reject(new Error('等待重生超时'));
                    }, timeout);
                    const onSpawn = () => { clearTimeout(timer); resolve(); };
                    bot.once('spawn', onSpawn);
                });
                await sleep(1000);
                break;
            }

            case 'interact': {
                const targetName = step.target || step.name;
                emitLog(`右键: ${targetName}`);
                const entity = bot.nearestEntity(e => {
                    if (e === bot.entity) return false;
                    const name = (e.customName || e.username || e.name || '').toString()
                        .replace(/§./gi, '').toLowerCase();
                    return name.includes(String(targetName).toLowerCase()) || String(e.id) === String(targetName);
                });
                if (!entity) throw new Error(`未找到实体: ${targetName}`);
                await gotoWithTimeout(new goals.GoalFollow(entity, 2));
                if (ctx.aborted || !bot.entity) return; // 寻路途中断连/停止：bot 已销毁，勿再 lookAt
                await bot.lookAt(entity.position.offset(0, (entity.height || 1.8) * 0.8, 0), true);
                if (ctx.aborted || !bot.entity) return; // lookAt 后复检，避免对已销毁 bot swingArm/activateEntity
                bot.swingArm('right');
                if (bot.activateEntity) {
                    await bot.activateEntity(entity);
                } else if (bot.activateEntityAt) {
                    await bot.activateEntityAt(entity, entity.position);
                }
                if (ctx.aborted || !bot.entity) return; // activate 后复检，再访问 currentWindow
                await sleep(GUI_WAIT_MS);
                if (bot.currentWindow) await waitForGuiReady(ctx);
                break;
            }

            case 'click_slot': {
                const slot = Number(step.slot);
                const button = Number(step.button) || 0;
                if (!bot.currentWindow) { emitLog(`没有打开界面，跳过`); break; }
                await waitForGuiReady(ctx);
                if (ctx.aborted || !bot.entity) return; // GUI 等待期间可能断连
                emitLog(`点击槽位 ${slot}`);
                await bot.clickWindow(slot, button, 0);
                if (ctx.aborted || !bot.entity) return; // clickWindow 后复检，再访问 currentWindow
                await sleep(300);
                if (bot.currentWindow) await waitForGuiReady(ctx);
                break;
            }

            case 'close_gui': {
                if (bot.currentWindow) {
                    emitLog('关闭界面');
                    await bot.closeWindow(bot.currentWindow);
                    await sleep(200);
                }
                break;
            }

            case 'equip': {
                // 关键词同时匹配「物品 id」与「自定义显示名」——RPG 服物品 id 多是 clock/paper，
                // 真正的「自助菜单」等名字在 NBT 显示名里，只按 id 匹配会找不到。
                const kw = String(step.item || '').toLowerCase();
                const item = bot.inventory.items().find(
                    (i) => i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
                );
                if (item) {
                    emitLog(`持物: ${customName(item) || item.name}`);
                    await bot.equip(item, step.dest || 'hand');
                } else {
                    emitLog(`没有: ${step.item}`);
                }
                break;
            }

            case 'equip_best_weapon': {
                const items = bot.inventory.items().filter(i => /sword|axe/.test(i.name));
                if (items.length === 0) { emitLog('背包无武器'); break; }
                try {
                    const mc = botInstance.getMcData();
                    items.sort((a, b) => {
                        const aDmg = mc.items[a.type]?.attackDamage || (a.name.includes('sword') ? 5 : 3);
                        const bDmg = mc.items[b.type]?.attackDamage || (b.name.includes('sword') ? 5 : 3);
                        return bDmg - aDmg;
                    });
                } catch (e) {
                    items.sort((a, b) => (a.name.includes('sword') ? -1 : 1));
                }
                emitLog(`装备最佳武器: ${items[0].name}`);
                await bot.equip(items[0], 'hand');
                break;
            }

            case 'equip_best_tool': {
                // 为「将要挖的方块」装备最合适的工具（镐/斧/锹…）。
                // 优先按关键词找最近的目标方块，没填关键词就用准星指向的方块；
                // 再用 pathfinder.bestHarvestTool 选最优工具（与 automine 同款写法）。
                let block = null;
                const kw = String(step.block || step.item || '').toLowerCase();
                if (kw) {
                    try {
                        const mc = botInstance.getMcData();
                        const ids = Object.values(mc.blocksByName || {})
                            .filter(b => b.name.toLowerCase().includes(kw))
                            .map(b => b.id);
                        if (ids.length) {
                            const pos = bot.findBlock ? bot.findBlock({ matching: ids, maxDistance: 32 }) : null;
                            if (pos) block = pos;
                        }
                    } catch (e) { /* 忽略，落到准星方块 */ }
                }
                if (!block && bot.blockAtCursor) block = bot.blockAtCursor(5);
                if (!block) { emitLog('没有可参照的方块（填方块名或先看向方块）'); break; }
                let tool = null;
                try { tool = bot.pathfinder.bestHarvestTool(block); } catch (e) { /* 无可用工具 */ }
                if (tool) {
                    emitLog(`为 ${block.name} 装备工具: ${tool.name}`);
                    await bot.equip(tool, 'hand');
                } else {
                    emitLog(`无需工具或背包没有合适工具（${block.name}）`);
                }
                break;
            }

            case 'deposit': {
                // 把背包物品存入最近的箱子/容器（按名字关键词；留空=除装备外全部）。
                // 复用 window_gui 暴露的 scanContainers / openContainerAt（含寻路靠近 + 开窗），不写死坐标。
                const kw = String(step.item || '').toLowerCase();
                const containers = botInstance.scanContainers ? botInstance.scanContainers() : [];
                if (!containers.length) { emitLog('附近没有可用容器'); break; }
                const near = containers[0];
                emitLog(`前往容器 (${near.x}, ${near.y}, ${near.z}) 存物`);
                try {
                    // openContainerAt 内部寻路靠近并开窗；返回序列化快照，存物用 bot.currentWindow 这个活窗口
                    await botInstance.openContainerAt(near.x, near.y, near.z);
                } catch (e) { emitLog(`打开容器失败: ${e.message}`); break; }
                if (ctx.aborted || !bot.entity) return; // 寻路/开窗期间断连
                const window = bot.currentWindow;
                if (!window) { emitLog('容器未打开'); break; }
                // 仅存玩家背包里的物品；按关键词过滤，留空则全部
                const toDeposit = bot.inventory.items().filter(
                    i => !kw || i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw)
                );
                let n = 0;
                for (const item of toDeposit) {
                    if (ctx.aborted || !bot.entity) break;
                    try {
                        await window.deposit(item.type, item.metadata, item.count);
                        n++;
                    } catch (e) { emitLog(`存入失败 ${item.name}: ${e.message}`); }
                }
                emitLog(`已存入 ${n} 种物品`);
                try { if (bot.currentWindow) await bot.closeWindow(bot.currentWindow); } catch (e) { /* ignore */ }
                break;
            }

            case 'drop': {
                const itemName = String(step.item || '').toLowerCase();
                const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(itemName));
                if (item) {
                    const count = Number(step.count) || item.count;
                    emitLog(`丢弃: ${item.name} x${count}`);
                    await bot.toss(item.type, item.metadata, count);
                }
                break;
            }

            case 'attack': {
                const targetName = step.target || step.entity; // 积木字段名为 entity
                const count = Math.max(1, Number(step.count) || 1);
                const interval = (Number(step.interval) || 0.6) * 1000;
                const findTarget = () => {
                    if (targetName) {
                        return bot.nearestEntity(e => {
                            if (e === bot.entity || e.type === 'player') return false;
                            const name = (e.customName || e.name || '').toString().toLowerCase();
                            return name.includes(String(targetName).toLowerCase());
                        });
                    }
                    return bot.nearestEntity(e =>
                        e !== bot.entity && e.type !== 'player' && e.type !== 'object'
                    );
                };
                for (let i = 0; i < count && !ctx.aborted; i++) {
                    const entity = findTarget();
                    if (!entity) { emitLog('没有可攻击目标'); break; }
                    emitLog(`攻击 ${entity.name || entity.username || entity.id} (${i + 1}/${count})`);
                    try { bot.attack(entity); } catch (e) {}
                    if (i < count - 1) await sleep(interval);
                }
                break;
            }

            case 'look': {
                const x = Number(step.x), y = Number(step.y), z = Number(step.z);
                await bot.lookAt({ x, y, z }, true);
                break;
            }

            case 'drop_all': {
                // 清空背包，保留关键词命中的物品（多个关键词用逗号/空格分隔；留空=全丢）。
                // 比单物品 drop 更实用：刷怪/挖矿满包时一键倒垃圾，保留工具/武器。
                const keepKws = String(step.keep || '')
                    .toLowerCase().split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                const isKept = (item) => keepKws.some(
                    k => item.name.toLowerCase().includes(k) || customName(item).toLowerCase().includes(k)
                );
                const items = bot.inventory.items().filter(i => !isKept(i));
                if (!items.length) { emitLog('没有可丢弃的物品'); break; }
                let n = 0;
                for (const item of items) {
                    if (ctx.aborted || !bot.entity) break;
                    try { await bot.toss(item.type, item.metadata, item.count); n++; }
                    catch (e) { /* 个别失败不阻塞 */ }
                }
                emitLog(`已丢弃 ${n} 种物品${keepKws.length ? `（保留: ${keepKws.join('/')}）` : ''}`);
                break;
            }

            case 'look_at': {
                // 看向最近的玩家/生物（通用版「look」，不必手填坐标）。
                // target: 留空=最近玩家；'mob'/'entity'=最近非玩家生物；其它=按名字关键词匹配实体。
                const t = String(step.target || '').toLowerCase().trim();
                let entity = null;
                if (!t || t === 'player') {
                    entity = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
                } else if (t === 'mob' || t === 'entity') {
                    entity = bot.nearestEntity(e =>
                        e !== bot.entity && e.type !== 'player' && e.type !== 'object' && e.type !== 'item');
                } else {
                    entity = bot.nearestEntity(e => {
                        if (e === bot.entity) return false;
                        const name = (e.customName || e.username || e.name || '').toString().toLowerCase();
                        return name.includes(t);
                    });
                }
                if (!entity) { emitLog(`没有可看向的目标: ${t || '玩家'}`); break; }
                emitLog(`看向 ${entity.username || entity.name || entity.id}`);
                await bot.lookAt(entity.position.offset(0, (entity.height || 1.6) * 0.85, 0), true);
                break;
            }

            case 'goto_nearest': {
                // 走向最近的玩家/生物（target 同 look_at）；distance=停下的距离（默认 2）。
                const t = String(step.target || '').toLowerCase().trim();
                let entity = null;
                if (!t || t === 'player') {
                    entity = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
                } else if (t === 'mob' || t === 'entity') {
                    entity = bot.nearestEntity(e =>
                        e !== bot.entity && e.type !== 'player' && e.type !== 'object' && e.type !== 'item');
                } else {
                    entity = bot.nearestEntity(e => {
                        if (e === bot.entity) return false;
                        const name = (e.customName || e.username || e.name || '').toString().toLowerCase();
                        return name.includes(t);
                    });
                }
                if (!entity) { emitLog(`没有可前往的目标: ${t || '玩家'}`); break; }
                emitLog(`走向 ${entity.username || entity.name || entity.id}`);
                await gotoWithTimeout(new goals.GoalFollow(entity, parseFloat(step.distance) || 2), Number(step.timeout) * 1000);
                break;
            }

            case 'hold': {
                // 持续按住某个控制键 N 秒（如潜行过桥、长按前进走进传送门）。
                // key: forward/back/left/right/jump/sneak/sprint；s: 秒数。结束/中止时务必松开。
                const allowed = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
                const key = String(step.key || 'forward').toLowerCase();
                if (!allowed.includes(key)) { emitLog(`不支持的控制键: ${key}`); break; }
                const ms = (Number(step.s) || Number(step.seconds) || 1) * 1000;
                emitLog(`按住 ${key} ${ms / 1000}秒`);
                try {
                    bot.setControlState(key, true);
                    const end = Date.now() + ms;
                    while (Date.now() < end && !ctx.aborted && bot.entity) {
                        await sleep(Math.min(200, end - Date.now()));
                    }
                } finally {
                    try { bot.setControlState(key, false); } catch (e) { /* bot 可能已销毁 */ }
                }
                break;
            }

            case 'use_item': {
                emitLog('使用物品');
                bot.activateItem();
                break;
            }

            case 'log': {
                emitLog(step.msg || '');
                break;
            }

            case 'stop': {
                emitLog('脚本主动停止');
                ctx.aborted = true;
                break;
            }

            case 'return_home': {
                const rp = botInstance.mobHunterTask?.returnPoint;
                if (!rp) { emitLog('未设置归家点'); break; }
                emitLog(`回家 (${Math.floor(rp.x)}, ${Math.floor(rp.y)}, ${Math.floor(rp.z)})`);
                // 统一走带超时的寻路助手：杜绝不可达归家点无限挂起 + 孤立 goto 的 unhandled reject(MODA-3)
                await gotoWithTimeout(new goals.GoalBlock(
                    Math.floor(rp.x), Math.floor(rp.y), Math.floor(rp.z)
                ));
                break;
            }

            case 'wait_gui_item': {
                const itemName = step.item || '';
                const timeout = (Number(step.timeout) || 10) * 1000;
                const matchLore = step.matchLore === true || step.matchLore === 'true';
                emitLog(`等待界面物品: ${itemName}`);
                // 按「显示名(+可选 lore)」匹配，与 find_and_click_slot 一致。
                // 原来只比 item.name(物品 id，如 paper/clock)，永远匹配不到中文显示名 → 必然超时。
                const found = await pollUntil(() => {
                    if (!bot.currentWindow) return false;
                    return findMatchingSlot(bot.currentWindow.slots, itemName, { matchLore }) >= 0;
                }, timeout, ctx);
                if (!found) emitLog(`超时未找到: ${itemName}`);
                break;
            }

            case 'wait_chat': {
                const pattern = step.pattern || step.msg || '';
                const timeout = (Number(step.timeout) || 30) * 1000;
                const isRegex = step.regex === true || step.regex === 'true';
                emitLog(`等待聊天${isRegex ? '(regex)' : ''}: ${pattern}`);
                const matched = await waitForChat(pattern, isRegex, timeout, ctx);
                if (matched) {
                    emitLog(`匹配: ${matched.text.slice(0, 60)}`);
                    if (step.save_to) {
                        botInstance._scriptVars[step.save_to] = matched.text;
                        if (matched.groups) {
                            matched.groups.forEach((g, i) => {
                                if (i > 0) botInstance._scriptVars[`${step.save_to}_${i}`] = g;
                            });
                        }
                        emitVars();
                    }
                } else {
                    emitLog(`等待聊天超时`);
                }
                break;
            }

            case 'set_var': {
                const varName = step.name || step.var;
                let val = step.value;
                if (typeof val === 'string') {
                    if (val === '$health') val = bot.health;
                    else if (val === '$food') val = bot.food;
                    else if (val === '$x') val = Math.floor(bot.entity.position.x);
                    else if (val === '$y') val = Math.floor(bot.entity.position.y);
                    else if (val === '$z') val = Math.floor(bot.entity.position.z);
                    else if (val.startsWith('$scoreboard:')) {
                        const keyword = val.substring(12);
                        val = botInstance.getScoreboardValue ? botInstance.getScoreboardValue(keyword) : null;
                    } else if (val.startsWith('=')) {
                        val = evalMath(val.slice(1));
                    } else {
                        const numVal = Number(val);
                        if (val.trim() !== '' && !isNaN(numVal) && val.trim() === String(numVal)) val = numVal;
                    }
                }
                botInstance._scriptVars[varName] = val;
                emitLog(`变量 ${varName} = ${val}`);
                emitVars();
                break;
            }

            case 'math_var': {
                const varName = step.name || step.var;
                const current = Number(botInstance._scriptVars[varName]) || 0;
                const operand = Number(step.value) || 0;
                let result;
                switch (step.op) {
                    case '+': result = current + operand; break;
                    case '-': result = current - operand; break;
                    case '*': result = current * operand; break;
                    case '/': result = operand !== 0 ? current / operand : 0; break;
                    case '%': result = operand !== 0 ? current % operand : 0; break;
                    default: result = current;
                }
                botInstance._scriptVars[varName] = result;
                emitLog(`变量 ${varName} = ${result} (${current} ${step.op} ${operand})`);
                emitVars();
                break;
            }

            case 'find_and_click_slot': {
                const button = Number(step.button) || 0;
                if (!bot.currentWindow) { emitLog(`没有打开界面`); break; }
                await waitForGuiReady(ctx);
                if (ctx.aborted || !bot.entity || !bot.currentWindow) return; // GUI 等待期间断连/界面关闭，勿读 currentWindow.slots
                // 增强匹配：matchLore 同时搜 lore；slotFrom/slotTo 限定槽位范围；save_slot 把命中槽位存入变量。
                // 全部可选，老脚本(只填 item)行为不变。
                const opts = {
                    matchLore: step.matchLore === true || step.matchLore === 'true',
                    slotFrom: step.slotFrom !== undefined ? Number(step.slotFrom) : undefined,
                    slotTo: step.slotTo !== undefined ? Number(step.slotTo) : undefined,
                };
                const targetSlot = findMatchingSlot(bot.currentWindow.slots, step.item || '', opts);
                if (targetSlot >= 0) {
                    if (step.save_slot) { botInstance._scriptVars[step.save_slot] = targetSlot; emitVars(); }
                    emitLog(`点击「${step.item}」@ 槽位${targetSlot}`);
                    await bot.clickWindow(targetSlot, button, 0);
                    if (ctx.aborted || !bot.entity) return; // clickWindow 后复检，再访问 currentWindow
                    await sleep(300);
                    if (bot.currentWindow) await waitForGuiReady(ctx);
                } else {
                    emitLog(`界面中未找到: ${step.item}`);
                }
                break;
            }

            case 'wait_until': {
                const cond = step.cond || step.condition;
                const timeout = (Number(step.timeout) || 60) * 1000;
                emitLog(`等待条件: ${cond}`);
                const ok = await pollUntil(() => evalCondition(cond), timeout, ctx);
                if (!ok) emitLog(`条件等待超时: ${cond}`);
                break;
            }

            case 'swap_hands': {
                emitLog('切换副手');
                if (bot.swapHandItems) await bot.swapHandItems();
                break;
            }

            case 'sneak': {
                const active = step.active !== false && step.active !== 'false';
                emitLog(active ? '开始潜行' : '停止潜行');
                bot.setControlState('sneak', active);
                break;
            }

            case 'jump': {
                emitLog('跳跃');
                bot.setControlState('jump', true);
                await sleep(100);
                bot.setControlState('jump', false);
                break;
            }

            case 'dig': {
                // 挖最近的指定方块：找 → 走近 → 装最佳工具 → 挖（与 automine 同款流程的单步版）。
                const kw = String(step.block || '').toLowerCase().trim();
                if (!kw) { emitLog('dig 缺少方块名'); break; }
                const maxDist = Number(step.distance) || 16;
                let ids = [];
                try {
                    const mc = botInstance.getMcData();
                    ids = Object.values(mc.blocksByName || {})
                        .filter(b => b.name.toLowerCase().includes(kw))
                        .map(b => b.id);
                } catch (e) { /* mcData 不可用走名字匹配 */ }
                const found = bot.findBlock({
                    matching: ids.length ? ids : (b => b && b.name && b.name.toLowerCase().includes(kw)),
                    maxDistance: maxDist,
                });
                if (!found) { emitLog(`${maxDist}格内没有 ${step.block}`); break; }
                const pos = found.position;
                emitLog(`挖掘 ${found.name} (${pos.x}, ${pos.y}, ${pos.z})`);
                await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), Number(step.timeout) * 1000);
                if (ctx.aborted || !bot.entity) return;
                const block = bot.blockAt(pos);
                if (!block || block.name !== found.name) { emitLog('目标方块已消失/变化'); break; }
                let tool = null;
                try { tool = bot.pathfinder.bestHarvestTool(block); if (tool) await bot.equip(tool, 'hand'); } catch (e) { /* 无合适工具 */ }
                if (ctx.aborted || !bot.entity) return;
                const canDig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(block) : true;
                if (!canDig) { emitLog(`当前无法挖掘 ${block.name}（工具/距离不满足）`); break; }
                await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
                if (ctx.aborted || !bot.entity) return;
                await bot.dig(block);
                emitLog(`已挖掘 ${block.name}`);
                break;
            }

            case 'place': {
                // 在指定坐标放置背包里的方块：目标格必须是空气，且有相邻实体方块作放置参照面。
                const kw = String(step.item || step.block || '').toLowerCase().trim();
                if (!kw) { emitLog('place 缺少物品名'); break; }
                const px = Math.floor(Number(step.x)), py = Math.floor(Number(step.y)), pz = Math.floor(Number(step.z));
                if (isNaN(px) || isNaN(py) || isNaN(pz)) { emitLog('place 需要 x/y/z 坐标'); break; }
                const item = bot.inventory.items().find(
                    i => i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
                );
                if (!item) { emitLog(`背包没有: ${step.item || step.block}`); break; }
                await gotoWithTimeout(new goals.GoalNear(px, py, pz, 3), Number(step.timeout) * 1000);
                if (ctx.aborted || !bot.entity) return;
                const { Vec3 } = require('vec3');
                const targetPos = new Vec3(px, py, pz);
                const targetBlock = bot.blockAt(targetPos);
                if (!targetBlock || targetBlock.boundingBox !== 'empty') {
                    emitLog(`(${px}, ${py}, ${pz}) 不是空位，无法放置`); break;
                }
                // 六个面找实体邻块当参照；face = 参照块指向目标格的方向
                const faces = [
                    new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(-1, 0, 0),
                    new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1),
                ];
                let ref = null, face = null;
                for (const f of faces) {
                    const nb = bot.blockAt(targetPos.plus(f));
                    if (nb && nb.boundingBox === 'block') { ref = nb; face = f.scaled(-1); break; }
                }
                if (!ref) { emitLog('目标位置周围没有可参照的实体方块'); break; }
                await bot.equip(item, 'hand');
                if (ctx.aborted || !bot.entity) return;
                emitLog(`放置 ${item.name} @ (${px}, ${py}, ${pz})`);
                await bot.placeBlock(ref, face);
                break;
            }

            case 'craft': {
                // 合成物品：先试 2x2 随身合成，配方需要工作台时自动找最近的工作台走过去。
                const kw = String(step.item || '').toLowerCase().trim();
                if (!kw) { emitLog('craft 缺少物品名'); break; }
                const count = Math.max(1, Number(step.count) || 1);
                let itemDef = null;
                try {
                    const mc = botInstance.getMcData();
                    itemDef = mc.itemsByName[kw]
                        || Object.values(mc.itemsByName).find(i => i.name.includes(kw))
                        || Object.values(mc.itemsByName).find(i => (i.displayName || '').toLowerCase().includes(kw));
                } catch (e) { /* fallthrough */ }
                if (!itemDef) { emitLog(`未知物品: ${step.item}`); break; }
                let table = null;
                let recipes = bot.recipesFor(itemDef.id, null, 1, null) || [];
                if (!recipes.length) {
                    // 随身合成不了 → 找工作台
                    try {
                        const mc = botInstance.getMcData();
                        const tableId = mc.blocksByName.crafting_table?.id;
                        if (tableId != null) table = bot.findBlock({ matching: tableId, maxDistance: 16 });
                    } catch (e) { /* ignore */ }
                    if (table) {
                        const tp = table.position;
                        emitLog(`前往工作台 (${tp.x}, ${tp.y}, ${tp.z})`);
                        await gotoWithTimeout(new goals.GoalNear(tp.x, tp.y, tp.z, 2), Number(step.timeout) * 1000);
                        if (ctx.aborted || !bot.entity) return;
                        table = bot.blockAt(tp); // 走近后重取，确保引用有效
                        recipes = bot.recipesFor(itemDef.id, null, 1, table) || [];
                    }
                }
                if (!recipes.length) {
                    emitLog(`无法合成 ${itemDef.name}（材料不足${table ? '' : '或附近16格没有工作台'}）`);
                    break;
                }
                emitLog(`合成 ${itemDef.name} x${count}`);
                await bot.craft(recipes[0], count, table || undefined);
                emitLog(`已合成 ${itemDef.name} x${count}`);
                break;
            }

            default:
                emitLog(`未知动作: ${action}`);
        }
    }

    // ==================== 步骤执行器（递归） ====================
    async function executeSteps(steps, ctx, basePath = []) {
        if (!Array.isArray(steps)) return;

        for (let i = 0; i < steps.length; i++) {
            if (ctx.aborted || !bot.entity) return;
            // auto_use 让位：自动使用正在用东西(吃/喝 ~1.6s)时，脚本在步与步之间等它落下，避免互相打断
            while (botInstance.isBodyBusy && botInstance.isBodyBusy() && !ctx.aborted && bot.entity) {
                await sleep(50);
            }
            if (ctx.aborted || !bot.entity) return;
            ctx.totalSteps = (ctx.totalSteps || 0) + 1;
            if (ctx.totalSteps > MAX_TOTAL_STEPS) {
                emitLog(`总执行步数超过 ${MAX_TOTAL_STEPS}，强制终止（疑似死循环）`);
                ctx.aborted = true;
                return;
            }

            const step = steps[i];
            if (!step || !step.do) continue;
            if (step.disabled) continue;        // 编辑器禁用的步骤跳过
            if (step.do === 'note') continue;   // 注释块不执行
            const stepPath = [...basePath, i];
            const pathStr = stepPath.join('-');

            try {
                emitProgress(pathStr, step.do, ctx.loopIter);

                if (step.do === 'if') {
                    if (evalCondition(step.cond)) {
                        if (step.then) await executeSteps(step.then, ctx, [...stepPath, 'then']);
                    } else {
                        if (step.else) await executeSteps(step.else, ctx, [...stepPath, 'else']);
                    }
                    continue;
                }

                if (step.do === 'repeat') {
                    const times = Number(step.times) || 0;
                    const subSteps = step.steps || [];
                    if (times <= 0 && subSteps.length === 0) {
                        emitLog('已阻止空的无限重复块');
                        continue;
                    }
                    let count = 0;
                    while (!ctx.aborted) {
                        if (times > 0 && count >= times) break;
                        const prevIter = ctx.loopIter;
                        ctx.loopIter = count + 1;
                        await executeSteps(subSteps, ctx, [...stepPath, 'steps']);
                        ctx.loopIter = prevIter;
                        count++;
                        await sleep(0);
                    }
                    continue;
                }

                if (step.do === 'while') {
                    const subSteps = step.steps || [];
                    const maxIter = Number(step.max) || 10000;
                    let count = 0;
                    while (!ctx.aborted && count < maxIter) {
                        if (!evalCondition(step.cond)) break;
                        const prevIter = ctx.loopIter;
                        ctx.loopIter = count + 1;
                        await executeSteps(subSteps, ctx, [...stepPath, 'steps']);
                        ctx.loopIter = prevIter;
                        count++;
                        await sleep(0);
                    }
                    continue;
                }

                if (step.do === 'break_if') {
                    if (evalCondition(step.cond)) {
                        emitLog(`break_if 触发: ${step.cond}`);
                        return;
                    }
                    continue;
                }

                if (step.cond && !evalCondition(step.cond)) continue;

                if (step.do === 'run_script') {
                    const scriptName = resolveVars(String(step.name || ''));
                    if (!scriptName) { emitLog('run_script 缺少 name'); continue; }
                    if (ctx.callDepth >= MAX_CALL_DEPTH) {
                        emitLog(`子脚本嵌套超过 ${MAX_CALL_DEPTH} 层`); continue;
                    }
                    const subScript = botInstance._scripts[scriptName];
                    if (!subScript) { emitLog(`子脚本不存在: ${scriptName}`); continue; }

                    // 参数注入：保存原值，调用后还原
                    const savedVars = {};
                    if (step.args && typeof step.args === 'object') {
                        for (const [k, v] of Object.entries(step.args)) {
                            savedVars[k] = botInstance._scriptVars[k];
                            const resolved = typeof v === 'string' ? resolveVars(v) : v;
                            botInstance._scriptVars[k] = resolved;
                        }
                        emitVars();
                    }

                    emitLog(`调用子脚本: ${scriptName}`);
                    const subCtx = { ...ctx, callDepth: ctx.callDepth + 1 };
                    try {
                        await executeSteps(subScript.steps || [], subCtx, [...stepPath, 'sub']);
                    } finally {
                        for (const [k, v] of Object.entries(savedVars)) {
                            if (v === undefined) delete botInstance._scriptVars[k];
                            else botInstance._scriptVars[k] = v;
                        }
                        if (Object.keys(savedVars).length > 0) emitVars();
                    }
                    if (subCtx.aborted) ctx.aborted = true;
                    ctx.totalSteps = subCtx.totalSteps;
                    continue;
                }

                // 叶子动作：支持失败自动重试（step.retry 次，间隔 step.retryDelay 秒），默认不重试 → 行为不变
                const maxRetry = Math.max(0, Number(step.retry) || 0);
                const retryDelay = (Number(step.retryDelay) || 1) * 1000;
                let attempt = 0;
                for (;;) {
                    try {
                        await executeAction(step, ctx);
                        break;
                    } catch (actErr) {
                        if (attempt >= maxRetry || ctx.aborted) throw actErr;
                        attempt++;
                        emitLog(`↻ ${step.do} 失败，第 ${attempt}/${maxRetry} 次重试: ${actErr.message}`);
                        await sleep(retryDelay);
                    }
                }

            } catch (err) {
                emitLog(`步骤 ${i + 1} (${step.do}) 出错: ${err.message}`);
                emitError(pathStr, step.do, err.message);
            }
        }
    }

    // ==================== 脚本运行入口 ====================
    async function runScript(name) {
        const script = botInstance._scripts[name];
        if (!script) { emitLog(`脚本不存在: ${name}`); return; }
        if (botInstance._runningScript) {
            emitLog(`已有脚本在运行 (${botInstance._runningScript.name})，请先停止`);
            emitStatus(name, 'rejected', '已有脚本在运行');
            return;
        }

        const ctx = { name, aborted: false, callDepth: 0, totalSteps: 0, loopIter: 0 };
        botInstance._runningScript = ctx;
        emitStatus(name, 'running');
        emitLog(`启动脚本: ${name}`);

        try {
            const doLoop = script.loop === true;
            const loopDelay = (Number(script.loopDelay) || Number(script.delay) || 0) * 1000;

            do {
                await executeSteps(script.steps || [], ctx);
                if (ctx.aborted) break;
                if (doLoop && loopDelay > 0) {
                    emitLog(`循环等待 ${loopDelay / 1000}秒...`);
                    const end = Date.now() + loopDelay;
                    while (Date.now() < end && !ctx.aborted) await sleep(500);
                }
            } while (doLoop && !ctx.aborted);

        } catch (err) {
            emitLog(`脚本异常终止: ${err.message}`);
            emitError('-', '-', err.message);
        } finally {
            botInstance._runningScript = null;
            emitStatus(name, 'stopped');
            emitLog(`脚本结束: ${name}`);
        }
    }

    // ==================== 触发器系统 ====================
    function checkTriggers() {
        if (!bot || !bot.entity) return;
        if (botInstance._runningScript) return;

        for (const [name, script] of Object.entries(botInstance._scripts)) {
            if (!script.trigger || script.trigger.type === 'manual') continue;
            try {
                if (shouldTrigger(name, script.trigger)) {
                    emitLog(`触发器激活: ${name} (${script.trigger.type})`);
                    runScript(name);
                    return;
                }
            } catch (e) {}
        }
    }

    function shouldTrigger(name, trigger) {
        if (!trigger) return false;
        switch (trigger.type) {
            case 'schedule': {
                const now = new Date();
                const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                const want = trigger.time || trigger.value; // 可视化编辑器存 value，旧数据存 time
                if (!want || time !== want) return false;
                const today = now.toDateString();
                if (botInstance._scheduleFired[want] === today) return false;
                botInstance._scheduleFired[want] = today;
                return true;
            }
            case 'chat_match': {
                const pat = trigger.pattern || trigger.value; // 可视化编辑器存 value
                const flag = botInstance._lastChatTrigger;
                if (flag && pat && flag.pattern === pat && Date.now() - flag.time < 3000) {
                    botInstance._lastChatTrigger = null;
                    return true;
                }
                return false;
            }
            case 'health_below':
                return bot.health < (Number(trigger.value) || 5);
            case 'food_below':
                return bot.food < (Number(trigger.value) || 10);
            case 'mob_nearby': {
                // 敌对生物进入指定距离（默认 8 格）
                const dist = Number(trigger.value) || 8;
                return Object.values(bot.entities).some(e =>
                    e && e !== bot.entity && e.position && /hostile/i.test(String(e.kind || '')) &&
                    bot.entity.position.distanceTo(e.position) <= dist
                );
            }
            case 'damage': {
                // 受到伤害（血量下降时由 health 监听置位，3 秒内消费）
                if (botInstance._justDamaged && Date.now() - botInstance._justDamaged < 3000) {
                    botInstance._justDamaged = null;
                    return true;
                }
                return false;
            }
            case 'respawn':
                if (botInstance._justRespawned) {
                    botInstance._justRespawned = false;
                    return true;
                }
                return false;
            case 'player_nearby':
                return hasNearbyPlayers();
            case 'inventory_full':
                return bot.inventory.slots.filter((s, i) => i >= 9 && i <= 44 && !s).length === 0;
            case 'interval': {
                const key = `_triggerLast_${trigger.type}_${name}`;
                const now = Date.now();
                const interval = (Number(trigger.seconds ?? trigger.value) || 60) * 1000; // 编辑器存 value
                if (!botInstance[key] || now - botInstance[key] >= interval) {
                    botInstance[key] = now;
                    return true;
                }
                return false;
            }
            default: return false;
        }
    }

    const onChatForTrigger = (jsonMsg) => {
        try {
            const raw = jsonMsg.toString().replace(/§./gi, '');
            for (const [name, script] of Object.entries(botInstance._scripts)) {
                const pat = script.trigger?.pattern || script.trigger?.value; // 编辑器存 value
                if (script.trigger?.type === 'chat_match' && pat) {
                    if (raw.includes(pat)) {
                        botInstance._lastChatTrigger = { pattern: pat, time: Date.now() };
                    }
                }
            }
        } catch (e) {}
    };

    const onRespawnForTrigger = () => { botInstance._justRespawned = true; };

    // damage 触发器：health 事件里对比上一次血量，下降即置受伤标记（重生回血/吃东西不会触发）
    const onHealthForTrigger = () => {
        const prev = botInstance._lastHealthForTrigger;
        botInstance._lastHealthForTrigger = bot.health;
        if (typeof prev === 'number' && bot.health < prev) botInstance._justDamaged = Date.now();
    };

    bot.on('message', onChatForTrigger);
    bot.on('respawn', onRespawnForTrigger);
    bot.on('health', onHealthForTrigger);

    // ==================== 公开 API ====================
    botInstance.saveScript = (script, silent) => {
        if (!script || !script.name) return { success: false, error: '脚本缺少名称' };
        if (!script.steps || !Array.isArray(script.steps)) return { success: false, error: '脚本缺少 steps' };
        botInstance._scripts[script.name] = script;
        if (!silent) emitLog(`脚本已保存: ${script.name}`);
        return { success: true };
    };

    botInstance.preloadScripts = (scripts) => {
        // 批量灌入用户脚本库（供 run_script 子脚本调用）
        if (!scripts || typeof scripts !== 'object') return;
        botInstance._scripts = {};
        for (const [name, s] of Object.entries(scripts)) {
            if (s && Array.isArray(s.steps)) {
                botInstance._scripts[name] = { ...s, name };
            }
        }
    };

    botInstance.startScript = (name) => {
        // 手动启动的“循环脚本”持久化标记：bot 断线重连后自动续跑（无人值守关键）
        const script = botInstance._scripts[name];
        if (script && script.loop && !botInstance._runningScript) {
            botInstance.config.settings = botInstance.config.settings || {};
            botInstance.config.settings.activeScript = name;
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
        }
        runScript(name);
    };

    botInstance.stopScript = () => {
        if (botInstance._runningScript) {
            const name = botInstance._runningScript.name;
            botInstance._runningScript.aborted = true;
            try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
            try { bot.clearControlStates(); } catch (e) {}
            emitLog(`手动停止脚本: ${name}`);
        }
        // 清除断线自动恢复标记，避免下次重连又把它拉起来
        if (botInstance.config.settings && botInstance.config.settings.activeScript) {
            botInstance.config.settings.activeScript = null;
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
        }
    };

    botInstance.deleteScript = (name) => {
        if (botInstance._runningScript?.name === name) {
            botInstance.stopScript();
        }
        delete botInstance._scripts[name];
        emitLog(`脚本已删除: ${name}`);
        return { success: true };
    };

    botInstance.listScripts = () => {
        return Object.entries(botInstance._scripts).map(([name, script]) => ({
            name,
            trigger: script.trigger || { type: 'manual' },
            loop: !!script.loop,
            server: script.server,
            category: script.category,
            stepCount: (script.steps || []).length,
            running: botInstance._runningScript?.name === name
        }));
    };

    botInstance.getScriptDetail = (name) => botInstance._scripts[name] || null;

    botInstance.getScriptVars = () => ({ ...botInstance._scriptVars });

    // 运行一段临时步骤（地点「到达脚本」复用脚本引擎，含 GUI 等待/寻路/重试全套逻辑）。
    // 与命名脚本共用单运行槽：已有脚本在跑时拒绝，避免并发抢操作。
    botInstance.runSteps = (steps, label) => {
        if (!Array.isArray(steps) || steps.length === 0) return { success: false, error: '没有可执行的步骤' };
        if (botInstance._runningScript) {
            emitLog(`已有脚本在运行 (${botInstance._runningScript.name})，无法${label || '执行'}`);
            return { success: false, error: '已有脚本在运行，请先停止' };
        }
        const name = label || '临时步骤';
        const ctx = { name, aborted: false, callDepth: 0, totalSteps: 0, loopIter: 0 };
        botInstance._runningScript = ctx;
        emitStatus(name, 'running');
        emitLog(`执行: ${name}`);
        (async () => {
            try { await executeSteps(steps, ctx); }
            catch (err) { emitLog(`${name} 异常: ${err.message}`); }
            finally { botInstance._runningScript = null; emitStatus(name, 'stopped'); }
        })();
        return { success: true };
    };

    // ==================== 启动 ====================
    botInstance._triggerTimer = setInterval(() => checkTriggers(), 2000);
    botInstance.timers = botInstance.timers || [];
    botInstance.timers.push(botInstance._triggerTimer);

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        if (botInstance._runningScript) botInstance._runningScript.aborted = true;
        if (botInstance._triggerTimer) clearInterval(botInstance._triggerTimer);
        bot.removeListener('message', onChatForTrigger);
        bot.removeListener('respawn', onRespawnForTrigger);
        bot.removeListener('health', onHealthForTrigger);
    });
};
