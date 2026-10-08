// 触发器判定（从 script_engine.js 的 shouldTrigger 抽出）：
// 时间敏感的纯判定逻辑——schedule 的「同一分钟当天只触发一次」、interval 节流、
// chat_match/damage 的 3 秒消费窗、respawn 一次性标记。时间与状态经 env 注入，可单测。
//
// env:
//   now: Date         —— 当前时间（引擎传 new Date()，测试注入固定值）
//   state: object     —— 触发器可变状态载体（引擎传 botInstance 自身：_scheduleFired/_lastChatTrigger/
//                        _justDamaged/_justRespawned/_triggerLast_* 都挂它上面，读写语义与原实现一致）
//   probe: object     —— bot 运行时探针（读状态回调）：
//     health() / food() / playersNearby() / hostileNearby(dist) / inventoryFull()

function shouldTrigger(trigger, name, env) {
    if (!trigger) return false;
    const { state, probe } = env;
    const now = env.now || new Date();
    const nowMs = now.getTime();

    switch (trigger.type) {
        case 'schedule': {
            const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            const want = trigger.time || trigger.value; // 可视化编辑器存 value，旧数据存 time
            if (!want || time !== want) return false;
            const today = now.toDateString();
            state._scheduleFired = state._scheduleFired || {};
            if (state._scheduleFired[want] === today) return false;
            state._scheduleFired[want] = today;
            return true;
        }
        case 'chat_match': {
            const pat = trigger.pattern || trigger.value; // 可视化编辑器存 value
            const flag = state._lastChatTrigger;
            if (flag && pat && flag.pattern === pat && nowMs - flag.time < 3000) {
                state._lastChatTrigger = null;
                return true;
            }
            return false;
        }
        case 'health_below':
            return probe.health() < (Number(trigger.value) || 5);
        case 'food_below':
            return probe.food() < (Number(trigger.value) || 10);
        case 'mob_nearby':
            // 敌对生物进入指定距离（默认 8 格）
            return probe.hostileNearby(Number(trigger.value) || 8);
        case 'damage': {
            // 受到伤害（血量下降时由 health 监听置位，3 秒内消费）
            if (state._justDamaged && nowMs - state._justDamaged < 3000) {
                state._justDamaged = null;
                return true;
            }
            return false;
        }
        case 'respawn':
            if (state._justRespawned) {
                state._justRespawned = false;
                return true;
            }
            return false;
        case 'player_nearby':
            return probe.playersNearby();
        case 'inventory_full':
            return probe.inventoryFull();
        case 'interval': {
            const key = `_triggerLast_${trigger.type}_${name}`;
            const interval = (Number(trigger.seconds ?? trigger.value) || 60) * 1000; // 编辑器存 value
            if (!state[key] || nowMs - state[key] >= interval) {
                state[key] = nowMs;
                return true;
            }
            return false;
        }
        default: return false;
    }
}

module.exports = { shouldTrigger };
