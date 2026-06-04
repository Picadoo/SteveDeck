/**
 * 脚本引擎 - 双模式（AI JSON / 玩家可视化）
 * 支持：顺序执行、条件判断（含 && || !）、循环、子脚本调用（带参数）、触发器、变量插值
 */
const logger = require('../utils/logger');
const { goals } = require('mineflayer-pathfinder');
const { isChatBlocked } = require('../utils/chatSafety');
const { findMatchingSlot, slotText } = require('../utils/guiMatch');

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
        botInstance.io.to(botInstance._room).to('admin').emit('script_status', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            name, status, detail
        });
    };

    const emitProgress = (path, action, loopIter) => {
        botInstance.io.to(botInstance._room).to('admin').emit('script_progress', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            path, action, loopIter
        });
    };

    const emitError = (path, action, message) => {
        botInstance.io.to(botInstance._room).to('admin').emit('script_error', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            path, action, message
        });
    };

    const emitVars = () => {
        const now = Date.now();
        if (now - botInstance._lastVarsEmit < 300) return; // 节流 300ms
        botInstance._lastVarsEmit = now;
        botInstance.io.to(botInstance._room).to('admin').emit('script_vars', {
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
                const raw = jsonMsg.toString().replace(/§[0-9a-fk-orx]/gi, '');
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
                    await bot.pathfinder.goto(new goals.GoalFollow(entity, parseFloat(step.distance) || 2));
                    break;
                }
                const x = Number(step.x), y = Number(step.y), z = Number(step.z);
                if (isNaN(x) || isNaN(y) || isNaN(z)) throw new Error('goto 坐标无效');
                emitLog(`走到 (${x}, ${y}, ${z})`);
                const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
                const promise = bot.pathfinder.goto(goal);
                const timeout = sleep(Number(step.timeout) * 1000 || GOTO_TIMEOUT)
                    .then(() => { throw new Error('寻路超时'); });
                await Promise.race([promise, timeout]);
                break;
            }

            case 'goto_location': {
                const locName = step.name || step.location || '';
                const loc = (botInstance.savedLocations || []).find(l => l.name === locName);
                if (!loc) { emitLog(`未找到保存的地点: ${locName}`); break; }
                emitLog(`前往地点「${locName}」(${loc.x}, ${loc.y}, ${loc.z})`);
                const locGoal = new goals.GoalBlock(loc.x, loc.y, loc.z);
                const locPromise = bot.pathfinder.goto(locGoal);
                const locTimeout = sleep(Number(step.timeout) * 1000 || GOTO_TIMEOUT)
                    .then(() => { throw new Error('寻路超时'); });
                await Promise.race([locPromise, locTimeout]);
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
                        .replace(/§[0-9a-fk-orx]/gi, '').toLowerCase();
                    return name.includes(String(targetName).toLowerCase()) || String(e.id) === String(targetName);
                });
                if (!entity) throw new Error(`未找到实体: ${targetName}`);
                await bot.pathfinder.goto(new goals.GoalFollow(entity, 2));
                await bot.lookAt(entity.position.offset(0, (entity.height || 1.8) * 0.8, 0), true);
                bot.swingArm('right');
                if (bot.activateEntity) {
                    await bot.activateEntity(entity);
                } else if (bot.activateEntityAt) {
                    await bot.activateEntityAt(entity, entity.position);
                }
                await sleep(GUI_WAIT_MS);
                if (bot.currentWindow) await waitForGuiReady(ctx);
                break;
            }

            case 'click_slot': {
                const slot = Number(step.slot);
                const button = Number(step.button) || 0;
                if (!bot.currentWindow) { emitLog(`没有打开界面，跳过`); break; }
                await waitForGuiReady(ctx);
                emitLog(`点击槽位 ${slot}`);
                await bot.clickWindow(slot, button, 0);
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
                const itemName = String(step.item || '').toLowerCase();
                const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(itemName));
                if (item) {
                    emitLog(`装备: ${item.name}`);
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
                await bot.pathfinder.goto(new goals.GoalBlock(
                    Math.floor(rp.x), Math.floor(rp.y), Math.floor(rp.z)
                ));
                break;
            }

            case 'wait_gui_item': {
                const itemName = String(step.item || '').toLowerCase();
                const timeout = (Number(step.timeout) || 10) * 1000;
                emitLog(`等待界面物品: ${step.item}`);
                const found = await pollUntil(() => {
                    if (!bot.currentWindow) return false;
                    return bot.currentWindow.slots.some(s =>
                        s && (s.name || '').toLowerCase().includes(itemName)
                    );
                }, timeout, ctx);
                if (!found) emitLog(`超时未找到: ${step.item}`);
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

            default:
                emitLog(`未知动作: ${action}`);
        }
    }

    // ==================== 步骤执行器（递归） ====================
    async function executeSteps(steps, ctx, basePath = []) {
        if (!Array.isArray(steps)) return;

        for (let i = 0; i < steps.length; i++) {
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
            const raw = jsonMsg.toString().replace(/§[0-9a-fk-orx]/gi, '');
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

    bot.on('message', onChatForTrigger);
    bot.on('respawn', onRespawnForTrigger);

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
            stepCount: (script.steps || []).length,
            running: botInstance._runningScript?.name === name
        }));
    };

    botInstance.getScriptDetail = (name) => botInstance._scripts[name] || null;

    botInstance.getScriptVars = () => ({ ...botInstance._scriptVars });

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
    });
};
