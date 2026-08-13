/* 脚本控制流语义单测：if/repeat/while/break_if/run_script/重试/熔断——
   这是脚本引擎的语义核心，此前埋在 1300 行闭包里无法回归，改坏一个分支所有用户脚本遭殃。 */
const test = require('node:test');
const assert = require('node:assert');
const { createStepExecutor } = require('../src/utils/scriptFlow.js');

function makeEnv(overrides = {}) {
  const log = [];
  const actions = [];
  const vars = {};
  const env = {
    maxCallDepth: 5,
    maxTotalSteps: 1000,
    botAlive: () => true,
    isBodyBusy: () => false,
    evalCondition: (c) => c === 'always' || c === true || c === undefined || c === '',
    resolveVars: (s) => s,
    getScript: () => undefined,
    getVar: (k) => vars[k],
    setVar: (k, v) => { vars[k] = v; },
    deleteVar: (k) => { delete vars[k]; },
    executeAction: async (step) => { actions.push(step.tag || step.do); },
    emitLog: (m) => log.push(m),
    emitProgress: () => {},
    emitError: (_p, a, m) => log.push(`ERR ${a}: ${m}`),
    emitVars: () => {},
    sleep: async () => {},
    ...overrides,
  };
  return { env, log, actions, vars, run: createStepExecutor(env) };
}
const ctx0 = (extra = {}) => ({ name: 't', aborted: false, callDepth: 0, totalSteps: 0, loopIter: 0, ...extra });

test('顺序执行；disabled/note/无 do 的步骤跳过', async () => {
  const { run, actions } = makeEnv();
  await run([
    { do: 'log', tag: 'a' },
    { do: 'log', tag: 'x', disabled: true },
    { do: 'note', tag: 'n' },
    { nothing: true },
    { do: 'log', tag: 'b' },
  ], ctx0());
  assert.deepEqual(actions, ['a', 'b']);
});

test('if：cond 真走 then，假走 else', async () => {
  const { run, actions } = makeEnv({ evalCondition: (c) => c === 'T' });
  await run([
    // biome-ignore lint/suspicious/noThenProperty: then 是脚本 DSL 的既有分支字段名（if 步骤），非 thenable
    { do: 'if', cond: 'T', then: [{ do: 'log', tag: 'then1' }], else: [{ do: 'log', tag: 'else1' }] },
    // biome-ignore lint/suspicious/noThenProperty: 同上
    { do: 'if', cond: 'F', then: [{ do: 'log', tag: 'then2' }], else: [{ do: 'log', tag: 'else2' }] },
  ], ctx0());
  assert.deepEqual(actions, ['then1', 'else2']);
});

test('repeat：有限次数循环，loopIter 恢复', async () => {
  const { run, actions } = makeEnv();
  const ctx = ctx0();
  await run([{ do: 'repeat', times: 3, steps: [{ do: 'log', tag: 'r' }] }, { do: 'log', tag: 'after' }], ctx);
  assert.deepEqual(actions, ['r', 'r', 'r', 'after']);
  assert.equal(ctx.loopIter, 0); // 循环结束后恢复外层迭代计数
});

test('repeat：空的无限重复块被拦截，不进入死循环', async () => {
  const { run, log } = makeEnv();
  await run([{ do: 'repeat', times: 0, steps: [] }], ctx0());
  assert.ok(log.some((m) => m.includes('已阻止空的无限重复块')));
});

test('repeat：无限循环由 maxTotalSteps 熔断并置 aborted', async () => {
  const { run, log } = makeEnv({ maxTotalSteps: 25 });
  const ctx = ctx0();
  await run([{ do: 'repeat', times: 0, steps: [{ do: 'log', tag: 'x' }] }], ctx);
  assert.equal(ctx.aborted, true);
  assert.ok(log.some((m) => m.includes('强制终止')));
});

test('while：条件变假即停；max 上限兜底', async () => {
  let n = 0;
  const env2 = makeEnv({
    evalCondition: () => n < 3,
    executeAction: async () => { n++; env2.actions.push('w'); },
  });
  await env2.run([{ do: 'while', cond: 'any', steps: [{ do: 'log' }] }], ctx0());
  assert.equal(env2.actions.length, 3); // 条件由动作推进，第 4 轮前变假即停

  const env3 = makeEnv({ evalCondition: () => true, maxTotalSteps: 100000 });
  await env3.run([{ do: 'while', cond: 'always', max: 5, steps: [{ do: 'log', tag: 'm' }] }], ctx0());
  assert.equal(env3.actions.length, 5); // 条件恒真时由 max 上限兜底
});

test('break_if：跳出最近的步骤序列；在 repeat 子步骤里是 continue 语义（循环继续）', async () => {
  // 顶层：break_if 之后的步骤不执行
  const { run, actions } = makeEnv({ evalCondition: (c) => c === 'T' });
  await run([
    { do: 'log', tag: 'a' },
    { do: 'break_if', cond: 'T' },
    { do: 'log', tag: 'never' },
  ], ctx0());
  assert.deepEqual(actions, ['a']);

  // repeat 内：break_if 只结束本轮迭代，循环本身跑满次数（语义固化——要跳出循环用 while.cond）
  const env2 = makeEnv({ evalCondition: (c) => c === 'T' });
  await env2.run([
    { do: 'repeat', times: 3, steps: [
      { do: 'log', tag: 'head' },
      { do: 'break_if', cond: 'T' },
      { do: 'log', tag: 'tail' },
    ] },
  ], ctx0());
  assert.deepEqual(env2.actions, ['head', 'head', 'head']); // tail 永不执行，head 执行满 3 轮
});

