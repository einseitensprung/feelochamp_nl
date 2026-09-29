/**
 * The Odds API (https://the-odds-api.com, API v4) als Quoten-Quelle für die Nations-League-Seite.
 *
 * Ein einziger Request auf /v4/sports/soccer_uefa_nations_league/odds liefert die 1X2-Quoten („h2h") aller
 * anstehenden Spiele — Kosten: Märkte × Regionen = 1 × 1 = 1 Credit (Free Plan: 500 Credits/Monat).
 * Die Quoten werden per Anstoß + Teamnamen den Spielen aus dem OddsPapi-Spielplan zugeordnet.
 */
const { normTeam, sameKickoff } = require("./teammatch");

const API = "https://api.the-odds-api.com/v4";
const SPORT = "soccer_uefa_nations_league";
// Buchmacher in Reihenfolge der Präferenz (Keys laut The Odds API); sonst der erste mit vollständiger 1X2-Quote
const PREFERRED = ["pinnacle", "betfair_ex_eu", "unibet_eu", "williamhill", "marathonbet", "onexbet"];
const NAMES = { betfair_ex_eu: "Betfair", unibet_eu: "Unibet", williamhill: "William Hill", marathonbet: "Marathonbet", onexbet: "1xBet" };

// 1X2 eines Buchmachers: Outcomes heißen wie die Teams bzw. „Draw"
function prices(bookmaker, event) {
  const m = (bookmaker.markets || []).find((x) => x.key === "h2h");
  if (!m) return null;
  const by = (name) => (m.outcomes.find((o) => o.name === name) || {}).price;
  const p = [by(event.home_team), by("Draw"), by(event.away_team)];
  return p.every((v) => v > 1) ? p : null;
}

/**
 * Holt 1X2-Quoten für `games` (wie im Nations-League-Cache) und liefert eine Map game.id -> Quote.
 * Nicht zuordenbare Spiele fehlen in der Map. Log-Zeile mit verbleibenden Credits.
 */
async function fetchTheOddsApiOdds(games, key) {
  if (!games.length) return { odds: new Map(), remaining: null };
  const starts = games.map((g) => g.start).sort();
  const params = new URLSearchParams({
    apiKey: key, regions: "eu", markets: "h2h", oddsFormat: "decimal",
    // Anstoß-Fenster auf die gesuchten Spiele eingrenzen (ISO ohne Millisekunden, wie von der API verlangt)
    commenceTimeFrom: new Date(Date.parse(starts[0]) - 36 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z"),
    commenceTimeTo: new Date(Date.parse(starts[starts.length - 1]) + 36 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const res = await fetch(`${API}/sports/${SPORT}/odds?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The Odds API: HTTP ${res.status}${body.message ? ` – ${body.message}` : ""}`);
  const remaining = res.headers.get("x-requests-remaining");

  const at = new Date().toISOString();
  const odds = new Map();
  for (const g of games) {
    const home = normTeam(g.homeName), away = normTeam(g.awayName);
    for (const e of body) {
      if (!sameKickoff(e.commence_time, g.start)) continue;
      const eh = normTeam(e.home_team), ea = normTeam(e.away_team);
      const straight = eh === home && ea === away;
      const swapped = eh === away && ea === home;
      if (!straight && !swapped) continue;
      const books = [...(e.bookmakers || [])].sort((a, b) => rank(a.key) - rank(b.key));
      for (const b of books) {
        const p = prices(b, e);
        if (!p) continue;
        odds.set(g.id, {
          bookmaker: b.key, bookmakerName: NAMES[b.key] || b.title, source: "theoddsapi",
          // Heim/Gast bei The Odds API andersherum als bei OddsPapi -> 1 und 2 tauschen
          prices: swapped ? [p[2], p[1], p[0]] : p, at,
        });
        break;
      }
      break;
    }
  }
  return { odds, remaining };
}

function rank(key) {
  const i = PREFERRED.indexOf(key);
  return i === -1 ? PREFERRED.length : i;
}

// Kostenloser Check (zählt nicht aufs Kontingent): Key gültig? Nations League aktiv?
async function checkTheOddsApi(key) {
  const res = await fetch(`${API}/sports?apiKey=${encodeURIComponent(key)}&all=true`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The Odds API: HTTP ${res.status}${body.message ? ` – ${body.message}` : ""}`);
  return { sport: body.find((s) => s.key === SPORT) || null, remaining: res.headers.get("x-requests-remaining") };
}

module.exports = { fetchTheOddsApiOdds, checkTheOddsApi };
