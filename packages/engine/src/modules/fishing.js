const installVanilla = (botInstance) => {
    const bot = botInstance.bot;
    let loopTimer = null;   // 下一轮 fishingLoop 的定时器句柄
    let fishTimeout = null; // 本轮 60s 超时定时器句柄
    let generation = 0;

    const emitLog = (msg) => botInstance.uiLog(msg);

    // 运行统计：模块页展示抛竿/上钩与当前状态（此前钓鱼开着完全无反馈）
    const stats = { casts: 0, catches: 0, startedAt: 0, phase: '' };
    botInstance.getFishingStats = () => ({
        activity: stats.phase || '准备中…',
        casts: stats.casts,
        catches: stats.catches,
        runTime: stats.startedAt ? Math.round((Date.now() - stats.startedAt) / 60000) : 0,
    });

    async function fishingLoop() {
        if (!botInstance.fishingActive || !bot.entity) return;
        const run = generation;
        let timeoutHandle = null;

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
            // 开关翻转经 BOT_STATUS(≤2s) 到 UI；emitLog 已经给了用户原因，无需单发状态事件
            return;
        }

        // 检查鱼竿耐久（如果有 nbt 数据）
        try {
            if (rod.nbt) {
                const damage = rod.nbt.value?.Damage?.value || 0;
                // MODB-5：用物品真实最大耐久（原版鱼竿 65，旧常量 64 差一），取不到再回退；
                // 用相对阈值，避免高耐久/附魔(Unbreaking)/自定义竿被误判低耐久换走
                const maxDurability = rod.maxDurability || 65;
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
        } catch (_e) {
            // 耐久检测失败不影响钓鱼
        }

        try {
            await bot.equip(rod, 'hand');
            if (!botInstance.fishingActive || run !== generation) return;

            // 超时保护：60秒无鱼上钩自动重试。成功/失败都 clearTimeout，避免每轮遗留一个 60s 计时器
            stats.casts++;
            stats.phase = '等待咬钩…';
            const fishPromise = bot.fish();
            // race 败者也要接住 rejection：超时路径后 mineflayer 会 cancel 掉这个旧任务，
            // 不挂 catch 就是每次超时刷一条 unhandledRejection
            fishPromise.catch(() => {});
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error('钓鱼超时(60s)')), 60000);
                fishTimeout = timeoutHandle;
            });
            let timedOut = false;
            try {
                await Promise.race([fishPromise, timeoutPromise]);
                if (!botInstance.fishingActive || run !== generation) return;
                stats.catches++;
                stats.phase = '收线！重新抛竿…';
            } catch (raceErr) {
                timedOut = String(raceErr?.message || '').includes('超时');
                throw raceErr;
            } finally {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                if (fishTimeout === timeoutHandle) fishTimeout = null;
                // 超时后浮漂还在水里：先收线（activateItem 收回旧浮漂），否则下一轮 bot.fish()
                // 的 activateItem 变成「收线」而非「抛竿」，与 mineflayer 状态机脱节空转一轮
                if (timedOut && run === generation) {
                    try { bot.activateItem(); } catch (_e) { /* bot 可能已断线 */ }
                }
            }

            if (botInstance.fishingActive && run === generation) loopTimer = setTimeout(fishingLoop, 100);
        } catch (err) {
            if (!botInstance.fishingActive || run !== generation) return;
            // 超时不刷屏，只在非超时错误时打日志
            if (!err.message.includes('超时')) {
                emitLog(`钓鱼出错: ${err.message}`);
                stats.phase = `出错重试：${err.message.slice(0, 40)}`;
            } else {
                stats.phase = '60s 无鱼上钩，重新抛竿…';
            }
            if (botInstance.fishingActive) loopTimer = setTimeout(fishingLoop, 2000);
        }
    }

    botInstance.setFishing = (state, options = {}) => {
        if (state && options.mode && options.mode !== 'vanilla') throw Error('当前服务器未提供该钓鱼模式');
        const prevState = botInstance.fishingActive;
        botInstance.fishingActive = state;

        if (state && !prevState) {
            generation++;
            stats.startedAt = Date.now();
            stats.phase = '准备抛竿…';
            fishingLoop();
        } else if (!state && prevState) {
            generation++;
            try { bot.activateItem(); } catch (_e) {}
            if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
        }
    };

    // 清理：断线/停止时关闭钓鱼并清掉悬挂定时器（此前本模块完全没有清理）
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        generation++;
        botInstance.fishingActive = false;
        if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
        if (fishTimeout) { clearTimeout(fishTimeout); fishTimeout = null; }
    });
};

module.exports = inst => {
    installVanilla(inst);
    inst.scanFishingPond = () => require('./fishing_pond').scanFishingPond(inst.bot);
    require('../adapters').getServerAdapter(inst.config)?.installFishing?.(inst);
};
