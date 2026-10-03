'use strict';
/* Rechtstexte aus Shopify (Einstellungen → Richtlinien) im NWU-Look anzeigen.
   Shopifys eigene Richtlinien-Seiten gehen bei Passwortschutz nicht – die Storefront-API liefert den Text trotzdem.
   Ist ein Text in Shopify noch nicht angelegt: ehrlicher Hinweis „folgt zum Shop-Start“. */
const STORE = 'nightwither.myshopify.com';
const TOKEN = 'edb94b2a2b6bb1b6b921cb1b883b8454';   // öffentlicher Storefront-Schlüssel (derselbe wie in shop.js)
const API = `https://${STORE}/api/2026-04/graphql.json`;
const TEXTE = {
  agb: { feld: 'termsOfService', titel: 'Allgemeine Geschäftsbedingungen' },
  widerruf: { feld: 'refundPolicy', titel: 'Widerrufsbelehrung' },
  versand: { feld: 'shippingPolicy', titel: 'Versand & Lieferung' }
};
const $ = (id) => document.getElementById(id);
const wahl = TEXTE[new URLSearchParams(location.search).get('t')] ? new URLSearchParams(location.search).get('t') : 'agb';
const t = TEXTE[wahl];

document.title = `${t.titel} · NightWither Shop`;
$('titel').textContent = t.titel;
document.querySelectorAll('.reiter a').forEach((a) => { if (a.dataset.t === wahl) a.setAttribute('aria-current', 'page'); });
if (wahl === 'widerruf') $('widerruflink').hidden = false;

/* Shopify-HTML entschärfen: nur Textauszeichnung, keine Skripte/Rahmen/Ereignisse */
function sauber(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((at) => {
      const name = at.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || (name === 'href' && /^\s*javascript:/i.test(at.value)) || name === 'src') n.removeAttribute(at.name);
    });
    if (n.tagName === 'A') { n.setAttribute('rel', 'noopener noreferrer'); }
  });
  return doc.body;
}

function hinweis() {
  const box = $('inhalt');
  box.replaceChildren();
  const p1 = document.createElement('p'); p1.textContent = `Die ${t.titel} wird zum Start des Shops hier veröffentlicht.`;
  const p2 = document.createElement('p'); p2.className = 'leise'; p2.textContent = 'Solange noch nichts verkauft wird, gibt es hier noch keinen Text. Fragen? Schreib an nwu.business@nightwither.de.';
  box.append(p1, p2);
}

(async () => {
  try {
    const r = await fetch(API, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': TOKEN },
      body: JSON.stringify({ query: `{ shop { ${t.feld} { title body } } }` }) });
    const j = await r.json();
    const p = j && j.data && j.data.shop && j.data.shop[t.feld];
    if (!p || !p.body) return hinweis();
    const box = $('inhalt');
    box.classList.add('rechtstext');
    box.replaceChildren(...sauber(p.body).childNodes);
  } catch { hinweis(); }
})();
