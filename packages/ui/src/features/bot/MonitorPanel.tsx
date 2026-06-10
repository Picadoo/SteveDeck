import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, RotateCcw, Pencil, Radio, FlaskConical, Power, Settings, ChevronDown, Sparkles } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { useConfirmClick } from "@/lib/useConfirmClick";
import { fmtBig } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MONITOR_PRESETS, instantiatePreset, blankRule } from "./monitorPresets";
import type { MonitorRule, MonitorStat, MonitorKeyStat } from "@mcbot/protocol";

const AGG: { key: MonitorRule["agg"]; label: string; hint: string }[] = [
  { key: "sum", label: "累加", hint: "总收入/总量" },
  { key: "count", label: "计次", hint: "命中次数" },
  { key: "last", label: "取最新", hint: "当前余额" },
  { key: "max", label: "峰值", hint: "最高值" },
  { key: "rate", label: "速率", hint: "每分钟" },
];
const aggLabel = (a: MonitorRule["agg"]) => AGG.find((x) => x.key === a)?.label ?? a;

const fmtVal = (v: number | string | null | undefined): string =>
  v == null ? "—" : typeof v === "number" ? fmtBig(v) : String(v);

/** 一条规则的主数（按聚合方式） */
function mainValue(rule: MonitorRule, st?: MonitorStat): string {
  if (!st || st.count === 0) return "—";
  if (rule.keyGroup && st.byKey) return `${Object.keys(st.byKey).length} 种`; // 分组规则：主数=种类数，细分在下方
  switch (rule.agg) {
    case "count":
      return fmtBig(st.count);
    case "last":
      return fmtVal(st.last);
    case "max":
      return st.max != null ? fmtBig(st.max) : "—";
    case "rate":
      return `${fmtBig(Math.round(st.perMin))}/分`;
    default:
      return fmtBig(st.total);
  }
}
/** 某个分类键桶按聚合方式取展示值 */
function keyValue(rule: MonitorRule, k: MonitorKeyStat): string {
  switch (rule.agg) {
    case "count":
      return fmtBig(k.count);
    case "last":
      return fmtVal(k.last);
    case "max":
      return k.max != null ? fmtBig(k.max) : "—";
    default:
      return fmtBig(k.total);
  }
}
function subText(rule: MonitorRule, st?: MonitorStat): string {
  if (!st || st.count === 0) return "未命中";
  const rate = st.perMin >= 0.1 && (rule.agg === "sum" || rule.agg === "count") ? ` · ${fmtBig(Math.round(st.perMin))}/分` : "";
  return `命中 ${st.count} 次${rate}`;
}
function keyRows(rule: MonitorRule, st?: MonitorStat): [string, MonitorKeyStat][] {
  if (!st?.byKey) return [];
  const num = (k: MonitorKeyStat): number => {
    switch (rule.agg) {
      case "count":
        return k.count;
      case "last":
        return typeof k.last === "number" ? k.last : 0;
      case "max":
        return k.max ?? 0;
      default:
        return k.total;
    }
  };
  return Object.entries(st.byKey).sort((a, b) => num(b[1]) - num(a[1]));
}

