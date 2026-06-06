import { useEffect, useMemo, useState } from "react";
import { Play, Square, Plus, Pencil, Trash2, ScrollText, Repeat, AlertCircle, Activity, Folder, ChevronDown, CircleDot } from "lucide-react";
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
  // 录制态（轮询引擎 recording:status；录制中加快刷新步数）
  const [rec, setRec] = useState<{ active: boolean; count: number } | null>(null);

  // 切换机器人时探一次录制状态（重进页面也能续上正在进行的录制）
  useEffect(() => {
    if (!bot.online) { setRec(null); return; }
    let alive = true;
    cmd
      .moduleAction<{ active: boolean; count: number }>(bot.id, "recording", "status")
      .then((r) => { if (alive && r.ok && r.data) setRec({ active: !!r.data.active, count: r.data.count || 0 }); });
    return () => { alive = false; };
  }, [bot.id, bot.online]);
  // 录制中：每 1.5s 刷新步数
  useEffect(() => {
    if (!rec?.active) return;
    const t = setInterval(async () => {
      const r = await cmd.moduleAction<{ active: boolean; count: number }>(bot.id, "recording", "status");
      if (r.ok && r.data) setRec({ active: !!r.data.active, count: r.data.count || 0 });
    }, 1500);
    return () => clearInterval(t);
  }, [rec?.active, bot.id]);

  async function startRec() {
    const r = await cmd.moduleAction(bot.id, "recording", "start");
    if (r.ok) { setRec({ active: true, count: 0 }); pushToast("开始录制 — 去各页操作（走、用物品、点菜单、踩点），回来停止", "success"); }
    else pushToast(r.error || "无法开始录制", "error");
  }
  async function stopRec() {
    const r = await cmd.moduleAction<{ steps: unknown[]; count: number }>(bot.id, "recording", "stop");
    setRec({ active: false, count: 0 });
    const steps = (r.ok && Array.isArray(r.data?.steps) ? r.data!.steps : []) as BotScript["steps"];
    if (!steps.length) { pushToast("没录到任何操作", "info"); return; }
    const draft = {
      name: "录制 " + new Date().toLocaleTimeString().slice(0, 5),
      steps,
      trigger: { type: "manual" },
      server: bot.host,
      category: "录制",
    } as BotScript;
    setMode("visual");
    setEditing({ open: true, initial: draft });
    pushToast(`录制完成 ${steps.length} 步 — 命名后保存`, "success");
  }

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

  // 分类分组（地点传送/领取奖励…）：有分类时按分类折叠分组，否则平铺
  const allCats = useMemo(
    () => [...new Set(list.map((s) => s.category).filter((c): c is string => !!c && !!c.trim()))],
    [list],
  );
  const grouped = shown.some((s) => s.category && s.category.trim());
  const groups = useMemo(() => {
    const m = new Map<string, ScriptSummary[]>();
    for (const sc of shown) {
      const c = sc.category?.trim() || "未分类";
      const arr = m.get(c);
      if (arr) arr.push(sc);
      else m.set(c, [sc]);
    }
    return [...m.entries()].sort((a, b) =>
      a[0] === "未分类" ? 1 : b[0] === "未分类" ? -1 : a[0].localeCompare(b[0], "zh"),
    );
  }, [shown]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCat = (c: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  const renderCard = (s: ScriptSummary) => (
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
  );

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

      {/* 录制态红条：录制中常驻，随处可停止 */}
      {rec?.active && (
        <Card className="flex items-center justify-between gap-2 border-danger/40 bg-danger/10 p-3">
          <span className="flex items-center gap-2 text-sm font-medium text-danger">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
            </span>
            正在录制… 已记录 {rec.count} 步
          </span>
          <Button size="sm" variant="secondary" onClick={stopRec}>
            <Square className="h-3.5 w-3.5" /> 停止并保存
          </Button>
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
            <div className="flex shrink-0 gap-1.5">
              {!rec?.active && (
                <Button size="sm" variant="secondary" disabled={!bot.online} onClick={startRec} title="录制你的操作，一键生成脚本">
                  <CircleDot className="h-3.5 w-3.5 text-danger" /> 录制
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={openNew}>
                <Plus className="h-3.5 w-3.5" /> 新建脚本
              </Button>
            </div>
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
      ) : grouped ? (
        <div className="space-y-2.5">
          {groups.map(([cat, items]) => {
            const isCol = collapsed.has(cat);
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex w-full items-center gap-1.5 px-1 py-1 text-xs font-semibold text-muted hover:text-fg"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isCol && "-rotate-90")} />
                  <Folder className="h-3.5 w-3.5 text-accent" />
                  {cat}
                  <span className="font-normal text-muted/60">{items.length}</span>
                </button>
                {!isCol && <div className="mt-1 space-y-2">{items.map(renderCard)}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">{shown.map(renderCard)}</div>
      )}

          <ScriptEditor
            open={editing.open}
            initial={editing.initial}
            botId={bot.id}
            categories={allCats}
            onClose={() => setEditing({ open: false, initial: null })}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}
