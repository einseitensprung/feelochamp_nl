/* Side-Tabs am rechten Fensterrand – gemeinsam für alle Seiten.
   Wird von jeder Seite per <script src> eingebunden und hängt die vertikalen
   Tabs selbst an <body>. Vorbild: .side-links auf einseitensprung.at
   (dort links, hier gespiegelt nach rechts). Styles: .side-tabs in main.css.
   Passen die Tabs mit voller Beschriftung nicht mehr in die Fensterhöhe
   (zwischen sticky Navbar und unterem Rand), bekommt .side-tabs die Klasse
   .is-short und zeigt nur noch die Abkürzungen (EL / CL / DL). */
(function () {
  var TABS = [
    { label: 'Europa League', short: 'EL', href: 'https://einseitensprung.at/el/' },
    { label: 'Champions League', short: 'CL', href: 'https://einseitensprung.at/cl/' },
    { label: 'Deutsche Bundesliga', short: 'DL', href: 'https://einseitensprung.at/db/' },
  ];

  var nav = document.createElement('nav');
  nav.className = 'side-tabs';
  nav.setAttribute('aria-label', 'Weitere Tipprunden');
  TABS.forEach(function (t) {
    var a = document.createElement('a');
    a.href = t.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = t.label;
    a.setAttribute('aria-label', t.label);
    a.innerHTML = '<span class="st-full">' + t.label + ' ↗</span>' +
                  '<span class="st-short" aria-hidden="true">' + t.short + ' ↗</span>';
    nav.appendChild(a);
  });
  document.body.appendChild(nav);

  // Mit voller Beschriftung messen; die Tabs sind vertikal zentriert, also
  // muss oben und unten je die Navbar-Höhe frei bleiben.
  function fit() {
    nav.classList.remove('is-short');
    var navbar = document.querySelector('.navbar-feelo');
    var reserved = 2 * (navbar ? navbar.offsetHeight : 0) + 16;
    nav.classList.toggle('is-short', nav.offsetHeight > window.innerHeight - reserved);
  }
  fit();
  window.addEventListener('resize', fit);
  if (document.fonts) document.fonts.ready.then(fit);
})();
