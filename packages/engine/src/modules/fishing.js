module.exports = (botInstance) => {
    const bot = botInstance.bot;
    let loopTimer = null;   // 下一轮 fishingLoop 的定时器句柄
    let fishTimeout = null; // 本轮 60s 超时定时器句柄

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };

    async function fishingLoop() {
        if (!botInstance.fishingActive || !bot.entity) return;

        // 查找鱼竿（兼容不同版本名称）
        const rod = bot.inventory.items().find(item =>
            item.name.includes('fishing_rod') || item.name === 'fishing_rod'
        );

        if (!rod) {
            emitLog("背包无鱼竿，已自动关闭钓鱼模块");

            if (!botInstance.config.settings) botInstance.config.settings = {};
            botInstance.config.settings.fishing = false;
            botInstance.fishingActive = false;

            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();

            botInstance.io.to(botInstance._room).to('admin').emit('module_states', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                states: botInstance.config.settings
            });
            return;
        }

        // 检查鱼竿耐久（如果有 nbt 数据）
        try {
            if (rod.nbt) {
                const damage = rod.nbt.value?.Damage?.value || 0;
                const maxDurability = 64; // 鱼竿默认耐久
                if (damage >= maxDurability - 5) {
                    // 耐久快没了，尝试切换到另一根
                    const otherRod = bot.inventory.items().find(item =>
                        (item.name.includes('fishing_rod') || item.name === 'fishing_rod') &&
                        item.slot !== rod.slot
                    );
                    if (otherRod) {
                        emitLog("鱼竿耐久不足，切换备用鱼竿");
                        await bot.equip(otherRod, 'hand');
                    }
                }
            }
        } catch (e) {
            // 耐久检测失败不影响钓鱼
        }

        try {
            await bot.equip(rod, 'hand');

            // 超时保护：60秒无鱼上钩自动重试。成功/失败都 clearTimeout，避免每轮遗留一个 60s 计时器
            const fishPromise = bot.fish();
            const timeoutPromise = new Promise((_, reject) => {
                fishTimeout = setTimeout(() => reject(new Error('钓鱼超时(60s)')), 60000);
            });
            try {
                await Promise.race([fishPromise, timeoutPromise]);
            } finally {
                if (fishTimeout) { clearTimeout(fishTimeout); fishTimeout = null; }
            }

            if (botInstance.fishingActive) loopTimer = setTimeout(fishingLoop, 100);
        } catch (err) {
            if (!botInstance.fishingActive) return;
            // 超时不刷屏，只在非超时错误时打日志
            if (!err.message.includes('超时')) {
                emitLog(`钓鱼出错: ${err.message}`);
            }
            if (botInstance.fishingActive) loopTimer = setTimeout(fishingLoop, 2000);
        }
    }

    botInstance.setFishing = (state) => {
        const prevState = botInstance.fishingActive;
        botInstance.fishingActive = state;

        if (state && !prevState) {
            fishingLoop();
        } else if (!state && prevState) {
            try { bot.activateItem(); } catch (e) {}
            if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
        }
    };

    // 清理：断线/停止时关闭钓鱼并清掉悬挂定时器（此前本模块完全没有清理）
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        botInstance.fishingActive = false;
        if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
        if (fishTimeout) { clearTimeout(fishTimeout); fishTimeout = null; }
    });
};
