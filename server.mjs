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
async function dashboardData() {
  const [momRows, bdeRows, srcRows] = await Promise.all([
    loadSheetCsv("Rebuilt MOM").then(parseMOM),
    loadSheetCsv("Rebuilt BDE Rankings").then(parseBDE),
    loadSheetCsv("Source Reconciliation"),
  ]);

  // Parse source reconciliation for lead details
  const hdr = srcRows[0].map(h => clean(h).toLowerCase());
  const sales = srcRows.slice(1).filter(r => r.some(c => clean(c))).map(r => {
    const o = {};
    hdr.forEach((h, i) => o[h] = clean(r[i] ?? ""));
    const rawBucket = o["status bucket"] || "";
    const bnorm = norm(rawBucket);
    let bucket = rawBucket;
    if (bnorm.includes('complete') || bnorm.includes('rfd')) bucket = 'Complete/RFD';
    else if (bnorm.includes('refund')) bucket = 'Refund Requested';
    else if (bnorm.includes('down')) bucket = 'Down Payment';
    else if (bnorm.includes('loan')) bucket = 'Loan In Progress';

   // Parse month from the pre-calculated month column, fallback to enrollment date
const rawMonth = o["month"] || "";
const monthVal = rawMonth.match(/^\d{4}-\d{2}$/) ? rawMonth : (() => {
  const d = o["enrollment date"] || "";
  const sep = d.includes('/') ? '/' : '-';
  const p = d.split(sep);
  if(p.length === 3) {
    const a=Number(p[0]),b=Number(p[1]),c=Number(p[2]);
    if(c>=1000) return `${c}-${String(b).padStart(2,'0')}`;
    if(a>=1000) return `${a}-${String(b).padStart(2,'0')}`;
  }
  return "";
})();
return {
  date: o["enrollment date"],
  month: monthVal,         // ← use the pre-calculated month column (yyyy-mm)
      manager: o["manager"],
      counsellor: o["counsellor"],
      learner: o["learner"],
      amount: parseNum(o["amount parsed"] || o["amount raw"]),
      bucket,
      _rawBucket: rawBucket,
    };
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