module.exports = (botInstance) => {
    const bot = botInstance.bot;

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };

    botInstance.trashCleanerTask = {
        active: false,
        trashItems: [], // 垃圾黑名单，例如 ['cobblestone', 'dirt', 'gravel']
        timer: null
    };

    // 执行清理的函数
    const cleanInventory = async () => {
        if (!botInstance.trashCleanerTask.active || !bot.inventory) return;

        // 获取当前背包所有物品
        const items = bot.inventory.items();
        
        for (const item of items) {
            // 检查物品名是否在黑名单中
            const isTrash = botInstance.trashCleanerTask.trashItems.some(trashName => 
                item.name.includes(trashName.toLowerCase().trim())
            );

            if (isTrash) {
                try {
                    // 打印日志并丢弃整叠物品
                    emitLog(`自动清理: 丢弃 ${item.name} x${item.count}`);

                    await bot.tossStack(item);
                    // 稍微等待一下，防止丢弃动作太快导致封号或出错
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    console.error(`[清理失败] ${item.name}:`, err.message);
                }
            }
        }
    };

    // 开关控制
    botInstance.toggleTrashCleaner = (active, items = []) => {
        botInstance.trashCleanerTask.active = active;
        botInstance.trashCleanerTask.trashItems = items;

        if (active) {
            emitLog("自动清理开启：将定期清理指定垃圾");
            // 每 10 秒扫描一次背包
            if (botInstance.trashCleanerTask.timer) {
                clearInterval(botInstance.trashCleanerTask.timer);
                // 先把旧句柄从全局 timers 摘掉，避免反复 toggle 让数组无限膨胀（参考 auto_use 的 splice 模式）
                if (Array.isArray(botInstance.timers)) {
                    const i = botInstance.timers.indexOf(botInstance.trashCleanerTask.timer);
                    if (i >= 0) botInstance.timers.splice(i, 1);
                }
            }
            botInstance.trashCleanerTask.timer = setInterval(cleanInventory, 10000);

            // 修复内存泄漏: 将定时器ID添加到追踪列表
            botInstance.timers = botInstance.timers || [];
            botInstance.timers.push(botInstance.trashCleanerTask.timer);

            // 立即执行一次
            cleanInventory();
        } else {
            emitLog("自动清理已关闭");
            if (botInstance.trashCleanerTask.timer) {
                clearInterval(botInstance.trashCleanerTask.timer);
                // E7：关闭路径同样从全局 timers 摘除句柄（开启路径已有同样的 splice），防反复开关累积
                if (Array.isArray(botInstance.timers)) {
                    const i = botInstance.timers.indexOf(botInstance.trashCleanerTask.timer);
                    if (i >= 0) botInstance.timers.splice(i, 1);
                }
                botInstance.trashCleanerTask.timer = null;
            }
        }
    };

    // 添加清理钩子
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        if (botInstance.trashCleanerTask.timer) {
            clearInterval(botInstance.trashCleanerTask.timer);
            botInstance.trashCleanerTask.timer = null;
        }
    });
};
