import { useState, useEffect, type FormEvent } from "react";
import { MapPin, Plus, Navigation, Trash2, Footprints, Terminal, ListChecks, Circle, Square, Globe, Pencil } from "lucide-react";
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

// 维度中文短名（保存时记录；Bukkit 多世界的自定义世界客户端侧常显示为主世界）
function dimLabel(d?: string): string | null {
  if (!d) return null;
  if (/nether/i.test(d)) return "下界";
  if (/end/i.test(d)) return "末地";
  if (/overworld/i.test(d)) return "主世界";
  return d;
}

export default function LocationsTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [rec, setRec] = useState<RecTarget | null>(null);
  const [recCount, setRecCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<SavedLocationSummary | null>(null);
  // 编辑前置指令：set-reach API 早已存在，这里补 UI 入口（多世界地点保存后也能改 /warp 指令）
  const [editCmd, setEditCmd] = useState<{ loc: SavedLocationSummary; value: string } | null>(null);
  const locs = bot.savedLocations ?? [];
  const atCap = locs.length >= 200; // 软上限纯防滥用，正常使用无感；满了才禁用

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
    } else {
      pushToast(r.error || "无法开始录制", "error");
    }
  }

  async function stopRecord(save: boolean) {
    const target = rec;
    setRec(null);
    const r = await cmd.moduleAction<{ steps: unknown[] }>(bot.id, "recording", "stop");
    if (!save || !target) return;
    const steps = (r.ok && r.data?.steps) || [];
    // 录制成果的保存必须接结果——静默失败=录了半天一键蒸发
    if (target.kind === "new") {
      const sr = await cmd.moduleAction(bot.id, "location", "save", { name: target.name, steps });
      if (sr.ok) {
        setName("");
        pushToast(`地点「${target.name}」已保存（${steps.length} 步到达脚本）`, "success");
      } else {
        pushToast(sr.error || "保存地点失败（录制的步骤未能存下）", "error");
      }
    } else if (target.id) {
      const sr = await cmd.moduleAction(bot.id, "location", "set-reach", { locationId: target.id, steps });
      pushToast(
        sr.ok ? `到达脚本已更新（${steps.length} 步）` : (sr.error || "更新到达脚本失败"),
        sr.ok ? "success" : "error",
      );
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
        <h3 className="mb-3 flex items-center justify-between text-sm font-semibold">
          <span>新增地点</span>
          <span className={cn("text-[11px] font-normal tabular-nums", atCap ? "text-danger" : "text-muted")}>
            {locs.length > 0 ? `${locs.length} 个` : ""}
          </span>
        </h3>
        <form onSubmit={saveHere} className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={atCap ? "已达上限，删除旧地点后再添加" : "地点名，如：主城"}
              disabled={!bot.online || !!rec || atCap}
            />
            <Button type="submit" variant="primary" disabled={!bot.online || !name.trim() || !!rec || atCap}>
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
            名为「家」的地点会作为脚本「回家」的归家点。
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={!bot.online || !name.trim() || !!rec || atCap}
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
                      {dimLabel(l.dimension) && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" /> {dimLabel(l.dimension)}
                        </span>
                      )}
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
                    disabled={!!rec}
                    title="编辑前置指令（多世界切图，如 /warp 主城）"
                    onClick={() => setEditCmd({ loc: l, value: l.command || "" })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
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

      {/* 编辑前置指令：跨世界地点保存后也能补/改 /warp、/mv tp 等切图指令（留空=清除，走纯坐标寻路） */}
      <Modal
        open={!!editCmd}
        onClose={() => setEditCmd(null)}
        title={`前置指令 — ${editCmd?.loc.name ?? ""}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditCmd(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!editCmd) return;
                const r = await cmd.moduleAction(bot.id, "location", "set-reach", {
                  locationId: editCmd.loc.id,
                  command: editCmd.value.trim(),
                });
                pushToast(r.ok ? "前置指令已更新" : (r.error || "更新失败"), r.ok ? "success" : "error");
                setEditCmd(null);
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            value={editCmd?.value ?? ""}
            onChange={(e) => setEditCmd((p) => (p ? { ...p, value: e.target.value } : p))}
            placeholder="如 /warp 主城、/mv tp 资源世界（留空=清除）"
            autoFocus
          />
          <p className="text-[11px] leading-relaxed text-muted">
            前往该地点（含脚本里的 goto_location）会先执行这条指令，等传送完成后再寻路到坐标。
            跨世界的地点必须配前置指令或录制到达脚本，否则没法走过去。
          </p>
        </div>
      </Modal>

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
