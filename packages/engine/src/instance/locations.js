// 保存地点管理（从 BotInstance.js 抽出）：保存/删除/前往/更新到达方式。
// 「前往」的优先级：到达脚本（GUI/多世界传送通用）→ 前置指令切图+等传送→寻路 → 直接寻路。
const { isChatBlocked } = require('../utils/chatSafety');
const waitForTeleport = require('../utils/waitForTeleport');

module.exports.mixin = {
    saveLocation(name, command, steps) {
        if (!this.bot?.entity) {
            return { success: false, error: '机器人未在线' };
        }

        // 软上限纯防滥用（地点数据极小，正常用户碰不到）：不再卡 12 个，UI 也不显示 N/12
        if (this.savedLocations.length >= 200) {
            return { success: false, error: '地点数量过多（上限 200）' };
        }

        const pos = this.bot.entity.position;
        const location = {
            id: Date.now().toString(),
            name: name,
            command: command || undefined,
            // 到达脚本（开菜单/点格子等，多世界/GUI 传送通用）；为空则回退到 command/坐标
            steps: Array.isArray(steps) && steps.length ? steps : undefined,
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z),
            // 记录维度：跨维度且无到达方式时「前往」快速失败，而不是寻路 60 秒超时。
            // 注意 Bukkit 多世界的自定义世界客户端常显示 overworld，分不清时靠 command/steps 兜底。
            dimension: this.bot.game?.dimension || undefined,
            createdAt: Date.now()
        };

        this.savedLocations.push(location);
        this.saveConfig();

        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已保存地点: ${name} (${location.x}, ${location.y}, ${location.z})`,
            time: new Date().toLocaleTimeString()
        });

        return { success: true, location };
    },

    deleteLocation(locationId) {
        const index = this.savedLocations.findIndex(loc => loc.id === locationId);
        if (index === -1) {
            return { success: false, error: '地点不存在' };
        }

        const deleted = this.savedLocations.splice(index, 1)[0];
        this.saveConfig();

        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已删除地点: ${deleted.name}`,
            time: new Date().toLocaleTimeString()
        });

        return { success: true, deleted };
    },

    goToLocation(locationId) {
        const location = this.savedLocations.find(loc => loc.id === locationId);
        if (!location) {
            return { success: false, error: '地点不存在' };
        }

        // 优先：到达脚本（开菜单→点地点等，GUI/多世界传送通用，回放完整动作序列）
        if (Array.isArray(location.steps) && location.steps.length && typeof this.runSteps === 'function') {
            return this.runSteps(location.steps, `前往「${location.name}」`);
        }

        // 跨维度且没有任何到达方式：寻路注定 60 秒超时，直接快速失败给出可操作的提示
        const curDim = this.bot.game?.dimension;
        if (!location.command && location.dimension && curDim && location.dimension !== curDim) {
            return {
                success: false,
                error: `「${location.name}」在 ${location.dimension}，当前在 ${curDim}——请为该地点配置前置指令或录制到达脚本`,
            };
        }

        // 其次：前置指令切图 → 等传送真的发生（位置跳变/维度变化，最多 8 秒）→ 再寻路。
        // 旧实现固定等 2.5 秒就开走：传送排队/确认菜单/网络延迟都会让机器人在原世界乱跑。
        if (location.command) {
            // API-1：地点 warp 指令也过安全过滤（与 respawn 同理，堵命令注入旁路）
            if (isChatBlocked(location.command)) {
                return { success: false, error: '到达指令被安全过滤拦截' };
            }
            this.bot.chat(location.command);
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                msg: `切图指令: ${location.command}，等待传送完成…`,
                time: new Date().toLocaleTimeString()
            });
            const epoch = this._epoch;
            (async () => {
                const moved = await waitForTeleport(this.bot, { timeoutMs: 8000 });
                if (this._epoch !== epoch || !this.bot?.entity) return; // 期间断连/重建：放弃陈旧寻路
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username,
                    ownerId: this.config.ownerId,
                    msg: moved ? '传送完成，开始寻路' : '8 秒内未检测到传送（可能已在附近），按坐标寻路',
                    time: new Date().toLocaleTimeString()
                });
                this.move(location.x, location.y, location.z);
            })();
        } else {
            // 兜底：当前世界内寻路到坐标
            this.move(location.x, location.y, location.z);
        }
        return { success: true, location };
    },

    // 更新已存在地点的「到达方式」（前置指令 / 录制的到达脚本）
    setLocationReach(locationId, reach = {}) {
        const location = this.savedLocations.find(loc => loc.id === locationId);
        if (!location) {
            return { success: false, error: '地点不存在' };
        }
        if (reach.command !== undefined) location.command = reach.command || undefined;
        if (reach.steps !== undefined) {
            location.steps = Array.isArray(reach.steps) && reach.steps.length ? reach.steps : undefined;
        }
        this.saveConfig();
        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已更新地点「${location.name}」的到达方式`,
            time: new Date().toLocaleTimeString()
        });
        return { success: true, location };
    },
};
