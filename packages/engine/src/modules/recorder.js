// 录制玩家操作 → 脚本步骤。一切皆「步骤」：录制产出的 steps[] 与手搓积木、AI 生成的同构，
// 停止后存为草稿脚本、直接进编辑器编辑。只录「玩家发起的命令」，不录机器人自动行为/移动路径。
const { customName } = require('../utils/items');

const AUTO_WAIT_GAP_MS = 800; // 相邻操作间隔超过这个值就自动补一条 wait，回放不会太快

// §x 是 Bungee 十六进制色前缀——漏掉它会让录制的物品名残留垃圾字符，回放时名称匹配失败
const stripColor = (s) => String(s == null ? '' : s).replace(/§[0-9a-fk-orx]/gi, '').trim();
const itemMatchName = (it) => {
  if (!it) return '';
  let n = '';
  try { n = customName(it) || ''; } catch (e) { /* ignore */ }
  return stripColor(n || it.displayName || it.name || '');
};

class Recorder {
  constructor(botInstance) {
    this.inst = botInstance;
    this.active = false;
    this.steps = [];
    this.startedAt = 0;
    this.lastAt = 0;
  }

  start() {
    this.active = true;
    this.steps = [];
    this.startedAt = Date.now();
    this.lastAt = this.startedAt;
    return this.status();
  }

  stop() {
    this.active = false;
    const steps = this.steps.slice();
    return { steps, count: steps.length };
  }

  status() {
    return {
      active: this.active,
      count: this.steps.length,
      last: this.steps.length ? this.steps[this.steps.length - 1] : null,
      startedAt: this.startedAt,
    };
  }

  /** 命令入口在执行用户操作时调用：kind=逻辑动作名，args=参数。未录制则忽略。 */
  note(kind, args) {
    if (!this.active) return;
    try {
      const produced = this._map(kind, args || {});
      if (!produced) return;
      const arr = Array.isArray(produced) ? produced : [produced];
      if (!arr.length) return;
      const now = Date.now();
      // 自动补等待（捕获自然停顿，近似服务器响应时间；用户可在编辑器换成 wait_gui_item 等）
      if (this.steps.length) {
        const sec = Math.round((now - this.lastAt) / 1000);
        if (sec >= 1) this.steps.push({ do: 'wait', s: Math.min(10, sec) });
      }
      for (const st of arr) this.steps.push(st);
      this.lastAt = now;
    } catch (e) {
      /* 录制绝不能影响正常操作 */
    }
  }

  _map(kind, args) {
    const bot = this.inst.bot;
    switch (kind) {
      case 'chat': {
        const msg = String(args.message == null ? '' : args.message);
        if (!msg.trim()) return null;
        return msg.startsWith('/') ? { do: 'cmd', cmd: msg } : { do: 'chat', msg };
      }
      case 'goto': {
        const x = Number(args.x), y = Number(args.y), z = Number(args.z);
        if ([x, y, z].some((v) => !isFinite(v))) return null;
        return { do: 'goto', x: Math.round(x), y: Math.round(y), z: Math.round(z) };
      }
      case 'goto_location':
        return args.name ? { do: 'goto_location', name: String(args.name) } : null;
      case 'use': {
        // inventory:use slot → 按物品名 equip 再 use_item（跨服稳，不依赖槽位）
        const it = bot && bot.inventory && bot.inventory.slots[Number(args.slot)];
        const name = itemMatchName(it);
        const out = [];
        if (name) out.push({ do: 'equip', item: name });
        out.push({ do: 'use_item' });
        return out;
      }
      case 'equip': {
        const it = bot && bot.inventory && bot.inventory.slots[Number(args.slot)];
        const name = itemMatchName(it);
        return name ? { do: 'equip', item: name } : null;
      }
      case 'drop': {
        const it = bot && bot.inventory && bot.inventory.slots[Number(args.slot)];
        const name = itemMatchName(it);
        return name ? { do: 'drop', item: name, count: it ? it.count : 1 } : null;
      }
      case 'window_click': {
        // 按点中槽位的「物品显示名」录成 find_and_click_slot（换服/界面刷新照样跑）；无名兜底按槽位
        const slot = Number(args.slot);
        const button = Number(args.button) || 0;
        const win = bot && bot.currentWindow;
        const it = win && win.slots && win.slots[slot];
        const name = itemMatchName(it);
        if (name) return { do: 'find_and_click_slot', item: name, button, matchLore: false };
        return { do: 'click_slot', slot, button };
      }
      case 'window_close':
        return { do: 'close_gui' };
      default:
        return null;
    }
  }

  // 录制状态不做推送：UI 录制条靠轮询 moduleAction('recording','status')（ScriptsTab/LocationsTab/Viewer）
}

module.exports = { Recorder };
