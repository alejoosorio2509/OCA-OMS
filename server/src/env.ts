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

export const env = envSchema.parse(process.env);
