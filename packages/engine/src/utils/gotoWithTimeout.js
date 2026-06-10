// 寻路助手：带超时；超时/失败则取消寻路(setGoal(null))并吞掉败者 promise。
// 修复面：pathfinder.goto 对「不可达目标」可能永不 resolve/reject —— 裸 await 会永久挂起调用方
//（automine 卡死在 APPROACH/ADVANCE、openContainerAt 永久挂死等）。超时一律以 throw 形式暴露，
// 由调用方按各自语义处理（熔断/跳过/继续尝试开箱）。
module.exports = async function gotoWithTimeout(bot, goal, timeoutMs = 20000) {
    let timer;
    const pathing = bot.pathfinder.goto(goal);
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('寻路超时')), timeoutMs);
    });
    try {
        await Promise.race([pathing, timeout]);
    } catch (e) {
        try { bot.pathfinder.setGoal(null); } catch (_) { /* ignore */ }
        pathing.catch(() => {}); // 吞掉败者后续 reject（setGoal(null) 会让它以 GoalChanged 拒绝）
        throw e;
    } finally {
        clearTimeout(timer);
    }
    pathing.catch(() => {}); // 正常胜出时保险吞错
};
