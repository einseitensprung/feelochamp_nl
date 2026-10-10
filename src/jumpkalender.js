// Datenquelle für jump_kalender.html: holt die Spieltermine aller sieben
// Tippbewerbe aus deren live kalender.asp (einseitensprung.at/{cl,el,nl,db,oel,zwa,pl}/)
// und schreibt sie als assets/jump-kalender-data.js (window.JUMP_KALENDER)
// sowie als iCalendar-Feeds ics/alle.ics + ics/<runde>.ics (abonnierbar in
// Google Calendar & Co.).
//
//   node src/jumpkalender.js [--force]
//
// Läuft NICHT in build.js, sondern per GitHub Action
// (.github/workflows/jumpkalender.yml) alle 6 Stunden bzw. bei Bedarf manuell;
// das Ergebnis wird mitcommittet. Haben sich die Termine nicht geändert, wird
// nichts geschrieben ("generated" = Stand der letzten Änderung, kein leerer
// Commit); --force schreibt trotzdem. Es wird kein fremder Code ausgeführt: das
// LIGA-Array wird als JSON geparst, die K.o.-Platzhalter aus den tie(...)- /
// out.push(...)-Zeilen per Regex gelesen (auskommentierte Zeilen ignoriert).
const fs = require('fs');
const path = require('path');

const ROUNDS = [
  // ko: K.o.-Platzhalter übernehmen? DB/ÖL/ZWA/PL sind Ligen – deren kalender.asp
  // enthält nur einen kopierten, ungenutzten KO-Block.
  { id: 'cl', ko: true, name: 'Champions League' },
  { id: 'el', ko: true, name: 'Europa League' },
  { id: 'nl', ko: true, name: 'Nations League' },
  { id: 'db', ko: false, name: 'Deutsche Bundesliga' },
  { id: 'oel', ko: false, name: 'Österreichische Bundesliga' },
  { id: 'zwa', ko: false, name: '2. Liga' },
  { id: 'pl', ko: false, name: 'Premier League' },
];
const OUT = path.join(__dirname, '..', 'assets', 'jump-kalender-data.js');
const ICS_DIR = path.join(__dirname, '..', 'ics');
const MATCH_MINUTES = 120;

// --- iCalendar (RFC 5545) ---
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Vienna',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

