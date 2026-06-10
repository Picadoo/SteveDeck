import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { Button, Input, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { ModuleDef, FieldDef } from "./moduleDefs";

export default function ModuleConfigDialog({
  def,
  open,
  initial,
  onClose,
  onSave,
}: {
  def: ModuleDef;
  open: boolean;
  initial: Record<string, unknown>;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [cfg, setCfg] = useState<Record<string, unknown>>(initial);

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
        {def.fields.map((f) => (
          <FieldRow key={f.key} field={f} value={cfg[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
      </div>
    </Modal>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
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
    const arr = Array.isArray(value) ? (value as string[]) : [];
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
