// 脚本动作：聊天/日志类（chat/cmd/whisper/log/wait_chat）
// 所有外发消息统一过 isChatBlocked 黑名单（与快捷指令/地点前置同一道闸）。
const { isChatBlocked } = require('../../utils/chatSafety');

module.exports = {
    async chat(deps, step, _ctx) {
        const { bot, emitLog } = deps;
        const msg = step.msg || '';
        if (isChatBlocked(msg)) { emitLog('消息被安全策略拦截'); return; }
        emitLog(`发送: ${msg}`);
        bot.chat(msg);
    },

    async cmd(deps, step, _ctx) {
        const { bot, emitLog } = deps;
        const text = step.text || step.cmd || '';
        if (!text) return;
        const final = text.startsWith('/') ? text : `/${text}`;
        if (isChatBlocked(final)) { emitLog(`命令被安全策略拦截: ${final}`); return; }
        emitLog(`命令: ${final}`);
        bot.chat(final);
    },

    async whisper(deps, step, _ctx) {
        const { bot, emitLog } = deps;
        const target = step.target || step.player;
        const msg = step.msg || '';
        if (!target || !msg) return;
        const final = `/msg ${target} ${msg}`;
        if (isChatBlocked(final)) { emitLog('私聊被安全策略拦截'); return; }
        emitLog(`私聊 ${target}: ${msg}`);
        bot.chat(final);
    },

    async log(deps, step, _ctx) {
        deps.emitLog(step.msg || '');
    },

    async wait_chat(deps, step, _ctx2) {
        const { botInstance, emitLog, emitVars, waitForChat } = deps;
        const pattern = step.pattern || step.msg || '';
        const timeout = (Number(step.timeout) || 30) * 1000;
        const isRegex = step.regex === true || step.regex === 'true';
        emitLog(`等待聊天${isRegex ? '(regex)' : ''}: ${pattern}`);
        const matched = await waitForChat(pattern, isRegex, timeout, _ctx2);
        if (!matched) { emitLog('等待聊天超时'); return; }
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
    },
};
