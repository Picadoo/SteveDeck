// 脚本动作：移动/朝向类（goto/goto_location/goto_nearest/look/look_at/return_home/hold/sneak/jump）
// 依赖注入形式：每个动作 (deps, step, ctx)，deps 由 script_engine 组装（bot/寻路助手/日志等）。
// step 进来前已完成变量插值（resolveStep 在 executeAction 外层统一做）。
const { isChatBlocked } = require('../../utils/chatSafety');
const waitForTeleport = require('../../utils/waitForTeleport');

// look_at / goto_nearest 共用的目标选择：留空=最近玩家；mob/entity=最近生物；其它=名字关键词
function findNamedEntity(bot, t) {
    if (!t || t === 'player') {
        return bot.nearestEntity((e) => e.type === 'player' && e.username !== bot.username);
    }
    if (t === 'mob' || t === 'entity') {
        return bot.nearestEntity(
            (e) => e !== bot.entity && e.type !== 'player' && e.type !== 'object' && e.type !== 'item',
        );
    }
    return bot.nearestEntity((e) => {
        if (e === bot.entity) return false;
        const name = (e.customName || e.username || e.name || '').toString().toLowerCase();
        return name.includes(t);
    });
}

module.exports = {
    async goto(deps, step, _ctx) {
        const { bot, goals, emitLog, gotoWithTimeout } = deps;
        if (step.target) {
            const t = String(step.target);
            let entity;
            if (t.startsWith('player:')) {
                const name = t.slice(7);
                entity = bot.players[name]?.entity;
            } else if (t.startsWith('entity:')) {
                const name = t.slice(7).toLowerCase();
                entity = bot.nearestEntity((e) => (e.name || '').toLowerCase().includes(name));
            }
            if (!entity) throw new Error(`找不到目标: ${t}`);
            emitLog(`走向 ${t}`);
            await gotoWithTimeout(new goals.GoalFollow(entity, parseFloat(step.distance) || 2), Number(step.timeout) * 1000);
            return;
        }
        const x = Number(step.x), y = Number(step.y), z = Number(step.z);
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) throw new Error('goto 坐标无效');
        emitLog(`走到 (${x}, ${y}, ${z})`);
        const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
        await gotoWithTimeout(goal, Number(step.timeout) * 1000);
    },

    async goto_location(deps, step, ctx) {
        // 完整复用地点的「到达方式」：到达脚本 > 前置指令(等真实传送) > 坐标寻路。
        const { bot, botInstance, goals, emitLog, gotoWithTimeout, executeSteps, MAX_CALL_DEPTH } = deps;
        const locName = step.name || step.location || '';
        const loc = (botInstance.savedLocations || []).find((l) => l.name === locName || l.id === locName);
        if (!loc) { emitLog(`未找到保存的地点: ${locName}`); return; }

        // 到达脚本优先：在当前脚本上下文里回放（共享中止标记/总步数熔断）。
        // 与 run_script 共用调用深度护栏——到达脚本里又写 goto_location 自身会无限递归。
        if (Array.isArray(loc.steps) && loc.steps.length) {
            if (ctx.callDepth >= MAX_CALL_DEPTH) {
                emitLog(`到达脚本嵌套超过 ${MAX_CALL_DEPTH} 层，跳过「${loc.name}」`);
                return;
            }
            emitLog(`前往「${loc.name}」：回放到达脚本（${loc.steps.length} 步）`);
            // abort 双向直通根上下文（与 scriptFlow 的 run_script 同款修复）：浅拷贝副本会
            // 让「停止/保命抢占」在到达脚本回放期间失效。
            const subCtx = { ...ctx, callDepth: ctx.callDepth + 1 };
            Object.defineProperty(subCtx, 'aborted', {
                get: () => ctx.aborted,
                set: (v) => { ctx.aborted = v; },
            });
            await executeSteps(loc.steps, subCtx, [`loc:${loc.name}`]);
            ctx.totalSteps = subCtx.totalSteps;
            return;
        }

        // 跨维度且无前置指令：寻路注定超时，明确报错（throw 让 retry/错误推送接得住）
        const curDim = bot.game?.dimension;
        if (!loc.command && loc.dimension && curDim && loc.dimension !== curDim) {
            throw new Error(`「${loc.name}」在 ${loc.dimension}，当前在 ${curDim}——请为该地点配置前置指令或到达脚本`);
        }

        if (loc.command) {
            if (isChatBlocked(loc.command)) { emitLog('地点前置指令被安全过滤拦截'); return; }
            emitLog(`前置指令: ${loc.command}（等待传送…）`);
            bot.chat(loc.command);
            const moved = await waitForTeleport(bot, { timeoutMs: 8000 });
            if (ctx.aborted || !bot.entity) return; // 传送等待期间停止/断连
            emitLog(moved ? '传送完成，继续寻路' : '8 秒内未检测到传送（可能已在附近），按坐标寻路');
        }

        emitLog(`前往地点「${loc.name}」(${loc.x}, ${loc.y}, ${loc.z})`);
        const locGoal = new goals.GoalBlock(loc.x, loc.y, loc.z);
        await gotoWithTimeout(locGoal, Number(step.timeout) * 1000);
    },

    async goto_nearest(deps, step, _ctx) {
        // 走向最近的玩家/生物（target 同 look_at）；distance=停下的距离（默认 2）。
        const { bot, goals, emitLog, gotoWithTimeout } = deps;
        const t = String(step.target || '').toLowerCase().trim();
        const entity = findNamedEntity(bot, t);
        if (!entity) { emitLog(`没有可前往的目标: ${t || '玩家'}`); return; }
        emitLog(`走向 ${entity.username || entity.name || entity.id}`);
        await gotoWithTimeout(new goals.GoalFollow(entity, parseFloat(step.distance) || 2), Number(step.timeout) * 1000);
    },

    async look(deps, step, _ctx) {
        const { bot } = deps;
        const x = Number(step.x), y = Number(step.y), z = Number(step.z);
        await bot.lookAt({ x, y, z }, true);
    },

    async look_at(deps, step, _ctx) {
        // 看向最近的玩家/生物（通用版「look」，不必手填坐标）。
        const { bot, emitLog } = deps;
        const t = String(step.target || '').toLowerCase().trim();
        const entity = findNamedEntity(bot, t);
        if (!entity) { emitLog(`没有可看向的目标: ${t || '玩家'}`); return; }
        emitLog(`看向 ${entity.username || entity.name || entity.id}`);
        await bot.lookAt(entity.position.offset(0, (entity.height || 1.6) * 0.85, 0), true);
    },

    async return_home(deps, step, ctx) {
        // 归家点一等公民化：优先用名为「家/home」的保存地点——复用 goto_location 的
        // 完整到达链（到达脚本 > 前置指令+传送检测 > 坐标寻路），跨世界也能回。
        // 没存过「家」再退回追怪模块的返回点（兼容旧用法：开追怪时自动记的位置）。
        const { botInstance, goals, emitLog, gotoWithTimeout, executeAction } = deps;
        const homeLoc = (botInstance.savedLocations || []).find(
            (l) => /^(家|home)$/i.test(String(l.name || '').trim()),
        );
        if (homeLoc) {
            emitLog(`回家 → 保存地点「${homeLoc.name}」`);
            await executeAction({ ...step, do: 'goto_location', name: homeLoc.name }, ctx);
            return;
        }
        const rp = botInstance.mobHunterTask?.returnPoint;
        if (!rp) { emitLog('未设置归家点：保存一个名为「家」的地点（推荐），或开启追怪模块'); return; }
        emitLog(`回家 (${Math.floor(rp.x)}, ${Math.floor(rp.y)}, ${Math.floor(rp.z)})`);
        // 统一走带超时的寻路助手：杜绝不可达归家点无限挂起 + 孤立 goto 的 unhandled reject(MODA-3)
        await gotoWithTimeout(new goals.GoalBlock(Math.floor(rp.x), Math.floor(rp.y), Math.floor(rp.z)));
    },

    async hold(deps, step, ctx) {
        // 持续按住某个控制键 N 秒（如潜行过桥、长按前进走进传送门）。结束/中止时务必松开。
        const { bot, emitLog, sleep } = deps;
        const allowed = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
        const key = String(step.key || 'forward').toLowerCase();
        if (!allowed.includes(key)) { emitLog(`不支持的控制键: ${key}`); return; }
        const ms = (Number(step.s) || Number(step.seconds) || 1) * 1000;
        emitLog(`按住 ${key} ${ms / 1000}秒`);
        try {
            bot.setControlState(key, true);
            const end = Date.now() + ms;
            while (Date.now() < end && !ctx.aborted && bot.entity) {
                await sleep(Math.min(200, end - Date.now()));
            }
        } finally {
            try { bot.setControlState(key, false); } catch (_e) { /* bot 可能已销毁 */ }
        }
    },

    async sneak(deps, step, _ctx) {
        const { bot, emitLog } = deps;
        const active = step.active !== false && step.active !== 'false';
        emitLog(active ? '开始潜行' : '停止潜行');
        bot.setControlState('sneak', active);
    },

    async jump(deps, _step, _ctx) {
        const { bot, emitLog, sleep } = deps;
        emitLog('跳跃');
        bot.setControlState('jump', true);
        await sleep(100);
        bot.setControlState('jump', false);
    },
};
