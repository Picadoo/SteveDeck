// 脚本动作：GUI 交互类（interact/click_slot/close_gui/wait_gui_item/find_and_click_slot）
// GUI 操作前统一 waitForGuiReady（槽位稳定两拍才算加载完），操作后复检 aborted/bot.entity——
// 点击/等待期间断连是常态，直接读 currentWindow 会炸。
const { findMatchingSlot } = require('../../utils/guiMatch');

module.exports = {
    async interact(deps, step, ctx) {
        const { bot, goals, emitLog, sleep, gotoWithTimeout, waitForGuiReady, GUI_WAIT_MS } = deps;
        const targetName = step.target || step.name;
        emitLog(`右键: ${targetName}`);
        const entity = bot.nearestEntity((e) => {
            if (e === bot.entity) return false;
            const name = (e.customName || e.username || e.name || '').toString()
                .replace(/§./gi, '').toLowerCase();
            return name.includes(String(targetName).toLowerCase()) || String(e.id) === String(targetName);
        });
        if (!entity) throw new Error(`未找到实体: ${targetName}`);
        await gotoWithTimeout(new goals.GoalFollow(entity, 2));
        if (ctx.aborted || !bot.entity) return; // 寻路途中断连/停止：bot 已销毁，勿再 lookAt
        await bot.lookAt(entity.position.offset(0, (entity.height || 1.8) * 0.8, 0), true);
        if (ctx.aborted || !bot.entity) return; // lookAt 后复检，避免对已销毁 bot swingArm/activateEntity
        bot.swingArm('right');
        if (bot.activateEntity) {
            await bot.activateEntity(entity);
        } else if (bot.activateEntityAt) {
            await bot.activateEntityAt(entity, entity.position);
        }
        if (ctx.aborted || !bot.entity) return; // activate 后复检，再访问 currentWindow
        await sleep(GUI_WAIT_MS);
        if (bot.currentWindow) await waitForGuiReady(ctx);
    },

    async click_slot(deps, step, ctx) {
        const { bot, emitLog, sleep, waitForGuiReady } = deps;
        const slot = Number(step.slot);
        const button = Number(step.button) || 0;
        if (!bot.currentWindow) { emitLog('没有打开界面，跳过'); return; }
        await waitForGuiReady(ctx);
        if (ctx.aborted || !bot.entity) return; // GUI 等待期间可能断连
        emitLog(`点击槽位 ${slot}`);
        await bot.clickWindow(slot, button, 0);
        if (ctx.aborted || !bot.entity) return; // clickWindow 后复检，再访问 currentWindow
        await sleep(300);
        if (bot.currentWindow) await waitForGuiReady(ctx);
    },

    async close_gui(deps, _step, _ctx) {
        const { bot, emitLog, sleep } = deps;
        if (!bot.currentWindow) return;
        emitLog('关闭界面');
        await bot.closeWindow(bot.currentWindow);
        await sleep(200);
    },

    async wait_gui_item(deps, step, ctx) {
        const { bot, emitLog, pollUntil } = deps;
        const itemName = step.item || '';
        const timeout = (Number(step.timeout) || 10) * 1000;
        const matchLore = step.matchLore === true || step.matchLore === 'true';
        emitLog(`等待界面物品: ${itemName}`);
        // 按「显示名(+可选 lore)」匹配，与 find_and_click_slot 一致。
        // 原来只比 item.name(物品 id，如 paper/clock)，永远匹配不到中文显示名 → 必然超时。
        const found = await pollUntil(() => {
            if (!bot.currentWindow) return false;
            return findMatchingSlot(bot.currentWindow.slots, itemName, { matchLore }) >= 0;
        }, timeout, ctx);
        if (!found) emitLog(`超时未找到: ${itemName}`);
    },

    async find_and_click_slot(deps, step, ctx) {
        const { bot, botInstance, emitLog, emitVars, sleep, waitForGuiReady } = deps;
        const button = Number(step.button) || 0;
        if (!bot.currentWindow) { emitLog('没有打开界面'); return; }
        await waitForGuiReady(ctx);
        if (ctx.aborted || !bot.entity || !bot.currentWindow) return; // GUI 等待期间断连/界面关闭，勿读 currentWindow.slots
        // 增强匹配：matchLore 同时搜 lore；slotFrom/slotTo 限定槽位范围；save_slot 把命中槽位存入变量。
        // 全部可选，老脚本(只填 item)行为不变。
        const opts = {
            matchLore: step.matchLore === true || step.matchLore === 'true',
            slotFrom: step.slotFrom !== undefined ? Number(step.slotFrom) : undefined,
            slotTo: step.slotTo !== undefined ? Number(step.slotTo) : undefined,
        };
        const targetSlot = findMatchingSlot(bot.currentWindow.slots, step.item || '', opts);
        if (targetSlot < 0) { emitLog(`界面中未找到: ${step.item}`); return; }
        if (step.save_slot) { botInstance._scriptVars[step.save_slot] = targetSlot; emitVars(); }
        emitLog(`点击「${step.item}」@ 槽位${targetSlot}`);
        await bot.clickWindow(targetSlot, button, 0);
        if (ctx.aborted || !bot.entity) return; // clickWindow 后复检，再访问 currentWindow
        await sleep(300);
        if (bot.currentWindow) await waitForGuiReady(ctx);
    },
};
