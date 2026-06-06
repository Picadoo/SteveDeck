// 窗口/GUI 交互：把服务器打开的容器/菜单 GUI 暴露给前端，并支持点击槽位操作。
// 适配大量 RPG 服的「箱子菜单」(DeluxeMenus 等) 与普通箱子。

const vec3 = require("vec3");
const { enchantNames, parseChat, flattenChat, customName, iconId } = require("../utils/items");
const { findMatchingSlot } = require("../utils/guiMatch");

function mkVec(x, y, z) {
  try {
    if (vec3 && vec3.Vec3) return new vec3.Vec3(x, y, z);
  } catch {
    /* ignore */
  }
  return vec3(x, y, z);
}

function txt(v) {
  if (v == null) return null;
  let s;
  if (typeof v === "string") s = v;
  else {
    try {
      s = v.toString();
    } catch {
      s = null;
    }
  }
  if (!s || s === "[object Object]") {
    try {
      s = flattenChat(v);
    } catch {
      return null;
    }
  }
  s = String(parseChat(s)).replace(/§[0-9a-fk-orx]/gi, "").trim();
  return s || null;
}

function serialize(win) {
  if (!win) return null;
  const raw = win.slots || [];
  const slots = raw.map((it, i) => {
    if (!it) return null;
    // 深度解析 NBT：RPG 服菜单物品名/Lore 常带 §颜色码，保留原文供前端彩色渲染（McText）。
    let rawName = it.displayName;
    let loreLines = [];
    if (it.nbt && it.nbt.value && it.nbt.value.display) {
      const d = it.nbt.value.display.value;
      if (d.Name) rawName = d.Name.value;
      if (d.Lore && d.Lore.value && d.Lore.value.value) loreLines = d.Lore.value.value;
    }
    rawName = String(parseChat(rawName));
    return {
      slot: i,
      name: rawName.replace(/§[0-9a-fk-orx]/gi, ""), // 纯文本（搜索/标题回退）
      display: rawName, // 原始（含 §颜色码）
      id: iconId(it), // 物品 id（贴图来源；染料按 metadata 分色）
      count: it.count,
      lore: loreLines.map((l) => String(parseChat(l))).join("\n"), // 保留颜色码
      enchants: enchantNames(it),
    };
  });
  return {
    id: typeof win.id === "number" ? win.id : 0,
    type: String(win.type ?? ""),
    title: txt(win.title) || "容器",
    slotCount: slots.length,
    // 容器部分的槽位数：之后是玩家自己的背包
    inventoryStart: typeof win.inventoryStart === "number" ? win.inventoryStart : null,
    slots,
  };
}

