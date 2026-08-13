// 状态推送与观众门控（从 BotInstance.js 抽出）：
// updateStatus 每 2s 由 statusTimer 驱动；签名去重 + 30s 保活 + 无人观看跳过广播。

module.exports.mixin = {
    // MODB-11：是否有客户端在「看」这个 bot——给周期性重活(背包NBT/计分板/监听推送)做门控，
    // 没人看就跳过这一拍，省掉 bot 多时永久全量空转的 CPU/GC。
    //
    // 本工程是「单主人广播模型」：botManager 注入的 io 是一个广播壳(只有 to()/emit()，to 为空操作，
    // emit 一律 io.emit 广播给所有已认证客户端)，因此「在看某个 bot」≡「有任意客户端连着」。
    // 判定策略（由强到弱，永远 fail-open，宁可多干活也不藏数据）：
    //   1) 能拿到「已连接客户端总数」(真实 IOServer 的 engine.clientsCount / namespace.sockets.size)：
    //      —— 仅当确定为 0(无人连)才返回 false 跳过；>0 即视为有人看。
    //   2) room 已被加入(将来若 botManager 改成真房间)：本 bot room 或 admin room 有 socket → 一定在看(只作「是」的加分，空房间绝不当「否」，避免误藏)。
    //   3) 三者都拿不到(当前广播壳)：返回 true(fail-open)——此时门控为安全空操作，待 io 暴露真实连接数后自动生效。
    hasWatchers() {
        try {
            const io = this.io;
            if (!io) return true;
            // 1) 已连接客户端总数（真实 IOServer 才有；广播壳没有 → 落到 fail-open）
            let clients = null;
            if (io.engine && typeof io.engine.clientsCount === 'number') clients = io.engine.clientsCount;
            else if (io.sockets?.sockets && typeof io.sockets.sockets.size === 'number') clients = io.sockets.sockets.size;
            else if (typeof io.of === 'function') {
                const ns = io.of('/');
                if (ns?.sockets && typeof ns.sockets.size === 'number') clients = ns.sockets.size;
            }
            // 2) room 命中（仅作「确有人看」的加分；空 room 不当「无人」）
            const rooms = io.sockets?.adapter?.rooms;
            if (rooms && typeof rooms.get === 'function') {
                if ((rooms.get(this._room)?.size || 0) > 0) return true;
                if ((rooms.get('admin')?.size || 0) > 0) return true;
            }
            if (clients != null) return clients > 0; // 能确知连接数：0 才跳过
        } catch (_e) { /* 探测失败 → fail-open */ }
        return true; // 拿不到任何可靠信号：保守继续下发
    },

    /**
     * 核心修复：必须将 combatConfig 完整推送到前端，否则 UI 无法渲染配置界面
     * 增加 ownerId 用于前端过滤
     */
    updateStatus() {
        if (!this.bot?.entity) return;
        const pos = this.bot.entity.position;
        // 持续记录存活时的最后坐标：死亡时 entity 可能已失效，用它当「死亡点」（死亡返回 / 脚本 {deathX/Y/Z}）
        this._lastAlivePos = { x: pos.x, y: pos.y, z: pos.z };
        const modules = {
            combat: this.combatConfig.enabled,
            combatConfig: this.combatConfig,
            fishing: this.fishingActive,
            reconnectDelay: this.config.settings?.reconnectDelay || 5,
            schedules: this.config.settings?.schedules || []
        };
        // 网络延迟（tablist ping，毫秒）；取不到为 null
        const ping = typeof this.bot.player?.ping === 'number' ? this.bot.player.ping : null;
        // 变化检测：坐标取整+生命+延迟(25ms 桶)+模块/存档作签名。静止挂机(钓鱼/待命)时避免每 2s 空推；
        // 无变化时也最多 30s 保活推一次，不影响前端在线显示。
        const pingBucket = ping == null ? 'x' : Math.round(ping / 25);
        // CORE-8：签名只取少量标量，不再每 2s 对完整 modules(含 combatConfig/schedules) 做 JSON.stringify。
        //  · combatConfig 各关键标量直接拼接（5 个布尔/数字，配置变化时签名随之变化）；
        //  · schedules 只在「数组引用变化」时重算指纹（编辑定时会经 updateBot 换成新数组，引用即变），
        //    平时挂机直接复用缓存，避免每拍序列化整张定时表。
        const cc = this.combatConfig;
        const ccSig = `${cc.enabled ? 1 : 0}/${cc.range}/${cc.maxTargets}/${cc.antiKb ? 1 : 0}/${cc.attackPlayers ? 1 : 0}/${cc.attackMobs ? 1 : 0}`;
        // 定时表很小（几条 {time,command}），直接序列化即可——之前用「数组引用变化」判断会漏掉
        // scheduler:add/remove 的原地 push/splice（引用不变→状态不刷新），故改为每次 stringify（微秒级、必定正确）。
        const schedules = this.config.settings?.schedules || [];
        const schedulesSig = schedules.length ? JSON.stringify(schedules) : '0';
        const modSig = `${ccSig}|${this.fishingActive ? 1 : 0}|${this.config.settings?.reconnectDelay || 5}|${schedulesSig}`;
        const sig = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}|${this.bot.health}|${this.bot.food}|${this.bot.experience?.level || 0}|${pingBucket}|${this.savedLocations.length}|${modSig}`;
        const now = Date.now();
        if (sig === this._lastStatusSig && now - this._lastStatusEmitAt < 30000) return;
        this._lastStatusSig = sig;
        this._lastStatusEmitAt = now;
        // 无人观看：签名照常推进（_lastAlivePos 等内部状态已更新），但省掉 构建摘要+广播。
        // 新前端连上时 handlers.ts 的 BOTS_SNAPSHOT 提供全量首帧，无回归面。
        if (!this.hasWatchers()) return;
        this.io.to(this._room).to('admin').emit('status', {
            user: this.config.username,
            host: this.config.host,
            ownerId: this.config.ownerId,
            online: true,
            pos,
            health: this.bot.health,
            food: this.bot.food,
            level: this.bot.experience?.level || 0,
            ping,
            savedLocations: this.savedLocations,
            modules
        });
    },
};
