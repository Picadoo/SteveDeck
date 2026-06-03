// 机器人视角：用 prismarine-viewer 的 web 模式（浏览器端 three.js 渲染，无原生依赖）
// 按需启动一个轻量 web 服务，前端用 iframe 嵌入即可看到第一人称画面。

let nextPort = 3007;
const usedPorts = new Set();

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  // 点击地面寻路开关（持久于实例，跨视角重启保留）。操控模式下前端会关掉它，
  // 这样在第三人称里拖动画面转视角时不会误触发走路。
  if (botInstance._viewerClickWalk === undefined) botInstance._viewerClickWalk = true;
  botInstance.setViewerClickWalk = (enabled) => {
    botInstance._viewerClickWalk = !!enabled;
    return botInstance._viewerClickWalk;
  };

  botInstance.startViewer = (firstPerson = false) => {
    firstPerson = !!firstPerson;
    if (botInstance._viewerPort) {
      if (botInstance._viewerFirstPerson === firstPerson)
        return { port: botInstance._viewerPort, reused: true, firstPerson };
      botInstance.stopViewer(); // 切换人称需重启
    }
    let port = nextPort;
    while (usedPorts.has(port)) port++;
    nextPort = port + 1;
    usedPorts.add(port);
    try {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
      // firstPerson=true 第一人称(镜头=机器人，跟随最稳)；false 第三人称(看得到本体，可点地面走)
      // viewDistance 控制流式区块半径：3 区块≈48格，足够看清机器人周围，又比默认省一大截带宽/显存/CPU。
      // 可用 ENGINE_VIEWER_DISTANCE 覆盖（性能差的机器调 2，画面大的调 4~6）。
      const viewDistance = Math.max(2, Math.min(8, Number(process.env.ENGINE_VIEWER_DISTANCE) || 3));
      mineflayerViewer(bot, { port, firstPerson, viewDistance });
      botInstance._viewerFirstPerson = firstPerson;
      // 点击视角里的方块 → 机器人寻路走过去
      try {
        const { goals } = require('mineflayer-pathfinder');
        bot.viewer.on('blockClicked', (block) => {
          if (botInstance._viewerClickWalk === false) return; // 操控模式：禁用点击走路
          if (block && block.position) {
            try {
              bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
            } catch { /* ignore */ }
          }
        });
      } catch { /* ignore */ }
      botInstance._viewerPort = port;
      return { port, firstPerson };
    } catch (e) {
      usedPorts.delete(port);
      throw new Error('视角启动失败：' + (e && e.message ? e.message : e));
    }
  };

  botInstance.stopViewer = () => {
    try {
      if (bot.viewer && bot.viewer.close) bot.viewer.close();
    } catch {
      /* ignore */
    }
    if (botInstance._viewerPort) {
      usedPorts.delete(botInstance._viewerPort);
      botInstance._viewerPort = null;
    }
    return true;
  };

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => botInstance.stopViewer());
};
