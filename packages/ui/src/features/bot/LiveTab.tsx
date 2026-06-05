import { useState } from "react";
import { Search, Boxes, RefreshCw, Navigation, Square, MapPin } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import McText from "@/components/McText";
import { cnMob } from "@/lib/mobNames";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import Viewer from "./Viewer";
import ViewerModal from "./ViewerModal";
import type { BotSummary } from "@mcbot/protocol";

type Npc = {
  id: number;
  type: string;
  name: string | null;
  nameRaw?: string | null;
  realPlayer?: boolean;
  distance: number;
};
type Container = { x: number; y: number; z: number; name: string; distance: number };

/** 交互：实时视角 + 操控 + 前往坐标 + NPC/容器交互。亲自上手操作机器人都在这里。 */
export default function LiveTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const setWindow = useStore((s) => s.setWindow);
  const disabled = !bot.online;
  const [popout, setPopout] = useState(false);
  const [npcs, setNpcs] = useState<Npc[] | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [xyz, setXyz] = useState({ x: "", y: "", z: "" });

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
    if (r.ok && r.data) setWindow(bot.id, r.data);
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

  return (
    <div className="space-y-4">
      {/* 实时视角（内嵌，可放大）。放大时内嵌让位，避免同一机器人开两个视角实例 */}
      {!popout ? (
        <Viewer bot={bot} onPopout={() => setPopout(true)} />
      ) : (
        <div className="flex h-[46vh] items-center justify-center rounded-lg border border-border bg-surface-2/40 text-sm text-muted">
          实时画面已在放大窗口中
        </div>
      )}
      <ViewerModal bot={bot} open={popout} onClose={() => setPopout(false)} />

      {/* 前往坐标（手动操控用视角里的摇杆/键盘；这里只管自动寻路到指定坐标） */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Navigation className="h-4 w-4 text-accent" /> 前往坐标
        </h3>
        <p className="mb-1.5 text-[11px] text-muted">填坐标自动寻路过去；手动操控请点视角右上「放大」或开「操控」。</p>
        <div className="flex gap-1.5">
          <Input value={xyz.x} onChange={(e) => setXyz((v) => ({ ...v, x: e.target.value }))} placeholder="X" disabled={disabled} />
          <Input value={xyz.y} onChange={(e) => setXyz((v) => ({ ...v, y: e.target.value }))} placeholder="Y" disabled={disabled} />
          <Input value={xyz.z} onChange={(e) => setXyz((v) => ({ ...v, z: e.target.value }))} placeholder="Z" disabled={disabled} />
          <Button size="sm" variant="primary" disabled={disabled} onClick={goto}>
            <MapPin className="h-3.5 w-3.5" /> 前往
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => cmd.control.stop(bot.id)} title="停止">
            <Square className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>

      {/* NPC / 生物 */}
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
                    <span className="truncate font-medium">
                      <McText text={n.nameRaw || n.name || cnMob(n.type)} />
                    </span>
                    {n.realPlayer ? (
                      <span className="shrink-0 rounded bg-success/15 px-1 text-[10px] text-success">真人</span>
                    ) : n.type === "player" ? (
                      <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning">NPC</span>
                    ) : (
                      n.name && <span className="shrink-0 rounded bg-surface px-1 text-[10px] text-muted">{cnMob(n.type)}</span>
                    )}
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

      {/* 容器 / 菜单 */}
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
    </div>
  );
}
