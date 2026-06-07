import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2, Pencil, Power, Settings, Utensils } from "lucide-react";
import { Card, Switch, Button, Badge, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { BotSummary, AutoUseRule } from "@mcbot/protocol";

// ===== 选项与中文标签 =====
type TrigType = AutoUseRule["trigger"]["type"];
const TRIGGERS: { key: TrigType; label: string }[] = [
  { key: "food_below", label: "饱食低于" },
  { key: "health_below", label: "血量低于" },
  { key: "effect_missing", label: "缺少效果" },
  { key: "interval", label: "每隔(秒)" },
];
const MATCH_BY: { key: AutoUseRule["match"]["by"]; label: string }[] = [
  { key: "category", label: "类别" },
  { key: "name", label: "物品 ID" },
  { key: "displayName", label: "显示名含" },
  { key: "slot", label: "固定槽位" },
];
const METHODS: { key: AutoUseRule["method"]; label: string }[] = [
  { key: "air", label: "右键空气" },
  { key: "sneak_air", label: "潜行右键" },
  { key: "block", label: "对方块" },
  { key: "entity", label: "对生物" },
];
const methodLabel = (m: AutoUseRule["method"]) => METHODS.find((x) => x.key === m)?.label ?? m;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return "r" + Math.random().toString(36).slice(2, 10);
}

function blankRule(): AutoUseRule {
  return {
    id: newId(),
    enabled: true,
    trigger: { type: "food_below", value: 17 },
    match: { by: "category", value: "food" },
    method: "air",
    cooldownSec: 2,
  };
}

// 一句话概述一条规则：触发 → 用什么 · 怎么用
function ruleSummary(r: AutoUseRule): string {
  const t = r.trigger;
  let trig = "";
  if (t.type === "food_below") trig = `饱食<${t.value}`;
  else if (t.type === "health_below") trig = `血量<${t.value}`;
  else if (t.type === "effect_missing") trig = `缺「${t.effect || "?"}」`;
  else trig = `每 ${t.everySec}s`;

  const m = r.match;
  let item = "";
  if (m.by === "category") item = m.value === "food" ? "任意食物" : String(m.value);
  else if (m.by === "name") item = String(m.value);
  else if (m.by === "displayName") item = `名含「${m.value}」`;
  else item = `槽 ${m.value}`;

  return `${trig} → ${item} · ${methodLabel(r.method)}`;
}

