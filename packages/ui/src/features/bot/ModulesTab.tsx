import { useState, useEffect } from "react";
import { Settings2, FileCode2, Pickaxe, MapPin, ScrollText } from "lucide-react";
import { Card, Switch, Button, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { usePoll } from "@/lib/usePoll";
import { MODULES, defaultConfig, type ModuleDef } from "./moduleDefs";
import { serverModuleDefs } from '@/adapters';
import ModuleConfigDialog from "./ModuleConfigDialog";
import AutoUsePanel from "./AutoUsePanel";
import type { BotSummary } from "@mcbot/protocol";
import { memoBotTab, eqJson } from "@/lib/memoBotTab";

// 有运行统计的模块（3.5s 轮询 `模块:stats`）：开着却看不到效果是明确的用户痛点，
// 现在所有常驻模块都上报「当前活动」（activity 字段单独渲染为状态行）+ 关键计数。
const STATS_MODULES = new Set([
  "auto_farm", "automine", "mob_hunter", "combat", "fishing", "follow", "trash_cleaner",
  "auto_chat", "player_watch",
]);
const AREA_MODULES = new Set(["automine", "mob_hunter"]);

// 统计字段的中文标签（只展示标量字段；activity 不在其中——单独渲染为状态行）
const STAT_LABELS: Record<string, string> = {
  cropTypes: "作物",
  totalHarvested: "收割",
  totalPlanted: "种植",
  boneMealUsed: "骨粉",
  harvestRate: "效率/分",
  lastHarvest: "上次收割",
  total: "挖掘",
  found: "发现",
  rate: "效率/分",
  lastMine: "上次挖掘",
  fullEvents: "满仓次数",
  mode: "模式",
  totalKills: "击杀",
  deaths: "死亡",
  killRate: "击杀/分",
  playersDetected: "遇到玩家",
  currentTarget: "当前目标",
  isPaused: "已暂停",
  runTime: "运行(分)",
  attacks: "攻击次数",
  lastTarget: "最近目标",
  casts: "抛竿",
  catches: "上钩",
  reels: "收杆",
  offTarget: "偏离火花",
  approaches: "靠近次数",
  avoidedMoves: "省去走位",
  serverEscapes: "鱼逃脱（服务器机制）",
  waterEntries: "进水次数",
  waterEscapes: "脱水次数",
  longRangeHints: "距离限制提示",
  pauseCount: "暂停次数",
  lootEvents: "掉落事件",
  lootItems: "掉落物品数",
  lootSummary: "掉落汇总",
  lastLoot: "最近掉落",
  lastReelReason: "最近收杆",
  lastPauseReason: "最近暂停提示",
  target: "跟随目标",
  cleaned: "已清理(叠)",
  sent: "已发送",
  lastMsg: "最近消息",
  watchHits: "命中条数",
};
const STAT_ORDER = Object.keys(STAT_LABELS);

function ModulesTab({ bot }: { bot: BotSummary }) {
  const defs = serverModuleDefs(bot, MODULES);
  const moduleConfigs = useStore((s) => s.moduleConfigs);
  const setModuleConfig = useStore((s) => s.setModuleConfig);
  const pushToast = useStore((s) => s.pushToast);
  const [editing, setEditing] = useState<ModuleDef | null>(null);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [engineSettings, setEngineSettings] = useState<any>(null);
  const [pinned, setPinned] = useState<{ name: string }[]>([]);
  // 乐观开关：点击后立即反映新状态（开关立刻动画），等服务器状态回来再对齐；失败则回滚
  const [optim, setOptim] = useState<Record<string, boolean>>({});
  const setOpt = (k: string, v: boolean) => setOptim((o) => ({ ...o, [k]: v }));
  const clearOpt = (k: string) =>
    setOptim((o) => {
      if (!(k in o)) return o;
      const n = { ...o };
      delete n[k];
      return n;
    });

  // 拉取引擎里持久化的真实配置，用于配置对话框预填
  useEffect(() => {
    cmd.getBotConfig(bot.id).then((r) => {
      if (r.ok && r.data) setEngineSettings(r.data.settings || {});
    });
  }, [bot.id]);

  // 置顶的自定义 JS 脚本：在模块页作为一键开关
  useEffect(() => {
    cmd.js.list(bot.id).then((r) => {
      if (r.ok && Array.isArray(r.data))
        setPinned(r.data.filter((s) => s.pinned).map((s) => ({ name: s.name })));
    });
  }, [bot.id, bot.modules.script]);

  const isActive = (def: ModuleDef) => !!bot.modules[def.activeFlag];

  function engineConfigFor(def: ModuleDef): Record<string, unknown> | undefined {
    const s = engineSettings;
    if (!s) return undefined;
    if (def.key === "combat") return s.combatConfig;
    if (def.key === "fishing") return { mode: s.fishingMode || "vanilla" };
    if (def.key === "auto_farm") return typeof s.autoFarm === "object" ? s.autoFarm : undefined;
    if (def.key === "mob_hunter") return s.mobHunter?.config;
    if (def.key === "automine") return s.autoMine?.config;
    return undefined;
  }

  // 优先级：默认值 < 引擎真实配置 < 本地未保存的修改
  const getCfg = (def: ModuleDef): Record<string, unknown> => ({
    ...defaultConfig(def),
    ...(engineConfigFor(def) || {}),
    ...(moduleConfigs[`${bot.id}:${def.key}`] || {}),
  });

  // 无激活的统计型模块时清空（usePoll 在此场景 enabled=false 不跑）
  const hasActiveStatsModule = defs.some((d) => STATS_MODULES.has(d.key) && isActive(d));
  useEffect(() => {
    if (!bot.online || !hasActiveStatsModule) setStats({});
  }, [bot.online, hasActiveStatsModule]);

  // 实时统计轮询（仅在线 + 有激活的统计型模块 + 页面可见；见 usePoll）
  usePoll(
    async (alive) => {
      const active = defs.filter((d) => STATS_MODULES.has(d.key) && isActive(d));
      // 并行拉各模块统计，攒一次 setStats（逐个 set 会隔着 await 各触发一次渲染，React 18 合并不了）
      const results = await Promise.all(active.map((d) => cmd.moduleAction(bot.id, d.key, "stats")));
      if (!alive()) return;
      const merged: Record<string, any> = {};
      active.forEach((d, i) => {
        const r = results[i];
        if (r.ok && r.data) merged[d.key] = r.data;
      });
      if (Object.keys(merged).length) setStats((s) => ({ ...s, ...merged }));
    },
    3500,
    {
      enabled: bot.online && hasActiveStatsModule,
      deps: [
        bot.id, bot.modules.autofarm, bot.modules.automine, bot.modules.mobhunter,
        bot.modules.combat, bot.modules.fishing, bot.modules.follow, bot.modules.trashcleaner,
        bot.modules.autochat, bot.modules.playerwatch,
      ],
    },
  );

  function onToggle(def: ModuleDef, active: boolean) {
    setOpt(def.key, active); // 立即反映，开关即时动画
    const cfg = def.fields.length ? getCfg(def) : undefined;
    cmd.toggleModule(bot.id, def.key, active, cfg).then((r) => {
      if (!r.ok) {
        pushToast(r.error || "操作失败", "error");
        clearOpt(def.key); // 失败回滚
      }
    });
  }

  // 服务器真实状态追上乐观值后，撤掉本地覆盖（之后由真实状态驱动）
  useEffect(() => {
    setOptim((o) => {
      let changed = false;
      const n = { ...o };
      for (const def of defs) {
        if (def.key in n && !!bot.modules[def.activeFlag] === n[def.key]) {
          delete n[def.key];
          changed = true;
        }
      }
      for (const s of pinned) {
        const k = `js:${s.name}`;
        if (k in n && (bot.modules.script === `JS:${s.name}`) === n[k]) {
          delete n[k];
          changed = true;
        }
      }
      return changed ? n : o;
    });
  }, [bot.modules, pinned]);

  const checkedOf = (def: ModuleDef) => (def.key in optim ? optim[def.key] : isActive(def));
  async function onSaveConfig(def: ModuleDef, cfg: Record<string, unknown>) {
    setModuleConfig(bot.id, def.key, cfg);
    setEditing(null);
    // 等引擎确认再报成功——原来是 fire-and-forget 无条件弹「已保存」，失败也假装成功
    let r: { ok: boolean; error?: string } = { ok: true };
    if (def.applyVia === "config") r = await cmd.configModule(bot.id, def.key, cfg);
    else if (isActive(def)) r = await cmd.toggleModule(bot.id, def.key, true, cfg);
    pushToast(r.ok ? "配置已保存" : (r.error || "保存失败"), r.ok ? "success" : "error");
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {defs.map((def) => {
        const Icon = def.icon;
        const active = isActive(def);
        const st = active ? stats[def.key] : null;
        return (
          <Card key={def.key} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{def.name}</div>
                  <div className="text-[11px] text-muted">{def.desc}</div>
                </div>
              </div>
              <Switch checked={checkedOf(def)} onChange={(v) => onToggle(def, v)} disabled={!bot.online} />
            </div>

            {typeof st?.activity === "string" && st.activity && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent/8 px-2.5 py-1.5 text-[11px] text-accent">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                <span className="truncate" title={st.activity}>{st.activity}</span>
              </div>
            )}
            {st && <StatsGrid data={st} />}

            {AREA_MODULES.has(def.key) && bot.online && (
              <AreaActions bot={bot} moduleKey={def.key} stats={active ? st : undefined} />
            )}

            {(def.fields.length > 0 || (def.key === "player_watch" && active)) && (
              <div className="mt-3 flex gap-2">
                {def.key === "player_watch" && bot.online && active && <WatchLogSection bot={bot} />}
                {def.fields.length > 0 && (
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => setEditing(def)}>
                    <Settings2 className="h-3.5 w-3.5" /> 配置
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {pinned.map((s) => {
        const jsKey = `js:${s.name}`;
        const running = jsKey in optim ? optim[jsKey] : bot.modules.script === `JS:${s.name}`;
        return (
          <Card key={`js:${s.name}`} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <FileCode2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted">自定义脚本</div>
                </div>
              </div>
              <Switch
                checked={running}
                onChange={(v) => {
                  setOpt(jsKey, v);
                  (v ? cmd.js.run(bot.id, s.name) : cmd.js.stop(bot.id)).then((r) => {
                    if (!r.ok) {
                      pushToast(r.error || "操作失败", "error");
                      clearOpt(jsKey);
                    }
                  });
                }}
                disabled={!bot.online}
              />
            </div>
          </Card>
        );
      })}

      <AutoUsePanel bot={bot} />
      <BehaviorCard bot={bot} />

      {editing && (
        <ModuleConfigDialog
          def={editing}
          botId={bot.id}
          open
          initial={getCfg(editing)}
          onClose={() => setEditing(null)}
          onSave={(cfg) => onSaveConfig(editing, cfg)}
        />
      )}
    </div>
  );
}

/** 区域选取：sel1/sel2 两点定义矩形区域（类 Baritone），用于挖矿/追怪限定活动范围 */
function AreaActions({ bot, moduleKey, stats }: { bot: BotSummary; moduleKey: string; stats?: Record<string, unknown> }) {
  const pushToast = useStore((s) => s.pushToast);
  const [pendingSel1, setPendingSel1] = useState(false);
  const [localArea, setLocalArea] = useState<string | null>(null);

  const statsArea = stats?.area as string | undefined;
  useEffect(() => {
    if (statsArea) setLocalArea(statsArea);
  }, [statsArea]);

  const areaText = localArea || statsArea || null;

  const doAction = async (act: string) => {
    const r = await cmd.moduleAction(bot.id, moduleKey, act);
    if (!r.ok) { pushToast(r.error || "操作失败", "error"); return; }
    const d = r.data as Record<string, unknown> | undefined;
    if (d?.needSel2) {
      setPendingSel1(true);
      const p = d.pos as { x: number; y: number; z: number };
      pushToast(`角1 (${p.x}, ${p.y}, ${p.z}) — 走到对角按「角2」`, "success");
    } else if (d?.area) {
      setPendingSel1(false);
      const a = d.area as { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number };
      setLocalArea(`(${a.x1},${a.y1},${a.z1})~(${a.x2},${a.y2},${a.z2})`);
      pushToast("区域已设定", "success");
    } else if (act === "clearArea") {
      setPendingSel1(false);
      setLocalArea(null);
      pushToast("区域已清除", "success");
    }
  };

  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <div className="flex items-center gap-1.5">
        <MapPin className="h-3 w-3 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          {areaText ? `区域: ${areaText}` : pendingSel1 ? "已标角1，走到对角按角2" : "无区域限制"}
        </span>
        <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => doAction("sel1")}>
          角1
        </Button>
        <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => doAction("sel2")}>
          角2
        </Button>
        {areaText && (
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px] text-red-400" onClick={() => doAction("clearArea")}>
            清除
          </Button>
        )}
      </div>
    </div>
  );
}

/** 盯人监听的命中记录：按需拉取（打开弹窗才请求），新的在前 */
function WatchLogSection({ bot }: { bot: BotSummary }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ names: string[]; total: number; hits: { time: string; name: string; text: string }[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const pull = () =>
      cmd.moduleAction(bot.id, "player_watch", "log").then((r) => {
        if (alive && r.ok && r.data) setLog(r.data as NonNullable<typeof log>);
      });
    pull();
    const t = setInterval(pull, 3000); // 弹窗开着时轻量刷新
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, bot.id]);

  return (
    <>
      <Button size="sm" variant="ghost" className="flex-1" onClick={() => setOpen(true)}>
        <ScrollText className="h-3.5 w-3.5" /> 记录
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="盯人监听记录" size="lg">
        {!log ? (
          <p className="py-6 text-center text-sm text-muted">加载中…</p>
        ) : log.hits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            还没有命中记录（监听：{log.names.join("、") || "未配置"}）
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-1 overflow-y-auto font-mono text-xs">
            <p className="mb-2 font-sans text-[11px] text-muted">
              监听 {log.names.join("、")} · 累计 {log.total} 条（保留最近 200 条，新的在前）
            </p>
            {log.hits.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 快照列表整体重建，无行内状态
              <div key={i} className="rounded bg-surface-2/50 px-2 py-1">
                <span className="mr-2 select-none text-muted">{h.time}</span>
                <span className="mr-2 rounded bg-accent/15 px-1 text-accent">{h.name}</span>
                <span className="break-all">{h.text}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

/** 行为设置：允许破坏方块寻路 / 复活后自动指令（从交互页移来；属持久行为配置，归「托管」） */
function BehaviorCard({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [behavior, setBehavior] = useState<{
    allowDig: boolean;
    respawnCommand: string;
    returnOnDeath: boolean;
  } | null>(null);
  const [respawnDraft, setRespawnDraft] = useState("");
  const disabled = !bot.online;
  const patchBehavior = (p: Partial<NonNullable<typeof behavior>>) =>
    setBehavior((b) => ({ allowDig: false, respawnCommand: "", returnOnDeath: false, ...b, ...p }));

  useEffect(() => {
    let live = true;
    cmd.behavior.get(bot.id).then((r) => {
      if (live && r.ok && r.data) {
        setBehavior(r.data);
        setRespawnDraft(r.data.respawnCommand || "");
      }
    });
    return () => {
      live = false;
    };
  }, [bot.id]);

  async function toggleDig(allow: boolean) {
    patchBehavior({ allowDig: allow }); // 立即反映
    const r = await cmd.behavior.setDig(bot.id, allow);
    if (r.ok) {
      pushToast(allow ? "已允许破坏方块寻路" : "已切换为无破坏寻路", "success");
    } else {
      pushToast(r.error || "设置失败", "error");
      patchBehavior({ allowDig: !allow }); // 回滚
    }
  }
  async function toggleReturn(on: boolean) {
    patchBehavior({ returnOnDeath: on }); // 立即反映
    const r = await cmd.behavior.setReturnOnDeath(bot.id, on);
    if (r.ok) {
      pushToast(on ? "已开启死亡后返回原位" : "已关闭死亡后返回", "success");
    } else {
      pushToast(r.error || "设置失败", "error");
      patchBehavior({ returnOnDeath: !on }); // 回滚
    }
  }
  async function saveRespawn() {
    const c = respawnDraft.trim();
    const r = await cmd.behavior.setRespawnCmd(bot.id, c);
    if (r.ok) {
      patchBehavior({ respawnCommand: c });
      pushToast("已保存复活后指令", "success");
    } else pushToast(r.error || "保存失败", "error");
  }

  return (
    <Card className="p-4 sm:col-span-2">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Pickaxe className="h-4 w-4 text-accent" /> 行为设置
      </h3>
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="min-w-0">
          <div className="text-sm font-medium">允许破坏方块寻路</div>
          <p className="text-[11px] leading-relaxed text-muted">
            多数服地图受保护，开启反而容易卡路径；自建/创造服再开。
          </p>
        </div>
        <Switch checked={!!behavior?.allowDig} onChange={toggleDig} disabled={disabled} />
      </div>
      <div className="mt-2 border-t border-border/40 pt-2.5">
        <div className="text-sm font-medium">复活后自动指令</div>
        <p className="mb-1.5 text-[11px] leading-relaxed text-muted">
          会被传回主城的服可填 <code className="rounded bg-surface-2 px-1">/back</code> 或
          <code className="rounded bg-surface-2 px-1">/spawn</code>；留空不执行（复活本身是自动的）。
        </p>
        <div className="flex gap-1.5">
          <Input
            value={respawnDraft}
            onChange={(e) => setRespawnDraft(e.target.value)}
            placeholder="如 /back（留空不执行）"
            disabled={disabled}
          />
          <Button size="sm" variant="secondary" disabled={disabled} onClick={saveRespawn}>
            保存
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/40 pt-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">死亡后返回原位</div>
          <p className="text-[11px] leading-relaxed text-muted">
            重生后自动寻路回死亡点（原版类服可用）。复杂返回改用脚本：respawn 触发器 +
            <code className="rounded bg-surface-2 px-1">{"{deathX} {deathY} {deathZ}"}</code>。
          </p>
        </div>
        <Switch checked={!!behavior?.returnOnDeath} onChange={toggleReturn} disabled={disabled} />
      </div>
    </Card>
  );
}

function StatsGrid({ data }: { data: Record<string, any> }) {
  const entries = STAT_ORDER.filter(
    (k) => k in data && (typeof data[k] === "number" || typeof data[k] === "string" || typeof data[k] === "boolean"),
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-surface-2/50 p-2.5 text-[11px]">
      {entries.map((k) => (
        <div key={k} className="flex justify-between">
          <span className="text-muted">{STAT_LABELS[k]}</span>
          <span className="truncate pl-1 font-medium">
            {typeof data[k] === "boolean" ? (data[k] ? "是" : "否") : String(data[k])}
          </span>
        </div>
      ))}
    </div>
  );
}

// 字段白名单 memo：modules 是对象（每次推送新引用），按值比较——开关状态没变就不重渲
export default memoBotTab(ModulesTab, ["id", "online", ["modules", eqJson]]);
