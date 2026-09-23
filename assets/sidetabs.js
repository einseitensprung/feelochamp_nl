/* Side-Tabs am rechten Fensterrand – gemeinsam für alle Seiten.
   Wird von jeder Seite per <script src> eingebunden und hängt die vertikalen
   Tabs selbst an <body>. Vorbild: .side-links auf einseitensprung.at
   (dort links, hier gespiegelt nach rechts). Styles: .side-tabs in main.css. */
(function () {
  var TABS = [
    { label: 'Europa League', href: 'https://einseitensprung.at/el/' },
    { label: 'Champions League', href: 'https://einseitensprung.at/cl/' }
  ];

  var nav = document.createElement('nav');
  nav.className = 'side-tabs';
  nav.setAttribute('aria-label', 'Weitere Tipprunden');
  TABS.forEach(function (t) {
    var a = document.createElement('a');
    a.href = t.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t.label + ' ↗';
    nav.appendChild(a);
  });
  document.body.appendChild(nav);
})();
