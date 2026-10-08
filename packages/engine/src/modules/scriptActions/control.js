// 脚本动作：控制/等待类（wait/wait_spawn/wait_until/stop）
module.exports = {
    async wait(deps, step, ctx) {
        const { emitLog, sleep } = deps;
        const ms = (Number(step.s) || Number(step.seconds) || 1) * 1000;
        emitLog(`等待 ${ms / 1000}秒`);
        const end = Date.now() + ms;
        while (Date.now() < end && !ctx.aborted) {
            await sleep(Math.min(500, end - Date.now()));
        }
    },

    async wait_spawn(deps, step, _ctx) {
        const { bot, emitLog, sleep, SPAWN_TIMEOUT } = deps;
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
    },

    async wait_until(deps, step, ctx) {
        const { emitLog, pollUntil, evalCondition } = deps;
        const cond = step.cond || step.condition;
        const timeout = (Number(step.timeout) || 60) * 1000;
        emitLog(`等待条件: ${cond}`);
        const ok = await pollUntil(() => evalCondition(cond), timeout, ctx);
        if (!ok) emitLog(`条件等待超时: ${cond}`);
    },

    async stop(deps, _step, ctx) {
        deps.emitLog('脚本主动停止');
        ctx.aborted = true;
    },
};
