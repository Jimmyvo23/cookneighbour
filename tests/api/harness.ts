import { randomBytes } from "node:crypto";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { setCurrentJar, type Jar } from "./jar";

// A "browser": its own cookie jar. The next/headers mock (tests/api/setup.ts) reads the current jar.
export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
  text: string;
}

type Handler = (request: Request) => Promise<Response> | Response;

export class Browser {
  jar: Jar = new Map();
  ip = `10.${rand(1)}.${rand(1)}.${rand(1)}`.replace(/[a-f]/g, "1");
  async call(
    handler: Handler,
    opts: {
      method?: string;
      body?: unknown;
      contentType?: string | null;
      raw?: string;
      /** Send no body at all. With `contentType: null` the request has no Content-Type header either
       *  (a string body makes `Request` add text/plain itself), like a bare `fetch(url, {method})`. */
      noBody?: boolean;
    } = {},
  ): Promise<Reply> {
    setCurrentJar(this.jar);
    const method = opts.method ?? "POST";
    const headers: Record<string, string> = { "x-forwarded-for": this.ip };
    const ct =
      opts.contentType === undefined ? "application/json" : opts.contentType;
    if (ct !== null) headers["content-type"] = ct;
    const init: RequestInit = { method, headers };
    if (method !== "GET" && !opts.noBody)
      init.body = opts.raw ?? JSON.stringify(opts.body ?? {});
    const res = await handler(new Request("http://localhost/api/test", init));
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, body, headers: res.headers, text };
  }
}

export function rand(n: number): string {
  return randomBytes(n).toString("hex");
}

export function newEmail(tag: string): string {
  return `${tag}-${rand(4)}@example.test`;
}

/** A valid-looking, random Canadian number (area code 647, exchange 2xx). */
export function newPhone(): string {
  const n = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  // Exchange is 2 + first two digits; never an N11 code such as 211 (phone validation refuses it).
  const two = n.slice(0, 2) === "11" ? "22" : n.slice(0, 2);
  return `+16472${two}${n.slice(2)}`.slice(0, 12);
}

export const PASSWORD = "Test-only-pw-1234!";

export function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function freshLimits() {
  resetRateLimits();
}
