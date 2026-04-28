import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { requireAuth, requirePermission } from "../auth.js";
import { prisma } from "../prisma.js";
import * as XLSX from "xlsx";
import { parse as parseSync } from "csv-parse/sync";
import { parse as parseStream } from "csv-parse";
import { CargueJobStatus, Prisma, WorkOrderStatus } from "@prisma/client";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";

export const carguesRouter = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "cargues");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Asegurar que el directorio de logs existe
const LOGS_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function writeLog(message: string) {
  const timestamp = new Date().toLocaleString();
  const logEntry = `[${timestamp}] ${message}\n`;
  const logPath = path.join(LOGS_DIR, "cargues.log");
  try {
    fs.appendFileSync(logPath, logEntry);
    console.log(message);
  } catch (err) {
    console.error("No se pudo escribir log:", err);
  }
}

function mapStatus(status: string | undefined): WorkOrderStatus {
  if (!status) return "ASIGNADA";
  const s = status.toUpperCase().trim();
  const mapping: Record<string, WorkOrderStatus> = {
    "FACTURADA": "FACTURADA",
    "FACTURADO": "FACTURADA",
    "GESTIONADA": "GESTIONADA",
    "GESTIONADO": "GESTIONADA",
    "EN EJECUCION": "EN_EJECUCION",
    "EN EJECUCIÓN": "EN_EJECUCION",
    "EN GESTION": "GESTIONADA",
    "EN GESTIÓN": "GESTIONADA",
    "CERRADA": "CERRADA",
    "CERRADO": "CERRADA",
    "CANCELADA": "CANCELLED",
    "CANCELADO": "CANCELLED",
    "SOLICITADA": "CREATED",
    "SOLICITADO": "CREATED",
    "ASIGNADA": "ASIGNADA",
    "ASIGNADO": "ASIGNADA"
  };
  return mapping[s] || "ASIGNADA";
}

function isTruthy(value: unknown, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

const BOGOTA_TZ = "America/Bogota";
const bogotaDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const bogotaTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: BOGOTA_TZ, hour: "2-digit", minute: "2-digit", hour12: false });

function normalizeHeaderKey(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getRowVal(row: Record<string, unknown>, name: string) {
  const target = normalizeHeaderKey(name);
  const key = Object.keys(row).find((k) => normalizeHeaderKey(k) === target);
  return key ? row[key] : undefined;
}

function parseIntLoose(val: unknown) {
  if (val === null || val === undefined) return NaN;
  if (typeof val === "number") return Number.isFinite(val) ? Math.trunc(val) : NaN;
  const s = String(val).trim();
  if (!s) return NaN;
  const normalized = s.replace(/[^\d-]/g, "");
  const n = parseInt(normalized, 10);
  return Number.isFinite(n) ? n : NaN;
}

function pickCalendarNumbersFromRow(row: Record<string, unknown>) {
  const values = Object.values(row);
  const nums: number[] = [];
  const dayNums: number[] = [];
  for (const v of values) {
    const n = parseIntLoose(v);
    if (Number.isFinite(n)) {
      nums.push(n);
      if (n >= 1000) dayNums.push(n);
    }
  }
  if (dayNums.length >= 2) return { inicio: dayNums[0], fin: dayNums[1] };
  if (dayNums.length === 1) return { inicio: dayNums[0], fin: null };
  if (nums.length >= 2) return { inicio: nums[0], fin: nums[1] };
  if (nums.length === 1) return { inicio: nums[0], fin: null };
  return { inicio: null, fin: null };
}

function calendarKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function makeBogotaDate(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0) {
  return new Date(Date.UTC(year, month - 1, day, hours + 5, minutes, seconds));
}

function bogotaDateKey(d: Date) {
  return bogotaDateFmt.format(d);
}

function bogotaMinutes(d: Date) {
  const parts = bogotaTimeFmt.formatToParts(d);
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hh * 60 + mm;
}

function pickBestDateByMap(raw: unknown, map: Map<string, number>) {
  const candidates = parseFlexibleDateCandidates(raw);
  for (const d of candidates) {
    if (map.has(bogotaDateKey(d))) return d;
  }
  return candidates[0] ?? null;
}

function isNotFutureDate(date: Date, now: Date) {
  return date.getTime() <= now.getTime();
}

function parseFlexibleDateCandidates(val: unknown) {
  if (val instanceof Date) return [val];
  if (val === null || val === undefined) return [];
  const str = String(val).trim();
  if (!str) return [];

  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoDateOnly) {
    const year = parseInt(isoDateOnly[1], 10);
    const month = parseInt(isoDateOnly[2], 10);
    const day = parseInt(isoDateOnly[3], 10);
    const d = makeBogotaDate(year, month, day, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? [] : [d];
  }

  const isoLocal = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(str);
  if (isoLocal && !/[zZ]|[+-]\d{2}:\d{2}$/.test(str)) {
    const year = parseInt(isoLocal[1], 10);
    const month = parseInt(isoLocal[2], 10);
    const day = parseInt(isoLocal[3], 10);
    const hours = parseInt(isoLocal[4], 10);
    const minutes = parseInt(isoLocal[5], 10);
    const seconds = isoLocal[6] ? parseInt(isoLocal[6], 10) : 0;
    const d = makeBogotaDate(year, month, day, hours, minutes, seconds);
    return Number.isNaN(d.getTime()) ? [] : [d];
  }

  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(str);
  if (!m) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? [] : [d];
  }

  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const hours = m[4] ? parseInt(m[4], 10) : 0;
  const minutes = m[5] ? parseInt(m[5], 10) : 0;
  const seconds = m[6] ? parseInt(m[6], 10) : 0;

  const out: Date[] = [];

  const ddmm = makeBogotaDate(year, b, a, hours, minutes, seconds);
  if (!Number.isNaN(ddmm.getTime())) out.push(ddmm);

  return out;
}

function pickBestDatePairByCalendar(
  inicioRaw: unknown,
  finRaw: unknown,
  calendarInicioMap: Map<string, number>,
  calendarFinMap: Map<string, number>
) {
  const inicioCandidates = parseFlexibleDateCandidates(inicioRaw);
  const finCandidates = parseFlexibleDateCandidates(finRaw);

  if (inicioCandidates.length === 0 || finCandidates.length === 0) {
    return { inicio: inicioCandidates[0] ?? null, fin: finCandidates[0] ?? null };
  }

  const cutoffMinutes = 17 * 60;

  let best: { inicio: Date; fin: Date } | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  let bestDias = Number.POSITIVE_INFINITY;

  for (const inicio of inicioCandidates) {
    const iKey = bogotaDateKey(inicio);
    const iNum = calendarInicioMap.get(iKey);
    if (iNum === undefined) continue;
    for (const fin of finCandidates) {
      const fKey = bogotaDateKey(fin);
      const fNum = calendarFinMap.get(fKey);
      if (fNum === undefined) continue;

      const finMinutes = bogotaMinutes(fin);
      const extraDay = finMinutes > cutoffMinutes ? 1 : 0;
      const sameDay = iKey === fKey;
      let rawDias = sameDay && finMinutes < cutoffMinutes ? 0 : fNum - iNum + extraDay;
      rawDias = Math.max(0, rawDias);
      if (rawDias > 400) continue;

      const ms = Math.abs(fin.getTime() - inicio.getTime());
      if (ms < bestMs || (ms === bestMs && rawDias < bestDias)) {
        bestMs = ms;
        bestDias = rawDias;
        best = { inicio, fin };
      }
    }
  }

  if (best) return best;
  return { inicio: inicioCandidates[0] ?? null, fin: finCandidates[0] ?? null };
}

function parseDateCandidatesWithSwap(raw: unknown) {
  const candidates = parseFlexibleDateCandidates(raw);
  if (!(raw instanceof Date) || candidates.length === 0) return candidates;
  const d = candidates[0]!;
  const key = bogotaDateKey(d);
  const [y, m, day] = key.split("-").map((v) => parseInt(v, 10));
  if (day <= 12 && m <= 12) {
    const minutes = bogotaMinutes(d);
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    const swapped = makeBogotaDate(y, day, m, hh, mm, 0);
    if (!Number.isNaN(swapped.getTime())) candidates.push(swapped);
  }
  return candidates;
}

function pickBestAssignedGestionByCalendar(
  asignacionRaw: unknown,
  gestionRaw: unknown,
  calendarInicioMap: Map<string, number>,
  calendarFinMap: Map<string, number>,
  now?: Date
) {
  const aCandidates = parseDateCandidatesWithSwap(asignacionRaw);
  const gCandidates = parseDateCandidatesWithSwap(gestionRaw);

  if (aCandidates.length === 0 || gCandidates.length === 0) {
    return { asignacion: aCandidates[0] ?? null, gestion: gCandidates[0] ?? null };
  }

  let best: { asignacion: Date; gestion: Date } | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const a of aCandidates) {
    if (now && !isNotFutureDate(a, now)) continue;
    const aNum = calendarInicioMap.get(bogotaDateKey(a));
    if (aNum === undefined) continue;
    for (const g of gCandidates) {
      if (now && !isNotFutureDate(g, now)) continue;
      const gNum = calendarFinMap.get(bogotaDateKey(g));
      if (gNum === undefined) continue;
      const diff = gNum - aNum;
      if (diff < 0 || diff > 400) continue;
      const ms = Math.abs(g.getTime() - a.getTime());
      if (ms < bestMs || (ms === bestMs && diff < bestDiff)) {
        bestMs = ms;
        bestDiff = diff;
        best = { asignacion: a, gestion: g };
      }
    }
  }

  if (best) return best;
  return { asignacion: aCandidates[0] ?? null, gestion: gCandidates[0] ?? null };
}

function pickBestSingleDateByCalendar(raw: unknown, calendarMap: Map<string, number>, now: Date) {
  const candidates = parseDateCandidatesWithSwap(raw);
  if (candidates.length === 0) return null;
  const mapped = candidates.filter((d) => calendarMap.has(bogotaDateKey(d)));
  const mappedNotFuture = mapped.find((d) => isNotFutureDate(d, now));
  if (mappedNotFuture) return mappedNotFuture;
  if (mapped.length > 0) return mapped[0]!;
  const notFuture = candidates.find((d) => isNotFutureDate(d, now));
  if (notFuture) return notFuture;
  return candidates[0]!;
}

async function createJob(input: {
  userId: string;
  type: string;
  fileName: string;
  fileMime?: string;
  fileSize?: number;
  fileBytes: Buffer;
  cleanupMissing: boolean;
}) {
  return prisma.cargueJob.create({
    data: {
      createdById: input.userId,
      type: input.type,
      fileName: input.fileName,
      fileMime: input.fileMime ?? null,
      fileSize: typeof input.fileSize === "number" ? input.fileSize : null,
      fileBytes: new Uint8Array(input.fileBytes),
      cleanupMissing: input.cleanupMissing,
      status: CargueJobStatus.QUEUED
    },
    select: { id: true }
  });
}

async function getJobForRead(jobId: string) {
  return prisma.cargueJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      type: true,
      fileName: true,
      cleanupMissing: true,
      createdById: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true,
      progressRows: true,
      progressSuccess: true,
      progressErrors: true,
      result: true,
      error: true
    }
  });
}

async function getJobForProcess(jobId: string) {
  return prisma.cargueJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      type: true,
      fileName: true,
      cleanupMissing: true,
      createdById: true,
      fileBytes: true
    }
  });
}

async function claimJob(jobId: string) {
  const updated = await prisma.cargueJob.updateMany({
    where: { id: jobId, status: CargueJobStatus.QUEUED },
    data: { status: CargueJobStatus.RUNNING, startedAt: new Date() }
  });
  return updated.count === 1;
}

async function updateJobProgress(jobId: string, progress: { rows: number; success: number; errors: number }) {
  await prisma.cargueJob.update({
    where: { id: jobId },
    data: {
      progressRows: progress.rows,
      progressSuccess: progress.success,
      progressErrors: progress.errors
    }
  });
}

async function finishJob(jobId: string, input: { ok: true; result: unknown } | { ok: false; error: string }) {
  await prisma.cargueJob.update({
    where: { id: jobId },
    data: input.ok
      ? {
          status: CargueJobStatus.DONE,
          result: input.result as Prisma.InputJsonValue,
          error: null,
          finishedAt: new Date(),
          fileBytes: new Uint8Array()
        }
      : {
          status: CargueJobStatus.ERROR,
          result: Prisma.DbNull,
          error: input.error,
          finishedAt: new Date(),
          fileBytes: new Uint8Array()
        }
  });
}

async function loadRowsFromFile(input: { filePath: string; fileName: string; type: string }) {
  let data: Record<string, unknown>[] = [];
  const lowerName = String(input.fileName ?? "").trim().toLowerCase();
  if (lowerName.endsWith(".csv")) {
    const primaryDelimiter =
      input.type === "ACTUALIZACION" ||
      input.type === "ACTIVIDADES_BAREMO" ||
      input.type === "RECORRIDO_INCREMENTOS" ||
      input.type === "LEVANTAMIENTO"
        ? ";"
        : ",";
    const fallbackDelimiter = primaryDelimiter === ";" ? "," : ";";
    const normalizeKey = (value: string) =>
      value
        .split("\u0000")
        .join("")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const hasCodigoColumn = (rows: Record<string, unknown>[]) =>
      rows.length > 0 && Object.keys(rows[0] ?? {}).some((k) => normalizeKey(k) === "codigo");
    const sanitizeRows = (rows: Record<string, unknown>[]) =>
      rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          const nk = String(k).split("\u0000").join("").trim();
          out[nk] = typeof v === "string" ? v.split("\u0000").join("") : v;
        }
        return out;
      });
    const parseContent = (content: string, delimiter: string) =>
      parseSync(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter,
        bom: true,
        relax_column_count: true
      }) as Record<string, unknown>[];
    const parseWithFallback = (content: string) => {
      const first = parseContent(content, primaryDelimiter);
      const firstKeys = Object.keys(first[0] ?? {});
      if (firstKeys.length === 1 && firstKeys[0]?.includes(fallbackDelimiter)) {
        return parseContent(content, fallbackDelimiter);
      }
      return first;
    };
    const bytes = fs.readFileSync(input.filePath);
    const looksUtf16 =
      (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (() => {
        const n = Math.min(bytes.length, 2000);
        if (n === 0) return false;
        let zeros = 0;
        for (let i = 0; i < n; i++) if (bytes[i] === 0x00) zeros++;
        return zeros / n > 0.2;
      })();
    const encodings: BufferEncoding[] = looksUtf16 ? ["utf16le", "utf8", "latin1"] : ["utf8", "utf16le", "latin1"];
    let lastErr: unknown;
    for (const enc of encodings) {
      try {
        const content = bytes.toString(enc);
        const parsed = sanitizeRows(parseWithFallback(content));
        if (input.type === "ACTIVIDADES_BAREMO" && !hasCodigoColumn(parsed)) {
          continue;
        }
        data = parsed;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : "UNKNOWN";
      writeLog(`ERROR: No se pudo leer CSV (${input.fileName}): ${msg}`);
      throw lastErr;
    }
  } else {
    const buffer = fs.readFileSync(input.filePath);
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]]!;
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) as Record<string, unknown>[];
    const formattedData = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      dateNF: "dd/mm/yyyy hh:mm:ss"
    }) as Record<string, unknown>[];
    const normalizeKey = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const isDateKey = (key: string) => {
      const k = normalizeKey(key);
      return k.includes("fecha") || k === "fecha_inicio" || k === "fecha_fin";
    };
    const looksLikeDate = (s: string) =>
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s) ||
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s);
    for (let i = 0; i < rawData.length; i++) {
      const r = rawData[i]!;
      const f = formattedData[i] ?? {};
      for (const key of Object.keys(r)) {
        if (!isDateKey(key)) continue;
        const fv = f[key];
        if (typeof fv !== "string") continue;
        const s = fv.trim();
        if (!s) continue;
        if (!looksLikeDate(s)) continue;
        r[key] = s;
      }
    }
    data = rawData;
  }
  return data;
}

async function loadRowsFromBytes(input: { fileName: string; type: string; bytes: Buffer }) {
  let data: Record<string, unknown>[] = [];
  const lowerName = String(input.fileName ?? "").trim().toLowerCase();
  if (lowerName.endsWith(".csv")) {
    const primaryDelimiter =
      input.type === "ACTUALIZACION" ||
      input.type === "ACTIVIDADES_BAREMO" ||
      input.type === "RECORRIDO_INCREMENTOS" ||
      input.type === "LEVANTAMIENTO"
        ? ";"
        : ",";
    const fallbackDelimiter = primaryDelimiter === ";" ? "," : ";";
    const normalizeKey = (value: string) =>
      value
        .split("\u0000")
        .join("")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const hasCodigoColumn = (rows: Record<string, unknown>[]) =>
      rows.length > 0 && Object.keys(rows[0] ?? {}).some((k) => normalizeKey(k) === "codigo");
    const sanitizeRows = (rows: Record<string, unknown>[]) =>
      rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          const nk = String(k).split("\u0000").join("").trim();
          out[nk] = typeof v === "string" ? v.split("\u0000").join("") : v;
        }
        return out;
      });
    const parseContent = (content: string, delimiter: string) =>
      parseSync(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter,
        bom: true,
        relax_column_count: true
      }) as Record<string, unknown>[];
    const parseWithFallback = (content: string) => {
      const first = parseContent(content, primaryDelimiter);
      const firstKeys = Object.keys(first[0] ?? {});
      if (firstKeys.length === 1 && firstKeys[0]?.includes(fallbackDelimiter)) {
        return parseContent(content, fallbackDelimiter);
      }
      return first;
    };
    const bytes = input.bytes;
    const looksUtf16 =
      (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (() => {
        const n = Math.min(bytes.length, 2000);
        if (n === 0) return false;
        let zeros = 0;
        for (let i = 0; i < n; i++) if (bytes[i] === 0x00) zeros++;
        return zeros / n > 0.2;
      })();
    const encodings: BufferEncoding[] = looksUtf16 ? ["utf16le", "utf8", "latin1"] : ["utf8", "utf16le", "latin1"];
    let lastErr: unknown;
    for (const enc of encodings) {
      try {
        const content = bytes.toString(enc);
        const parsed = sanitizeRows(parseWithFallback(content));
        if (input.type === "ACTIVIDADES_BAREMO" && !hasCodigoColumn(parsed)) {
          continue;
        }
        data = parsed;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : "UNKNOWN";
      writeLog(`ERROR: No se pudo leer CSV (${input.fileName}): ${msg}`);
      throw lastErr;
    }
  } else {
    const workbook = XLSX.read(input.bytes, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]]!;
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) as Record<string, unknown>[];
    const formattedData = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      dateNF: "dd/mm/yyyy hh:mm:ss"
    }) as Record<string, unknown>[];
    const normalizeKey = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const isDateKey = (key: string) => {
      const k = normalizeKey(key);
      return k.includes("fecha") || k === "fecha_inicio" || k === "fecha_fin";
    };
    const looksLikeDate = (s: string) =>
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s) ||
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s);
    for (let i = 0; i < rawData.length; i++) {
      const r = rawData[i]!;
      const f = formattedData[i] ?? {};
      for (const key of Object.keys(r)) {
        if (!isDateKey(key)) continue;
        const fv = f[key];
        if (typeof fv !== "string") continue;
        const s = fv.trim();
        if (!s) continue;
        if (!looksLikeDate(s)) continue;
        r[key] = s;
      }
    }
    data = rawData;
  }
  return data;
}

