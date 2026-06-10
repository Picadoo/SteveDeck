import { useEffect, useRef } from "react";
import { cmd } from "./engine";

const MOVE_KEYS: Record<string, "forward" | "back" | "left" | "right"> = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
};

/**
 * 桌面物理键盘直控（修「W+空格不能同按」——屏幕按钮受限于鼠标一次只能按一个）：
 * WASD 移动（可任意组合同按）、空格跳、Shift 蹲（按住）、R 跑（按住；不用 Ctrl——
 * 浏览器里 Ctrl+W 会直接关掉页面/窗口）、1-9 选快捷栏、F 换手、Q 丢弃。
 * 输入框/文本域聚焦时自动让路；窗口失焦或组件卸载时松开全部持续键，防"卡键"。
 */
export function useKeyboardControl(botId: string, enabled: boolean): void {
  const held = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const releaseAll = () => {
      if (!held.current.size) return;
      const states: Record<string, boolean> = {};
      for (const k of held.current) states[k] = false;
      held.current.clear();
      void cmd.control.set(botId, states);
    };
    const hold = (state: string, e: KeyboardEvent) => {
      if (held.current.has(state)) return;
      held.current.add(state);
      void cmd.control.set(botId, { [state]: true });
      e.preventDefault();
    };
    const release = (state: string) => {
      if (!held.current.delete(state)) return;
      void cmd.control.set(botId, { [state]: false });
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping() || e.repeat) return;
      const move = MOVE_KEYS[e.code];
      if (move) return hold(move, e);
      if (e.code === "Space") return hold("jump", e);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") return hold("sneak", e);
      if (e.code === "KeyR") return hold("sprint", e);
      if (/^Digit[1-9]$/.test(e.code)) {
        void cmd.control.tap(botId, "slot", Number(e.code.slice(5)) - 1);
        return;
      }
      if (e.code === "KeyF") return void cmd.control.tap(botId, "swap");
      if (e.code === "KeyQ") return void cmd.control.tap(botId, "drop");
    };
    const up = (e: KeyboardEvent) => {
      const move = MOVE_KEYS[e.code];
      if (move) return release(move);
      if (e.code === "Space") return release("jump");
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") return release("sneak");
      if (e.code === "KeyR") return release("sprint");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [botId, enabled]);
}
