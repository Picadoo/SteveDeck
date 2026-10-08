// 脚本变量插值 + 安全数学求值（从 script_engine.js 抽出的纯逻辑，便于单测）。
// 变量存取经 getVar 回调注入——引擎侧变量表挂在 botInstance._scriptVars 上。

/** {name} 插值：未定义的变量原样保留（用户能一眼看出没赋值，而不是悄悄变空串）。 */
function resolveVars(str, getVar) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (_, name) => {
        const v = getVar(name);
        return v !== undefined ? String(v) : `{${name}}`;
    });
}

/** 对步骤对象的所有 string 字段做变量插值（浅层；数组/嵌套对象原样透传）。 */
function resolveStep(step, getVar) {
    const out = {};
    for (const k of Object.keys(step)) {
        const v = step[k];
        if (typeof v === 'string') out[k] = resolveVars(v, getVar);
        else out[k] = v;
    }
    return out;
}

/**
 * 安全数学表达式：插值后只允许数字/运算符/括号/空白，白名单不过就原样返回（不求值）。
 * 白名单杜绝任意代码注入；求值失败（语法错）也回退原串——set_var 语义是"尽力算，算不动当字符串"。
 */
function evalMath(expr, getVar) {
    const resolved = resolveVars(String(expr), getVar);
    if (!/^[\d\s+\-*/()%.]+$/.test(resolved)) return resolved;
    try {
        return Function(`"use strict"; return (${resolved})`)();
    } catch { return resolved; }
}

module.exports = { resolveVars, resolveStep, evalMath };
