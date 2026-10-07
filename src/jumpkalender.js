// Datenquelle für jump_kalender.html: holt die Spieltermine aller fünf
// Tipprunden aus deren live kalender.asp (einseitensprung.at/{cl,el,nl,db,oel}/)
// und schreibt sie als assets/jump-kalender-data.js (window.JUMP_KALENDER).
//
//   node src/jumpkalender.js
//
// Läuft NICHT automatisch in build.js – nur bei Bedarf manuell aufrufen und
// das Ergebnis mitcommitten. Es wird kein fremder Code ausgeführt: das
// LIGA-Array wird als JSON geparst, die K.o.-Platzhalter aus den tie(...)- /
// out.push(...)-Zeilen per Regex gelesen (auskommentierte Zeilen ignoriert).
const fs = require('fs');
const path = require('path');

const ROUNDS = [
  // ko: K.o.-Platzhalter übernehmen? DB/ÖL sind Ligen – deren kalender.asp
  // enthält nur einen kopierten, ungenutzten KO-Block.
  { id: 'cl', ko: true },
  { id: 'el', ko: true },
  { id: 'nl', ko: true },
  { id: 'db', ko: false },
  { id: 'oel', ko: false },
];
const OUT = path.join(__dirname, '..', 'assets', 'jump-kalender-data.js');

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
  const data = { generated: new Date().toISOString(), events };
  fs.writeFileSync(OUT,
    '// Generiert von src/jumpkalender.js – nicht von Hand bearbeiten.\n' +
    'window.JUMP_KALENDER = ' + JSON.stringify(data) + ';\n');
  console.log(`${events.length} Termine -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
