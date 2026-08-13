// mineflayer 事件绑定（从 BotInstance.js 抽出）：消息流（actionbar 节流/可点击聊天/缓冲批量）、
// 断线重连挂钩、良性解析错误降噪、踢出致命判定、死亡处理（死亡点/复活指令/死亡返回）。
const logger = require('../utils/logger');
const { isFatalKick, extractText } = require('../utils/reconnectPolicy');
const { isChatBlocked } = require('../utils/chatSafety');
const { extractChatSegments } = require('../utils/chatSegments');

module.exports.mixin = {
    setupEvents() {
        if (!this.bot) return;

        // 优化消息处理逻辑
        this.bot.on('message', (jsonMsg, position) => {
            // 保留 §/§x 颜色与格式码（前端渲染彩色）；尾部 ANSI 清洗对 §motd 无副作用
            const raw = (typeof jsonMsg.toMotd === "function" ? jsonMsg.toMotd() : jsonMsg.toString()).replace(/\u001b\[[0-9;]*m/g, '');
            if (!raw.trim()) return;

            // actionbar（物品栏上方文本，position=game_info）：存最新值（供 AI 观测），
            // 并作为一条日志推到「日志」页和聊天并排显示。去重(文本变才发)+节流(≥1.5s)防 HUD 每 tick 刷屏。
            if (position === 'game_info') {
                const abText = raw.replace(/§./gi, '').trim();
                this._actionBar = { text: abText, at: Date.now() };
                // lite 假人：actionbar 只存值（AI 观测仍可用），不广播日志——RPG 服 HUD 高频变化，
                // 几十只假人各推一份是广播量最大头；假人控制台不需要 HUD 字幕
                if (this.config.settings?.lite) return;
                if (abText && abText !== this._lastAbText && Date.now() - (this._lastAbAt || 0) > 1500) {
                    this._lastAbText = abText;
                    this._lastAbAt = Date.now();
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: raw, // 保留 §色码供前端彩色渲染
                        time: new Date().toLocaleTimeString(),
                        actionbar: true
                    });
                }
                return;
            }

            // 可点击/可悬浮聊天：提取 click(点→执行命令/开链接) / hover(悬浮→展示物品/文字)。
            // 这类通知消息立即作为独立日志发(带 segments,便于前端渲染按钮)，不进 debounce 合并。
            // lite 假人不走直发（RPG 服通知几乎都带 click/hover，会绕过合并窗）——一律进缓冲批量发。
            const segments = [];
            if (!this.config.settings?.lite) {
                try { extractChatSegments(jsonMsg.json || jsonMsg, {}, segments); } catch (_e) { /* ignore */ }
            }
            if (segments.some((s) => s.click || s.hover)) {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: raw, time: new Date().toLocaleTimeString(), chat: true, segments,
                });
                return;
            }

            this.msgBuffer += `${raw}\n`;
            // 固定窗口批量（首条开窗、到点必发，不随新消息重置——重置式防抖在刷屏服会饿死永不冲刷）：
            // 普通 bot 100ms 近实时；lite 假人 3s——同服几十只假人每只都转发同一条聊天，
            // 是「批量撑在线」场景的广播量大头，拉长合并窗把忙服聊天广播降一个数量级（控制台仍可读）
            if (!this.msgTimeout) {
                const flushDelay = this.config.settings?.lite ? 3000 : 100;
                this.msgTimeout = setTimeout(() => {
                    this.msgTimeout = null;
                    if (!this.msgBuffer) return;
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username,
                        ownerId: this.config.ownerId,
                        msg: this.msgBuffer.trim(),
                        time: new Date().toLocaleTimeString(),
                        chat: true // 服务器聊天（区别于机器人操作日志）
                    });
                    this.msgBuffer = "";
                }, flushDelay);
            }
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

        // 模组服(龙核 DragonCore 等)常见：香草协议解析器读不动某些模组包/区块 → 抛 "varint is too big"
        // 等解析错误，但这是【非致命】的——连接不断、bot 照常在线(实测登录后只报一次、随即「连接稳定」)。
        // 故把这类良性解析错误降级：不当「连接出错」报警、每次连接只平静提示一次，避免吓人/刷屏。
        let benignParseWarned = false;
        // E10：logger.warn 限频——模组服解析错误风暴可达 20 次/s，逐条落盘一天能写 100MB 日志。
        // 首条照记，之后 60s 窗口内只计数，窗口结束补一条汇总。
        let benignLogWindowStart = 0;
        let benignSuppressed = 0;
        const BENIGN_PARSE_ERR = /varint is too big|PartialReadError|Chunk size is|Read error for|unexpected buffer end/i;
        this.bot.on('error', (err) => {
            const msg = err?.message ? err.message : String(err);
            if (BENIGN_PARSE_ERR.test(msg)) {
                const now = Date.now();
                if (now - benignLogWindowStart >= 60000) {
                    if (benignSuppressed > 0) {
                        logger.warn(`[${this.config.username}] 过去 60s 内已忽略 ${benignSuppressed} 条良性解析错误`);
                    }
                    benignLogWindowStart = now;
                    benignSuppressed = 0;
                    logger.warn(`[${this.config.username}] 忽略良性解析错误: ${msg}`);
                } else {
                    benignSuppressed++;
                }
                if (!benignParseWarned) {
                    benignParseWarned = true;
                    this.uiLog('ℹ️ 模组服部分世界数据无法解析（已忽略，不影响聊天/钓鱼/指令；走动请用「直发移动」）');
                }
                return;
            }
            logger.error(`[${this.config.username}] 核心错误:`, msg);
            this.uiLog(`连接出错: ${msg}`);
        });

        // 解析踢出原因：命中"不可恢复"关键词则标记，handleReconnect 据此停止重连（避免无意义重连）
        this.bot.on('kicked', (reason) => {
            const text = extractText(reason).replace(/§./gi, '').trim();
            logger.warn(`[${this.config.username}] 被踢出: ${text || '(无原因)'}`);
            // kind 是结构化事件标记：UI 桌面通知按它识别（不再靠匹配中文文案——改文案曾会静默弄哑通知）
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: `被服务器踢出: ${text || '(无原因)'}`, time: new Date().toLocaleTimeString(),
                kind: 'kick'
            });
            this.notifyEvent('kick', `被服务器踢出：${text || '(无原因)'}`);
            if (isFatalKick(reason)) this._fatalReason = text || '不可恢复的断开';
        });

        // 自动复活：mineflayer 默认死亡即自动重生（无需手动）。此处仅记录可见日志，
        // 并在复活后按需执行回点指令（多世界 RPG 服死亡会回主城，用 /back、/spawn 等返回）。
        this.bot.on('death', () => {
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: '机器人死亡，正在自动复活…', time: new Date().toLocaleTimeString(),
                kind: 'death'
            });
            this.notifyEvent('death', '死亡，正在自动复活');
            // 捕获死亡点（用最后一次存活坐标——death 时 entity 常已失效）：供「死亡返回」与脚本变量 {deathX/Y/Z}
            const dp = this._lastAlivePos;
            if (dp) {
                this._deathPos = dp;
                this._scriptVars = this._scriptVars || {};
                this._scriptVars.deathX = Math.round(dp.x);
                this._scriptVars.deathY = Math.round(dp.y);
                this._scriptVars.deathZ = Math.round(dp.z);
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: `已记录死亡点 ${Math.round(dp.x)}, ${Math.round(dp.y)}, ${Math.round(dp.z)}`,
                    time: new Date().toLocaleTimeString()
                });
            }
            const respawnCmd = this.config.settings?.respawnCommand?.trim();
            if (respawnCmd) {
                const epoch = this._epoch;
                this.pushOneShot(() => {
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
                }, 1500);
            }
            // 死亡返回：开关开启且有死亡点 → 等重生+复活指令(若有)生效后，寻路走回死亡点。
            // 模组服寻路可能因 varint 失败（本期不优化）；走不到不卡死（move 只设目标，后台寻路）。
            // 互斥：追怪激活且会自己回区时让位——否则两边各设一次寻路目标（2s 回区、3.5s 回死亡点）互相覆盖来回抖。
            const hunterWillReturn = this.mobHunterTask?.active &&
                this.mobHunterTask.autoReturnOnDeath && !this.mobHunterTask.stopOnDeath;
            if (this.config.settings?.returnOnDeath && dp && hunterWillReturn) {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: '追怪运行中，死亡返回让位给追怪的回区逻辑', time: new Date().toLocaleTimeString()
                });
            } else if (this.config.settings?.returnOnDeath && dp) {
                const epoch = this._epoch;
                this.pushOneShot(() => {
                    if (this._epoch !== epoch || !this.bot?.entity) return;
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: `正在返回死亡点 ${Math.round(dp.x)}, ${Math.round(dp.y)}, ${Math.round(dp.z)}…`,
                        time: new Date().toLocaleTimeString()
                    });
                    this.move(dp.x, dp.y, dp.z);
                }, 3500); // 等重生 + respawnCommand(1.5s) + 服务器传送
            }
        });
    },
};
