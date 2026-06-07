const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const logger = require('./utils/logger');
const { isFatalKick, extractText } = require('./utils/reconnectPolicy');
const { isChatBlocked } = require('./utils/chatSafety');
const { Recorder } = require('./modules/recorder');

class BotInstance {
    constructor(config, io, saveCallback, loadGlobalScripts) {
        this.config = config;
        this.io = io;
        this.bot = null;
        this.saveCallback = saveCallback;
        // 冷启动脚本预载用：全局脚本库加载器（由 botManager 注入）；缺省则回退旧路径
        this.loadGlobalScripts = typeof loadGlobalScripts === 'function' ? loadGlobalScripts : null;

        // ownerId 对应的 room 名，用于定向发送消息
        this._room = `user:${config.ownerId}`;

        // 1. 初始化默认配置：确保在模块加载前，这些对象已经存在防止空指针
        this.combatConfig = {
            enabled: false,
            range: 4.5,
            maxTargets: 2,
            antiKb: true,
            attackPlayers: false,
            attackMobs: true
        };
        this.fishingActive = false;

        // 保存的地点（最多5个）
        this.savedLocations = config.settings?.savedLocations || [];

        this.reconnectTimer = null;
        this.statusTimer = null;
        this.isExplicitlyQuitting = false;
        this.destroyed = false;        // stop()/deleteBot 后置位：init() 与延迟回调据此 bail，杜绝僵尸复活(CORE-1)
        this._epoch = 0;               // 连接世代：每次 init() +1，延迟回调比对防陈旧命中新会话(CORE-4)

        // 消息缓冲防止刷屏
        this.msgBuffer = "";
        this.msgTimeout = null;

        // 新增: 定时器和清理钩子管理
        this.timers = [];  // 存储所有定时器ID
        this.cleanupHooks = [];  // 存储模块清理函数

        // 新增: 重连管理
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.settings?.maxReconnectAttempts ?? 0; // 0 = 无限（7×24 挂机默认；fatal 仍兜底）
        this.reconnectBackoff = 1;
        this.stableTimer = null;       // 连接稳定计时器（min-uptime，稳定后才重置计数）
        this._fatalReason = null;      // 不可恢复的断开原因（命中则停止重连）
        this._lastStatusSig = null;    // 状态推送去重签名（静止挂机时避免每 2s 空推）
        this._lastStatusEmitAt = 0;

        // 录制：把玩家操作录成脚本步骤（一切皆步骤，与手搓/AI 同构）
        this.recorder = new Recorder(this);

        this.init();
    }

    loadUserScriptsFromDisk() {
        try {
            const ownerId = this.config.ownerId;
            if (!ownerId) return {};
            const file = path.join(__dirname, 'user_scripts', `${ownerId}.json`);
            if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            logger.error(`[${this.config.username}] 加载用户脚本失败:`, err.message);
        }
        return {};
    }

    // 录制状态推送给前端（复用 module:state 事件，UI 据此刷录制条）
    emitRecordingState(state) {
        try {
            this.io.emit('module:state', { id: this.config.id, module: 'recording', state });
        } catch (e) {
            /* ignore */
        }
    }

