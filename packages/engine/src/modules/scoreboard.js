/**
 * 计分板读取模块 - 缓存侧边栏/Tab/BossBar 数据
 */
module.exports = (botInstance) => {
    const bot = botInstance.bot;

    // 缓存。注意：sidebar 系字段【必须】经 getScoreboard()/getScoreboardValue() 读取
    //（getter 每次强刷，缓存不靠事件维护）；bossBar 系字段才是事件实时维护的。
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

    // 不注册 sidebar 事件监听：所有消费方（observe/moduleHandlers/script_engine）都经
    // getScoreboard()/getScoreboardValue() 读取，getter 每次强刷——缓存从不被「冷读」。
    // 动画计分板服 scoreUpdated 可达每秒数十~数百次，逐事件全量重解析纯属白烧 CPU。
    // bossBar 监听必须保留：它是 bossBar 数据的唯一来源（updateSidebar 不管 bossBar）。
    if (bot.on) {
        try {
            bot.on('bossBarCreated', onBossBarCreated);
            bot.on('bossBarUpdated', onBossBarUpdated);
            bot.on('bossBarDeleted', onBossBarDeleted);
        } catch (e) {
            // 低版本可能没有 bossBar 事件
        }
    }

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

    // 清理（sidebar 已无监听/定时器，只剩 bossBar 三个监听）
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        try {
            bot.removeListener('bossBarCreated', onBossBarCreated);
            bot.removeListener('bossBarUpdated', onBossBarUpdated);
            bot.removeListener('bossBarDeleted', onBossBarDeleted);
        } catch (e) {}
    });
};