export default function AutoUsePanel({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [rules, setRules] = useState<AutoUseRule[]>([]);
  const [active, setActive] = useState(false);
  const [optimActive, setOptimActive] = useState<boolean | null>(null);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<AutoUseRule | null>(null);
  const checked = optimActive ?? active;

  // 从引擎持久化的 settings.autoUse 读「是否开启 + 规则」（与 MonitorPanel 同思路，无需 per-bot 状态字段）
  function load(alive?: () => boolean) {
    return cmd.getBotConfig(bot.id).then((r) => {
      if (alive && !alive()) return;
      const au = r.ok && r.data ? (r.data.settings as any)?.autoUse : null;
      setRules(Array.isArray(au?.rules) ? au.rules : []);
      setActive(!!au?.active);
      setOptimActive(null);
    });
  }
  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  async function toggle(v: boolean) {
    setOptimActive(v);
    const r = await cmd.toggleModule(bot.id, "auto_use", v, { rules });
    if (!r.ok) {
      pushToast(r.error || "操作失败", "error");
      setOptimActive(null);
    } else {
      load(); // 拿回服务端规则（首次开启会自动加载默认 auto-eat 规则）
    }
  }

  async function saveRules(next: AutoUseRule[]) {
    setRules(next);
    const r = await cmd.configModule(bot.id, "auto_use", { rules: next });
    if (!r.ok) pushToast(r.error || "保存失败", "error");
  }
  const toggleRule = (id: string) =>
    saveRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const del = (id: string) => saveRules(rules.filter((r) => r.id !== id));
  const upsert = (rule: AutoUseRule) => {
    const has = rules.some((r) => r.id === rule.id);
    saveRules(has ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
  };

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <Utensils className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium">自动使用</div>
            <div className="text-[11px] text-muted">条件→使用物品（自动进食/喝奶/续 buff…）</div>
          </div>
        </div>
        <Switch checked={checked} onChange={toggle} disabled={!bot.online} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-surface-2/50 px-2.5 py-2">
        <span className="text-[11px] text-muted">
          {rules.length === 0 ? "默认含自动进食规则" : `${rules.length} 条规则 · ${enabledCount} 启用`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setManage(true)}>
          <Settings className="h-3.5 w-3.5" /> 规则
        </Button>
      </div>

      {/* 规则管理 */}
      <Modal
        open={manage}
        onClose={() => setManage(false)}
        title="自动使用规则"
        size="lg"
        footer={
          <Button variant="primary" onClick={() => setEditing(blankRule())}>
            <Plus className="h-3.5 w-3.5" /> 新建规则
          </Button>
        }
      >
        {rules.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">
            还没有规则。点「新建规则」添加，或开启模块自动获得「饱食&lt;17 吃任意食物」默认规则。
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-2",
                  !rule.enabled && "opacity-50",
                )}
              >
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={cn("shrink-0", rule.enabled ? "text-success" : "text-muted")}
                  title={rule.enabled ? "停用" : "启用"}
                >
                  <Power className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{ruleSummary(rule)}</span>
                    {rule.cooldownSec ? <Badge tone="neutral">CD {rule.cooldownSec}s</Badge> : null}
                  </div>
                </div>
                <button
                  onClick={() => setEditing(rule)}
                  className="shrink-0 rounded p-1 text-muted hover:text-fg"
                  title="编辑"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => del(rule.id)}
                  className="shrink-0 rounded p-1 text-muted hover:text-danger"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {editing && (
        <RuleEditor
          rule={editing}
          isNew={!rules.some((r) => r.id === editing.id)}
          onSave={upsert}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function RuleEditor({
  rule,
  isNew,
  onSave,
  onClose,
}: {
  rule: AutoUseRule;
  isNew: boolean;
  onSave: (r: AutoUseRule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AutoUseRule>(rule);
  const set = (patch: Partial<AutoUseRule>) => setDraft((d) => ({ ...d, ...patch }));
  const setTrig = (patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } as AutoUseRule["trigger"] }));
  const setMatch = (patch: Partial<AutoUseRule["match"]>) =>
    setDraft((d) => ({ ...d, match: { ...d.match, ...patch } }));

  // 切换触发类型时给出该类型的默认参数
  function changeTrigType(type: TrigType) {
    if (type === "food_below") set({ trigger: { type, value: 17 } });
    else if (type === "health_below") set({ trigger: { type, value: 10 } });
    else if (type === "effect_missing") set({ trigger: { type, effect: "" } });
    else set({ trigger: { type, everySec: 60 } });
  }
  function changeMatchBy(by: AutoUseRule["match"]["by"]) {
    setMatch({ by, value: by === "category" ? "food" : by === "slot" ? 0 : "" });
  }

  const t = draft.trigger;
  const m = draft.match;
  const valid =
    (t.type === "effect_missing" ? !!(t.effect && t.effect.trim()) : true) &&
    (m.by === "category" || String(m.value).toString().length > 0 || m.by === "slot");

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "新建规则" : "编辑规则"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* 触发条件 */}
        <Field label="触发条件">
          <div className="flex flex-wrap gap-1">
            {TRIGGERS.map((tg) => (
              <Chip key={tg.key} active={t.type === tg.key} onClick={() => changeTrigType(tg.key)}>
                {tg.label}
              </Chip>
            ))}
          </div>
        </Field>
        {(t.type === "food_below" || t.type === "health_below") && (
          <Field label={t.type === "food_below" ? "饱食度阈值（低于则触发，满 20）" : "血量阈值（低于则触发，满 20）"}>
            <NumIn value={t.value} min={1} max={20} onChange={(v) => setTrig({ value: v })} />
          </Field>
        )}
        {t.type === "effect_missing" && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="效果名（mineflayer 名，如 speed / regeneration）">
              <Input
                value={t.effect}
                onChange={(e) => setTrig({ effect: e.target.value.trim() })}
                placeholder="speed"
                className="w-44 font-mono text-xs"
              />
            </Field>
            <Field label="剩余秒数低于则续（留空=完全没有才续）">
              <NumIn
                value={t.minRemainSec ?? 0}
                min={0}
                onChange={(v) => setTrig({ minRemainSec: v || undefined })}
              />
            </Field>
          </div>
        )}
        {t.type === "interval" && (
          <Field label="每隔多少秒触发一次">
            <NumIn value={t.everySec} min={1} onChange={(v) => setTrig({ everySec: v })} />
          </Field>
        )}

        {/* 物品匹配 */}
        <Field label="用哪个物品">
          <div className="flex flex-wrap gap-1">
            {MATCH_BY.map((mb) => (
              <Chip key={mb.key} active={m.by === mb.key} onClick={() => changeMatchBy(mb.key)}>
                {mb.label}
              </Chip>
            ))}
          </div>
        </Field>
        {m.by === "category" ? (
          <p className="-mt-1 text-[11px] text-muted">类别「食物」：背包里任意可食用物品都行（自动进食用它）。</p>
        ) : m.by === "slot" ? (
          <Field label="槽位号">
            <NumIn value={Number(m.value) || 0} min={0} onChange={(v) => setMatch({ value: v })} />
          </Field>
        ) : (
          <Field label={m.by === "name" ? "物品 ID（如 golden_apple / milk_bucket）" : "显示名/Lore 关键词（适配 RPG 自定义名）"}>
            <Input
              value={String(m.value)}
              onChange={(e) => setMatch({ value: e.target.value })}
              placeholder={m.by === "name" ? "golden_apple" : "钥匙"}
              className={m.by === "name" ? "font-mono text-xs" : ""}
            />
          </Field>
        )}

        {/* 使用方式 + 冷却 */}
        <div className="flex flex-wrap items-end gap-4">
          <Field label="使用方式">
            <div className="flex flex-wrap gap-1">
              {METHODS.map((me) => (
                <Chip key={me.key} active={draft.method === me.key} onClick={() => set({ method: me.key })}>
                  {me.label}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="冷却（秒，两次最小间隔）">
            <NumIn value={draft.cooldownSec ?? 0} min={0} onChange={(v) => set({ cooldownSec: v })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
        active ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function NumIn({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        let v = Number(e.target.value);
        if (!Number.isFinite(v)) v = min;
        v = Math.max(min, max != null ? Math.min(max, v) : v);
        onChange(v);
      }}
      className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
