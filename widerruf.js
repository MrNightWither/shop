'use strict';
/* Widerrufsbutton (§ 356a BGB): Schritt 1 „Vertrag widerrufen“ → Angaben → „Widerruf bestätigen“ → Eingang.
   Der Worker vergibt Vorgangsnummer + Zeit; Morrígan schickt die Eingangsbestätigung per E-Mail.
   TESTBETRIEB: zeigt den Testhinweis. Vor dem Shop-Start auf false stellen (und Morrígan auf „live“). */
const TESTBETRIEB = true;
const WORKER = 'https://nwu-anmeldung.nwu-brand.workers.dev/widerruf';
const $ = (id) => document.getElementById(id);
const schritte = ['s1', 's2', 's3', 's4'];
const zeige = (id) => { schritte.forEach((s) => { $(s).hidden = s !== id; }); window.scrollTo({ top: 0, behavior: 'smooth' }); const f = $(id).querySelector('input, button'); if (f) f.focus({ preventScroll: true }); };
const text = (el, t) => { el.textContent = t; };
const fehler = (id, t) => { const el = $(id); el.hidden = !t; text(el, t || ''); };
let daten = null;

if (TESTBETRIEB) $('testhinweis').hidden = false;

function zeilen(dl, paare) {
  dl.replaceChildren();
  for (const [k, v] of paare) { const dt = document.createElement('dt'); const dd = document.createElement('dd'); text(dt, k); text(dd, v); dl.append(dt, dd); }
}

$('start').addEventListener('click', () => zeige('s2'));
$('abbruch2').addEventListener('click', () => zeige('s1'));
$('zurueck3').addEventListener('click', () => zeige('s2'));

$('formular').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim(), email = $('email').value.trim(), bestellung = $('bestellung').value.trim();
  if (name.length < 2) return fehler('fehler2', 'Bitte gib deinen Namen an.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fehler('fehler2', 'Bitte gib eine gültige E-Mail-Adresse an.');
  if (bestellung.length < 2) return fehler('fehler2', 'Bitte gib deine Bestellnummer an.');
  fehler('fehler2', '');
  daten = { name, email, bestellung, artikel: $('artikel').value.trim(), nachricht: $('nachricht').value.trim(), website: $('website').value };
  zeilen($('zusammenfassung'), [['Name', name], ['E-Mail', email], ['Bestellnummer', bestellung], ['Artikel', daten.artikel || 'gesamte Bestellung'], ...(daten.nachricht ? [['Nachricht', daten.nachricht]] : [])]);
  zeige('s3');
});

$('bestaetigen').addEventListener('click', async () => {
  if (!daten) return zeige('s2');
  const knopf = $('bestaetigen');
  knopf.disabled = true; text(knopf, 'Wird gesendet …'); fehler('fehler3', '');
  try {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...daten, bestaetigt: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.fehler || 'Das hat nicht geklappt.');
    const zeit = new Date(j.zeit).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'medium' });
    zeilen($('eingang'), [['Vorgangsnummer', j.vorgang], ['Eingegangen am', zeit + ' Uhr'], ['Bestellnummer', daten.bestellung]]);
    text($('mailziel'), daten.email);
    zeige('s4');
  } catch (err) {
    fehler('fehler3', (err && err.message ? err.message : 'Das hat nicht geklappt.') + ' Falls es weiter nicht geht: Schreib uns an nwu.business@nightwither.de.');
  } finally { knopf.disabled = false; text(knopf, 'Widerruf bestätigen'); }
});
