// 机器人视角：用 prismarine-viewer 的 web 模式（浏览器端 three.js 渲染，无原生依赖）
// 按需启动一个轻量 web 服务，前端用 iframe 嵌入即可看到画面。
//
// 切换第一/三人称需要重启 prismarine-viewer（firstPerson 在服务端初始化时确定）。
// 关键：重启时**换一个新端口**，旧端口延迟回收——否则旧 http server 还没释放就在同端口重绑，
// 会抛 EADDRINUSE（异步），让画面坏掉。这就是之前「切人称把视角弄坏」的根因。

const BASE_PORT = 3007;
const MAX_PORT = 3060;
const usedPorts = new Set();

// 选一个当前未占用的端口（已占位的会被跳过，所以刚关闭、待回收的旧端口不会被立刻重选）
function pickPort() {
  let port = BASE_PORT;
  while (usedPorts.has(port) && port < MAX_PORT) port++;
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

  // 关闭当前视角服务；端口延迟回收，避免紧接着的重启在同端口 rebind 触发 EADDRINUSE
  botInstance.stopViewer = () => {
    try {
      if (bot.viewer && bot.viewer.close) bot.viewer.close();
    } catch {
      /* ignore */
    }
    const p = botInstance._viewerPort;
    botInstance._viewerPort = null;
    if (p) setTimeout(() => usedPorts.delete(p), 2000);
    return true;
  };

  botInstance.startViewer = (firstPerson = false) => {
    firstPerson = !!firstPerson;
    // 已在运行且人称一致 → 直接复用，避免无谓重启
    if (botInstance._viewerPort && botInstance._viewerFirstPerson === firstPerson)
      return { port: botInstance._viewerPort, reused: true, firstPerson };
    // 切人称：先关旧服务（其端口进入 2s 延迟回收，新服务必然换端口）
    if (botInstance._viewerPort) botInstance.stopViewer();

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

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => botInstance.stopViewer());
};
