module.exports = (botInstance) => {
    let lastMinute = ""; // 记录上一次执行的分钟，防止在一分钟内重复触发

    const checkInterval = setInterval(() => {
        const bot = botInstance.bot;
        // 只有机器人在线且已进入世界才执行
        if (!bot || !bot.entity) return;

        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // 如果分钟没变，直接跳过
        if (lastMinute === currentTime) return;

        // 无条件更新 lastMinute，避免没有任务匹配时反复检查
        lastMinute = currentTime;

        // 获取当前账号的定时配置
        const schedules = (botInstance.config.settings && botInstance.config.settings.schedules) || [];

        schedules.forEach(s => {
            if (s.time === currentTime) {
                bot.chat(s.cmd);
                botInstance.io.to(botInstance._room).to('admin').emit('log', {
                    user: botInstance.config.username,
                    ownerId: botInstance.config.ownerId,
                    msg: `[定时任务] 触发指令: ${s.cmd}`,
                    time: now.toLocaleTimeString()
                });
            }
        });
    }, 10000); // 10秒检查一次，比1分钟检查一次更稳

    // 修复内存泄漏: 保存定时器ID
    botInstance.timers = botInstance.timers || [];
    botInstance.timers.push(checkInterval);

    // 添加清理钩子（不再单独监听 end 事件，由 cleanup 统一处理）
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        clearInterval(checkInterval);
    });
};
