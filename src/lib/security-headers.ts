// Security headers (T-100, T-053 MED-3). Pure functions so they are unit tested; next.config.ts
// applies them to every route.
//
// Script and style policy (builder choice, see the T-100 handoff): Next.js 16 writes inline
// <script> tags (the streamed RSC payload) and inline <style>, and the app uses cacheComponents
// (prerendered shells), which a per-request nonce would turn into fully dynamic pages. So
// script-src and style-src allow 'unsafe-inline'. 'unsafe-eval' is added only in development
// (React refresh needs it). The other directives (frame-ancestors, connect-src, object-src,
// base-uri, form-action) are what block clickjacking, data exfiltration and plugin content.

const OSM_TILES = "https://tile.openstreetmap.org";
const LOCAL_SUPABASE = "127.0.0.1:54321";

export interface CspOptions {
  /** NEXT_PUBLIC_SUPABASE_URL (empty in mock mode). */
  supabaseUrl: string | undefined;
  dev: boolean;
}

function supabaseOrigins(url: string | undefined, dev: boolean) {
  const http: string[] = [];
  const ws: string[] = [];
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") {
        http.push(u.origin);
        ws.push(`${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`);
      }
    } catch {
      // Malformed URL: add nothing.
    }
  }
  if (dev) {
    // Local Supabase stack (dev and CI).
    http.push(`http://${LOCAL_SUPABASE}`);
    ws.push(`ws://${LOCAL_SUPABASE}`);
  }
  return { http: [...new Set(http)], ws: [...new Set(ws)] };
}

export function buildCsp({ supabaseUrl, dev }: CspOptions): string {
  const supa = supabaseOrigins(supabaseUrl, dev);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", OSM_TILES, ...supa.http],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supa.http, ...supa.ws],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export function securityHeaders(opts: CspOptions) {
  return [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}
