# CLAUDE.md

Anweisungen für Claude Code in diesem Repo.

## Workflow-Regel: sofort committen & pushen

**Jede Änderung an einer Datei in diesem Repo wird sofort committed und gepusht — kein Sammeln mehrerer Änderungen in einem Commit, keine offenen/uncommitteten Stände am Ende einer Session.**

Konkret:

- Nach jedem abgeschlossenen Edit-Schritt (egal ob Template, `build.js`, README, o. ä.): `git add`, aussagekräftige Commit-Message, `git commit`, danach sofort `git push`.
- Gilt auch für kleine/triviale Änderungen (Typo-Fix, Copy-Anpassung, einzelne Farbe) — nicht auf "später sammeln" warten.
- Ausnahme: Der Nutzer sagt explizit, dass mehrere Schritte in einem Commit zusammengefasst werden sollen.
- Wenn `git push` fehlschlägt (z. B. Remote hat neue Commits): nicht stillschweigend überspringen, sondern rebasen/mergen und erneut pushen, oder den Nutzer informieren, falls das nicht sauber möglich ist.
- Commit-Messages kurz und auf Deutsch oder Englisch (konsistent mit vorherigen Commits), beschreiben **was** sich geändert hat, nicht nur "update".

## Build-Workflow

`index.html`, `spiele.html`, `aufsteiger.html`, `start.html` und `regeln.html` im Root sind **generierte** Dateien (siehe `build.js`), keine Quelldateien. Nach jeder Änderung an `src/*.template.html` vor dem Commit neu bauen:

```bash
node build.js
```

Quelltemplate **und** das neu gebaute HTML gehören in denselben Commit — nie nur die Quelle oder nur das Build-Ergebnis committen.

`regeln.html` (Template `src/regeln.template.html`) und `spielstand.html` (Template `src/spielstand.template.html`) sind reguläre Unterseiten im Redesign-Layout (`body.page-default`, Navbar + `.page-header` + `.content-card` + Sitemap-Sektion), verlinkt aus den Nav-Einträgen aller Seiten:
- `regeln.html` — Inhalt = `regeln.asp` (§1–§6, §50+), als strukturiertes HTML statt der `<br/>`-Wüste des Originals.
- `spielstand.html` — Gesamtwertungs-Tabelle in Anlehnung an `einseitensprung.at/wm/spielstand.asp`; Demodaten im `STANDINGS`-Array im Template, Tendenzpfeile/Stimmungs-Icons als Inline-SVG (`.standings`-Styles in `main.css`).
- `alletips.html` — drei Tabellen (einzelne Spiele / 8 Fix Aufsteiger / Champions) in Anlehnung an `cl_neu/alletips.asp`. Zeilen als **statisches HTML** im Template (kein JS-Rendering). Echte Vereinswappen durch Initialen-Badges ersetzt. Auf jeder Tabelle läuft **DataTables** (`#resTable` / `#resTable2` / `#resTable3`): jQuery + DataTables + Responsive-Extension + `date-de.js` (de_datetime-Sort) sind lokal in `assets/` vendored, die deutsche Sprachdatei ist `assets/datatables_ger.js`. Config wie im Original (bStateSave, lengthMenu 10/25/50/Alle, de_datetime auf der Datum-Spalte). „Quick Nav" im Page-Header springt per `scrollIntoView` zu den Tabellen. DataTables-Bedienelemente sind in `main.css` unter `.content-card .dataTables_*` an die helle Karte angepasst.

`spiele_info.html` und `preloader.html` sind **eigenständige** statische Seiten (kein Template, nicht in `build.js`), ohne Navbar/Footer, direkt editieren:
- `spiele_info.html` — iframe-Ziel der Info-Lightbox auf der Spiele-Seite. Inhalt = `spiele_info.asp?id=1` (Tipp-Übersicht je Spiel), echte Vereinswappen durch Initialen-Badges ersetzt.
- `preloader.html` — Inhalt von `preloader.asp` (Loading-Overlay). Original-Hintergrund `img/bg2026_2.jpg` (am Server 404, wäre UEFA-Material) durch den Feelochamp-Verlauf ersetzt, der `808.gif`-Spinner als reines CSS (`.preloader-dots`) nachgebaut.

