import { useEffect, useState } from "react";
import { Play, Square, Plus, Pencil, Trash2, ScrollText, Repeat, AlertCircle, Activity } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import ScriptEditor from "./ScriptEditor";
import CustomJsPanel from "./CustomJsPanel";
import type { BotSummary, ScriptSummary, BotScript } from "@mcbot/protocol";

export default function ScriptsTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [mode, setMode] = useState<"visual" | "js">("visual");
  const [list, setList] = useState<ScriptSummary[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{ open: boolean; initial: BotScript | null }>({
    open: false,
    initial: null,
  });
  const runtime = useStore((s) => s.scriptRuntime[bot.id]);

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

  // 按服务器过滤：通用(无 server) + 本服(server===本机 host)；「全部」显示所有
  const shown = showAll ? list : list.filter((sc) => !sc.server || sc.server === bot.host);

  return (
    <div className="space-y-3">
      {/* 脚本运行状态：当前步骤 / 循环轮次 / 变量 / 报错（来自引擎实时反馈，之前是黑盒） */}
      {runtime &&
        (runtime.status === "running" ||
          runtime.error ||
          (runtime.vars && Object.keys(runtime.vars).length > 0)) && (
          <Card className="space-y-1 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                {runtime.status === "running" ? (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                    运行中{runtime.name ? `：${runtime.name}` : ""}
                  </>
                ) : (
                  <>
                    <Activity className="h-3.5 w-3.5 text-muted" />
                    运行状态{runtime.name ? `：${runtime.name}` : ""}
                  </>
                )}
              </span>
              {typeof runtime.loopIter === "number" && runtime.loopIter > 0 && (
                <span className="text-muted">第 {runtime.loopIter} 轮</span>
              )}
            </div>
            {runtime.action && (
              <div className="text-muted">
                当前：<span className="text-fg">{runtime.action}</span>
                {runtime.path ? <span className="text-muted/60"> @ {runtime.path}</span> : null}
              </div>
            )}
            {runtime.error && (
              <div className="flex items-start gap-1 rounded bg-danger/10 px-2 py-1 text-danger">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {runtime.error.action && runtime.error.action !== "-" ? `[${runtime.error.action}] ` : ""}
                  {runtime.error.message}
                  <span className="ml-1 text-danger/60">{runtime.error.time}</span>
                </span>
              </div>
            )}
            {runtime.vars && Object.keys(runtime.vars).length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {Object.entries(runtime.vars).map(([k, v]) => (
                  <span key={k} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
                    {k}=<span className="text-accent">{String(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}

      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        <button
          onClick={() => setMode("visual")}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 transition-colors",
            mode === "visual" ? "bg-surface font-medium text-fg shadow-sm" : "text-muted",
          )}
        >
          积木脚本
        </button>
        <button
          onClick={() => setMode("js")}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 transition-colors",
            mode === "js" ? "bg-surface font-medium text-fg shadow-sm" : "text-muted",
          )}
        >
          自定义 JS
        </button>
      </div>

      {mode === "js" ? (
        <CustomJsPanel bot={bot} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-[11px]">
              {([["本服", false], ["全部", true]] as const).map(([lbl, v]) => (
                <button
                  key={lbl}
                  onClick={() => setShowAll(v)}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    showAll === v ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" /> 新建脚本
            </Button>
          </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted">
          <ScrollText className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">{list.length > 0 ? "本服务器没有脚本" : "还没有脚本，点击「新建脚本」"}</p>
          {!showAll && list.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="mt-1 text-xs text-accent">
              查看全部 {list.length} 个 →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => (
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
                  {!s.server ? (
                    <Badge tone="neutral">通用</Badge>
                  ) : s.server !== bot.host ? (
                    <Badge tone="warning">{s.server}</Badge>
                  ) : null}
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
            botId={bot.id}
            onClose={() => setEditing({ open: false, initial: null })}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}
