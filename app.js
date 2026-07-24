/* ===========================================================
   GeoGuessr Logbuch — App-Logik
   Datenmodell:
   {
     games: [
       { id, date: "YYYY-MM-DD", note,
         rounds: [ { country, distanceKm, relativePoints } ] }
     ]
   }
   Persistenz: localStorage ist die "aktive" Kopie (funktioniert
   sofort, ohne Einrichtung). Optional kann per GitHub-API die
   Datei data/results.json im eigenen Repo als geteilter Stand
   gepflegt werden (siehe Tab "Einstellungen").
   =========================================================== */

const LS_DATA_KEY = "geoguessr_log_data_v1";
const LS_GH_CONFIG_KEY = "geoguessr_log_gh_config_v1";

let state = { games: [] };
let charts = {}; // Chart.js Instanzen, damit wir sie vor Re-Render zerstören können
let normalizeActive = false; // "Punkte um Multiplikator bereinigen"-Toggle
let sortState = { rounds: { key: "date", dir: "desc" }, crosstab: { key: "rounds", dir: "desc" } };

/* ----------------------- Hilfsfunktionen ----------------------- */

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, 10);
}

function genId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function fmt(num, digits = 1) {
  if (num === null || num === undefined || isNaN(num)) return "–";
  return num.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

/* ----------------------- Laden / Speichern ----------------------- */

async function loadInitialData() {
  const local = localStorage.getItem(LS_DATA_KEY);
  if (local) {
    try { state = JSON.parse(local); return; } catch (e) { /* fällt durch */ }
  }
  // Kein lokaler Stand vorhanden: versuche, die JSON aus dem Repo zu laden
  // (funktioniert beim Hosting via GitHub Pages, read-only, ohne Token).
  try {
    const res = await fetch("data/results.json", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.games)) {
        state = json;
        saveLocal();
        return;
      }
    }
  } catch (e) { /* z.B. lokal per file:// geöffnet — kein Problem */ }
  state = { games: [] };
}

function saveLocal() {
  localStorage.setItem(LS_DATA_KEY, JSON.stringify(state));
}

/* ----------------------- Tabs ----------------------- */

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "auswertung") renderAuswertung();
  });
});

/* ----------------------- Eingabe: Rundenzeilen ----------------------- */

