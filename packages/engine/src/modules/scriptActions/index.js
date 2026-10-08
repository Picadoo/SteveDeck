// 脚本动作注册表：把各域的动作实现聚合成 { 动作名: (step, ctx) => Promise } 的分发表。
// 每个动作是 (deps, step, ctx) 形式的依赖注入函数——deps 里是 bot/寻路/GUI 等待/日志等运行时能力，
// 单测时传 fake deps 即可覆盖动作逻辑（见 test/scriptActions*.test.cjs）。
//
// deps 约定（script_engine 组装）：
//   bot, botInstance, goals                     —— 运行时对象
//   emitLog, emitVars                           —— 日志/变量推送
//   sleep, pollUntil, waitForChat, waitForGuiReady, gotoWithTimeout —— 等待/寻路助手
//   evalMath, evalCondition                     —— 表达式求值（set_var/wait_until 用）
//   executeAction, executeSteps                 —— 递归回调（goto_location 回放到达脚本、deposit/return_home 内部转 goto_location）
//   MAX_CALL_DEPTH, SPAWN_TIMEOUT, GUI_WAIT_MS  —— 行为常量
const movement = require('./movement');
const chat = require('./chat');
const gui = require('./gui');
const modGui = require('./mod_gui');
const items = require('./items');
const world = require('./world');
const vars = require('./vars');
const control = require('./control');

const ALL = { ...movement, ...chat, ...gui, ...modGui, ...items, ...world, ...vars, ...control };

/** 绑定 deps，返回 { 动作名: (step, ctx) => Promise } 分发表。 */
function buildActions(deps) {
    const out = {};
    for (const [name, fn] of Object.entries(ALL)) {
        out[name] = (step, ctx) => fn(deps, step, ctx);
    }
    return out;
}

module.exports = { buildActions, ALL };