async function processActualizacionCsvFile(input: {
  fileBytes: Buffer;
  userId: string;
  cleanupMissing: boolean;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  const now = new Date();
  let successCount = 0;
  let errorCount = 0;
  const rowErrors: string[] = [];
  const codigosEnArchivo = input.cleanupMissing ? new Set<string>() : null;

  const calendarRows = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const getPureDateKey = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const calendarInicioMap = new Map<string, number>();
  const calendarFinMap = new Map<string, number>();
  for (const r of calendarRows) {
    const key = getPureDateKey(r.date);
    calendarInicioMap.set(key, r.dayNumber);
    calendarFinMap.set(key, r.dayNumberFin ?? r.dayNumber);
  }

  const detectDelimiter = (bytes: Buffer) => {
    const sample = bytes.toString("latin1", 0, Math.min(bytes.length, 8192));
    const firstLine =
      sample
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) ?? "";
    const semi = (firstLine.match(/;/g) ?? []).length;
    const comma = (firstLine.match(/,/g) ?? []).length;
    return semi >= comma ? ";" : ",";
  };

  const delimiter = detectDelimiter(input.fileBytes);
  const parser = parseStream({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    bom: true,
    relax_column_count: true
  });

  const fileStream = Readable.from([input.fileBytes]);
  fileStream.on("error", (err) => {
    parser.destroy(err);
  });
  const stream = fileStream.pipe(parser);

  let i = 0;
  for await (const row of stream as unknown as AsyncIterable<Record<string, unknown>>) {
    i++;
    try {
      const getVal = (name: string) => {
        const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.toLowerCase());
        return key ? row[key] : undefined;
      };

      const rawCode = (getVal("Orden de trabajo") || getVal("Orden"))?.toString().trim();
      const code = rawCode;
      if (!code) continue;

      if (codigosEnArchivo) codigosEnArchivo.add(code);

      const rawStatus = getVal("Estado")?.toString().trim().toUpperCase() || "";
      const orderNum = parseInt(code.replace(/\D/g, ""));
      const validStatuses = [
        "FACTURADA",
        "FACTURADO",
        "GESTIONADA",
        "GESTIONADO",
        "EN EJECUCION",
        "EN EJECUCIÓN",
        "EN GESTION",
        "EN GESTIÓN",
        "CERRADA",
        "CERRADO",
        "ASIGNADA",
        "ASIGNADO"
      ];

      if (isNaN(orderNum) || orderNum <= 3000000) continue;

      if (rawStatus === "CANCELADA" || rawStatus === "CANCELADO" || rawStatus === "SOLICITADA" || rawStatus === "SOLICITADO") {
        await prisma.workOrder.deleteMany({ where: { code } });
        continue;
      }

      if (!validStatuses.includes(rawStatus)) continue;

      const status = mapStatus(getVal("Estado")?.toString());
      const gestorCc = getVal("Cedula Gestor")?.toString().trim();
      const gestorNombre = getVal("Gestor")?.toString().trim();
      const rawTipoIncremento = getVal("Tipo Incremento")?.toString().trim().toUpperCase();
      const origen = getVal("Origen")?.toString().trim() || "";
      const nivelTension = getVal("Nivel Tensión")?.toString().trim() || "";

      let tipoIncremento = "Gestion";
      if (rawTipoIncremento === "P") tipoIncremento = "Parametrico";
      else if (rawTipoIncremento === "S") tipoIncremento = "Estructural";
      else tipoIncremento = "Gestion";

      const concatKey = `${origen}${tipoIncremento}${nivelTension}`;
      const mapOportunidad: Record<string, string> = {
        "Activos Nuevos Alta Tensión (AT)EstructuralAT": "AT_05",
        "Actualización Centro de ControlEstructuralAT": "AT_07",
        "Actualización LidarEstructuralAT": "AT_05",
        "Cambio de PropiedadParametricoAT": "AT_13",
        "CumplimentaciónEstructuralAT": "AT_09",
        "Enel X - ALUMBRADO PÚBLICOEstructuralAT": "AT_07",
        "InconsistenciaEstructuralAT": "AT_07",
        "Incremento por EmergenciasEstructuralAT": "AT_11",
        "Incremento por PDL/PSTEstructuralAT": "AT_05",
        "Activos Nuevos Alta Tensión (AT)ParametricoAT": "AT_06",
        "Actualización Centro de ControlParametricoAT": "AT_08",
        "Actualización LidarParametricoAT": "AT_06",
        "CumplimentaciónParametricoAT": "AT_10",
        "Enel X - ALUMBRADO PÚBLICOParametricoAT": "AT_08",
        "InconsistenciaParametricoAT": "AT_08",
        "Incremento por EmergenciasParametricoAT": "AT_12",
        "Incremento por PDL/PSTParametricoAT": "AT_06",
        "LevantamientoGestionAT": "AT_02",
        "Actualización Centro de ControlGestionBT": "BT_03",
        "Actualización LidarGestionBT": "BT_02",
        "Cambio de PropiedadGestionBT": "BT_02",
        "CumplimentaciónGestionBT": "BT_04",
        "Enel X - ALUMBRADO PÚBLICOGestionBT": "BT_03",
        "InconsistenciaGestionBT": "BT_03",
        "Incremento por EmergenciasGestionBT": "BT_05",
        "Incremento por PDL/PSTGestionBT": "BT_02",
        "Actualización Centro de ControlGestionMT": "MT_07",
        "Actualización LidarGestionMT": "MT_06",
        "Cambio de PropiedadGestionMT": "MT_10",
        "CumplimentaciónGestionMT": "MT_08",
        "Enel X - ALUMBRADO PÚBLICOGestionMT": "MT_07",
        "InconsistenciaGestionMT": "MT_07",
        "Incremento por EmergenciasGestionMT": "MT_09",
        "Incremento por PDL/PSTGestionMT": "MT_06",
        "LevantamientoUrbanoMT": "MT_02",
        "LevantamientoRuralMT": "MT_03",
        "LevantamientoAT": "AT_01",
        "ActualizacionAT": "AT_04",
        "ActualizacionBT": "BT_01",
        "LevantamientoMT": "MT_01",
        "ActualizacionMT": "MT_05",
        "Incrementos Ex PostGestionMT": "MT_09",
        "Incrementos Ex PostGestionBT": "BT_05",
        "Actualización TLCGestionMT": "MT_09"
      };
      const oportunidad = mapOportunidad[concatKey] || null;

      const mapAns: Record<string, number> = {
        AT_01: 4,
        AT_02: 14,
        AT_03: 10,
        AT_04: 1,
        AT_05: 10,
        AT_06: 5,
        AT_07: 10,
        AT_08: 5,
        AT_09: 5,
        AT_10: 5,
        AT_11: 5,
        AT_12: 3,
        AT_13: 5,
        AT_14: 5,
        BT_01: 1,
        BT_02: 3,
        BT_03: 3,
        BT_04: 4,
        BT_05: 3,
        BT_06: 4,
        MT_01: 4,
        MT_02: 4,
        MT_03: 8,
        MT_04: 5,
        MT_05: 1,
        MT_06: 3,
        MT_07: 3,
        MT_08: 4,
        MT_09: 3,
        MT_10: 5,
        MT_11: 4
      };
      const ansOportunidad = oportunidad ? mapAns[oportunidad] : null;

      const fechaAsignacionVal = getVal("Fecha Asignacion") || getVal("Fecha Asignación");
      const fechaGestionVal = getVal("Fecha Gestion") || getVal("Fecha Gestión");

      let assignedAt: Date | null = null;
      let gestionAt: Date | null = null;
      if (fechaAsignacionVal && fechaGestionVal) {
        const picked = pickBestAssignedGestionByCalendar(fechaAsignacionVal, fechaGestionVal, calendarInicioMap, calendarFinMap, now);
        assignedAt = picked.asignacion;
        gestionAt = picked.gestion;
      } else {
        assignedAt = fechaAsignacionVal ? pickBestSingleDateByCalendar(fechaAsignacionVal, calendarInicioMap, now) : null;
        gestionAt = fechaGestionVal ? pickBestSingleDateByCalendar(fechaGestionVal, calendarFinMap, now) : null;
      }

      const assignedAtUpdate = assignedAt && isNotFutureDate(assignedAt, now) ? assignedAt : undefined;
      const gestionAtUpdate = gestionAt && isNotFutureDate(gestionAt, now) ? gestionAt : undefined;
      const assignedAtCreate = assignedAtUpdate ?? null;
      const gestionAtCreate = gestionAtUpdate ?? null;

      const existing = await prisma.workOrder.findUnique({
        where: { code },
        select: { id: true, status: true }
      });

      let lockStatus = false;
      if (existing) {
        if (existing.status === "ON_HOLD") {
          lockStatus = true;
        } else {
          const openNovedades = await prisma.novedad.count({
            where: { workOrderId: existing.id, fechaFin: null }
          });
          lockStatus = openNovedades > 0;
        }
      }

      await prisma.workOrder.upsert({
        where: { code },
        update: {
          gestorCc: gestorCc || null,
          gestorNombre: gestorNombre || null,
          tipoIncremento,
          oportunidad,
          ansOportunidad,
          status: lockStatus ? existing!.status : status,
          estadoSecundario: lockStatus ? undefined : null,
          assignedAt: assignedAtUpdate,
          gestionAt: gestionAtUpdate,
          updatedAt: now,
          lastStatusChangeAt: lockStatus ? undefined : now
        },
        create: {
          code,
          title: `Orden ${code}`,
          description: "",
          gestorCc: gestorCc || null,
          gestorNombre: gestorNombre || null,
          tipoIncremento,
          oportunidad,
          ansOportunidad,
          status,
          estadoSecundario: null,
          assignedAt: assignedAtCreate,
          gestionAt: gestionAtCreate,
          createdById: input.userId,
          lastStatusChangeAt: now
        }
      });

      successCount++;
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i}: ${msg}`);
    }

    if (i % 2000 === 0) {
      writeLog(`INFO: Progreso ACTUALIZACION filas=${i} exitos=${successCount} errores=${errorCount}`);
      if (input.onProgress) {
        await input.onProgress({ rows: i, success: successCount, errors: errorCount });
      }
    }
  }

  if (input.cleanupMissing) {
    const result = await prisma.workOrder.deleteMany({
      where: {
        code: { notIn: Array.from(codigosEnArchivo ?? []) as string[] },
        status: { not: "DEVUELTA" }
      }
    });
    writeLog(`INFO: Eliminadas ${result.count} órdenes que no estaban en el archivo de actualización`);
  }

  writeLog(`INFO: Finalizado. Éxitos: ${successCount}, Errores: ${errorCount}`);
  if (input.onProgress) {
    await input.onProgress({ rows: i, success: successCount, errors: errorCount });
  }
  return {
    message: `Procesados: ${successCount} éxitos, ${errorCount} errores`,
    count: successCount,
    errors: errorCount,
    errorDetails: rowErrors
  };
}

async function processActualizacion(input: {
  data: Record<string, unknown>[];
  userId: string;
  cleanupMissing: boolean;
}) {
  const now = new Date();
  let successCount = 0;
  let errorCount = 0;
  const rowErrors: string[] = [];

  if (input.data.length > 0) {
    writeLog(`INFO: Primera fila de datos (claves): ${Object.keys(input.data[0]).join(", ")}`);
  }

  const codigosEnArchivo = new Set<string>();

  const calendarRows = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const calendarInicioMap = new Map<string, number>();
  const calendarFinMap = new Map<string, number>();
  for (const r of calendarRows) {
    const key = calendarKey(r.date);
    calendarInicioMap.set(key, r.dayNumber);
    calendarFinMap.set(key, r.dayNumberFin ?? r.dayNumber);
  }

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const getVal = (name: string) => {
        const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.toLowerCase());
        return key ? row[key] : undefined;
      };

      const rawCode = (getVal("Orden de trabajo") || getVal("Orden"))?.toString().trim();
      const code = rawCode;

      if (!code) {
        writeLog(`WARN: Fila ${i + 1} sin 'Orden de trabajo'`);
        continue;
      }

      codigosEnArchivo.add(code);

      const rawStatus = getVal("Estado")?.toString().trim().toUpperCase() || "";

      const orderNum = parseInt(code.replace(/\D/g, ""));
      const validStatuses = [
        "FACTURADA",
        "FACTURADO",
        "GESTIONADA",
        "GESTIONADO",
        "EN EJECUCION",
        "EN EJECUCIÓN",
        "EN GESTION",
        "EN GESTIÓN",
        "CERRADA",
        "CERRADO",
        "ASIGNADA",
        "ASIGNADO"
      ];

      if (isNaN(orderNum) || orderNum <= 3000000) {
        writeLog(`INFO: Omitiendo fila ${i + 1} (Orden ${code}) por ser <= 3000000`);
        continue;
      }

      if (rawStatus === "CANCELADA" || rawStatus === "CANCELADO" || rawStatus === "SOLICITADA" || rawStatus === "SOLICITADO") {
        await prisma.workOrder.deleteMany({ where: { code } });
        writeLog(`INFO: Eliminando Orden ${code} por estado: ${rawStatus}`);
        continue;
      }

      if (!validStatuses.includes(rawStatus)) {
        writeLog(`INFO: Omitiendo fila ${i + 1} (Orden ${code}) por estado no permitido: ${rawStatus}`);
        continue;
      }

      const status = mapStatus(getVal("Estado")?.toString());
      const gestorCc = getVal("Cedula Gestor")?.toString().trim();
      const gestorNombre = getVal("Gestor")?.toString().trim();
      const rawTipoIncremento = getVal("Tipo Incremento")?.toString().trim().toUpperCase();
      const origen = getVal("Origen")?.toString().trim() || "";
      const nivelTension = getVal("Nivel Tensión")?.toString().trim() || "";

      let tipoIncremento = "Gestion";
      if (rawTipoIncremento === "P") {
        tipoIncremento = "Parametrico";
      } else if (rawTipoIncremento === "S") {
        tipoIncremento = "Estructural";
      } else if (
        !rawTipoIncremento ||
        rawTipoIncremento === "SENDA" ||
        rawTipoIncremento === "ACTUALIZACIÓN" ||
        rawTipoIncremento === "ACTUALIZACION"
      ) {
        tipoIncremento = "Gestion";
      } else {
        tipoIncremento = "Gestion";
      }

      const concatKey = `${origen}${tipoIncremento}${nivelTension}`;
      const mapOportunidad: Record<string, string> = {
        "Activos Nuevos Alta Tensión (AT)EstructuralAT": "AT_05",
        "Actualización Centro de ControlEstructuralAT": "AT_07",
        "Actualización LidarEstructuralAT": "AT_05",
        "Cambio de PropiedadParametricoAT": "AT_13",
        "CumplimentaciónEstructuralAT": "AT_09",
        "Enel X - ALUMBRADO PÚBLICOEstructuralAT": "AT_07",
        "InconsistenciaEstructuralAT": "AT_07",
        "Incremento por EmergenciasEstructuralAT": "AT_11",
        "Incremento por PDL/PSTEstructuralAT": "AT_05",
        "Activos Nuevos Alta Tensión (AT)ParametricoAT": "AT_06",
        "Actualización Centro de ControlParametricoAT": "AT_08",
        "Actualización LidarParametricoAT": "AT_06",
        "CumplimentaciónParametricoAT": "AT_10",
        "Enel X - ALUMBRADO PÚBLICOParametricoAT": "AT_08",
        "InconsistenciaParametricoAT": "AT_08",
        "Incremento por EmergenciasParametricoAT": "AT_12",
        "Incremento por PDL/PSTParametricoAT": "AT_06",
        "LevantamientoGestionAT": "AT_02",
        "Actualización Centro de ControlGestionBT": "BT_03",
        "Actualización LidarGestionBT": "BT_02",
        "Cambio de PropiedadGestionBT": "BT_02",
        "CumplimentaciónGestionBT": "BT_04",
        "Enel X - ALUMBRADO PÚBLICOGestionBT": "BT_03",
        "InconsistenciaGestionBT": "BT_03",
        "Incremento por EmergenciasGestionBT": "BT_05",
        "Incremento por PDL/PSTGestionBT": "BT_02",
        "Actualización Centro de ControlGestionMT": "MT_07",
        "Actualización LidarGestionMT": "MT_06",
        "Cambio de PropiedadGestionMT": "MT_10",
        "CumplimentaciónGestionMT": "MT_08",
        "Enel X - ALUMBRADO PÚBLICOGestionMT": "MT_07",
        "InconsistenciaGestionMT": "MT_07",
        "Incremento por EmergenciasGestionMT": "MT_09",
        "Incremento por PDL/PSTGestionMT": "MT_06",
        "LevantamientoUrbanoMT": "MT_02",
        "LevantamientoRuralMT": "MT_03",
        "LevantamientoAT": "AT_01",
        "ActualizacionAT": "AT_04",
        "ActualizacionBT": "BT_01",
        "LevantamientoMT": "MT_01",
        "ActualizacionMT": "MT_05",
        "Incrementos Ex PostGestionMT": "MT_09",
        "Incrementos Ex PostGestionBT": "BT_05",
        "Actualización TLCGestionMT": "MT_09"
      };
      const oportunidad = mapOportunidad[concatKey] || null;

      const mapAns: Record<string, number> = {
        AT_01: 4,
        AT_02: 14,
        AT_03: 10,
        AT_04: 1,
        AT_05: 10,
        AT_06: 5,
        AT_07: 10,
        AT_08: 5,
        AT_09: 5,
        AT_10: 5,
        AT_11: 5,
        AT_12: 3,
        AT_13: 5,
        AT_14: 5,
        BT_01: 1,
        BT_02: 3,
        BT_03: 3,
        BT_04: 4,
        BT_05: 3,
        BT_06: 4,
        MT_01: 4,
        MT_02: 4,
        MT_03: 8,
        MT_04: 5,
        MT_05: 1,
        MT_06: 3,
        MT_07: 3,
        MT_08: 4,
        MT_09: 3,
        MT_10: 5,
        MT_11: 4
      };
      const ansOportunidad = oportunidad ? mapAns[oportunidad] : null;

      const fechaAsignacionVal = getVal("Fecha Asignacion") || getVal("Fecha Asignación");
      const fechaGestionVal = getVal("Fecha Gestion") || getVal("Fecha Gestión");

      let assignedAt: Date | null = null;
      let gestionAt: Date | null = null;
      if (fechaAsignacionVal && fechaGestionVal) {
        const picked = pickBestAssignedGestionByCalendar(fechaAsignacionVal, fechaGestionVal, calendarInicioMap, calendarFinMap, now);
        assignedAt = picked.asignacion;
        gestionAt = picked.gestion;
      } else {
        assignedAt = fechaAsignacionVal ? pickBestSingleDateByCalendar(fechaAsignacionVal, calendarInicioMap, now) : null;
        gestionAt = fechaGestionVal ? pickBestSingleDateByCalendar(fechaGestionVal, calendarFinMap, now) : null;
      }

      const assignedAtUpdate = assignedAt && isNotFutureDate(assignedAt, now) ? assignedAt : undefined;
      const gestionAtUpdate = gestionAt && isNotFutureDate(gestionAt, now) ? gestionAt : undefined;
      const assignedAtCreate = assignedAtUpdate ?? null;
      const gestionAtCreate = gestionAtUpdate ?? null;

      const existing = await prisma.workOrder.findUnique({
        where: { code },
        select: { id: true, status: true }
      });

      let lockStatus = false;
      if (existing) {
        if (existing.status === "ON_HOLD") {
          lockStatus = true;
        } else {
          const openNovedades = await prisma.novedad.count({
            where: { workOrderId: existing.id, fechaFin: null }
          });
          lockStatus = openNovedades > 0;
        }
      }

      await prisma.workOrder.upsert({
        where: { code },
        update: {
          gestorCc: gestorCc || null,
          gestorNombre: gestorNombre || null,
          tipoIncremento,
          oportunidad,
          ansOportunidad,
          status: lockStatus ? existing!.status : status,
          estadoSecundario: lockStatus ? undefined : null,
          assignedAt: assignedAtUpdate,
          gestionAt: gestionAtUpdate,
          updatedAt: now,
          lastStatusChangeAt: lockStatus ? undefined : now
        },
        create: {
          code,
          title: `Orden ${code}`,
          description: "",
          gestorCc: gestorCc || null,
          gestorNombre: gestorNombre || null,
          tipoIncremento,
          oportunidad,
          ansOportunidad,
          status,
          estadoSecundario: null,
          assignedAt: assignedAtCreate,
          gestionAt: gestionAtCreate,
          createdById: input.userId,
          lastStatusChangeAt: now
        }
      });
      successCount++;
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i + 1}: ${msg}`);
    }
  }

  if (input.cleanupMissing) {
    try {
      const result = await prisma.workOrder.deleteMany({
        where: {
          code: { notIn: Array.from(codigosEnArchivo) as string[] },
          status: { not: "DEVUELTA" }
        }
      });
      writeLog(`INFO: Eliminadas ${result.count} órdenes que no estaban en el archivo de actualización`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      writeLog(`ERROR al limpiar órdenes antiguas: ${msg}`);
    }
  }

  writeLog(`INFO: Finalizado. Éxitos: ${successCount}, Errores: ${errorCount}`);
  return {
    message: `Procesados: ${successCount} éxitos, ${errorCount} errores`,
    count: successCount,
    errors: errorCount,
    errorDetails: rowErrors,
    columns: input.data.length > 0 ? Object.keys(input.data[0]) : []
  };
}

