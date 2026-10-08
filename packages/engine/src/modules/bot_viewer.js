// 机器人视角：用 prismarine-viewer 的 web 模式（浏览器端 three.js 渲染，无原生依赖）
// 按需启动一个轻量 web 服务，前端用 iframe 嵌入即可看到画面。
//
// 切换第一/三人称需要重启 prismarine-viewer（firstPerson 在服务端初始化时确定）。
// 关键：重启时**换一个新端口**，旧端口延迟回收——否则旧 http server 还没释放就在同端口重绑，
// 会抛 EADDRINUSE（异步），让画面坏掉。这就是之前「切人称把视角弄坏」的根因。

// 端口段从 8800 起：跟引擎主端口(8723)同处常见安全组放行段(8000-9000)，远程/Docker/内网穿透只需放行
// 一个很短的连续区间，手机就能直接看实时视角（3007 段在公网基本必被防火墙拦）。
// 池大小默认 4（够同时看 4 个 bot），ENGINE_VIEWER_PORTS 可调（2~54）——内网穿透/防火墙放行的口越少越省心。
// 为什么不止 1 个口：切人称/切 bot 会重启视角服务，旧端口延迟 2s 回收，必须留有余口才能立刻换端口而不撞 EADDRINUSE。
const BASE_PORT = 8800;
const VIEWER_PORTS = Math.max(2, Math.min(54, Number(process.env.ENGINE_VIEWER_PORTS) || 4));
const MAX_PORT = BASE_PORT + VIEWER_PORTS - 1;
const usedPorts = new Set();
const portOwners = new Map(); // port -> 持有它的 botInstance；池满时据此识别并回收陈旧端口(MODB-6)

// 选一个当前未占用的端口（已占位的会被跳过，所以刚关闭、待回收的旧端口不会被立刻重选）。
// 全部端口都被活跃视角占用时返回 null——绝不返回在用端口：在其上重绑会异步抛 EADDRINUSE
// （try/catch 接不住），且覆盖 portOwners 归属后，陈旧回收会把还活着的 viewer 端口误判可收。
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
    if (usedPorts.has(port)) return null; // 真满：全部端口都有活跃 viewer
  }
  return port;
}

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  // per-bot 代际计数（UIFEAT-2/3）：每次 startViewer 自增并记为「当前代」。
  // stopViewer 延迟落地，并只在「调度它时的那一代仍是当前代」才真正释放——
  // 若期间又来一次 start（代际前进），这条 stop 即变 no-op，避免晚到/乱序的 stop 拆掉新实例。
  if (botInstance._viewerGen === undefined) botInstance._viewerGen = 0;
  botInstance._viewerStopTimer = botInstance._viewerStopTimer || null;

  // 立即关闭当前视角服务（内部用）；端口延迟回收，避免紧接着的重启在同端口 rebind 触发 EADDRINUSE
  function closeViewerNow() {
    try {
      if (bot.viewer?.close) bot.viewer.close();
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

  botInstance.startViewer = (firstPerson = false, viewDistance) => {
    firstPerson = !!firstPerson;
    // viewDistance：区块数，直接决定带宽/显存/CPU。默认 3（≈48格，够看清周围）；
    // UI 可传 2~8 覆盖（弱机调低救卡顿、好机调高看更远）；ENGINE_VIEWER_DISTANCE 改默认值。
    const envDefault = Math.max(2, Math.min(8, Number(process.env.ENGINE_VIEWER_DISTANCE) || 3));
    const vd = Math.max(2, Math.min(8, Number(viewDistance) || envDefault));
    // 抢占：取消任何尚未落地的延迟 stop（否则它可能稍后拆掉本次要起/复用的实例）。
    // 并自增代际：让此刻之前排程的 stop 落地时因「代际已变」而成为 no-op（幂等 + 代际化的核心）。
    cancelPendingStop();
    botInstance._viewerGen++;
    // 已在运行且人称/视距一致 → 原地复用，避免无谓重启（端口不变）
    if (botInstance._viewerPort && botInstance._viewerFirstPerson === firstPerson && botInstance._viewerDistance === vd)
      return { port: botInstance._viewerPort, reused: true, firstPerson, viewDistance: vd };
    // 切人称/视距：先就地关旧服务（其端口进入 2s 延迟回收，新服务必然换端口）
    if (botInstance._viewerPort) closeViewerNow();

    // 直取子模块入口，不走根 index.js：根入口饿加载 headless/viewer 渲染链，
    // 会把 node-canvas（我们已不装的原生包）拽进来——服务端只需要 web 模式这一个函数。
    const mineflayerViewer = require('prismarine-viewer/lib/mineflayer');
    // 绑定地址跟随引擎主端口的暴露模型（CORE-6 同款）：默认只绑回环。此前视角服务无鉴权还绑全网卡，
    // 桌面场景等于把 bot 实时画面开给整个局域网。Docker/远程部署已设 ENGINE_HOST=0.0.0.0，行为不变。
    const host = process.env.ENGINE_HOST || '127.0.0.1';

    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const port = pickPort();
      if (port == null)
        throw new Error(`同时开启的视角已达上限（${VIEWER_PORTS} 个）——关掉其他机器人的实时画面，或调大 ENGINE_VIEWER_PORTS`);
      usedPorts.add(port); // 立刻占位：重试/并发都不会重选同一端口
      try {
        // firstPerson=true 第一人称（镜头=机器人视线）；false 第三人称（看得到本体、可 orbit 自由转镜头）
        mineflayerViewer(bot, { port, host, firstPerson, viewDistance: vd });
        botInstance._viewerFirstPerson = firstPerson;
        botInstance._viewerDistance = vd;
        botInstance._viewerPort = port;
        portOwners.set(port, botInstance); // 记录端口归属(MODB-6)
        return { port, firstPerson, viewDistance: vd };
      } catch (e) {
        lastErr = e;
        // 该端口同步失败：保留占位、延迟回收，换下一个端口重试
        setTimeout(() => usedPorts.delete(port), 2000);
      }
    }
    throw new Error(`视角启动失败：${lastErr?.message ? lastErr.message : lastErr}`);
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