function icsText(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Zeilen > 75 Oktette falten (UTF-8-sicher, Fortsetzung mit Leerzeichen).
function fold(line) {
  const parts = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// "2026-10-09" + "20:45" (+ Minuten) -> "20261009T204500" (Ortszeit Wien)
function localStamp(d, t, addMin = 0) {
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const x = new Date(Date.UTC(y, mo - 1, da, h, mi + addMin));
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}T${p(x.getUTCHours())}${p(x.getUTCMinutes())}00`;
}

function buildICS(name, events, generated) {
  const stamp = generated.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const byId = Object.fromEntries(ROUNDS.map((r) => [r.id, r]));
  const seen = new Map();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Feelochamp//Jump-Kalender//DE', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:Europe/Vienna',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    ...VTIMEZONE,
  ];
  for (const e of events) {
    const r = byId[e.c];
    // UID stabil über Läufe hinweg, damit Kalender Änderungen als Update erkennen
    const key = `${e.c}-${e.d}-${e.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const summary = `[${e.c.toUpperCase()}] ${e.title}${e.score ? ` (${e.score})` : ''}`;
    const desc = `${r.name}${e.ko ? ' – K.o.-Runde' : ''}\nTipps: https://einseitensprung.at/${e.c}/`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${key}${n > 1 ? '-' + n : ''}@einseitensprung.at`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Vienna:${localStamp(e.d, e.t)}`,
      `DTEND;TZID=Europe/Vienna:${localStamp(e.d, e.t, MATCH_MINUTES)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(desc)}`,
      `URL:https://einseitensprung.at/${e.c}/`,
      `CATEGORIES:${icsText(r.name)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function writeICS(data) {
  fs.mkdirSync(ICS_DIR, { recursive: true });
  const feeds = [['alle', 'Feelochamp – alle Tippbewerbe', data.events]];
  for (const r of ROUNDS) feeds.push([r.id, `Feelochamp – ${r.name}`, data.events.filter((e) => e.c === r.id)]);
  for (const [file, name, evs] of feeds) {
    fs.writeFileSync(path.join(ICS_DIR, `${file}.ics`), buildICS(name, evs, data.generated));
  }
  console.log(`${feeds.length} iCalendar-Feeds -> ${path.relative(process.cwd(), ICS_DIR)}/`);
}

function readPrevious() {
  try {
    const src = fs.readFileSync(OUT, 'utf8');
    return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

function ligaISO(dm) {
  const [d, mo] = dm.split('.').filter(Boolean).map(Number);
  const y = mo <= 6 ? 2027 : 2026;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "Portugal 1" / "Wales 0" (Nations League liefert das Ergebnis im Teamnamen
// mit) -> "Portugal : Wales" + score "1:0"; "-" = noch nicht gespielt.
function splitScore(name) {
  const m = name.match(/^(.*?)\s+(\d+|-)$/);
  return m ? { name: m[1], goals: m[2] } : { name, goals: null };
}

function parseLiga(src) {
  const start = src.indexOf('var LIGA = [');
  if (start < 0) throw new Error('LIGA-Array nicht gefunden');
  const open = src.indexOf('[', start);
  const close = src.indexOf('];', open);
  const body = src.slice(open, close + 1).replace(/,\s*\]$/, ']');
  return JSON.parse(body).map(([dm, time, home, away]) => {
    const h = splitScore(decode(home));
    const a = splitScore(decode(away));
    const score = h.goals !== null && a.goals !== null && h.goals !== '-' && a.goals !== '-'
      ? `${h.goals}:${a.goals}` : null;
    return { d: ligaISO(dm), t: decode(time), title: `${h.name} : ${a.name}`, score, ko: false };
  });
}

function jsArgs(s) {
  return JSON.parse('[' + s.replace(/'/g, '"') + ']');
}

function parseKO(src) {
  const start = src.indexOf('var KO = (function(){');
  const end = src.indexOf('return out;', start);
  if (start < 0 || end < 0) return [];
  const out = [];
  for (const raw of src.slice(start, end).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    let m = line.match(/^tie\((.*)\);/);
    if (m) {
      const [dates, time, prefix, n] = jsArgs(m[1]);
      for (let i = 1; i <= n; i++) {
        for (const d of dates[(i - 1) % dates.length]) {
          out.push({ d, t: time, title: `${prefix} ${i} : ${prefix} ${i}`, score: null, ko: true });
        }
      }
      continue;
    }
    m = line.match(/^out\.push\(\[('.*)\]\);/); // nur Literale, nicht out.push([d[l], …]) in tie()
    if (m) {
      const [d, time, title] = jsArgs(m[1]);
      out.push({ d, t: time, title, score: null, ko: true });
    }
  }
  return out;
}

async function main() {
  const events = [];
  for (const r of ROUNDS) {
    const url = `https://einseitensprung.at/${r.id}/kalender.asp`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 feelochamp-jumpkalender' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const src = await res.text();
    const liga = parseLiga(src);
    const ko = r.ko ? parseKO(src) : [];
    console.log(`${r.id}: ${liga.length} Spiele${r.ko ? ` + ${ko.length} K.o.-Platzhalter` : ''}`);
    for (const e of liga.concat(ko)) events.push({ c: r.id, ...e });
  }
  events.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t) || a.c.localeCompare(b.c));
  const prev = readPrevious();
  const unchanged = prev && JSON.stringify(prev.events) === JSON.stringify(events);
  if (unchanged && !process.argv.includes('--force')) {
    if (!fs.existsSync(path.join(ICS_DIR, 'alle.ics'))) writeICS(prev);
    console.log(`${events.length} Termine – unverändert, nichts geschrieben`);
    return;
  }
  const data = { generated: new Date().toISOString(), events };
  writeICS(data);
  fs.writeFileSync(OUT,
    '// Generiert von src/jumpkalender.js – nicht von Hand bearbeiten.\n' +
    'window.JUMP_KALENDER = ' + JSON.stringify(data) + ';\n');
  console.log(`${events.length} Termine -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