async function processDevolucionesJob(input: {
  data: Record<string, unknown>[];
  userId: string;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let deletedCount = 0;
  let updatedCount = 0;
  let ignoredCount = 0;
  const rowErrors: string[] = [];
  const debugSample: Array<{
    fila: number;
    orden: string;
    motivo: string;
    fechaDevolucion: string;
    fechaRespuesta: string;
    devKey: string;
    resKey: string;
    devEnCalendar: boolean;
    resEnCalendar: boolean;
  }> = [];

  const asRawStr = (v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    return String(v ?? "");
  };

  const calendar = await prisma.calendar.findMany();
  const calendarInicioMap = new Map<string, number>();
  const calendarFinMap = new Map<string, number>();
  const finNumberToDate = new Map<number, string>();
  calendar.forEach((c) => {
    const key = calendarKey(c.date);
    calendarInicioMap.set(key, c.dayNumber);
    const finNum = c.dayNumberFin ?? c.dayNumber;
    calendarFinMap.set(key, finNum);
    finNumberToDate.set(finNum, key);
  });

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const getVal = (name: string) => {
        const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.toLowerCase());
        return key ? row[key] : undefined;
      };

      const code = (getVal("Orden Trabajo") || getVal("Orden de trabajo") || getVal("Orden"))?.toString().trim();
      const estadoSecundario = (getVal("Estado secundario") || getVal("Estado secundarios"))
        ?.toString()
        .trim()
        .toUpperCase();

      if (!code) continue;

      const orderNum = parseInt(code.replace(/\D/g, ""));
      if (isNaN(orderNum) || orderNum <= 3000000) continue;

      if (estadoSecundario === "DEVUELTA") {
        const now = new Date();
        const order = await prisma.workOrder.upsert({
          where: { code },
          update: {
            status: "DEVUELTA",
            estadoSecundario: "DEVUELTA",
            updatedAt: now
          },
          create: {
            code,
            title: `Orden ${code}`,
            description: "",
            status: "DEVUELTA",
            estadoSecundario: "DEVUELTA",
            createdById: input.userId,
            lastStatusChangeAt: now
          }
        });

        const lastHistory = await prisma.workOrderHistory.findFirst({
          where: { workOrderId: order.id },
          orderBy: { changedAt: "desc" }
        });

        if (!lastHistory || lastHistory.toStatus !== "DEVUELTA") {
          await prisma.workOrderHistory.create({
            data: {
              workOrderId: order.id,
              toStatus: "DEVUELTA",
              note: "Orden marcada como DEVUELTA desde el cargue de devoluciones",
              changedById: input.userId
            }
          });
        }
        deletedCount++;
      }

      const fechaDevolucionVal = getVal("Fecha Devolución") || getVal("Fecha Devolucion");
      const fechaRespuestaVal = getVal("Fecha Respuesta");

      if (!(fechaDevolucionVal && fechaRespuestaVal)) {
        if (debugSample.length < 50) {
          debugSample.push({
            fila: i + 1,
            orden: code,
            motivo: "Falta fecha devolucion o fecha respuesta",
            fechaDevolucion: asRawStr(fechaDevolucionVal),
            fechaRespuesta: asRawStr(fechaRespuestaVal),
            devKey: "",
            resKey: "",
            devEnCalendar: false,
            resEnCalendar: false
          });
        }
        ignoredCount++;
        continue;
      }

      const dDev = pickBestDateByMap(fechaDevolucionVal, calendarInicioMap);
      const dRes = pickBestDateByMap(fechaRespuestaVal, calendarFinMap);
      if (!(dDev && dRes)) {
        if (debugSample.length < 50) {
          debugSample.push({
            fila: i + 1,
            orden: code,
            motivo: "No se pudo parsear fecha devolucion o respuesta",
            fechaDevolucion: asRawStr(fechaDevolucionVal),
            fechaRespuesta: asRawStr(fechaRespuestaVal),
            devKey: dDev ? bogotaDateKey(dDev) : "",
            resKey: dRes ? bogotaDateKey(dRes) : "",
            devEnCalendar: dDev ? calendarInicioMap.has(bogotaDateKey(dDev)) : false,
            resEnCalendar: dRes ? calendarFinMap.has(bogotaDateKey(dRes)) : false
          });
        }
        ignoredCount++;
        continue;
      }

      const devKey = bogotaDateKey(dDev);
      const resKey = bogotaDateKey(dRes);
      const inicioDev = calendarInicioMap.get(devKey);
      let finRes = calendarFinMap.get(resKey);

      const isAfter1700 = bogotaMinutes(dRes) > 17 * 60;

      let fechaFinEfectiva = new Date(dRes);
      if (finRes !== undefined && isAfter1700) {
        finRes = finRes + 1;
        const effectiveKey = finNumberToDate.get(finRes);
        if (effectiveKey) {
          const [y, m, d] = effectiveKey.split("-").map((v) => parseInt(v, 10));
          const minutes = bogotaMinutes(dRes);
          const hh = Math.floor(minutes / 60);
          const mm = minutes % 60;
          fechaFinEfectiva = makeBogotaDate(y, m, d, hh, mm, 0);
        }
      }
      const fechaFinEfectivaIso = fechaFinEfectiva.toISOString();

      if (inicioDev === undefined || finRes === undefined) {
        if (debugSample.length < 50) {
          debugSample.push({
            fila: i + 1,
            orden: code,
            motivo: "Fecha no encontrada en Calendar (inicio o fin)",
            fechaDevolucion: asRawStr(fechaDevolucionVal),
            fechaRespuesta: asRawStr(fechaRespuestaVal),
            devKey,
            resKey,
            devEnCalendar: calendarInicioMap.has(devKey),
            resEnCalendar: calendarFinMap.has(resKey)
          });
        }
        ignoredCount++;
        continue;
      }

      const order = await prisma.workOrder.findUnique({ where: { code } });
      if (!order) {
        ignoredCount++;
        continue;
      }

      if (!order.assignedAt) {
        ignoredCount++;
        continue;
      }

      const dAsig = order.assignedAt;
      if (bogotaDateKey(dDev) < bogotaDateKey(dAsig)) {
        ignoredCount++;
        continue;
      }

      const diff = finRes - inicioDev;
      if (diff <= 0) {
        ignoredCount++;
        continue;
      }

      const finDayPrefix = fechaFinEfectivaIso.slice(0, 10);
      const existingDiscount = await prisma.workOrderHistory.findFirst({
        where: {
          workOrderId: order.id,
          note: { contains: "Descuento por devolución" },
          fechaInicio: dDev.toISOString(),
          fechaFin: { startsWith: finDayPrefix }
        }
      });

      const note = `Descuento por devolución: ${diff} días${isAfter1700 ? " (+1 por respuesta > 17:00)" : ""} (Fecha Devolución: ${dDev.toLocaleString()} - Fecha Respuesta: ${dRes.toLocaleString()})`;

      if (existingDiscount) {
        if (existingDiscount.fechaFin !== fechaFinEfectivaIso || existingDiscount.note !== note) {
          await prisma.workOrderHistory.update({
            where: { id: existingDiscount.id },
            data: { fechaFin: fechaFinEfectivaIso, note }
          });
        }
        ignoredCount++;
        continue;
      }

      await prisma.workOrder.update({
        where: { id: order.id },
        data: { diasDescuento: { increment: diff } }
      });

      await prisma.workOrderHistory.create({
        data: {
          workOrderId: order.id,
          toStatus: order.status,
          fechaInicio: dDev.toISOString(),
          fechaFin: fechaFinEfectivaIso,
          note,
          changedById: input.userId
        }
      });

      updatedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 2000 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: updatedCount, errors: rowErrors.length });
    }
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: updatedCount, errors: rowErrors.length });
  }

  return {
    message: `Proceso de Devoluciones finalizado. ${deletedCount} eliminadas, ${updatedCount} actualizadas.`,
    count: updatedCount,
    deleted: deletedCount,
    ignored: ignoredCount,
    errors: rowErrors.length,
    errorDetails: rowErrors,
    debugSample
  };
}

async function processCalendarioJob(input: {
  data: Record<string, unknown>[];
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let successCount = 0;
  let errorCount = 0;
  const rowErrors: string[] = [];
  const debugSample: Array<{ fila: number; fecha: string; inicio: number; fin: number | null }> = [];
  const duplicateSample: Array<{ fecha: string; prevFila: number; fila: number; prevInicio: number; prevFin: number | null; inicio: number; fin: number | null }> = [];
  const seenByDate = new Map<string, { fila: number; inicio: number; fin: number | null }>();

  await prisma.calendar.deleteMany({});

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const fechaVal =
        getRowVal(row, "fecha") ??
        getRowVal(row, "Fecha") ??
        (() => {
          const v = Object.values(row).find((x) => {
            const s = String(x ?? "").trim();
            if (!s) return false;
            return /^(\d{4})-(\d{2})-(\d{2})/.test(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.test(s);
          });
          return v;
        })();

      let inicioVal = getRowVal(row, "Incio") ?? getRowVal(row, "Inicio");
      let finVal = getRowVal(row, "Fin");
      if (inicioVal === undefined && finVal === undefined) {
        const picked = pickCalendarNumbersFromRow(row);
        inicioVal = picked.inicio ?? undefined;
        finVal = picked.fin ?? undefined;
      }

      const hasInicio = !(inicioVal === undefined || inicioVal === null || inicioVal === "");
      const hasFin = !(finVal === undefined || finVal === null || finVal === "");
      if (!fechaVal || (!hasInicio && !hasFin)) continue;

      let date: Date | null = null;
      if (fechaVal instanceof Date) {
        const key = bogotaDateKey(fechaVal);
        const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
        date = makeBogotaDate(y, m, d, 0, 0, 0);
      } else {
        const candidates = parseFlexibleDateCandidates(fechaVal);
        const picked = candidates[0] ?? null;
        if (picked) {
          const key = bogotaDateKey(picked);
          const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
          date = makeBogotaDate(y, m, d, 0, 0, 0);
        }
      }

      if (!date || isNaN(date.getTime())) {
        rowErrors.push(`Fila ${i + 1}: Fecha inválida ${fechaVal}`);
        errorCount++;
        continue;
      }

      const normalizedKey = bogotaDateKey(date);
      const [ny, nm, nd] = normalizedKey.split("-").map((v) => parseInt(v, 10));
      const normalizedDate = makeBogotaDate(ny, nm, nd, 0, 0, 0);

      const parsedInicio = hasInicio ? parseIntLoose(inicioVal) : NaN;
      const parsedFin = hasFin ? parseIntLoose(finVal) : NaN;
      const dayNumber = Number.isFinite(parsedInicio) ? parsedInicio : parsedFin;
      const dayNumberFin = Number.isFinite(parsedFin) ? parsedFin : null;
      if (isNaN(dayNumber)) {
        rowErrors.push(`Fila ${i + 1}: Inicio/Fin no es número (Inicio=${inicioVal ?? ""}, Fin=${finVal ?? ""})`);
        errorCount++;
        continue;
      }

      const prev = seenByDate.get(normalizedKey);
      if (prev && duplicateSample.length < 20) {
        duplicateSample.push({
          fecha: normalizedKey,
          prevFila: prev.fila,
          fila: i + 1,
          prevInicio: prev.inicio,
          prevFin: prev.fin,
          inicio: dayNumber,
          fin: dayNumberFin
        });
      }
      if (!prev) {
        seenByDate.set(normalizedKey, { fila: i + 1, inicio: dayNumber, fin: dayNumberFin });
      }

      await prisma.calendar.upsert({
        where: { date: normalizedDate },
        update: { dayNumber, dayNumberFin },
        create: { date: normalizedDate, dayNumber, dayNumberFin }
      });
      successCount++;
      if (debugSample.length < 20) debugSample.push({ fila: i + 1, fecha: normalizedKey, inicio: dayNumber, fin: dayNumberFin });
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 2000 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: successCount, errors: errorCount });
    }
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: successCount, errors: errorCount });
  }

  return {
    message: `Calendario actualizado: ${successCount} registros.`,
    count: successCount,
    errors: errorCount,
    errorDetails: rowErrors,
    debugSample,
    duplicateSample
  };
}

