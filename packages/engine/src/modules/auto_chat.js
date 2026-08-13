// 定时广告（循环喊话）：固定间隔轮播/随机发送配置的消息——摆摊叫卖、公会招募、公告循环。
// 与「定时」页互补：那边是每天定点发一次指令，这边是持续循环。
// 安全：消息过 isChatBlocked 黑名单；间隔下限 10s（更快就是刷屏，多数服会禁言/踢出）。
const { isChatBlocked } = require('../utils/chatSafety');

const MIN_INTERVAL_SEC = 10;

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const emitLog = (msg) => botInstance.uiLog(msg);

    const task = (botInstance.autoChatTask = {
        active: false,
        messages: [],
        intervalSec: 60,
        random: false,
        timer: null,
        idx: 0,
        sent: 0,
        lastMsg: null,
        nextAt: 0,
    });

    const sendNext = () => {
        if (!task.active || !bot?.entity) return;
        const list = task.messages.filter((m) => typeof m === 'string' && m.trim());
        if (!list.length) return;
        const i = task.random ? Math.floor(Math.random() * list.length) : task.idx % list.length;
        const msg = String(list[i]).trim();
        task.idx = (i + 1) % list.length;
        task.nextAt = Date.now() + task.intervalSec * 1000;
        if (isChatBlocked(msg)) { emitLog(`[广告] 消息被安全策略拦截：${msg}`); return; }
        try { bot.chat(msg); } catch (_e) { return; }
        task.sent++;
        task.lastMsg = msg;
    };

    // 运行统计：模块页展示轮播节奏与下一条倒计时
    botInstance.getAutoChatStats = () => {
        const remain = task.nextAt ? Math.max(0, Math.round((task.nextAt - Date.now()) / 1000)) : 0;
        return {
            activity: task.messages.length === 0
                ? '未配置消息——点「配置」添加要轮播的内容'
                : `轮播中（${task.messages.length} 条 · 每 ${task.intervalSec}s · 下一条 ${remain}s 后）`,
            sent: task.sent,
            lastMsg: task.lastMsg ? String(task.lastMsg).slice(0, 30) : '—',
        };
    };

    botInstance.toggleAutoChat = (active, config) => {
        const c = config || {};
        if (Array.isArray(c.messages)) task.messages = c.messages.map((s) => String(s).trim()).filter(Boolean);
        if (c.intervalSec !== undefined) task.intervalSec = Math.max(MIN_INTERVAL_SEC, Number(c.intervalSec) || 60);
        if (c.random !== undefined) task.random = !!c.random;
        task.active = !!active;

        if (task.timer) {
            clearInterval(task.timer);
            const i = botInstance.timers.indexOf(task.timer);
            if (i >= 0) botInstance.timers.splice(i, 1);
            task.timer = null;
        }
        if (task.active) {
            // 开启 3 秒后发第一条（给个反悔窗口），之后按间隔轮播；1s 心跳查发车点，倒计时展示才准
            task.nextAt = Date.now() + 3000;
            task.timer = setInterval(() => { if (task.active && Date.now() >= task.nextAt) sendNext(); }, 1000);
            botInstance.timers.push(task.timer);
            emitLog(`定时广告已开启（${task.messages.length} 条消息，每 ${task.intervalSec}s ${task.random ? '随机' : '轮播'}）`);
        } else {
            emitLog('定时广告已关闭');
        }
    };

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        if (task.timer) { clearInterval(task.timer); task.timer = null; }
        task.active = false;
    });
};