function countryOptionsHtml(selected) {
  return COUNTRIES.map(c => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function addRoundRow(prefill) {
  const list = document.getElementById("rounds-list");
  const idx = list.children.length + 1;
  const masterActive = document.getElementById("multiplier-master").checked;
  const active = prefill ? prefill.multiplierActive !== false : masterActive;
  const row = document.createElement("div");
  row.className = "round-row";
  row.innerHTML = `
    <span class="round-index">${idx}</span>
    <select class="r-country">
      <option value="">Land wählen…</option>
      ${countryOptionsHtml(prefill && prefill.country)}
    </select>
    <input type="number" class="r-distance" placeholder="Distanz (km)" min="0" step="0.1" value="${prefill ? prefill.distanceKm : ""}">
    <input type="number" class="r-points" placeholder="Rel. Punkte" step="1" value="${prefill ? prefill.relativePoints : ""}">
    <div class="round-multi">
      <label title="Multiplikator-Mechanik für diese Runde berücksichtigen">
        <input type="checkbox" class="r-multi-active" ${active ? "checked" : ""}>
        <span>an</span>
      </label>
      <span class="r-multi-badge mono"></span>
    </div>
    <button type="button" class="remove-round" title="Runde entfernen">×</button>
  `;
  row.querySelector(".remove-round").addEventListener("click", () => {
    row.remove();
    renumberRounds();
    updateLiveMultipliers();
  });
  list.appendChild(row);
  updateLiveMultipliers();
}

function renumberRounds() {
  document.querySelectorAll("#rounds-list .round-row").forEach((row, i) => {
    row.querySelector(".round-index").textContent = i + 1;
  });
}

/* Berechnet für jede Runde in der aktuellen Eingabeliste den Multiplikator,
   der VOR dieser Runde gilt (also Ergebnis aller vorherigen Runden mit
   aktivierter Mechanik in dieser Partie). Rundet nichts weg — 0 Siege = ×1,
   1 Sieg = ×1,5, 2 Siege = ×2, linear. Ein Unentschieden (0 Punkte) ändert
   nichts, ein deaktiviertes Kästchen wird komplett übersprungen (zählt
   weder als Sieg noch als Niederlage und zeigt keinen Multiplikator an). */
function computeMultipliers(roundsData) {
  let myWins = 0, oppWins = 0;
  return roundsData.map(r => {
    if (!r.multiplierActive) {
      return { ...r, myMultiplier: null, oppMultiplier: null };
    }
    const myMultiplier = 1 + 0.5 * myWins;
    const oppMultiplier = 1 + 0.5 * oppWins;
    if (r.relativePoints > 0) myWins++;
    else if (r.relativePoints < 0) oppWins++;
    return { ...r, myMultiplier, oppMultiplier };
  });
}

function updateLiveMultipliers() {
  const rows = [...document.querySelectorAll("#rounds-list .round-row")];
  const raw = rows.map(row => ({
    active: row.querySelector(".r-multi-active").checked,
    points: parseFloat(row.querySelector(".r-points").value)
  }));
  let myWins = 0, oppWins = 0;
  rows.forEach((row, i) => {
    const badge = row.querySelector(".r-multi-badge");
    const { active, points } = raw[i];
    if (!active) {
      badge.textContent = "deaktiviert";
      badge.classList.add("inactive");
      return;
    }
    badge.classList.remove("inactive");
    badge.textContent = `Ich ×${(1 + 0.5 * myWins).toFixed(1)} · Gegner ×${(1 + 0.5 * oppWins).toFixed(1)}`;
    if (!isNaN(points)) {
      if (points > 0) myWins++;
      else if (points < 0) oppWins++;
    }
  });
}

document.getElementById("rounds-list").addEventListener("input", updateLiveMultipliers);
document.getElementById("rounds-list").addEventListener("change", updateLiveMultipliers);

document.getElementById("multiplier-master").addEventListener("change", (e) => {
  document.querySelectorAll("#rounds-list .r-multi-active").forEach(cb => { cb.checked = e.target.checked; });
  updateLiveMultipliers();
});

document.getElementById("add-round-btn").addEventListener("click", () => addRoundRow());

function resetEntryForm() {
  document.getElementById("rounds-list").innerHTML = "";
  document.getElementById("game-date").value = todayStr();
  document.getElementById("game-note").value = "";
  document.getElementById("multiplier-master").checked = true;
  // Modus bewusst NICHT zurücksetzen — meist spielt man mehrere Partien im selben Modus hintereinander.
  addRoundRow();
  addRoundRow();
  document.getElementById("entry-status").textContent = "";
  document.getElementById("entry-status").className = "status-msg";
}

document.getElementById("save-game-btn").addEventListener("click", () => {
  const statusEl = document.getElementById("entry-status");
  const date = document.getElementById("game-date").value || todayStr();
  const mode = document.getElementById("game-mode").value;
  const note = document.getElementById("game-note").value.trim();
  const rows = [...document.querySelectorAll("#rounds-list .round-row")];

  if (rows.length < 2) {
    statusEl.textContent = "Eine Partie braucht mindestens 2 Runden.";
    statusEl.className = "status-msg error";
    return;
  }

  let rounds = [];
  for (const row of rows) {
    const country = row.querySelector(".r-country").value;
    const distance = parseFloat(row.querySelector(".r-distance").value);
    const points = parseFloat(row.querySelector(".r-points").value);
    const multiplierActive = row.querySelector(".r-multi-active").checked;
    if (!country || isNaN(distance) || isNaN(points)) {
      statusEl.textContent = "Bitte für jede Runde Land, Distanz und relative Punkte ausfüllen.";
      statusEl.className = "status-msg error";
      return;
    }
    rounds.push({ country, distanceKm: distance, relativePoints: points, multiplierActive });
  }
  rounds = computeMultipliers(rounds);

  state.games.push({ id: genId(), date, mode, note, rounds });
  saveLocal();
  statusEl.textContent = `Partie mit ${rounds.length} Runden gespeichert.`;
  statusEl.className = "status-msg";
  resetEntryForm();
  renderRecentGames();
});

/* ----------------------- Eingabe: Zuletzt gespeichert ----------------------- */

function renderRecentGames() {
  const wrap = document.getElementById("recent-games");
  const games = [...state.games].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  if (games.length === 0) {
    wrap.innerHTML = '<p class="empty-note">Noch keine Partien erfasst.</p>';
    return;
  }
  wrap.innerHTML = games.map(g => {
    const avgDist = g.rounds.reduce((s, r) => s + r.distanceKm, 0) / g.rounds.length;
    const avgPts = g.rounds.reduce((s, r) => s + r.relativePoints, 0) / g.rounds.length;
    const countries = g.rounds.map(r => r.country).join(", ");
    return `
      <div class="recent-game">
        <div class="recent-game-head">
          <span>${g.date} · ${g.mode || "Modus unbekannt"}${g.note ? " · " + escapeHtml(g.note) : ""}</span>
          <span>${g.rounds.length} Runden</span>
        </div>
        <div class="recent-game-rounds">${countries}</div>
        <div class="recent-game-rounds"><span>Ø Distanz ${fmt(avgDist)} km · Ø Punkte ${fmt(avgPts, 0)}</span></div>
        <button class="delete-game-btn" data-id="${g.id}">Partie löschen</button>
      </div>`;
  }).join("");

  wrap.querySelectorAll(".delete-game-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Diese Partie wirklich löschen?")) return;
      state.games = state.games.filter(g => g.id !== btn.dataset.id);
      saveLocal();
      renderRecentGames();
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ----------------------- Auswertung: Datenaufbereitung ----------------------- */

function flattenRounds() {
  const rows = [];
  for (const g of state.games) {
    g.rounds.forEach((r, i) => {
      // myMultiplier/oppMultiplier fehlen bei altem, vor diesem Feature
      // gespeichertem Daten — dann ohne Multiplikator-Info behandeln.
      const myMultiplier = typeof r.myMultiplier === "number" ? r.myMultiplier : null;
      const oppMultiplier = typeof r.oppMultiplier === "number" ? r.oppMultiplier : null;
      rows.push({
        gameId: g.id, date: g.date, mode: g.mode || "unbekannt", note: g.note || "",
        roundNumber: i + 1, country: r.country,
        distanceKm: r.distanceKm, relativePoints: r.relativePoints,
        myMultiplier, oppMultiplier,
        // Bereinigte Punkte: bei positivem Wert (mein Vorsprung) den eigenen
        // Multiplikator rausrechnen, bei negativem Wert (Vorsprung des Gegners)
        // dessen Multiplikator. Unbekannt/deaktiviert -> ×1 angenommen.
        normalizedPoints: r.relativePoints >= 0
          ? r.relativePoints / (myMultiplier || 1)
          : r.relativePoints / (oppMultiplier || 1)
      });
    });
  }
  return rows;
}

function pointsOf(row) {
  return normalizeActive ? row.normalizedPoints : row.relativePoints;
}

function getFilters() {
  return {
    country: document.getElementById("filter-country").value,
    mode: document.getElementById("filter-mode").value,
    from: document.getElementById("filter-from").value,
    to: document.getElementById("filter-to").value
  };
}

function applyFilters(rows) {
  const f = getFilters();
  return rows.filter(r =>
    (!f.country || r.country === f.country) &&
    (!f.mode || r.mode === f.mode) &&
    (!f.from || r.date >= f.from) &&
    (!f.to || r.date <= f.to)
  );
}

function populateCountryFilter() {
  const sel = document.getElementById("filter-country");
  const current = sel.value;
  const used = [...new Set(state.games.flatMap(g => g.rounds.map(r => r.country)))].sort((a, b) => a.localeCompare(b, "de"));
  sel.innerHTML = '<option value="">Alle Länder</option>' + used.map(c => `<option value="${c}">${c}</option>`).join("");
  if (used.includes(current)) sel.value = current;
}

/* ----------------------- Auswertung: Summary-Karten ----------------------- */

function renderSummaryCards(rows) {
  const wrap = document.getElementById("summary-cards");
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="stat-card"><div class="stat-label">Keine Daten</div><div class="stat-value">–</div><div class="stat-sub">Noch nichts erfasst oder Filter zu eng.</div></div>';
    return;
  }
  const gamesUsed = new Set(rows.map(r => r.gameId)).size;
  const avgDist = rows.reduce((s, r) => s + r.distanceKm, 0) / rows.length;
  const avgPts = rows.reduce((s, r) => s + pointsOf(r), 0) / rows.length;
  const best = rows.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a));
  const bestPts = rows.reduce((a, b) => (pointsOf(b) > pointsOf(a) ? b : a));
  const ptsLabel = normalizeActive ? "Ø Punkte (bereinigt)" : "Ø rel. Punkte";
  const bestPtsLabel = normalizeActive ? "Beste Punkte (bereinigt)" : "Beste Punkte";

  const cards = [
    { label: "Partien", value: gamesUsed, sub: `${rows.length} Runden gesamt` },
    { label: "Ø Distanz", value: fmt(avgDist) + " km", sub: "über alle gefilterten Runden" },
    { label: ptsLabel, value: fmt(avgPts, normalizeActive ? 1 : 0), sub: avgPts >= 0 ? "im Schnitt vorn" : "im Schnitt hinten", neg: avgPts < 0 },
    { label: "Beste Distanz", value: fmt(best.distanceKm) + " km", sub: `${best.country} · ${best.date}` },
    { label: bestPtsLabel, value: fmt(pointsOf(bestPts), normalizeActive ? 1 : 0), sub: `${bestPts.country} · ${bestPts.date}` }
  ];

  wrap.innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.neg ? "negative" : ""}">${c.value}</div>
      <div class="stat-sub">${c.sub}</div>
    </div>`).join("");
}

/* ----------------------- Auswertung: Crosstab ----------------------- */

function buildCrosstab(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.country)) map.set(r.country, []);
    map.get(r.country).push(r);
  }
  return [...map.entries()].map(([country, list]) => ({
    country,
    rounds: list.length,
    avgDistance: list.reduce((s, r) => s + r.distanceKm, 0) / list.length,
    avgPoints: list.reduce((s, r) => s + pointsOf(r), 0) / list.length,
    bestDistance: Math.min(...list.map(r => r.distanceKm)),
    bestPoints: Math.max(...list.map(r => pointsOf(r)))
  }));
}

function renderCrosstab(rows) {
  let data = buildCrosstab(rows);
  const { key, dir } = sortState.crosstab;
  data.sort((a, b) => {
    const va = a[key], vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb, "de") : va - vb;
    return dir === "asc" ? cmp : -cmp;
  });
  const digits = normalizeActive ? 1 : 0;
  document.getElementById("crosstab-points-th").textContent = normalizeActive ? "Ø Punkte (bereinigt)" : "Ø rel. Punkte";
  const tbody = document.querySelector("#crosstab-table tbody");
  tbody.innerHTML = data.map(d => `
    <tr>
      <td>${d.country}</td>
      <td class="mono">${d.rounds}</td>
      <td class="mono">${fmt(d.avgDistance)}</td>
      <td class="mono ${d.avgPoints < 0 ? "negative" : "positive"}">${fmt(d.avgPoints, digits)}</td>
      <td class="mono">${fmt(d.bestDistance)}</td>
      <td class="mono positive">${fmt(d.bestPoints, digits)}</td>
    </tr>`).join("") || `<tr><td colspan="6">Keine Daten für die aktuelle Auswahl.</td></tr>`;
  updateSortHeaderClasses("crosstab-table", key, dir);
}

/* ----------------------- Auswertung: Rundentabelle ----------------------- */

function renderRoundsTable(rows) {
  let data = [...rows];
  const { key, dir } = sortState.rounds;
  data.sort((a, b) => {
    const va = a[key], vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb, "de") : va - vb;
    return dir === "asc" ? cmp : -cmp;
  });
  const tbody = document.querySelector("#rounds-table tbody");
  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="mono">${r.date}</td>
      <td>${r.mode}</td>
      <td>${escapeHtml(r.note)}</td>
      <td class="mono">${r.roundNumber}</td>
      <td>${r.country}</td>
      <td class="mono">${fmt(r.distanceKm)}</td>
      <td class="mono ${r.relativePoints < 0 ? "negative" : "positive"}">${fmt(r.relativePoints, 0)}</td>
      <td class="mono">${r.myMultiplier !== null ? "×" + fmt(r.myMultiplier, 1) : "–"}</td>
      <td class="mono">${r.oppMultiplier !== null ? "×" + fmt(r.oppMultiplier, 1) : "–"}</td>
    </tr>`).join("") || `<tr><td colspan="9">Keine Daten für die aktuelle Auswahl.</td></tr>`;
  updateSortHeaderClasses("rounds-table", key, dir);
}