async function processActividadesBaremoJob(input: {
  data: Record<string, unknown>[];
  userId: string;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let successCount = 0;
  let errorCount = 0;
  const rowErrors: string[] = [];

  const normalizeHeader = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  const getVal = (row: Record<string, unknown>, name: string) => {
    const target = normalizeHeader(name);
    const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
    return key ? row[key] : undefined;
  };

  const parseNumber = (val: unknown) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return Number.isFinite(val) ? val : null;
    const str = String(val).trim();
    if (!str) return null;
    const normalized = str.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  };

  const parseDate = (val: unknown) => {
    return parseFlexibleDateCandidates(val)[0] ?? null;
  };

  const stableStringify = (obj: Record<string, unknown>) => {
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = obj[k];
    return JSON.stringify(out);
  };

  const allowedBars = new Set([
    1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    80, 81, 82, 83, 84, 86, 87, 88, 89, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
    113
  ]);

  const chunk = <T,>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const withRetry = async <T,>(fn: () => Promise<T>) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retryable =
          msg.toLowerCase().includes("database is locked") ||
          msg.toLowerCase().includes("socket timeout") ||
          msg.toLowerCase().includes("busy") ||
          msg.toLowerCase().includes("too many sql variables");
        if (!retryable || attempt === 2) throw e;
        await sleep(400 * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  };

  try {
    await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 60000");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    writeLog(`WARN: No se pudo configurar busy_timeout: ${msg}`);
  }

  const latestByCodigo = new Map<
    string,
    {
      codigo: string;
      estado: string | null;
      tipo: string | null;
      origen: string | null;
      fechaSolicitud: Date | null;
      fechaAsignacion: Date | null;
      fechaGestion: Date | null;
      gestor: string | null;
      nivelTension: string | null;
      proyecto: string | null;
      actaFacturacion: string | null;
      nombreIncremento: string | null;
      estadoIncremento: string | null;
      total: number | null;
      totalConIva: number | null;
      totalBarSum: number;
      baremo: Record<string, number>;
    }
  >();

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const codigo = (getVal(row, "Código") ?? getVal(row, "Codigo") ?? getVal(row, "CÃ³digo"))?.toString().trim();
      if (!codigo) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta Código`);
        continue;
      }

      const orderNum = parseInt(codigo.replace(/\D/g, ""));
      if (isNaN(orderNum) || orderNum <= 3000000) continue;

      const estado = (getVal(row, "Estado") ?? "").toString().trim() || null;
      const tipo = (getVal(row, "Tipo") ?? "").toString().trim() || null;
      const origen = (getVal(row, "Origen") ?? "").toString().trim() || null;

      const fechaSolicitud = parseDate(getVal(row, "Fecha solicitud"));
      const fechaAsignacion =
        parseDate(getVal(row, "Fecha asignación")) ??
        parseDate(getVal(row, "Fecha asignacion")) ??
        parseDate(getVal(row, "Fecha asignaciÃ³n"));
      const fechaGestion =
        parseDate(getVal(row, "Fecha gestión")) ??
        parseDate(getVal(row, "Fecha gestion")) ??
        parseDate(getVal(row, "Fecha gestiÃ³n"));

      const gestor = (getVal(row, "Gestor") ?? "").toString().trim() || null;
      const nivelTension =
        (getVal(row, "Nivel de tensión") ?? getVal(row, "Nivel de tension") ?? getVal(row, "Nivel de tensiÃ³n") ?? "")?.toString().trim() || null;
      const proyecto = (getVal(row, "Proyecto") ?? "").toString().trim() || null;
      const actaFacturacion =
        (getVal(row, "Acta facturación") ?? getVal(row, "Acta facturacion") ?? getVal(row, "Acta facturaciÃ³n") ?? "")?.toString().trim() || null;
      const nombreIncremento = (getVal(row, "Nombre incremento") ?? "").toString().trim() || null;
      const estadoIncremento = (getVal(row, "Estado incremento") ?? "").toString().trim() || null;
      const total = parseNumber(getVal(row, "Total"));
      const totalConIva = parseNumber(getVal(row, "Total con IVA")) ?? parseNumber(getVal(row, "Total con Iva")) ?? parseNumber(getVal(row, "Total con IVA "));

      const baremo: Record<string, number> = {};
      let totalBarSum = 0;
      for (const key of Object.keys(row)) {
        const k = normalizeHeader(key);
        const m = /^bar_(\d+)$/.exec(k);
        if (!m) continue;
        const value = parseNumber(row[key]);
        if (value === null) continue;
        const idx = parseInt(m[1], 10);
        if (allowedBars.has(idx)) totalBarSum += value;
        baremo[`bar_${idx}`] = value;
      }

      latestByCodigo.set(codigo, {
        codigo,
        estado,
        tipo,
        origen,
        fechaSolicitud,
        fechaAsignacion,
        fechaGestion,
        gestor,
        nivelTension,
        proyecto,
        actaFacturacion,
        nombreIncremento,
        estadoIncremento,
        total,
        totalConIva,
        totalBarSum,
        baremo
      });
      successCount++;
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 2000 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: successCount, errors: errorCount });
    }
  }

  const codigos = [...latestByCodigo.keys()];
  const existingMap = new Map<string, Prisma.ActividadBaremoGetPayload<{ select: {
    codigo: true;
    estado: true;
    tipo: true;
    origen: true;
    fechaSolicitud: true;
    fechaAsignacion: true;
    fechaGestion: true;
    gestor: true;
    nivelTension: true;
    proyecto: true;
    actaFacturacion: true;
    nombreIncremento: true;
    estadoIncremento: true;
    total: true;
    totalConIva: true;
    totalBarSum: true;
    ansRef: true;
    ansCalc: true;
    baremo: true;
  } }>>();

  for (const group of chunk(codigos, 900)) {
    const found = await prisma.actividadBaremo.findMany({
      where: { codigo: { in: group } },
      select: {
        codigo: true,
        estado: true,
        tipo: true,
        origen: true,
        fechaSolicitud: true,
        fechaAsignacion: true,
        fechaGestion: true,
        gestor: true,
        nivelTension: true,
        proyecto: true,
        actaFacturacion: true,
        nombreIncremento: true,
        estadoIncremento: true,
        total: true,
        totalConIva: true,
        totalBarSum: true,
        ansRef: true,
        ansCalc: true,
        baremo: true
      }
    });
    for (const r of found) existingMap.set(r.codigo, r);
  }

  const ansMap = new Map<string, number>();
  for (const group of chunk(codigos, 900)) {
    const found = await prisma.workOrder.findMany({
      where: { code: { in: group } },
      select: { code: true, ansOportunidad: true }
    });
    for (const r of found) {
      if (r.ansOportunidad != null) ansMap.set(r.code, r.ansOportunidad);
    }
  }

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const creates: Array<Prisma.ActividadBaremoCreateManyInput> = [];
  const updates: Array<{ codigo: string; data: Prisma.ActividadBaremoUpdateInput }> = [];
  const historyRows: Array<Prisma.WorkOrderHistoryCreateManyInput> = [];

  for (const [codigo, row] of latestByCodigo.entries()) {
    const ansRef = ansMap.get(codigo) ?? null;
    const rawAnsCalc = ansRef != null ? (row.totalBarSum < 39 ? 0 : (row.totalBarSum / 39) * ansRef - ansRef) : null;
    const ansCalc = rawAnsCalc == null ? null : Math.floor(rawAnsCalc);

    const newData = {
      codigo,
      estado: row.estado,
      tipo: row.tipo,
      origen: row.origen,
      fechaSolicitud: row.fechaSolicitud,
      fechaAsignacion: row.fechaAsignacion,
      fechaGestion: row.fechaGestion,
      gestor: row.gestor,
      nivelTension: row.nivelTension,
      proyecto: row.proyecto,
      actaFacturacion: row.actaFacturacion,
      nombreIncremento: row.nombreIncremento,
      estadoIncremento: row.estadoIncremento,
      total: row.total,
      totalConIva: row.totalConIva,
      totalBarSum: row.totalBarSum,
      ansRef,
      ansCalc,
      baremo: row.baremo
    };

    const existing = existingMap.get(codigo);
    if (!existing) {
      creates.push(newData);
      createdCount++;
      continue;
    }

    const beforeScalars = {
      estado: existing.estado,
      tipo: existing.tipo,
      origen: existing.origen,
      fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
      fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
      fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
      gestor: existing.gestor,
      nivelTension: existing.nivelTension,
      proyecto: existing.proyecto,
      actaFacturacion: existing.actaFacturacion,
      nombreIncremento: existing.nombreIncremento,
      estadoIncremento: existing.estadoIncremento,
      total: existing.total,
      totalConIva: existing.totalConIva,
      totalBarSum: existing.totalBarSum,
      ansRef: existing.ansRef,
      ansCalc: existing.ansCalc
    };
    const newScalars = {
      estado: newData.estado,
      tipo: newData.tipo,
      origen: newData.origen,
      fechaSolicitud: newData.fechaSolicitud ? newData.fechaSolicitud.toISOString() : null,
      fechaAsignacion: newData.fechaAsignacion ? newData.fechaAsignacion.toISOString() : null,
      fechaGestion: newData.fechaGestion ? newData.fechaGestion.toISOString() : null,
      gestor: newData.gestor,
      nivelTension: newData.nivelTension,
      proyecto: newData.proyecto,
      actaFacturacion: newData.actaFacturacion,
      nombreIncremento: newData.nombreIncremento,
      estadoIncremento: newData.estadoIncremento,
      total: newData.total,
      totalConIva: newData.totalConIva,
      totalBarSum: newData.totalBarSum,
      ansRef: newData.ansRef,
      ansCalc: newData.ansCalc
    };

    const sameScalars = JSON.stringify(beforeScalars) === JSON.stringify(newScalars);
    const sameBaremo =
      stableStringify((existing.baremo as Record<string, unknown>) || {}) ===
      stableStringify(newData.baremo as unknown as Record<string, unknown>);

    if (sameScalars && sameBaremo) {
      unchangedCount++;
      continue;
    }

    updates.push({ codigo, data: newData });
    updatedCount++;
  }

  const workOrderMap = new Map<string, { id: string; status: WorkOrderStatus }>();
  for (const group of chunk(codigos, 900)) {
    const found = await prisma.workOrder.findMany({
      where: { code: { in: group } },
      select: { id: true, code: true, status: true }
    });
    for (const r of found) workOrderMap.set(r.code, { id: r.id, status: r.status });
  }

  for (const group of chunk(creates, 30)) {
    if (group.length === 0) continue;
    await withRetry(() => prisma.actividadBaremo.createMany({ data: group }));
  }

  for (const group of chunk(updates, 20)) {
    const ops = group.map((u) => prisma.actividadBaremo.update({ where: { codigo: u.codigo }, data: u.data }));
    if (ops.length === 0) continue;
    await withRetry(() => prisma.$transaction(ops));
  }

  for (const [codigo, row] of latestByCodigo.entries()) {
    const existing = existingMap.get(codigo);
    const ansRef = ansMap.get(codigo) ?? null;
    const rawAnsCalc = ansRef != null ? (row.totalBarSum < 39 ? 0 : (row.totalBarSum / 39) * ansRef - ansRef) : null;
    const ansCalc = rawAnsCalc == null ? null : Math.floor(rawAnsCalc);

    const order = workOrderMap.get(codigo);
    if (!order) continue;

    if (!existing) {
      historyRows.push({
        workOrderId: order.id,
        toStatus: order.status,
        note: `Carga Actividades Baremo`,
        noteDetail: `TotalBaremo=${row.totalBarSum}; ANS=${ansRef ?? ""}; Resultado=${ansCalc ?? ""}`,
        changedById: input.userId
      });
      continue;
    }

    const beforeScalars = {
      estado: existing.estado,
      tipo: existing.tipo,
      origen: existing.origen,
      fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
      fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
      fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
      gestor: existing.gestor,
      nivelTension: existing.nivelTension,
      proyecto: existing.proyecto,
      actaFacturacion: existing.actaFacturacion,
      nombreIncremento: existing.nombreIncremento,
      estadoIncremento: existing.estadoIncremento,
      total: existing.total,
      totalConIva: existing.totalConIva,
      totalBarSum: existing.totalBarSum,
      ansRef: existing.ansRef,
      ansCalc: existing.ansCalc
    };
    const newScalars = {
      estado: row.estado,
      tipo: row.tipo,
      origen: row.origen,
      fechaSolicitud: row.fechaSolicitud ? row.fechaSolicitud.toISOString() : null,
      fechaAsignacion: row.fechaAsignacion ? row.fechaAsignacion.toISOString() : null,
      fechaGestion: row.fechaGestion ? row.fechaGestion.toISOString() : null,
      gestor: row.gestor,
      nivelTension: row.nivelTension,
      proyecto: row.proyecto,
      actaFacturacion: row.actaFacturacion,
      nombreIncremento: row.nombreIncremento,
      estadoIncremento: row.estadoIncremento,
      total: row.total,
      totalConIva: row.totalConIva,
      totalBarSum: row.totalBarSum,
      ansRef,
      ansCalc
    };
    const sameScalars = JSON.stringify(beforeScalars) === JSON.stringify(newScalars);
    const sameBaremo =
      stableStringify((existing.baremo as Record<string, unknown>) || {}) ===
      stableStringify(row.baremo as unknown as Record<string, unknown>);

    if (sameScalars && sameBaremo) continue;

    historyRows.push({
      workOrderId: order.id,
      toStatus: order.status,
      note: `Actualización Actividades Baremo`,
      noteDetail: `Antes: TotalBaremo=${existing.totalBarSum ?? ""}; Resultado=${existing.ansCalc ?? ""} | Después: TotalBaremo=${row.totalBarSum}; Resultado=${ansCalc ?? ""}`,
      changedById: input.userId
    });
  }

  for (const group of chunk(historyRows, 100)) {
    if (group.length === 0) continue;
    await withRetry(() => prisma.workOrderHistory.createMany({ data: group }));
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: successCount, errors: errorCount });
  }

  return {
    message: `Actividades Baremo: ${createdCount} creadas, ${updatedCount} actualizadas, ${unchangedCount} sin cambios.`,
    count: successCount,
    updated: updatedCount,
    created: createdCount,
    unchanged: unchangedCount,
    errors: errorCount,
    errorDetails: rowErrors
  };
}

async function processRecorridoIncrementosJob(input: {
  data: Record<string, unknown>[];
  userId: string;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let successCount = 0;
  let errorCount = 0;
  const rowErrors: string[] = [];
  const debugSample: Array<{
    fila: number;
    orden: string;
    nombreIncremento: string;
    motivo: string;
    fechaInicioRaw: string;
    fechaFinRaw: string;
    inicioKey: string;
    finKey: string;
    inicioEnCalendar: boolean;
    finEnCalendar: boolean;
  }> = [];

  const asRawStr = (v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    return String(v ?? "");
  };

  const normalizeHeader = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  const getVal = (row: Record<string, unknown>, name: string) => {
    const target = normalizeHeader(name);
    const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
    return key ? row[key] : undefined;
  };

  const parseDate = (val: unknown) => {
    return parseDateCandidatesWithSwap(val)[0] ?? null;
  };

  const parseIntSafe = (val: unknown) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return Number.isFinite(val) ? Math.trunc(val) : null;
    const str = String(val).trim();
    if (!str) return null;
    const normalized = str.replace(/[^\d-]/g, "");
    const n = parseInt(normalized, 10);
    return Number.isFinite(n) ? n : null;
  };

  const parseBool = (val: unknown) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "boolean") return val;
    const s = String(val).trim().toLowerCase();
    if (!s) return null;
    if (["1", "true", "si", "sí", "s", "y", "yes"].includes(s)) return true;
    if (["0", "false", "no", "n"].includes(s)) return false;
    return null;
  };

  const stableStringify = (obj: Record<string, unknown>) => {
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = obj[k];
    return JSON.stringify(out);
  };

  const chunk = <T,>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const withRetry = async <T,>(fn: () => Promise<T>) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retryable =
          msg.toLowerCase().includes("database is locked") ||
          msg.toLowerCase().includes("socket timeout") ||
          msg.toLowerCase().includes("busy") ||
          msg.toLowerCase().includes("too many sql variables");
        if (!retryable || attempt === 2) throw e;
        await sleep(400 * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  };

  try {
    await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 60000");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    writeLog(`WARN: No se pudo configurar busy_timeout: ${msg}`);
  }

  const calendarRows = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const calendarInicioMap = new Map<string, number>();
  const calendarFinMap = new Map<string, number>();
  for (const r of calendarRows) {
    const key = calendarKey(r.date);
    calendarInicioMap.set(key, r.dayNumber);
    calendarFinMap.set(key, r.dayNumberFin ?? r.dayNumber);
  }

  const normalizeTransition = (value: string) =>
    value
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  const responsableMap: Record<string, string> = {
    "DE IGD A INL": "OCA",
    "DE INL A IGD": "OCA",
    "DE INL A PME": "OCA",
    IGD: "OCA",
    DEL: "OCA/ENEL",
    INL: "OCA/ENEL",
    PME: "ENEL",
    "DE ERR A ESE": "ENEL",
    "DE IGD A DEL": "ENEL",
    "DE IGD A ERR": "ENEL",
    "DE IGD A ESE": "ENEL",
    "DE IGD A NOI": "ENEL",
    "DE IGD A PME": "ENEL",
    "DE INL A DEL": "ENEL",
    "DE INL A ERR": "ENEL",
    "DE INL A ESE": "ENEL",
    "DE INL A NOI": "ENEL",
    "DE PME A DEL": "ENEL",
    "DE PME A ERR": "ENEL",
    "DE PME A ESE": "ENEL",
    "DE PME A IGD": "ENEL",
    "DE PME A INL": "ENEL",
    ESE: "ENEL",
    NOI: "ENEL",
    "DE DEL A NOI": "NA",
    "DE ESE A NOI": "NA",
    "DE ESE A PME": "ENEL",
    "0": "NA"
  };

  const computeDias = (inicio: Date, fin: Date) => {
    const iKey = bogotaDateKey(inicio);
    const fKey = bogotaDateKey(fin);
    const iNum = calendarInicioMap.get(iKey);
    const fNum = calendarFinMap.get(fKey);
    if (iNum === undefined || fNum === undefined) return null;
    const cutoffMinutes = 17 * 60;
    const finMinutes = bogotaMinutes(fin);
    const extraDay = finMinutes > cutoffMinutes ? 1 : 0;
    const sameDay = iKey === fKey;
    const base = sameDay && finMinutes < cutoffMinutes ? 0 : Math.max(0, fNum - iNum + extraDay);
    return Math.max(0, base);
  };

  const latestByKey = new Map<
    string,
    {
      orderCode: string;
      tipo: string | null;
      origen: string | null;
      estOrigenEstLlegada: string | null;
      responsable: string | null;
      nombreIncremento: string;
      csStatus: string | null;
      fechaSolicitud: Date | null;
      fechaAsignacion: Date | null;
      fechaGestion: Date | null;
      estadoAnterior: string | null;
      estadoActual: string | null;
      fechaInicio: Date;
      fechaFin: Date | null;
      cantidadIncrementos: number | null;
      flagFechaFin: boolean | null;
      diasEnel: number | null;
    }
  >();

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const orderCode = (getVal(row, "Orden de Trabajo") ?? getVal(row, "Orden") ?? getVal(row, "Orden de trabajo"))?.toString().trim();
      const nombreIncremento = (getVal(row, "Nombre Incremento") ?? getVal(row, "Nombre incremento"))?.toString().trim();
      const { inicio: fechaInicio, fin: fechaFin } = pickBestDatePairByCalendar(
        getVal(row, "FECHA_INICIO"),
        getVal(row, "FECHA_FIN"),
        calendarInicioMap,
        calendarFinMap
      );

      if (!orderCode) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta Orden de Trabajo`);
        continue;
      }
      const orderNum = parseInt(orderCode.replace(/\D/g, ""));
      if (isNaN(orderNum) || orderNum <= 3000000) continue;

      if (!nombreIncremento) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta Nombre Incremento (${orderCode})`);
        continue;
      }
      if (!fechaInicio) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta FECHA_INICIO (${orderCode})`);
        continue;
      }

      const tipo = (getVal(row, "Tipo") ?? "").toString().trim() || null;
      const origen = (getVal(row, "Origen") ?? "").toString().trim() || null;
      const csStatus = (getVal(row, "CS_STATUS") ?? "").toString().trim() || null;
      const fechaSolicitud = parseDate(getVal(row, "Fecha solicitud"));
      const fechaAsignacion =
        parseDate(getVal(row, "Fecha asignación")) ??
        parseDate(getVal(row, "Fecha asignacion")) ??
        parseDate(getVal(row, "Fecha asignaciÃ³n"));
      const fechaGestion =
        parseDate(getVal(row, "Fecha gestión")) ??
        parseDate(getVal(row, "Fecha gestion")) ??
        parseDate(getVal(row, "Fecha gestiÃ³n"));
      const estadoAnterior = (getVal(row, "ESTADO_ANTERIOR") ?? "").toString().trim() || null;
      const estadoActual = (getVal(row, "ESTADO_ACTUAL") ?? "").toString().trim() || null;
      const cantidadIncrementos = parseIntSafe(getVal(row, "Cantidad Incrementos"));
      const flagFechaFin = parseBool(getVal(row, "FLAG_FECHA_FIN"));

      const rawTrans = (getVal(row, "Est_origen_Est_llegada") ?? getVal(row, "Est_origen_Est_llegada ") ?? "").toString().trim();
      const derivedTrans = rawTrans || (estadoAnterior && estadoActual ? `de ${estadoAnterior} a ${estadoActual}` : estadoActual || estadoAnterior || "0");
      const estOrigenEstLlegada = derivedTrans ? normalizeTransition(derivedTrans) : null;
      const responsable = estOrigenEstLlegada ? responsableMap[estOrigenEstLlegada] ?? "NA" : null;
      const computedDiasEnel = responsable === "ENEL" && fechaFin ? computeDias(fechaInicio, fechaFin) : null;
      const diasEnel = computedDiasEnel;
      if (responsable === "ENEL" && fechaFin && computedDiasEnel === null && debugSample.length < 50) {
        const inicioKey = bogotaDateKey(fechaInicio);
        const finKey = bogotaDateKey(fechaFin);
        debugSample.push({
          fila: i + 1,
          orden: orderCode,
          nombreIncremento,
          motivo: "No se pudo calcular dias (Calendar no tiene inicio o fin)",
          fechaInicioRaw: asRawStr(getVal(row, "FECHA_INICIO")),
          fechaFinRaw: asRawStr(getVal(row, "FECHA_FIN")),
          inicioKey,
          finKey,
          inicioEnCalendar: calendarInicioMap.has(inicioKey),
          finEnCalendar: calendarFinMap.has(finKey)
        });
      }

      const key = `${orderCode}||${nombreIncremento}||${fechaInicio.toISOString()}`;
      latestByKey.set(key, {
        orderCode,
        tipo,
        origen,
        estOrigenEstLlegada,
        responsable,
        nombreIncremento,
        csStatus,
        fechaSolicitud,
        fechaAsignacion,
        fechaGestion,
        estadoAnterior,
        estadoActual,
        fechaInicio,
        fechaFin,
        cantidadIncrementos,
        flagFechaFin,
        diasEnel
      });

      successCount++;
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 2000 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: successCount, errors: errorCount });
    }
  }

  const codes = [...new Set([...latestByKey.values()].map((v) => v.orderCode))];
  const existingRows = codes.length
    ? await prisma.recorridoIncremento.findMany({
        where: { orderCode: { in: codes } },
        select: {
          orderCode: true,
          tipo: true,
          origen: true,
          estOrigenEstLlegada: true,
          responsable: true,
          nombreIncremento: true,
          csStatus: true,
          fechaSolicitud: true,
          fechaAsignacion: true,
          fechaGestion: true,
          estadoAnterior: true,
          estadoActual: true,
          fechaInicio: true,
          fechaFin: true,
          cantidadIncrementos: true,
          flagFechaFin: true,
          diasEnel: true
        }
      })
    : [];

  const existingMap = new Map<string, (typeof existingRows)[number]>();
  for (const r of existingRows) {
    const key = `${r.orderCode}||${r.nombreIncremento}||${r.fechaInicio.toISOString()}`;
    existingMap.set(key, r);
  }

  const unionLen = (intervals: Array<[number, number]>) => {
    const sorted = intervals
      .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
      .sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) return 0;
    let total = 0;
    let [cs, ce] = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const [s, e] = sorted[i];
      if (s <= ce) ce = Math.max(ce, e);
      else {
        total += ce - cs;
        cs = s;
        ce = e;
      }
    }
    total += ce - cs;
    return total;
  };

  const computeEnelUnionSumByOrder = <
    T extends {
      orderCode: string;
      nombreIncremento: string;
      fechaInicio: Date;
      responsable: string | null;
      diasEnel: number | null;
    },
  >(
    rows: T[]
  ) => {
    const byOrderAndInc = new Map<string, Array<[number, number]>>();
    for (const r of rows) {
      if (r.responsable !== "ENEL") continue;
      if (r.diasEnel == null) continue;
      const iKey = bogotaDateKey(r.fechaInicio);
      const startNum = calendarInicioMap.get(iKey);
      if (startNum === undefined) continue;
      const endNum = startNum + r.diasEnel;
      const key = `${r.orderCode}||${r.nombreIncremento}`;
      const arr = byOrderAndInc.get(key) ?? [];
      arr.push([startNum, endNum]);
      byOrderAndInc.set(key, arr);
    }
    const sumByOrder = new Map<string, number>();
    for (const [key, intervals] of byOrderAndInc.entries()) {
      const orderCode = key.split("||")[0] ?? "";
      if (!orderCode) continue;
      const raw = unionLen(intervals);
      const val = raw === 0 && intervals.length > 0 ? 1 : raw;
      sumByOrder.set(orderCode, (sumByOrder.get(orderCode) ?? 0) + val);
    }
    return sumByOrder;
  };

  const existingEnelSumByOrder = computeEnelUnionSumByOrder(existingRows);

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const creates: Array<Prisma.RecorridoIncrementoCreateManyInput> = [];
  const updates: Array<{ key: { orderCode: string; nombreIncremento: string; fechaInicio: Date }; data: Prisma.RecorridoIncrementoUpdateInput }> = [];

  for (const [key, row] of latestByKey.entries()) {
    const existing = existingMap.get(key);
    const newData = {
      orderCode: row.orderCode,
      tipo: row.tipo,
      origen: row.origen,
      estOrigenEstLlegada: row.estOrigenEstLlegada,
      responsable: row.responsable,
      nombreIncremento: row.nombreIncremento,
      csStatus: row.csStatus,
      fechaSolicitud: row.fechaSolicitud,
      fechaAsignacion: row.fechaAsignacion,
      fechaGestion: row.fechaGestion,
      estadoAnterior: row.estadoAnterior,
      estadoActual: row.estadoActual,
      fechaInicio: row.fechaInicio,
      fechaFin: row.fechaFin,
      cantidadIncrementos: row.cantidadIncrementos,
      flagFechaFin: row.flagFechaFin,
      diasEnel: row.diasEnel
    };

    if (!existing) {
      creates.push(newData);
      createdCount++;
      continue;
    }

    const before = {
      tipo: existing.tipo,
      origen: existing.origen,
      estOrigenEstLlegada: existing.estOrigenEstLlegada,
      responsable: existing.responsable,
      csStatus: existing.csStatus,
      fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
      fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
      fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
      estadoAnterior: existing.estadoAnterior,
      estadoActual: existing.estadoActual,
      fechaFin: existing.fechaFin ? existing.fechaFin.toISOString() : null,
      cantidadIncrementos: existing.cantidadIncrementos,
      flagFechaFin: existing.flagFechaFin,
      diasEnel: existing.diasEnel
    };
    const after = {
      tipo: newData.tipo,
      origen: newData.origen,
      estOrigenEstLlegada: newData.estOrigenEstLlegada,
      responsable: newData.responsable,
      csStatus: newData.csStatus,
      fechaSolicitud: newData.fechaSolicitud ? newData.fechaSolicitud.toISOString() : null,
      fechaAsignacion: newData.fechaAsignacion ? newData.fechaAsignacion.toISOString() : null,
      fechaGestion: newData.fechaGestion ? newData.fechaGestion.toISOString() : null,
      estadoAnterior: newData.estadoAnterior,
      estadoActual: newData.estadoActual,
      fechaFin: newData.fechaFin ? newData.fechaFin.toISOString() : null,
      cantidadIncrementos: newData.cantidadIncrementos,
      flagFechaFin: newData.flagFechaFin,
      diasEnel: newData.diasEnel
    };

    if (stableStringify(before) === stableStringify(after)) {
      unchangedCount++;
      continue;
    }

    updates.push({
      key: { orderCode: row.orderCode, nombreIncremento: row.nombreIncremento, fechaInicio: row.fechaInicio },
      data: newData
    });
    updatedCount++;
  }

  for (const group of chunk(creates, 50)) {
    if (group.length === 0) continue;
    await withRetry(() => prisma.recorridoIncremento.createMany({ data: group }));
  }

  for (const group of chunk(updates, 20)) {
    if (group.length === 0) continue;
    const ops = group.map((u) =>
      prisma.recorridoIncremento.update({
        where: {
          orderCode_nombreIncremento_fechaInicio: {
            orderCode: u.key.orderCode,
            nombreIncremento: u.key.nombreIncremento,
            fechaInicio: u.key.fechaInicio
          }
        },
        data: u.data
      })
    );
    await withRetry(() => prisma.$transaction(ops));
  }

  const newRows = codes.length
    ? await prisma.recorridoIncremento.findMany({
        where: { orderCode: { in: codes }, responsable: "ENEL", diasEnel: { not: null } },
        select: { orderCode: true, nombreIncremento: true, fechaInicio: true, fechaFin: true, diasEnel: true, responsable: true }
      })
    : [];

  const newEnelSumByOrder = computeEnelUnionSumByOrder(newRows);
  const enelWindowByOrder = new Map<string, { fechaInicio: string | null; fechaFin: string | null }>();
  for (const r of newRows) {
    if (r.fechaFin == null) continue;
    const inicio = r.fechaInicio ? new Date(r.fechaInicio).toISOString() : null;
    const fin = r.fechaFin ? new Date(r.fechaFin).toISOString() : null;
    if (!inicio || !fin) continue;
    const curr = enelWindowByOrder.get(r.orderCode) ?? { fechaInicio: null, fechaFin: null };
    const nextInicio =
      !curr.fechaInicio || new Date(inicio).getTime() < new Date(curr.fechaInicio).getTime() ? inicio : curr.fechaInicio;
    const nextFin = !curr.fechaFin || new Date(fin).getTime() > new Date(curr.fechaFin).getTime() ? fin : curr.fechaFin;
    enelWindowByOrder.set(r.orderCode, { fechaInicio: nextInicio, fechaFin: nextFin });
  }

  if (codes.length > 0) {
    const orders = await prisma.workOrder.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, status: true }
    });
    const orderIdMap = new Map(orders.map((o) => [o.code, o]));

    const existingHistory = await prisma.workOrderHistory.findMany({
      where: { workOrderId: { in: orders.map((o) => o.id) }, note: "Recorrido Incrementos (ENEL)" },
      orderBy: { changedAt: "desc" },
      select: { id: true, workOrderId: true }
    });
    const latestHistoryByWorkOrderId = new Map<string, string>();
    for (const h of existingHistory) {
      if (!latestHistoryByWorkOrderId.has(h.workOrderId)) latestHistoryByWorkOrderId.set(h.workOrderId, h.id);
    }

    const creates: Array<Prisma.WorkOrderHistoryCreateManyInput> = [];
    const updates: Array<{ id: string; data: Prisma.WorkOrderHistoryUpdateInput }> = [];

    for (const orderCode of codes) {
      const o = orderIdMap.get(orderCode);
      if (!o) continue;
      const window = enelWindowByOrder.get(orderCode);
      if (!window?.fechaInicio || !window?.fechaFin) continue;

      const before = existingEnelSumByOrder.get(orderCode) ?? 0;
      const after = newEnelSumByOrder.get(orderCode) ?? 0;
      const noteDetail = `DiasENEL=${after}; Antes=${before}`;

      const existingId = latestHistoryByWorkOrderId.get(o.id);
      if (existingId) {
        updates.push({
          id: existingId,
          data: {
            toStatus: o.status,
            noteDetail,
            fechaInicio: window.fechaInicio,
            fechaFin: window.fechaFin,
            changedBy: { connect: { id: input.userId } }
          }
        });
      } else {
        creates.push({
          workOrderId: o.id,
          toStatus: o.status,
          note: "Recorrido Incrementos (ENEL)",
          noteDetail,
          fechaInicio: window.fechaInicio,
          fechaFin: window.fechaFin,
          changedById: input.userId
        });
      }
    }

    for (const group of chunk(creates, 200)) {
      if (group.length === 0) continue;
      await withRetry(() => prisma.workOrderHistory.createMany({ data: group }));
    }
    for (const group of chunk(updates, 50)) {
      if (group.length === 0) continue;
      await withRetry(() =>
        prisma.$transaction(group.map((u) => prisma.workOrderHistory.update({ where: { id: u.id }, data: u.data })))
      );
    }
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: successCount, errors: errorCount });
  }

  return {
    message: `Recorrido Incrementos: ${createdCount} creadas, ${updatedCount} actualizadas, ${unchangedCount} sin cambios.`,
    count: successCount,
    updated: updatedCount,
    created: createdCount,
    unchanged: unchangedCount,
    errors: errorCount,
    errorDetails: rowErrors,
    debugSample
  };
}