## Projektkontext

- Gestyltes Bootstrap-5-Redesign von [einseitensprung.at/cl/](https://einseitensprung.at/cl/), einer privaten Champions-League-Tipprunde ("Feelochamp", seit 2002).
- Reine Design-Demo ohne echtes Backend — Login/Tipp-Abgabe lösen nur Bestätigungs-Toasts aus.
- Keine echten Vereinswappen oder das Original-Hintergrundfoto (UEFA-Bildmaterial/Marken sind geschützt) verwenden — stattdessen eigene Initialen-Badges/Grafiken, siehe README. Ausnahme: das freigestellte Champ-Porträt (`assets/bono2026.png`, von einseitensprung.at) darf auf der "Aktueller Champ"-Karte verwendet werden.
- Bootstrap wird lokal vendored (`assets/bootstrap.min.css`, `assets/bootstrap.bundle.min.js`) und von jeder Seite per `<link>`/`<script src>` verlinkt (nicht inline eingebettet) — keine externen CDN-Requests, aber die Seiten sind dadurch nicht mehr einzeln eigenständig: `assets/` muss immer mitkopiert werden.
- Die Google Fonts (Bebas Neue, Inter, JetBrains Mono) sind ebenfalls lokal vendored: `assets/fonts.css` (`@font-face`, nur latin/latin-ext-Subsets) plus die `.woff2`-Dateien in `assets/fonts/`, verlinkt per `<link rel="stylesheet" href="assets/fonts.css">` statt `fonts.googleapis.com`. Inter und JetBrains Mono sind Variable Fonts — je Subset eine Datei mit `font-weight` als Bereich (z. B. `400 800`) deckt alle gebrauchten Schnitte ab, keine Datei pro Schriftschnitt nötig.
- Die Custom-Styles aller Seiten liegen gemeinsam in `assets/main.css` (kein `<style>`-Block mehr in den Templates). Seitenübergreifendes JS, das auf jeder Seite gleich ist, kommt als eigenes `assets/*.js` (z. B. `assets/datenschutz.js` = Datenschutz-Lightbox, baut ihr Overlay selbst und hängt sich an Links mit Klasse `.ds-open`), von jedem Template per `<script src>` eingebunden — kein Copy-Paste des Markups in alle vier Templates. Jedes Template setzt eine eigene Klasse auf `<body>` (`page-home` / `page-spiele` / `page-aufsteiger` / `page-start`, plus `page-default` für schlichte Unterseiten wie `regeln.html`) — darüber sind die paar Regeln gescoped, die sich je Seite unterscheiden (`.content-card`, `.btn-kickoff`, `.crest`, Navbar-Feinheiten). Neue seitenspezifische Abweichungen bei geteilten Klassennamen genauso scopen, statt eine bestehende Regel einfach zu überschreiben.
- Das Mobile-Menü ist ein Bootstrap-**Offcanvas** (`#mainNav.offcanvas.offcanvas-end` mit `.offcanvas-body`, Toggler mit `data-bs-toggle="offcanvas"`), das von rechts reinfährt; ab `lg` ist es dank `navbar-expand-lg` inline. Blur/Hintergrund der Navbar sitzen deshalb auf `.navbar-feelo::before` (Farbe über `--navbar-bg`), weil `backdrop-filter` direkt auf der Navbar das fixed Panel an die Navbar binden würde. Offen-Zustand (X-Icon, Navbar-z-index über dem Backdrop) wird per `:has(#mainNav.show…)` gesteuert.
- `start.html` ist das Dashboard, auf das der Demo-Login von `index.html` weiterleitet (kein echtes Backend — `index.html`s Login-Formular navigiert nach kurzem Bestätigungs-Toast einfach zu `start.html`). Die "Aktueller Champ"-Karte zeigt den Spitznamen + das freigestellte Champ-Porträt (`assets/bono2026.png`) im runden Rahmen (`.champ-avatar.has-photo` / `.champ-photo`).
