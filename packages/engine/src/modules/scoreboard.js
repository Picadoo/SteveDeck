/**
 * 计分板读取模块 - 缓存侧边栏/Tab/BossBar 数据
 */
module.exports = (botInstance) => {
    const bot = botInstance.bot;

    // 缓存
    botInstance._scoreboard = {
        sidebar: [],    // [{ name, value }]
        sidebarTitle: '',
        belowName: [],
        list: [],
        bossBar: {}     // id -> { title, health, color }
    };

    const cleanColor = (str) => {
        if (!str) return '';
        if (typeof str === 'object') {
            // JSON chat component
            try {
                if (str.text !== undefined) return str.text;
                if (str.extra) return str.extra.map(e => e.text || '').join('');
                return JSON.stringify(str);
            } catch (e) { return String(str); }
        }
        return String(str).replace(/§[0-9a-fk-orx]/gi, '').trim();
    };

    // 解析侧边栏
    const updateSidebar = () => {
        try {
            // mineflayer 的 scoreboard 对象
            const sb = bot.scoreboard;
            if (!sb) return;

            // 找到 sidebar position 的 scoreboard
            let sidebarObj = null;
            for (const key in sb) {
                const board = sb[key];
                if (board && board.position === 1) { // 1 = sidebar
                    sidebarObj = board;
                    break;
                }
            }

            // 备用：直接取 sidebar 属性
            if (!sidebarObj && sb.sidebar) {
                sidebarObj = sb.sidebar;
            }

            if (!sidebarObj) return;

            botInstance._scoreboard.sidebarTitle = cleanColor(sidebarObj.title || '');

            const items = [];
            if (sidebarObj.items && Array.isArray(sidebarObj.items)) {
                sidebarObj.items.forEach(item => {
                    items.push({
                        name: cleanColor(item.displayName || item.name || ''),
                        value: item.value !== undefined ? item.value : 0
                    });
                });
            } else if (sidebarObj.itemsMap) {
                // 某些版本用 itemsMap
                for (const [name, item] of Object.entries(sidebarObj.itemsMap)) {
                    items.push({
                        name: cleanColor(item.displayName || name),
                        value: item.value !== undefined ? item.value : 0
                    });
                }
            }

            botInstance._scoreboard.sidebar = items;
        } catch (e) {
            // 计分板解析失败不影响其他功能
        }
    };

    // BossBar 监听
    const onBossBarCreated = (bossBar) => {
        try {
            botInstance._scoreboard.bossBar[bossBar.entityUUID || bossBar.id] = {
                title: cleanColor(bossBar.title),
                health: bossBar.health,
                color: bossBar.color
            };
        } catch (e) {}
    };

    const onBossBarUpdated = (bossBar) => {
        onBossBarCreated(bossBar); // 同样的处理
    };

    const onBossBarDeleted = (bossBar) => {
        try {
            delete botInstance._scoreboard.bossBar[bossBar.entityUUID || bossBar.id];
        } catch (e) {}
    };

    // 注册事件
    bot.on('scoreboardCreated', updateSidebar);
    bot.on('scoreUpdated', updateSidebar);
    bot.on('scoreRemoved', updateSidebar);
    bot.on('scoreboardDeleted', updateSidebar);
    bot.on('scoreboardPosition', updateSidebar);

    if (bot.on) {
        try {
            bot.on('bossBarCreated', onBossBarCreated);
            bot.on('bossBarUpdated', onBossBarUpdated);
            bot.on('bossBarDeleted', onBossBarDeleted);
        } catch (e) {
            // 低版本可能没有 bossBar 事件
        }
    }

    // 定期刷新（兜底，有些服务器不触发事件）
    const refreshTimer = setInterval(updateSidebar, 5000);
    botInstance.timers = botInstance.timers || [];
    botInstance.timers.push(refreshTimer);

    // 公开 API
    botInstance.getScoreboard = () => {
        updateSidebar(); // 拉取时强制刷新一次
        return botInstance._scoreboard;
    };

    // 按关键词从侧边栏提取数值
    botInstance.getScoreboardValue = (keyword) => {
        updateSidebar();
        const items = botInstance._scoreboard.sidebar;
        for (const item of items) {
            if (item.name.includes(keyword)) {
                // 尝试从文本中提取数字
                const match = item.name.match(/[\d,]+\.?\d*/);
                if (match) {
                    return parseFloat(match[0].replace(/,/g, ''));
                }
                return item.value;
            }
        }
        return null;
    };

    // 清理
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        clearInterval(refreshTimer);
        bot.removeListener('scoreboardCreated', updateSidebar);
        bot.removeListener('scoreUpdated', updateSidebar);
        bot.removeListener('scoreRemoved', updateSidebar);
        bot.removeListener('scoreboardDeleted', updateSidebar);
        bot.removeListener('scoreboardPosition', updateSidebar);
        try {
            bot.removeListener('bossBarCreated', onBossBarCreated);
            bot.removeListener('bossBarUpdated', onBossBarUpdated);
            bot.removeListener('bossBarDeleted', onBossBarDeleted);
        } catch (e) {}
    });
};
