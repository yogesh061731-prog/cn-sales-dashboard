import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
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

function parseNum(v) { return parseFloat(clean(v).replace(/,/g, "")) || 0; }
function parsePct(v) {
  const s = clean(v);
  if (s.endsWith("%")) return parseFloat(s) / 100 || 0;
  return parseFloat(s) || 0;
}

function monthLabel(k) {
  if (!k || !k.includes("-")) return k;
  const [y, mo] = k.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, mo - 1, 1)));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const hdr = rows[0].map(h => norm(h));
  return rows.slice(1)
    .filter(r => r.some(c => clean(c)))
    .map(r => {
      const o = {};
      hdr.forEach((h, i) => o[h] = clean(r[i] ?? ""));
      return o;
    });
}

// ── Fetch a sheet tab ───────────────────────────────────────
async function loadSheetCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for sheet "${sheetName}"`);
  return parseCsv(await response.text());
}

// ── Parse Rebuilt MOM tab ───────────────────────────────────
function parseMOM(rows) {
  return rowsToObjects(rows)
    .filter(r => r.month && r.manager && r.month.match(/^\d{4}-\d{2}$/))
    .map(r => ({
      month: r.month,
      monthLabel: monthLabel(r.month),
      manager: r.manager,
      totalEntries: parseNum(r["total dump entries"]),
      complete: parseNum(r["complete/rfd"]),
      achievement: parseNum(r["achievement sales"]),
      refunds: parseNum(r.refunds),
      downPayment: parseNum(r["down payment"]),
      loanInProgress: parseNum(r["loan in progress"]),
      completedAmount: parseNum(r["completed amount"]),
      target: parseNum(r.target),
      achievementPct: parsePct(r["achievement %"]),
      refundRate: parsePct(r["refund rate"]),
      activeBdes: parseNum(r["active bdes"]),
      productivity: parseNum(r["productivity/bde"]),
      totalWorkingDays: parseNum(r["total working days"]),
      workingDaysElapsed: parseNum(r["working days elapsed"]),
      targetTillDate: parseNum(r["target till date"]),
      mtdDeficit: parseNum(r["mtd deficit"]),
      requiredDrr: parseNum(r["required drr"]),
    }));
}

// ── Parse Rebuilt BDE Rankings tab ─────────────────────────
function parseBDE(rows) {
  return rowsToObjects(rows)
    .filter(r => r.month && r.manager && r["bde/counsellor"] && r.month.match(/^\d{4}-\d{2}$/))
    .map(r => ({
      month: r.month,
      manager: r.manager,
      counsellor: r["bde/counsellor"],
      counsellorKey: r["counsellor key"],
      totalEntries: parseNum(r["total dump entries"]),
      complete: parseNum(r["complete/rfd"]),
      achievement: parseNum(r["achievement sales"]),
      refunds: parseNum(r.refunds),
      downPayment: parseNum(r["down payment"]),
      loanInProgress: parseNum(r["loan in progress"]),
      completedAmount: parseNum(r["completed amount"]),
      target: parseNum(r.target),
      achievementPct: parsePct(r["achievement %"]),
      refundRate: parsePct(r["refund rate"]),
      overallRank: parseNum(r["overall rank"]),
      status: clean(r["status flag"] || r.status || ""),
    }));
}

// ── Main data loader ────────────────────────────────────────
// ── Main data loader ────────────────────────────────────────
async function dashboardData() {
  const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];

  const [momRows, bdeRows, ...rawTabs] = await Promise.all([
    loadSheetCsv("Rebuilt MOM").then(parseMOM),
    loadSheetCsv("Rebuilt BDE Rankings").then(parseBDE),
    ...MANAGERS.map(m => loadSheetCsv(m)),
  ]);

  // Build sales array directly from raw manager tabs
  const sales = [];
  MANAGERS.forEach((manager, idx) => {
    const rows = rawTabs[idx];
    // Skip header row (row 0) — Priyanka's sheet has header on row 0
    const startRow = 1;
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      const dateRaw = clean(row[0] || "");
      if (!dateRaw) continue;

      // Parse date dd/mm/yyyy or dd-mm-yyyy
      const sep = dateRaw.includes('/') ? '/' : '-';
      const parts = dateRaw.split(sep);
      if (parts.length !== 3) continue;
      const a = Number(parts[0]), b = Number(parts[1]), c = Number(parts[2]);
      let month = "";
      if (c >= 1000) month = `${c}-${String(b).padStart(2,'0')}`;
      else if (a >= 1000) month = `${a}-${String(b).padStart(2,'0')}`;
      if (!month) continue;

      const counsellor = clean(row[1] || "");
      const learner = clean(row[2] || "");
      const amountRaw = clean(row[5] || "");
      const statusRaw = clean(row[6] || "");

      // Normalise status to bucket
      const sn = statusRaw.toLowerCase().replace(/\s+/g,' ').trim();
      let bucket = "Other";
      if (["full payment recieved","full payment received","manual payment"].includes(sn)) bucket = "Complete/RFD";
      else if (sn === "refund requested") bucket = "Refund Requested";
      else if (sn === "down payment") bucket = "Down Payment";
      else if (sn === "loan in progress") bucket = "Loan In Progress";

      // Parse amount
      const ar = amountRaw.toLowerCase().replace(/,/g,'').replace(/\s+/g,'');
      const mul = ar.endsWith('k') ? 1000 : 1;
      const amount = (parseFloat(ar.endsWith('k') ? ar.slice(0,-1) : ar) || 0) * mul;

      sales.push({
        date: dateRaw,
        month,
        manager,
        counsellor,
        learner,
        amount,
        bucket,
        status: statusRaw,
      });
    }
  });

  const months = [...new Set(momRows.map(r => r.month))].sort();
  const latestMonth = months.at(-1);

  return {
    generatedAt: new Date().toISOString(),
    dataSource: "Rebuilt MOM + Rebuilt BDE Rankings (live)",
    latestMonth,
    latestMonthLabel: monthLabel(latestMonth),
    months,
    momRows,
    bdeRows,
    sales,
  };
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