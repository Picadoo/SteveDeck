import { useState, useEffect } from "react";
import { Settings2, FileCode2, Pickaxe } from "lucide-react";
import { Card, Switch, Button, Input } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { MODULES, defaultConfig, type ModuleDef } from "./moduleDefs";
import ModuleConfigDialog from "./ModuleConfigDialog";
import AutoUsePanel from "./AutoUsePanel";
import type { BotSummary } from "@mcbot/protocol";

const STATS_MODULES = new Set(["auto_farm", "automine", "mob_hunter"]);

// 统计字段的中文标签（只展示标量字段）
const STAT_LABELS: Record<string, string> = {
  cropTypes: "作物",
  totalHarvested: "收割",
  totalPlanted: "种植",
  boneMealUsed: "骨粉",
  harvestRate: "效率/分",
  lastHarvest: "上次收割",
  total: "挖掘",
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
};
const STAT_ORDER = Object.keys(STAT_LABELS);

export default function ModulesTab({ bot }: { bot: BotSummary }) {
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

  // 实时统计轮询（仅在线 + 有激活的统计型模块时）
  useEffect(() => {
    const active = MODULES.filter((d) => STATS_MODULES.has(d.key) && isActive(d));
    if (!bot.online || active.length === 0) {
      setStats({});
      return;
    }
    let cancelled = false;
    const poll = async () => {
      for (const d of active) {
        const r = await cmd.moduleAction(bot.id, d.key, "stats");
        if (!cancelled && r.ok && r.data) setStats((s) => ({ ...s, [d.key]: r.data }));
      }
    };
    poll();
    const t = setInterval(poll, 3500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online, bot.modules.autofarm, bot.modules.automine, bot.modules.mobhunter]);

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
      for (const def of MODULES) {
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
  function onSaveConfig(def: ModuleDef, cfg: Record<string, unknown>) {
    setModuleConfig(bot.id, def.key, cfg);
    if (def.applyVia === "config") cmd.configModule(bot.id, def.key, cfg);
    else if (isActive(def)) cmd.toggleModule(bot.id, def.key, true, cfg);
    setEditing(null);
    pushToast("配置已保存", "success");
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MODULES.map((def) => {
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

            {st && <StatsGrid data={st} />}

            {def.fields.length > 0 && (
              <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setEditing(def)}>
                <Settings2 className="h-3.5 w-3.5" /> 配置
              </Button>
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
          open
          initial={getCfg(editing)}
          onClose={() => setEditing(null)}
          onSave={(cfg) => onSaveConfig(editing, cfg)}
        />
      )}
    </div>
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
            默认关闭（无破坏模式）。多数服务器地图受保护，开启后寻路会尝试挖/搭方块，反而更容易卡路径。
          </p>
        </div>
        <Switch checked={!!behavior?.allowDig} onChange={toggleDig} disabled={disabled} />
      </div>
      <div className="mt-2 border-t border-border/40 pt-2.5">
        <div className="text-sm font-medium">复活后自动指令</div>
        <p className="mb-1.5 text-[11px] leading-relaxed text-muted">
          死亡后自动复活（内置）。若服务器死亡会回主城，可填 <code className="rounded bg-surface-2 px-1">/back</code>、
          <code className="rounded bg-surface-2 px-1">/spawn</code> 等返回原处；留空则不执行。
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
            重生后（先跑上面的复活指令）自动寻路走回死亡点。原版类服可用；模组服寻路可能失效，建议改用复活指令/脚本。
            复杂返回（如先选副本）可在脚本里用 <code className="rounded bg-surface-2 px-1">{"{deathX} {deathY} {deathZ}"}</code> 配合 respawn 触发器。
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
