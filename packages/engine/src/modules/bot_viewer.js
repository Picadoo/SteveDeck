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
      mineflayerViewer(bot, { port, firstPerson: true, viewDistance: 4 });
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
