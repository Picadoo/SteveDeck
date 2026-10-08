import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-3xl",
  full: "max-w-[min(1200px,95vw)]",
} as const;

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 打开时记住触发焦点的元素，关闭后还焦——键盘/读屏用户不会被丢回页面顶部
    const prevFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // 焦点陷阱：Tab/Shift+Tab 在弹窗内循环，不穿透到弹窗底下的页面
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 打开后把焦点移进弹窗（首个可聚焦元素，退回面板本身）
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panel).focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      // 还焦（元素还在文档里才还，否则忽略）
      if (prevFocused && document.contains(prevFocused)) prevFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  // Portal 到 body：祖先容器一旦带 transform（如移动端侧栏抽屉的 translate-x 动画），
  // fixed 定位就会被锁进那个容器盒子里——从侧栏开的弹窗会被挤成侧栏宽的窄条。
  // 挂到 body 上彻底免疫，无论从哪个角落打开都是真·全屏居中。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl outline-none",
          "animate-modal-in",
          SIZES[size],
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
