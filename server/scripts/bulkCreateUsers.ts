import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import { parse as parseCsv } from "csv-parse/sync";

function normalizeSpaces(s: string) {
  return s.trim().replace(/\s+/g, " ");
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

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: npx tsx scripts/bulkCreateUsers.ts <ruta_users.csv> [--reset-existing] [--out <ruta_salida.csv>] [--print]");
    process.exit(1);
  }

  const resetExisting = process.argv.includes("--reset-existing");
  const shouldPrint = process.argv.includes("--print");
  const outPath = getArgValue("--out");

  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true
  }) as Array<Record<string, unknown>>;

  const prisma = new PrismaClient();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const out: Array<{ name: string; email: string; password: string }> = [];

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

  if (outPath) {
    const header = "NOMBRE,EMAIL,PASSWORD\n";
    const lines = out.map((x) => `"${x.name.replace(/"/g, '""')}","${x.email}","${x.password}"`).join("\n");
    fs.writeFileSync(outPath, header + lines + "\n", "utf8");
  }

  console.log(JSON.stringify({ created, updated, skipped, total: rows.length }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
