import { useEffect, useState } from "react";
import { Play, Square, Plus, Pencil, Trash2, ScrollText, Repeat } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { Badge } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import type { BotSummary, ScriptSummary } from "@mcbot/protocol";

const TEMPLATE = `{
  "name": "新脚本",
  "loop": false,
  "trigger": { "type": "manual" },
  "steps": [
    { "do": "chat", "msg": "你好" },
    { "do": "wait", "s": 2 }
  ]
}`;

export default function ScriptsTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [list, setList] = useState<ScriptSummary[]>([]);
  const [editor, setEditor] = useState<{ open: boolean; json: string; err: string | null }>({
    open: false,
    json: "",
    err: null,
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
    setEditor({ open: true, json: TEMPLATE, err: null });
  }
  async function openEdit(name: string) {
    const r = await cmd.script.detail(name);
    setEditor({ open: true, json: JSON.stringify(r.ok ? r.data : {}, null, 2), err: null });
  }
  async function saveScript() {
    let parsed: any;
    try {
      parsed = JSON.parse(editor.json);
    } catch (e: any) {
      setEditor((s) => ({ ...s, err: "JSON 解析失败：" + e.message }));
      return;
    }
    const r = await cmd.script.save(parsed);
    if (r.ok) {
      setEditor({ open: false, json: "", err: null });
      pushToast("脚本已保存", "success");
      refresh();
    } else {
      setEditor((s) => ({ ...s, err: r.error || "保存失败" }));
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

      <Modal
        open={editor.open}
        onClose={() => setEditor({ open: false, json: "", err: null })}
        title="脚本编辑器（JSON）"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor({ open: false, json: "", err: null })}>
              取消
            </Button>
            <Button variant="primary" onClick={saveScript}>
              保存
            </Button>
          </>
        }
      >
        <textarea
          value={editor.json}
          onChange={(e) => setEditor((s) => ({ ...s, json: e.target.value, err: null }))}
          spellCheck={false}
          className="h-72 w-full rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/50"
        />
        {editor.err && <div className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{editor.err}</div>}
        <p className="mt-2 text-[11px] text-muted">
          步骤示例：chat / wait / cmd / goto / if / repeat 等；触发器：manual / chat_match / health_below / interval…
        </p>
      </Modal>
    </div>
  );
}
