module.exports = (botInstance) => {
    const bot = botInstance.bot;

    // 节流控制：防止 setSlot 高频触发导致刷屏
    let _windowThrottleTimer = null;
    let _pendingWindow = null;

    // 封装一个解析函数，方便多次调用
    const sendWindowData = (window) => {
        if (!window || window.id === 0) return;

        const slots = [];
        const containerSize = window.slots.length - 36;

        for (let i = 0; i < containerSize; i++) {
            const item = window.slots[i];
            if (item) {
                let customName = item.displayName;
                let loreLines = [];

                // 深度挖掘 NBT
                if (item.nbt && item.nbt.value && item.nbt.value.display) {
                    const display = item.nbt.value.display.value;
                    if (display.Name) customName = display.Name.value;
                    if (display.Lore) loreLines = display.Lore.value.value;
                }

                // 针对 Chemdah 等插件的特殊处理：如果原生解析失败，尝试手动处理 JSON
                const cleanName = customName.replace(/§[0-9a-fk-orx]/gi, '');
                const cleanLore = loreLines.map(line => {
                    // 1.12.2 有些 Lore 是 JSON 字符串，尝试提取纯文本
                    if (line.startsWith('{"text":')) {
                        try { return JSON.parse(line).text; } catch(e) { return line; }
                    }
                    return line.replace(/§[0-9a-fk-orx]/gi, '');
                }).join('\n');

                slots.push({ slot: i, name: cleanName, lore: cleanLore });
            } else {
                slots.push({ slot: i, name: null });
            }
        }

        botInstance.io.to(botInstance._room).to('admin').emit('window_data', {
            user: bot.username,
            title: window.title ? window.title.replace(/§[0-9a-fk-orx]/gi, '') : "菜单",
            slots: slots
        });
    };

    // 节流版 sendWindowData：100ms 内只发送一次
    const throttledSendWindowData = (window) => {
        _pendingWindow = window;
        if (_windowThrottleTimer) return;
        _windowThrottleTimer = setTimeout(() => {
            _windowThrottleTimer = null;
            if (_pendingWindow) {
                sendWindowData(_pendingWindow);
            }
        }, 100);
    };

    // 监听1：窗口打开
    const onWindowOpen = (window) => {
        // 延迟 300ms 扫描，等待 Chemdah 把数据填充完毕
        setTimeout(() => sendWindowData(window), 300);
        // 延迟 800ms 再次扫描，防止超大菜单加载慢
        setTimeout(() => sendWindowData(window), 800);
    };

    bot.on('windowOpen', onWindowOpen);

    // 监听2：实时槽位更新（节流版）
    const onSetSlot = (window, slot, item) => {
        if (window && window.id !== 0) {
            throttledSendWindowData(window);
        }
    };

    bot.on('setSlot', onSetSlot);

    // 添加清理钩子
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        if (_windowThrottleTimer) {
            clearTimeout(_windowThrottleTimer);
            _windowThrottleTimer = null;
        }
        bot.removeListener('windowOpen', onWindowOpen);
        bot.removeListener('setSlot', onSetSlot);
    });
};
