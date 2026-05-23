import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];
const PORT = Number(process.env.PORT || 4173);

// ── CSV parser ──────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; }
      else { cell += ch; }
    } else if (ch === '"') { quoted = true; }
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== '\r') { cell += ch; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function clean(v) { return String(v ?? "").trim(); }
function norm(v) { return clean(v).toLowerCase().replace(/\s+/g, " "); }
function ckey(v) { return norm(v).replace(/[^a-z ]/g, "").trim(); }

function parseDate(value) {
  const raw = clean(value);
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) return null;
  return date;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function parseAmount(value) {
  const raw = clean(value).toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (!raw) return 0;
  const multiplier = raw.endsWith("k") ? 1000 : 1;
  const number = Number(raw.endsWith("k") ? raw.slice(0, -1) : raw);
  return Number.isFinite(number) ? number * multiplier : 0;
}

function statusBucket(status) {
  const value = norm(status);
  if (["full payment recieved", "full payment received", "manual payment"].includes(value)) return "Complete/RFD";
  if (value === "refund requested") return "Refund Requested";
  if (value === "down payment") return "Down Payment";
  if (value === "loan in progress") return "Loan In Progress";
  return value ? "Other" : "Blank";
}

function workingDaysInMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNum, 0));
  let count = 0;
  for (let d = new Date(Date.UTC(year, monthNum - 1, 1)); d <= end; d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() !== 0) count++;
  return count;
}

function elapsedWorkingDays(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 0));
  if (todayUtc < start) return 0;
  const cap = todayUtc > end ? end : todayUtc;
  let count = 0;
  for (let d = new Date(start); d <= cap; d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() !== 0) count++;
  return count;
}

function sumField(rows, field) {
  return rows.reduce((t, r) => t + Number(r[field] || 0), 0);
}

function groupBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// ── Fetch a sheet tab ───────────────────────────────────────
async function loadSheetCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for sheet "${sheetName}"`);
  return parseCsv(await response.text());
}

// ── Load targets from Manual Targets tab ───────────────────
async function loadTargets() {
  const rows = await loadSheetCsv("Manual Targets");
  const targets = [];
  for (const row of rows) {
    const month = clean(row[0]);
    const manager = clean(row[1]);
    const key = norm(clean(row[2]));
    const target = Number(clean(row[4] ?? "")) || 0;
    if (month && manager && key && month.match(/^\d{4}-\d{2}$/)) {
      targets.push({ month, manager, key, target });
    }
  }
  return targets;
}

function getTarget(targets, month, manager, key) {
  return targets.find(t => t.month === month && t.manager === manager && t.key === key)?.target ?? 0;
}

// ── Extract sales rows from a manager tab ──────────────────
function extractRows(manager, rows) {
  const sales = [];
  for (const row of rows) {
    const date = parseDate(row[0]);
    if (!date) continue;
    const counsellor = clean(row[1]);
    const status = clean(row[6]);
    const bucket = statusBucket(status);
    const complete = bucket === "Complete/RFD";
    const key = ckey(counsellor);
    const azExcluded = manager === "Azhaan" && key === "azhaan" && complete;
    sales.push({
      manager, date, month: monthKey(date), monthLabel: monthLabel(monthKey(date)),
      counsellor, key,
      learner: clean(row[2]),
      amount: parseAmount(row[5]),
      status, bucket,
      complete: complete ? 1 : 0,
      achievement: complete && !azExcluded ? 1 : 0,
      refund: bucket === "Refund Requested" ? 1 : 0,
      downPayment: bucket === "Down Payment" ? 1 : 0,
      loanInProgress: bucket === "Loan In Progress" ? 1 : 0,
      exclusionReason: azExcluded ? "Azhaan self-sale excluded" : "",
    });
  }
  return sales;
}

// ── Build dashboard model ───────────────────────────────────
function buildModel(allSales, targets, dataSource) {
  const months = [...new Set(allSales.map(s => s.month))].sort();
  const latestMonth = months.at(-1);

  // BDE rows
  const bdeRows = [];
  for (const [, rows] of groupBy(allSales, s => `${s.month}|${s.manager}|${s.key}`).entries()) {
    const { month, manager, key, counsellor } = rows[0];
    const target = getTarget(targets, month, manager, key);
    const achievement = sumField(rows, "achievement");
    const complete = sumField(rows, "complete");
    const refunds = sumField(rows, "refund");
    const amount = rows.filter(r => r.complete).reduce((t, r) => t + r.amount, 0);
    bdeRows.push({
      month, manager, counsellor, counsellorKey: key,
      totalEntries: rows.length, complete, achievement, refunds,
      downPayment: sumField(rows, "downPayment"),
      loanInProgress: sumField(rows, "loanInProgress"),
      completedAmount: amount, target,
      achievementPct: target ? achievement / target : 0,
      refundRate: rows.length ? refunds / rows.length : 0,
    });
  }

  // Rank BDEs per month
  for (const month of months) {
    const monthBde = bdeRows.filter(b => b.month === month);
    monthBde.sort((a, b) => b.achievementPct - a.achievementPct || b.achievement - a.achievement || a.refundRate - b.refundRate);
    monthBde.forEach((b, i) => {
      b.overallRank = i + 1;
      b.status = b.achievementPct >= 1 ? "Ahead" : b.achievementPct >= 0.75 ? "On Track" : b.refundRate >= 0.25 ? "At Risk" : "Behind";
    });
  }

  // MOM rows
  const momRows = [];
  for (const month of months) {
    for (const manager of MANAGERS) {
      const rows = allSales.filter(s => s.month === month && s.manager === manager);
      if (!rows.length) continue;
      const bdeSub = bdeRows.filter(b => b.month === month && b.manager === manager);
      const target = bdeSub.reduce((t, b) => t + b.target, 0);
      const twd = workingDaysInMonth(month);
      const ewd = elapsedWorkingDays(month);
      const achievement = sumField(rows, "achievement");
      const complete = sumField(rows, "complete");
      const refunds = sumField(rows, "refund");
      const activeBdes = new Set(bdeSub.filter(b => b.achievement > 0).map(b => b.key)).size;
      const ttd = target ? (target * ewd) / twd : 0;
      momRows.push({
        month, monthLabel: monthLabel(month), manager,
        totalEntries: rows.length, complete, achievement, refunds,
        downPayment: sumField(rows, "downPayment"),
        loanInProgress: sumField(rows, "loanInProgress"),
        completedAmount: rows.filter(r => r.complete).reduce((t, r) => t + r.amount, 0),
        target, achievementPct: target ? achievement / target : 0,
        refundRate: rows.length ? refunds / rows.length : 0,
        activeBdes, productivity: activeBdes ? achievement / activeBdes : 0,
        totalWorkingDays: twd, workingDaysElapsed: ewd,
        targetTillDate: ttd,
        mtdDeficit: Math.max(0, ttd - achievement),
        requiredDrr: Math.max(0, (target - achievement) / Math.max(1, twd - ewd)),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dataSource,
    latestMonth,
    latestMonthLabel: monthLabel(latestMonth),
    months,
    momRows,
    bdeRows,
    sales: allSales.map(s => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
  };
}

// ── Main data loader ────────────────────────────────────────
async function dashboardData() {
  const [datasets, targets] = await Promise.all([
    Promise.all(MANAGERS.map(async manager => {
      const rows = await loadSheetCsv(manager);
      return { manager, sales: extractRows(manager, rows) };
    })),
    loadTargets(),
  ]);

  return buildModel(
    datasets.flatMap(d => d.sales),
    targets,
    datasets.map(d => `${d.manager}: live`).join(", ")
  );
}

// ── Static file server ──────────────────────────────────────
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/api/data") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(JSON.stringify(await dashboardData()));
      return;
    }
    const filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
    res.setHeader("Content-Type", contentType(filePath));
    res.end(await fs.readFile(filePath));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.stack || String(err));
  }
});

server.listen(PORT, () => console.log(`Sales dashboard running at http://localhost:${PORT}`));