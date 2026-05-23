import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];
const PORT = Number(process.env.PORT || 4173);

const TARGETS = [
  { month: "2026-05", manager: "Azhaan", counsellorKey: "ishanvi", displayName: "Ishanvi", target: 8 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "paramveer", displayName: "Paramveer", target: 8 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "sanchit", displayName: "Sanchit", target: 8 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "rishabh", displayName: "Rishabh", target: 8 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "tanishque", displayName: "Tanishque", target: 8 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "bhugarb", displayName: "Bhugarb", target: 3 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "sidharth", displayName: "Sidharth", target: 6 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "harshit", displayName: "Harshit", target: 6 },
  { month: "2026-05", manager: "Azhaan", counsellorKey: "sanju", displayName: "Sanju", target: 6 },
  { month: "2026-05", manager: "Nazim", counsellorKey: "shamse", displayName: "Shamse", target: 7 },
  { month: "2026-05", manager: "Nazim", counsellorKey: "mehul", displayName: "Mehul", target: 7 },
  { month: "2026-05", manager: "Nazim", counsellorKey: "sameer", displayName: "Sameer", target: 6 },
  { month: "2026-05", manager: "Nazim", counsellorKey: "smriti", displayName: "Smriti", target: 6 },
  { month: "2026-05", manager: "Nazim", counsellorKey: "nazim", displayName: "Nazim", target: 12 },
  { month: "2026-05", manager: "Priyanka", counsellorKey: "priyanka", displayName: "Priyanka", target: 10 },
  { month: "2026-05", manager: "Priyanka", counsellorKey: "shubham", displayName: "Shubham", target: 0 },
  { month: "2026-05", manager: "Priyanka", counsellorKey: "abhiram", displayName: "Abhiram", target: 0 },
  { month: "2026-05", manager: "Priyanka", counsellorKey: "aniya", displayName: "Aniya", target: 0 }
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function parseDate(value) {
  const raw = clean(value);
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) return null;
  return date;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function counsellorKey(value) {
  return norm(value).replace(/[^a-z ]/g, "").split(" ").filter(Boolean)[0] || norm(value);
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

function targetFor(month, manager, key) {
  return TARGETS.find((target) => target.month === month && target.manager === manager && target.counsellorKey === key)?.target ?? 0;
}

function groupBy(items, callback) {
  const map = new Map();
  for (const item of items) {
    const key = callback(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

async function loadSheetCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { rows: parseCsv(await response.text()), source: "live" };
  } catch {
    const fallback = path.join(ROOT, "source_data", "direct_tabs", `${sheetName}.csv`);
    return { rows: parseCsv(await fs.readFile(fallback, "utf8")), source: "local fallback" };
  }
}

function extractRows(manager, rows) {
  const sales = [];
  for (const row of rows) {
    const date = parseDate(row[0]);
    if (!date) continue;
    const counsellor = clean(row[1]);
    const status = clean(row[6]);
    const bucket = statusBucket(status);
    const complete = bucket === "Complete/RFD";
    const key = counsellorKey(counsellor);
    const azhaanExcluded = manager === "Azhaan" && key === "azhaan" && complete;
    sales.push({
      manager,
      date: date.toISOString().slice(0, 10),
      dateValue: date.toISOString(),
      month: monthKey(date),
      monthLabel: monthLabel(monthKey(date)),
      counsellor,
      counsellorKey: key,
      learner: clean(row[2]),
      amount: parseAmount(row[5]),
      status,
      bucket,
      complete: complete ? 1 : 0,
      achievement: complete && !azhaanExcluded ? 1 : 0,
      refund: bucket === "Refund Requested" ? 1 : 0,
      downPayment: bucket === "Down Payment" ? 1 : 0,
      loanInProgress: bucket === "Loan In Progress" ? 1 : 0,
      exclusionReason: azhaanExcluded ? "Azhaan self-sale excluded" : ""
    });
  }
  return sales;
}

function workingDaysInMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 0));
  let count = 0;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0) count += 1;
  }
  return count;
}

