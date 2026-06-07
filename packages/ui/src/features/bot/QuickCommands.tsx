// 快捷指令条：底部一排可点按钮 + 键盘触发（按绑定键即发对应指令）+ 齿轮里编辑。
// 通用可配置（按 host 存）；发送复用引擎的 chat 通道（聊天框发 /指令 就是它）。
import { useEffect, useState } from "react";
import { Zap, Settings2, Plus, Trash2, Sparkles, X } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import {
  loadQuickCmds,
  saveQuickCmds,
  newQuickCmdId,
  sanitizeKey,
  MCLY_TEMPLATE,
  type QuickCmd,
} from "@/lib/quickCommands";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

export default function QuickCommands({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const pushCmd = useStore((s) => s.pushCmd);
  const [list, setList] = useState<QuickCmd[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setList(loadQuickCmds(bot.host));
  }, [bot.host]);

  const commit = (next: QuickCmd[]) => {
    setList(next);
    saveQuickCmds(bot.host, next);
  };

  // 发送一条快捷指令：守卫在线/非空，复用聊天通道，并记入命令历史。
  const fire = async (qc: QuickCmd) => {
    const c = qc.command.trim();
    if (!c) {
      pushToast(`「${qc.name || "未命名"}」还没填指令`, "error");
      return;
    }
    if (!bot.online) {
      pushToast("机器人离线，无法发送", "error");
      return;
    }
    pushCmd(c);
    const r = await cmd.chat(bot.id, c);
    if (!r.ok) pushToast(r.error || "发送失败", "error");
    else pushToast(`已发送：${qc.name || c}`, "info");
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border px-3 py-2 [&::-webkit-scrollbar]:hidden">
        <Zap className="h-3.5 w-3.5 shrink-0 text-accent" />
        {list.length === 0 ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
          >
            ＋ 添加快捷指令（点按钮即发指令）
          </button>
        ) : (
          <>
            {list.map((qc) => (
              <button
                key={qc.id}
                type="button"
                onClick={() => fire(qc)}
                disabled={!bot.online}
                title={qc.command || "未填指令"}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2/60 px-2 py-1 text-[11px] font-medium transition-colors",
                  bot.online ? "hover:border-accent hover:bg-accent/10" : "cursor-not-allowed opacity-50",
                )}
              >
                <span className="max-w-[8rem] truncate">{qc.name || qc.command}</span>
                {qc.key && (
                  <kbd className="rounded bg-surface px-1 text-[9px] font-bold uppercase text-muted">
                    {qc.key}
                  </kbd>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="编辑快捷指令"
              className="shrink-0 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {editing && (
        <QuickCmdEditor
          initial={list}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            commit(next);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

/** 编辑器：增删行、改名字/触发键/指令、可一键载入 mcly 示例骨架。 */
function QuickCmdEditor({
  initial,
  onClose,
  onSave,
}: {
  initial: QuickCmd[];
  onClose: () => void;
  onSave: (list: QuickCmd[]) => void;
}) {
  const [rows, setRows] = useState<QuickCmd[]>(() => initial.map((r) => ({ ...r })));

  const setField = (id: string, field: "name" | "key" | "command", val: string) =>
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, [field]: field === "key" ? sanitizeKey(val.slice(-1)) : val } : r)),
    );
  const addRow = () => setRows((rs) => [...rs, { id: newQuickCmdId(), name: "", key: "", command: "" }]);
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));
  const loadTemplate = () =>
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.name));
      const add = MCLY_TEMPLATE.filter((t) => !have.has(t.name)).map((t) => ({
        id: newQuickCmdId(),
        name: t.name,
        key: t.key.toLowerCase(),
        command: "",
      }));
      return [...rs, ...add];
    });

  const save = () => {
    // 丢弃完全空白的行（没指令也没名字）
    const clean = rows
      .map((r) => ({ ...r, name: r.name.trim(), command: r.command.trim() }))
      .filter((r) => r.command || r.name);
    onSave(clean);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="快捷指令"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        每行 = 一个快捷按钮：<b>名字</b> 是按钮文字，<b>键</b> 只是显示提示（标注你在游戏里按的键、方便记忆，可留空），
        <b>指令</b> 是点按钮后发给服务器的内容（如 <code className="rounded bg-surface-2 px-1">/menu</code>、
        <code className="rounded bg-surface-2 px-1">/kill</code>）。点按钮即发指令（手机也能点）；具体指令以你的服务器为准。
      </p>

      <div className="space-y-2">
        <div className="flex gap-2 px-1 text-[10px] font-medium text-muted">
          <span className="flex-1">名字</span>
          <span className="w-12 text-center">键</span>
          <span className="flex-[2]">指令</span>
          <span className="w-7" />
        </div>
        {rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
            还没有快捷指令。点下面「添加一行」或「载入 mcly 示例」。
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              value={r.name}
              onChange={(e) => setField(r.id, "name", e.target.value)}
              placeholder="官方杀戮"
              className="flex-1"
            />
            <Input
              value={r.key.toUpperCase()}
              onChange={(e) => setField(r.id, "key", e.target.value)}
              placeholder="R"
              maxLength={1}
              className="w-12 text-center uppercase"
            />
            <Input
              value={r.command}
              onChange={(e) => setField(r.id, "command", e.target.value)}
              placeholder="/menu"
              className="flex-[2]"
            />
            <button
              type="button"
              onClick={() => removeRow(r.id)}
              title="删除这一行"
              className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> 添加一行
        </Button>
        <Button size="sm" variant="ghost" onClick={loadTemplate}>
          <Sparkles className="h-3.5 w-3.5" /> 载入 mcly 示例
        </Button>
      </div>
      <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted">
        <X className="mt-px h-3 w-3 shrink-0" />
        示例只预填名字+按键，<b>指令需你自己补</b>（不同服务器指令不同，未填的项点了会提示）。
      </p>
    </Modal>
  );
}
