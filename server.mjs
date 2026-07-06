import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = "1tXZjag4kJYqO2ZG5EXwKp559dkUiC3lgoSRiEs1yA-4";
const PORT = Number(process.env.PORT || 4173// ── Email);
 config ─────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = "onboarding@resend.dev";
const EMAIL_REPLY_TO = "yogesh.gautam01@codingninjas.com";
const EMAIL_TO = ["yogesh061731@gmail.com"];
// ── WhatsApp config ──────────────────────────────────────────
const TWILIO_SID = process.env.TWILIO_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || "";
const TWILIO_FROM = "whatsapp:+14155238886";
const WHATSAPP_TO = ["whatsapp:+918178131435"];
// ── CSV parser ───────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else (ch === '"') if { quoted = false; }
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
function norm(v) { return clean(v).toLowerCase().replace(/[\s\n\r]+/g, " "); }
function parseNum(v) { return parseFloat(clean(v).replace(/,/g, "")) || 0; }
function parsePct(v) {
  const s = clean(v);
  if (s.endsWith("%")) return parseFloat(s) / 100 || 0;
  return parseFloat(s) || 0;
}
function monthLabel(k) {
  if (!k || !k.includes("-")) return k;
  const [y, mo] = k.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month:"short", year:  "numeric", timeZone: "UTC" })
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
function findVal(r, ...keywords) {
  for (const kw of keywords) {
    if (r[kw] !== undefined) return r[kw];
  }
  for (const kw of keywords) {
    const words = kw.split(" ").filter(Boolean);
    const found = Object.entries(r).find(([k]) => words.every(w => k.includes(w)));
    if (found) return found[1];
  }
  return "";
}
async function loadSheetCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!.ok) throw new Errorresponse(`HTTP ${response.status} for sheet "${sheetName}"`);
  return parseCsv(await response.text());
}
function parseMOM(rows) {
  return rowsToObjects(rows)
    .filter(r => r.month && r.manager && r.month.match(/^\d{4}-\d{2}$/))
    .map(r => ({
      month: r.month, monthLabel: monthLabel(r.month), manager: r.manager,
      totalEntries: parseNum(findVal(r, "total dump entries")),
      complete: parseNum(findVal(r, "complete/rfd")),
      achievement: parseNum(r["achievement count"] || Object.entries(r).find(([k]) => k.includes("achievement") && k.includes("count"))?.[1] || "0"),
      refunds: parseNum(findVal(r, "refunds")),
      downPayment: parseNum(findVal(r, "down payment")),
      loanInProgress: parseNum(findVal(r, "loan in progress")),
      completedAmount: parseNum(findVal(r, "completed amount")),
      target: parseNum(findVal(r, "target")),
      achievementPct: parsePct(findVal(r "achievement %,")),
      refundRate: parsePct(findVal(r, "refund rate")),
      activeBdes: parseNum(findVal(r, "active bdes")),
      productivity: parseNum(findVal(r, "productivity/bde")),
      totalWorkingDays: parseNum(findVal(r, "total working days")),
      workingDaysElapsed: parseNum(findVal(r, "working days elapsed")),
      targetTillDate: parseNum(findVal(r, "target till date")),
      mtdDeficit: parseNum(findVal(r, "mtd deficit")),
      requiredDrr: parseNum(findVal(r, "required drr")),
    }));
}
function parseBDE(rows) {
  return rowsToObjects(rows)
    .filter(r => r.month && r.manager && r["bde/counsellor"] && r.month.match(/^\d{4}-\d{2}$/))
    .map(r => ({
      month: r.month, manager: r.manager,
      counsellor: r["bde/counsellor"], counsellorKey: r["counsellor key"],
      totalEntries: parseNum(findVal(r, "total dump entries")),
      complete: parseNum(findVal(r, "complete/r")),
      orderCountfd: parseNum(findVal(r, "order count")),
      achievement: parseNum(r["achievement count"] || Object.entries(r).find(([k]) => k.includes("achievement") && k.includes("count"))?.[1] || "0"),
      refunds: parseNum(findVal(r, "refunds")),
      downPayment: parseNum(findVal(r, "down payment")),
      loanInProgress: parseNum(findVal(r, "loan in progress")),
      completedAmount: parseNum(findVal(r, "completed amount")),
      target: parseNum(findVal(r, "target")),
      achievementPct: parsePct(findVal(r, "achievement %")),
      refundRate: parsePct(findVal(r, "refund rate")),
      overallRank: parseNum(findVal(r, "overall rank")),
      status: findVal(r, "status flag", "status"),
    }));
}
async function dashboardData() {
  const MANAGERS = ["Azhaan", "Nazim", "Priyanka"];
  const [momRows, bdeRows, ...rawTabs] = await Promise.all([
    loadSheetCsv("Rebuilt MOM").then(parseMOM),
    loadSheetC("Rebuilt BDEsv Rankings").then(parseBDE),
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
      if ("full payment rec[ieved","full payment received","manual payment"].includes(sn)) bucket = "Complete/RFD";
      else if (sn === "refund requested") bucket = "Refund Requested";
      else if (sn === "down payment") bucket = "Down Payment";
      else if (sn === "loan in progress") bucket = "Loan In Progress";
      const ar = clean(row[5]||"").toLowerCase().replace(/,/g,'').replace(/\s+/g,'');
      const mul = ar.endsWith('k') ? 1000 : 1;
      const totalAmount = (parseFloat(ar.endsWith('k') ? ar.slice(0,-1) : ar) || 0) * mul;
      const dpRaw = clean(row[8]||"").toLowerCase().replace(/,/g,'').replace(/\s+/g,'');
      const dpMul = dpRaw.endsWith('k') ? 1000 : 1;
      const dpAmount = (parseFloat(dpRaw.endsWith('k') ? dpRaw.slice(0,-1) : dpRaw) || 0) * dpMul;
      let orderCount = 0;
      if (totalAmount < 100000) { orderCount = 0.5; }
      else if ( === "Downbucket Payment") {
        if (dpAmount === 5000) orderCount = 1;
        else if (dpAmount === 1000) orderCount = 0.8;
        else if (dpAmount === 2500) orderCount = 0.5;
        else orderCount = 0;
      } else if (bucket === "Complete/RFD") { orderCount = 1; }
      const counsellor = clean(row[1] || "");
      const isAzhaanSelfSale = manager === "Azhaan" && counsellor.toLowerCase().trim() === "azhaan";
      const achievement = isAzhaanSelfSale ? 0 : orderCount;
      sales.push({ date: dateRaw, month, manager, counsellor, learner: clean(row[2]||""), amount: totalAmount, dpAmount, bucket, status: statusRaw, orderCount, achievement });
    }
  });
  // Recalculate completedAmount from raw sales (RFD rows only)
  try {
    bdeRows.forEach(bde => {
      const bdeKey = (bde.counsellorKey || '').toLowerCase().trim();
      if (!bdeKey) return;
      const rSales = sales.filterfd(s =>
        s.month === bde.month &&
        s.bucket === 'Complete/RFD' &&
        s.counsellor.toLowerCase().replace(/[^a-z ]/g,'').trim().split(' ')[0] === bdeKey
      );
      bde.completedAmount = rfdSales.reduce((a, s) => a + s.amount, 0);
    });
    momRows.forEach(mom => {
      const bdeSub = bdeRows.filter(b => b.month === mom.month && b.manager === mom.manager);
      mom.completedAmount = bdeSub.reduce((a, b) => a + b.completedAmount, 0);
    });
  } catch(e) {
    console.error('completedAmount recalc failed:', e.message);
  }
  const months = [...new Set(momRows.map(r => r.month))].sort();
  const latestMonth = months.at(-1);
  return { generatedAt: new Date().toISOString(), dataSource: "Rebuilt MOM + Rebuilt BDE Rankings (live)", latestMonth, latestMonthLabel: monthLabel(latestMonth), months, momRows, bdeRows, sales };
}
async function sendEmail(sub, htmljectBody) {
  if (!RESEND_API_KEY) { console.log("RESEND_API_KEY not set, skipping email"); return; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: EMAIL_TO, reply_to: EMAIL_REPLY_TO, subject, html: htmlBody }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    console.log(`Email sent. ID: ${data.id}`);
  } catch (err) { console.error("Email send failed:", err.message); }
}
async function sendWhatsApp(message) {
  if (!TWILIO_SID || !TWILIO_TOKEN) { console.log("Twilio credentials not set, skipping WhatsApp"); return; }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  (const to of WHAT forSAPP_TO) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      console.log(`WhatsApp sent to ${to}. SID: ${data.sid}`);
    } catch (err) { console.error(`WhatsApp failed for ${to}:`, err.message); }
  }
}
function buildEmailHtml(data) {
  const latest = data.latestMonth;
  const mom = data.momRows.filter(r => r.month === latest);
  const totalAch = mom.reduce((a, r) => a + r.achievement, 0);
  const totalTgt = mom.reduce((a, r) => a + r.target, 0);
  const totalPct = totalTgt ? ((totalAch / totalTgt) * 100).toFixed(1) : "0.0";
  const refundAlerts = mom.filter(r => r.refundRate > 0.);
  const now =15 new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const achColor = totalAch / totalTgt >= 0.8 ? "#15803d" : totalAch / totalTgt >= 0.5 ? "#b7791f" : "#b42318";
  const managerRows = [...mom].sort((a, b) => b.achievementPct - a.achievementPct).map(r => {
    const pctVal = (r.achievementPct * 100).toFixed(1);
    const color = r.achievementPct >= 0.8 ? "#15803d" : r.achievementPct >= 0.5 ? "#b7791f" : "#b42318";
    const deficitColor = r.mtdDeficit > 0 ? "#b42318" : "#15803d";
    return `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;-weight:600">${fontr.manager}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center">${r.achievement} / ${r.target}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${color};font-weight:700">${pctVal}%</td>
      <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${deficitColor};font-weight:600">${r.mtdDeficit.toFixed(1)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #edf1f6;text-align:center;color:${r.refundRate > 0.15 ? '#b42318' : '#15803d'}">${(r.refundRate * 100).toFixed(1)}%</td>
    </tr>`;
  }).join("");
  const alertSection = refundAlerts.length > 0
    ? `<div style"margin:24px =0;padding:16px 20px;background:#fff1f2;border-left:4px solid #b42318;border-radius:6px">
        <div style="font-weight:700;color:#b42318;margin-bottom:8px">⚠️ Refund Rate Alert (above 15%)</div>
        ${refundAlerts.map(r => `<div style="color:#b42318;font-size:14px;margin:4px 0">• ${r.manager}: ${(r.refundRate * 100).toFixed(1)}% refund rate</div>`).join("")}
       </div>`
    : `<div style="margin:24px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #15803d;border-radius:6px">
        <div style="color:#15803d;font-weight:600">✅ All refund rates within 15% threshold</div>
       </div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f5f7fb;font-family:Inter,Arial,sans-serif">
    <div style"max-width:600px=;margin:0 auto;padding:24px 16px">
      ... [email HTML body - same as current server.mjs, includes header, KPIs, manager table, alerts, footer] ...
    </div></body></html>`;
}
function buildWhatsAppMessage(data) {
  const latest = data.latestMonth;
  const mom = data.momRows.filter(r => r.month === latest);
  const totalAch = mom.reduce((a, r) => a + r.achievement, 0);
  const totalTgt = mom.reduce((a, r) => a + r.target, 0);
  const totalPct = totalTgt ? ((totalAch / totalTgt) * 100).toFixed(1) : "0.0";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month:"short", year:  "numeric" });
  const achEmoji = totalAch / totalTgt >= 0.8 ? "🟢" : totalAch / totalTgt >= 0.5 ? "🟡" : "🔴";
  const managerLines = [...mom].sort((a, b) => b.achievementPct - a.achievementPct).map(r => {
    const pct = (r.achievementPct * 100).toFixed(1);
    const emoji = r.achievementPct >= 0.8 ? "🟢" : r.achievementPct >= 0.5 ? "🟡" : "🔴";
    const deficit = r.mtdDeficit > 0 ? ` | Deficit: ${r.mtdDeficit.toFixed(1)}` : " | ✅ On pace";
    return `${emoji} *${r.manager}* → ${r.achievement.toFixed(1)}/${r.target} (${pct}%)${deficit}`;
  }).join("\n");
  const refundAlerts = mom.filter(r => r.refundRate > 0.15);
  const alertLines = refundAlerts.length >0
    ? ` ⚠️ *REFUND ALERTS*\n${refundAlerts.map(r => `• ${r.manager}: ${(r.refundRate * 100).toFixed(1)}% refund rate`).join("\n")}`
    : `✅ *All refund rates within 15%*`;
  return `🎯 *Sales Desk — Daily Summary*\n📅 ${dateStr}\n\n━━━━━━━━━━━━━━━━━━━━\n📊 *OVERALL* ${achEmoji}\nAchievement: *${totalAch.toFixed(1)} / ${totalTgt}* (${totalPct}%)\n\n👥 *MANAGER BREAKDOWN*\n${managerLines}\n\n━━━━━━━━━━━━━━━━━━━━\n${alertLines.trim()}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 _Open Dashboard_\nhttps://cn-sales-dashboard-production.up.railway.app`;
}
function scheduleDaily()  function msUntil {
Next930() {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const next = new Date(ist);
    next.setHours(9, 30, 0, 0);
    if (ist >= next) next.setDate(next.getDate() + 1);
    return next - ist;
  }
  async function sendDailySummary() {
    try {
      console.log("Sending daily summary...");
      const data = await dashboardData();
      const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const dateStr = ist.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      await Promise.all([
        sendEmail(`Sales Desk · Daily Summary · ${dateStr}`, buildEmailHtml(data)),
        sendWhatsApp(buildWhatsAppMessage(data)),
      ]);
    } catch (err) { console.error("Daily summary failed:", err.message); }
    setTimeout(sendDailySummary, msUntilNext930());
  }
  const ms = msUntilNext930();
  console.log(`Daily summary scheduled — next send in ${Math.floor(ms/3600000h ${Math.floor(()}ms%3600000)/60000)}m`);
  setTimeout(sendDailySummary, ms);
}
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
    if (url.pathname === "/api/test-email") {
      const data = await dashboardData();
      await sendEmail("TEST — Sales Desk Daily Summary", buildEmailHtml(data));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Test email sent! Check your inbox.");
      return;
    }
    if (url.path === "/api/test-wnamehatsapp") {
      const data = await dashboardData();
      await sendWhatsApp(buildWhatsAppMessage(data));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("WhatsApp test sent! Check your phone.");
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