function elapsedWorkingDays(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 0));
  if (todayUtc < start) return 0;
  const cappedEnd = todayUtc > end ? end : todayUtc;
  let count = 0;
  for (let date = new Date(start); date <= cappedEnd; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0) count += 1;
  }
  return count;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function buildModel(sales, dataSource) {
  const months = [...new Set(sales.map((sale) => sale.month))].sort();
  const latestMonth = months.at(-1);
  const bdeRows = [];
  for (const [key, rows] of groupBy(sales, (sale) => `${sale.month}|${sale.manager}|${sale.counsellorKey}|${sale.counsellor}`).entries()) {
    const [month, manager, keyName, counsellor] = key.split("|");
    const target = targetFor(month, manager, keyName);
    const totalEntries = rows.length;
    const achievement = sum(rows, "achievement");
    const refunds = sum(rows, "refund");
    const complete = sum(rows, "complete");
    const amount = rows.filter((row) => row.complete).reduce((total, row) => total + row.amount, 0);
    bdeRows.push({
      month,
      monthLabel: monthLabel(month),
      manager,
      counsellor,
      counsellorKey: keyName,
      totalEntries,
      complete,
      achievement,
      refunds,
      downPayment: sum(rows, "downPayment"),
      loanInProgress: sum(rows, "loanInProgress"),
      completedAmount: amount,
      target,
      achievementPct: target ? achievement / target : 0,
      refundRate: totalEntries ? refunds / totalEntries : 0
    });
  }

  for (const month of months) {
    const rows = bdeRows.filter((row) => row.month === month);
    rows.sort((a, b) => b.achievementPct - a.achievementPct || b.achievement - a.achievement || a.refundRate - b.refundRate);
    rows.forEach((row, index) => {
      row.overallRank = index + 1;
      row.status = row.achievementPct >= 1 ? "Ahead" : row.achievementPct >= 0.75 ? "On Track" : row.refundRate >= 0.25 ? "At Risk" : "Behind";
    });
  }

  const momRows = [];
  for (const month of months) {
    for (const manager of MANAGERS) {
      const rows = sales.filter((sale) => sale.month === month && sale.manager === manager);
      if (!rows.length) continue;
      const target = bdeRows.filter((row) => row.month === month && row.manager === manager).reduce((total, row) => total + row.target, 0);
      const totalWorkingDays = workingDaysInMonth(month);
      const workingDaysElapsed = elapsedWorkingDays(month);
      const achievement = sum(rows, "achievement");
      const complete = sum(rows, "complete");
      const refunds = sum(rows, "refund");
      const activeBdes = new Set(rows.filter((row) => row.achievement).map((row) => row.counsellorKey)).size;
      const targetTillDate = target ? (target * workingDaysElapsed) / totalWorkingDays : 0;
      momRows.push({
        month,
        monthLabel: monthLabel(month),
        manager,
        totalEntries: rows.length,
        complete,
        achievement,
        refunds,
        downPayment: sum(rows, "downPayment"),
        loanInProgress: sum(rows, "loanInProgress"),
        completedAmount: rows.filter((row) => row.complete).reduce((total, row) => total + row.amount, 0),
        target,
        achievementPct: target ? achievement / target : 0,
        refundRate: rows.length ? refunds / rows.length : 0,
        activeBdes,
        productivity: activeBdes ? achievement / activeBdes : 0,
        totalWorkingDays,
        workingDaysElapsed,
        targetTillDate,
        mtdDeficit: Math.max(0, targetTillDate - achievement),
        requiredDrr: Math.max(0, (target - achievement) / Math.max(1, totalWorkingDays - workingDaysElapsed))
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
    sales
  };
}

async function dashboardData() {
  const datasets = await Promise.all(MANAGERS.map(async (manager) => {
    const { rows, source } = await loadSheetCsv(manager);
    return { manager, source, sales: extractRows(manager, rows) };
  }));
  return buildModel(
    datasets.flatMap((dataset) => dataset.sales),
    datasets.map((dataset) => `${dataset.manager}: ${dataset.source}`).join(", ")
  );
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    if (url.pathname === "/api/data") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(await dashboardData()));
      return;
    }
    const filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    response.setHeader("Content-Type", contentType(filePath));
    response.end(await fs.readFile(filePath));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.stack || String(error));
  }
});

server.listen(PORT, () => {
  console.log(`Sales dashboard running at http://localhost:${PORT}`);
});
