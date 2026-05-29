import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
const PORT = Number(process.env.PORT || 4173);

// ── Email config ────────────────────────────────────────────
const EMAIL_FROM = process.env.EMAIL_FROM || "yogesh.gautam01@codingninjas.com";
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || "";
const EMAIL_TO = [
  "azhaan.yezdani@codingninjas.com",
  "mohd.nazim@codingninjas.com",
  "priyanka.jaiswal@codingninjas.com",
  "yogesh.gautam01@codingninjas.com",
];

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
  return rows.slice(1).filter(r => r.some(c => clean(c))).map(r => {
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
      month: r.month, monthLabel: monthLabel(r.month), manager: r.manager,
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
      month: r.month, manager: r.manager,
      counsellor: r["bde/counsellor"], counsellorKey: r["counsellor key"],
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
  const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];
  const [momRows, bdeRows, ...rawTabs] = await Promise.all([
    loadSheetCsv("Rebuilt MOM").then(parseMOM),
    loadSheetCsv("Rebuilt BDE Rankings").then(parseBDE),
    ...MANAGERS.map(m => loadSheetCsv(m)),
  ]);

  const sales = [];
  MANAGERS.forEach((manager, idx) => {
    const rows = rawTabs[idx];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateRaw = clean(row[0] || "");
      if (!dateRaw) continue;
      const sep = dateRaw.includes('/') ? '/' : '-';
      const parts = dateRaw.split(sep);
      if (parts.length !== 3) continue;
      const a = Number(parts[0]), b = Number(parts[1]), c = Number(parts[2]);
      let month = "";
      if (c >= 1000) month = `${c}-${String(b).padStart(2,'0')}`;
      else if (a >= 1000) month = `${a}-${String(b).padStart(2,'0')}`;
      if (!month) continue;
      const statusRaw = clean(row[6] || "");
      const sn = statusRaw.toLowerCase().replace(/\s+/g,' ').trim();
      let bucket = "Other";
      if (["full payment recieved","full payment received","manual payment"].includes(sn)) bucket = "Complete/RFD";
      else if (sn === "refund requested") bucket = "Refund Requested";
      else if (sn === "down payment") bucket = "Down Payment";
      else if (sn === "loan in progress") bucket = "Loan In Progress";
      const ar = clean(row[5]||"").toLowerCase().replace(/,/g,'').replace(/\s+/g,'');
      const mul = ar.endsWith('k') ? 1000 : 1;
      const amount = (parseFloat(ar.endsWith('k') ? ar.slice(0,-1) : ar) || 0) * mul;
      sales.push({ date: dateRaw, month, manager, counsellor: clean(row[1]||""), learner: clean(row[2]||""), amount, bucket, status: statusRaw });
    }
  });

  const months = [...new Set(momRows.map(r => r.month))].sort();
  const latestMonth = months.at(-1);
  return { generatedAt: new Date().toISOString(), dataSource: "Rebuilt MOM + Rebuilt BDE Rankings (live)", latestMonth, latestMonthLabel: monthLabel(latestMonth), months, momRows, bdeRows, sales };
}

// ── Email sender (no external deps — uses Gmail SMTP via raw TCP) ──
async function sendEmail(subject, htmlBody) {
  if (!EMAIL_APP_PASSWORD) { console.log("EMAIL_APP_PASSWORD not set, skipping email"); return; }
  try {
    const { createTransport } = await import("nodemailer");
    const transporter = createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: EMAIL_FROM, pass: EMAIL_APP_PASSWORD.replace(/\s/g, "") },
    });
    await transporter.sendMail({
      from: `"Yogesh's Sales Desk" <${EMAIL_FROM}>`,
      to: EMAIL_TO.join(", "),
      subject,
      html: htmlBody,
    });
    console.log(`Email sent: ${subject}`);
  } catch (err) {
    console.error("Email send failed:", err.message);
  }
}

