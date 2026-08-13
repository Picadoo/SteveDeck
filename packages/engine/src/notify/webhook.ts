// 挂机事件推送：死亡 / 被踢 / 掉线(放弃重连) / 上线 时 POST 到用户配置的 Webhook。
// 挂机 bot 的核心痛点是「人不在时出事没人知道」——桌面通知只覆盖开着客户端的场景，
// Webhook 把事件推到手机（钉钉/飞书/企业微信/Discord/Server酱/Bark 或任意自建接收端）。
//
// 设计约束：
// - 通知失败绝不影响主流程（fire-and-forget + 全链路 try/catch + 8s 超时）
// - 同 bot 同类事件有冷却（默认 60s），防「死亡循环」把手机刷炸
// - 配置存引擎端 data/notify.json，UI 经 /api/notify/* 读写（引擎令牌保护）
import * as fs from "fs";
import { dataPath } from "../config/paths";

const logger = require("../utils/logger");

export type NotifyEventKind = "death" | "kick" | "offline" | "online" | "watch" | "test";
export type NotifyPreset =
  | "generic"
  | "dingtalk"
  | "feishu"
  | "wecom"
  | "discord"
  | "serverchan"
  | "bark";

export interface NotifyConfig {
  enabled: boolean;
  /** Webhook 地址（须 http/https）。钉钉/飞书/企业微信=群机器人地址；Server酱=https://sctapi.ftqq.com/<KEY>.send；Bark=https://api.day.app/<KEY> */
  url: string;
  preset: NotifyPreset;
  events: { death: boolean; kick: boolean; offline: boolean; online: boolean; watch: boolean };
  /** 同一 bot 同类事件的最小推送间隔（秒），防死亡循环刷屏 */
  cooldownSec: number;
}

export interface BotEvent {
  kind: NotifyEventKind;
  botId?: string;
  username?: string;
  host?: string;
  message: string;
}

const PRESETS: ReadonlySet<string> = new Set([
  "generic",
  "dingtalk",
  "feishu",
  "wecom",
  "discord",
  "serverchan",
  "bark",
]);

const DEFAULTS: NotifyConfig = {
  enabled: false,
  url: "",
  preset: "generic",
  // watch（盯人命中）默认关：活跃玩家的聊天可能很频繁，需用户显式开启（并受同一冷却约束）
  events: { death: true, kick: true, offline: true, online: false, watch: false },
  cooldownSec: 60,
};

let cache: NotifyConfig | null = null;

export function loadNotifyConfig(): NotifyConfig {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(dataPath("notify.json"), "utf8");
    const obj = JSON.parse(raw);
    cache = sanitize(obj);
  } catch {
    cache = { ...DEFAULTS, events: { ...DEFAULTS.events } };
  }
  return cache;
}

