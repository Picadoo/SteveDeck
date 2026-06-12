// 防挂机踢（lite 假人内置）：每 2.5~5 分钟随机做一个轻量动作（跳一下 / 随机转个头），
// 不走脚本系统、零配置、零常驻 CPU（单个 setTimeout 链）。
// 只给 lite 假人挂载——普通 bot 有模块/脚本可用，不重复造轮子。
module.exports = (botInstance) => {
    const bot = botInstance.bot;
    let timer = null;
    let stopped = false;

    const act = () => {
        try {
            if (!bot || !bot.entity) return;
            if (Math.random() < 0.5) {
                bot.setControlState('jump', true);
                setTimeout(() => { try { bot.setControlState('jump', false); } catch (e) { /* ignore */ } }, 300);
            } else {
                const yaw = (bot.entity.yaw || 0) + (Math.random() - 0.5) * 1.2;
                bot.look(yaw, bot.entity.pitch || 0, false).catch(() => {});
            }
        } catch (e) { /* 动作失败无所谓，下轮再试 */ }
    };

    const schedule = () => {
        if (stopped) return;
        const delay = (150 + Math.random() * 150) * 1000; // 2.5~5 分钟随机，不踩固定节拍
        timer = setTimeout(() => { act(); schedule(); }, delay);
    };
    schedule();

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
    });
};
