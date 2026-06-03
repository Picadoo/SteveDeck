import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 虚拟摇杆：拖动手柄输出归一化向量 {x,y}∈[-1,1]（y 向上为负，符合屏幕坐标）。松手回中并输出 {0,0}。 */
export default function Joystick({
  size = 116,
  onVector,
  className,
}: {
  size?: number;
  onVector: (v: { x: number; y: number }) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const radius = size / 2;
  const knobSize = size * 0.4;
  const maxDist = radius - knobSize / 2;

  function move(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist && dist > 0) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    setKnob({ x: dx, y: dy });
    onVector({ x: dx / maxDist, y: dy / maxDist });
  }
  function end() {
    if (!active.current) return;
    active.current = false;
    setKnob({ x: 0, y: 0 });
    onVector({ x: 0, y: 0 });
  }

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => active.current && move(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
      className={cn(
        "pointer-events-auto relative touch-none select-none rounded-full border border-white/20 bg-black/35 backdrop-blur-sm",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div
        className="absolute rounded-full bg-white/80 shadow-lg transition-[background] active:bg-white"
        style={{
          width: knobSize,
          height: knobSize,
          left: radius - knobSize / 2 + knob.x,
          top: radius - knobSize / 2 + knob.y,
        }}
      />
    </div>
  );
}

/** 按住持续触发的按钮（如转向、跳跃）：按下触发一次并按 interval 重复，松开触发 onRelease。 */
export function HoldButton({
  onTick,
  onPress,
  onRelease,
  interval = 90,
  disabled,
  className,
  title,
  children,
}: {
  onTick?: () => void;
  onPress?: () => void;
  onRelease?: () => void;
  interval?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const start = () => {
    if (disabled) return;
    onPress?.();
    if (onTick) {
      onTick();
      if (!timer.current) timer.current = setInterval(onTick, interval);
    }
  };
  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    onRelease?.();
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      className={cn(
        "pointer-events-auto flex touch-none select-none items-center justify-center transition-transform active:scale-95 disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