function updateSortHeaderClasses(tableId, key, dir) {
  document.querySelectorAll(`#${tableId} th`).forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === key) th.classList.add(dir === "asc" ? "sorted-asc" : "sorted-desc");
  });
}

document.querySelectorAll("#crosstab-table th").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    const s = sortState.crosstab;
    s.dir = (s.key === key && s.dir === "desc") ? "asc" : "desc";
    s.key = key;
    renderAuswertung();
  });
});
document.querySelectorAll("#rounds-table th").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    const s = sortState.rounds;
    s.dir = (s.key === key && s.dir === "desc") ? "asc" : "desc";
    s.key = key;
    renderAuswertung();
  });
});

/* ----------------------- Auswertung: Charts ----------------------- */

const CHART_COLORS = ["#4F6B4A", "#C99A3E", "#A4432C", "#5F7E90", "#8B6BA8", "#3A5137", "#7A8B4A"];

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderCharts(rows) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js ist nicht geladen — Diagramme werden übersprungen.");
    document.querySelectorAll(".chart-card canvas").forEach(c => {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "Diagramm-Bibliothek konnte nicht geladen werden.";
      c.replaceWith(note);
    });
    return;
  }
  try {
    renderTrendChart(rows);
    renderScatterChart(rows);
    renderCountryBar("chart-country-distance", rows, "avgDistance", "Ø Distanz (km)", CHART_COLORS[3]);
    renderCountryBar("chart-country-points", rows, "avgPoints", normalizeActive ? "Ø Punkte (bereinigt)" : "Ø rel. Punkte", CHART_COLORS[0]);
  } catch (err) {
    console.error("Fehler beim Rendern der Diagramme:", err);
  }
}