export function saveNotifyConfig(patch: Partial<NotifyConfig>): NotifyConfig {
  const cur = loadNotifyConfig();
  const next = sanitize({ ...cur, ...patch, events: { ...cur.events, ...(patch.events ?? {}) } });
  cache = next;
  try {
    fs.writeFileSync(dataPath("notify.json"), JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch (e: any) {
    logger.warn(`[notify] 配置写盘失败: ${e?.message ?? e}`);
  }
  return next;
}

/** 入盘/入内存前收口：字段类型、预设白名单、URL 协议、冷却范围。 */
function sanitize(obj: any): NotifyConfig {
  const url = typeof obj?.url === "string" ? obj.url.trim() : "";
  return {
    enabled: !!obj?.enabled,
    url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : "",
    preset: PRESETS.has(obj?.preset) ? obj.preset : "generic",
    events: {
      death: obj?.events?.death !== false,
      kick: obj?.events?.kick !== false,
      offline: obj?.events?.offline !== false,
      online: obj?.events?.online === true,
      watch: obj?.events?.watch === true,
    },
    cooldownSec: Math.max(0, Math.min(3600, Number(obj?.cooldownSec) || DEFAULTS.cooldownSec)),
  };
}

const EVENT_LABEL: Record<NotifyEventKind, string> = {
  death: "死亡",
  kick: "被踢出",
  offline: "掉线（已停止重连）",
  online: "已上线",
  watch: "盯人命中",
  test: "测试通知",
};

/** 按预设组装各平台要求的请求体。导出供单测验证各平台格式不被改坏。 */
export function buildRequest(
  preset: NotifyPreset,
  url: string,
  evt: BotEvent,
): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  const who = evt.username ? `${evt.username}${evt.host ? `@${evt.host}` : ""}` : "机器人";
  const title = `SteveDeck · ${who} ${EVENT_LABEL[evt.kind]}`;
  const text = `${evt.message}\n时间：${new Date().toLocaleString()}`;
  const json = { "Content-Type": "application/json" };
  switch (preset) {
    case "dingtalk":
    case "wecom":
      // 钉钉与企业微信群机器人同构：{msgtype:"text"}。钉钉若设了「自定义关键词」，
      // 消息里必须含该词——标题带固定前缀 SteveDeck，把它配成关键词即可
      return {
        url,
        init: {
          method: "POST",
          headers: json,
          body: JSON.stringify({ msgtype: "text", text: { content: `${title}\n${text}` } }),
        },
      };
    case "feishu":
      return {
        url,
        init: {
          method: "POST",
          headers: json,
          body: JSON.stringify({ msg_type: "text", content: { text: `${title}\n${text}` } }),
        },
      };
    case "discord":
      return {
        url,
        init: {
          method: "POST",
          headers: json,
          body: JSON.stringify({ content: `**${title}**\n${text}` }),
        },
      };
    case "serverchan":
      return {
        url,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(text)}`,
        },
      };
    case "bark":
      return {
        url,
        init: {
          method: "POST",
          headers: json,
          body: JSON.stringify({ title, body: text, group: "SteveDeck" }),
        },
      };
    default:
      // 通用 JSON：自建接收端/n8n/Home Assistant 等，字段齐全便于二次路由
      return {
        url,
        init: {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            source: "stevedeck",
            kind: evt.kind,
            title,
            message: evt.message,
            bot: { id: evt.botId ?? null, username: evt.username ?? null, host: evt.host ?? null },
            time: new Date().toISOString(),
          }),
        },
      };
  }
}

/** 实际发送（供 publish 与 /api/notify/test 复用）。永不 throw。 */
export async function sendNotification(
  cfg: NotifyConfig,
  evt: BotEvent,
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.url) return { ok: false, error: "未配置 Webhook 地址" };
  try {
    const { url, init } = buildRequest(cfg.preset, cfg.url, evt);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.name === "TimeoutError" ? "请求超时(8s)" : String(e?.message ?? e) };
  }
}

// 冷却表：`${kind}:${botId}` -> 上次发送时间。防死亡循环/重连风暴刷手机。
const lastSentAt = new Map<string, number>();
// 失败日志限频：webhook 挂了不该每个事件都刷一条 error
let lastErrLogAt = 0;

/** 引擎内各处的统一入口：按配置过滤 + 冷却 + 异步发送，绝不阻塞/抛错。 */
export function publishBotEvent(evt: BotEvent): void {
  try {
    const cfg = loadNotifyConfig();
    if (!cfg.enabled || !cfg.url) return;
    if (evt.kind !== "test" && !cfg.events[evt.kind]) return;
    if (evt.kind !== "test" && cfg.cooldownSec > 0) {
      const key = `${evt.kind}:${evt.botId || evt.username || ""}`;
      const now = Date.now();
      if (now - (lastSentAt.get(key) ?? 0) < cfg.cooldownSec * 1000) return;
      lastSentAt.set(key, now);
      if (lastSentAt.size > 512) {
        for (const [k, at] of lastSentAt) if (now - at > 3600_000) lastSentAt.delete(k);
      }
    }
    void sendNotification(cfg, evt).then((r) => {
      if (!r.ok && Date.now() - lastErrLogAt > 60000) {
        lastErrLogAt = Date.now();
        logger.warn(`[notify] Webhook 推送失败: ${r.error}（60s 内相同失败不再记录）`);
      }
    });
  } catch {
    /* 通知失败绝不影响主流程 */
  }
}
