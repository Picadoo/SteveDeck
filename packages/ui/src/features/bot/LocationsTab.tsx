import { useState, useEffect, type FormEvent } from "react";
import { MapPin, Plus, Navigation, Trash2, Footprints, Terminal, ListChecks, Circle, Square } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { BotSummary, SavedLocationSummary } from "@mcbot/protocol";

type RecTarget = { kind: "new" | "existing"; id?: string; name: string };

// 地点的「到达方式」：脚本(GUI/多世界) > 命令 > 坐标寻路
function reachInfo(l: SavedLocationSummary) {
  if (l.stepCount) return { label: `脚本 ${l.stepCount} 步`, Icon: ListChecks, tone: "text-accent" };
  if (l.command) return { label: "命令", Icon: Terminal, tone: "text-blue-400" };
  return { label: "坐标寻路", Icon: Footprints, tone: "text-muted" };
}

export default function LocationsTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [rec, setRec] = useState<RecTarget | null>(null);
  const [recCount, setRecCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<SavedLocationSummary | null>(null);
  const locs = bot.savedLocations ?? [];

  // 录制中：轮询步数；引擎侧若停了则收起横幅
  useEffect(() => {
    if (!rec) return;
    let alive = true;
    const tick = async () => {
      const r = await cmd.moduleAction<{ active: boolean; count: number }>(bot.id, "recording", "status");
      if (!alive) return;
      if (r.ok && r.data) {
        setRecCount(r.data.count);
        if (!r.data.active) setRec(null);
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [rec, bot.id]);

  async function saveHere(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await cmd.moduleAction(bot.id, "location", "save", {
      name: name.trim(),
      command: command.trim() || undefined,
    });
    if (r.ok) {
      setName("");
      setCommand("");
      pushToast("地点已保存", "success");
    } else {
      pushToast(r.error || "保存失败", "error");
    }
  }

  async function startRecord(target: RecTarget) {
    const r = await cmd.moduleAction(bot.id, "recording", "start");
    if (r.ok) {
      setRecCount(0);
      setRec(target);
    }
  }

  async function stopRecord(save: boolean) {
    const target = rec;
    setRec(null);
    const r = await cmd.moduleAction<{ steps: unknown[] }>(bot.id, "recording", "stop");
    if (!save || !target) return;
    const steps = (r.ok && r.data?.steps) || [];
    if (target.kind === "new") {
      await cmd.moduleAction(bot.id, "location", "save", { name: target.name, steps });
      setName("");
    } else if (target.id) {
      await cmd.moduleAction(bot.id, "location", "set-reach", { locationId: target.id, steps });
    }
  }

  return (
    <div className="space-y-4">
      {/* 录制到达 横幅 */}
      {rec && (
        <Card className="flex items-center justify-between border-danger/40 bg-danger/10 p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <Circle className="h-3 w-3 shrink-0 animate-pulse fill-danger text-danger" />
            <span>
              录制到达「{rec.name}」… <b>{recCount}</b> 步
            </span>
            <span className="text-[11px] text-muted">去游戏里完成传送（开菜单 / 点格子 / 发指令）</span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="primary" onClick={() => stopRecord(true)}>
              <Square className="h-3.5 w-3.5" /> 停止并保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => stopRecord(false)}>
              取消
            </Button>
          </div>
        </Card>
      )}

      {/* 新增地点 */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">新增地点（最多 5 个）</h3>
        <form onSubmit={saveHere} className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="地点名，如：主城"
              disabled={!bot.online || !!rec}
            />
            <Button type="submit" variant="primary" disabled={!bot.online || !name.trim() || !!rec}>
              <Plus className="h-4 w-4" /> 存当前位置
            </Button>
          </div>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="可选·前置指令（同世界 / 命令可达，如 /warp 主城）"
            disabled={!bot.online || !!rec}
          />
        </form>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            跨世界 / 要开菜单点的地方，用「录制到达」：录一遍开菜单点地点，以后一键回放。
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={!bot.online || !name.trim() || !!rec}
            title="录制到达此地点的动作序列（GUI/多世界通用）"
            onClick={() => startRecord({ kind: "new", name: name.trim() })}
          >
            <Circle className="h-3.5 w-3.5" /> 录制到达
          </Button>
        </div>
      </Card>

      {/* 地点列表 */}
      <div className="space-y-2">
        {locs.length === 0 ? (
          <p className="px-1 text-xs text-muted">还没有保存的地点</p>
        ) : (
          locs.map((l) => {
            const ri = reachInfo(l);
            return (
              <Card key={l.id} className="flex items-center justify-between p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <MapPin className="h-4 w-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <span>
                        {l.x}, {l.y}, {l.z}
                      </span>
                      <span className={cn("inline-flex items-center gap-1", ri.tone)}>
                        <ri.Icon className="h-3 w-3" /> {ri.label}
                      </span>
                    </div>
                    {l.command && <div className="truncate text-[11px] text-blue-400">前置：{l.command}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!bot.online || !!rec}
                    onClick={async () => {
                      const r = await cmd.moduleAction(bot.id, "location", "goto", { locationId: l.id });
                      pushToast(r.ok ? "出发前往…" : (r.error || "前往失败"), r.ok ? "success" : "error");
                    }}
                  >
                    <Navigation className="h-3.5 w-3.5" /> 前往
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!bot.online || !!rec}
                    title={l.stepCount ? "重录到达脚本" : "录制到达脚本"}
                    onClick={() => startRecord({ kind: "existing", id: l.id, name: l.name })}
                  >
                    <Circle className={cn("h-3.5 w-3.5", l.stepCount ? "text-accent" : "text-danger")} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(l)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="danger" onClick={async () => {
              if (!confirmDelete) return;
              const r = await cmd.moduleAction(bot.id, "location", "delete", { locationId: confirmDelete.id });
              pushToast(r.ok ? "地点已删除" : (r.error || "删除失败"), r.ok ? "success" : "error");
              setConfirmDelete(null);
            }}>删除</Button>
          </>
        }
      >
        <p className="text-sm">确定要删除地点「{confirmDelete?.name}」吗？此操作不可撤销。</p>
      </Modal>
    </div>
  );
}
