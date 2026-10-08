// 模组界面脚本复用与手动面板相同的快照校验，不直接拼协议包。
const { pressMenuKey, pressDragonKey } = require('../mod_menu_key');
const { getDragonCore } = require('../dragoncore/runtime');
module.exports = {
    async mod_key({ botInstance, emitLog }, step, ctx) {
        ctx.modMenu = null;
        const result = await pressMenuKey(botInstance, step.provider || 'dragoncore', step.key || 'T');
        if (ctx.aborted) return;
        ctx.modMenu = result.menu;
        if (!result.menu && !result.opened) throw Error('按键已发送，但服务器未返回菜单');
        emitLog(`已打开模组菜单：${result.menu?.title || result.window?.title}`);
    },
    async mod_click({ botInstance, emitLog }, step, ctx) {
        const menu = ctx.modMenu;
        if (!menu) throw Error('请先用 mod_key 打开并读取模组菜单');
        let selection;
        if (step.slotKey !== undefined && step.slotKey !== '') {
            const mouse = step.mouse === undefined ? 0 : Number(step.mouse);
            selection = { token: menu.token, slotKey: String(step.slotKey), mouse };
        } else {
            const matches = menu.buttons.filter(b => b.supported && b.label === step.label);
            if (matches.length !== 1) throw Error(`未找到唯一的已识别按钮：${step.label}`);
            selection = { token: menu.token, buttonId: matches[0].id };
        }
        ctx.modMenu = null; // 即使失败也不复用旧快照，不自动重复物品操作。
        const result = await pressMenuKey(botInstance, 'dragoncore', 'T', selection);
        if (!ctx.aborted) ctx.modMenu = result.menu;
        emitLog(`模组点击已提交：${step.label || step.slotKey}；请以服务器回执确认结果`);
    },
    async mod_refresh({ botInstance }, _step, ctx) {
        if (!ctx.modMenu) throw Error('没有可刷新的模组界面');
        const result = await pressMenuKey(botInstance, 'dragoncore', 'T', { token: ctx.modMenu.token, refresh: true });
        if (!ctx.aborted) ctx.modMenu = result.menu;
    },
    async dragoncore_key({ botInstance }, step, ctx) {
        const result = pressDragonKey(botInstance, step.key);
        ctx.dragonRevision = result.afterRevision;
    },
    async dragoncore_wait_gui({ botInstance, bot, emitLog }, step, ctx) {
        await getDragonCore(botInstance).waitForGui({ name: step.name, afterRevision: ctx.dragonRevision ?? -1,
            timeoutMs: Number(step.timeout || 4) * 1000, cancelled: () => ctx.aborted || !bot.entity });
        emitLog(`已收到龙核心界面：${step.name}`);
    },
};