    init() {
        this.cleanup();
        if (this.destroyed) return;    // 已被显式停止/删除：拒绝任何（含陈旧定时器触发的）复活(CORE-1)
        this.isExplicitlyQuitting = false;
        const epoch = ++this._epoch;   // 本次连接世代，供下方延迟回调（自动登录等）比对

        try {
            this.bot = mineflayer.createBot({
                host: this.config.host,
                port: this.config.port || 25565,
                username: this.config.username,
                auth: this.config.auth || 'offline',
                version: this.config.version || "1.12.2",
                // 省内存：只接收近处区块（区块数据是每个 bot 内存的大头）。可按 bot 配置覆盖：far/normal/short/tiny 或数字
                viewDistance: this.config.settings?.viewDistance || 'short',
                hideErrors: true
            });

            // 加载核心插件
            this.bot.loadPlugin(pathfinder);
            this.bot.loadPlugin(collectBlock);

            // 关键：捕获 bot._client 的错误，防止崩溃
            if (this.bot._client) {
                this.bot._client.on('error', (err) => {
                    logger.error(`[${this.config.username}] 客户端错误:`, err.message);
                    // 不抛出，让 'end' 事件处理重连
                });
            }

            this.bot.once('spawn', () => {
              try {
                this.spawnedAt = Date.now(); // 本次在线起点（用于在线时长显示）
                // 不立即清零：稳定在线 30 秒才认为连接健康，避免"登录即被踢"的抖动循环绕过重试上限
                if (this.stableTimer) clearTimeout(this.stableTimer);
                this.stableTimer = setTimeout(() => {
                    this.reconnectAttempts = 0;
                    this.reconnectBackoff = 1;
                    logger.info(`[${this.config.username}] 连接稳定，已重置重连计数`);
                }, 30000);

                logger.info(`[${this.config.username}] 登录成功，正在挂载功能模块...`);

                // 2. 模块挂载：逐个 try/catch 隔离——单个模块构造抛错不再连累后续模块与状态推送
                const MODULE_NAMES = [
                    'combat', 'fishing', 'scheduler', 'player_inventory',
                    'interact', 'automine', 'trash_cleaner', 'auto_farm', 'mob_hunter',
                    'scoreboard', 'script_engine', 'fishing_hotspot', 'window_gui',
                    'custom_js', 'bot_viewer', 'message_monitor',
                ];
                for (const name of MODULE_NAMES) {
                    try {
                        require(`./modules/${name}`)(this);
                    } catch (err) {
                        logger.error(`[${this.config.username}] 模块[${name}]挂载失败:`, err?.message || err);
                    }
                }

                // 3. 配置恢复：统一恢复各模块上次的激活状态（含自动挖矿断线续挖）
                try {
                    this.restoreModules(this.config.settings || {});
                } catch (err) {
                    logger.error(`[${this.config.username}] 模块状态恢复失败:`, err?.message || err);
                }

                // 4. 自动登录：如果配置了密码，延迟2秒后自动发送 /login 命令
                if (this.config.password) {
                    this.timers.push(setTimeout(() => {
                        try {
                            if (this.bot && this._epoch === epoch) {
                                this.bot.chat(`/login ${this.config.password}`);
                                logger.info(`[${this.config.username}] 已自动发送登录命令`);
                            }
                        } catch (err) {
                            logger.error(`[${this.config.username}] 自动登录失败:`, err?.message || err);
                        }
                    }, 2000)); // 延迟2秒，给服务器加载时间（句柄入 timers，断线即取消）
                }

                // 应用寻路策略（默认无破坏模式，适配受保护地图）
                this.applyMovements();
              } catch (err) {
                logger.error(`[${this.config.username}] spawn 处理异常:`, err?.message || err);
              } finally {
                // 状态同步必须启动（即便上面出错），否则前端会一直显示离线
                if (this.statusTimer) clearInterval(this.statusTimer);
                this.statusTimer = setInterval(() => this.updateStatus(), 2000);
              }
            });

            this.setupEvents();
        } catch (err) {
            logger.error(`[${this.config.username}] 初始化失败:`, err.message);
            this.handleReconnect();
        }
    }

