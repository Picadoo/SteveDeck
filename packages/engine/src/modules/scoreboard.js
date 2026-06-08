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

    // 取带颜色的文本（兼容 prismarine-chat ChatMessage / JSON 组件 / §字符串）
    const motd = (v) => {
        if (v == null) return '';
        if (typeof v === 'object') {
            try { if (typeof v.toMotd === 'function') return v.toMotd(); } catch (e) { /* ignore */ }
            try {
                if (typeof v.toString === 'function') {
                    const s = v.toString();
                    if (s && s !== '[object Object]') return s;
                }
            } catch (e) { /* ignore */ }
            if (v.text !== undefined) return String(v.text);
            if (Array.isArray(v.extra)) return v.extra.map((e) => e.text || '').join('');
            return '';
        }
        return String(v);
    };
    const cleanColor = (v) => motd(v).replace(/§[0-9a-fk-orx]/gi, '').trim();

    // 解析侧边栏。bot.scoreboard 按「显示位置」索引：.sidebar(=[1]) 是主侧边栏；
    // 3~18 是按队伍颜色区分的侧边栏（部分服用这些）。
    const updateSidebar = () => {
        try {
            const sb = bot.scoreboard;
            if (!sb) return;

            let sidebarObj = sb.sidebar || sb[1];
            if (!sidebarObj) {
                for (let pos = 3; pos <= 18; pos++) {
                    if (sb[pos]) { sidebarObj = sb[pos]; break; }
                }
            }

            if (!sidebarObj) {
                botInstance._scoreboard.sidebar = [];
                botInstance._scoreboard.sidebarTitle = '';
                botInstance._scoreboard.sidebarTitleRaw = '';
                return;
            }

            botInstance._scoreboard.sidebarTitle = cleanColor(sidebarObj.title || '');
            botInstance._scoreboard.sidebarTitleRaw = motd(sidebarObj.title || '');

            // items getter 已按分值降序（与游戏内一致）。每行可见文本取 displayName（含队伍前后缀）
            const rows = Array.isArray(sidebarObj.items) ? sidebarObj.items : [];
            botInstance._scoreboard.sidebar = rows
                .map((item) => {
                    const src = item.displayName ?? item.name;
                    return {
                        name: cleanColor(src),
                        raw: motd(src),
                        value: item.value !== undefined ? item.value : 0,
                    };
                })
                .filter((r) => r.name || r.raw);
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

    // 定期刷新（兜底，有些服务器不触发事件）。
    // MODB-11：这只是「兜底重解析」——事件(scoreUpdated 等)已实时维护缓存，getScoreboard() 也会按需强刷，
    // 故无人观看时跳过这一拍的全量走板，省 CPU；有人看才兜底刷新。
    const refreshTimer = setInterval(() => {
        if (!botInstance.hasWatchers()) return; // 无人看：跳过兜底重解析（缓存仍由事件维护）
        updateSidebar();
    }, 5000);
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