async function processLevantamientoJob(input: {
  data: Record<string, unknown>[];
  userId: string;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let successCount = 0;
  let errorCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const rowErrors: string[] = [];

  const normalizeHeader = (value: string) =>
    value
      .split("\u0000")
      .join("")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  const getVal = (row: Record<string, unknown>, name: string) => {
    const target = normalizeHeader(name);
    const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
    return key ? row[key] : undefined;
  };

  const getValAny = (row: Record<string, unknown>, names: string[]) => {
    for (const n of names) {
      const v = getVal(row, n);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const parseText = (val: unknown) => {
    if (val === null || val === undefined) return null;
    const s = String(val).split("\u0000").join("").trim();
    return s ? s : null;
  };

  const parseDate = (val: unknown) => parseFlexibleDateCandidates(val)[0] ?? null;

  const codes = input.data
    .map((row) => parseText(getValAny(row, ["Orden Trabajo", "Orden de Trabajo", "Orden", "Orden trabajo"])))
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const existing = new Set<string>();
  const existingOrders = new Set<string>();
  const chunk = <T,>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const uniqueCodes = [...new Set(codes)];
  for (const group of chunk(uniqueCodes, 500)) {
    const rows = await prisma.levantamiento.findMany({
      where: { orderCode: { in: group } },
      select: { orderCode: true }
    });
    for (const r of rows) existing.add(r.orderCode);
  }

  for (const group of chunk(uniqueCodes, 500)) {
    const rows = await prisma.workOrder.findMany({
      where: { code: { in: group } },
      select: { code: true }
    });
    for (const r of rows) existingOrders.add(r.code);
  }

  const missingOrders = uniqueCodes.filter((c) => !existingOrders.has(c));
  for (const group of chunk(missingOrders, 500)) {
    if (group.length === 0) continue;
    await prisma.workOrder.createMany({
      data: group.map((code) => ({
        code,
        title: `OT ${code}`,
        status: "CREATED",
        createdById: input.userId
      })),
      skipDuplicates: true
    });
    for (const c of group) existingOrders.add(c);
  }

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const orderCode = parseText(getValAny(row, ["Orden Trabajo", "Orden de Trabajo", "Orden", "Orden trabajo"]));
      if (!orderCode) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta Orden Trabajo`);
        continue;
      }

      const payload = {
        nivelTension: parseText(getValAny(row, ["Nivel de Tensión", "Nivel de Tension", "Nivel de tensiÃ³n"])),
        tipo: parseText(getVal(row, "Tipo")),
        unidadSolicitante: parseText(getVal(row, "Unidad Solicitante")),
        proyecto: parseText(getVal(row, "Proyecto")),
        estado: parseText(getVal(row, "Estado")),
        subestado: parseText(getValAny(row, ["Subestado", "Sub Estado"])),
        subestacion: parseText(getValAny(row, ["Subestación", "Subestacion", "SubestaciÃ³n"])),
        circuito: parseText(getVal(row, "Circuito")),
        noCd: parseText(getValAny(row, ["No Cd", "No CD", "No. Cd", "No. CD", "NoCd"])),
        direccion: parseText(getValAny(row, ["Direccion", "Dirección", "DirecciÃ³n"])),
        municipio: parseText(getVal(row, "Municipio")),
        zona: parseText(getVal(row, "Zona")),
        alcance: parseText(getVal(row, "Alcance")),
        fechaSolicitud: parseDate(getValAny(row, ["Fecha Solicitud", "Fecha solicitud"])),
        fechaAprobacionAlcanceSt: parseDate(getValAny(row, ["Fecha Aprobación Alcance ST", "Fecha Aprobacion Alcance ST"])),
        fechaEstimacionCostos: parseDate(getValAny(row, ["Fecha Estimación de Costos", "Fecha Estimacion de Costos"])),
        fechaAprobacionValorizacionSt: parseDate(
          getValAny(row, ["Fecha Aprobación Valorización ST", "Fecha Aprobacion Valorizacion ST", "Fecha Aprobación Valorizacion ST"])
        ),
        fechaPrevalidacion: parseDate(getValAny(row, ["Fecha Prevalidación", "Fecha Prevalidacion"])),
        fechaAsignacion: parseDate(getValAny(row, ["Fecha Asignación", "Fecha Asignacion", "Fecha asignaciÃ³n"])),
        fechaPrimerElemento: parseDate(getValAny(row, ["Fecha Primer Elemento", "Fecha primer elemento"])),
        fechaEntregaPostproceso: parseDate(getValAny(row, ["Fecha Entrega Postproceso", "Fecha entrega postproceso"])),
        fechaAprobacionPostproceso: parseDate(getValAny(row, ["Fecha Aprobacion Postproceso", "Fecha Aprobación Postproceso"])),
        fechaGestion: parseDate(getValAny(row, ["Fecha Gestión", "Fecha Gestion", "Fecha gestiÃ³n"])),
        fechaDevolucion: parseDate(getValAny(row, ["Fecha Devolución", "Fecha Devolucion"])),
        usuarioSolicitante: parseText(getValAny(row, ["Usuario Solicitante", "Usuario solicitante"])),
        usuarioAsigna: parseText(getValAny(row, ["Usuario Asigna", "Usuario asigna"])),
        gestor: parseText(getValAny(row, ["Gestor", "Gestor "])),
        observacionGestor: parseText(getValAny(row, ["Observación Gestor", "Observacion Gestor"])),
        cuadrilla: parseText(getVal(row, "Cuadrilla"))
      };

      const { fechaEntregaPostproceso, ...payloadBase } = payload;
      const updatePayload = {
        ...payloadBase,
        ...(fechaEntregaPostproceso ? { fechaEntregaPostproceso } : {})
      };

      const existed = existing.has(orderCode);
      await prisma.levantamiento.upsert({
        where: { orderCode },
        create: { orderCode, ...payload },
        update: updatePayload
      });

      successCount++;
      if (existed) updatedCount++;
      else {
        createdCount++;
        existing.add(orderCode);
      }
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 500 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: successCount, errors: errorCount });
    }
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: successCount, errors: errorCount });
  }

  return {
    message: `Levantamiento: ${createdCount} creadas, ${updatedCount} actualizadas.`,
    count: successCount,
    updated: updatedCount,
    created: createdCount,
    errors: errorCount,
    errorDetails: rowErrors
  };
}

async function processEntregaLevantamientoJob(input: {
  data: Record<string, unknown>[];
  userId: string;
  onProgress?: (progress: { rows: number; success: number; errors: number }) => Promise<void>;
}) {
  let successCount = 0;
  let errorCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const rowErrors: string[] = [];

  const normalizeHeader = (value: string) =>
    value
      .split("\u0000")
      .join("")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  const getVal = (row: Record<string, unknown>, name: string) => {
    const target = normalizeHeader(name);
    const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
    return key ? row[key] : undefined;
  };

  const getValAny = (row: Record<string, unknown>, names: string[]) => {
    for (const n of names) {
      const v = getVal(row, n);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const parseText = (val: unknown) => {
    if (val === null || val === undefined) return null;
    const s = String(val).split("\u0000").join("").trim();
    return s ? s : null;
  };

  const buildEntregaKey = (tipoOt: string | null, entrega: string | null) => {
    const t = (tipoOt ?? "").trim();
    const e = (entrega ?? "").trim();
    if (!t || !e) return null;
    const prefix = t.slice(0, 4).toUpperCase();
    return `${prefix}_${e}`;
  };

  const codes = input.data
    .map((row) => parseText(getValAny(row, ["CLONADA", "Clonada"])))
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const uniqueCodes = [...new Set(codes)];
  const existingOrders = new Set<string>();
  const existingLevantamientos = new Set<string>();
  const chunk = <T,>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  for (const group of chunk(uniqueCodes, 500)) {
    const rows = await prisma.workOrder.findMany({
      where: { code: { in: group } },
      select: { code: true }
    });
    for (const r of rows) existingOrders.add(r.code);
  }

  const missingOrders = uniqueCodes.filter((c) => !existingOrders.has(c));
  for (const group of chunk(missingOrders, 500)) {
    if (group.length === 0) continue;
    await prisma.workOrder.createMany({
      data: group.map((code) => ({
        code,
        title: `OT ${code}`,
        status: "CREATED",
        createdById: input.userId
      })),
      skipDuplicates: true
    });
    for (const c of group) existingOrders.add(c);
  }

  for (const group of chunk(uniqueCodes, 500)) {
    const rows = await prisma.levantamiento.findMany({
      where: { orderCode: { in: group } },
      select: { orderCode: true }
    });
    for (const r of rows) existingLevantamientos.add(r.orderCode);
  }

  for (let i = 0; i < input.data.length; i++) {
    const row = input.data[i];
    try {
      const orderCode = parseText(getValAny(row, ["CLONADA", "Clonada"]));
      if (!orderCode) {
        errorCount++;
        rowErrors.push(`Fila ${i + 1}: Falta CLONADA`);
        continue;
      }

      const entrega = parseText(getValAny(row, ["Entrega", "ENTREGA"]));
      const tipoOt = parseText(getValAny(row, ["TIPO OT.", "TIPO OT", "Tipo OT.", "Tipo OT"]));
      const entregaKey = buildEntregaKey(tipoOt, entrega);

      const createData = {
        orderCode,
        ...(entrega ? { entregaLevantamiento: entrega } : {}),
        ...(tipoOt ? { tipoOtLevantamiento: tipoOt } : {}),
        ...(entregaKey ? { entregaKeyLevantamiento: entregaKey } : {})
      };

      const updateData = {
        ...(entrega ? { entregaLevantamiento: entrega } : {}),
        ...(tipoOt ? { tipoOtLevantamiento: tipoOt } : {}),
        ...(entregaKey ? { entregaKeyLevantamiento: entregaKey } : {})
      };

      const existed = existingLevantamientos.has(orderCode);
      await prisma.levantamiento.upsert({
        where: { orderCode },
        create: createData,
        update: updateData
      });

      successCount++;
      if (existed) updatedCount++;
      else {
        createdCount++;
        existingLevantamientos.add(orderCode);
      }
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      rowErrors.push(`Error en fila ${i + 1}: ${msg}`);
    }

    if ((i + 1) % 500 === 0 && input.onProgress) {
      await input.onProgress({ rows: i + 1, success: successCount, errors: errorCount });
    }
  }

  if (input.onProgress) {
    await input.onProgress({ rows: input.data.length, success: successCount, errors: errorCount });
  }

  return {
    message: `Entrega Levantamiento: ${createdCount} creadas, ${updatedCount} actualizadas.`,
    count: successCount,
    updated: updatedCount,
    created: createdCount,
    errors: errorCount,
    errorDetails: rowErrors
  };
}

async function runJob(jobId: string) {
  const claimed = await claimJob(jobId);
  if (!claimed) return;

  const job = await getJobForProcess(jobId);
  if (!job) return;

  try {
    const bytes = Buffer.from(job.fileBytes);
    const ext = path.extname((job.fileName ?? "").trim().toLowerCase());

    if (job.type === "ACTUALIZACION") {
      const result =
        ext === ".csv"
          ? await processActualizacionCsvFile({
              fileBytes: bytes,
              userId: job.createdById,
              cleanupMissing: job.cleanupMissing,
              onProgress: (p) => updateJobProgress(jobId, p)
            })
          : await processActualizacion({
              data: await loadRowsFromBytes({ fileName: job.fileName, type: job.type, bytes }),
              userId: job.createdById,
              cleanupMissing: job.cleanupMissing
            });

      await finishJob(jobId, { ok: true, result });
      return;
    }

    const data = await loadRowsFromBytes({ fileName: job.fileName, type: job.type, bytes });

    const result =
      job.type === "DEVOLUCIONES"
        ? await processDevolucionesJob({ data, userId: job.createdById, onProgress: (p) => updateJobProgress(jobId, p) })
        : job.type === "CALENDARIO"
          ? await processCalendarioJob({ data, onProgress: (p) => updateJobProgress(jobId, p) })
          : job.type === "ACTIVIDADES_BAREMO"
            ? await processActividadesBaremoJob({
                data,
                userId: job.createdById,
                onProgress: (p) => updateJobProgress(jobId, p)
              })
            : job.type === "RECORRIDO_INCREMENTOS"
              ? await processRecorridoIncrementosJob({
                  data,
                  userId: job.createdById,
                  onProgress: (p) => updateJobProgress(jobId, p)
                })
              : job.type === "LEVANTAMIENTO"
                ? await processLevantamientoJob({
                    data,
                    userId: job.createdById,
                    onProgress: (p) => updateJobProgress(jobId, p)
                  })
              : job.type === "ENTREGA_LEVANTAMIENTO"
                ? await processEntregaLevantamientoJob({
                    data,
                    userId: job.createdById,
                    onProgress: (p) => updateJobProgress(jobId, p)
                  })
              : (() => {
                  throw new Error("UNSUPPORTED_JOB_TYPE");
                })();

    await finishJob(jobId, { ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNKNOWN";
    await finishJob(jobId, { ok: false, error: msg });
  }
}

carguesRouter.get("/jobs/:id", requireAuth, requirePermission("CARGUES"), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const job = await getJobForRead(id);
  if (!job) {
    res.status(404).json({ error: "JOB_NOT_FOUND" });
    return;
  }
  if (req.auth?.role !== "ADMIN" && job.createdById !== req.auth?.sub) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }

  if (job.status === CargueJobStatus.QUEUED) {
    setImmediate(() => {
      runJob(id).catch(() => {
      });
    });
  } else if (job.status === CargueJobStatus.RUNNING) {
    const updatedAt = new Date(job.updatedAt).getTime();
    if (!Number.isNaN(updatedAt) && Date.now() - updatedAt > 5 * 60 * 1000) {
      await prisma.cargueJob.updateMany({
        where: { id, status: CargueJobStatus.RUNNING },
        data: { status: CargueJobStatus.QUEUED, startedAt: null }
      });
      setImmediate(() => {
        runJob(id).catch(() => {
        });
      });
    }
  }

  res.json(job);
});

carguesRouter.post(
  "/upload",
  requireAuth,
  requirePermission("CARGUES"),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        const details =
          err.code === "LIMIT_FILE_SIZE"
            ? "El archivo excede el tamaño máximo permitido (100MB)."
            : err.message;
        writeLog(`ERROR: MulterError ${err.code} - ${details}`);
        res.status(413).json({ error: "UPLOAD_ERROR", details });
        return;
      }
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      writeLog(`ERROR: UploadError - ${msg}`);
      res.status(500).json({ error: "UPLOAD_ERROR", details: msg });
    });
  },
  async (req: Request, res: Response) => {
  let filePath: string | null = null;
  try {
    if (!req.file) {
      writeLog("ERROR: No se subió archivo");
      res.status(400).json({ error: "NO_FILE_UPLOADED" });
      return;
    }

    const { type } = req.body;
    const fileName = req.file.originalname;
    filePath = req.file.path;
    let data: Record<string, unknown>[] = [];

    writeLog(`INFO: Procesando ${fileName} (${type})`);

    const sizeBytes = typeof req.file.size === "number" ? req.file.size : 0;
    const sizeMb = Math.round((sizeBytes / (1024 * 1024)) * 10) / 10;
    const maxMb = type === "ACTIVIDADES_BAREMO" ? 100 : 50;
    if (sizeMb > maxMb) {
      writeLog(`ERROR: Archivo demasiado grande (${sizeMb}MB) para tipo ${type}. Máximo ${maxMb}MB.`);
      res.status(413).json({ error: "UPLOAD_ERROR", details: `El archivo excede el tamaño máximo permitido (${maxMb}MB) para este cargue.` });
      return;
    }
    const cleanupMissing = isTruthy((req.body as Record<string, unknown>)?.cleanupMissing, false);

    const asyncTypes = new Set([
      "ACTUALIZACION",
      "DEVOLUCIONES",
      "CALENDARIO",
      "ACTIVIDADES_BAREMO",
      "RECORRIDO_INCREMENTOS",
      "LEVANTAMIENTO",
      "ENTREGA_LEVANTAMIENTO"
    ]);
    if (asyncTypes.has(type) && isTruthy((req.body as Record<string, unknown>)?.async, true)) {
      const bytes = fs.readFileSync(filePath);
      const normalizedFileName = String(fileName ?? "").trim();
      const created = await createJob({
        userId: req.auth!.sub,
        type,
        fileName: normalizedFileName,
        fileMime: req.file.mimetype,
        fileSize: req.file.size,
        fileBytes: bytes,
        cleanupMissing
      });
      res.status(202).json({ jobId: created.id });

      setImmediate(() => {
        runJob(created.id).catch((err) => {
          void err;
        });
      });

      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        void err;
      }

      filePath = null;
      return;
    }

    data = await loadRowsFromFile({ filePath, fileName, type });

    if (type === "ACTUALIZACION") {
      const payload = await processActualizacion({ data, userId: req.auth!.sub, cleanupMissing });
      res.json(payload);
    } else if (type === "DEVOLUCIONES") {
      const userId = req.auth!.sub;
      let deletedCount = 0;
      let updatedCount = 0;
      let ignoredCount = 0;
      const rowErrors: string[] = [];

      writeLog(`INFO: Procesando archivo de Devoluciones: ${data.length} filas`);

      // DEVOLUCIONES (descuento por días)
      // - Solo procesa órdenes > 3.000.000
      // - Si el archivo indica "Estado secundario = DEVUELTA", marca la orden como DEVUELTA (y registra historial si aplica)
      // - Si existen Fecha Devolución y Fecha Respuesta:
      //   - inicioDev = Inicio(Fecha Devolución) desde el calendario
      //   - finRes = Fin(Fecha Respuesta) desde el calendario
      //   - Si la hora de la respuesta es > 17:00: finRes += 1 (equivalente a pasar al siguiente día del calendario)
      //   - Regla: solo se cuenta si Fecha Devolución > Fecha Asignación; si no, se omite
      //   - Se de-duplica por (fechaInicio, fechaFin) para no duplicar descuentos
      //
      // Nota: usamos Inicio para la fecha de devolución y Fin para la fecha de respuesta por definición del calendario (columnas Inicio/Fin).
      const calendar = await prisma.calendar.findMany();
      const calendarInicioMap = new Map<string, number>();
      const calendarFinMap = new Map<string, number>();
      const finNumberToDate = new Map<number, string>();
      calendar.forEach(c => {
        const key = calendarKey(c.date);
        calendarInicioMap.set(key, c.dayNumber);
        const finNum = c.dayNumberFin ?? c.dayNumber;
        calendarFinMap.set(key, finNum);
        finNumberToDate.set(finNum, key);
      });

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const getVal = (name: string) => {
            const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase());
            return key ? row[key] : undefined;
          };

          const code = (getVal("Orden Trabajo") || getVal("Orden de trabajo") || getVal("Orden"))?.toString().trim();
          const estadoSecundario = (getVal("Estado secundario") || getVal("Estado secundarios"))?.toString().trim().toUpperCase();

          if (!code) continue;

          // Regla: Solo procesar órdenes > 3.000.000
          const orderNum = parseInt(code.replace(/\D/g, ""));
          if (isNaN(orderNum) || orderNum <= 3000000) {
            writeLog(`INFO: Omitiendo fila de devolución para Orden ${code} por ser <= 3000000`);
            continue;
          }

          // Marcar como "DEVUELTA" si el archivo lo indica
          if (estadoSecundario === "DEVUELTA") {
            const now = new Date();
            const order = await prisma.workOrder.upsert({
              where: { code },
              update: {
                status: "DEVUELTA",
                estadoSecundario: "DEVUELTA",
                updatedAt: now
              },
              create: {
                code,
                title: `Orden ${code}`,
                description: "",
                status: "DEVUELTA",
                estadoSecundario: "DEVUELTA",
                createdById: userId,
                lastStatusChangeAt: now
              }
            });

            // Solo crear historial si no estaba ya en estado DEVUELTA
            const lastHistory = await prisma.workOrderHistory.findFirst({
              where: { workOrderId: order.id },
              orderBy: { changedAt: "desc" }
            });

            if (!lastHistory || lastHistory.toStatus !== "DEVUELTA") {
              await prisma.workOrderHistory.create({
                data: {
                  workOrderId: order.id,
                  toStatus: "DEVUELTA",
                  note: "Orden marcada como DEVUELTA desde el cargue de devoluciones",
                  changedById: userId
                }
              });
              writeLog(`INFO: Orden ${code} marcada como DEVUELTA (nuevo registro de historial)`);
            } else {
              writeLog(`INFO: Orden ${code} ya estaba marcada como DEVUELTA, omitiendo duplicado en historial`);
            }
            
            deletedCount++;
          }

          // Continuar con el análisis de fechas para el descuento (incluso si está devuelta)
          const fechaDevolucionVal = getVal("Fecha Devolución") || getVal("Fecha Devolucion");
          const fechaRespuestaVal = getVal("Fecha Respuesta");

          if (fechaDevolucionVal && fechaRespuestaVal) {
            const parseDate = (val: unknown) => {
              if (val instanceof Date) return val;
              if (val === null || val === undefined) return null;
              const str = String(val).trim();
              if (!str) return null;
              const d = new Date(str);
              if (!isNaN(d.getTime())) return d;
              const parts = str.split(/[/\s:]/);
              if (parts.length >= 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1;
                const year = parseInt(parts[2]);
                return new Date(year, month, day);
              }
              return null;
            };

            const dDev = parseDate(fechaDevolucionVal);
            const dRes = parseDate(fechaRespuestaVal);

            if (dDev && dRes) {
              const normalize = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
              const inicioDev = calendarInicioMap.get(normalize(dDev));
              let finRes = calendarFinMap.get(normalize(dRes));

              const isAfter1700 =
                dRes.getHours() > 17 ||
                (dRes.getHours() === 17 &&
                  (dRes.getMinutes() > 0 || dRes.getSeconds() > 0 || dRes.getMilliseconds() > 0));

              let fechaFinEfectiva = new Date(dRes);
              if (finRes !== undefined && isAfter1700) {
                finRes = finRes + 1;
                const effectiveDayIso = finNumberToDate.get(finRes);
                if (effectiveDayIso) {
                  const effectiveDay = new Date(effectiveDayIso);
                  effectiveDay.setHours(dRes.getHours(), dRes.getMinutes(), dRes.getSeconds(), dRes.getMilliseconds());
                  fechaFinEfectiva = effectiveDay;
                }
              }
              const fechaFinEfectivaIso = fechaFinEfectiva.toISOString();

              if (inicioDev !== undefined && finRes !== undefined) {
                const order = await prisma.workOrder.findUnique({ where: { code } });
                
                if (order) {
                  // Nueva validación: Fecha Devolución debe ser superior a Fecha Asignación
                  if (!order.assignedAt) {
                    writeLog(`INFO: Omitiendo descuento para Orden ${code} porque no tiene Fecha Asignación registrada (Fecha Devolución: ${dDev.toLocaleDateString()})`);
                    ignoredCount++;
                    continue;
                  }

                  const dAsig = order.assignedAt;
                  const normalizeAsig = new Date(dAsig.getFullYear(), dAsig.getMonth(), dAsig.getDate()).getTime();
                  const normalizeDev = new Date(dDev.getFullYear(), dDev.getMonth(), dDev.getDate()).getTime();

                  if (normalizeDev <= normalizeAsig) {
                    writeLog(`INFO: Omitiendo descuento para Orden ${code} porque Fecha Devolución (${dDev.toLocaleDateString()}) no es superior a Fecha Asignación (${dAsig.toLocaleDateString()})`);
                    ignoredCount++;
                    continue;
                  }

                  const diff = finRes - inicioDev;
                  if (diff <= 0) {
                    ignoredCount++;
                    continue;
                  }

                  const finDayPrefix = fechaFinEfectivaIso.slice(0, 10);

                  const existingDiscount = await prisma.workOrderHistory.findFirst({
                    where: {
                      workOrderId: order.id,
                      note: { contains: "Descuento por devolución" },
                      fechaInicio: dDev.toISOString(),
                      fechaFin: { startsWith: finDayPrefix }
                    }
                  });

                  if (existingDiscount) {
                    const nextNote = `Descuento por devolución: ${diff} días${isAfter1700 ? " (+1 por respuesta > 17:00)" : ""} (Fecha Devolución: ${dDev.toLocaleString()} - Fecha Respuesta: ${dRes.toLocaleString()})`;
                    if (existingDiscount.fechaFin !== fechaFinEfectivaIso || existingDiscount.note !== nextNote) {
                      await prisma.workOrderHistory.update({
                        where: { id: existingDiscount.id },
                        data: { fechaFin: fechaFinEfectivaIso, note: nextNote }
                      });
                    }
                    writeLog(`INFO: Omitiendo descuento duplicado para Orden ${code} (Fechas: ${dDev.toLocaleDateString()} - ${dRes.toLocaleDateString()})`);
                    ignoredCount++;
                    continue;
                  }

                  if (diff > 0) {
                    await prisma.workOrder.update({
                      where: { id: order.id },
                      data: {
                        diasDescuento: { increment: diff }
                      }
                    });

                    await prisma.workOrderHistory.create({
                      data: {
                        workOrderId: order.id,
                        toStatus: order.status,
                        fechaInicio: dDev.toISOString(),
                        fechaFin: fechaFinEfectivaIso,
                        note: `Descuento por devolución: ${diff} días${isAfter1700 ? " (+1 por respuesta > 17:00)" : ""} (Fecha Devolución: ${dDev.toLocaleString()} - Fecha Respuesta: ${dRes.toLocaleString()})`,
                        changedById: userId
                      }
                    });

                    updatedCount++;
                    writeLog(`INFO: Orden ${code} descontados ${diff} días`);
                  } else {
                    ignoredCount++;
                  }
                } else {
                  ignoredCount++;
                }
              } else {
                ignoredCount++;
              }
            } else {
              ignoredCount++;
            }
          } else {
            ignoredCount++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          rowErrors.push(`Error en fila ${i+1}: ${msg}`);
          writeLog(`ERROR: ${msg}`);
        }
      }

      writeLog(`INFO: Finalizado Devoluciones. Eliminadas: ${deletedCount}, Actualizadas: ${updatedCount}, Ignoradas: ${ignoredCount}`);
      res.json({ 
        message: `Proceso de Devoluciones finalizado. ${deletedCount} eliminadas, ${updatedCount} actualizadas.`,
        count: updatedCount,
        deleted: deletedCount,
        errors: rowErrors.length,
        errorDetails: rowErrors
      });
    } else if (type === "CALENDARIO") {
      let successCount = 0;
      let errorCount = 0;
      const rowErrors: string[] = [];

      writeLog(`INFO: Procesando archivo de Calendario: ${data.length} filas`);

      // CALENDARIO
      // - "Inicio" representa el número de día para cálculos que parten desde una fecha (ej. assignedAt, Fecha Devolución, FECHA_INICIO)
      // - "Fin" representa el número de día para cálculos que terminan en una fecha (ej. gestionAt, Fecha Respuesta, FECHA_FIN)
      // - dayNumberFin se guarda en DB como optional y si no existe se usa el mismo valor de Inicio (fallback)
      // - Se limpia y se vuelve a cargar completamente en cada cargue
      // Limpiar calendario actual
      await prisma.calendar.deleteMany({});

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const fechaVal =
            getRowVal(row, "fecha") ??
            getRowVal(row, "Fecha") ??
            (() => {
              const v = Object.values(row).find((x) => {
                const s = String(x ?? "").trim();
                if (!s) return false;
                return /^(\d{4})-(\d{2})-(\d{2})/.test(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.test(s);
              });
              return v;
            })();

          let inicioVal = getRowVal(row, "Incio") ?? getRowVal(row, "Inicio");
          let finVal = getRowVal(row, "Fin");
          if (inicioVal === undefined && finVal === undefined) {
            const picked = pickCalendarNumbersFromRow(row);
            inicioVal = picked.inicio ?? undefined;
            finVal = picked.fin ?? undefined;
          }

          const hasInicio = !(inicioVal === undefined || inicioVal === null || inicioVal === "");
          const hasFin = !(finVal === undefined || finVal === null || finVal === "");
          if (!fechaVal || (!hasInicio && !hasFin)) continue;

          let date: Date | null = null;
          if (fechaVal instanceof Date) {
            const key = bogotaDateKey(fechaVal);
            const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
            date = makeBogotaDate(y, m, d, 0, 0, 0);
          } else {
            const candidates = parseFlexibleDateCandidates(fechaVal);
            const picked = candidates[0] ?? null;
            if (picked) {
              const key = bogotaDateKey(picked);
              const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
              date = makeBogotaDate(y, m, d, 0, 0, 0);
            }
          }

          if (!date || isNaN(date.getTime())) {
            rowErrors.push(`Fila ${i+1}: Fecha inválida ${fechaVal}`);
            errorCount++;
            continue;
          }

          const normalizedKey = bogotaDateKey(date);
          const [ny, nm, nd] = normalizedKey.split("-").map((v) => parseInt(v, 10));
          const normalizedDate = makeBogotaDate(ny, nm, nd, 0, 0, 0);

          const parsedInicio = hasInicio ? parseIntLoose(inicioVal) : NaN;
          const parsedFin = hasFin ? parseIntLoose(finVal) : NaN;
          const dayNumber = Number.isFinite(parsedInicio) ? parsedInicio : parsedFin;
          const dayNumberFin = Number.isFinite(parsedFin) ? parsedFin : null;
          if (isNaN(dayNumber)) {
            rowErrors.push(`Fila ${i+1}: Inicio/Fin no es número (Inicio=${inicioVal ?? ""}, Fin=${finVal ?? ""})`);
            errorCount++;
            continue;
          }

          await prisma.calendar.upsert({
            where: { date: normalizedDate },
            update: { dayNumber, dayNumberFin },
            create: { date: normalizedDate, dayNumber, dayNumberFin }
          });
          successCount++;
        } catch (err) {
          errorCount++;
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          rowErrors.push(`Error en fila ${i+1}: ${msg}`);
        }
      }

      writeLog(`INFO: Finalizado Calendario. Éxitos: ${successCount}, Errores: ${errorCount}`);
      res.json({ 
        message: `Calendario actualizado: ${successCount} registros.`,
        count: successCount,
        errors: errorCount,
        errorDetails: rowErrors
      });
    } else if (type === "ACTIVIDADES_BAREMO") {
      let successCount = 0;
      let errorCount = 0;
      const rowErrors: string[] = [];

      writeLog(`INFO: Procesando archivo de Actividades Baremo: ${data.length} filas`);

      const normalizeHeader = (value: string) =>
        value
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ");

      const getVal = (row: Record<string, unknown>, name: string) => {
        const target = normalizeHeader(name);
        const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
        return key ? row[key] : undefined;
      };

      const parseNumber = (val: unknown) => {
        if (val === null || val === undefined) return null;
        if (typeof val === "number") return Number.isFinite(val) ? val : null;
        const str = String(val).trim();
        if (!str) return null;
        const normalized = str.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
      };

      const parseDate = (val: unknown) => {
        if (val instanceof Date) return val;
        if (val === null || val === undefined) return null;
        const str = String(val).trim();
        if (!str) return null;
        const d = new Date(str);
        if (!Number.isNaN(d.getTime())) return d;
        const parts = str.split(/[/\s:]/);
        if (parts.length >= 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          const year = parseInt(parts[2]);
          const hours = parts.length >= 4 ? parseInt(parts[3]) : 0;
          const minutes = parts.length >= 5 ? parseInt(parts[4]) : 0;
          const seconds = parts.length >= 6 ? parseInt(parts[5]) : 0;
          return new Date(year, month, day, hours, minutes, seconds);
        }
        return null;
      };

      const stableStringify = (obj: Record<string, unknown>) => {
        const keys = Object.keys(obj).sort();
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = obj[k];
        return JSON.stringify(out);
      };

      let createdCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      const allowedBars = new Set([
        1,2,4,5,6,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,86,87,88,89,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113
      ]);

      const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      try {
        await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 60000");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "UNKNOWN";
        writeLog(`WARN: No se pudo configurar busy_timeout: ${msg}`);
      }

      const latestByCodigo = new Map<string, {
        codigo: string;
        estado: string | null;
        tipo: string | null;
        origen: string | null;
        fechaSolicitud: Date | null;
        fechaAsignacion: Date | null;
        fechaGestion: Date | null;
        gestor: string | null;
        nivelTension: string | null;
        proyecto: string | null;
        actaFacturacion: string | null;
        nombreIncremento: string | null;
        estadoIncremento: string | null;
        total: number | null;
        totalConIva: number | null;
        totalBarSum: number;
        baremo: Record<string, number>;
      }>();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const codigo = (
            getVal(row, "Código") ??
            getVal(row, "Codigo") ??
            getVal(row, "CÃ³digo")
          )?.toString().trim();

          if (!codigo) {
            errorCount++;
            rowErrors.push(`Fila ${i + 1}: Falta Código`);
            continue;
          }

          const estado = (getVal(row, "Estado") ?? "").toString().trim() || null;
          const tipo = (getVal(row, "Tipo") ?? "").toString().trim() || null;
          const origen = (getVal(row, "Origen") ?? "").toString().trim() || null;

          const fechaSolicitud = parseDate(getVal(row, "Fecha solicitud"));
          const fechaAsignacion =
            parseDate(getVal(row, "Fecha asignación")) ??
            parseDate(getVal(row, "Fecha asignacion")) ??
            parseDate(getVal(row, "Fecha asignaciÃ³n"));
          const fechaGestion =
            parseDate(getVal(row, "Fecha gestión")) ??
            parseDate(getVal(row, "Fecha gestion")) ??
            parseDate(getVal(row, "Fecha gestiÃ³n"));

          const gestor = (getVal(row, "Gestor") ?? "").toString().trim() || null;
          const nivelTension =
            (getVal(row, "Nivel de tensión") ??
              getVal(row, "Nivel de tension") ??
              getVal(row, "Nivel de tensiÃ³n") ??
              "")?.toString().trim() || null;
          const proyecto = (getVal(row, "Proyecto") ?? "").toString().trim() || null;
          const actaFacturacion =
            (getVal(row, "Acta facturación") ??
              getVal(row, "Acta facturacion") ??
              getVal(row, "Acta facturaciÃ³n") ??
              "")?.toString().trim() || null;
          const nombreIncremento = (getVal(row, "Nombre incremento") ?? "").toString().trim() || null;
          const estadoIncremento = (getVal(row, "Estado incremento") ?? "").toString().trim() || null;
          const total = parseNumber(getVal(row, "Total"));
          const totalConIva =
            parseNumber(getVal(row, "Total con IVA")) ??
            parseNumber(getVal(row, "Total con Iva")) ??
            parseNumber(getVal(row, "Total con IVA "));

          const baremo: Record<string, number> = {};
          let totalBarSum = 0;
          for (const key of Object.keys(row)) {
            const k = normalizeHeader(key);
            const m = /^bar_(\d+)$/.exec(k);
            if (!m) continue;
            const value = parseNumber(row[key]);
            if (value === null) continue;
            const idx = parseInt(m[1], 10);
            if (allowedBars.has(idx)) totalBarSum += value;
            baremo[`bar_${idx}`] = value;
          }

          latestByCodigo.set(codigo, {
            codigo,
            estado,
            tipo,
            origen,
            fechaSolicitud,
            fechaAsignacion,
            fechaGestion,
            gestor,
            nivelTension,
            proyecto,
            actaFacturacion,
            nombreIncremento,
            estadoIncremento,
            total,
            totalConIva,
            totalBarSum,
            baremo
          });
          successCount++;
        } catch (err) {
          errorCount++;
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          rowErrors.push(`Fila ${i + 1}: ${msg}`);
        }
      }

      const codigos = [...latestByCodigo.keys()];
      const existingMap = new Map<string, Prisma.ActividadBaremoGetPayload<{ select: {
        codigo: true;
        estado: true;
        tipo: true;
        origen: true;
        fechaSolicitud: true;
        fechaAsignacion: true;
        fechaGestion: true;
        gestor: true;
        nivelTension: true;
        proyecto: true;
        actaFacturacion: true;
        nombreIncremento: true;
        estadoIncremento: true;
        total: true;
        totalConIva: true;
        totalBarSum: true;
        ansRef: true;
        ansCalc: true;
        baremo: true;
      } }>>();

      for (const group of chunk(codigos, 900)) {
        const found = await prisma.actividadBaremo.findMany({
          where: { codigo: { in: group } },
          select: {
            codigo: true,
            estado: true,
            tipo: true,
            origen: true,
            fechaSolicitud: true,
            fechaAsignacion: true,
            fechaGestion: true,
            gestor: true,
            nivelTension: true,
            proyecto: true,
            actaFacturacion: true,
            nombreIncremento: true,
            estadoIncremento: true,
            total: true,
            totalConIva: true,
            totalBarSum: true,
            ansRef: true,
            ansCalc: true,
            baremo: true
          }
        });
        for (const r of found) existingMap.set(r.codigo, r);
      }

      const ansMap = new Map<string, number>();
      for (const group of chunk(codigos, 900)) {
        const found = await prisma.workOrder.findMany({
          where: { code: { in: group } },
          select: { code: true, ansOportunidad: true }
        });
        for (const r of found) {
          if (r.ansOportunidad != null) ansMap.set(r.code, r.ansOportunidad);
        }
      }

      const creates: Array<Prisma.ActividadBaremoCreateManyInput> = [];
      const updates: Array<{ codigo: string; data: Prisma.ActividadBaremoUpdateInput }> = [];
      const historyRows: Array<Prisma.WorkOrderHistoryCreateManyInput> = [];

      for (const [codigo, row] of latestByCodigo.entries()) {
        const ansRef = ansMap.get(codigo) ?? null;
        const rawAnsCalc = ansRef != null ? (row.totalBarSum < 39 ? 0 : (row.totalBarSum / 39) * ansRef - ansRef) : null;
        const ansCalc = rawAnsCalc == null ? null : Math.floor(rawAnsCalc);

        const newData = {
          codigo,
          estado: row.estado,
          tipo: row.tipo,
          origen: row.origen,
          fechaSolicitud: row.fechaSolicitud,
          fechaAsignacion: row.fechaAsignacion,
          fechaGestion: row.fechaGestion,
          gestor: row.gestor,
          nivelTension: row.nivelTension,
          proyecto: row.proyecto,
          actaFacturacion: row.actaFacturacion,
          nombreIncremento: row.nombreIncremento,
          estadoIncremento: row.estadoIncremento,
          total: row.total,
          totalConIva: row.totalConIva,
          totalBarSum: row.totalBarSum,
          ansRef,
          ansCalc,
          baremo: row.baremo
        };

        const existing = existingMap.get(codigo);
        if (!existing) {
          creates.push(newData);
          createdCount++;
          continue;
        }

        const beforeScalars = {
          estado: existing.estado,
          tipo: existing.tipo,
          origen: existing.origen,
          fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
          fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
          fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
          gestor: existing.gestor,
          nivelTension: existing.nivelTension,
          proyecto: existing.proyecto,
          actaFacturacion: existing.actaFacturacion,
          nombreIncremento: existing.nombreIncremento,
          estadoIncremento: existing.estadoIncremento,
          total: existing.total,
          totalConIva: existing.totalConIva,
          totalBarSum: existing.totalBarSum,
          ansRef: existing.ansRef,
          ansCalc: existing.ansCalc
        };
        const newScalars = {
          estado: newData.estado,
          tipo: newData.tipo,
          origen: newData.origen,
          fechaSolicitud: newData.fechaSolicitud ? newData.fechaSolicitud.toISOString() : null,
          fechaAsignacion: newData.fechaAsignacion ? newData.fechaAsignacion.toISOString() : null,
          fechaGestion: newData.fechaGestion ? newData.fechaGestion.toISOString() : null,
          gestor: newData.gestor,
          nivelTension: newData.nivelTension,
          proyecto: newData.proyecto,
          actaFacturacion: newData.actaFacturacion,
          nombreIncremento: newData.nombreIncremento,
          estadoIncremento: newData.estadoIncremento,
          total: newData.total,
          totalConIva: newData.totalConIva,
          totalBarSum: newData.totalBarSum,
          ansRef: newData.ansRef,
          ansCalc: newData.ansCalc
        };

        const sameScalars = JSON.stringify(beforeScalars) === JSON.stringify(newScalars);
        const sameBaremo =
          stableStringify((existing.baremo as Record<string, unknown>) || {}) ===
          stableStringify(newData.baremo as unknown as Record<string, unknown>);

        if (sameScalars && sameBaremo) {
          unchangedCount++;
          continue;
        }

        updates.push({ codigo, data: newData });
        updatedCount++;
      }

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const withRetry = async <T,>(fn: () => Promise<T>) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await fn();
          } catch (e) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : String(e);
            const retryable =
              msg.toLowerCase().includes("database is locked") ||
              msg.toLowerCase().includes("socket timeout") ||
              msg.toLowerCase().includes("busy") ||
              msg.toLowerCase().includes("too many sql variables");
            if (!retryable || attempt === 2) throw e;
            await sleep(400 * Math.pow(2, attempt));
          }
        }
        throw lastErr;
      };

      const userId = req.auth!.sub;
      const workOrderMap = new Map<string, { id: string; status: WorkOrderStatus }>();
      for (const group of chunk(codigos, 900)) {
        const found = await prisma.workOrder.findMany({
          where: { code: { in: group } },
          select: { id: true, code: true, status: true }
        });
        for (const r of found) workOrderMap.set(r.code, { id: r.id, status: r.status });
      }

      for (const group of chunk(creates, 30)) {
        if (group.length === 0) continue;
        await withRetry(() => prisma.actividadBaremo.createMany({ data: group }));
      }

      for (const group of chunk(updates, 20)) {
        const ops = group.map((u) => prisma.actividadBaremo.update({ where: { codigo: u.codigo }, data: u.data }));
        if (ops.length === 0) continue;
        await withRetry(() => prisma.$transaction(ops));
      }

      for (const [codigo, row] of latestByCodigo.entries()) {
        const existing = existingMap.get(codigo);
        const ansRef = ansMap.get(codigo) ?? null;
        const rawAnsCalc = ansRef != null ? (row.totalBarSum < 39 ? 0 : (row.totalBarSum / 39) * ansRef - ansRef) : null;
        const ansCalc = rawAnsCalc == null ? null : Math.floor(rawAnsCalc);

        const order = workOrderMap.get(codigo);
        if (!order) continue;

        if (!existing) {
          historyRows.push({
            workOrderId: order.id,
            toStatus: order.status,
            note: `Carga Actividades Baremo`,
            noteDetail: `TotalBaremo=${row.totalBarSum}; ANS=${ansRef ?? ""}; Resultado=${ansCalc ?? ""}`,
            changedById: userId
          });
          continue;
        }

        const beforeScalars = {
          estado: existing.estado,
          tipo: existing.tipo,
          origen: existing.origen,
          fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
          fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
          fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
          gestor: existing.gestor,
          nivelTension: existing.nivelTension,
          proyecto: existing.proyecto,
          actaFacturacion: existing.actaFacturacion,
          nombreIncremento: existing.nombreIncremento,
          estadoIncremento: existing.estadoIncremento,
          total: existing.total,
          totalConIva: existing.totalConIva,
          totalBarSum: existing.totalBarSum,
          ansRef: existing.ansRef,
          ansCalc: existing.ansCalc
        };
        const newScalars = {
          estado: row.estado,
          tipo: row.tipo,
          origen: row.origen,
          fechaSolicitud: row.fechaSolicitud ? row.fechaSolicitud.toISOString() : null,
          fechaAsignacion: row.fechaAsignacion ? row.fechaAsignacion.toISOString() : null,
          fechaGestion: row.fechaGestion ? row.fechaGestion.toISOString() : null,
          gestor: row.gestor,
          nivelTension: row.nivelTension,
          proyecto: row.proyecto,
          actaFacturacion: row.actaFacturacion,
          nombreIncremento: row.nombreIncremento,
          estadoIncremento: row.estadoIncremento,
          total: row.total,
          totalConIva: row.totalConIva,
          totalBarSum: row.totalBarSum,
          ansRef,
          ansCalc
        };
        const sameScalars = JSON.stringify(beforeScalars) === JSON.stringify(newScalars);
        const sameBaremo =
          stableStringify((existing.baremo as Record<string, unknown>) || {}) ===
          stableStringify(row.baremo as unknown as Record<string, unknown>);

        if (sameScalars && sameBaremo) continue;

        historyRows.push({
          workOrderId: order.id,
          toStatus: order.status,
          note: `Actualización Actividades Baremo`,
          noteDetail: `Antes: TotalBaremo=${existing.totalBarSum ?? ""}; Resultado=${existing.ansCalc ?? ""} | Después: TotalBaremo=${row.totalBarSum}; Resultado=${ansCalc ?? ""}`,
          changedById: userId
        });
      }

      for (const group of chunk(historyRows, 100)) {
        if (group.length === 0) continue;
        await withRetry(() => prisma.workOrderHistory.createMany({ data: group }));
      }

      writeLog(`INFO: Finalizado Actividades Baremo. Creadas: ${createdCount}, Actualizadas: ${updatedCount}, Sin cambios: ${unchangedCount}, Errores: ${errorCount}`);
      res.json({
        message: `Actividades Baremo: ${createdCount} creadas, ${updatedCount} actualizadas, ${unchangedCount} sin cambios.`,
        count: successCount,
        updated: updatedCount,
        created: createdCount,
        unchanged: unchangedCount,
        errors: errorCount,
        errorDetails: rowErrors
      });
    } else if (type === "LEVANTAMIENTO") {
      const payload = await processLevantamientoJob({ data, userId: req.auth!.sub });
      res.json(payload);
    } else if (type === "ENTREGA_LEVANTAMIENTO") {
      const payload = await processEntregaLevantamientoJob({ data, userId: req.auth!.sub });
      res.json(payload);
    } else if (type === "RECORRIDO_INCREMENTOS") {
      let successCount = 0;
      let errorCount = 0;
      const rowErrors: string[] = [];

      writeLog(`INFO: Procesando archivo de Recorrido Incrementos: ${data.length} filas`);

      // RECORRIDO INCREMENTOS
      // Objetivo:
      // - Guardar la trazabilidad de incrementos (por OT) en la tabla RecorridoIncremento.
      // - Determinar responsable (OCA/ENEL/OCA-ENEL/NA) por transición de estados.
      // - Calcular diasEnel SOLO cuando responsable = ENEL, usando calendario:
      //   diasEnel = Fin(FECHA_FIN) - Inicio(FECHA_INICIO) + extra
      //   extra = +1 si hora(FECHA_FIN) > 17:00
      //   regla mismo día: si FECHA_INICIO y FECHA_FIN son el mismo día y hora(FECHA_FIN) < 17:00 => 0
      //
      // Nota: la fecha "Fin" se evalúa con el número de día de la columna Fin del calendario (dayNumberFin),
      // y la fecha "Inicio" con el número de día de la columna Inicio (dayNumber).
      const normalizeHeader = (value: string) =>
        value
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ");

      const getVal = (row: Record<string, unknown>, name: string) => {
        const target = normalizeHeader(name);
        const key = Object.keys(row).find((k) => normalizeHeader(k) === target);
        return key ? row[key] : undefined;
      };

      const parseDate = (val: unknown) => {
        if (val instanceof Date) return val;
        if (val === null || val === undefined) return null;
        const str = String(val).trim();
        if (!str) return null;
        const d = new Date(str);
        if (!Number.isNaN(d.getTime())) return d;
        const parts = str.split(/[/\s:]/);
        if (parts.length >= 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          const year = parseInt(parts[2]);
          const hours = parts.length >= 4 ? parseInt(parts[3]) : 0;
          const minutes = parts.length >= 5 ? parseInt(parts[4]) : 0;
          const seconds = parts.length >= 6 ? parseInt(parts[5]) : 0;
          return new Date(year, month, day, hours, minutes, seconds);
        }
        return null;
      };

      const parseIntSafe = (val: unknown) => {
        if (val === null || val === undefined) return null;
        if (typeof val === "number") return Number.isFinite(val) ? Math.trunc(val) : null;
        const str = String(val).trim();
        if (!str) return null;
        const normalized = str.replace(/[^\d-]/g, "");
        const n = parseInt(normalized, 10);
        return Number.isFinite(n) ? n : null;
      };

      const parseBool = (val: unknown) => {
        if (val === null || val === undefined) return null;
        if (typeof val === "boolean") return val;
        const s = String(val).trim().toLowerCase();
        if (!s) return null;
        if (["1", "true", "si", "sí", "s", "y", "yes"].includes(s)) return true;
        if (["0", "false", "no", "n"].includes(s)) return false;
        return null;
      };

      const stableStringify = (obj: Record<string, unknown>) => {
        const keys = Object.keys(obj).sort();
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = obj[k];
        return JSON.stringify(out);
      };

      const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      try {
        await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 60000");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "UNKNOWN";
        writeLog(`WARN: No se pudo configurar busy_timeout: ${msg}`);
      }

      const calendarRows = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
      const calendarInicioMap = new Map<string, number>();
      const calendarFinMap = new Map<string, number>();
      for (const r of calendarRows) {
        const key = calendarKey(new Date(r.date));
        calendarInicioMap.set(key, r.dayNumber);
        calendarFinMap.set(key, r.dayNumberFin ?? r.dayNumber);
      }

      const normalizeTransition = (value: string) =>
        value
          .trim()
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ");

      const responsableMap: Record<string, string> = {
        "DE IGD A INL": "OCA",
        "DE INL A IGD": "OCA",
        "DE INL A PME": "OCA",
        IGD: "OCA",
        DEL: "OCA/ENEL",
        INL: "OCA/ENEL",
        PME: "ENEL",
        "DE ERR A ESE": "ENEL",
        "DE IGD A DEL": "ENEL",
        "DE IGD A ERR": "ENEL",
        "DE IGD A ESE": "ENEL",
        "DE IGD A NOI": "ENEL",
        "DE IGD A PME": "ENEL",
        "DE INL A DEL": "ENEL",
        "DE INL A ERR": "ENEL",
        "DE INL A ESE": "ENEL",
        "DE INL A NOI": "ENEL",
        "DE PME A DEL": "ENEL",
        "DE PME A ERR": "ENEL",
        "DE PME A ESE": "ENEL",
        "DE PME A IGD": "ENEL",
        "DE PME A INL": "ENEL",
        ESE: "ENEL",
        NOI: "ENEL",
        "DE DEL A NOI": "NA",
        "DE ESE A NOI": "NA",
        "DE ESE A PME": "ENEL",
        "0": "NA"
      };

      const computeDias = (inicio: Date, fin: Date) => {
        // Cálculo de días ENEL con calendario (Inicio/Fin):
        // - iNum: Inicio(inicio)
        // - fNum: Fin(fin)
        // - extraDay: +1 si fin > 17:00
        // - si mismo día y fin < 17:00 => 0
        const iKey = bogotaDateKey(inicio);
        const fKey = bogotaDateKey(fin);
        const iNum = calendarInicioMap.get(iKey);
        const fNum = calendarFinMap.get(fKey);
        if (iNum === undefined || fNum === undefined) return null;
        const cutoffMinutes = 17 * 60;
        const finMinutes = bogotaMinutes(fin);
        const extraDay = finMinutes > cutoffMinutes ? 1 : 0;
        const sameDay = iKey === fKey;
        if (sameDay && finMinutes < cutoffMinutes) return 0;
        return Math.max(0, fNum - iNum + extraDay);
      };

      // Se deduplica por llave natural (orderCode + nombreIncremento + fechaInicio) y se conserva
      // el último registro observado por llave (en caso de repetidos en el archivo).
      const latestByKey = new Map<
        string,
        {
          orderCode: string;
          tipo: string | null;
          origen: string | null;
          estOrigenEstLlegada: string | null;
          responsable: string | null;
          nombreIncremento: string;
          csStatus: string | null;
          fechaSolicitud: Date | null;
          fechaAsignacion: Date | null;
          fechaGestion: Date | null;
          estadoAnterior: string | null;
          estadoActual: string | null;
          fechaInicio: Date;
          fechaFin: Date | null;
          cantidadIncrementos: number | null;
          flagFechaFin: boolean | null;
          diasEnel: number | null;
        }
      >();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const orderCode = (
            getVal(row, "Orden de Trabajo") ??
            getVal(row, "Orden") ??
            getVal(row, "Orden de trabajo")
          )?.toString().trim();

          const nombreIncremento = (getVal(row, "Nombre Incremento") ?? getVal(row, "Nombre incremento"))?.toString().trim();
          const { inicio: fechaInicio, fin: fechaFin } = pickBestDatePairByCalendar(
            getVal(row, "FECHA_INICIO"),
            getVal(row, "FECHA_FIN"),
            calendarInicioMap,
            calendarFinMap
          );

          if (!orderCode) {
            errorCount++;
            rowErrors.push(`Fila ${i + 1}: Falta Orden de Trabajo`);
            continue;
          }
          if (!nombreIncremento) {
            errorCount++;
            rowErrors.push(`Fila ${i + 1}: Falta Nombre Incremento (${orderCode})`);
            continue;
          }
          if (!fechaInicio) {
            errorCount++;
            rowErrors.push(`Fila ${i + 1}: Falta FECHA_INICIO (${orderCode})`);
            continue;
          }

          const tipo = (getVal(row, "Tipo") ?? "").toString().trim() || null;
          const origen = (getVal(row, "Origen") ?? "").toString().trim() || null;
          const csStatus = (getVal(row, "CS_STATUS") ?? "").toString().trim() || null;
          const fechaSolicitud = parseDate(getVal(row, "Fecha solicitud"));
          const fechaAsignacion =
            parseDate(getVal(row, "Fecha asignación")) ??
            parseDate(getVal(row, "Fecha asignacion")) ??
            parseDate(getVal(row, "Fecha asignaciÃ³n"));
          const fechaGestion =
            parseDate(getVal(row, "Fecha gestión")) ??
            parseDate(getVal(row, "Fecha gestion")) ??
            parseDate(getVal(row, "Fecha gestiÃ³n"));
          const estadoAnterior = (getVal(row, "ESTADO_ANTERIOR") ?? "").toString().trim() || null;
          const estadoActual = (getVal(row, "ESTADO_ACTUAL") ?? "").toString().trim() || null;
          const cantidadIncrementos = parseIntSafe(getVal(row, "Cantidad Incrementos"));
          const flagFechaFin = parseBool(getVal(row, "FLAG_FECHA_FIN"));

          const rawTrans = (getVal(row, "Est_origen_Est_llegada") ?? getVal(row, "Est_origen_Est_llegada " ) ?? "").toString().trim();
          const derivedTrans =
            rawTrans ||
            (estadoAnterior && estadoActual
              ? `de ${estadoAnterior} a ${estadoActual}`
              : estadoActual || estadoAnterior || "0");
          const estOrigenEstLlegada = derivedTrans ? normalizeTransition(derivedTrans) : null;
          const responsable = estOrigenEstLlegada ? responsableMap[estOrigenEstLlegada] ?? "NA" : null;
          const computedDiasEnel = responsable === "ENEL" && fechaFin ? computeDias(fechaInicio, fechaFin) : null;
          const diasEnel = computedDiasEnel;

          const key = `${orderCode}||${nombreIncremento}||${fechaInicio.toISOString()}`;
          latestByKey.set(key, {
            orderCode,
            tipo,
            origen,
            estOrigenEstLlegada,
            responsable,
            nombreIncremento,
            csStatus,
            fechaSolicitud,
            fechaAsignacion,
            fechaGestion,
            estadoAnterior,
            estadoActual,
            fechaInicio,
            fechaFin,
            cantidadIncrementos,
            flagFechaFin,
            diasEnel
          });
          successCount++;
        } catch (err) {
          errorCount++;
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          rowErrors.push(`Fila ${i + 1}: ${msg}`);
        }
      }

      const codes = [...new Set([...latestByKey.values()].map((v) => v.orderCode))];
      const existingRows = codes.length
        ? await prisma.recorridoIncremento.findMany({
            where: { orderCode: { in: codes } },
            select: {
              orderCode: true,
              tipo: true,
              origen: true,
              estOrigenEstLlegada: true,
              responsable: true,
              nombreIncremento: true,
              csStatus: true,
              fechaSolicitud: true,
              fechaAsignacion: true,
              fechaGestion: true,
              estadoAnterior: true,
              estadoActual: true,
              fechaInicio: true,
              fechaFin: true,
              cantidadIncrementos: true,
              flagFechaFin: true,
              diasEnel: true
            }
          })
        : [];

      const existingMap = new Map<string, (typeof existingRows)[number]>();
      for (const r of existingRows) {
        const key = `${r.orderCode}||${r.nombreIncremento}||${r.fechaInicio.toISOString()}`;
        existingMap.set(key, r);
      }

      const existingEnelSumByOrder = new Map<string, number>();
      const existingEnelByOrderAndInc = new Map<string, Map<string, { sum: number; count: number }>>();
      for (const r of existingRows) {
        if (r.responsable !== "ENEL") continue;
        if (r.diasEnel == null) continue;
        const incMap = existingEnelByOrderAndInc.get(r.orderCode) ?? new Map<string, { sum: number; count: number }>();
        const curr = incMap.get(r.nombreIncremento) ?? { sum: 0, count: 0 };
        incMap.set(r.nombreIncremento, { sum: curr.sum + r.diasEnel, count: curr.count + 1 });
        existingEnelByOrderAndInc.set(r.orderCode, incMap);
      }
      for (const [code, incMap] of existingEnelByOrderAndInc.entries()) {
        let total = 0;
        for (const val of incMap.values()) {
          total += val.sum === 0 && val.count > 0 ? 1 : val.sum;
        }
        existingEnelSumByOrder.set(code, total);
      }

      let createdCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      const creates: Array<Prisma.RecorridoIncrementoCreateManyInput> = [];
      const updates: Array<{ key: { orderCode: string; nombreIncremento: string; fechaInicio: Date }; data: Prisma.RecorridoIncrementoUpdateInput }> = [];

      for (const [key, row] of latestByKey.entries()) {
        const existing = existingMap.get(key);
        const newData = {
          orderCode: row.orderCode,
          tipo: row.tipo,
          origen: row.origen,
          estOrigenEstLlegada: row.estOrigenEstLlegada,
          responsable: row.responsable,
          nombreIncremento: row.nombreIncremento,
          csStatus: row.csStatus,
          fechaSolicitud: row.fechaSolicitud,
          fechaAsignacion: row.fechaAsignacion,
          fechaGestion: row.fechaGestion,
          estadoAnterior: row.estadoAnterior,
          estadoActual: row.estadoActual,
          fechaInicio: row.fechaInicio,
          fechaFin: row.fechaFin,
          cantidadIncrementos: row.cantidadIncrementos,
          flagFechaFin: row.flagFechaFin,
          diasEnel: row.diasEnel
        };

        if (!existing) {
          creates.push(newData);
          createdCount++;
          continue;
        }

        const before = {
          tipo: existing.tipo,
          origen: existing.origen,
          estOrigenEstLlegada: existing.estOrigenEstLlegada,
          responsable: existing.responsable,
          csStatus: existing.csStatus,
          fechaSolicitud: existing.fechaSolicitud ? existing.fechaSolicitud.toISOString() : null,
          fechaAsignacion: existing.fechaAsignacion ? existing.fechaAsignacion.toISOString() : null,
          fechaGestion: existing.fechaGestion ? existing.fechaGestion.toISOString() : null,
          estadoAnterior: existing.estadoAnterior,
          estadoActual: existing.estadoActual,
          fechaFin: existing.fechaFin ? existing.fechaFin.toISOString() : null,
          cantidadIncrementos: existing.cantidadIncrementos,
          flagFechaFin: existing.flagFechaFin,
          diasEnel: existing.diasEnel
        };
        const after = {
          tipo: newData.tipo,
          origen: newData.origen,
          estOrigenEstLlegada: newData.estOrigenEstLlegada,
          responsable: newData.responsable,
          csStatus: newData.csStatus,
          fechaSolicitud: newData.fechaSolicitud ? newData.fechaSolicitud.toISOString() : null,
          fechaAsignacion: newData.fechaAsignacion ? newData.fechaAsignacion.toISOString() : null,
          fechaGestion: newData.fechaGestion ? newData.fechaGestion.toISOString() : null,
          estadoAnterior: newData.estadoAnterior,
          estadoActual: newData.estadoActual,
          fechaFin: newData.fechaFin ? newData.fechaFin.toISOString() : null,
          cantidadIncrementos: newData.cantidadIncrementos,
          flagFechaFin: newData.flagFechaFin,
          diasEnel: newData.diasEnel
        };

        if (stableStringify(before) === stableStringify(after)) {
          unchangedCount++;
          continue;
        }

        updates.push({
          key: { orderCode: row.orderCode, nombreIncremento: row.nombreIncremento, fechaInicio: row.fechaInicio },
          data: newData
        });
        updatedCount++;
      }

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const withRetry = async <T,>(fn: () => Promise<T>) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await fn();
          } catch (e) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : String(e);
            const retryable =
              msg.toLowerCase().includes("database is locked") ||
              msg.toLowerCase().includes("socket timeout") ||
              msg.toLowerCase().includes("busy") ||
              msg.toLowerCase().includes("too many sql variables");
            if (!retryable || attempt === 2) throw e;
            await sleep(400 * Math.pow(2, attempt));
          }
        }
        throw lastErr;
      };

      for (const group of chunk(creates, 50)) {
        if (group.length === 0) continue;
        await withRetry(() => prisma.recorridoIncremento.createMany({ data: group }));
      }

      for (const group of chunk(updates, 20)) {
        if (group.length === 0) continue;
        const ops = group.map((u) =>
          prisma.recorridoIncremento.update({
            where: {
              orderCode_nombreIncremento_fechaInicio: {
                orderCode: u.key.orderCode,
                nombreIncremento: u.key.nombreIncremento,
                fechaInicio: u.key.fechaInicio
              }
            },
            data: u.data
          })
        );
        await withRetry(() => prisma.$transaction(ops));
      }

      // Después de persistir el recorrido, se recalcula el acumulado ENEL por OT.
      // Este valor es el que se muestra en Órdenes como "R. Incrementos" y además se suma al "D. Descuento".
      const newGroups = codes.length
        ? await prisma.recorridoIncremento.groupBy({
            by: ["orderCode", "nombreIncremento"],
            where: { orderCode: { in: codes }, responsable: "ENEL", diasEnel: { not: null } },
            _max: { diasEnel: true, fechaFin: true },
            _count: { diasEnel: true },
            _min: { fechaInicio: true }
          })
        : [];

      const newEnelSumByOrder = new Map<string, number>();
      const enelWindowByOrder = new Map<string, { fechaInicio: string | null; fechaFin: string | null }>();
      for (const g of newGroups) {
        const max = g._max.diasEnel ?? 0;
        const count = g._count.diasEnel ?? 0;
        const finalSum = max === 0 && count > 0 ? 1 : max;
        newEnelSumByOrder.set(g.orderCode, (newEnelSumByOrder.get(g.orderCode) ?? 0) + finalSum);
        const inicio = g._min.fechaInicio ? new Date(g._min.fechaInicio).toISOString() : null;
        const fin = g._max.fechaFin ? new Date(g._max.fechaFin).toISOString() : null;
        const curr = enelWindowByOrder.get(g.orderCode) ?? { fechaInicio: null, fechaFin: null };
        const nextInicio =
          inicio && (!curr.fechaInicio || new Date(inicio).getTime() < new Date(curr.fechaInicio).getTime())
            ? inicio
            : curr.fechaInicio;
        const nextFin =
          fin && (!curr.fechaFin || new Date(fin).getTime() > new Date(curr.fechaFin).getTime()) ? fin : curr.fechaFin;
        enelWindowByOrder.set(g.orderCode, { fechaInicio: nextInicio, fechaFin: nextFin });
      }

      if (codes.length > 0) {
        const userId = req.auth!.sub;
        const orders = await prisma.workOrder.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true, status: true }
        });
        const orderIdMap = new Map(orders.map((o) => [o.code, o]));

        const existingHistory = await prisma.workOrderHistory.findMany({
          where: { workOrderId: { in: orders.map((o) => o.id) }, note: "Recorrido Incrementos (ENEL)" },
          orderBy: { changedAt: "desc" },
          select: { id: true, workOrderId: true }
        });
        const latestHistoryByWorkOrderId = new Map<string, string>();
        for (const h of existingHistory) {
          if (!latestHistoryByWorkOrderId.has(h.workOrderId)) latestHistoryByWorkOrderId.set(h.workOrderId, h.id);
        }

        const creates: Array<Prisma.WorkOrderHistoryCreateManyInput> = [];
        const updates: Array<{ id: string; data: Prisma.WorkOrderHistoryUpdateInput }> = [];

        for (const orderCode of codes) {
          const o = orderIdMap.get(orderCode);
          if (!o) continue;
          const window = enelWindowByOrder.get(orderCode);
          if (!window?.fechaInicio || !window?.fechaFin) continue;

          const before = existingEnelSumByOrder.get(orderCode) ?? 0;
          const after = newEnelSumByOrder.get(orderCode) ?? 0;
          const noteDetail = `DiasENEL=${after}; Antes=${before}`;

          const existingId = latestHistoryByWorkOrderId.get(o.id);
          if (existingId) {
            updates.push({
              id: existingId,
              data: {
                toStatus: o.status,
                noteDetail,
                fechaInicio: window.fechaInicio,
                fechaFin: window.fechaFin,
                changedBy: { connect: { id: userId } }
              }
            });
          } else {
            creates.push({
              workOrderId: o.id,
              toStatus: o.status,
              note: "Recorrido Incrementos (ENEL)",
              noteDetail,
              fechaInicio: window.fechaInicio,
              fechaFin: window.fechaFin,
              changedById: userId
            });
          }
        }

        for (const group of chunk(creates, 200)) {
          if (group.length === 0) continue;
          await withRetry(() => prisma.workOrderHistory.createMany({ data: group }));
        }
        for (const group of chunk(updates, 50)) {
          if (group.length === 0) continue;
          await withRetry(() =>
            prisma.$transaction(group.map((u) => prisma.workOrderHistory.update({ where: { id: u.id }, data: u.data })))
          );
        }
      }

      writeLog(
        `INFO: Finalizado Recorrido Incrementos. Creadas: ${createdCount}, Actualizadas: ${updatedCount}, Sin cambios: ${unchangedCount}, Errores: ${errorCount}`
      );
      res.json({
        message: `Recorrido Incrementos: ${createdCount} creadas, ${updatedCount} actualizadas, ${unchangedCount} sin cambios.`,
        count: successCount,
        updated: updatedCount,
        created: createdCount,
        unchanged: unchangedCount,
        errors: errorCount,
        errorDetails: rowErrors
      });
    } else {
      res.json({ message: `Tipo de cargue desconocido: ${type}`, count: 0 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "UNKNOWN";
    const stack = error instanceof Error ? error.stack : null;
    writeLog(`CRITICAL: ${msg}${stack ? `\n${stack}` : ""}`);
    res.status(500).json({ error: "INTERNAL_ERROR", details: msg });
  } finally {
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        void err;
      }
    }
  }
  }
);
