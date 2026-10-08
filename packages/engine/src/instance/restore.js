// 模块状态恢复（从 BotInstance.js 抽出）：重连后自动续上战斗/钓鱼/农场/追怪/挖矿/脚本。
// 单处集中，新增模块只需在此加一行，不再散落于 spawn 回调。
const logger = require('../utils/logger');

module.exports.mixin = {
    restoreModules(settings) {
        settings = settings || this.config.settings || {};

        // 立即恢复（仅纯配置/脚本库，不会移动 bot，登录前执行无副作用）
        try {
            if (settings.combatConfig) this.combatConfig = { ...this.combatConfig, ...settings.combatConfig };
            // 脚本库：冷启动优先从全局 scripts.json 预载；settings.scripts 仅作回退。
            let scriptsToLoad = {};
            try { if (this.loadGlobalScripts) scriptsToLoad = this.loadGlobalScripts() || {}; } catch (_e) { /* 回退 */ }
            if (!scriptsToLoad || Object.keys(scriptsToLoad).length === 0) {
                scriptsToLoad = settings.scripts || {};
            }
            if (this.preloadScripts && scriptsToLoad && typeof scriptsToLoad === 'object') {
                this.preloadScripts(scriptsToLoad);
                logger.info(`[${this.config.username}] 已恢复 ${Object.keys(scriptsToLoad).length} 个脚本`);
            }
        } catch (err) {
            logger.error(`[${this.config.username}] 配置/脚本预载失败:`, err.message);
        }

        // 延迟激活会移动 bot 的模块：必须晚于自动 /login（2秒），否则在需要登录的服务器上动作会被冻结/拒绝
        const RESTORE_DELAY = 3500;
        const epoch = this._epoch; // 捕获当前世代：延迟期间若断线重连(新世代)则不对新连接重复激活(CORE-4)
        this.pushOneShot(() => {
            if (this._epoch !== epoch || !this.bot || !this.bot.entity) return; // 已断线/换连接则放弃
            try {
                this.combatConfig.enabled = settings.combat || false;
                if (settings.fishing) { if (typeof this.setFishing === 'function') this.setFishing(true); else this.fishingActive = true; }
                if (settings.autoFarm && this.toggleAutoFarm) this.toggleAutoFarm(true, settings.autoFarm);
                if (settings.mobHunter && this.toggleMobHunter) {
                    const active = settings.mobHunter.active !== undefined ? !!settings.mobHunter.active : true;
                    const cfg = settings.mobHunter.config || settings.mobHunter;
                    if (active) this.toggleMobHunter(true, cfg);
                }
                if (settings.follow?.active && this.toggleFollow) {
                    this.toggleFollow(true, settings.follow.config || {});
                }
                if (settings.autoMine?.active && this.toggleAutoMine) {
                    this.toggleAutoMine(true, settings.autoMine.config || {});
                }
                if (settings.trash_cleaner && this.toggleTrashCleaner) {
                    const tc = settings.trash_cleaner;
                    const active = typeof tc === 'object' ? !!tc.active : !!tc;
                    const items = (typeof tc === 'object' && Array.isArray(tc.items)) ? tc.items : [];
                    if (active) this.toggleTrashCleaner(true, items);
                }
                if (settings.autoUse && this.toggleAutoUse) {
                    const au = settings.autoUse;
                    const active = typeof au === 'object' ? !!au.active : !!au;
                    const cfg = (typeof au === 'object' && Array.isArray(au.rules)) ? { rules: au.rules } : {};
                    if (active) this.toggleAutoUse(true, cfg);
                }
                if (settings.autoChat?.active && this.toggleAutoChat) {
                    this.toggleAutoChat(true, settings.autoChat.config || {});
                }
                if (settings.playerWatch?.active && this.togglePlayerWatch) {
                    this.togglePlayerWatch(true, settings.playerWatch.config || {});
                }
                const activeScript = settings.activeScript;
                if (activeScript && this._scripts?.[activeScript] && this._runningScript == null) {
                    logger.info(`[${this.config.username}] 断线恢复脚本: ${activeScript}`);
                    this.startScript(activeScript);
                }
            } catch (err) {
                logger.error(`[${this.config.username}] 模块恢复失败:`, err.message);
            }
        }, RESTORE_DELAY);
    },
};