module.exports = (botInstance) => {
  const bot = botInstance.bot;
  const emit = (event, data) =>
    botInstance.io
      .to(botInstance._room)
      .to("admin")
      .emit(event, { user: bot.username, ownerId: botInstance.config.ownerId, ...data });

  // 当前窗口快照
  botInstance.getWindow = () => serialize(bot.currentWindow);

  // 点击槽位（button: 0 左键 / 1 右键；mode: 0 普通点击）
  botInstance.clickWindowSlot = async (slot, button = 0, mode = 0) => {
    const win = bot.currentWindow;
    if (!win) throw new Error("当前没有打开的窗口");
    await bot.clickWindow(slot, button, mode);
    // 等服务端回包（set_slot/window_items 原地刷新，或换成子菜单）后再快照，返回刷新后的窗口；
    // 同时下面挂的 updateSlot 监听会主动推 window_update 兜底。
    await new Promise((r) => setTimeout(r, 150));
    return serialize(bot.currentWindow);
  };

  // 关闭当前窗口
  botInstance.closeGui = () => {
    if (bot.currentWindow) {
      try {
        bot.closeWindow(bot.currentWindow);
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  };

  // 【AI 主动探索】用背包里某个名字的物品打开 GUI，抓取完整内容后关闭，返回结构。
  // 让 AI/用户无需逐个手点就能搞清服务器定制菜单里有什么（物品名/lore/槽位）——主动探查而非被动观察。
  botInstance.exploreMenuItem = async (keyword, opts = {}) => {
    const timeout = Number(opts.timeout) || 8000;
    const kw = String(keyword || "").toLowerCase();
    if (!kw) throw new Error("请提供物品名关键词");
    const item = bot.inventory.items().find(
      (i) => i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
    );
    if (!item) throw new Error(`背包里没有名字含「${keyword}」的物品`);
    await bot.equip(item, "hand");
    // 先挂监听再使用，等服务器弹出的新窗口
    const winP = new Promise((resolve, reject) => {
      const onOpen = (win) => {
        clearTimeout(t);
        resolve(win);
      };
      const t = setTimeout(() => {
        bot.removeListener("windowOpen", onOpen);
        reject(new Error("使用后未弹出界面（可能不是菜单物品，或服务器有延迟）"));
      }, timeout);
      bot.once("windowOpen", onOpen);
    });
    bot.activateItem();
    let win = await winP;
    // open_window 后服务器再发 window_items 填充槽位，等到有内容再快照（最多 1.5s）
    const waitSlots = async (w) => {
      const dl = Date.now() + 1500;
      while (Date.now() < dl && !(w.slots || []).some((s) => s)) await new Promise((r) => setTimeout(r, 100));
    };
    await waitSlots(win);
    // 主动深入：clickPath 逐级点进子菜单（按 名字/lore 关键词找槽位点击），抓最末一级结构
    const trail = [];
    for (const kw of Array.isArray(opts.clickPath) ? opts.clickPath : []) {
      if (!bot.currentWindow) break;
      const slot = findMatchingSlot(bot.currentWindow.slots, String(kw), { matchLore: true });
      if (slot < 0) {
        trail.push({ keyword: kw, found: false });
        break;
      }
      trail.push({ keyword: kw, slot });
      await bot.clickWindow(slot, 0, 0);
      await new Promise((r) => setTimeout(r, 500));
      if (bot.currentWindow) await waitSlots(bot.currentWindow);
    }
    win = bot.currentWindow || win;
    const snapshot = serialize(win);
    if (!opts.keep && bot.currentWindow) {
      try {
        bot.closeWindow(bot.currentWindow);
      } catch {
        /* ignore */
      }
    }
    return { usedItem: customName(item) || item.name, trail, window: snapshot };
  };

  // 【AI 主动探索】列出背包里疑似「菜单/可右键打开」的物品（有自定义名），作为探查候选。
  botInstance.listMenuCandidates = () => {
    try {
      return bot.inventory
        .items()
        .map((i) => ({ slot: i.slot, id: i.name, name: customName(i) || i.displayName || i.name, count: i.count }))
        .filter((x) => x.name && x.name !== x.id);
    } catch {
      return [];
    }
  };

  // 扫描附近容器（箱子/木桶/潜影盒等），返回坐标+距离，省去手填 XYZ
  botInstance.scanContainers = () => {
    if (!bot.entity) return [];
    const mcData = botInstance.getMcData();
    const names = [
      "chest", "trapped_chest", "ender_chest", "barrel", "hopper", "dispenser", "dropper",
      "shulker_box", "white_shulker_box", "orange_shulker_box", "magenta_shulker_box",
      "light_blue_shulker_box", "yellow_shulker_box", "lime_shulker_box", "pink_shulker_box",
      "gray_shulker_box", "light_gray_shulker_box", "cyan_shulker_box", "purple_shulker_box",
      "blue_shulker_box", "brown_shulker_box", "green_shulker_box", "red_shulker_box", "black_shulker_box",
    ];
    const ids = names.map((n) => mcData.blocksByName[n] && mcData.blocksByName[n].id).filter((x) => x != null);
    let positions = [];
    try {
      positions = bot.findBlocks({ matching: ids, maxDistance: 32, count: 40 });
    } catch {
      /* ignore */
    }
    return positions
      .map((p) => {
        const block = bot.blockAt(p);
        return {
          x: p.x, y: p.y, z: p.z,
          name: (block && block.name) || "container",
          distance: Math.round(bot.entity.position.distanceTo(p) * 10) / 10,
        };
      })
      .sort((a, b) => a.distance - b.distance);
  };

  // 打开坐标处容器：先寻路靠近再开
  botInstance.openContainerAt = async (x, y, z) => {
    const block = bot.blockAt(mkVec(x, y, z));
    if (!block) throw new Error("该位置没有方块");
    try {
      const { goals } = require("mineflayer-pathfinder");
      if (bot.entity.position.distanceTo(block.position) > 3) {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2));
      }
    } catch {
      /* 靠不近也尝试直接开 */
    }
    const win = await bot.openContainer(block);
    return serialize(win);
  };

  // —— 自动刷新 —— 服务端原地更新槽位（菜单翻页/按钮切换，不重开窗口）时，前端跟着刷新。
  let boundWin = null;
  let updateTimer = null;
  let closeTimer = null;

  const pushUpdate = () => {
    updateTimer = null;
    if (bot.currentWindow) emit("window_update", { window: serialize(bot.currentWindow) });
  };
  const scheduleUpdate = () => {
    if (updateTimer) return; // 合并连续 set_slot 为一次推送
    updateTimer = setTimeout(pushUpdate, 120);
  };
  const bindWindow = (win) => {
    if (boundWin === win) return;
    if (boundWin) boundWin.removeListener("updateSlot", scheduleUpdate);
    boundWin = win || null;
    if (boundWin) boundWin.on("updateSlot", scheduleUpdate);
  };

  const onOpen = (win) => {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } // 取消即将发出的关闭：换子菜单不闪烁
    bindWindow(win);
    emit("window_open", { window: serialize(win) });
    botInstance.io.to(botInstance._room).to("admin").emit("log", {
      user: bot.username,
      ownerId: botInstance.config.ownerId,
      msg: `打开界面：${txt(win.title) || "容器"}`,
      time: new Date().toLocaleTimeString(),
    });
  };
  const onClose = () => {
    bindWindow(null);
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    // 延迟发关闭：若紧接着触发 windowOpen（换子菜单）则被取消，避免弹窗闪一下
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = null; emit("window_close", {}); }, 180);
  };
  bot.on("windowOpen", onOpen);
  bot.on("windowClose", onClose);

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    bot.removeListener("windowOpen", onOpen);
    bot.removeListener("windowClose", onClose);
    bindWindow(null);
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  });
};