    // 统一恢复各模块的激活状态（重连后自动续上：战斗/钓鱼/农场/追怪/挖矿/脚本）。
    // 单处集中，新增模块只需在此加一行，不再散落于 spawn 回调。
    restoreModules(settings) {
        settings = settings || this.config.settings || {};

        // 立即恢复（仅纯配置/脚本库，不会移动 bot，登录前执行无副作用）
        try {
            if (settings.combatConfig) this.combatConfig = { ...this.combatConfig, ...settings.combatConfig };
            // 脚本库：冷启动优先从全局 scripts.json 预载；旧的 user_scripts / settings.scripts 仅作回退。
            let scriptsToLoad = {};
            try { if (this.loadGlobalScripts) scriptsToLoad = this.loadGlobalScripts() || {}; } catch (e) { /* 回退 */ }
            if (!scriptsToLoad || Object.keys(scriptsToLoad).length === 0) {
                const userScripts = this.loadUserScriptsFromDisk();
                scriptsToLoad = Object.keys(userScripts).length > 0 ? userScripts : (settings.scripts || {});
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
        this.timers.push(setTimeout(() => {
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
                if (settings.autoMine && settings.autoMine.active && this.toggleAutoMine) {
                    this.toggleAutoMine(true, settings.autoMine.config || {});
                }
                if (settings.trash_cleaner && this.toggleTrashCleaner) {
                    const tc = settings.trash_cleaner;
                    const active = typeof tc === 'object' ? !!tc.active : !!tc;
                    const items = (typeof tc === 'object' && Array.isArray(tc.items)) ? tc.items : [];
                    if (active) this.toggleTrashCleaner(true, items);
                }
                const activeScript = settings.activeScript;
                if (activeScript && this._scripts && this._scripts[activeScript] && this._runningScript == null) {
                    logger.info(`[${this.config.username}] 断线恢复脚本: ${activeScript}`);
                    this.startScript(activeScript);
                }
            } catch (err) {
                logger.error(`[${this.config.username}] 模块恢复失败:`, err.message);
            }
        }, RESTORE_DELAY));
    }

    handleReconnect() {
        if (this.isExplicitlyQuitting) return;

        // 用户关闭了自动重连：断线后不再重连（fatal 之外的主动选择）
        if (this.config.settings?.autoReconnect === false) {
            logger.info(`[${this.config.username}] 自动重连已关闭，断开后不重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: '已关闭自动重连'
            });
            return;
        }

        // 不可恢复的断开（被ban/白名单/版本不符等）：停止重连并通知，不消耗重试次数
        if (this._fatalReason) {
            logger.error(`[${this.config.username}] 不可恢复的断开(${this._fatalReason})，停止重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: `已停止重连：${this._fatalReason}`
            });
            return;
        }

        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`[${this.config.username}] 达到最大重连次数(${this.maxReconnectAttempts})，停止重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: '达到最大重连次数，已停止重连'
            });
            return;
        }

        this.reconnectAttempts++;
        const baseDelay = this.config.settings?.reconnectDelay || 5;
        const delay = baseDelay * this.reconnectBackoff;
        this.reconnectBackoff = Math.min(this.reconnectBackoff * 1.5, 10);

        logger.info(`[${this.config.username}] 将在 ${delay.toFixed(1)}秒后重连 (第${this.reconnectAttempts}次尝试)`);

        this.reconnectTimer = setTimeout(() => this.init(), delay * 1000);
    }

    setupEvents() {
        if (!this.bot) return;

        // 优化消息处理逻辑
        this.bot.on('message', (jsonMsg, position) => {
            // 保留 §/§x 颜色与格式码（前端渲染彩色）；尾部 ANSI 清洗对 §motd 无副作用
            const raw = (typeof jsonMsg.toMotd === "function" ? jsonMsg.toMotd() : jsonMsg.toString()).replace(/\u001b\[[0-9;]*m/g, '');
            if (!raw.trim()) return;

            // actionbar（物品栏上方文本，position=game_info）：单独存最新值，不当聊天刷屏
            if (position === 'game_info') {
                this._actionBar = { text: raw.replace(/§[0-9a-fk-orx]/gi, '').trim(), at: Date.now() };
                return;
            }

            this.msgBuffer += raw + "\n";
            if (this.msgTimeout) clearTimeout(this.msgTimeout);
            this.msgTimeout = setTimeout(() => {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username,
                    ownerId: this.config.ownerId,
                    msg: this.msgBuffer.trim(),
                    time: new Date().toLocaleTimeString(),
                    chat: true // 服务器聊天（区别于机器人操作日志）
                });
                this.msgBuffer = "";
            }, 100);
        });

        this.bot.on('end', () => {
            logger.warn(`[${this.config.username}] 连接已断开`);
            this.io.to(this._room).to('admin').emit('status', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                online: false
            });
            this.cleanup();
            this.handleReconnect();
        });

        this.bot.on('error', (err) => logger.error(`[${this.config.username}] 核心错误:`, err.message));

        // 解析踢出原因：命中"不可恢复"关键词则标记，handleReconnect 据此停止重连（避免无意义重连）
        this.bot.on('kicked', (reason) => {
            const text = extractText(reason).replace(/§[0-9a-fk-orx]/gi, '').trim();
            logger.warn(`[${this.config.username}] 被踢出: ${text || '(无原因)'}`);
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: `被服务器踢出: ${text || '(无原因)'}`, time: new Date().toLocaleTimeString()
            });
            if (isFatalKick(reason)) this._fatalReason = text || '不可恢复的断开';
        });

        // 自动复活：mineflayer 默认死亡即自动重生（无需手动）。此处仅记录可见日志，
        // 并在复活后按需执行回点指令（多世界 RPG 服死亡会回主城，用 /back、/spawn 等返回）。
        this.bot.on('death', () => {
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: '机器人死亡，正在自动复活…', time: new Date().toLocaleTimeString()
            });
            const respawnCmd = this.config.settings?.respawnCommand?.trim();
            if (respawnCmd) {
                const epoch = this._epoch;
                this.timers.push(setTimeout(() => {
                    if (this._epoch !== epoch || !this.bot) return;
                    // API-1：复活指令也过安全过滤（防有人把 /op 之类塞进 respawnCommand 绕过唯一防线）
                    if (isChatBlocked(respawnCmd)) {
                        logger.warn(`[${this.config.username}] 复活指令被安全过滤拦截，已跳过: ${respawnCmd}`);
                        return;
                    }
                    this.bot.chat(respawnCmd);
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: `复活后执行: ${respawnCmd}`, time: new Date().toLocaleTimeString()
                    });
                }, 1500));
            }
        });
    }

    /**
     * 核心修复：必须将 combatConfig 完整推送到前端，否则 UI 无法渲染配置界面
     * 增加 ownerId 用于前端过滤
     */
    updateStatus() {
        if (!this.bot?.entity) return;
        const pos = this.bot.entity.position;
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
        const sig = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}|${this.bot.health}|${this.bot.food}|${this.bot.experience?.level || 0}|${pingBucket}|${this.savedLocations.length}|${JSON.stringify(modules)}`;
        const now = Date.now();
        if (sig === this._lastStatusSig && now - this._lastStatusEmitAt < 30000) return;
        this._lastStatusSig = sig;
        this._lastStatusEmitAt = now;
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
    }

