import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { Button, Input, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { cmd } from "@/lib/engine";
import { closestName } from "@/lib/closestName";
import type { ModuleDef, FieldDef } from "./moduleDefs";

type RegistryNames = { items: string[]; blocks: string[] };

// 注册表按 bot 缓存：物品/方块名列表一次拉取（~2k 条），同会话内不重复请求
const registryCache = new Map<string, RegistryNames>();

function useRegistryNames(botId: string, enabled: boolean): RegistryNames | null {
  const [data, setData] = useState<RegistryNames | null>(() => registryCache.get(botId) ?? null);
  useEffect(() => {
    if (!enabled || data) return;
    let dead = false;
    cmd
      .moduleAction<RegistryNames>(botId, "registry", "names")
      .then((r) => {
        if (!dead && r.ok && r.data) {
          registryCache.set(botId, r.data);
          setData(r.data);
        }
      })
      .catch(() => {
        /* 离线/失败 → 不校验，静默降级 */
      });
    return () => {
      dead = true;
    };
  }, [botId, enabled, data]);
  return data;
}

export default function ModuleConfigDialog({
  def,
  botId,
  open,
  initial,
  onClose,
  onSave,
}: {
  def: ModuleDef;
  botId: string;
  open: boolean;
  initial: Record<string, unknown>;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [cfg, setCfg] = useState<Record<string, unknown>>(initial);
  const registry = useRegistryNames(botId, open && def.fields.some((f) => f.registry));

  function set(key: string, value: unknown) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${def.name} · 配置`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onSave(cfg)}>
            保存并应用
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {def.fields
          .filter((f) => !f.showIf || f.showIf(cfg))
          .map((f) => (
            <div key={f.key}>
              <FieldRow field={f} value={cfg[f.key]} onChange={(v) => set(f.key, v)} registry={registry} />
              {f.hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{f.hint}</p>}
            </div>
          ))}
      </div>
    </Modal>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  registry,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  registry: RegistryNames | null;
}) {
  // tags 拼写校验（hook 必须在所有分支 return 之前调用）
  const tagsArr = field.type === "tags" && Array.isArray(value) ? (value as string[]) : null;
  const regNames = field.registry && registry ? registry[field.registry] : null;
  const issues = useMemo(() => {
    if (!tagsArr || !regNames || regNames.length === 0) return [];
    const out: { tag: string; suggest: string | null }[] = [];
    for (const t of tagsArr) {
      const k = t.toLowerCase().trim();
      if (!k) continue;
      const hit =
        field.registryMatch === "includes" ? regNames.some((n) => n.includes(k)) : regNames.includes(k);
      if (!hit) out.push({ tag: t, suggest: closestName(k, regNames) });
    }
    return out;
  }, [tagsArr, regNames, field.registryMatch]);

  if (field.type === "switch") {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm">{field.label}</span>
        <Switch checked={!!value} onChange={onChange} />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">{field.label}</span>
        <Input
          type="number"
          className="w-24"
          min={field.min}
          max={field.max}
          step={field.step}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      </label>
    );
  }

  if (field.type === "tags") {
    const arr = tagsArr ?? [];
    return (
      <label className="block">
        <span className="mb-1.5 block text-sm">{field.label}</span>
        <Input
          value={arr.join(", ")}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(
              e.target.value
                // 中文输入法下逗号/顿号是「，」「、」——只认英文逗号会静默不分隔，模块开了不干活
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
        {issues.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {issues.map((i) => (
              <p key={i.tag} className="text-[11px] text-danger">
                「{i.tag}」
                {field.registryMatch === "includes" ? "匹配不到任何物品" : "不是有效名字"}
                {i.suggest && (
                  <>
                    ，是不是{" "}
                    <button
                      type="button"
                      className="font-medium underline underline-offset-2"
                      onClick={() => onChange(arr.map((t) => (t === i.tag ? i.suggest! : t)))}
                    >
                      {i.suggest}
                    </button>
                    ？
                  </>
                )}
              </p>
            ))}
          </div>
        )}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">{field.label}</span>
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) =>
      onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    return (
      <div>
        <span className="mb-1.5 block text-sm">{field.label}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {field.options?.map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                  on ? "border-accent bg-accent/10 text-fg" : "border-border text-muted hover:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