test('叶子动作的 cond 守卫：不满足则跳过该步', async () => {
  const { run, actions } = makeEnv({ evalCondition: (c) => c === 'T' });
  await run([
    { do: 'log', tag: 'a', cond: 'T' },
    { do: 'log', tag: 'b', cond: 'F' },
    { do: 'log', tag: 'c' },
  ], ctx0());
  assert.deepEqual(actions, ['a', 'c']);
});

test('run_script：子脚本执行 + 参数注入并在结束后还原（原值 undefined 则删除）', async () => {
  const scripts = { sub: { steps: [{ do: 'log', tag: 'sub1' }] } };
  const { run, actions, vars, env } = makeEnv({ getScript: (n) => scripts[n] });
  env.setVar('kept', 'old');
  await run([
    { do: 'run_script', name: 'sub', args: { kept: 'injected', fresh: 'new' } },
    { do: 'log', tag: 'after' },
  ], ctx0());
  assert.deepEqual(actions, ['sub1', 'after']);
  assert.equal(vars.kept, 'old');          // 有原值 → 还原
  assert.equal('fresh' in vars, false);    // 原值 undefined → 删除
});

test('run_script：嵌套深度超过 maxCallDepth 被拦截', async () => {
  const scripts = { loop: { steps: [{ do: 'run_script', name: 'loop' }, { do: 'log', tag: 'body' }] } };
  const { run, actions, log } = makeEnv({ getScript: (n) => scripts[n], maxCallDepth: 3 });
  await run([{ do: 'run_script', name: 'loop' }], ctx0());
  assert.ok(log.some((m) => m.includes('嵌套超过 3 层')));
  assert.equal(actions.length, 3); // 每层递归后各执行一次 body（深度 1/2/3）
});

test('run_script：子脚本 aborted 向外传播，totalSteps 跨层累计', async () => {
  const scripts = { sub: { steps: [{ do: 'log', tag: 's1' }, { do: 'stopper' }, { do: 'log', tag: 's2' }] } };
  const { run, actions } = makeEnv({
    getScript: (n) => scripts[n],
    executeAction: async (step, ctx) => {
      if (step.do === 'stopper') { ctx.aborted = true; return; }
      actionsPush(step);
    },
  });
  function actionsPush(step) { actions.push(step.tag || step.do); }
  const ctx = ctx0();
  await run([{ do: 'run_script', name: 'sub' }, { do: 'log', tag: 'never' }], ctx);
  assert.deepEqual(actions, ['s1']);
  assert.equal(ctx.aborted, true);
  assert.ok(ctx.totalSteps >= 3); // 外层 1 步 + 子脚本 2 步（s2 未执行不计）
});

test('retry：失败自动重试到成功；耗尽后经 emitError 上报且不中断后续步骤', async () => {
  let failures = 2;
  const { run, actions, log } = makeEnv({
    executeAction: async (step) => {
      if (step.do === 'flaky' && failures > 0) { failures--; throw new Error('boom'); }
      actions.push(step.tag || step.do);
    },
  });
  await run([{ do: 'flaky', tag: 'ok', retry: 3 }, { do: 'log', tag: 'next' }], ctx0());
  assert.deepEqual(actions, ['ok', 'next']);
  assert.equal(log.filter((m) => m.includes('重试')).length, 2);

  // 重试耗尽：错误进 emitError，脚本继续走下一步（与既有行为一致）
  const env2 = makeEnv({
    executeAction: async (step) => {
      if (step.do === 'dead') throw new Error('always');
      env2.actions.push(step.tag || step.do);
    },
  });
  await env2.run([{ do: 'dead', retry: 1 }, { do: 'log', tag: 'go' }], ctx0());
  assert.ok(env2.log.some((m) => m.startsWith('ERR dead')));
  assert.deepEqual(env2.actions, ['go']);
});

test('bodyBusy 让位：忙时等待，空闲后继续执行', async () => {
  let busyTicks = 3;
  let sleeps = 0;
  const { run, actions } = makeEnv({
    isBodyBusy: () => busyTicks-- > 0,
    sleep: async () => { sleeps++; },
  });
  await run([{ do: 'log', tag: 'a' }], ctx0());
  assert.deepEqual(actions, ['a']);
  assert.ok(sleeps >= 3);
});

test('aborted / bot 死亡：立即停止不再执行', async () => {
  const { run, actions } = makeEnv();
  const ctx = ctx0({ aborted: true });
  await run([{ do: 'log', tag: 'x' }], ctx);
  assert.deepEqual(actions, []);

  const env2 = makeEnv({ botAlive: () => false });
  await env2.run([{ do: 'log', tag: 'x' }], ctx0());
  assert.deepEqual(env2.actions, []);
});