    // minecraft-data 单例缓存（按版本）：避免各模块各自重复 require/实例化（重活，尤其高频调用处）。
    getMcData() {
        const v = this.bot?.version;
        if (!this._mcData || this._mcDataVersion !== v) {
            this._mcData = require('minecraft-data')(v);
            this._mcDataVersion = v;
        }
        return this._mcData;
    }

    // 构建寻路移动策略。
    // 默认「无破坏模式」：不挖方块、不搭脚手架、不搭柱子——多数服务器地图受保护，
    // 挖/搭都会失败并让寻路反复卡死。设 settings.allowDig=true 可恢复破坏式寻路（自建/创造服适用）。
    makeMovements() {
        const mcData = this.getMcData();
        const m = new Movements(this.bot, mcData);
        const allowDig = !!this.config.settings?.allowDig;
        m.canDig = allowDig;
        if (!allowDig) {
            m.scafoldingBlocks = []; // 不放置脚手架方块
            m.allow1by1towers = false; // 不搭柱子
        }
        return m;
    }

    // 把当前的移动策略应用到 pathfinder（登录后及切换破坏模式时调用）。
    applyMovements() {
        try {
            if (this.bot?.pathfinder) this.bot.pathfinder.setMovements(this.makeMovements());
        } catch (e) {
            logger.error(`[${this.config.username}] 应用寻路策略失败:`, e.message);
        }
    }

    // 寻路实现
    move(x, y, z) {
        if (this.bot?.pathfinder) {
            this.bot.pathfinder.setMovements(this.makeMovements());
            this.bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));

