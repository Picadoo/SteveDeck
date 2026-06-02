import { useState, useEffect } from "react";
import { X, ArrowUp, ArrowDown, Trash2, Plus, Code2, Blocks } from "lucide-react";
import { Button, Input, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { STEP_TYPES, STEP_MAP, TRIGGER_TYPES } from "./stepDefs";
import type { BotScript } from "@mcbot/protocol";

type Mode = "visual" | "json";
interface EditScript {
  name: string;
  loop: boolean;
  trigger: { type: string; value?: string | number };
  steps: any[];
}

function toEdit(s: BotScript | null): EditScript {
  if (!s) return { name: "新脚本", loop: false, trigger: { type: "manual" }, steps: [] };
  return {
    name: s.name || "新脚本",
    loop: !!s.loop,
    trigger: { type: s.trigger?.type || "manual", value: s.trigger?.value },
    steps: Array.isArray(s.steps) ? JSON.parse(JSON.stringify(s.steps)) : [],
  };
}
function toScript(e: EditScript): BotScript {
  const trigger: any = { type: e.trigger.type };
  if (e.trigger.value !== undefined && e.trigger.value !== "") trigger.value = e.trigger.value;
  return { name: e.name.trim(), loop: e.loop, trigger, steps: e.steps } as BotScript;
}

export default function ScriptEditor({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: BotScript | null;
  onClose: () => void;
  onSave: (script: BotScript) => void;
}) {
  const [mode, setMode] = useState<Mode>("visual");
  const [s, setS] = useState<EditScript>(toEdit(initial));
  const [json, setJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setS(toEdit(initial));
      setMode("visual");
      setErr(null);
    }
  }, [open, initial]);

  if (!open) return null;

  function switchMode(next: Mode) {
    setErr(null);
    if (next === "json") {
      setJson(JSON.stringify(toScript(s), null, 2));
      setMode("json");
    } else {
      try {
        setS(toEdit(JSON.parse(json)));
        setMode("visual");
      } catch (e: any) {
        setErr("JSON 解析失败：" + e.message);
      }
    }
  }

  function save() {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(json);
        onSave(parsed);
      } catch (e: any) {
        setErr("JSON 解析失败：" + e.message);
      }
    } else {
      if (!s.name.trim()) return setErr("脚本名称不能为空");
      onSave(toScript(s));
    }
  }

  // ----- 步骤操作 -----
  function addStep(doType: string) {
    const def = STEP_MAP[doType];
    const step: any = { do: doType };
    def?.fields.forEach((f) => (step[f.k] = f.type === "number" ? 0 : ""));
    setS((p) => ({ ...p, steps: [...p.steps, step] }));
  }
  function updateStep(i: number, k: string, v: any) {
    setS((p) => {
      const steps = p.steps.slice();
      steps[i] = { ...steps[i], [k]: v };
      return { ...p, steps };
    });
  }
  function moveStep(i: number, dir: -1 | 1) {
    setS((p) => {
      const steps = p.steps.slice();
      const j = i + dir;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...p, steps };
    });
  }
  function delStep(i: number) {
    setS((p) => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) }));
  }

  const triggerDef = TRIGGER_TYPES.find((t) => t.type === s.trigger.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">脚本编辑器</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => switchMode("visual")}
              className={cn("rounded-md px-2.5 py-1 text-xs", mode === "visual" ? "bg-surface-2 text-fg" : "text-muted")}
            >
              <Blocks className="mr-1 inline h-3.5 w-3.5" />积木
            </button>
            <button
              onClick={() => switchMode("json")}
              className={cn("rounded-md px-2.5 py-1 text-xs", mode === "json" ? "bg-surface-2 text-fg" : "text-muted")}
            >
              <Code2 className="mr-1 inline h-3.5 w-3.5" />JSON
            </button>
            <button onClick={onClose} className="ml-1 text-muted hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === "visual" ? (
            <div className="space-y-4">
              {/* 元信息 */}
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">脚本名称</span>
                  <Input value={s.name} onChange={(e) => setS((p) => ({ ...p, name: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2 pb-2">
                  <span className="text-sm">循环</span>
                  <Switch checked={s.loop} onChange={(v) => setS((p) => ({ ...p, loop: v }))} />
                </label>
              </div>

              {/* 触发器 */}
              <div className="flex items-end gap-3">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-muted">触发方式</span>
                  <select
                    value={s.trigger.type}
                    onChange={(e) => setS((p) => ({ ...p, trigger: { type: e.target.value } }))}
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {TRIGGER_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>{t.label}</option>
                    ))}
                  </select>
                </label>
                {triggerDef?.valueLabel && (
                  <label className="block flex-1">
                    <span className="mb-1.5 block text-xs font-medium text-muted">{triggerDef.valueLabel}</span>
                    <Input
                      value={String(s.trigger.value ?? "")}
                      placeholder={triggerDef.valuePlaceholder}
                      onChange={(e) => setS((p) => ({ ...p, trigger: { ...p.trigger, value: e.target.value } }))}
                    />
                  </label>
                )}
              </div>

              {/* 步骤 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">步骤（{s.steps.length}）</span>
                  <select
                    value=""
                    onChange={(e) => e.target.value && addStep(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    <option value="">+ 添加步骤…</option>
                    {STEP_TYPES.map((t) => (
                      <option key={t.do} value={t.do}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  {s.steps.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
                      从右上角「添加步骤」开始
                    </p>
                  )}
                  {s.steps.map((step, i) => {
                    const def = STEP_MAP[step.do];
                    return (
                      <div key={i} className="rounded-lg border border-border bg-surface-2/40 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            {i + 1}. {def?.label ?? `高级：${step.do}`}
                          </span>
                          <div className="flex gap-1">
                            <IconBtn onClick={() => moveStep(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                            <IconBtn onClick={() => moveStep(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                            <IconBtn onClick={() => delStep(i)}><Trash2 className="h-3.5 w-3.5 text-danger" /></IconBtn>
                          </div>
                        </div>
                        {def ? (
                          def.fields.length === 0 ? (
                            <span className="text-[11px] text-muted">无参数</span>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {def.fields.map((f) => (
                                <label key={f.k} className="block">
                                  <span className="mb-1 block text-[10px] text-muted">{f.label}</span>
                                  <Input
                                    className="h-8 text-xs"
                                    type={f.type === "number" ? "number" : "text"}
                                    value={String(step[f.k] ?? "")}
                                    onChange={(e) =>
                                      updateStep(i, f.k, f.type === "number" ? Number(e.target.value) : e.target.value)
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                          )
                        ) : (
                          <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-[10px] text-muted">
                            {JSON.stringify(step)}（请用 JSON 模式编辑）
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
              className="h-80 w-full rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/50"
            />
          )}

          {err && <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}
