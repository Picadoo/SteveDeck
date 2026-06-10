import { useState, useEffect, useRef } from "react";
import { X, ArrowUp, ArrowDown, Trash2, Code2, Blocks } from "lucide-react";
import { Button, Input, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { STEP_TYPES, STEP_MAP, TRIGGER_TYPES, type StepFieldDef } from "./stepDefs";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import type { BotScript } from "@mcbot/protocol";

type Mode = "visual" | "json";
interface EditScript {
  name: string;
  loop: boolean;
  server: string; // 适用服务器 host；空=通用
  category: string; // 分类/文件夹；空=未分类
  trigger: { type: string; value?: string | number };
  steps: any[];
}

// UIFEAT-5：给每个步骤分配稳定 id 当 React key——编辑/上下移动/嵌套重排时 key 不随下标漂移，
// 避免输入焦点/非受控态串到错行。仅用于编辑期，保存前用 stripKeys 全部剔除（见 toScript），
// 因此不会进入下发给引擎的 payload（引擎按 step.do 派发并会遍历步骤字段，不应见到 __key）。
const STEP_KEY = "__key";
let stepKeySeq = 0;
const newStepKey = () => `s${++stepKeySeq}`;

// 仅把「步骤对象」(纯对象，区别于数组/标量) 当作要打/剔 key 的目标；
// 嵌套容器(then/else/steps)是「步骤对象数组」，递归进去。其它数组(如某些标量数组字段)原样保留，
// 避免对字符串元素跑 Object.keys 把 "abc" 拆成 {0:'a',...} 破坏数据。
const isStepObj = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);

/** 递归给步骤及其嵌套容器步骤补上稳定 __key（已有则保留）。 */
function assignKeys(steps: any[]): any[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((st) => {
    if (!isStepObj(st)) return st; // 非对象元素（异常 JSON）原样保留
    const out = { ...st };
    if (typeof out[STEP_KEY] !== "string") out[STEP_KEY] = newStepKey();
    for (const k of Object.keys(out)) {
      // 只递归「对象数组」(嵌套子步骤)；标量数组/标量字段不动
      if (k !== STEP_KEY && Array.isArray(out[k]) && out[k].some(isStepObj)) out[k] = assignKeys(out[k]);
    }
    return out;
  });
}

/** 递归剔除 __key，得到对外（保存/引擎）干净的步骤数组。 */
function stripKeys(steps: any[]): any[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((st) => {
    if (!isStepObj(st)) return st;
    const out: any = {};
    for (const k of Object.keys(st)) {
      if (k === STEP_KEY) continue;
      out[k] = Array.isArray(st[k]) && st[k].some(isStepObj) ? stripKeys(st[k]) : st[k];
    }
    return out;
  });
}

// UIFEAT-8：最小脚本形状校验——对象 + 字符串 name + 数组 steps。
// visual↔JSON 切换、JSON 模式保存都复用它，挡住「合法 JSON 但非合规脚本」（如缺 steps / steps 非数组），
// 不再静默回退默认 steps:[] 丢用户内容，也不下发畸形脚本。
function isValidScriptShape(x: any): x is BotScript {
  return !!x && typeof x === "object" && !Array.isArray(x) && typeof x.name === "string" && Array.isArray(x.steps);
}

function toEdit(s: BotScript | null, defaultServer = ""): EditScript {
  if (!s)
    return { name: "新脚本", loop: false, server: defaultServer, category: "", trigger: { type: "manual" }, steps: [] };
  return {
    name: s.name || "新脚本",
    loop: !!s.loop,
    server: s.server ?? "",
    category: s.category ?? "",
    trigger: { type: s.trigger?.type || "manual", value: s.trigger?.value },
    steps: Array.isArray(s.steps) ? assignKeys(JSON.parse(JSON.stringify(s.steps))) : [],
  };
}
function toScript(e: EditScript): BotScript {
  const trigger: any = { type: e.trigger.type };
  if (e.trigger.value !== undefined && e.trigger.value !== "") trigger.value = e.trigger.value;
  const out: any = { name: e.name.trim(), loop: e.loop, trigger, steps: stripKeys(e.steps) };
  if (e.server) out.server = e.server;
  if (e.category.trim()) out.category = e.category.trim();
  return out as BotScript;
}

function listIdFor(key: string): string | undefined {
  if (key === "item") return "mc-items";
  if (key === "entity") return "mc-entities";
  if (key === "player") return "mc-players";
  return undefined;
}

