/**
 * Zuordnung von Spielen zwischen Datenquellen (OddsPapi-Spielplan <-> Quoten von Sportmonks / The Odds API).
 * Ländernamen werden normalisiert (Akzente, Leer-/Sonderzeichen weg) und bekannte Schreibvarianten vereinheitlicht.
 */
const ALIASES = {
  turkiye: "turkey", czechrepublic: "czechia", republicofireland: "ireland",
  macedonia: "northmacedonia", fyrmacedonia: "northmacedonia",
  bosniaandherzegovina: "bosnia", bosniaherzegovina: "bosnia", faroeislands: "faroe", faroes: "faroe",
};

function normTeam(name) {
  const n = String(name || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[n] || n;
}

// Anstoß bis auf ±36 h gleich (Zeitzonen, kurzfristige Verschiebungen)
function sameKickoff(isoA, isoB) {
  return Math.abs(Date.parse(isoA) - Date.parse(isoB)) <= 36 * 3600e3;
}

module.exports = { normTeam, sameKickoff };
