const Vec3 = require('vec3');

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const { goals, Movements } = require('mineflayer-pathfinder');

    // 缓存 mcData，兼容 1.12.2（无 bot.registry）和 1.13+
    const getMcData = () => botInstance.getMcData(); // 复用实例级单例缓存

    // 创建 Movements：优先用实例统一的「无破坏模式」策略（受保护服不挖不搭，避免追怪寻路卡死）
    const createMovements = () => {
        try {
            if (typeof botInstance.makeMovements === 'function') return botInstance.makeMovements();
        } catch (e) { /* 回退到默认构造 */ }
        try {
            return new Movements(bot, bot.registry || getMcData());
        } catch (e) {
            return new Movements(bot, getMcData());
        }
    };

    botInstance.mobHunterTask = {
        active: false,
        mode: 'keyword',
        keywords: [],
        blacklist: ['armor_stand', 'item', 'item_frame', 'painting', 'experience_orb'],
        huntArea: null,
        returnPoint: null,
        safetyEnabled: true,
        playerDetectRadius: 16,
        attackRange: 4.5,
        chaseTimeout: 10000,
        canDig: false,
        canPlace: false,
        autoReturnOnDeath: true,
        stopOnDeath: false,
        maxDeaths: 0,
        currentTarget: null,
        lastPosition: null,
        isDead: false,
        pausedByPlayer: false,
        stats: { kills: {}, totalKills: 0, deaths: 0, startTime: null, playersDetected: 0 },
        timer: null,
        safetyCheckTimer: null
    };

    // ===== 反作弊 / 拉扯 / 共存 状态 =====
    const ATTACK_BASE = 620;          // 基础攻击间隔 ms（适配 1.9+ 攻击冷却）
    const ATTACK_JITTER = 90;         // 间隔抖动幅度 ms
    const REACTION_MIN = 180;         // 锁定后最小反应延迟 ms
    const REACTION_RANGE = 220;       // 反应延迟随机区间 ms
    const KITE_OFFSET_NEAR = 0.9;     // 距离 < range - 此值 → 后撤
    const KITE_OFFSET_FAR = 0.3;      // 追击目标距离 = range - 此值
    const COMPETE_RADIUS = 8;         // 其他玩家此距离内的怪不抢
    const HURT_BY_PLAYER_TTL = 5000;  // 被玩家打过的怪冷却 ms
    const RESUME_COOLDOWN_MIN = 5000; // 玩家离开后恢复冷启动下限
    const RESUME_COOLDOWN_RANGE = 5000;
    const IDLE_SCAN_MIN = 3000;
    const IDLE_SCAN_RANGE = 4000;
    const DAMAGE_HISTORY_TTL = 30000;
    const KILL_CREDIT_WINDOW = 1500;  // 实体消失前 N ms 内打过才算击杀
    const KILL_CREDIT_DISTANCE = 5;

    let lastAttackAt = 0;
    let attackCooldown = ATTACK_BASE;
    let targetAcquiredAt = 0;
    let lastGoalTargetId = null;
    let lastSetGoalAt = 0;
    let cachedMovements = null;
    let cycleRunning = false;
    let resumeAfter = 0;
    let lastIdleScanAt = 0;
    let prevCombatEnabled = null; // 互斥：记录杀戮光环原状态
    let hunterListenersAttached = false;
    const damageHistory = new Map(); // id -> { lastHitAt, lastDistance, name, hurtByPlayerAt }

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };

    const matchesKeywords = (entityName, keywords) => {
        if (!keywords || keywords.length === 0) return false;
        const lowerName = entityName.toLowerCase();
        return keywords.some(k => lowerName.includes(k.toLowerCase().trim()));
    };

    const isBlacklisted = (entityName) => {
        const lowerName = entityName.toLowerCase();
        return botInstance.mobHunterTask.blacklist.some(item => lowerName.includes(item.toLowerCase()));
    };

    const getEntityDisplayName = (entity) => {
        if (!entity) return 'unknown';
        try {
            if (entity.metadata && entity.metadata[2]) {
                const customName = entity.metadata[2];
                if (typeof customName === 'string' && customName.length > 0) {
                    return customName.replace(/§[0-9a-fk-orx]/gi, '').replace(/[{}"]/g, '').trim();
                }
                if (customName && typeof customName === 'object') {
                    if (customName.text) return customName.text;
                    if (customName.extra && customName.extra[0]) return customName.extra[0].text || String(customName.extra[0]);
                }
            }
        } catch (e) {}
        return entity.customName || entity.displayName || entity.name || 'unknown';
    };

    const isValidTarget = (entity) => {
        if (!entity || !entity.position) return false;
        if (entity.type === 'player' || entity.type === 'object' ||
            entity.type === 'orb' || entity.type === 'other') return false;

        const task = botInstance.mobHunterTask;
        const entityName = getEntityDisplayName(entity);

        if (task.mode === 'keyword') {
            return matchesKeywords(entityName, task.keywords);
        }
        if (task.mode === 'all_mobs') {
            if (entity.type === 'player' || entity.username) return false;
            return !isBlacklisted(entityName);
        }
        return false;
    };

    const isInHuntArea = (position) => {
        const area = botInstance.mobHunterTask.huntArea;
        if (!area) return true;
        try {
            if (area.center && area.radius) {
                return position.distanceTo(new Vec3(area.center.x, area.center.y, area.center.z)) <= area.radius;
            }
            if (area.x1 !== undefined) {
                return position.x >= area.x1 && position.x <= area.x2 &&
                       position.z >= area.z1 && position.z <= area.z2 &&
                       position.y >= area.y1 && position.y <= area.y2;
            }
        } catch (e) {}
        return true;
    };

    const findNearbyPlayers = () => {
        if (!bot.entity) return [];
        const radius = botInstance.mobHunterTask.playerDetectRadius;
        const out = [];
        for (const e of Object.values(bot.entities)) {
            if (e.type !== 'player' || e.username === bot.username) continue;
            try {
                if (bot.entity.position.distanceTo(e.position) <= radius) out.push(e);
            } catch (err) {}
        }
        return out;
    };

    // ===== 反作弊辅助 =====
    const computeAttackDelay = () => {
        // 近似高斯：两次 random 求和减 1 → [-1,1] 偏向 0
        const jitter = (Math.random() + Math.random() - 1) * ATTACK_JITTER;
        let delay = ATTACK_BASE + jitter;
        if (Math.random() < 0.015) delay += 180; // 偶发漏点
        return Math.max(480, delay);
    };

    const aimWithJitter = (entity) => {
        try {
            const h = entity.height || 1.8;
            const yOff = h * (0.78 + (Math.random() - 0.5) * 0.1);
            const xJ = (Math.random() - 0.5) * 0.16;
            const zJ = (Math.random() - 0.5) * 0.16;
            return bot.lookAt(entity.position.offset(xJ, yOff, zJ), false);
        } catch (e) {}
    };

    const hasLineOfSight = (entity) => {
        try {
            if (!bot.world || !bot.world.raycast) return true;
            const eye = bot.entity.position.offset(0, (bot.entity.height || 1.8) * 0.9, 0);
            const target = entity.position.offset(0, (entity.height || 1.8) * 0.5, 0);
            const dir = target.minus(eye);
            const dist = dir.norm();
            if (dist < 0.5) return true;
            const hit = bot.world.raycast(eye, dir.scaled(1 / dist), Math.min(dist, 6));
            return !hit;
        } catch (e) { return true; }
    };

    // ===== Movements 缓存 =====
    const getMovements = () => {
        if (!cachedMovements) {
            cachedMovements = createMovements();
            cachedMovements.canDig = botInstance.mobHunterTask.canDig;
            cachedMovements.canPlace = botInstance.mobHunterTask.canPlace;
        }
        return cachedMovements;
    };
    const invalidateMovements = () => { cachedMovements = null; lastGoalTargetId = null; };

    const setKiteGoal = (entity, distance) => {
        try {
            if (!bot.pathfinder) return;
            const now = Date.now();
            // 同目标 500ms 内不重复 setGoal，避免 pathfinder 反复重算
            if (lastGoalTargetId === entity.id && now - lastSetGoalAt < 500) return;
            if (lastGoalTargetId !== entity.id) {
                bot.pathfinder.setMovements(getMovements());
                lastGoalTargetId = entity.id;
            }
            bot.pathfinder.setGoal(new goals.GoalFollow(entity, distance), true);
            lastSetGoalAt = now;
        } catch (e) {}
    };

    const clearGoal = () => {
        try {
            if (bot.pathfinder && bot.pathfinder.goal) {
                bot.pathfinder.setGoal(null);
                lastGoalTargetId = null;
            }
        } catch (e) {}
    };

    const idleScan = () => {
        const now = Date.now();
        if (now - lastIdleScanAt < IDLE_SCAN_MIN + Math.random() * IDLE_SCAN_RANGE) return;
        lastIdleScanAt = now;
        try {
            const yawDelta = (Math.random() - 0.5) * Math.PI * 0.6; // ±54°
            const newYaw = bot.entity.yaw + yawDelta;
            const pitch = (Math.random() - 0.5) * 0.3;
            bot.look(newYaw, pitch, false);
        } catch (e) {}
    };

    // ===== 选目标（含共存过滤） =====
    const findBestTarget = () => {
        if (!bot.entity) return null;
        const task = botInstance.mobHunterTask;
        const now = Date.now();
        const maxDistance = 32;
        const myPos = bot.entity.position;

        // 一次遍历同时收集玩家和候选
        const players = [];
        const candidates = [];
        for (const e of Object.values(bot.entities)) {
            if (!e || !e.position) continue;
            if (e.type === 'player') {
                if (e.username !== bot.username) players.push(e.position);
                continue;
            }
            if (!isValidTarget(e)) continue;
            if (!isInHuntArea(e.position)) continue;
            const d = myPos.distanceTo(e.position);
            if (d > maxDistance) continue;
            const dmg = damageHistory.get(e.id);
            if (dmg && dmg.hurtByPlayerAt && now - dmg.hurtByPlayerAt < HURT_BY_PLAYER_TTL) continue;
            candidates.push({ entity: e, d });
        }

        if (candidates.length === 0) return null;

        // 过滤被其他玩家围着的怪
        const filtered = candidates.filter(c => {
            for (const pp of players) {
                if (pp.distanceTo(c.entity.position) <= COMPETE_RADIUS) return false;
            }
            return true;
        });
        const pool = filtered.length > 0 ? filtered : []; // 没"干净"的就不打，让位

        if (pool.length === 0) return null;

        // 保持当前目标
        if (task.currentTarget) {
            const cur = pool.find(c => c.entity.id === task.currentTarget.id);
            if (cur) return cur.entity;
        }

        pool.sort((a, b) => a.d - b.d);
        return pool[0].entity;
    };

    // ===== 攻击（拉扯环 + 反作弊） =====
    const attackTarget = async (target) => {
        if (!target || !bot.entity) return false;
        const entity = bot.entities[target.id];
        if (!entity || !entity.position) return false;

        const task = botInstance.mobHunterTask;
        const now = Date.now();

        // 反应延迟：刚锁定不立刻动手；期间已开始平滑转头
        const reactionMs = REACTION_MIN + Math.random() * REACTION_RANGE;
        if (now - targetAcquiredAt < reactionMs) {
            aimWithJitter(entity);
            return false;
        }

        const distance = bot.entity.position.distanceTo(entity.position);
        const range = task.attackRange;
        const idealNear = range - KITE_OFFSET_NEAR;
        const followDist = range - KITE_OFFSET_FAR;

        // 太近 → 后撤
        if (distance < idealNear) {
            clearGoal();
            try {
                bot.setControlState('forward', false);
                bot.setControlState('sprint', false);
                bot.setControlState('back', true);
            } catch (e) {}
            aimWithJitter(entity);
            return false;
        }
        // 进入打击窗口前先放开后撤
        try { bot.setControlState('back', false); } catch (e) {}

        // 太远 → 让 pathfinder 接近
        if (distance > range) {
            setKiteGoal(entity, followDist);
            return false;
        }

        // 在打击窗口 → 停 pathfinder（防止一直推进贴脸）
        clearGoal();

        // 攻击冷却：等冷却时偶尔微调瞄准，模拟手部微动
        if (now - lastAttackAt < attackCooldown) {
            if (Math.random() < 0.35) aimWithJitter(entity);
            return false;
        }

        // LOS：隔墙不挥拳，绕过去
        if (!hasLineOfSight(entity)) {
            setKiteGoal(entity, followDist);
            return false;
        }

        // 平滑瞄准（await 让视角到位再 attack，类人）
        try { await aimWithJitter(entity); } catch (e) {}

        // 攻击瞬间确认实体仍在
        const live = bot.entities[entity.id];
        if (!live) return false;

        try { bot.attack(live); } catch (e) { return false; }

        // 记录命中（死亡判定用）
        const rec = damageHistory.get(entity.id) || {};
        rec.lastHitAt = Date.now();
        rec.lastDistance = distance;
        rec.name = getEntityDisplayName(live);
        damageHistory.set(entity.id, rec);

        lastAttackAt = Date.now();
        attackCooldown = computeAttackDelay();
        return true;
    };

    // ===== 击杀结算 =====
    const creditKillIfRecent = (id) => {
        const rec = damageHistory.get(id);
        if (!rec || !rec.lastHitAt) { damageHistory.delete(id); return; }
        const recent = Date.now() - rec.lastHitAt < KILL_CREDIT_WINDOW;
        const close = (rec.lastDistance || 99) < KILL_CREDIT_DISTANCE;
        damageHistory.delete(id);
        if (!recent || !close) return; // 走失/卸载，不算
        const name = rec.name || 'unknown';
        const task = botInstance.mobHunterTask;
        task.stats.kills[name] = (task.stats.kills[name] || 0) + 1;
        task.stats.totalKills++;
        emitLog(`击杀 ${name} [总计: ${task.stats.totalKills}]`);
    };

    const handleEntityDead = (entity) => {
        if (!botInstance.mobHunterTask.active || !entity) return;
        if (damageHistory.has(entity.id)) creditKillIfRecent(entity.id);
        const cur = botInstance.mobHunterTask.currentTarget;
        if (cur && cur.id === entity.id) botInstance.mobHunterTask.currentTarget = null;
    };

    const handleEntityGone = (entity) => {
        if (!botInstance.mobHunterTask.active || !entity) return;
        if (damageHistory.has(entity.id)) creditKillIfRecent(entity.id);
        const cur = botInstance.mobHunterTask.currentTarget;
        if (cur && cur.id === entity.id) botInstance.mobHunterTask.currentTarget = null;
    };

    // 标记被其他玩家打过的怪 → 不抢
    const handleEntityHurt = (entity) => {
        if (!botInstance.mobHunterTask.active || !entity || !entity.position) return;
        if (entity.type === 'player') return;
        for (const e of Object.values(bot.entities)) {
            if (e.type === 'player' && e.username !== bot.username && e.position) {
                try {
                    if (e.position.distanceTo(entity.position) <= 10) {
                        const rec = damageHistory.get(entity.id) || {};
                        rec.hurtByPlayerAt = Date.now();
                        damageHistory.set(entity.id, rec);
                        // 当前目标被别人打了 → 让出
                        const cur = botInstance.mobHunterTask.currentTarget;
                        if (cur && cur.id === entity.id) {
                            botInstance.mobHunterTask.currentTarget = null;
                            clearGoal();
                        }
                        return;
                    }
                } catch (err) {}
            }
        }
    };

    // ===== 安全检查 + damageHistory GC =====
    const safetyCheck = () => {
        const task = botInstance.mobHunterTask;
        if (!task.active) return;

        // GC：清理过期 damageHistory
        const cutoff = Date.now() - DAMAGE_HISTORY_TTL;
        for (const [id, rec] of damageHistory) {
            const t = Math.max(rec.lastHitAt || 0, rec.hurtByPlayerAt || 0);
            if (t < cutoff) damageHistory.delete(id);
        }

        if (!task.safetyEnabled || !bot.entity) return;
        const nearbyPlayers = findNearbyPlayers();

        if (nearbyPlayers.length > 0) {
            if (!task.pausedByPlayer) {
                task.pausedByPlayer = true;
                task.stats.playersDetected++;
                task.currentTarget = null;
                clearGoal();
                try { bot.clearControlStates(); } catch (e) {}
                const names = nearbyPlayers.map(p => p.username).join(', ');
                emitLog(`检测到玩家 [${names}]，暂停追怪`);
            }
        } else if (task.pausedByPlayer) {
            task.pausedByPlayer = false;
            const wait = RESUME_COOLDOWN_MIN + Math.random() * RESUME_COOLDOWN_RANGE;
            resumeAfter = Date.now() + wait;
            emitLog(`玩家已离开，${Math.floor(wait / 1000)} 秒后恢复`);
        }
    };

    // ===== 主循环 =====
    const huntCycle = async () => {
        const task = botInstance.mobHunterTask;
        if (!task.active || !bot.entity) return;
        if (task.pausedByPlayer || task.isDead) return;
        if (Date.now() < resumeAfter) { idleScan(); return; }
        if (cycleRunning) return;
        cycleRunning = true;

        try {
            if (!isInHuntArea(bot.entity.position)) {
                if (task.returnPoint) {
                    const rp = task.returnPoint;
                    try {
                        bot.pathfinder.setMovements(getMovements());
                        bot.pathfinder.setGoal(new goals.GoalBlock(
                            Math.floor(rp.x), Math.floor(rp.y), Math.floor(rp.z)
                        ));
                    } catch (e) {}
                }
                return;
            }

            let target = task.currentTarget;
            if (target) {
                const entity = bot.entities[target.id];
                if (!entity) {
                    // 实体消失 → entityGone 已处理结算
                    target = null;
                    task.currentTarget = null;
                } else if (!isInHuntArea(entity.position)) {
                    target = null;
                    task.currentTarget = null;
                    clearGoal();
                }
            }

            if (!target) {
                target = findBestTarget();
                if (target) {
                    task.currentTarget = target;
                    targetAcquiredAt = Date.now();
                    emitLog(`锁定目标: ${getEntityDisplayName(target)}`);
                } else {
                    idleScan();
                }
            }

            if (target) await attackTarget(target);
        } catch (err) {
            // 单次循环异常不影响后续
        } finally {
            cycleRunning = false;
        }
    };

    const handleDeath = () => {
        if (!botInstance.mobHunterTask.active) return;
        const task = botInstance.mobHunterTask;
        task.isDead = true;
        task.stats.deaths++;
        try { task.lastPosition = bot.entity.position.clone(); } catch (e) {}
        damageHistory.clear();
        try { bot.clearControlStates(); } catch (e) {}

        emitLog(`机器人死亡 (第${task.stats.deaths}次)`);

        if (task.maxDeaths > 0 && task.stats.deaths >= task.maxDeaths) {
            emitLog(`达到最大死亡次数(${task.maxDeaths})，自动停止追怪`);
            botInstance.toggleMobHunter(false);
            return;
        }
        if (task.stopOnDeath) {
            emitLog(`死亡后自动停止追怪`);
            botInstance.toggleMobHunter(false);
            return;
        }

        botInstance.io.to(botInstance._room).to('admin').emit('mob_hunter_death', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            deathCount: task.stats.deaths, lastPosition: task.lastPosition,
            autoReturn: task.autoReturnOnDeath
        });
    };

    // 从实例 timers 数组移除一个已 clear 的句柄，避免反复 toggle 时数组无界堆积失效句柄(MODA-2)
    const dropTimer = (t) => {
        if (!botInstance.timers || t == null) return;
        const i = botInstance.timers.indexOf(t);
        if (i >= 0) botInstance.timers.splice(i, 1);
    };

    const handleRespawn = () => {
        if (!botInstance.mobHunterTask.isDead) return;
        botInstance.mobHunterTask.isDead = false;
        botInstance.mobHunterTask.currentTarget = null;
        emitLog(`机器人已重生`);

        if (botInstance.mobHunterTask.autoReturnOnDeath && botInstance.mobHunterTask.active) {
            // MODA-1：句柄入 timers（断线/cleanup 可取消），回调加 bot.entity 守卫，防对已拆除的 bot 操作
            botInstance.timers = botInstance.timers || [];
            botInstance.timers.push(setTimeout(() => {
                if (bot.entity && botInstance.mobHunterTask.active && !botInstance.mobHunterTask.isDead) {
                    botInstance.returnToHuntArea();
                }
            }, 2000));
        } else {
            emitLog(`等待手动返回追怪区域...`);
        }
    };

    botInstance.returnToHuntArea = () => {
        if (!botInstance.mobHunterTask.active || !bot.entity) return;
        const returnPoint = botInstance.mobHunterTask.returnPoint || botInstance.mobHunterTask.lastPosition;
        if (!returnPoint) {
            emitLog(`没有设置返回点，无法返回`);
            return;
        }
        emitLog(`正在返回追怪区域 (${Math.floor(returnPoint.x)}, ${Math.floor(returnPoint.y)}, ${Math.floor(returnPoint.z)})`);

        try {
            bot.pathfinder.setMovements(getMovements());
            bot.pathfinder.setGoal(new goals.GoalBlock(
                Math.floor(returnPoint.x), Math.floor(returnPoint.y), Math.floor(returnPoint.z)
            ));
        } catch (e) {
            emitLog(`返回失败: ${e.message}`);
        }
    };

    botInstance.getMobHunterStats = () => {
        const stats = botInstance.mobHunterTask.stats;
        if (!stats.startTime) return null;
        const runTime = (Date.now() - stats.startTime) / 1000 / 60;
        return {
            mode: botInstance.mobHunterTask.mode,
            keywords: botInstance.mobHunterTask.keywords,
            totalKills: stats.totalKills,
            killsByType: stats.kills,
            deaths: stats.deaths,
            playersDetected: stats.playersDetected,
            runTime: Math.floor(runTime),
            killRate: (stats.totalKills / Math.max(runTime, 1)).toFixed(2),
            currentTarget: botInstance.mobHunterTask.currentTarget ? getEntityDisplayName(botInstance.mobHunterTask.currentTarget) : '无',
            isPaused: botInstance.mobHunterTask.pausedByPlayer
        };
    };

    botInstance.toggleMobHunter = (active, config = {}) => {
        const task = botInstance.mobHunterTask;
        task.active = active;

        if (config.mode) task.mode = config.mode;
        if (config.keywords !== undefined) {
            task.keywords = Array.isArray(config.keywords)
                ? config.keywords : String(config.keywords).split(',').map(k => k.trim()).filter(k => k);
        }
        if (config.blacklist !== undefined) {
            task.blacklist = Array.isArray(config.blacklist)
                ? config.blacklist : String(config.blacklist).split(',').map(k => k.trim()).filter(k => k);
        }
        if (config.huntArea !== undefined) task.huntArea = config.huntArea;
        if (config.returnPoint !== undefined) task.returnPoint = config.returnPoint;
        if (config.safetyEnabled !== undefined) task.safetyEnabled = config.safetyEnabled;
        if (config.playerDetectRadius !== undefined) task.playerDetectRadius = config.playerDetectRadius;
        if (config.attackRange !== undefined) task.attackRange = config.attackRange;
        if (config.canDig !== undefined) { task.canDig = config.canDig; invalidateMovements(); }
        if (config.canPlace !== undefined) { task.canPlace = config.canPlace; invalidateMovements(); }
        if (config.autoReturnOnDeath !== undefined) task.autoReturnOnDeath = config.autoReturnOnDeath;
        if (config.stopOnDeath !== undefined) task.stopOnDeath = config.stopOnDeath;
        if (config.maxDeaths !== undefined) task.maxDeaths = config.maxDeaths;

        if (active) {
            task.stats = { kills: {}, totalKills: 0, deaths: 0, startTime: Date.now(), playersDetected: 0 };
            task.currentTarget = null;
            task.pausedByPlayer = false;
            task.isDead = false;
            damageHistory.clear();
            lastAttackAt = 0;
            resumeAfter = 0;
            invalidateMovements();

            // 互斥：暂停杀戮光环，避免双攻击循环互相干扰
            if (botInstance.combatConfig && botInstance.combatConfig.enabled) {
                prevCombatEnabled = true;
                botInstance.combatConfig.enabled = false;
                emitLog(`已暂停杀戮光环（互斥）`);
            } else {
                prevCombatEnabled = null;
            }

            if (!task.returnPoint && bot.entity) task.returnPoint = bot.entity.position.clone();

            const modeText = task.mode === 'keyword'
                ? `关键词: ${task.keywords.join(', ')}`
                : `全部怪物 (黑名单: ${task.blacklist.length}个)`;

            emitLog(`启动追怪系统\n  模式: ${modeText}\n  安全检测: ${task.safetyEnabled ? '开启' : '关闭'}\n  攻击范围: ${task.attackRange}格`);

            botInstance.timers = botInstance.timers || [];
            // MODA-2：清掉上一轮旧句柄并从 timers 数组移除，避免反复 toggle 时数组无界堆积失效句柄
            if (task.timer) { clearInterval(task.timer); dropTimer(task.timer); }
            if (task.safetyCheckTimer) { clearInterval(task.safetyCheckTimer); dropTimer(task.safetyCheckTimer); }

            task.timer = setInterval(huntCycle, 350);
            task.safetyCheckTimer = setInterval(safetyCheck, 2000);
            botInstance.timers.push(task.timer);
            botInstance.timers.push(task.safetyCheckTimer);

            if (!hunterListenersAttached) {
                bot.on('death', handleDeath);
                bot.on('respawn', handleRespawn);
                bot.on('entityDead', handleEntityDead);
                bot.on('entityGone', handleEntityGone);
                bot.on('entityHurt', handleEntityHurt);
                hunterListenersAttached = true;
            }
        } else {
            if (task.timer) { clearInterval(task.timer); dropTimer(task.timer); task.timer = null; }
            if (task.safetyCheckTimer) { clearInterval(task.safetyCheckTimer); dropTimer(task.safetyCheckTimer); task.safetyCheckTimer = null; }
            try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
            try { bot.clearControlStates(); } catch (e) {}
            if (hunterListenersAttached) {
                bot.removeListener('death', handleDeath);
                bot.removeListener('respawn', handleRespawn);
                bot.removeListener('entityDead', handleEntityDead);
                bot.removeListener('entityGone', handleEntityGone);
                bot.removeListener('entityHurt', handleEntityHurt);
                hunterListenersAttached = false;
            }
            damageHistory.clear();

            // 还原杀戮光环
            if (prevCombatEnabled === true && botInstance.combatConfig) {
                botInstance.combatConfig.enabled = true;
                emitLog(`已恢复杀戮光环`);
            }
            prevCombatEnabled = null;

            const stats = botInstance.getMobHunterStats();
            if (stats) {
                let detail = '';
                for (const [mob, count] of Object.entries(stats.killsByType)) {
                    detail += `    ${mob}: ${count}个\n`;
                }
                emitLog(`追怪统计\n  运行: ${stats.runTime}分钟\n  总击杀: ${stats.totalKills}个\n${detail}  死亡: ${stats.deaths}次\n  效率: ${stats.killRate}个/分钟\n  玩家检测: ${stats.playersDetected}次`);
            }
            emitLog(`追怪系统已关闭`);
        }
    };

    botInstance.setHuntAreaCircle = (radius) => {
        if (!bot.entity) return { success: false, error: '机器人未在线' };
        const center = bot.entity.position.clone();
        botInstance.mobHunterTask.huntArea = { center: { x: center.x, y: center.y, z: center.z }, radius };
        emitLog(`设置圆形追怪区域\n  中心: (${Math.floor(center.x)}, ${Math.floor(center.y)}, ${Math.floor(center.z)})\n  半径: ${radius}格`);
        return { success: true };
    };

    botInstance.setHuntAreaBox = (x1, y1, z1, x2, y2, z2) => {
        botInstance.mobHunterTask.huntArea = {
            x1: Math.min(x1, x2), x2: Math.max(x1, x2),
            y1: Math.min(y1, y2), y2: Math.max(y1, y2),
            z1: Math.min(z1, z2), z2: Math.max(z1, z2)
        };
        emitLog(`设置矩形追怪区域\n  范围: (${x1},${y1},${z1}) 到 (${x2},${y2},${z2})`);
        return { success: true };
    };

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        const task = botInstance.mobHunterTask;
        task.active = false;
        if (task.timer) { clearInterval(task.timer); task.timer = null; }
        if (task.safetyCheckTimer) { clearInterval(task.safetyCheckTimer); task.safetyCheckTimer = null; }
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
        try { bot.clearControlStates(); } catch (e) {}
        if (hunterListenersAttached) {
            bot.removeListener('death', handleDeath);
            bot.removeListener('respawn', handleRespawn);
            bot.removeListener('entityDead', handleEntityDead);
            bot.removeListener('entityGone', handleEntityGone);
            bot.removeListener('entityHurt', handleEntityHurt);
            hunterListenersAttached = false;
        }
        damageHistory.clear();
    });
};
