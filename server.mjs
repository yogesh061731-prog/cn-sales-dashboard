import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
const PORT = Number(process.env.PORT || 4173);

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = "onboarding@resend.dev";
const EMAIL_REPLY_TO = "yogesh.gautam01@codingninjas.com";
const EMAIL_TO = ["yogesh061731@gmail.com"];

const TWILIO_SID = process.env.TWILIO_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || "";
const TWILIO_FROM = "whatsapp:+14155238886";
const WHATSAPP_TO = ["whatsapp:+918178131435"];

// ─────────────────────────────────────────────
// RAW HELPERS
// ─────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ""; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== '\r') cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function clean(v) { return String(v ?? "").trim(); }
function parseNum(v) { return parseFloat(clean(v).replace(/,/g, "")) || 0; }
function parsePct(v) {
  const s = clean(v);
  return s.endsWith("%") ? parseFloat(s) / 100 || 0 : parseFloat(s) || 0;
}

function extractMonth(dateRaw) {
  const sep = dateRaw.includes("/") ? "/" : "-";
  const parts = dateRaw.split(sep);
  const [a, b, c] = parts.map(Number);

  if (c >= 1000) return `${c}-${String(b).padStart(2, "0")}`;
  if (a >= 1000) return `${a}-${String(b).padStart(2, "0")}`;
  return "";
}

// ─────────────────────────────────────────────
// KPI ENGINE (SINGLE SOURCE OF TRUTH)
// ─────────────────────────────────────────────

function calculateActivityUnit({ status, totalAmount, dpAmount }) {
  status = status.toLowerCase().trim();

  if (status.includes("refund")) {
    return { value: 0, type: "refund" };
  }

  if (status.includes("full") || status.includes("manual")) {
    return { value: 1, type: "complete" };
  }

  if (status.includes("down")) {
    if (dpAmount === 1000) return { value: 0.8, type: "dp" };
    if (dpAmount === 2500) return { value: 0.5, type: "dp" };
    if (dpAmount === 5000) return { value: 1, type: "dp" };
    return { value: 0, type: "dp" };
  }

  if (status.includes("loan")) {
    return { value: 0.3, type: "loan" };
  }

  if (totalAmount < 100000) {
    return { value: 0.5, type: "low_ticket" };
  }

  return { value: 0 };
}

// ─────────────────────────────────────────────
// CANONICAL MODEL BUILDERS
// ─────────────────────────────────────────────

function buildCanonicalSale(manager, row) {
  const date = clean(row[0]);
  const counsellor = clean(row[1]);
  const learner = clean(row[2]);

  const statusRaw = clean(row[6]);
  const status = statusRaw.toLowerCase();

  const totalAmount = parseNum(row[5]);
  const dpAmount = parseNum(row[8]);

  const bucket =
    status.includes("full") ? "Complete/RFD" :
    status.includes("refund") ? "Refund Requested" :
    status.includes("down") ? "Down Payment" :
    status.includes("loan") ? "Loan In Progress" :
    "Other";

  const activity = calculateActivityUnit({
    status,
    totalAmount,
    dpAmount
  });

  const isSelfSale =
    manager === "Azhaan" &&
    counsellor.toLowerCase().trim() === "azhaan";

  return {
    date,
    month: extractMonth(date),
    manager,
    counsellor,
    learner,
    revenue: totalAmount,
    dpAmount,
    bucket,
    status,
    activityUnit: isSelfSale ? 0 : activity.value,
    activityType: activity.type
  };
}

function buildCanonicalMOM(rows) {
  return rowsToObjects(rows)
    .filter(r => r.month && r.manager)
    .map(r => ({
      month: r.month,
      manager: r.manager,
      target: parseNum(r.target),
      activeBDEs: parseNum(r["active bdes"]),
      refundRate: parsePct(r["refund rate"]),
      mtdDeficit: parseNum(r["mtd deficit"])
    }));
}

// ─────────────────────────────────────────────
// CSV → OBJECT
// ─────────────────────────────────────────────

function rowsToObjects(rows) {
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().trim());

  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = clean(row[i]));
    return obj;
  });
}

// ─────────────────────────────────────────────
// AGGREGATION LAYER
// ─────────────────────────────────────────────

function computeManagerKPIs(momRows, salesRows, month) {
  const mom = momRows.filter(m => m.month === month);
  const sales = salesRows.filter(s => s.month === month);

  return mom.map(m => {
    const s = sales.filter(x => x.manager === m.manager);

    const totalActivity = s.reduce((a, b) => a + b.activityUnit, 0);
    const totalRevenue = s.reduce((a, b) => a + b.revenue, 0);

    return {
      manager: m.manager,
      target: m.target,
      activeBDEs: m.activeBDEs,
      refundRate: m.refundRate,

      totalActivity,
      totalRevenue,

      achievementPct: m.target ? totalActivity / m.target : 0,
      mtdDeficit: m.mtdDeficit
    };
  });
}

function computeBDELeaderboard(salesRows, month) {
  const filtered = salesRows.filter(s => s.month === month);

  const map = {};

  for (const r of filtered) {
    if (!map[r.counsellor]) {
      map[r.counsellor] = {
        bde: r.counsellor,
        manager: r.manager,
        activity: 0,
        revenue: 0
      };
    }

    map[r.counsellor].activity += r.activityUnit;
    map[r.counsellor].revenue += r.revenue;
  }

  return Object.values(map).sort((a, b) => b.activity - a.activity);
}

// ─────────────────────────────────────────────
// MAIN DATA PIPELINE
// ─────────────────────────────────────────────

async function loadSheetCsv(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
  const res = await fetch(url);
  return parseCsv(await res.text());
}

async function dashboardData() {
  const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];

  const [momRaw, ...managerTabs] = await Promise.all([
    loadSheetCsv("Rebuilt MOM"),
    ...MANAGERS.map(m => loadSheetCsv(m))
  ]);

  const momRows = buildCanonicalMOM(momRaw);

  const sales = [];

  MANAGERS.forEach((manager, i) => {
    const rows = managerTabs[i];

    for (let j = 1; j < rows.length; j++) {
      if (!rows[j]?.length) continue;
      sales.push(buildCanonicalSale(manager, rows[j]));
    }
  });

  const months = [...new Set(momRows.map(m => m.month))].sort();
  const latestMonth = months.at(-1);

  return {
    generatedAt: new Date().toISOString(),
    latestMonth,
    managers: computeManagerKPIs(momRows, sales, latestMonth),
    leaderboard: computeBDELeaderboard(sales, latestMonth)
  };
}

// ─────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/data") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(await dashboardData()));
  }

  const filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  res.end(await fs.readFile(filePath));
});

server.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
});