import { useEffect, useState } from "react";
import { Play, Square, Plus, Pencil, Trash2, ScrollText, Repeat } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import ScriptEditor from "./ScriptEditor";
import type { BotSummary, ScriptSummary, BotScript } from "@mcbot/protocol";

export default function ScriptsTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [list, setList] = useState<ScriptSummary[]>([]);
  const [editing, setEditing] = useState<{ open: boolean; initial: BotScript | null }>({
    open: false,
    initial: null,
  });

  async function refresh() {
    const r = await cmd.script.list(bot.id);
    if (r.ok && Array.isArray(r.data)) setList(r.data);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.modules.script]);

  function openNew() {
    setEditing({ open: true, initial: null });
  }
  async function openEdit(name: string) {
    const r = await cmd.script.detail(name);
    setEditing({ open: true, initial: (r.ok ? (r.data as BotScript) : null) ?? null });
  }
  async function handleSave(script: BotScript) {
    const r = await cmd.script.save(script);
    if (r.ok) {
      setEditing({ open: false, initial: null });
      pushToast("脚本已保存", "success");
      refresh();
    } else {
      pushToast(r.error || "保存失败", "error");
    }
  }
  async function run(name: string) {
    const r = await cmd.script.start(bot.id, name);
    if (!r.ok) pushToast(r.error || "运行失败", "error");
    else refresh();
  }
  async function stop() {
    await cmd.script.stop(bot.id);
    refresh();
  }
  async function remove(name: string) {
    await cmd.script.remove(name);
    refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">脚本库为全局，可在任意机器人上运行</p>
        <Button size="sm" variant="primary" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> 新建脚本
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted">
          <ScrollText className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">还没有脚本，点击「新建脚本」</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <Card key={s.name} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.loop && (
                    <Badge tone="neutral">
                      <Repeat className="h-3 w-3" /> 循环
                    </Badge>
                  )}
                  {s.running && <Badge tone="success">运行中</Badge>}
                </div>
                <div className="text-[11px] text-muted">
                  触发：{s.trigger?.type ?? "manual"} · {s.stepCount} 步
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {s.running ? (
                  <Button size="sm" variant="secondary" onClick={stop}>
                    <Square className="h-3.5 w-3.5" /> 停止
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={!bot.online} onClick={() => run(s.name)}>
                    <Play className="h-3.5 w-3.5" /> 运行
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openEdit(s.name)} title="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.name)} title="删除">
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ScriptEditor
        open={editing.open}
        initial={editing.initial}
        onClose={() => setEditing({ open: false, initial: null })}
        onSave={handleSave}
      />
    </div>
  );
}
