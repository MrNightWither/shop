/* NWU · Saison-Text für shop.nightwither.de (24.10.2026)
   Bewusst minimal: nur eine kleine Textzeile unter dem Hero-Satz, keine Farben, keine Effekte,
   keine Verbindung nach außen. Die Saison wird nach denselben Kalenderdaten berechnet wie bei
   Discord-Bot, Overlays und nightwither.de. Stil: .saison-zeile in shop.css.
   Testen: https://shop.nightwither.de/?saison=halloween (weihnachten, silvester, valentinstag,
   ostern, freitag-der-13, nwu-geburtstag, server-geburtstag) */
(function () {
  'use strict';

  var TEXTE = {
    halloween: '🎃 Halloween in der NWU – schaurig schöne Nacht',
    weihnachten: '🎄 Weihnachten im Schattenhof',
    silvester: '🎆 Rutscht gut rein, Schatten!',
    valentinstag: '💘 Happy Valentinstag',
    ostern: '🐣 Frohe Ostern aus der Dunkelheit',
    'freitag-der-13': '👾 Freitag der 13. – heute glitcht die Nacht',
    'nwu-geburtstag': '🩸 Heute hat MrNightwither Geburtstag',
    'server-geburtstag': '🎂 Die NightWither Unity hat Geburtstag'
  };

  function osterSonntag(j) {
    var a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(j, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  function tag(j, mo, t) { return new Date(j, mo - 1, t).getTime(); }
  function zwischen(heute, j, von, bis) {
    var v = tag(j, von[0], von[1]), e = tag(j, bis[0], bis[1]);
    return e < v ? (heute >= v || heute <= e) : (heute >= v && heute <= e);
  }
  function berechnen(d) {
    var j = d.getFullYear(), heute = tag(j, d.getMonth() + 1, d.getDate());
    if (d.getDate() === 13 && d.getDay() === 5) return 'freitag-der-13';
    if (zwischen(heute, j, [7, 26], [7, 26])) return 'nwu-geburtstag';
    if (zwischen(heute, j, [2, 13], [2, 13])) return 'server-geburtstag';
    if (zwischen(heute, j, [2, 14], [2, 14])) return 'valentinstag';
    if (zwischen(heute, j, [12, 29], [1, 2])) return 'silvester';
    var o = osterSonntag(j).getTime();
    if (heute >= o - 2 * 86400000 && heute <= o + 86400000) return 'ostern';
    if (zwischen(heute, j, [10, 24], [11, 1])) return 'halloween';
    if (zwischen(heute, j, [12, 1], [12, 28])) return 'weihnachten';
    return 'standard';
  }

  function saison() {
    var test = null;
    try { test = new URLSearchParams(location.search).get('saison'); } catch (e) { /* alter Browser: Kalender */ }
    return test || berechnen(new Date());
  }

  function einbauen() {
    var text = TEXTE[saison()];
    var nach = document.querySelector('.hero-line');
    if (!text || !nach || document.querySelector('.saison-zeile')) return;
    var p = document.createElement('p');
    p.className = 'saison-zeile';
    p.textContent = text;
    nach.insertAdjacentElement('afterend', p);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', einbauen); else einbauen();
})();
