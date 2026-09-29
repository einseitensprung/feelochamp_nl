/**
 * UEFA Nations League — Spieldaten für nationsleague.html (von build.js aufgerufen).
 *
 * Holt zur Build-Zeit alle Spiele der aktuellen Saison von der OddsPapi-API
 * (https://oddspapi.io, Turnier 23755) und rendert sie als statische Tabellenzeilen.
 * Der API-Key kommt aus ODDSPAPI_KEY (Umgebung oder lokale .env, per .gitignore
 * ausgeschlossen) und landet nie im HTML.
 *
 * API-Aufrufe nur mit `node build.js --nl-refresh` — ein normaler Build nutzt nur den Cache
 * (der Free-Plan hat ein festes Kontingent von 250 Requests; jeder Refresh kostet 1 + Live-/neu beendete Scores + Quoten der nächsten 7 Tage).
 *
 * Cache: src/data/nationsleague.json (enthält keinen Key, wird committed).
 *  - Ohne Key oder bei API-Fehlern baut die Seite aus dem Cache.
 *  - 1X2-Quoten (Pinnacle, Fallback bet365/bwin/tipico) für Spiele der nächsten 7 Tage, höchstens stündlich neu; beendete Spiele
 *    behalten ihre letzte bekannte Quote aus dem Cache.
 *  - Ergebnisse beendeter Spiele ändern sich nicht mehr und werden aus dem Cache
 *    übernommen — pro Build werden nur Scores für Live- und neu beendete Spiele geholt.
 */
const fs = require("fs");
const path = require("path");

const API = "https://api.oddspapi.io/v4";
const SPORT_ID = 10;
const TOURNAMENT_ID = 23755;
const TZ = "Europe/Vienna";
const CACHE_FILE = path.join(__dirname, "data", "nationsleague.json");
// Buchmacher für die 1X2-Quoten, in Reihenfolge der Präferenz (Slugs laut API)
const BOOKMAKERS = ["pinnacle", "bet365", "bwin", "tipico"];
const BOOKMAKER_NAMES = { pinnacle: "Pinnacle", bet365: "bet365", bwin: "bwin", tipico: "tipico" };
// Quoten werden höchstens stündlich neu geholt (jeder Build ruft sonst ~60× /odds auf)
const ODDS_MAX_AGE_MS = 60 * 60 * 1000;
// … und nur für Spiele, die in den nächsten 7 Tagen angepfiffen werden (spart Requests, weiter entfernte Quoten sind ohnehin wenig aussagekräftig)
const ODDS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// API-Kürzel -> [deutscher Name, Badge-Hintergrund, Badge-Schrift] (Nationalfarben, keine Verbandswappen)
const TEAMS = {
  ALB: ["Albanien", "#e41e20", "#000000"], AND: ["Andorra", "#10069f", "#fedf00"],
  ARM: ["Armenien", "#d90012", "#f2a800"], AUT: ["Österreich", "#ed2939", "#ffffff"],
  AZE: ["Aserbaidschan", "#0092bc", "#ffffff"], BEL: ["Belgien", "#e30613", "#fdda24"],
  BIH: ["Bosnien-Herzegowina", "#002395", "#fecb00"], BLR: ["Belarus", "#c8313e", "#ffffff"],
  BUL: ["Bulgarien", "#00966e", "#ffffff"], CRO: ["Kroatien", "#ff0000", "#ffffff"],
  CYP: ["Zypern", "#1c4695", "#ffffff"], CZE: ["Tschechien", "#d7141a", "#ffffff"],
  DEN: ["Dänemark", "#c8102e", "#ffffff"], ENG: ["England", "#ffffff", "#ce1124"],
  ESP: ["Spanien", "#c60b1e", "#ffc400"], EST: ["Estland", "#0072ce", "#ffffff"],
  FIN: ["Finnland", "#ffffff", "#002f6c"], FRA: ["Frankreich", "#002395", "#ffffff"],
  FRO: ["Färöer", "#ffffff", "#0065bd"], GEO: ["Georgien", "#ffffff", "#e8112d"],
  GER: ["Deutschland", "#ffffff", "#000000"], GIB: ["Gibraltar", "#da000c", "#ffffff"],
  GRE: ["Griechenland", "#0d5eaf", "#ffffff"], HUN: ["Ungarn", "#cd2a3e", "#ffffff"],
  IRL: ["Irland", "#169b62", "#ffffff"], ISL: ["Island", "#02529c", "#ffffff"],
  ISR: ["Israel", "#ffffff", "#0038b8"], ITA: ["Italien", "#0066b3", "#ffffff"],
  KAZ: ["Kasachstan", "#00afca", "#fec50c"], KOS: ["Kosovo", "#244aa5", "#d0a650"],
  LAT: ["Lettland", "#9e3039", "#ffffff"], LIE: ["Liechtenstein", "#002b7f", "#ce1126"],
  LTU: ["Litauen", "#fdb913", "#006a44"], LUX: ["Luxemburg", "#00a1de", "#ffffff"],
  MDA: ["Moldau", "#0046ae", "#ffd200"], MKD: ["Nordmazedonien", "#d20000", "#ffe600"],
  MLT: ["Malta", "#cf142b", "#ffffff"], MNE: ["Montenegro", "#c40308", "#d3ae3b"],
  NED: ["Niederlande", "#f36c21", "#ffffff"], NIR: ["Nordirland", "#00843d", "#ffffff"],
  NOR: ["Norwegen", "#ba0c2f", "#ffffff"], POL: ["Polen", "#ffffff", "#dc143c"],
  POR: ["Portugal", "#c8102e", "#046a38"], ROU: ["Rumänien", "#fcd116", "#002b7f"],
  SCO: ["Schottland", "#0065bd", "#ffffff"], SLO: ["Slowenien", "#005da4", "#ffffff"],
  SMR: ["San Marino", "#5eb6e4", "#ffffff"], SRB: ["Serbien", "#c6363c", "#ffffff"],
  SUI: ["Schweiz", "#da291c", "#ffffff"], SVK: ["Slowakei", "#0b4ea2", "#ffffff"],
  SWE: ["Schweden", "#006aa7", "#fecc02"], TUR: ["Türkei", "#e30a17", "#ffffff"],
  UKR: ["Ukraine", "#0057b7", "#ffd700"], WAL: ["Wales", "#c8102e", "#ffffff"],
};