export default function ScriptEditor({
  open,
  initial,
  botId,
  categories = [],
  onClose,
  onSave,
}: {
  open: boolean;
  initial: BotScript | null;
  botId?: string;
  categories?: string[];
  onClose: () => void;
  onSave: (script: BotScript) => void;
}) {
  const [mode, setMode] = useState<Mode>("visual");
  const [s, setS] = useState<EditScript>(toEdit(initial));
  const [json, setJson] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const bot = useStore((st) => st.bots.find((b) => b.id === botId));
  // 脏判断快照：打开时的脚本序列化结果；遮罩点击关闭前与当前比对，有改动先确认（防录制草稿一点蒸发）
  const baselineRef = useRef("");

  function requestClose() {
    let now: string;
    if (mode === "json") {
      // JSON 模式显示的是 pretty-print，先归一成紧凑形态再与基线比；解析不了视作有改动
      try { now = JSON.stringify(JSON.parse(json)); } catch { now = "__invalid__"; }
    } else {
      now = JSON.stringify(toScript(s));
    }
    if (now !== baselineRef.current && !window.confirm("有未保存的修改，确定丢弃并关闭？")) return;
    onClose();
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // 自建弹窗容器（没用共享 Modal）：补 Esc 关闭，与其他弹窗行为一致（同样走丢稿确认）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const init = toEdit(initial, bot?.host || "");
    setS(init);
    baselineRef.current = JSON.stringify(toScript(init));
    setMode("visual");
    setErr(null);
    let cancelled = false; // UIFEAT-9：关闭/切 bot 后不再 setState
    if (botId) {
      cmd.observe(botId).then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        const o: any = r.data;
        setItems(Array.from(new Set((o.inventory || []).map((i: any) => i.name))));
        setEntities(Array.from(new Set((o.nearbyEntities || []).map((e: any) => e.name))));
        setPlayers((o.nearbyPlayers || []).map((p: any) => p.name));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, initial, botId]);

  if (!open) return null;

  function switchMode(next: Mode) {
    setErr(null);
    if (next === "json") {
      setJson(JSON.stringify(toScript(s), null, 2));
      setMode("json");
    } else {
      let parsed: any;
      try {
        parsed = JSON.parse(json);
      } catch (e: any) {
        return setErr("JSON 解析失败：" + e.message); // 语法错误：停在 JSON 模式，不丢内容
      }
      // UIFEAT-8：合法 JSON 但不是合规脚本 → 明确报错并停留，绝不静默回退默认 steps:[]。
      if (!isValidScriptShape(parsed)) {
        return setErr("不是合规脚本：需要对象且含字符串 name 与数组 steps");
      }
      setS(toEdit(parsed, bot?.host || ""));
      setMode("visual");
    }
  }
  function save() {
    if (mode === "json") {
      let parsed: any;
      try {
        parsed = JSON.parse(json);
      } catch (e: any) {
        return setErr("JSON 解析失败：" + e.message);
      }
      // UIFEAT-8：保存前做同一套形状校验，不把畸形脚本下发给引擎。
      if (!isValidScriptShape(parsed)) {
        return setErr("不是合规脚本：需要对象且含字符串 name 与数组 steps");
      }
      if (!parsed.name.trim()) return setErr("脚本名称不能为空");
      onSave({ ...parsed, steps: stripKeys(parsed.steps) }); // 保险：剔除用户可能手写进来的 __key，保持 payload 干净
    } else {
      if (!s.name.trim()) return setErr("脚本名称不能为空");
      onSave(toScript(s));
    }
  }

  const triggerDef = TRIGGER_TYPES.find((t) => t.type === s.trigger.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={requestClose} aria-hidden />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">脚本编辑器</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => switchMode("visual")} className={cn("rounded-md px-2.5 py-1 text-xs", mode === "visual" ? "bg-surface-2 text-fg" : "text-muted")}>
              <Blocks className="mr-1 inline h-3.5 w-3.5" />积木
            </button>
            <button onClick={() => switchMode("json")} className={cn("rounded-md px-2.5 py-1 text-xs", mode === "json" ? "bg-surface-2 text-fg" : "text-muted")}>
              <Code2 className="mr-1 inline h-3.5 w-3.5" />JSON
            </button>
            <button onClick={requestClose} aria-label="关闭" className="ml-1 text-muted hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === "visual" ? (
            <div className="space-y-4">
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

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">适用服务器</span>
                <select
                  value={s.server}
                  onChange={(e) => setS((p) => ({ ...p, server: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="">通用（所有服务器都显示）</option>
                  {bot?.host && <option value={bot.host}>仅本服：{bot.note || bot.host}</option>}
                  {s.server && s.server !== bot?.host && <option value={s.server}>仅：{s.server}</option>}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">分类（可选，脚本页按此分组）</span>
                <Input
                  list="script-cats"
                  value={s.category}
                  onChange={(e) => setS((p) => ({ ...p, category: e.target.value }))}
                  placeholder="如 地点传送 / 领取奖励（留空=未分类）"
                />
              </label>

              <div className="flex items-end gap-3">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-muted">触发方式</span>
                  <select value={s.trigger.type} onChange={(e) => setS((p) => ({ ...p, trigger: { type: e.target.value } }))} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50">
                    {TRIGGER_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                  </select>
                </label>
                {triggerDef?.valueLabel && (
                  <label className="block flex-1">
                    <span className="mb-1.5 block text-xs font-medium text-muted">{triggerDef.valueLabel}</span>
                    <Input value={String(s.trigger.value ?? "")} placeholder={triggerDef.valuePlaceholder} onChange={(e) => setS((p) => ({ ...p, trigger: { ...p.trigger, value: e.target.value } }))} />
                  </label>
                )}
              </div>

              <div>
                <span className="mb-2 block text-xs font-medium text-muted">步骤</span>
                <StepList steps={s.steps} onChange={(steps) => setS((p) => ({ ...p, steps }))} depth={0} />
              </div>
            </div>
          ) : (
            <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} className="h-80 w-full rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/50" />
          )}

          {err && <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>

      {/* 自动补全数据源（来自 AI 感知） */}
      <datalist id="script-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="mc-items">{items.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="mc-entities">{entities.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="mc-players">{players.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}

function StepList({ steps, onChange, depth }: { steps: any[]; onChange: (s: any[]) => void; depth: number }) {
  function add(doType: string) {
    const def = STEP_MAP[doType];
    const step: any = { do: doType, [STEP_KEY]: newStepKey() }; // UIFEAT-5：新增即分配稳定 key
    def?.fields.forEach((f) => {
      step[f.k] =
        f.type === "number" ? 0 : f.type === "bool" ? false : f.type === "select" ? f.options?.[0]?.value ?? "" : "";
    });
    def?.containers?.forEach((c) => (step[c.key] = []));
    onChange([...steps, step]);
  }
  const update = (i: number, k: string, v: any) => {
    const a = steps.slice();
    a[i] = { ...a[i], [k]: v };
    onChange(a);
  };
  const move = (i: number, d: number) => {
    const a = steps.slice();
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  const del = (i: number) => onChange(steps.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <p className="rounded-lg border border-dashed border-border py-3 text-center text-[11px] text-muted">空，从下方添加步骤</p>
      )}
      {steps.map((step, i) => (
        <StepCard
          key={step[STEP_KEY] ?? i}
          step={step}
          index={i}
          total={steps.length}
          depth={depth}
          onField={(k, v) => update(i, k, v)}
          onMove={(d) => move(i, d)}
          onDelete={() => del(i)}
        />
      ))}
      <select
        value=""
        onChange={(e) => e.target.value && add(e.target.value)}
        className="h-8 w-full rounded-lg border border-dashed border-border bg-surface px-2 text-xs text-muted outline-none focus:ring-2 focus:ring-accent/50"
      >
        <option value="">+ 添加步骤…</option>
        {/* 常用步骤在前；不切实际/易错的（advanced）收进「高级」分组，不删除以兼容老脚本 */}
        {STEP_TYPES.filter((t) => !t.advanced).map((t) => <option key={t.do} value={t.do}>{t.label}</option>)}
        <optgroup label="高级（不常用）">
          {STEP_TYPES.filter((t) => t.advanced).map((t) => <option key={t.do} value={t.do}>{t.label}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  depth,
  onField,
  onMove,
  onDelete,
}: {
  step: any;
  index: number;
  total: number;
  depth: number;
  onField: (k: string, v: any) => void;
  onMove: (d: number) => void;
  onDelete: () => void;
}) {
  const def = STEP_MAP[step.do];
  return (
    <div className={cn("rounded-lg border border-border p-2.5", depth > 0 ? "bg-surface-2/20" : "bg-surface-2/40")}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold">{index + 1}. {def?.label ?? `高级：${step.do}`}</span>
        <div className="flex gap-1">
          <IconBtn onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn onClick={() => onMove(1)} disabled={index === total - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-danger" /></IconBtn>
        </div>
      </div>

      {def ? (
        <>
          {def.fields.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {def.fields.map((f: StepFieldDef) => (
                <label key={f.k} className="block">
                  <span className="mb-1 block text-[10px] text-muted">{f.label}</span>
                  {f.type === "bool" ? (
                    <div className="flex h-8 items-center">
                      <input
                        type="checkbox"
                        checked={!!step[f.k]}
                        onChange={(e) => onField(f.k, e.target.checked)}
                        className="h-4 w-4 accent-accent"
                      />
                    </div>
                  ) : f.type === "select" ? (
                    <select
                      value={String(step[f.k] ?? "")}
                      onChange={(e) => {
                        const opt = f.options?.find((o) => String(o.value) === e.target.value);
                        onField(f.k, opt ? opt.value : e.target.value);
                      }}
                      className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      {f.options?.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="h-8 text-xs"
                      type={f.type === "number" ? "number" : "text"}
                      list={listIdFor(f.k)}
                      value={String(step[f.k] ?? "")}
                      onChange={(e) => onField(f.k, f.type === "number" ? Number(e.target.value) : e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          )}
          {def.containers?.map((c) => (
            <div key={c.key} className="mt-2 border-l-2 border-accent/40 pl-2.5">
              <div className="mb-1 text-[10px] font-medium text-muted">{c.label}</div>
              <StepList
                steps={Array.isArray(step[c.key]) ? step[c.key] : []}
                onChange={(sub) => onField(c.key, sub)}
                depth={depth + 1}
              />
            </div>
          ))}
        </>
      ) : (
        <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-[10px] text-muted">{JSON.stringify(stripKeys([step])[0])}（请用 JSON 模式编辑）</pre>
      )}
    </div>
  );
}

function IconBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-30">
      {children}
    </button>
  );
}