            const mode = this.config.settings?.allowDig ? '破坏' : '无破坏';
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                msg: `启动寻路至 ${x}, ${y}, ${z}（${mode}模式）`,
                time: new Date().toLocaleTimeString()
            });
        }
    }

    // 辅助存盘：供模块（如 fishing.js）在自动关闭时调用
    saveConfig() {
        if (typeof this.saveCallback === 'function') {
            this.saveCallback();
        }
    }

    cleanup() {
        // 1. 调用所有模块的清理钩子
        if (this.cleanupHooks && this.cleanupHooks.length > 0) {
            this.cleanupHooks.forEach(hook => {
                try {
                    hook();
                } catch (err) {
                    logger.error(`[${this.config.username}] 模块清理失败:`, err.message);
                }
            });
            // 清空钩子数组，准备下次重新注册
            this.cleanupHooks = [];
        }

        // 2. 清理所有定时器
        if (this.timers && this.timers.length > 0) {
            this.timers.forEach(timer => {
                try {
                    clearTimeout(timer);
                    clearInterval(timer);
                } catch (err) {
                    // 忽略清理失败的定时器
                }
            });
            this.timers = [];
        }

        // 3. 清理消息缓冲定时器
        if (this.msgTimeout) {
            clearTimeout(this.msgTimeout);
            this.msgTimeout = null;
            this.msgBuffer = "";
        }

        // 4. 清理重连和状态定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = null;
        }

        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }

        // 5. 清理bot实例
        if (this.bot) {
            this.bot.removeAllListeners();
            try {
                this.bot.quit();
            } catch (e) {
                // 忽略quit失败
            }
            this.bot = null;
        }

        logger.info(`[${this.config.username}] 资源已清理`);
    }

    stop() {
        this.isExplicitlyQuitting = true;
        this.destroyed = true;          // 置销毁标记：任何延迟回调/陈旧定时器触发的 init() 都会 bail(CORE-1)
        this.cleanup();
        this.io.to(this._room).to('admin').emit('status', { user: this.config.username, ownerId: this.config.ownerId, online: false });
    }

    reconnect() {
        logger.info(`[${this.config.username}] 手动重连请求`);
        this.isExplicitlyQuitting = false;
        this.destroyed = false;         // 手动重连：撤销 stop() 的销毁标记
        this._fatalReason = null;       // 手动重连：清除致命标记，重新尝试
        this.reconnectAttempts = 0;
        this.reconnectBackoff = 1;
        this.cleanup();
        // 句柄入 this.reconnectTimer（cleanup 会清它）：随后的 stop()/delete 能取消，杜绝已停止的 bot 被复活(CORE-1)
        this.reconnectTimer = setTimeout(() => this.init(), 1000);
    }

    // 地点管理功能
    saveLocation(name, command, steps) {
        if (!this.bot?.entity) {
            return { success: false, error: '机器人未在线' };
        }

        if (this.savedLocations.length >= 5) {
            return { success: false, error: '已达到最大保存数量（5个）' };
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
    }

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
    }

    goToLocation(locationId) {
        const location = this.savedLocations.find(loc => loc.id === locationId);
        if (!location) {
            return { success: false, error: '地点不存在' };
        }

        // 优先：到达脚本（开菜单→点地点等，GUI/多世界传送通用，回放完整动作序列）
        if (Array.isArray(location.steps) && location.steps.length && typeof this.runSteps === 'function') {
            return this.runSteps(location.steps, `前往「${location.name}」`);
        }

        // 其次：前置指令切图，延迟后再寻路（多世界）
        if (location.command) {
            // API-1：地点 warp 指令也过安全过滤（与 respawn 同理，堵命令注入旁路）
            if (isChatBlocked(location.command)) {
                return { success: false, error: '到达指令被安全过滤拦截' };
            }
            this.bot.chat(location.command);
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                msg: `切图指令: ${location.command}，2.5秒后寻路`,
                time: new Date().toLocaleTimeString()
            });
            const epoch = this._epoch;
            this.timers.push(setTimeout(() => {
                if (this._epoch === epoch && this.bot?.entity) this.move(location.x, location.y, location.z);
            }, 2500));
        } else {
            // 兜底：当前世界内寻路到坐标
            this.move(location.x, location.y, location.z);
        }
        return { success: true, location };
    }

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
    }
}

module.exports = BotInstance;