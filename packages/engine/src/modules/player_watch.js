// 盯人监听：记录与指定玩家相关的全部聊天（按「消息文本包含名字」宽匹配——
// 各服聊天格式五花八门（<name> / [称号]name: / 私聊转述），宽匹配连系统公告提到该玩家也能抓到）。
// 命中进 per-bot 环形缓冲（最近 200 条），随时在模块页「查看记录」，不打扰主日志流。
const { stripColor } = require('../utils/monitorParse');

const MAX_HITS = 200;

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const emitLog = (msg) => botInstance.uiLog(msg);

    const task = (botInstance.playerWatchTask = {
        active: false,
        names: [],
        notify: false, // 命中推送到手机（Webhook；需在设置里开启「盯人命中」事件）
        hits: [],      // { time, name, text } 环形缓冲
        count: 0,
        lastHit: null, // { name, text, at }
    });

    const onMessage = (jsonMsg) => {
        if (!task.active || !task.names.length) return;
        try {
            const raw = stripColor(jsonMsg.toString()).replace(/\u001b\[[0-9;]*m/g, '').trim();
            if (!raw) return;
            const hit = task.names.find((n) => n && raw.includes(n));
            if (!hit) return;
            task.count++;
            task.lastHit = { name: hit, text: raw, at: Date.now() };
            task.hits.push({ time: new Date().toLocaleTimeString(), name: hit, text: raw.slice(0, 200) });
            if (task.hits.length > MAX_HITS) task.hits.shift();
            // 推手机：走统一 Webhook 通道（受全局开关 + watch 事件开关 + 同 bot 60s 冷却三重约束）
            if (task.notify) botInstance.notifyEvent('watch', `${hit}：${raw.slice(0, 120)}`);
        } catch (_e) { /* 单条解析失败不影响监听 */ }
    };
    bot.on('message', onMessage);

    // 运行统计：模块页展示监听目标与最近命中
    botInstance.getPlayerWatchStats = () => ({
        activity: task.lastHit && Date.now() - task.lastHit.at < 60000
            ? `命中 ${task.lastHit.name}：${task.lastHit.text.slice(0, 40)}`
            : task.names.length
                ? `监听中（${task.names.join('、')}）`
                : '未配置目标——请在「配置」里添加',
        watchHits: task.count,
    });

    /** 拉取命中记录（新的在前）；供模块页「查看记录」。 */
    botInstance.getPlayerWatchLog = () => ({
        names: task.names,
        total: task.count,
        hits: [...task.hits].reverse(),
    });

    botInstance.togglePlayerWatch = (active, config) => {
        const c = config || {};
        if (Array.isArray(c.names)) task.names = c.names.map((s) => String(s).trim()).filter(Boolean);
        if (c.notify !== undefined) task.notify = !!c.notify;
        task.active = !!active;
        emitLog(task.active
            ? `盯人监听已开启（${task.names.join('、') || '未配置目标'}${task.notify ? '，命中推送手机' : ''}）`
            : '盯人监听已关闭');
    };

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        bot.removeListener('message', onMessage);
        task.active = false;
    });
};
