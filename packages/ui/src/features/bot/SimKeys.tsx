// 模拟按键：把"按下某个键"翻译成无头机器人对应的网络封包，服务器可感知。
// 移动/跳/蹲/跑 用 setControlState（持续态）；攻击/使用/换手/丢弃/选快捷栏是一次性动作。
// 全是 App 按钮触发 → 引擎执行，手机点也能用（不依赖物理键盘）。放在交互页。
import { useState, type ReactNode } from "react";
import { Gamepad2 } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

/** 单个键帽：tap 用 onClick；按住式（移动）用 onDown/onUp。 */
function Key({
  label,
  sub,
  onClick,
  onDown,
  onUp,
  active,
  disabled,
}: {
  label: ReactNode;
  sub?: string;
  onClick?: () => void;
  onDown?: () => void;
  onUp?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className={cn(
        "flex touch-none select-none flex-col items-center justify-center rounded-md border py-2 text-xs font-medium leading-tight transition-colors",
        disabled
          ? "cursor-not-allowed border-border/40 text-muted/40"
          : active
            ? "border-accent bg-accent/15 text-accent"
            : "border-border bg-surface-2/60 hover:border-accent hover:bg-accent/10 active:bg-accent/20",
      )}
    >
      {label}
      {sub && <span className="text-[9px] font-normal text-muted">{sub}</span>}
    </button>
  );
}

export default function SimKeys({ bot }: { bot: BotSummary }) {
  const disabled = !bot.online;
  const [sneak, setSneak] = useState(false);
  const [sprint, setSprint] = useState(false);
  const [slot, setSlot] = useState(0);

  const set = (states: Partial<Record<"forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", boolean>>) => {
    if (!disabled) cmd.control.set(bot.id, states);
  };
  const tap = (action: "attack" | "use" | "swap" | "drop" | "slot", s?: number) => {
    if (!disabled) cmd.control.tap(bot.id, action, s);
  };
  const jump = () => {
    if (disabled) return;
    cmd.control.set(bot.id, { jump: true });
    setTimeout(() => cmd.control.set(bot.id, { jump: false }), 200);
  };
  const toggleSneak = () => {
    if (disabled) return;
    const v = !sneak;
    setSneak(v);
    cmd.control.set(bot.id, { sneak: v });
  };
  const toggleSprint = () => {
    if (disabled) return;
    const v = !sprint;
    setSprint(v);
    cmd.control.set(bot.id, { sprint: v });
  };

  return (
    <Card className="p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Gamepad2 className="h-4 w-4 text-accent" /> 模拟按键
      </h3>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        让机器人“按下”这些键（发对应封包，手机也能点）。<b>移动键按住才走</b>。
        提示：R/Z 这类字母键在原版协议里按下去什么都不发、无头机器人模拟也无效——那类服务器功能请用底部「快捷指令」发命令。
      </p>

      {/* 移动（按住）+ 跳/蹲/跑 */}
      <div className="mb-2.5">
        <div className="mb-1 text-[10px] font-medium text-muted">移动（按住）· 姿态（开关）</div>
        <div className="grid grid-cols-5 gap-1">
          <span />
          <Key label="W" onDown={() => set({ forward: true })} onUp={() => set({ forward: false })} disabled={disabled} />
          <span />
          <Key label="跳" sub="Space" onClick={jump} disabled={disabled} />
          <Key label="蹲" sub="Shift" onClick={toggleSneak} active={sneak} disabled={disabled} />
          <Key label="A" onDown={() => set({ left: true })} onUp={() => set({ left: false })} disabled={disabled} />
          <Key label="S" onDown={() => set({ back: true })} onUp={() => set({ back: false })} disabled={disabled} />
          <Key label="D" onDown={() => set({ right: true })} onUp={() => set({ right: false })} disabled={disabled} />
          <Key label="跑" sub="Ctrl" onClick={toggleSprint} active={sprint} disabled={disabled} />
          <span />
        </div>
      </div>

      {/* 动作（点一下） */}
      <div className="mb-2.5">
        <div className="mb-1 text-[10px] font-medium text-muted">动作（点一下）</div>
        <div className="grid grid-cols-4 gap-1">
          <Key label="攻击" sub="左键" onClick={() => tap("attack")} disabled={disabled} />
          <Key label="使用" sub="右键" onClick={() => tap("use")} disabled={disabled} />
          <Key label="换手" sub="F" onClick={() => tap("swap")} disabled={disabled} />
          <Key label="丢弃" sub="Q" onClick={() => tap("drop")} disabled={disabled} />
        </div>
      </div>

      {/* 选快捷栏 1-9 */}
      <div>
        <div className="mb-1 text-[10px] font-medium text-muted">选快捷栏</div>
        <div className="grid grid-cols-9 gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <Key
              key={i}
              label={i + 1}
              active={slot === i}
              disabled={disabled}
              onClick={() => {
                setSlot(i);
                tap("slot", i);
              }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
