export const API_UPSTREAM =
  import.meta.env.VITE_API_UPSTREAM || "https://myastrosutra.online";

const BRAND_HOSTS = ["myastrosutra.online", "myastrosutra.live", "panditji.myastrosutra.online"];

export function isBrandHost(hostname?: string): boolean {
  const host = (hostname ?? window.location.hostname).replace(/^www\./i, "");
  return BRAND_HOSTS.includes(host);
}

export function isLocalHost(hostname?: string): boolean {
  const host = hostname ?? window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** Same-origin /api on myastrosutra.* — otherwise hit production API (Netlify, etc.). */
export function resolveApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (isBrandHost()) return normalized;
  return `${API_UPSTREAM.replace(/\/$/, "")}${normalized}`;
}

/** Backend imageUrl → loadable src. Absolute CDN URLs pass through; relative paths use the API host. */
export function resolveImageUrl(raw?: string): string {
  const url = (raw || "").trim();
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  const normalized = url.startsWith("/") ? url : `/${url}`;
  return `${API_UPSTREAM.replace(/\/$/, "")}${normalized}`;
}

export function resolveSockJsUrl(sockPath = "/api/ws"): string {
  const path = sockPath.startsWith("/") ? sockPath : `/${sockPath}`;
  if (isLocalHost() || import.meta.env.DEV) {
    return `${API_UPSTREAM.replace(/\/$/, "")}${path}`;
  }
  if (isBrandHost()) {
    return `${window.location.origin}${path}`;
  }
  return `${API_UPSTREAM.replace(/\/$/, "")}${path}`;
}

export function isSameOriginUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
