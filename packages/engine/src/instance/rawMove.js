// 直接坐标包移动（模组服，从 BotInstance.js 抽出）：
// mineflayer 走路靠客户端物理模拟，需要"看懂"周围方块自己算；模组服（模组方块 / varint 丢的区块）算不动 → 走不了。
// 这里改成像 MinecraftConsoleClient 那样：关掉物理，直接发 position 包告诉服务器"我到这了"，不依赖物理。
// 仅 settings.rawMove 开启时生效（通用设置，不针对某个服）；rawMoveEnabled getter 留在 BotInstance 核心。
const logger = require('../utils/logger');

module.exports.mixin = {
    setRawControl(states) {
        if (!this._raw) this._raw = { forward: false, back: false, left: false, right: false, sprint: false, sneak: false };
        for (const k of ['forward', 'back', 'left', 'right', 'sprint', 'sneak']) {
            if (k in states) this._raw[k] = !!states[k];
        }
        this._startRawLoop();
    },

    _startRawLoop() {
        if (this._rawTimer || !this.bot || !this.bot.entity) return;
        const bot = this.bot;
        // 诊断：开始移动时打印 bot 眼里的世界状态，确认到底是物理/区块问题还是别的
        try {
            const p = bot.entity.position;
            const below = bot.blockAt(p.offset(0, -1, 0));
            const yaw = bot.entity.yaw;
            const fwd = bot.blockAt(p.offset(-Math.sin(yaw), 0, Math.cos(yaw)));
            const m = `[诊断] 脚下=${below ? below.name : '未加载/空'} 前方=${fwd ? fwd.name : '未加载/空'} onGround=${bot.entity.onGround} physics=${bot.physicsEnabled}`;
            logger.info(`[${this.config.username}] ${m}`);
            this.uiLog(m);
        } catch (_e) { /* ignore */ }
        try { bot.physicsEnabled = false; } catch (_e) { /* ignore */ }
        this._rawTimer = setInterval(() => this._rawTick(), 100);
        this.timers.push(this._rawTimer);
        this.uiLog('已切换为直接移动（模组服）');
    },

    stopRawMove() {
        if (this._rawTimer) {
            clearInterval(this._rawTimer);
            // 从 timers 数组摘掉句柄，避免反复开关 rawMove 时数组无界增长（同 splice 模式）
            if (Array.isArray(this.timers)) {
                const i = this.timers.indexOf(this._rawTimer);
                if (i >= 0) this.timers.splice(i, 1);
            }
            this._rawTimer = null;
        }
        this._raw = null;
        try { if (this.bot) this.bot.physicsEnabled = true; } catch (_e) { /* ignore */ }
    },

    _rawTick() {
        const bot = this.bot;
        if (!bot?.entity) { return; }
        const c = this._raw || {};
        const yaw = bot.entity.yaw;
        const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
        let mx = 0, mz = 0;
        if (c.forward) { mx += -sinY; mz += cosY; }
        if (c.back) { mx += sinY; mz += -cosY; }
        if (c.left) { mx += cosY; mz += sinY; }
        if (c.right) { mx += -cosY; mz += -sinY; }
        const p = bot.entity.position;
        if (mx !== 0 || mz !== 0) {
            const len = Math.hypot(mx, mz) || 1;
            const speed = (c.sprint ? 5.4 : 4.3) * 0.1; // 每 100ms 步长（米）
            p.x += (mx / len) * speed;
            p.z += (mz / len) * speed;
            // Y 保持当前值（平地够用；复杂地形 v1 不处理高度）
        }
        try {
            bot._client.write('position', { x: p.x, y: p.y, z: p.z, onGround: true });
        } catch (_e) { /* ignore */ }
    },
};
