/**
 * Copies text. `navigator.clipboard` only exists on https/localhost, so on a
 * plain-http LAN address (phone testing) fall back to a temporary textarea.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied: try the fallback.
    }
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    // Deprecated but still the only option outside a secure context.
    return document.execCommand("copy");
  } finally {
    el.remove();
  }
}