function renderTrendChart(rows) {
  destroyChart("trend");
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, { date: r.date, dist: [], pts: [] });
    const g = byGame.get(r.gameId);
    g.dist.push(r.distanceKm); g.pts.push(pointsOf(r));
  }
  const games = [...byGame.values()].sort((a, b) => a.date.localeCompare(b.date));
  const labels = games.map(g => g.date);
  const avgDist = games.map(g => g.dist.reduce((s, v) => s + v, 0) / g.dist.length);
  const avgPts = games.map(g => g.pts.reduce((s, v) => s + v, 0) / g.pts.length);
  const ptsLabel = normalizeActive ? "Ø Punkte (bereinigt)" : "Ø rel. Punkte";

  const ctx = document.getElementById("chart-trend");
  charts.trend = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Ø Distanz (km)", data: avgDist, borderColor: CHART_COLORS[3], backgroundColor: "transparent", yAxisID: "y", tension: 0.25 },
        { label: ptsLabel, data: avgPts, borderColor: CHART_COLORS[0], backgroundColor: "transparent", yAxisID: "y1", tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { type: "linear", position: "left", title: { display: true, text: "km" } },
        y1: { type: "linear", position: "right", title: { display: true, text: "Punkte" }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderScatterChart(rows) {
  destroyChart("scatter");
  const ctx = document.getElementById("chart-scatter");
  charts.scatter = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "Runde",
        data: rows.map(r => ({ x: r.distanceKm, y: pointsOf(r), country: r.country })),
        backgroundColor: CHART_COLORS[1]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.raw.country}: ${fmt(ctx.raw.x)} km, ${fmt(ctx.raw.y, normalizeActive ? 1 : 0)} Pkt.`
          }
        },
        legend: { display: false }
      },
      scales: {
        x: { title: { display: true, text: "Distanz (km)" } },
        y: { title: { display: true, text: normalizeActive ? "Punkte (bereinigt)" : "Relative Punkte" } }
      }
    }
  });
}

function renderCountryBar(canvasId, rows, metric, axisLabel, color) {
  const key = canvasId;
  destroyChart(key);
  const data = buildCrosstab(rows).sort((a, b) => b[metric] - a[metric]).slice(0, 15);
  const ctx = document.getElementById(canvasId);
  charts[key] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => d.country),
      datasets: [{ label: axisLabel, data: data.map(d => d[metric]), backgroundColor: color }]
    },
    options: {
      responsive: true,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { title: { display: true, text: axisLabel } } }
    }
  });
}

/* ----------------------- Auswertung: Master-Render ----------------------- */

function renderAuswertung() {
  populateCountryFilter();
  const rows = applyFilters(flattenRounds());
  renderSummaryCards(rows);
  renderCrosstab(rows);
  renderRoundsTable(rows);
  renderCharts(rows);
}

["filter-country", "filter-mode", "filter-from", "filter-to"].forEach(id => {
  document.getElementById(id).addEventListener("change", renderAuswertung);
});
document.getElementById("filter-reset").addEventListener("click", () => {
  document.getElementById("filter-country").value = "";
  document.getElementById("filter-mode").value = "";
  document.getElementById("filter-from").value = "";
  document.getElementById("filter-to").value = "";
  renderAuswertung();
});

document.getElementById("normalize-toggle").addEventListener("change", (e) => {
  normalizeActive = e.target.checked;
  renderAuswertung();
});

/* ----------------------- Einstellungen: Export / Import / Löschen ----------------------- */

document.getElementById("export-json-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `geoguessr-results-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-json-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      if (!json || !Array.isArray(json.games)) throw new Error("Ungültiges Format");
      if (confirm(`${json.games.length} Partien importieren? Das ersetzt den aktuellen lokalen Stand.`)) {
        state = json;
        saveLocal();
        renderRecentGames();
        renderAuswertung();
      }
    } catch (err) {
      alert("Konnte die Datei nicht lesen: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("clear-data-btn").addEventListener("click", () => {
  if (!confirm("Wirklich ALLE lokal gespeicherten Partien löschen? Das kann nicht rückgängig gemacht werden.")) return;
  state = { games: [] };
  saveLocal();
  renderRecentGames();
  renderAuswertung();
});

/* ----------------------- Einstellungen: GitHub-Sync ----------------------- */

function ghLoadConfig() {
  const raw = localStorage.getItem(LS_GH_CONFIG_KEY);
  const cfg = raw ? JSON.parse(raw) : {};
  document.getElementById("gh-owner").value = cfg.owner || "";
  document.getElementById("gh-repo").value = cfg.repo || "";
  document.getElementById("gh-branch").value = cfg.branch || "main";
  document.getElementById("gh-path").value = cfg.path || "data/results.json";
  document.getElementById("gh-token").value = cfg.token || "";
}

function ghReadConfig() {
  return {
    owner: document.getElementById("gh-owner").value.trim(),
    repo: document.getElementById("gh-repo").value.trim(),
    branch: document.getElementById("gh-branch").value.trim() || "main",
    path: document.getElementById("gh-path").value.trim() || "data/results.json",
    token: document.getElementById("gh-token").value.trim()
  };
}

function ghStatus(msg, isError) {
  const el = document.getElementById("gh-status");
  el.textContent = msg;
  el.className = "status-msg" + (isError ? " error" : "");
}

document.getElementById("gh-save-config-btn").addEventListener("click", () => {
  localStorage.setItem(LS_GH_CONFIG_KEY, JSON.stringify(ghReadConfig()));
  ghStatus("Konfiguration lokal gespeichert.");
});

function ghApiUrl(cfg) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${encodeURIComponent(cfg.branch)}`;
}

document.getElementById("gh-pull-btn").addEventListener("click", async () => {
  const cfg = ghReadConfig();
  if (!cfg.owner || !cfg.repo) { ghStatus("Bitte Owner und Repository angeben.", true); return; }
  ghStatus("Lade von GitHub …");
  try {
    const res = await fetch(ghApiUrl(cfg), {
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) throw new Error(`GitHub antwortete mit ${res.status}`);
    const json = await res.json();
    const content = base64ToUtf8(json.content.replace(/\n/g, ""));
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.games)) throw new Error("Datei enthält kein gültiges Format");
    if (confirm(`${parsed.games.length} Partien aus dem Repo laden? Das ersetzt den lokalen Stand.`)) {
      state = parsed;
      saveLocal();
      renderRecentGames();
      renderAuswertung();
      ghStatus(`Geladen: ${parsed.games.length} Partien.`);
    } else {
      ghStatus("Abgebrochen.");
    }
  } catch (err) {
    ghStatus("Fehler beim Laden: " + err.message, true);
  }
});

document.getElementById("gh-push-btn").addEventListener("click", async () => {
  const cfg = ghReadConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) { ghStatus("Owner, Repository und Token werden zum Schreiben benötigt.", true); return; }
  ghStatus("Speichere nach GitHub …");
  try {
    // Aktuelles sha der Datei ermitteln (falls vorhanden), sonst neu anlegen
    let sha;
    const getRes = await fetch(ghApiUrl(cfg), { headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json" } });
    if (getRes.ok) { const j = await getRes.json(); sha = j.sha; }

    const body = {
      message: `Update GeoGuessr-Log (${todayStr()})`,
      content: utf8ToBase64(JSON.stringify(state, null, 2)),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!putRes.ok) { const t = await putRes.text(); throw new Error(`${putRes.status}: ${t}`); }
    ghStatus("Gespeichert — data/results.json im Repo aktualisiert.");
  } catch (err) {
    ghStatus("Fehler beim Speichern: " + err.message, true);
  }
});

/* ----------------------- Init ----------------------- */

(async function init() {
  await loadInitialData();
  ghLoadConfig();
  resetEntryForm();
  renderRecentGames();
  renderAuswertung();
})();
