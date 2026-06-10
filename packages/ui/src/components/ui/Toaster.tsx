import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useStore, type ToastTone } from "@/store/useStore";
import { cn } from "@/lib/cn";

function toneIcon(tone: ToastTone) {
  if (tone === "error") return <AlertCircle className="h-4 w-4 text-danger" />;
  if (tone === "success") return <CheckCircle2 className="h-4 w-4 text-success" />;
  return <Info className="h-4 w-4 text-accent" />;
}

export default function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const pauseToast = useStore((s) => s.pauseToast);
  const resumeToast = useStore((s) => s.resumeToast);

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[70] flex flex-col gap-2 md:bottom-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          onMouseEnter={() => pauseToast(t.id)}
          onMouseLeave={() => resumeToast(t.id)}
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg",
            "animate-slide-in-right",
          )}
        >
          {toneIcon(t.tone)}
          <span className="max-w-[22rem]">{t.message}</span>
          {(t.count ?? 1) > 1 && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-medium text-muted">×{t.count}</span>
          )}
          <button onClick={() => dismiss(t.id)} className="ml-1 text-muted transition-colors hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