export default function MonitorPanel({ botId }: { botId: string }) {
  const stats = useStore((s) => s.monitorStats[botId]) ?? {};
  const pushToast = useStore((s) => s.pushToast);
  const [rules, setRules] = useState<MonitorRule[]>([]);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<MonitorRule | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await cmd.monitor.get(botId);
      if (r.ok && r.data) setRules(r.data.rules || []);
    })();
  }, [botId]);

  async function save(next: MonitorRule[]) {
    setRules(next);
    const r = await cmd.monitor.setRules(botId, next);
    if (!r.ok) pushToast(r.error || "保存失败", "error");
  }
  const toggle = (id: string) => save(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const del = (id: string) => save(rules.filter((r) => r.id !== id));
  const upsert = (rule: MonitorRule) => {
    const has = rules.some((r) => r.id === rule.id);
    save(has ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
  };
  function applyPreset(p: (typeof MONITOR_PRESETS)[number]) {
    const existing = new Set(rules.map((r) => r.label));
    const fresh = instantiatePreset(p).filter((r) => !existing.has(r.label));
    save([...rules, ...fresh]);
    setShowPresets(false);
    pushToast(`已应用预设「${p.name}」（新增 ${fresh.length} 条）`, fresh.length ? "success" : "info");
  }
  async function resetStats() {
    const r = await cmd.monitor.reset(botId);
    pushToast(r.ok ? "统计已重置" : (r.error || "重置失败"), r.ok ? "info" : "error");
  }
  // 两段式确认：累计数据一键清零不可恢复，第一次点变「确认?」，2.5s 内再点才执行
  const resetHeader = useConfirmClick(resetStats);
  const resetDialog = useConfirmClick(resetStats);

  const enabled = rules.filter((r) => r.enabled);

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-border bg-surface-2/30">
      {/* 折叠头：紧凑统计条 + 配置入口 */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="shrink-0 font-medium">监听统计</span>
          {!open && (
            <span className="flex min-w-0 items-center gap-2 overflow-hidden text-muted">
              {enabled.length === 0 ? (
                <span className="text-muted/70">未配置</span>
              ) : (
                enabled.slice(0, 5).map((r) => (
                  <span key={r.id} className="shrink-0 whitespace-nowrap">
                    {r.label} <span className="font-semibold text-fg">{mainValue(r, stats[r.id])}</span>
                  </span>
                ))
              )}
            </span>
          )}
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {enabled.length > 0 && (
          <button
            onClick={resetHeader.onClick}
            className={cn(
              "shrink-0 rounded p-1 transition-colors",
              resetHeader.arming ? "bg-danger/15 text-danger" : "text-muted hover:bg-surface hover:text-fg",
            )}
            title={resetHeader.arming ? "再点一次确认清零" : "清零统计数值"}
          >
            {resetHeader.arming ? <span className="px-0.5 text-[10px] font-medium">确认?</span> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          onClick={() => setManage(true)}
          className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-fg"
          title="配置监听规则"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 展开：完整统计卡（含分类键细分） */}
      {open && (
        <div className="space-y-1.5 border-t border-border px-2.5 py-2">
          {rules.length === 0 ? (
            <button onClick={() => setManage(true)} className="w-full py-3 text-center text-xs text-muted hover:text-fg">
              还没有监听规则，点此配置 →
            </button>
          ) : (
            rules.map((rule) => {
              const st = stats[rule.id];
              const krows = keyRows(rule, st);
              return (
                <div key={rule.id} className={cn("rounded-md bg-surface-2/50 px-2.5 py-1.5", !rule.enabled && "opacity-40")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs">
                      {rule.label}
                      <Badge tone="neutral">{aggLabel(rule.agg)}</Badge>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-sm font-semibold tabular-nums">{mainValue(rule, st)}</span>
                      <span className="ml-1.5 text-[10px] text-muted">{subText(rule, st)}</span>
                    </span>
                  </div>
                  {krows.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      {krows.slice(0, 8).map(([k, v]) => (
                        <span key={k} className="whitespace-nowrap">
                          {k} <span className="font-medium text-fg">{keyValue(rule, v)}</span>
                        </span>
                      ))}
                      {krows.length > 8 && <span>…+{krows.length - 8}</span>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 配置弹窗：规则增删改 + 预设 + 重置 */}
      <Modal
        open={manage}
        onClose={() => setManage(false)}
        title="监听规则配置"
        size="lg"
        footer={
          <>
            <Button
              variant={resetDialog.arming ? "danger" : "ghost"}
              onClick={resetDialog.onClick}
            >
              <RotateCcw className="h-3.5 w-3.5" /> {resetDialog.arming ? "确认重置?" : "重置统计"}
            </Button>
            <Button variant="secondary" onClick={() => setShowPresets(true)}>
              预设
            </Button>
            <Button variant="primary" onClick={() => setEditing(blankRule())}>
              <Plus className="h-3.5 w-3.5" /> 新建规则
            </Button>
          </>
        }
      >
        {rules.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">
            还没有规则，点「预设」一键导入，或「新建规则」手动添加
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map((rule) => (
              <div key={rule.id} className={cn("flex items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-2", !rule.enabled && "opacity-50")}>
                <button onClick={() => toggle(rule.id)} className={cn("shrink-0", rule.enabled ? "text-success" : "text-muted")} title={rule.enabled ? "停用" : "启用"}>
                  <Power className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{rule.label || "(未命名)"}</span>
                    <Badge tone="neutral">{aggLabel(rule.agg)}</Badge>
                    {rule.keyGroup ? <Badge tone="accent">分组</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted/70">/{rule.pattern}/</div>
                </div>
                <button onClick={() => setEditing(rule)} className="shrink-0 rounded p-1 text-muted hover:text-fg" title="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => del(rule.id)} className="shrink-0 rounded p-1 text-muted hover:text-danger" title="删除">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {editing && <RuleEditor botId={botId} rule={editing} onSave={upsert} onClose={() => setEditing(null)} />}

      <Modal open={showPresets} onClose={() => setShowPresets(false)} title="选择预设">
        <div className="space-y-2">
          {MONITOR_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className="w-full rounded-lg border border-border bg-surface-2/50 p-3 text-left transition-colors hover:border-accent hover:bg-accent/10"
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-muted">{p.rules.map((r) => r.label).join(" · ")}</div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ===== 通用「消息→规则」助手：粘一条消息，点数字=要统计的值、点词=按它分类，自动生成正则规则。 =====
// 不针对任何服务器：纯靠用户标注 + 文本结构生成。这样不会写正则的人也能在任意服务器搓出自己的统计（含按材料分类计数）。
type Tok = { type: "num" | "word" | "sep"; text: string };
function tokenize(msg: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?[万亿兆]?)|([一-龥]+|[A-Za-z]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    if (m.index > last) out.push({ type: "sep", text: msg.slice(last, m.index) });
    out.push({ type: m[1] ? "num" : "word", text: m[0] });
    last = re.lastIndex;
  }
  if (last < msg.length) out.push({ type: "sep", text: msg.slice(last) });
  return out;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sepToRe = (s: string) => s.replace(/(\s+)|(\S+)/g, (_m, ws, nw) => (ws ? "\\s*" : escapeRe(nw)));
function buildRule(toks: Tok[], valueIdx: number, keyIdx: number) {
  let pattern = "";
  let grp = 0;
  let valueGroup = 1;
  let keyGroup = 0;
  toks.forEach((t, i) => {
    if (i === valueIdx) {
      grp++;
      valueGroup = grp;
      pattern += "([\\d,]+(?:\\.\\d+)?\\s*[万亿兆]?)";
    } else if (i === keyIdx) {
      grp++;
      keyGroup = grp;
      pattern += "(.+?)";
    } else if (t.type === "num") {
      pattern += "\\d[\\d,]*";
    } else if (t.type === "sep") {
      pattern += sepToRe(t.text);
    } else {
      pattern += escapeRe(t.text);
    }
  });
  return { pattern, valueGroup, keyGroup };
}

function RuleFromMessage({
  onApply,
}: {
  onApply: (p: { pattern: string; valueGroup: number; keyGroup: number; agg: MonitorRule["agg"] }) => void;
}) {
  const [msg, setMsg] = useState("");
  const [valueIdx, setValueIdx] = useState(-1);
  const [keyIdx, setKeyIdx] = useState(-1);
  const toks = useMemo(() => tokenize(msg), [msg]);
  useEffect(() => {
    setValueIdx(-1);
    setKeyIdx(-1);
  }, [msg]);

  function apply() {
    if (valueIdx < 0) return;
    const { pattern, valueGroup, keyGroup } = buildRule(toks, valueIdx, keyIdx);
    // 余额/当前类→取最新；否则累加
    const before = toks.slice(Math.max(0, valueIdx - 3), valueIdx).map((t) => t.text).join("");
    const agg: MonitorRule["agg"] = /当前|现有|剩余|余额|拥有|共有|还有/.test(before) ? "last" : "sum";
    onApply({ pattern, valueGroup, keyGroup, agg });
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent">
        <Sparkles className="h-3.5 w-3.5" /> 从消息生成（不会写正则也能用）
      </div>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        rows={2}
        placeholder="粘一条游戏里的消息，如：已存入 天秤座灵息X3, 当前 473 个"
        className="w-full resize-none rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-accent/50"
      />
      {toks.some((t) => t.type !== "sep") && (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 rounded bg-surface-2/50 p-1.5 text-xs">
            {toks.map((t, i) =>
              t.type === "sep" ? (
                <span key={i} className="whitespace-pre text-muted">{t.text}</span>
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    t.type === "num" ? setValueIdx((v) => (v === i ? -1 : i)) : setKeyIdx((k) => (k === i ? -1 : i))
                  }
                  className={cn(
                    "rounded px-1 transition-colors",
                    i === valueIdx
                      ? "bg-success/25 text-success ring-1 ring-success/50"
                      : i === keyIdx
                        ? "bg-accent/25 text-accent ring-1 ring-accent/50"
                        : t.type === "num"
                          ? "bg-surface hover:bg-success/15"
                          : "bg-surface hover:bg-accent/15",
                  )}
                >
                  {t.text}
                </button>
              ),
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] leading-tight text-muted">
              点<span className="text-success">数字</span>=要统计的值 · 点<span className="text-accent">词</span>=按它分类（材料多种）
            </span>
            <Button size="sm" variant="secondary" disabled={valueIdx < 0} onClick={apply}>
              生成规则
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RuleEditor({
  botId,
  rule,
  onSave,
  onClose,
}: {
  botId: string;
  rule: MonitorRule;
  onSave: (r: MonitorRule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MonitorRule>(rule);
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<MonitorRule>) => setDraft((d) => ({ ...d, ...patch }));

  async function runTest() {
    const r = await cmd.monitor.test(botId, draft.pattern, draft.valueGroup || 1, draft.numberMode, sample);
    if (!r.ok || !r.data) setResult({ ok: false, text: r.error || "测试失败" });
    else if (r.data.error) setResult({ ok: false, text: r.data.error });
    else if (!r.data.matched) setResult({ ok: false, text: "未命中" });
    else setResult({ ok: true, text: `命中 · 值捕获="${r.data.group}"${draft.numberMode ? ` → 数值 ${r.data.value}` : ""}` });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule.label ? "编辑规则" : "新建规则"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!draft.label.trim() || !draft.pattern.trim()} onClick={() => onSave(draft)}>保存</Button>
        </>
      }
    >
      <div className="space-y-3">
        <RuleFromMessage
          onApply={(p) =>
            set({
              pattern: p.pattern,
              valueGroup: p.valueGroup,
              keyGroup: p.keyGroup || undefined,
              numberMode: true,
              agg: p.agg,
            })
          }
        />
        <Field label="名称">
          <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="如：金币收入" />
        </Field>
        <Field label="正则（对去色码纯文本匹配，可含多个捕获组）">
          <Input
            value={draft.pattern}
            onChange={(e) => set({ pattern: e.target.value })}
            placeholder="已存入\s*(.+?)X(\d+)"
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <Field label="值捕获组">
            <NumIn value={draft.valueGroup ?? 1} min={1} onChange={(v) => set({ valueGroup: v })} />
          </Field>
          <Field label="分组键组（0=不分组）">
            <NumIn value={draft.keyGroup ?? 0} min={0} onChange={(v) => set({ keyGroup: v || undefined })} />
          </Field>
          <label className="flex cursor-pointer items-center gap-1.5 pt-5 text-sm">
            <input type="checkbox" checked={draft.numberMode} onChange={(e) => set({ numberMode: e.target.checked })} className="h-4 w-4 accent-accent" />
            解析为数字（认 万/亿/兆）
          </label>
        </div>
        <p className="-mt-1 text-[11px] text-muted">
          分组键：把某个捕获组当「物品名」等分类，按它各自累计。如「已存入 (物品)X(数量)」设 分组键=1、值=2，就能分物品统计。
        </p>
        <Field label="聚合方式">
          <div className="flex flex-wrap gap-1">
            {AGG.map((a) => (
              <button
                key={a.key}
                onClick={() => set({ agg: a.key })}
                title={a.hint}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  draft.agg === a.key ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-fg",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <FlaskConical className="h-3.5 w-3.5" /> 测试匹配（粘一条服务器消息，§ 色码自动忽略）
          </div>
          <div className="flex gap-1.5">
            <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="已存入 §f§b梦魇营长残障§7X3, 当前 8706 个" className="flex-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={runTest} disabled={!draft.pattern.trim() || !sample.trim()}>测试</Button>
          </div>
          {result && <div className={cn("mt-1.5 text-xs", result.ok ? "text-success" : "text-danger")}>{result.text}</div>}
        </div>
      </div>
    </Modal>
  );
}

function NumIn({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
