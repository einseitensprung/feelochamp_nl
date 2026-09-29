/**
 * Sportmonks (https://www.sportmonks.com, API v3) als Quoten-Quelle für die Nations-League-Seite.
 *
 * Spielplan und Ergebnisse kommen weiter von OddsPapi (src/nationsleague.js); von Sportmonks werden
 * nur die 1X2-Quoten geholt und per Datum + Teams den vorhandenen Spielen zugeordnet.
 * Ein einziger /fixtures/between-Request (50 Spiele pro Seite) liefert Spiele inkl. Quoten —
 * deutlich sparsamer als OddsPapi mit einem /odds-Request pro Spiel.
 *
 * Voraussetzung: der Sportmonks-Plan muss die Liga enthalten (Nations League: Plan
 * „International Tournaments", Quoten erst ab „All-In"). Die Liga-ID wird zur Laufzeit per Namenssuche
 * ermittelt; fehlt die Liga im Plan, bricht der Abruf mit einer klaren Meldung ab.
 */
const API = "https://api.sportmonks.com/v3";
// Markt 1 = „Fulltime Result" (1X2)
const FULLTIME_RESULT = 1;
// Sportmonks-Buchmacher-IDs -> Slugs wie bei OddsPapi, in Reihenfolge der Präferenz
const BOOKMAKERS = [[20, "pinnacle"], [2, "bet365"], [28, "bwin"], [22, "tipico"]];

// Schreibweisen, in denen sich OddsPapi und Sportmonks bei Ländernamen unterscheiden können
const ALIASES = {
  turkiye: "turkey", czechrepublic: "czechia", republicofireland: "ireland",
  macedonia: "northmacedonia", fyrmacedonia: "northmacedonia",
  bosniaandherzegovina: "bosnia", bosniaherzegovina: "bosnia", faroeislands: "faroe", faroes: "faroe",
};
function normTeam(name) {
  const n = String(name || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[n] || n;
}

async function sm(pathname, params, token) {
  const url = `${API}/${pathname}?${new URLSearchParams({ ...params, api_token: token })}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sportmonks ${pathname.split("/")[1]}: HTTP ${res.status}${body.message ? ` – ${body.message}` : ""}`);
  return body;
}

function planNames(body) {
  const plans = (body.subscription || []).flatMap((s) => (s.plans || []).map((p) => p.plan));
  return plans.length ? plans.join(", ") : "unbekannt";
}

async function findLeague(name, token) {
  const body = await sm(`football/leagues/search/${encodeURIComponent(name)}`, {}, token);
  const league = (body.data || []).find((l) => normTeam(l.name) === normTeam(name));
  if (!league) throw new Error(`Liga „${name}" ist im Sportmonks-Plan nicht enthalten (Plan: ${planNames(body)})`);
  return league;
}

// 1X2 aus den Sportmonks-Quoten: erster Buchmacher der Präferenzliste mit allen drei Ausgängen.
// Labels sind „Home"/„Draw"/„Away" (teils auch „1"/„X"/„2") und beziehen sich auf die Sportmonks-Heimmannschaft.
function pickOdds(odds) {
  const slot = { home: 0, 1: 0, draw: 1, x: 1, away: 2, 2: 2 };
  for (const [id, slug] of BOOKMAKERS) {
    const prices = [null, null, null];
    for (const o of odds || []) {
      if (o.bookmaker_id !== id || o.market_id !== FULLTIME_RESULT || o.stopped) continue;
      const i = slot[String(o.label).toLowerCase()];
      const v = parseFloat(o.value);
      if (i !== undefined && v > 1) prices[i] = v;
    }
    if (prices.every(Boolean)) return { bookmaker: slug, prices };
  }
  return null;
}

/**
 * Holt 1X2-Quoten für `games` (Objekte wie im Nations-League-Cache: id, start, home, away, homeName, awayName)
 * und liefert eine Map game.id -> { bookmaker, source, prices, at }. Nicht zuordenbare Spiele fehlen in der Map.
 */
async function fetchSportmonksOdds(games, token, { leagueName = "UEFA Nations League" } = {}) {
  if (!games.length) return new Map();
  const league = await findLeague(leagueName, token);
  const days = games.map((g) => g.start.slice(0, 10)).sort();
  const fixtures = [];
  for (let page = 1; ; page++) {
    const body = await sm(`football/fixtures/between/${days[0]}/${days[days.length - 1]}`, {
      include: "participants;odds",
      filters: `fixtureLeagues:${league.id};markets:${FULLTIME_RESULT};bookmakers:${BOOKMAKERS.map(([id]) => id).join(",")}`,
      per_page: 50,
      page,
    }, token);
    fixtures.push(...(body.data || []));
    if (!body.pagination || !body.pagination.has_more) break;
  }

  const at = new Date().toISOString();
  const result = new Map();
  for (const g of games) {
    const ours = [[g.home, normTeam(g.homeName)], [g.away, normTeam(g.awayName)]];
    const same = (p, [abbr, name]) => p && (p.short_code === abbr || normTeam(p.name) === name);
    for (const f of fixtures) {
      // Anstoß bis auf ±36 h gleich (Zeitzonen/Verschiebungen), beide Teams über Kürzel oder Namen gleich
      if (Math.abs(Date.parse(f.starting_at.replace(" ", "T") + "Z") - Date.parse(g.start)) > 36 * 3600e3) continue;
      const smHome = (f.participants || []).find((p) => p.meta && p.meta.location === "home");
      const smAway = (f.participants || []).find((p) => p.meta && p.meta.location === "away");
      const straight = same(smHome, ours[0]) && same(smAway, ours[1]);
      const swapped = same(smHome, ours[1]) && same(smAway, ours[0]);
      if (!straight && !swapped) continue;
      const o = pickOdds(f.odds);
      if (o) {
        // Heim/Gast bei Sportmonks andersherum als bei OddsPapi -> 1 und 2 tauschen
        const prices = swapped ? [o.prices[2], o.prices[1], o.prices[0]] : o.prices;
        result.set(g.id, { bookmaker: o.bookmaker, source: "sportmonks", prices, at });
      }
      break;
    }
  }
  return result;
}

module.exports = { fetchSportmonksOdds };
