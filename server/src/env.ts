import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(1),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("soportes")
});

function normalizeSupabaseUrl(input: string | undefined) {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;
  let v = raw.replace(/\/+$/, "");
  v = v.replace(/\/rest\/v1$/i, "");
  v = v.replace(/\/+$/, "");
  return v || undefined;
}

const parsed = envSchema.parse(process.env);
export const env = {
  ...parsed,
  SUPABASE_URL: normalizeSupabaseUrl(parsed.SUPABASE_URL)
};