// statusId laut API: 0 Pre-Game, 1 Live, 2 Finished, 3 Cancelled
const STATUS = { 0: "pre", 1: "live", 2: "done", 3: "cancelled" };

function readKey() {
  if (process.env.ODDSPAPI_KEY) return process.env.ODDSPAPI_KEY.trim();
  const envFile = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envFile)) return null;
  const m = fs.readFileSync(envFile, "utf8").match(/^\s*ODDSPAPI_KEY\s*=\s*"?([^"\r\n]*)"?\s*$/m);
  const key = m && m[1].trim();
  return key && key !== "HIER_DEINEN_KEY_EINTRAGEN" ? key : null;
}

function quotaError(details) {
  const err = new Error(`OddsPapi-Kontingent erschöpft${details ? ` (${details})` : ""}`);
  err.quota = true;
  return err;
}

async function api(endpoint, params, key) {
  const url = `${API}/${endpoint}?${new URLSearchParams({ ...params, apiKey: key })}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < 5) {
      // Rate limit (v. a. /odds, ca. 1 Request pro 0,5 s): die von der API genannte Wartezeit einhalten.
      // Ausnahme: Kontingent des Plans erschöpft (REQUEST_LIMIT_EXCEEDED) — Warten hilft nicht, sofort abbrechen.
      const body = await res.json().catch(() => ({}));
      if (body.error && body.error.code === "REQUEST_LIMIT_EXCEEDED") throw quotaError(body.error.details);
      const wait = (body.error && body.error.retryMs) || 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait + 100));
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`${endpoint}: HTTP ${res.status}${body.error ? ` ${body.error.code}` : ""}`);
    }
    return res.json();
  }
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { return null; }
}

// 1X2-Quoten: Markt 101, Outcomes 101 = Heimsieg (1), 102 = Remis (X), 103 = Auswärtssieg (2).
// Pinnacle als Referenz (niedrige Marge = neutralste Quote), sonst der erste Buchmacher der Liste mit Preis.
// Der bookmakers-Filter ist Pflicht: ungefiltert liefert /odds ~34 MB pro Spiel (264 Buchmacher).
async function fetchOdds(fixtureId, key) {
  const o = await api("odds", { fixtureId, bookmakers: BOOKMAKERS.join(",") }, key);
  for (const bm of BOOKMAKERS) {
    const m = o.bookmakerOdds && o.bookmakerOdds[bm] && o.bookmakerOdds[bm].markets["101"];
    if (!m || m.marketActive === false) continue;
    const price = (id) => {
      const p = m.outcomes[id] && m.outcomes[id].players && m.outcomes[id].players["0"];
      return p && p.active !== false && p.price > 1 ? p.price : null;
    };
    const prices = ["101", "102", "103"].map(price);
    if (prices.every(Boolean)) return { bookmaker: bm, prices, at: new Date().toISOString() };
  }
  return null;
}

async function fetchData(key, cache) {
  const all = await api("fixtures", { sportId: SPORT_ID, tournamentId: TOURNAMENT_ID }, key);
  // Aktuelle Saison = höchste seasonId (die API liefert auch die Vorsaison mit)
  const seasonId = Math.max(...all.map((f) => f.seasonId));
  const cachedScores = new Map((cache && cache.seasonId === seasonId ? cache.games : []).map((g) => [g.id, g]));

  const games = [];
  const oddsErrors = [];
  for (const f of all.filter((f) => f.seasonId === seasonId)) {
    const status = STATUS[f.statusId] || "pre";
    const game = { id: f.fixtureId, start: f.startTime, status, home: f.participant1Abbr, away: f.participant2Abbr,
                   homeName: f.participant1Name, awayName: f.participant2Name, score: null, odds: null };
    const cached = cachedScores.get(game.id);
    if (status === "done" && cached && cached.status === "done" && cached.score) {
      game.score = cached.score;
    } else if (status === "done" || status === "live") {
      const s = await api("scores", { fixtureId: f.fixtureId }, key);
      const p = s.scores && s.scores.periods;
      const r = p && (p.result || p.fulltime);
      if (r) game.score = [r.participant1Score, r.participant2Score];
    }

    // 1X2-Quoten: nur für anstehende Spiele der nächsten 7 Tage (Live-Quoten sind im OddsPapi-Plan gesperrt: 403 RESTRICTED_ACCESS)
    // und höchstens alle ODDS_MAX_AGE_MS. Live/beendete Spiele behalten die letzte Vorab-Quote aus dem Cache.
    // Ein Fehler bei einem Spiel kostet nur dessen Quote, nicht den ganzen Refresh.
    game.odds = (cached && cached.odds) || null;
    const oddsFresh = game.odds && Date.now() - Date.parse(game.odds.at) < ODDS_MAX_AGE_MS;
    const inWindow = Date.parse(f.startTime) - Date.now() < ODDS_WINDOW_MS;
    if (status === "pre" && f.hasOdds && inWindow && !oddsFresh) {
      try {
        game.odds = (await fetchOdds(f.fixtureId, key)) || game.odds;
      } catch (err) {
        if (err.quota) throw err;
        oddsErrors.push(`${f.participant1Abbr}-${f.participant2Abbr} (${err.message})`);
      }
    }
    games.push(game);
  }
  if (oddsErrors.length) console.warn(`nationsleague: keine Quoten für ${oddsErrors.length} Spiel(e): ${oddsErrors.join(", ")}`);
  games.sort((a, b) => a.start.localeCompare(b.start) || a.home.localeCompare(b.home));

  const years = [...new Set(games.map((g) => g.start.slice(0, 4)))];
  const season = years.length > 1 ? `${years[0]}/${years[years.length - 1].slice(2)}` : `${years[0]}/${String(+years[0] + 1).slice(2)}`;
  return { seasonId, season, updated: new Date().toISOString(), games };
}

// ---------- Rendering ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (iso, opts) => new Intl.DateTimeFormat("de-AT", { timeZone: TZ, ...opts }).format(new Date(iso));

function team(abbr, apiName, reverse) {
  const [name, bg, fg] = TEAMS[abbr] || [apiName, "#5a6c8c", "#ffffff"];
  return `<div class="team-cell${reverse ? " reverse" : ""}"><span class="crest nl-crest" style="background:${bg}; color:${fg};">${esc(abbr)}</span><span class="team-name">${esc(name)}</span></div>`;
}

function result(g) {
  if (g.status === "cancelled") return `<span class="nl-badge is-cancelled">abgesagt</span>`;
  if (!g.score) return g.status === "live" ? `<span class="nl-badge is-live">Live</span>` : `<span class="nl-vs">–:–</span>`;
  const score = `<span class="nl-score">${g.score[0]}<span>:</span>${g.score[1]}</span>`;
  return g.status === "live" ? `${score}<span class="nl-badge is-live">Live</span>` : score;
}

// 1 · X · 2 — Favorit (niedrigste Quote) hervorgehoben; bei beendeten Spielen der eingetretene Ausgang
function odds(g) {
  if (!g.odds) return `<span class="nl-odds-none">–</span>`;
  const fav = g.odds.prices.indexOf(Math.min(...g.odds.prices));
  const hit = g.status === "done" && g.score ? (g.score[0] > g.score[1] ? 0 : g.score[0] === g.score[1] ? 1 : 2) : -1;
  const book = BOOKMAKER_NAMES[g.odds.bookmaker] || g.odds.bookmaker;
  const when = fmt(g.odds.at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const cells = g.odds.prices.map((p, i) => {
    const cls = ["nl-odd", i === fav ? "is-fav" : "", i === hit ? "is-hit" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}"><small>${["1", "X", "2"][i]}</small>${p.toFixed(2)}</span>`;
  }).join("");
  return `<span class="nl-odds" title="Quote ${esc(book)}, Stand ${when}">${cells}</span>`;
}

