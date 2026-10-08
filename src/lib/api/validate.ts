// Small field validators. Each returns the cleaned value or records a message in `fields`.
import { validationFailed } from "./errors";

export class Fields {
  readonly errors: Record<string, string> = {};
  string(
    body: Record<string, unknown>,
    key: string,
    min: number,
    max: number,
  ): string {
    const v = body[key];
    if (typeof v !== "string") {
      this.errors[key] = "Required.";
      return "";
    }
    const t = v.trim();
    if (t.length < min || t.length > max)
      this.errors[key] =
        min <= 1
          ? `Enter 1 to ${max} characters.`
          : `Enter ${min} to ${max} characters.`;
    return t;
  }
  done(): void {
    if (Object.keys(this.errors).length) throw validationFailed(this.errors);
  }
}

// Pragmatic email check (Supabase does the authoritative validation).
export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
