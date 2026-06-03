// 机器人视角：用 prismarine-viewer 的 web 模式（浏览器端 three.js 渲染，无原生依赖）
// 按需启动一个轻量 web 服务，前端用 iframe 嵌入即可看到第一人称画面。

let nextPort = 3007;
const usedPorts = new Set();

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  botInstance.startViewer = () => {
    if (botInstance._viewerPort) return { port: botInstance._viewerPort, reused: true };
    let port = nextPort;
    while (usedPorts.has(port)) port++;
    nextPort = port + 1;
    usedPorts.add(port);
    try {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
      // 第三人称：能看到机器人本体与周围，且可点击地面让它走过去
      mineflayerViewer(bot, { port, firstPerson: false, viewDistance: 4 });
      // 点击视角里的方块 → 机器人寻路走过去
      try {
        const { goals } = require('mineflayer-pathfinder');
        bot.viewer.on('blockClicked', (block) => {
          if (block && block.position) {
            try {
              bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
            } catch { /* ignore */ }
          }
        });
      } catch { /* ignore */ }
      botInstance._viewerPort = port;
      return { port };
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
