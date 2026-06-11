// 等待「传送真的发生」：发出 /warp、/mv tp 这类切图指令后，固定延迟再寻路是赌博——
// 服务器确认菜单/排队/延迟都会让 2.5 秒不够，传送没完成就开走等于在原世界乱跑。
// 判定信号（任一命中即认为传送完成）：
//   1) 维度变化（原版 overworld/nether/end 之间）
//   2) 位置一次性跳变超过 jumpDist 格（Bukkit 多世界在客户端常仍显示 overworld，只能靠这个）
// 超时返回 false（可能本来就在目的地附近、或指令无效），调用方自行决定是否继续寻路。
module.exports = async function waitForTeleport(bot, { timeoutMs = 8000, jumpDist = 24 } = {}) {
    if (!bot || !bot.entity) return false;
    const from = bot.entity.position.clone();
    const fromDim = bot.game ? bot.game.dimension : null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, 250));
        // 切世界瞬间 entity 可能短暂重建——等下一轮，不要误判失败
        if (!bot.entity) continue;
        try {
            if (bot.game && fromDim && bot.game.dimension !== fromDim) return true;
            if (bot.entity.position.distanceTo(from) > jumpDist) return true;
        } catch (e) { /* entity 半初始化期间属性可能缺失，下一轮再看 */ }
    }
    return false;
};
