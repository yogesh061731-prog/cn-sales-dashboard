const state = {
  data: null,
  month: null
};

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function pct(value) {
  return `${number.format((value || 0) * 100)}%`;
}

function fmt(value) {
  return money.format(value || 0);
}

function clsForPct(value) {
  if (value >= 0.8) return "good";
  if (value >= 0.5) return "warn";
  return "bad";
}

function renderMetric(label, value, detail) {
  return `
    <article class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>
  `;
}

async function loadData() {
  const response = await fetch("/api/data");
  if (!response.ok) throw new Error("Unable to load dashboard data");
  state.data = await response.json();
  state.month = state.month || state.data.latestMonth;
  renderMonthSelect();
  render();
}

function renderMonthSelect() {
  const select = document.querySelector("#monthSelect");
  select.innerHTML = state.data.months
    .slice()
    .reverse()
    .map((month) => `<option value="${month}" ${month === state.month ? "selected" : ""}>${month}</option>`)
    .join("");
}

function monthMomRows() {
  return state.data.momRows.filter((row) => row.month === state.month);
}

function monthBdeRows() {
  return state.data.bdeRows.filter((row) => row.month === state.month);
}

function renderMetrics(rows) {
  const totalEntries = rows.reduce((sum, row) => sum + row.totalEntries, 0);
  const achievement = rows.reduce((sum, row) => sum + row.achievement, 0);
  const target = rows.reduce((sum, row) => sum + row.target, 0);
  const refunds = rows.reduce((sum, row) => sum + row.refunds, 0);
  const amount = rows.reduce((sum, row) => sum + row.completedAmount, 0);
  document.querySelector("#overview").innerHTML = [
    renderMetric("Achievement", fmt(achievement), `${fmt(target)} target, ${pct(target ? achievement / target : 0)} achieved`),
    renderMetric("Total Dump Entries", fmt(totalEntries), "All dated rows from source tabs"),
    renderMetric("Refund Rate", pct(totalEntries ? refunds / totalEntries : 0), `${fmt(refunds)} refund requests`),
    renderMetric("Completed Amount", `₹${fmt(amount)}`, "Context metric, sale count remains primary")
  ].join("");
}

function renderMom(rows) {
  document.querySelector("#momRows").innerHTML = rows
    .slice()
    .sort((a, b) => b.achievementPct - a.achievementPct)
    .map((row) => `
      <tr>
        <td><strong>${row.manager}</strong></td>
        <td class="num">${fmt(row.totalEntries)}</td>
        <td class="num">${fmt(row.complete)}</td>
        <td class="num">${fmt(row.achievement)}</td>
        <td class="num">${fmt(row.target)}</td>
        <td>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, row.achievementPct * 100)}%"></div></div>
          <span class="${clsForPct(row.achievementPct)}">${pct(row.achievementPct)}</span>
        </td>
        <td class="num ${row.mtdDeficit ? "bad" : "good"}">${number.format(row.mtdDeficit)}</td>
        <td class="num">${number.format(row.requiredDrr)}</td>
        <td class="num ${row.refundRate >= 0.2 ? "bad" : "good"}">${pct(row.refundRate)}</td>
      </tr>
    `)
    .join("");
}

function renderPace(rows) {
  document.querySelector("#paceCards").innerHTML = rows
    .slice()
    .sort((a, b) => b.requiredDrr - a.requiredDrr)
    .map((row) => `
      <div class="pace-card">
        <div class="pace-card-head">
          <strong>${row.manager}</strong>
          <span>${row.workingDaysElapsed}/${row.totalWorkingDays} days</span>
        </div>
        <div class="split-row"><span>Target till date</span><strong>${number.format(row.targetTillDate)}</strong></div>
        <div class="split-row"><span>MTD deficit</span><strong class="${row.mtdDeficit ? "bad" : "good"}">${number.format(row.mtdDeficit)}</strong></div>
        <div class="split-row"><span>Required DRR</span><strong>${number.format(row.requiredDrr)}</strong></div>
      </div>
    `)
    .join("");
}

function renderLeaderBoard(rows) {
  const visible = rows
    .slice()
    .sort((a, b) => b.achievementPct - a.achievementPct || b.achievement - a.achievement || a.refundRate - b.refundRate)
    .slice(0, 10);
  document.querySelector("#leaderRows").innerHTML = visible
    .map((row, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td><strong>${row.counsellor}</strong></td>
        <td>${row.manager}</td>
        <td class="num">${fmt(row.achievement)}</td>
        <td class="num">${fmt(row.target)}</td>
        <td class="num ${clsForPct(row.achievementPct)}">${pct(row.achievementPct)}</td>
        <td class="num ${row.refundRate >= 0.2 ? "bad" : "good"}">${pct(row.refundRate)}</td>
      </tr>
    `)
    .join("");
}

function renderStatusSplit(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.complete += row.complete;
    acc.refunds += row.refunds;
    acc.downPayment += row.downPayment;
    acc.loanInProgress += row.loanInProgress;
    acc.total += row.totalEntries;
    return acc;
  }, { complete: 0, refunds: 0, downPayment: 0, loanInProgress: 0, total: 0 });
  const items = [
    ["Complete/RFD", totals.complete, "good"],
    ["Refund Requested", totals.refunds, "bad"],
    ["Down Payment", totals.downPayment, "warn"],
    ["Loan In Progress", totals.loanInProgress, "warn"]
  ];
  document.querySelector("#statusSplit").innerHTML = items
    .map(([label, value, tone]) => `
      <div class="status-card">
        <div class="status-card-head">
          <strong>${label}</strong>
          <span class="${tone}">${fmt(value)}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${totals.total ? Math.min(100, (value / totals.total) * 100) : 0}%"></div></div>
      </div>
    `)
    .join("");
}

function render() {
  const momRows = monthMomRows();
  const bdeRows = monthBdeRows();
  const monthLabel = momRows[0]?.monthLabel || state.month;
  document.querySelector(".topbar h1").textContent = `Team Performance Command Center`;
  document.querySelector(".topbar .eyebrow").textContent = `Senior Manager Sales Dashboard · ${monthLabel}`;
  document.querySelector("#dataSource").textContent = state.data.dataSource;
  renderMetrics(momRows);
  renderMom(momRows);
  renderPace(momRows);
  renderLeaderBoard(bdeRows);
  renderStatusSplit(momRows);
}

document.querySelector("#monthSelect").addEventListener("change", (event) => {
  state.month = event.target.value;
  render();
});

document.querySelector("#refreshButton").addEventListener("click", async () => {
  await loadData();
});

loadData().catch((error) => {
  document.querySelector(".content").innerHTML = `<div class="panel"><h2>Dashboard could not load</h2><p>${error.message}</p></div>`;
});
