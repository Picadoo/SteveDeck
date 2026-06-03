import { useState, useEffect } from "react";
import { Search, Boxes, BarChart3, RefreshCw, Clock, Navigation, Square, MapPin, Pickaxe } from "lucide-react";
import { Card, Button, Input, Badge, Switch } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import SchedulerTab from "./SchedulerTab";
import type { BotSummary } from "@mcbot/protocol";

type Npc = { id: number; type: string; name: string | null; distance: number };
type Container = { x: number; y: number; z: number; name: string; distance: number };

/** 交互中心：NPC / 容器 / 走动 / 计分板 / 定时。无界面也好用：扫描代替填坐标，结果就地显示。 */
export default function InteractionTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const setWindow = useStore((s) => s.setWindow);
  const [npcs, setNpcs] = useState<Npc[] | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [xyz, setXyz] = useState({ x: "", y: "", z: "" });
  const [sb, setSb] = useState<any>(null);
  const [behavior, setBehavior] = useState<{ allowDig: boolean; respawnCommand: string } | null>(null);
  const [respawnDraft, setRespawnDraft] = useState("");
  const disabled = !bot.online;

  useEffect(() => {
    if (!bot.online) return;
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
  }, [bot.id, bot.online]);

  async function toggleDig(allow: boolean) {
    const r = await cmd.behavior.setDig(bot.id, allow);
    if (r.ok) {
      setBehavior((b) => ({ respawnCommand: b?.respawnCommand ?? "", allowDig: allow }));
      pushToast(allow ? "已允许破坏方块寻路" : "已切换为无破坏寻路", "success");
    } else pushToast(r.error || "设置失败", "error");
  }
  async function saveRespawn() {
    const c = respawnDraft.trim();
    const r = await cmd.behavior.setRespawnCmd(bot.id, c);
    if (r.ok) {
      setBehavior((b) => ({ allowDig: b?.allowDig ?? false, respawnCommand: c }));
      pushToast("已保存复活后指令", "success");
    } else pushToast(r.error || "保存失败", "error");
  }

  async function scanNpc() {
    const r = await cmd.moduleAction<Npc[]>(bot.id, "npc", "scan");
    if (r.ok) setNpcs(r.data ?? []);
    else pushToast(r.error || "扫描失败", "error");
  }
  async function scanContainers() {
    const r = await cmd.moduleAction<Container[]>(bot.id, "container", "scan");
    if (r.ok) setContainers(r.data ?? []);
    else pushToast(r.error || "扫描失败", "error");
  }
  async function openContainer(c: Container) {
    pushToast("正在走过去并打开…", "info");
    const r = await cmd.window.openAt(bot.id, c.x, c.y, c.z);
    if (r.ok && r.data) setWindow(bot.username, r.data);
    else pushToast(r.error || "打开失败", "error");
  }
  async function goto() {
    const x = Number(xyz.x),
      y = Number(xyz.y),
      z = Number(xyz.z);
    if (![x, y, z].every(Number.isFinite)) return pushToast("请输入有效坐标", "error");
    const r = await cmd.moduleAction(bot.id, "move", "goto", { x, y, z });
    if (r.ok) pushToast("出发前往…", "success");
    else pushToast(r.error || "寻路失败", "error");
  }
  async function fetchScoreboard() {
    const r = await cmd.moduleAction(bot.id, "scoreboard", "get");
    if (r.ok) setSb(r.data ?? { empty: true });
    else pushToast(r.error || "获取计分板失败", "error");
  }
  const sbItems: { name: string; value: number | string }[] = sb?.items || sb?.sidebar || [];

  return (
    <div className="space-y-4">
      {/* NPC */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Search className="h-4 w-4 text-accent" /> NPC / 生物
        </h3>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={scanNpc}>
          <RefreshCw className="h-3.5 w-3.5" /> 扫描附近 32 格
        </Button>
        {npcs && (
          <div className="mt-2 space-y-1">
            {npcs.length === 0 ? (
              <p className="text-xs text-muted">附近没有 NPC / 生物</p>
            ) : (
              npcs.slice(0, 14).map((n) => (
                <div key={n.id} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {n.name && <Badge tone="warning">命名</Badge>}
                    <span className="truncate font-medium">{n.name || n.type}</span>
                    <span className="shrink-0 text-[11px] text-muted">{n.distance}m</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      cmd.moduleAction(bot.id, "npc", "interact", { name: String(n.id) });
                      pushToast("走过去并交互…", "info");
                    }}
                  >
                    交互
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* 容器 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Boxes className="h-4 w-4 text-accent" /> 容器 / 菜单
        </h3>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          服务器菜单：底部聊天栏发命令（如 <code className="rounded bg-surface-2 px-1">/menu</code>、
          <code className="rounded bg-surface-2 px-1">/bp</code>），界面自动弹出。箱子直接扫描点开（会自动走过去）：
        </p>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={scanContainers}>
          <RefreshCw className="h-3.5 w-3.5" /> 扫描附近箱子
        </Button>
        {containers && (
          <div className="mt-2 space-y-1">
            {containers.length === 0 ? (
              <p className="text-xs text-muted">附近 32 格没有箱子（菜单类用聊天命令打开）</p>
            ) : (
              containers.slice(0, 12).map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted/70">
                      {c.x},{c.y},{c.z}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{c.distance}m</span>
                  </span>
                  <Button size="sm" variant="ghost" disabled={disabled} onClick={() => openContainer(c)}>
                    打开
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* 走动 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Navigation className="h-4 w-4 text-accent" /> 走动
        </h3>
        <p className="mb-2 text-[11px] text-muted">
          填坐标让机器人寻路过去；或开「视角」后直接点画面里的地面，它就走过去。
        </p>
        <div className="flex gap-1.5">
          <Input value={xyz.x} onChange={(e) => setXyz((v) => ({ ...v, x: e.target.value }))} placeholder="X" disabled={disabled} />
          <Input value={xyz.y} onChange={(e) => setXyz((v) => ({ ...v, y: e.target.value }))} placeholder="Y" disabled={disabled} />
          <Input value={xyz.z} onChange={(e) => setXyz((v) => ({ ...v, z: e.target.value }))} placeholder="Z" disabled={disabled} />
          <Button size="sm" variant="primary" disabled={disabled} onClick={goto}>
            <MapPin className="h-3.5 w-3.5" /> 前往
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => cmd.moduleAction(bot.id, "move", "stop")} title="停止">
            <Square className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>

      {/* 寻路与复活行为 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Pickaxe className="h-4 w-4 text-accent" /> 寻路与复活
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
      </Card>

      {/* 计分板 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-accent" /> 计分板
        </h3>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={fetchScoreboard}>
          <RefreshCw className="h-3.5 w-3.5" /> 查看计分板
        </Button>
        {sbItems.length > 0 ? (
          <div className="mt-2 space-y-1">
            {sb?.title && <div className="text-sm font-semibold">{sb.title}</div>}
            {sbItems.map((it, i) => (
              <div key={i} className="flex justify-between border-b border-border/40 py-1 text-sm last:border-0">
                <span className="truncate pr-2 text-muted">{it.name}</span>
                <span className="font-medium tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        ) : sb ? (
          <p className="mt-2 text-xs text-muted">该服务器当前无侧边栏计分板</p>
        ) : null}
      </Card>

      {/* 定时任务 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
          <Clock className="h-4 w-4 text-accent" /> 定时任务
        </h3>
        <SchedulerTab bot={bot} />
      </div>
    </div>
  );
}
