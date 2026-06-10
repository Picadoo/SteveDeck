/**
 * 复制文本（带降级）：navigator.clipboard 只在安全上下文（HTTPS/localhost）存在——
 * 通过 http://<服务器IP>:8723 访问时它是 undefined，直接用必然「复制失败」。
 * 这里先试标准 API，不行就退回隐藏 textarea + execCommand 的老办法（HTTP 下依然有效）。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 安全上下文里也可能因权限被拒 → 落入降级路径 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
