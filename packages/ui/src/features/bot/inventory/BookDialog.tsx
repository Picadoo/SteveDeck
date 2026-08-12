// 书本阅读器：成书（只读翻页）/ 书与笔（逐页编辑 + 加页 + 保存回写）。从 InventoryTab 拆出。
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";

export default function BookDialog({ botId, slot, onClose }: { botId: string; slot: number; onClose: () => void }) {
  const pushToast = useStore((s) => s.pushToast);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ writable: boolean; title: string | null; author: string | null }>({ writable: false, title: null, author: null });
  const [pages, setPages] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await cmd.moduleAction(botId, "inventory", "readBook", { slot });
      if (!alive) return;
      setLoading(false);
      if (r.ok && r.data) {
        const d = r.data as { writable: boolean; title: string | null; author: string | null; pages: string[] };
        setMeta({ writable: d.writable, title: d.title, author: d.author });
        setPages(d.pages.length ? d.pages : [""]);
      } else {
        setErr(r.error || "读取失败");
      }
    })();
    return () => {
      alive = false;
    };
  }, [botId, slot]);

  async function save() {
    setSaving(true);
    const r = await cmd.moduleAction(botId, "inventory", "writeBook", { slot, pages });
    setSaving(false);
    if (r.ok) {
      setDirty(false);
      pushToast("已写入书与笔", "success");
    } else {
      pushToast(r.error || "写入失败", "error");
    }
  }

  const total = pages.length;
  return (
    <Modal
      open
      onClose={onClose}
      title={meta.title ? `《${meta.title}》${meta.author ? ` · ${meta.author}` : ""}` : meta.writable ? "书与笔" : "书"}
      size="lg"
      footer={
        <>
          {meta.writable && (
            <>
              <Button variant="ghost" onClick={() => { setPages((p) => [...p, ""]); setIdx(total); setDirty(true); }}>
                <Plus className="h-3.5 w-3.5" /> 加一页
              </Button>
              <Button variant="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 保存到书
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onClose}>关闭</Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 读取中…
        </div>
      ) : err ? (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      ) : (
        <div className="space-y-2.5">
          {/* 仿羊皮纸页面 */}
          {meta.writable ? (
            <textarea
              value={pages[idx] ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPages((p) => p.map((x, i) => (i === idx ? v : x)));
                setDirty(true);
              }}
              rows={12}
              className="w-full resize-y rounded-lg border border-[#cbb78a] bg-[#f5ecd7] px-4 py-3 font-serif text-sm leading-relaxed text-[#3b2f1d] outline-none focus:border-[#a98f57]"
              placeholder="（这一页还是空的）"
            />
          ) : (
            <div className="min-h-[16rem] whitespace-pre-wrap rounded-lg border border-[#cbb78a] bg-[#f5ecd7] px-4 py-3 font-serif text-sm leading-relaxed text-[#3b2f1d]">
              {pages[idx] || <span className="text-[#3b2f1d]/40">（空白页）</span>}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              disabled={idx <= 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted enabled:hover:bg-surface-2 enabled:hover:text-fg disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 上一页
            </button>
            <span className="text-xs tabular-nums text-muted">第 {idx + 1} / {total} 页</span>
            <button
              disabled={idx >= total - 1}
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted enabled:hover:bg-surface-2 enabled:hover:text-fg disabled:opacity-30"
            >
              下一页 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
