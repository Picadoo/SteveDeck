/**
 * 脚本引擎 - 双模式（AI JSON / 玩家可视化）
 * 支持：顺序执行、条件判断（含 && || !）、循环、子脚本调用（带参数）、触发器、变量插值
 */
const { goals } = require('mineflayer-pathfinder');
const { findMatchingSlot, slotText } = require('../utils/guiMatch'); // 条件求值 gui_has/gui_slot_has 用
const { buildActions } = require('./scriptActions'); // 动作实现按域拆分（movement/chat/gui/items/world/vars/control）
const { compare, evalBoolExpr } = require('../utils/scriptExpr'); // 布尔表达式求值 + 比较（纯逻辑，见该文件）
const scriptVars = require('../utils/scriptVars'); // 变量插值 + 安全数学求值（纯逻辑，有单测）
const { validatePattern } = require('../utils/safePattern'); // 用户正则的 ReDoS 防护（与消息监听同一道闸）
const { createStepExecutor } = require('../utils/scriptFlow'); // 控制流执行器（纯逻辑依赖注入，有单测）
const { parseCondAtom } = require('../utils/scriptCond'); // 条件叶子解析（纯逻辑，有单测）
const { shouldTrigger: sharedShouldTrigger } = require('../utils/scriptTrigger'); // 触发器判定（时间/状态注入，有单测）
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

    const emitLog = (msg) => botInstance.uiLog(`[脚本] ${msg}`);

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

    const sendVars = () => {
        botInstance._lastVarsEmit = Date.now();
        botInstance.io.to(botInstance._room).to('admin').emit(ServerEvents.SCRIPT_VARS, {
            user: bot.username, ownerId: botInstance.config.ownerId,
            vars: { ...botInstance._scriptVars }
        });
    };
    // 节流 300ms，但不丢尾帧：窗口内的连续变更在窗口结束时补发最终值。
    // 旧实现窗口内直接 return——脚本快速连改变量（set_var×N/循环计数）后若不再变更，
    // 前端变量面板会永远停在第一帧旧值（live-test 端到端抓到的真实 bug）。
    const emitVars = () => {
        const since = Date.now() - botInstance._lastVarsEmit;
        if (since < 300) {
            if (!botInstance._varsEmitTimer) {
                botInstance._varsEmitTimer = setTimeout(() => {
                    botInstance._varsEmitTimer = null;
                    sendVars();
                }, 300 - since);
            }
            return;
        }
        sendVars();
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ==================== 变量插值（实现在 utils/scriptVars.js，有单测） ====================
    const getVar = (name) => botInstance._scriptVars[name];
    const resolveVars = (str) => scriptVars.resolveVars(str, getVar);
    const resolveStep = (step) => scriptVars.resolveStep(step, getVar);
    const evalMath = (expr) => scriptVars.evalMath(expr, getVar);

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
                // API-3：用户正则先过 ReDoS 防护（与消息监听规则同一道闸）——灾难性回溯（如 (a+)+）
                // 会对每条聊天 exec，冻结事件循环拖垮同引擎所有 bot。被拒时降级为纯文本包含匹配。
                const v = validatePattern(pattern);
                if (!v.ok) {
                    emitLog(`wait_chat 正则被拒绝（${v.error}），按纯文本匹配`);
                } else {
                    try { regex = new RegExp(pattern); } catch (_e) { /* fallback to plain */ }
                }
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
        if (!bot?.entity) return false;
        try {
            const resolved = resolveVars(String(cond)).trim();
            if (!resolved) return true;
            return evalExpr(resolved);
        } catch (_e) {
            emitLog(`条件解析失败: ${cond}`);
            return false;
        }
    }

    // 布尔表达式求值（&& || ! 括号）抽到 utils/scriptExpr.js（纯逻辑，可单测）；
    // 叶子求值 evalAtom 仍是本闭包函数（依赖 bot 运行时状态），作为回调传入。
    function evalExpr(s) {
        return evalBoolExpr(s, evalAtom);
    }

    // 叶子条件 = 解析（utils/scriptCond.js，纯逻辑有单测）+ 执行（此处，读 bot 运行时状态）
    function evalAtom(c) {
        const p = parseCondAtom(c);
        if (!p) { emitLog(`未知条件: ${c}`); return false; }
        switch (p.kind) {
            case 'health': return compare(bot.health, p.op, p.value);
            case 'food': return compare(bot.food, p.op, p.value);
            case 'inventory_full':
                return bot.inventory.slots.filter((s, i) => i >= 9 && i <= 44 && !s).length === 0;
            case 'inventory_has':
                return bot.inventory.items().some(item => item.name.toLowerCase().includes(p.name));
            case 'inventory_count': {
                const total = bot.inventory.items()
                    .filter(item => item.name.toLowerCase().includes(p.name))
                    .reduce((sum, item) => sum + item.count, 0);
                return compare(total, p.op, p.value);
            }
            case 'players_nearby': return hasNearbyPlayers();
            case 'no_players_nearby': return !hasNearbyPlayers();
            case 'holding': return !!bot.heldItem?.name.toLowerCase().includes(p.name);
            case 'gui_open': return !!bot.currentWindow;
            case 'gui_closed': return !bot.currentWindow;
            case 'gui_has':
                // 同时搜 name + lore，菜单按钮关键信息常在 lore 里；界面没开 = 条件不成立
                return !!bot.currentWindow && findMatchingSlot(bot.currentWindow.slots, p.name, { matchLore: true }) >= 0;
            case 'gui_slot_has': {
                if (!bot.currentWindow) return false;
                const item = bot.currentWindow.slots[p.slot];
                return !!item && slotText(item, true).includes(p.name);
            }
            case 'alive': return bot.health > 0;
            case 'dead': return bot.health <= 0;
            case 'var': {
                const varVal = botInstance._scriptVars[p.name];
                // 相等/不等按「字符串形态」宽松比较：脚本变量常是字符串 "5" 与字面量 5 混比，
                // 转字符串再 === 既保留原来的宽松意图，又避免 == 的隐式转换陷阱（NaN/null/布尔等）。
                if (p.op === '==' || p.op === '=') return String(varVal) === String(p.value);
                if (p.op === '!=') return String(varVal) !== String(p.value);
                const aNum = Number(varVal), bNum = Number(p.value);
                if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return compare(aNum, p.op, bNum);
                return false;
            }
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

    // ==================== 动作执行器（实现拆到 scriptActions/ 目录，按域分文件） ====================
    // 每个动作是 (deps, step, ctx) 的依赖注入函数，deps 在此组装；递归入口（executeAction/executeSteps）
    // 用箭头包一层 late-binding——goto_location 回放到达脚本、deposit/return_home 内部转 goto_location。
    const actionDeps = {
        bot, botInstance, goals,
        emitLog, emitVars,
        sleep, pollUntil, waitForChat, waitForGuiReady, gotoWithTimeout,
        evalMath, evalCondition,
        executeAction: (step, ctx) => executeAction(step, ctx),
        executeSteps: (steps, ctx, path) => executeSteps(steps, ctx, path),
        MAX_CALL_DEPTH, SPAWN_TIMEOUT, GUI_WAIT_MS,
    };
    const actions = buildActions(actionDeps);
    // 保留分发表入口，协议适配新增动作可更新入口而无需终止正在挂机的脚本。
    botInstance._scriptActions = actions;

    async function executeAction(rawStep, ctx) {
        if (ctx.aborted || !bot.entity) return;
        const step = resolveStep(rawStep);     // 所有 string 字段先解析变量
        const action = step.do;
        const fn = actions[action];
        if (!fn) { emitLog(`未知动作: ${action}`); return; }
        await fn(step, ctx);
    }


    // ==================== 步骤执行器（控制流实现在 utils/scriptFlow.js，语义有单测） ====================
    const executeSteps = createStepExecutor({
        maxCallDepth: MAX_CALL_DEPTH,
        maxTotalSteps: MAX_TOTAL_STEPS,
        botAlive: () => !!bot.entity,
        isBodyBusy: () => !!botInstance.isBodyBusy?.(),
        evalCondition,
        resolveVars,
        getScript: (name) => botInstance._scripts[name],
        getVar: (k) => botInstance._scriptVars[k],
        setVar: (k, v) => { botInstance._scriptVars[k] = v; },
        deleteVar: (k) => { delete botInstance._scriptVars[k]; },
        executeAction: (step, ctx) => executeAction(step, ctx),
        emitLog, emitProgress, emitError, emitVars,
        sleep,
    });

    // ==================== 脚本运行入口 ====================
    async function runScript(name, opts = {}) {
        const script = botInstance._scripts[name];
        if (!script) { emitLog(`脚本不存在: ${name}`); return; }
        if (botInstance._runningScript) {
            emitLog(`已有脚本在运行 (${botInstance._runningScript.name})，请先停止`);
            emitStatus(name, 'rejected', '已有脚本在运行');
            return;
        }

        // urgent：由保命触发器(health_below/damage)启动的脚本，运行期间不再被其它保命触发器抢占
        const ctx = { name, aborted: false, callDepth: 0, totalSteps: 0, loopIter: 0, urgent: !!opts.urgent };
        botInstance._runningScript = ctx;
        emitStatus(name, 'running');
        emitLog(`启动脚本: ${name}`);

        try {
            const doLoop = script.loop === true;
            const loopDelay = (Number(script.loopDelay) || Number(script.delay) || 0) * 1000;

            do {
                // 每轮归零步数：熔断语义是「单轮 10 万步=疑似死循环」。不归零的话 100 步/轮的
                // 24/7 循环挂机脚本累计约 3 小时就被误杀——恰好砸中无人值守核心场景。
                ctx.totalSteps = 0;
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
    // 保命触发器：低血量/受伤是「现在不处理就死」的事件，允许抢占运行中的脚本——
    // 否则挂着农场循环脚本时，「低血量自动回家」这类脚本在最需要它的场景反而永远不触发。
    const URGENT_TRIGGERS = new Set(['health_below', 'damage']);

    // 抢占：置 aborted 后等被中止脚本退出槽位（执行器在步与步之间、寻路/等待循环里都查 aborted，
    // 正常 ≤1 秒），再启动保命脚本。_preempting 防止 2 秒轮询期间重复发起。
    async function preemptThenRun(name) {
        if (botInstance._preempting) return;
        botInstance._preempting = true;
        try {
            const deadline = Date.now() + 5000;
            while (botInstance._runningScript && Date.now() < deadline) await sleep(150);
            if (botInstance._runningScript) {
                emitLog(`当前脚本未能及时停止，保命脚本「${name}」本次放弃`);
                return;
            }
            await runScript(name, { urgent: true });
        } finally {
            botInstance._preempting = false;
        }
    }

    function checkTriggers() {
        if (!bot?.entity) return;
        const running = botInstance._runningScript;
        if (running) {
            // 槽位被占：只评估保命触发器。保命脚本自身运行中不再被抢占（防互相抢占死循环）。
            if (running.urgent || botInstance._preempting) return;
            for (const [name, script] of Object.entries(botInstance._scripts)) {
                if (!script.trigger || !URGENT_TRIGGERS.has(script.trigger.type)) continue;
                if (name === running.name) continue;
                try {
                    if (shouldTrigger(name, script.trigger)) {
                        emitLog(`保命触发器 ${name} (${script.trigger.type}) 抢占当前脚本「${running.name}」`);
                        running.aborted = true;
                        preemptThenRun(name);
                        return;
                    }
                } catch (_e) {}
            }
            return;
        }

        for (const [name, script] of Object.entries(botInstance._scripts)) {
            if (!script.trigger || script.trigger.type === 'manual') continue;
            try {
                if (shouldTrigger(name, script.trigger)) {
                    emitLog(`触发器激活: ${name} (${script.trigger.type})`);
                    runScript(name, { urgent: URGENT_TRIGGERS.has(script.trigger.type) });
                    return;
                }
            } catch (_e) {}
        }
    }

    // 触发器判定实现在 utils/scriptTrigger.js（时间/状态注入，有单测）；这里只提供 bot 探针。
    const triggerProbe = {
        health: () => bot.health,
        food: () => bot.food,
        playersNearby: () => hasNearbyPlayers(),
        hostileNearby: (dist) => Object.values(bot.entities).some(e =>
            e && e !== bot.entity && e.position && /hostile/i.test(String(e.kind || '')) &&
            bot.entity.position.distanceTo(e.position) <= dist
        ),
        inventoryFull: () => bot.inventory.slots.filter((s, i) => i >= 9 && i <= 44 && !s).length === 0,
    };
    function shouldTrigger(name, trigger) {
        return sharedShouldTrigger(trigger, name, { now: new Date(), state: botInstance, probe: triggerProbe });
    }

    const onChatForTrigger = (jsonMsg) => {
        try {
            const raw = jsonMsg.toString().replace(/§./gi, '');
            for (const [_name, script] of Object.entries(botInstance._scripts)) {
                const pat = script.trigger?.pattern || script.trigger?.value; // 编辑器存 value
                if (script.trigger?.type === 'chat_match' && pat) {
                    if (raw.includes(pat)) {
                        botInstance._lastChatTrigger = { pattern: pat, time: Date.now() };
                    }
                }
            }
        } catch (_e) {}
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
        if (!script?.name) return { success: false, error: '脚本缺少名称' };
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
        if (script?.loop && !botInstance._runningScript) {
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
            try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_e) {}
            try { bot.clearControlStates(); } catch (_e) {}
            emitLog(`手动停止脚本: ${name}`);
        }
        // 清除断线自动恢复标记，避免下次重连又把它拉起来
        if (botInstance.config.settings?.activeScript) {
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
        if (botInstance._varsEmitTimer) { clearTimeout(botInstance._varsEmitTimer); botInstance._varsEmitTimer = null; }
        bot.removeListener('message', onChatForTrigger);
        bot.removeListener('respawn', onRespawnForTrigger);
        bot.removeListener('health', onHealthForTrigger);
    });
};
