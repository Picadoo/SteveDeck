// 机器人视角：用 prismarine-viewer 的 web 模式（浏览器端 three.js 渲染，无原生依赖）
// 按需启动一个轻量 web 服务，前端用 iframe 嵌入即可看到画面。
//
// 切换第一/三人称需要重启 prismarine-viewer（firstPerson 在服务端初始化时确定）。
// 关键：重启时**换一个新端口**，旧端口延迟回收——否则旧 http server 还没释放就在同端口重绑，
// 会抛 EADDRINUSE（异步），让画面坏掉。这就是之前「切人称把视角弄坏」的根因。

const BASE_PORT = 3007;
const MAX_PORT = 3060;
const usedPorts = new Set();
const portOwners = new Map(); // port -> 持有它的 botInstance；池满时据此识别并回收陈旧端口(MODB-6)

// 选一个当前未占用的端口（已占位的会被跳过，所以刚关闭、待回收的旧端口不会被立刻重选）
function pickPort() {
  let port = BASE_PORT;
  while (usedPorts.has(port) && port < MAX_PORT) port++;
  if (usedPorts.has(port)) {
    // 池满兜底(MODB-6)：回收「仍占位但 owner 已不再持有该端口」的陈旧端口（owner 被清理/换端口却没回收成功）。
    // 活动中的视角满足 owner._viewerPort === p，不会被误收。
    for (const p of Array.from(usedPorts)) {
      const owner = portOwners.get(p);
      if (!owner || owner._viewerPort !== p) {
        usedPorts.delete(p);
        portOwners.delete(p);
      }
    }
    port = BASE_PORT;
    while (usedPorts.has(port) && port < MAX_PORT) port++;
  }
  return port;
}

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  // 点击地面寻路开关（持久于实例，跨视角重启保留）。走动/操控模式下前端会关掉它，
  // 这样拖动画面转视角/用摇杆时不会误触发走路。
  if (botInstance._viewerClickWalk === undefined) botInstance._viewerClickWalk = true;
  botInstance.setViewerClickWalk = (enabled) => {
    botInstance._viewerClickWalk = !!enabled;
    return botInstance._viewerClickWalk;
  };

  // per-bot 代际计数（UIFEAT-2/3）：每次 startViewer 自增并记为「当前代」。
  // stopViewer 延迟落地，并只在「调度它时的那一代仍是当前代」才真正释放——
  // 若期间又来一次 start（代际前进），这条 stop 即变 no-op，避免晚到/乱序的 stop 拆掉新实例。
  if (botInstance._viewerGen === undefined) botInstance._viewerGen = 0;
  botInstance._viewerStopTimer = botInstance._viewerStopTimer || null;

  // 立即关闭当前视角服务（内部用）；端口延迟回收，避免紧接着的重启在同端口 rebind 触发 EADDRINUSE
  function closeViewerNow() {
    try {
      if (bot.viewer && bot.viewer.close) bot.viewer.close();
    } catch {
      /* ignore */
    }
    const p = botInstance._viewerPort;
    botInstance._viewerPort = null;
    if (p) {
      portOwners.delete(p); // 立即解除归属（端口本身仍延迟 2s 回收，避免同端口 rebind 触发 EADDRINUSE）
      setTimeout(() => usedPorts.delete(p), 2000);
    }
  }

  // 取消一个已排程但尚未落地的延迟 stop（被新的 start 抢先时调用）
  function cancelPendingStop() {
    if (botInstance._viewerStopTimer) {
      clearTimeout(botInstance._viewerStopTimer);
      botInstance._viewerStopTimer = null;
    }
  }

  // 关闭「当前属于该 bot」的视角实例。代际化 + 延迟落地：
  //  - 记录调用时的「代」gen；微小延迟后再真正释放（让紧随其后的 start 有机会抢先取消）。
  //  - 落地前再校验：仅当 _viewerGen 仍等于 gen（期间没有新的 start）才关闭；否则 no-op。
  // 这样「先 stop 后 start」（前端 cleanup 先于新 effect、socket FIFO 保序）时，新的 start 会
  // cancelPendingStop()，旧 stop 永不落地 → 新实例存活；而真正最后一次 stop（无后继 start）仍会关闭。
  botInstance.stopViewer = () => {
    const gen = botInstance._viewerGen;
    cancelPendingStop(); // 合并连续 stop：只保留最后一次的排程
    if (!botInstance._viewerPort) return true; // 本就没有实例，直接 no-op
    botInstance._viewerStopTimer = setTimeout(() => {
      botInstance._viewerStopTimer = null;
      // 过期 stop（期间已有新的 start 推进代际）→ 不动新实例
      if (botInstance._viewerGen !== gen) return;
      closeViewerNow();
    }, 0);
    return true;
  };

  botInstance.startViewer = (firstPerson = false) => {
    firstPerson = !!firstPerson;
    // 抢占：取消任何尚未落地的延迟 stop（否则它可能稍后拆掉本次要起/复用的实例）。
    // 并自增代际：让此刻之前排程的 stop 落地时因「代际已变」而成为 no-op（幂等 + 代际化的核心）。
    cancelPendingStop();
    botInstance._viewerGen++;
    // 已在运行且人称一致 → 原地复用，避免无谓重启（端口不变）
    if (botInstance._viewerPort && botInstance._viewerFirstPerson === firstPerson)
      return { port: botInstance._viewerPort, reused: true, firstPerson };
    // 切人称：先就地关旧服务（其端口进入 2s 延迟回收，新服务必然换端口）
    if (botInstance._viewerPort) closeViewerNow();

    const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
    // viewDistance：3 区块≈48格，足够看清周围又省带宽/显存/CPU；ENGINE_VIEWER_DISTANCE 可覆盖（2~8）
    const viewDistance = Math.max(2, Math.min(8, Number(process.env.ENGINE_VIEWER_DISTANCE) || 3));

    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const port = pickPort();
      usedPorts.add(port); // 立刻占位：重试/并发都不会重选同一端口
      try {
        // firstPerson=true 第一人称（镜头=机器人视线）；false 第三人称（看得到本体、可 orbit 自由转镜头）
        mineflayerViewer(bot, { port, firstPerson, viewDistance });
        botInstance._viewerFirstPerson = firstPerson;
        botInstance._viewerPort = port;
        portOwners.set(port, botInstance); // 记录端口归属(MODB-6)
        // 点击视角里的方块 → 机器人寻路走过去（走动/操控模式下前端会关掉 clickWalk）
        try {
          const { goals } = require('mineflayer-pathfinder');
          bot.viewer.on('blockClicked', (block) => {
            if (botInstance._viewerClickWalk === false) return;
            if (block && block.position) {
              try {
                bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
              } catch {
                /* ignore */
              }
            }
          });
        } catch {
          /* ignore */
        }
        return { port, firstPerson };
      } catch (e) {
        lastErr = e;
        // 该端口同步失败：保留占位、延迟回收，换下一个端口重试
        setTimeout(() => usedPorts.delete(port), 2000);
      }
    }
    throw new Error('视角启动失败：' + (lastErr && lastErr.message ? lastErr.message : lastErr));
  };

  // 空闲自停：前端异常退出（崩溃/强杀/断网）不会发 viewer:stop，渲染服务会常驻到引擎重启，
  // 白耗 CPU/内存。兜底：引擎完全没有 UI 客户端（hasWatchers=false）持续 5 分钟 → 自动关闭视角；前端回来会自动重启。
  let viewerIdleSince = null;
  const idleTimer = setInterval(() => {
    if (!botInstance._viewerPort) { viewerIdleSince = null; return; }
    if (botInstance.hasWatchers()) { viewerIdleSince = null; return; }
    if (viewerIdleSince == null) { viewerIdleSince = Date.now(); return; }
    if (Date.now() - viewerIdleSince >= 5 * 60 * 1000) {
      viewerIdleSince = null;
      cancelPendingStop();
      closeViewerNow();
    }
  }, 30000);
  botInstance.timers = botInstance.timers || [];
  botInstance.timers.push(idleTimer);

  // 实例销毁（断线/清理）：无条件立即关闭并释放端口，不走代际化延迟（此时不会再有新 start）
  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    cancelPendingStop();
    closeViewerNow();
  });
};
