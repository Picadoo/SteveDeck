// 预置脚本模板库：覆盖最常见的挂机场景，新用户点开即用（选模板 → 微调关键词/地点名 → 保存）。
// 模板只用引擎已支持的步骤/触发器（对账 @mcbot/protocol SCRIPT_DO_TYPES），坐标/服务器相关参数留给用户填。
import type { BotScript } from "@mcbot/protocol";

export interface ScriptTemplate {
  key: string;
  name: string;
  /** 一句话说明：解决什么问题、要改哪里 */
  desc: string;
  script: BotScript;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    key: "anti-afk",
    name: "挂机防踢",
    desc: "每 4 分钟跳两下，防止服务器把挂机的你踢下线。",
    script: {
      name: "挂机防踢",
      loop: false,
      trigger: { type: "interval", value: 240 },
      steps: [
        { do: "jump" },
        { do: "wait", s: 1 },
        { do: "jump" },
      ],
    },
  },
  {
    key: "low-hp-retreat",
    name: "低血量自动回家",
    desc: "血量低于 8 时喊一声并跑回归家点（在「踩点」页保存一个名为「家」的地点即可）。",
    script: {
      name: "低血量自动回家",
      loop: false,
      trigger: { type: "health_below", value: 8 },
      steps: [
        { do: "note", text: "归家点 = 名为「家」的保存地点（推荐，支持前置指令/跨世界），没有则用追怪模块的返回点" },
        { do: "chat", msg: "血量过低，先撤了！" },
        { do: "return_home" },
      ],
    },
  },
  {
    key: "damage-fight-back",
    name: "受伤自动反击",
    desc: "被打时装备最强武器，反击最近的怪物。",
    script: {
      name: "受伤自动反击",
      loop: false,
      trigger: { type: "damage" },
      steps: [
        { do: "equip_best_weapon" },
        { do: "attack", entity: "", count: 5, interval: 0.6 },
      ],
    },
  },
  {
    key: "full-deposit",
    name: "背包满自动存箱",
    desc: "背包满时把物品存进最近的箱子（保留手上的装备武器）。",
    script: {
      name: "背包满自动存箱",
      loop: false,
      trigger: { type: "inventory_full" },
      steps: [
        { do: "note", text: "item 留空=除装备外全部存入；可改成只存某类，如 cobblestone" },
        { do: "deposit", item: "" },
        { do: "log", msg: "背包已清空到箱子" },
      ],
    },
  },
  {
    key: "auto-reply",
    name: "有人喊你自动回复",
    desc: "聊天里出现「在吗」时自动回一句挂机提示（关键词可改）。",
    script: {
      name: "自动回复在吗",
      loop: false,
      trigger: { type: "chat_match", value: "在吗" },
      steps: [
        { do: "wait", s: 1 },
        { do: "chat", msg: "我在挂机中，有事请留言~" },
      ],
    },
  },
  {
    key: "menu-checkin",
    name: "菜单签到",
    desc: "打开服务器菜单 → 找到签到按钮点击 → 关闭。把命令和关键词改成你服务器的。",
    script: {
      name: "菜单签到",
      loop: false,
      trigger: { type: "manual" },
      steps: [
        { do: "note", text: "把 /menu 和「签到」改成你服务器的菜单命令和按钮名" },
        { do: "cmd", cmd: "/menu" },
        { do: "wait_gui_item", item: "签到", timeout: 10 },
        { do: "find_and_click_slot", item: "签到", button: 0, matchLore: true },
        { do: "wait", s: 1 },
        { do: "close_gui" },
      ],
    },
  },
  {
    key: "respawn-rearm",
    name: "重生自动武装",
    desc: "死亡重生后自动装备最强武器并回归家点。",
    script: {
      name: "重生自动武装",
      loop: false,
      trigger: { type: "respawn" },
      steps: [
        { do: "wait", s: 2 },
        { do: "equip_best_weapon" },
        { do: "return_home" },
      ],
    },
  },
  {
    key: "patrol",
    name: "两点巡逻",
    desc: "在两个已保存的地点之间来回走（先在「踩点」页保存 点A / 点B）。",
    script: {
      name: "两点巡逻",
      loop: true,
      loopDelay: 2,
      trigger: { type: "manual" },
      steps: [
        { do: "note", text: "先在踩点页保存「点A」「点B」，或改成你的地点名" },
        { do: "goto_location", name: "点A" },
        { do: "wait", s: 3 },
        { do: "goto_location", name: "点B" },
        { do: "wait", s: 3 },
      ],
    },
  },
  {
    key: "chop-wood",
    name: "自动砍树",
    desc: "挖附近的原木直到攒够 32 个（方块名含 log 即可，适配各种树）。",
    script: {
      name: "自动砍树",
      loop: false,
      trigger: { type: "manual" },
      steps: [
        {
          do: "while",
          cond: "inventory_count log < 32",
          steps: [
            { do: "dig", block: "log", distance: 24 },
            { do: "wait", s: 0.5 },
            { do: "break_if", cond: "inventory_full" },
          ],
        },
        { do: "log", msg: "砍树完成" },
      ],
    },
  },
];
