// 窗口/GUI 交互：把服务器打开的容器/菜单 GUI 暴露给前端，并支持点击槽位操作。
// 适配大量 RPG 服的「箱子菜单」(DeluxeMenus 等) 与普通箱子。

const vec3 = require("vec3");
const { customName, enchantNames, lore, parseChat, flattenChat } = require("../utils/items");

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
  const slots = raw.map((it, i) =>
    it
      ? {
          slot: i,
          name: customName(it),
          id: it.name,
          count: it.count,
          lore: lore(it),
          enchants: enchantNames(it),
        }
      : null,
  );
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
    // 点击后服务器可能替换为子菜单，返回最新窗口
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

  // 扫描附近容器（箱子/木桶/潜影盒等），返回坐标+距离，省去手填 XYZ
  botInstance.scanContainers = () => {
    if (!bot.entity) return [];
    const mcData = require("minecraft-data")(bot.version);
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

  const onOpen = (win) => {
    emit("window_open", { window: serialize(win) });
    botInstance.io.to(botInstance._room).to("admin").emit("log", {
      user: bot.username,
      ownerId: botInstance.config.ownerId,
      msg: `打开界面：${txt(win.title) || "容器"}`,
      time: new Date().toLocaleTimeString(),
    });
  };
  const onClose = () => emit("window_close", {});
  bot.on("windowOpen", onOpen);
  bot.on("windowClose", onClose);

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    bot.removeListener("windowOpen", onOpen);
    bot.removeListener("windowClose", onClose);
  });
};
