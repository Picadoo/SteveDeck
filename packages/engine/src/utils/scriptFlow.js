// 脚本控制流执行器（从 script_engine.js 抽出，依赖注入化）：
// 顺序执行、if/then/else、repeat、while、break_if、run_script（深度护栏 + 参数注入还原）、
// 步骤级 cond 守卫、失败重试、bodyBusy 让位、总步数熔断、aborted 传播。
// 这是脚本引擎的「语义核心」——所有运行时依赖经 env 注入，语义规则全部可单测（scriptFlow.test.cjs）。
//
// 语义备忘（测试固化，改前三思）：
// - break_if：跳出「最近的步骤序列」。在 repeat/while 子步骤里效果是结束本轮迭代（continue 语义），
//   循环本身继续；要跳出循环请用 while 的 cond。
// - 控制块（if/repeat/while/break_if/run_script 之外的叶子动作）才吃 step.cond 守卫；
//   控制块自身的条件走各自字段（if.cond / while.cond）。
// - run_script 的参数注入在子脚本结束后还原（原值 undefined 则删除），aborted / totalSteps 向外传播。

/**
 * @param {object} env 运行时依赖
 *   maxCallDepth / maxTotalSteps：护栏上限
 *   botAlive(): boolean —— bot 实体是否存活
 *   isBodyBusy(): boolean —— 身体协调软锁（auto_use 用东西时让位）
 *   evalCondition(cond): boolean
 *   resolveVars(str): string
 *   getScript(name): object | undefined
 *   getVar(k) / setVar(k, v) / deleteVar(k)：脚本变量表访问
 *   executeAction(step, ctx): Promise —— 叶子动作执行器
 *   emitLog(msg) / emitProgress(path, action, loopIter) / emitError(path, action, message) / emitVars()
 *   sleep(ms): Promise
 * @returns {(steps: any[], ctx: object, basePath?: any[]) => Promise<void>}
 */
function createStepExecutor(env) {
    async function executeSteps(steps, ctx, basePath = []) {
        if (!Array.isArray(steps)) return;

        for (let i = 0; i < steps.length; i++) {
            if (ctx.aborted || !env.botAlive()) return;
            // auto_use 让位：自动使用正在用东西(吃/喝 ~1.6s)时，脚本在步与步之间等它落下，避免互相打断
            while (env.isBodyBusy() && !ctx.aborted && env.botAlive()) {
                await env.sleep(50);
            }
            if (ctx.aborted || !env.botAlive()) return;
            ctx.totalSteps = (ctx.totalSteps || 0) + 1;
            if (ctx.totalSteps > env.maxTotalSteps) {
                env.emitLog(`总执行步数超过 ${env.maxTotalSteps}，强制终止（疑似死循环）`);
                ctx.aborted = true;
                return;
            }

            const step = steps[i];
            if (!step?.do) continue;
            if (step.disabled) continue;        // 编辑器禁用的步骤跳过
            if (step.do === 'note') continue;   // 注释块不执行
            const stepPath = [...basePath, i];
            const pathStr = stepPath.join('-');

            try {
                env.emitProgress(pathStr, step.do, ctx.loopIter);

                if (step.do === 'if') {
                    if (env.evalCondition(step.cond)) {
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
                        env.emitLog('已阻止空的无限重复块');
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
                        await env.sleep(0);
                    }
                    continue;
                }

                if (step.do === 'while') {
                    const subSteps = step.steps || [];
                    const maxIter = Number(step.max) || 10000;
                    let count = 0;
                    while (!ctx.aborted && count < maxIter) {
                        if (!env.evalCondition(step.cond)) break;
                        const prevIter = ctx.loopIter;
                        ctx.loopIter = count + 1;
                        await executeSteps(subSteps, ctx, [...stepPath, 'steps']);
                        ctx.loopIter = prevIter;
                        count++;
                        await env.sleep(0);
                    }
                    continue;
                }

                if (step.do === 'break_if') {
                    if (env.evalCondition(step.cond)) {
                        env.emitLog(`break_if 触发: ${step.cond}`);
                        return;
                    }
                    continue;
                }

                if (step.cond && !env.evalCondition(step.cond)) continue;

                if (step.do === 'run_script') {
                    const scriptName = env.resolveVars(String(step.name || ''));
                    if (!scriptName) { env.emitLog('run_script 缺少 name'); continue; }
                    if (ctx.callDepth >= env.maxCallDepth) {
                        env.emitLog(`子脚本嵌套超过 ${env.maxCallDepth} 层`); continue;
                    }
                    const subScript = env.getScript(scriptName);
                    if (!subScript) { env.emitLog(`子脚本不存在: ${scriptName}`); continue; }

                    // 参数注入：保存原值，调用后还原
                    const savedVars = {};
                    if (step.args && typeof step.args === 'object') {
                        for (const [k, v] of Object.entries(step.args)) {
                            savedVars[k] = env.getVar(k);
                            const resolved = typeof v === 'string' ? env.resolveVars(v) : v;
                            env.setVar(k, resolved);
                        }
                        env.emitVars();
                    }

                    env.emitLog(`调用子脚本: ${scriptName}`);
                    const subCtx = { ...ctx, callDepth: ctx.callDepth + 1 };
                    try {
                        await executeSteps(subScript.steps || [], subCtx, [...stepPath, 'sub']);
                    } finally {
                        for (const [k, v] of Object.entries(savedVars)) {
                            if (v === undefined) env.deleteVar(k);
                            else env.setVar(k, v);
                        }
                        if (Object.keys(savedVars).length > 0) env.emitVars();
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
                        await env.executeAction(step, ctx);
                        break;
                    } catch (actErr) {
                        if (attempt >= maxRetry || ctx.aborted) throw actErr;
                        attempt++;
                        env.emitLog(`↻ ${step.do} 失败，第 ${attempt}/${maxRetry} 次重试: ${actErr.message}`);
                        await env.sleep(retryDelay);
                    }
                }

            } catch (err) {
                env.emitLog(`步骤 ${i + 1} (${step.do}) 出错: ${err.message}`);
                env.emitError(pathStr, step.do, err.message);
            }
        }
    }

    return executeSteps;
}

module.exports = { createStepExecutor };
