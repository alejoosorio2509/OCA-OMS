import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import { parse as parseCsv } from "csv-parse/sync";

function normalizeSpaces(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function normalizeHeader(s: string) {
  return normalizeSpaces(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeNoAccents(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "");
}

function cleanEmail(s: string) {
  return normalizeSpaces(String(s ?? ""))
    .replace(/"/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildPasswordFromName(fullName: string) {
  const tokens = normalizeSpaces(fullName).split(" ").filter(Boolean);
  const first = tokens[0] ?? "";
  const firstSurname = tokens.length >= 2 ? tokens[Math.max(1, tokens.length - 2)] : "";
  const raw = `${first.slice(0, 1)}${firstSurname.slice(0, 1)}`;
  const normalized = normalizeNoAccents(raw).toLowerCase();
  return (normalized + "123456").slice(0, 6);
}

function getArgValue(flag: string) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function parseUsersCsv(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const encodings: Array<BufferEncoding> = ["utf8", "latin1"];
  const delimiters = [",", ";", "\t"];

  for (const encoding of encodings) {
    const content = buffer.toString(encoding);
    for (const delimiter of delimiters) {
      try {
        const rows = parseCsv(content, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          bom: true,
          delimiter
        }) as Array<Record<string, unknown>>;

        const first = rows[0];
        if (!first) continue;
        const keys = Object.keys(first).map(normalizeHeader);
        const hasNombre = keys.includes("nombre");
        const hasEmail = keys.includes("email");
        if (hasNombre && hasEmail) return rows;
      } catch {
      }
    }
  }

  throw new Error("CSV_FORMAT_NOT_SUPPORTED");
}

async function httpJson<T>(input: { url: string; method?: string; token?: string; body?: unknown }) {
  const res = await fetch(input.url, {
    method: input.method ?? "GET",
    headers: {
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      ...(input.body ? { "Content-Type": "application/json" } : {})
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  return { ok: res.ok, status: res.status, data };
}

function trimTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Uso: npx tsx scripts/bulkCreateUsers.ts <ruta_users.csv> [--reset-existing] [--out <ruta_salida.csv>] [--print] [--api <url>] [--token <jwt>] [--admin-email <email>] [--admin-password <password>]"
    );
    process.exit(1);
  }

  const resetExisting = process.argv.includes("--reset-existing");
  const shouldPrint = process.argv.includes("--print");
  const outPath = getArgValue("--out");
  const apiUrlArg = getArgValue("--api");
  const tokenArg = getArgValue("--token");
  const adminEmail = getArgValue("--admin-email");
  const adminPassword = getArgValue("--admin-password");

  const rows = parseUsersCsv(filePath);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const out: Array<{ name: string; email: string; password: string }> = [];

  if (apiUrlArg) {
    const apiUrl = trimTrailingSlash(apiUrlArg);
    let token = tokenArg;
    if (!token) {
      if (!adminEmail || !adminPassword) {
        throw new Error("API_MODE_REQUIRES_TOKEN_OR_ADMIN_CREDENTIALS");
      }
      const login = await httpJson<{ token: string }>({
        url: `${apiUrl}/auth/login`,
        method: "POST",
        body: { email: adminEmail, password: adminPassword }
      });
      if (!login.ok || !login.data?.token) throw new Error("LOGIN_FAILED");
      token = login.data.token;
    }

    const users = await httpJson<
      Array<{
        id: string;
        email: string;
        name: string;
      }>
    >({ url: `${apiUrl}/users`, token });
    if (!users.ok) throw new Error(`USERS_LIST_FAILED_${users.status}`);
    const byEmail = new Map<string, { id: string; name: string }>();
    for (const u of users.data ?? []) byEmail.set(cleanEmail(u.email), { id: u.id, name: u.name });

    for (const r of rows) {
      const nameRaw = String(r.NOMBRE ?? r.Nombre ?? r.name ?? r.Name ?? "").trim();
      const email = cleanEmail(String(r.EMAIL ?? r.Email ?? r.email ?? r.Mail ?? ""));
      const name = normalizeSpaces(nameRaw);

      if (!name || !email || !email.includes("@")) {
        skipped++;
        continue;
      }

      const password = buildPasswordFromName(name);
      const existing = byEmail.get(email);

      if (existing) {
        if (!resetExisting) {
          skipped++;
          continue;
        }

        await httpJson({
          url: `${apiUrl}/users/${existing.id}`,
          method: "PATCH",
          token,
          body: { name }
        });

        const reset = await httpJson<{ id: string; password: string }>({
          url: `${apiUrl}/users/${existing.id}/reset-password`,
          method: "POST",
          token,
          body: { password }
        });
        if (!reset.ok) throw new Error(`RESET_PASSWORD_FAILED_${reset.status}`);
        updated++;
      } else {
        const create = await httpJson({
          url: `${apiUrl}/users`,
          method: "POST",
          token,
          body: {
            email,
            name,
            password,
            role: "USER",
            canOrders: true,
            canCargues: true,
            canExportes: true,
            canUsers: false
          }
        });
        if (create.ok) {
          created++;
        } else if (create.status === 409) {
          skipped++;
          continue;
        } else {
          throw new Error(`CREATE_USER_FAILED_${create.status}`);
        }
      }

      out.push({ name, email, password });
      if (shouldPrint) console.log(`${email},${password}`);
    }
  } else {
    const prisma = new PrismaClient();
    try {
      for (const r of rows) {
        const nameRaw = String(r.NOMBRE ?? r.Nombre ?? r.name ?? r.Name ?? "").trim();
        const email = cleanEmail(String(r.EMAIL ?? r.Email ?? r.email ?? r.Mail ?? ""));
        const name = normalizeSpaces(nameRaw);

        if (!name || !email || !email.includes("@")) {
          skipped++;
          continue;
        }

        const password = buildPasswordFromName(name);
        const passwordHash = await bcrypt.hash(password, 10);

        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) {
          if (!resetExisting) {
            skipped++;
            continue;
          }
          await prisma.user.update({
            where: { email },
            data: {
              name,
              passwordHash
            }
          });
          updated++;
        } else {
          await prisma.user.create({
            data: {
              email,
              name,
              role: "USER",
              canOrders: true,
              canCargues: true,
              canExportes: true,
              canUsers: false,
              passwordHash
            }
          });
          created++;
        }

        out.push({ name, email, password });
        if (shouldPrint) console.log(`${email},${password}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  if (outPath) {
    const header = "NOMBRE,EMAIL,PASSWORD\n";
    const lines = out.map((x) => `"${x.name.replace(/"/g, '""')}","${x.email}","${x.password}"`).join("\n");
    fs.writeFileSync(outPath, header + lines + "\n", "utf8");
  }

  console.log(JSON.stringify({ created, updated, skipped, total: rows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