function renderRows(games) {
  let day = null;
  const out = [];
  for (const g of games) {
    const d = fmt(g.start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (d !== day) {
      day = d;
      out.push(`            <tr class="nl-day"><td colspan="5">${esc(d)}</td></tr>`);
    }
    const [homeName] = TEAMS[g.home] || [g.homeName];
    const [awayName] = TEAMS[g.away] || [g.awayName];
    const teams = esc(`${homeName} ${awayName} ${g.homeName} ${g.awayName} ${g.home} ${g.away}`);
    out.push(`            <tr class="nl-game is-${g.status}" data-status="${g.status}" data-teams="${teams}">` +
      `<td><span class="kickoff-time">${fmt(g.start, { hour: "2-digit", minute: "2-digit" })}</span></td>` +
      `<td>${team(g.home, g.homeName)}</td>` +
      `<td class="col-res">${result(g)}</td>` +
      `<td>${team(g.away, g.awayName, true)}</td>` +
      `<td class="col-odds">${odds(g)}</td></tr>`);
  }
  return out.join("\n");
}

async function nationsLeagueReplacements({ refresh = false } = {}) {
  const cache = readCache();
  const key = refresh ? readKey() : null;
  let data = cache;
  if (!refresh) {
    console.log("nationsleague: aus Cache gebaut (API-Refresh: node build.js --nl-refresh)");
  } else if (!key) {
    console.warn("nationsleague: kein ODDSPAPI_KEY (.env) — verwende Cache");
  } else {
    try {
      data = await fetchData(key, cache);
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 1) + "\n", "utf8");
      console.log(`nationsleague: ${data.games.length} Spiele von OddsPapi geladen, ${data.games.filter((g) => g.odds).length} mit Quoten`);
    } catch (err) {
      console.warn(`nationsleague: API-Fehler (${err.message}) — verwende Cache`);
    }
  }

  const games = data ? data.games : [];
  const count = (s) => games.filter((g) => g.status === s).length;
  return {
    "{{NL_TABLE_CLASS}}": games.some((g) => g.odds) ? "" : " nl-no-odds",
    "{{NL_SEASON}}": data ? data.season : "",
    "{{NL_UPDATED}}": data ? `${fmt(data.updated, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} Uhr` : "–",
    "{{NL_ROWS}}": games.length ? renderRows(games) : `            <tr><td colspan="5" class="nl-empty">Noch keine Spieldaten — ODDSPAPI_KEY in .env eintragen und <code>node build.js</code> ausführen.</td></tr>`,
    "{{NL_COUNT_ALL}}": String(games.length),
    "{{NL_COUNT_DONE}}": String(count("done")),
    "{{NL_COUNT_LIVE}}": String(count("live")),
    "{{NL_COUNT_PRE}}": String(count("pre")),
  };
}

module.exports = { nationsLeagueReplacements };