// ── Build daily summary email HTML ─────────────────────────
function buildEmailHtml(data) {
  const latest = data.latestMonth;
  const mom = data.momRows.filter(r => r.month === latest);
  const totalAch = mom.reduce((a, r) => a + r.achievement, 0);
  const totalTgt = mom.reduce((a, r) => a + r.target, 0);
  const totalPct = totalTgt ? ((totalAch / totalTgt) * 100).toFixed(1) : "0.0";
  const refundAlerts = mom.filter(r => r.refundRate > 0.15);

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const achColor = totalAch / totalTgt >= 0.8 ? "#15803d" : totalAch / totalTgt >= 0.5 ? "#b7791f" : "#b42318";

  const managerRows = mom.sort((a, b) => b.achievementPct - a.achievementPct).map(r => {
    const pctVal = (r.achievementPct * 100).toFixed(1);
    const color = r.achievementPct >= 0.8 ? "#15803d" : r.achievementPct >= 0.5 ? "#b7791f" : "#b42318";
    const deficitColor = r.mtdDeficit > 0 ? "#b42318" : "#15803d";
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;font-weight:600">${r.manager}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center">${r.achievement} / ${r.target}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${color};font-weight:700">${pctVal}%</td>
        <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${deficitColor};font-weight:600">${r.mtdDeficit.toFixed(1)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${r.refundRate > 0.15 ? '#b42318' : '#15803d'}">${(r.refundRate * 100).toFixed(1)}%</td>
      </tr>`;
  }).join("");

  const alertSection = refundAlerts.length > 0 ? `
    <div style="margin:24px 0;padding:16px 20px;background:#fff1f2;border-left:4px solid #b42318;border-radius:6px">
      <div style="font-weight:700;color:#b42318;margin-bottom:8px">⚠️ Refund Rate Alert (above 15%)</div>
      ${refundAlerts.map(r => `<div style="color:#b42318;font-size:14px;margin:4px 0">• ${r.manager}: ${(r.refundRate * 100).toFixed(1)}% refund rate</div>`).join("")}
    </div>` : `
    <div style="margin:24px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #15803d;border-radius:6px">
      <div style="color:#15803d;font-weight:600">✅ All refund rates within 15% threshold</div>
    </div>`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Inter,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#101828;border-radius:12px 12px 0 0;padding:24px 28px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;background:#e53935;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px">CN</div>
        <div>
          <div style="color:#fff;font-size:18px;font-weight:700">Yogesh's Sales Desk</div>
          <div style="color:#8090a8;font-size:12px">Daily Summary · ${dateStr}</div>
        </div>
      </div>
    </div>

    <!-- Overall KPI -->
    <div style="background:#fff;padding:24px 28px;border-left:1px solid #dce3ed;border-right:1px solid #dce3ed">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#687386;margin-bottom:12px">Overall · ${monthLabel(latest)}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;background:#f5f7fb;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Achievement</div>
          <div style="font-size:28px;font-weight:700;color:${achColor};margin:6px 0 2px">${totalAch}</div>
          <div style="font-size:12px;color:#687386">${totalPct}% of ${totalTgt} target</div>
        </div>
        <div style="flex:1;min-width:120px;background:#f5f7fb;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Total Target</div>
          <div style="font-size:28px;font-weight:700;color:#14213d;margin:6px 0 2px">${totalTgt}</div>
          <div style="font-size:12px;color:#687386">${monthLabel(latest)}</div>
        </div>
      </div>
    </div>

    <!-- Manager table -->
    <div style="background:#fff;padding:0 28px 24px;border-left:1px solid #dce3ed;border-right:1px solid #dce3ed">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#687386;padding:20px 0 12px">Manager Breakdown</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #edf1f6;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f5f7fb">
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Manager</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Ach / Target</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Ach %</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">MTD Deficit</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#687386;font-weight:700;text-transform:uppercase">Refund %</th>
          </tr>
        </thead>
        <tbody>${managerRows}</tbody>
      </table>
    </div>

    <!-- Alert section -->
    <div style="background:#fff;padding:0 28px 8px;border-left:1px solid #dce3ed;border-right:1px solid #dce3ed">
      ${alertSection}
    </div>

    <!-- Footer -->
    <div style="background:#f5f7fb;border:1px solid #dce3ed;border-top:none;border-radius:0 0 12px 12px;padding:16px 28px;text-align:center">
      <div style="font-size:11px;color:#687386">
        Auto-generated by <strong>Yogesh's Sales Desk</strong> · Data from Google Sheet · 
        <a href="https://cn-sales-dashboard-production.up.railway.app" style="color:#087f8c">Open Dashboard</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ── Daily scheduler — runs at 9:30 AM IST ──────────────────
function scheduleDaily() {
  function msUntilNext930() {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const next = new Date(ist);
    next.setHours(9, 30, 0, 0);
    if (ist >= next) next.setDate(next.getDate() + 1);
    return next - ist;
  }

  async function sendDailySummary() {
    try {
      console.log("Sending daily summary email...");
      const data = await dashboardData();
      const html = buildEmailHtml(data);
      const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const dateStr = ist.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      await sendEmail(`Sales Desk · Daily Summary · ${dateStr}`, html);
    } catch (err) {
      console.error("Daily summary failed:", err.message);
    }
    // Schedule next day
    setTimeout(sendDailySummary, msUntilNext930());
  }

  const ms = msUntilNext930();
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  console.log(`Daily summary scheduled — next send in ${hrs}h ${mins}m`);
  setTimeout(sendDailySummary, ms);
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
    // Test email endpoint — hit /api/test-email to send a test
    if (url.pathname === "/api/test-email") {
      const data = await dashboardData();
      const html = buildEmailHtml(data);
      await sendEmail("TEST — Sales Desk Daily Summary", html);
      res.setHeader("Content-Type", "text/plain");
      res.end("Test email sent! Check your inbox.");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("API route not found");
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

server.listen(PORT, () => {
  console.log(`Sales dashboard running at http://localhost:${PORT}`);
  scheduleDaily();
});