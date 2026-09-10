'use strict';

/* =====================================================================
   EINSTELLUNGEN: nur hier musst du etwas ändern
   ===================================================================== */
const CONFIG = {
  store: 'nightwither.myshopify.com',
  // Öffentlicher Storefront Zugangsschlüssel aus dem Shopify Kanal "Headless".
  // Der ist dafür gemacht, im Browser zu stehen. NIEMALS hier ein Admin Secret eintragen.
  token: 'edb94b2a2b6bb1b6b921cb1b883b8454',
  apiVersion: '2026-04',
  taxNote: 'inkl. MwSt., zzgl. ',
  // Countdown für einen Drop. Leer lassen, dann ist der Bereich unsichtbar.
  // Beispiel: date: '2026-10-31T20:00:00+01:00', title: 'Halloween Drop'
  drop: { date: '', title: '' }
};

// Reihenfolge = Reihenfolge im Kategorieband. match wird im Produkttyp, in den Tags und im Titel gesucht.
const CATEGORIES = [
  { id: 'alle', label: 'Alle' },
  { id: 'hoodies', label: 'Hoodies', match: ['hoodie', 'kapuzen'] },
  { id: 'shirts', label: 'Shirts', match: ['shirt'] },
  { id: 'caps', label: 'Caps', match: ['cap', 'kappe', 'mütze', 'beanie'] },
  { id: 'bundles', label: 'Bundles', match: ['bundle', 'paket'] },
  { id: 'handtuecher', label: 'Handtücher', match: ['handtuch', 'towel'] },
  { id: 'bandanas', label: 'Bandanas', match: ['bandana'] },
  { id: 'schals', label: 'Schals', match: ['multifunktion', 'schal', 'neck gaiter', 'tube'] }
];
// Bundles zuerst prüfen, sonst landet ein "Hoodie Bundle" bei den Hoodies
const MATCH_ORDER = ['bundles', 'schals', 'bandanas', 'handtuecher', 'hoodies', 'caps', 'shirts'];

const POLICY_FALLBACK = {
  terms: 'https://nightwither.myshopify.com/policies/terms-of-service',
  refund: 'https://nightwither.myshopify.com/policies/refund-policy',
  shipping: 'https://nightwither.myshopify.com/policies/shipping-policy'
};
const CART_KEY = 'nwu_cart_id';

/* ===================================================================== */

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { products: [], filter: 'alle', live: false, cart: null, current: null, selected: {}, lastFocus: null };
const policies = { ...POLICY_FALLBACK };

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function money(m) {
  if (!m) return '';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: m.currencyCode || 'EUR' }).format(Number(m.amount) || 0);
}

// Nur Bilder vom Shopify CDN, in passender Größe
function img(url, width) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'cdn.shopify.com') return '';
    u.searchParams.set('width', String(width));
    return u.href;
  } catch (e) { return ''; }
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Shopify Storefront API ---------- */
async function gql(query, variables = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://${CONFIG.store}/api/${CONFIG.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': CONFIG.token },
      body: JSON.stringify({ query, variables }),
      credentials: 'omit',
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Shopify antwortet mit ' + res.status);
    const json = await res.json();
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

const PRODUCTS_QUERY = `
query Products @inContext(country: DE, language: DE) {
  shop {
    privacyPolicy { url }
    refundPolicy { url }
    shippingPolicy { url }
    termsOfService { url }
  }
  products(first: 100, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id title handle description productType tags availableForSale
      priceRange { minVariantPrice { amount currencyCode } }
      compareAtPriceRange { minVariantPrice { amount currencyCode } }
      images(first: 8) { nodes { url altText } }
      options { name optionValues { name } }
      variants(first: 100) {
        nodes {
          id title availableForSale
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
          selectedOptions { name value }
          image { url altText }
        }
      }
    }
  }
}`;

const CART_FIELDS = `
  id checkoutUrl totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) {
    nodes {
      id quantity
      cost { totalAmount { amount currencyCode } }
      merchandise {
        ... on ProductVariant {
          id title
          image { url altText }
          product { title handle }
        }
      }
    }
  }`;

/* ---------- Kategorien ---------- */
function categoryOf(p) {
  const sources = [p.productType || '', (p.tags || []).join(' '), p.title || ''].map((s) => s.toLowerCase());
  for (const src of sources) {
    for (const id of MATCH_ORDER) {
      const cat = CATEGORIES.find((c) => c.id === id);
      if (cat.match.some((m) => src.includes(m))) return id;
    }
  }
  return null;
}

function labelOf(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.label : '';
}

function renderCats() {
  const track = $('cats');
  const counts = {};
  state.products.forEach((p) => { counts[p._cat] = (counts[p._cat] || 0) + 1; });
  track.replaceChildren(...CATEGORIES.map((c) => {
    const b = el('button', 'cat', c.label);
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-pressed', String(state.filter === c.id));
    const n = c.id === 'alle' ? state.products.length : (counts[c.id] || 0);
    if (state.live && n) b.append(el('sup', '', n));
    b.addEventListener('click', () => {
      state.filter = c.id;
      renderCats();
      renderGrid(true);
      b.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' });
    });
    return b;
  }));
}

/* ---------- Kollektion ---------- */
function productCard(p) {
  const card = el('button', 'card');
  card.type = 'button';
  card.dataset.handle = p.handle;
  if (!p.availableForSale) card.classList.add('is-sold');

  const media = el('div', 'card-media');
  const images = p.images.nodes;
  const first = images[0] && img(images[0].url, 700);
  if (first) {
    const i = document.createElement('img');
    i.src = first;
    i.srcset = `${img(images[0].url, 450)} 450w, ${first} 700w, ${img(images[0].url, 1000)} 1000w`;
    i.sizes = '(max-width: 900px) 50vw, 33vw';
    i.alt = images[0].altText || p.title;
    i.loading = 'lazy';
    i.decoding = 'async';
    media.append(i);
    const second = images[1] && img(images[1].url, 700);
    if (second) {
      const j = document.createElement('img');
      j.src = second; j.alt = ''; j.className = 'alt'; j.loading = 'lazy'; j.decoding = 'async';
      media.append(j);
    }
  } else {
    const ph = document.createElement('img');
    ph.src = 'crown.webp'; ph.alt = ''; ph.className = 'ph';
    media.append(ph);
  }

  const tags = (p.tags || []).map((t) => t.toLowerCase());
  const price = Number(p.priceRange.minVariantPrice.amount);
  const compare = Number(p.compareAtPriceRange?.minVariantPrice?.amount || 0);
  let badge = null;
  if (!p.availableForSale) badge = el('span', 'tag sold', 'Ausverkauft');
  else if (tags.some((t) => t.includes('limit'))) badge = el('span', 'tag limited', 'Limitiert');
  else if (compare > price) badge = el('span', 'tag', 'Sale');
  else if (tags.includes('neu') || tags.includes('new')) badge = el('span', 'tag', 'Neu');
  if (badge) media.append(badge);

  const info = el('div', 'card-info');
  const left = el('div');
  left.append(el('p', 'card-title', p.title), el('p', 'card-type', labelOf(p._cat)));
  const priceEl = el('p', 'card-price');
  if (compare > price) priceEl.append(el('s', '', money(p.compareAtPriceRange.minVariantPrice)));
  const hasRange = p.variants.nodes.some((v) => Number(v.price.amount) !== price);
  priceEl.append((hasRange ? 'ab ' : '') + money(p.priceRange.minVariantPrice));
  info.append(left, priceEl);

  card.append(media, info);
  card.setAttribute('aria-label', `${p.title}, ${hasRange ? 'ab ' : ''}${money(p.priceRange.minVariantPrice)}${p.availableForSale ? '' : ', ausverkauft'}`);
  card.addEventListener('click', () => openProduct(p.handle, card));
  return card;
}

// Linienzeichnungen für die Platzhalter, eigene Formen im Stil der Marke
const ICONS = {
  hoodies: [
    'M31 28 C31 12 69 12 69 28 C63 38 37 38 31 28 Z',
    'M31 28 L18 36 L11 70 L22 72 L27 50 L27 88 L73 88 L73 50 L78 72 L89 70 L82 36 L69 28',
    'M45 36 V50 M55 36 V50',
    'M37 64 H63 L59 78 H41 Z'
  ],
  shirts: [
    'M35 18 L18 27 L9 44 L22 50 L27 41 L27 86 L73 86 L73 41 L78 50 L91 44 L82 27 L65 18',
    'M35 18 C39 27 61 27 65 18',
    'M42 50 L46 44 L50 50 L54 44 L58 50 V58 H42 Z'
  ],
  caps: [
    'M20 62 C20 32 80 32 80 62 Z',
    'M20 62 C42 57 76 59 95 71 C72 74 40 71 20 62',
    'M50 34 V62 M35 40 C40 48 41 55 40 61 M65 40 C60 48 59 55 60 61',
    'M48 34 A2 2 0 1 0 52 34 A2 2 0 1 0 48 34'
  ],
  bundles: [
    'M18 44 L50 30 L82 44 L82 78 L50 92 L18 78 Z',
    'M18 44 L50 58 L82 44 M50 58 V92',
    'M34 20 L66 34 M40 17 L72 31',
    'M27 66 L30 72 L34 64 L38 72 L41 66 V76 L27 71 Z'
  ],
  handtuecher: [
    'M42 14 C42 6 58 6 58 14 V22',
    'M22 24 H78 V86 C78 90 22 90 22 86 Z',
    'M22 34 H78',
    'M22 70 H78 M22 75 H78',
    'M30 88 V93 M40 89 V94 M50 89 V94 M60 89 V94 M70 88 V93'
  ],
  bandanas: [
    'M13 32 H87 L50 88 Z',
    'M13 32 L4 25 M13 32 L6 41 M87 32 L96 25 M87 32 L94 41',
    'M45 48 A5 5 0 1 0 55 48 A5 5 0 1 0 45 48',
    'M33 40 A2.5 2.5 0 1 0 38 40 A2.5 2.5 0 1 0 33 40 M62 40 A2.5 2.5 0 1 0 67 40 A2.5 2.5 0 1 0 62 40 M47.5 66 A2.5 2.5 0 1 0 52.5 66 A2.5 2.5 0 1 0 47.5 66'
  ],
  schals: [
    'M28 20 A22 7 0 1 0 72 20 A22 7 0 1 0 28 20',
    'M28 20 C24 46 32 60 28 86 M72 20 C76 46 68 60 72 86',
    'M28 86 A22 7 0 0 0 72 86',
    'M31 44 C41 38 59 50 69 44 M30 62 C40 56 60 68 70 62'
  ]
};

function icon(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  (ICONS[id] || []).forEach((d, i) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');
    path.style.transitionDelay = `${i * 0.22}s`;
    svg.append(path);
  });
  return svg;
}

function soonCard(cat, index, total) {
  const card = el('div', 'card soon');
  if (total > 1 && cat.id === 'hoodies') card.classList.add('wide');
  if (total > 1 && cat.id === 'schals') card.classList.add('wide-desk');
  const media = el('div', 'card-media');
  media.append(icon(cat.id), el('span', 'soon-tag', 'Bald'), el('span', 'soon-name', cat.label));
  card.append(media);
  return card;
}

function renderGrid(animate) {
  const grid = $('grid');
  $('collDiscord').hidden = state.live;
  let cards;
  if (state.live) {
    const list = state.filter === 'alle' ? state.products : state.products.filter((p) => p._cat === state.filter);
    cards = list.map(productCard);
    $('collMeta').textContent = list.length === 1 ? '1 Produkt' : `${list.length} Produkte`;
    if (!list.length) {
      const e = el('div', 'empty');
      e.append(`In ${labelOf(state.filter)} ist gerade nichts verfügbar. `);
      const back = el('button', '', 'Alle Produkte zeigen');
      back.type = 'button';
      back.addEventListener('click', () => { state.filter = 'alle'; renderCats(); renderGrid(true); });
      e.append(back);
      cards = [e];
    }
  } else {
    const cats = CATEGORIES.filter((c) => c.id !== 'alle' && (state.filter === 'alle' || c.id === state.filter));
    cards = cats.map((c, i) => soonCard(c, i, cats.length));
    $('collMeta').textContent = 'Der erste Drop ist in Vorbereitung.';
  }
  grid.classList.remove('swap');
  grid.replaceChildren(...cards);
  grid.querySelectorAll('.soon').forEach((c) => revealer.observe(c));
  if (finePointer) grid.querySelectorAll('.card:not(.soon)').forEach(tilt);
  if (animate && !reduceMotion) {
    void grid.offsetWidth;
    grid.classList.add('swap');
    [...grid.children].forEach((c, i) => { c.style.animationDelay = `${Math.min(i, 8) * 45}ms`; });
  }
}

/* ---------- Rechtliche Links ---------- */
function applyPolicies() {
  document.querySelectorAll('[data-policy]').forEach((a) => { a.href = policies[a.dataset.policy] || '#'; });
}

function taxNote(target) {
  target.replaceChildren(CONFIG.taxNote);
  const a = el('a', '', 'Versand');
  a.href = policies.shipping;
  target.append(a);
}

/* ---------- Produktansicht ---------- */
function openLayer(layer, opener) {
  state.lastFocus = opener || document.activeElement;
  $('scrim').hidden = false;
  layer.hidden = false;
  document.body.classList.add('locked');
  const x = layer.querySelector('[data-close]');
  if (x) x.focus();
}

function closeLayers() {
  ['product', 'cart'].forEach((id) => { $(id).hidden = true; });
  $('scrim').hidden = true;
  document.body.classList.remove('locked');
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
}

function findVariant(p, sel) {
  return p.variants.nodes.find((v) => v.selectedOptions.every((o) => sel[o.name] === o.value)) || null;
}

function openProduct(handle, opener) {
  const p = state.products.find((x) => x.handle === handle);
  if (!p) return;
  state.current = p;
  const start = p.variants.nodes.find((v) => v.availableForSale) || p.variants.nodes[0];
  state.selected = {};
  (start ? start.selectedOptions : []).forEach((o) => { state.selected[o.name] = o.value; });

  $('pType').textContent = labelOf(p._cat);
  $('pTitle').textContent = p.title;
  $('pDesc').textContent = p.description || '';
  $('pMsg').textContent = '';
  taxNote($('pTax'));
  renderGallery(p, 0);
  renderOptions();
  openLayer($('product'), opener);
}

function renderGallery(p, index, variantImage) {
  const list = p.images.nodes.slice();
  let active = index;
  if (variantImage) {
    const found = list.findIndex((i) => i.url === variantImage.url);
    if (found >= 0) active = found; else { list.unshift(variantImage); active = 0; }
  }
  const main = $('pImg');
  const cur = list[active];
  main.src = cur ? img(cur.url, 1100) : 'crown.webp';
  main.alt = cur ? (cur.altText || p.title) : '';
  const thumbs = $('pThumbs');
  thumbs.hidden = list.length < 2;
  thumbs.replaceChildren(...list.map((im, i) => {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Bild ${i + 1} anzeigen`);
    b.setAttribute('aria-current', String(i === active));
    const t = document.createElement('img');
    t.src = img(im.url, 160); t.alt = '';
    b.append(t);
    b.addEventListener('click', () => renderGallery(p, i));
    return b;
  }));
}

function renderOptions() {
  const p = state.current;
  const wrap = $('pOptions');
  const opts = p.options.filter((o) => !(o.optionValues.length === 1 && /default title/i.test(o.optionValues[0].name)));
  wrap.replaceChildren(...opts.map((o) => {
    const fs = el('fieldset', 'opt');
    const lg = el('legend');
    lg.append(o.name + ': ', el('b', '', state.selected[o.name] || ''));
    const vals = el('div', 'opt-values');
    o.optionValues.forEach((v) => {
      const b = el('button', '', v.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.selected[o.name] === v.name));
      const test = { ...state.selected, [o.name]: v.name };
      const variant = findVariant(p, test);
      if (!variant || !variant.availableForSale) {
        b.classList.add('na');
        b.setAttribute('aria-label', `${v.name}, nicht verfügbar`);
      }
      b.addEventListener('click', () => {
        state.selected[o.name] = v.name;
        renderOptions();
        const nv = findVariant(p, state.selected);
        if (nv && nv.image) renderGallery(p, 0, nv.image);
      });
      vals.append(b);
    });
    fs.append(lg, vals);
    return fs;
  }));

  const v = findVariant(p, state.selected);
  const price = v ? v.price : p.priceRange.minVariantPrice;
  $('pPrice').textContent = money(price);
  const cmp = v && v.compareAtPrice && Number(v.compareAtPrice.amount) > Number(v.price.amount) ? money(v.compareAtPrice) : '';
  $('pCompare').textContent = cmp;
  const add = $('pAdd');
  const ok = !!(v && v.availableForSale);
  add.disabled = !ok;
  add.textContent = ok ? 'In den Warenkorb' : (v ? 'Ausverkauft' : 'Nicht verfügbar');
}

/* ---------- Warenkorb ---------- */
async function loadCart() {
  if (!state.live) return;
  const id = localStorage.getItem(CART_KEY);
  if (!id) { renderCart(); return; }
  try {
    const data = await gql(`query ($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`, { id });
    if (data.cart) state.cart = data.cart; else localStorage.removeItem(CART_KEY);
  } catch (e) { /* Warenkorb bleibt leer */ }
  renderCart();
}

async function cartMutation(name, query, variables) {
  const data = await gql(query, variables);
  const r = data[name];
  if (r.userErrors && r.userErrors.length) throw new Error(r.userErrors[0].message);
  state.cart = r.cart;
  if (r.cart && r.cart.id) localStorage.setItem(CART_KEY, r.cart.id);
  renderCart();
  return r.cart;
}

async function addToCart(variantId) {
  const lines = [{ merchandiseId: variantId, quantity: 1 }];
  if (state.cart && state.cart.id) {
    try {
      return await cartMutation('cartLinesAdd',
        `mutation ($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } } }`,
        { cartId: state.cart.id, lines });
    } catch (e) {
      // Alter Warenkorb abgelaufen, dann neu anlegen
      state.cart = null;
      localStorage.removeItem(CART_KEY);
    }
  }
  return cartMutation('cartCreate',
    `mutation ($input: CartInput!) { cartCreate(input: $input) { cart { ${CART_FIELDS} } userErrors { message } } }`,
    { input: { lines } });
}

async function setQty(lineId, quantity) {
  const drawer = $('cart');
  drawer.classList.add('busy');
  try {
    if (quantity <= 0) {
      await cartMutation('cartLinesRemove',
        `mutation ($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${CART_FIELDS} } userErrors { message } } }`,
        { cartId: state.cart.id, lineIds: [lineId] });
    } else {
      await cartMutation('cartLinesUpdate',
        `mutation ($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } } }`,
        { cartId: state.cart.id, lines: [{ id: lineId, quantity }] });
    }
  } catch (e) {
    toast('Warenkorb konnte nicht aktualisiert werden. Bitte erneut versuchen.');
  } finally {
    drawer.classList.remove('busy');
  }
}

function renderCart() {
  const cart = state.cart;
  const count = cart ? cart.totalQuantity : 0;
  const badge = $('cartCount');
  const before = badge.textContent;
  badge.textContent = String(count);
  badge.hidden = !count;
  if (count && before !== String(count) && !reduceMotion) {
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }
  $('cartOpen').setAttribute('aria-label', count ? `Warenkorb öffnen, ${count} Artikel` : 'Warenkorb öffnen');

  const lines = cart ? cart.lines.nodes : [];
  const box = $('cartLines');
  if (!lines.length) {
    const e = el('div', 'drawer-empty');
    e.append(el('p', '', 'Dein Warenkorb ist leer.'));
    const go = el('a', 'btn-gold', 'Kollektion ansehen');
    go.href = '#kollektion';
    go.addEventListener('click', closeLayers);
    e.append(go);
    box.replaceChildren(e);
    $('cartFoot').hidden = true;
    return;
  }

  box.replaceChildren(...lines.map((l) => {
    const m = l.merchandise;
    const row = el('div', 'line');
    const pic = m.image && img(m.image.url, 200);
    if (pic) { const i = document.createElement('img'); i.src = pic; i.alt = ''; row.append(i); }
    else row.append(el('div', 'ph'));
    const mid = el('div');
    mid.append(el('p', 'line-title', m.product.title));
    if (m.title && !/default title/i.test(m.title)) mid.append(el('p', 'line-var', m.title));
    const q = el('div', 'qty');
    const minus = el('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'Einen weniger');
    const plus = el('button', '', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'Einen mehr');
    minus.addEventListener('click', () => setQty(l.id, l.quantity - 1));
    plus.addEventListener('click', () => setQty(l.id, l.quantity + 1));
    q.append(minus, el('span', '', l.quantity), plus);
    mid.append(q);
    const right = el('div', 'line-right');
    right.append(el('p', 'line-price', money(l.cost.totalAmount)));
    const rm = el('button', 'line-remove', 'Entfernen'); rm.type = 'button';
    rm.addEventListener('click', () => setQty(l.id, 0));
    right.append(rm);
    row.append(mid, right);
    return row;
  }));
  $('cartSum').textContent = money(cart.cost.subtotalAmount);
  taxNote($('cartTax'));
  $('cartFoot').hidden = false;
}

function safeCheckout(url) {
  try {
    const u = new URL(url);
    const ok = u.protocol === 'https:' && (u.hostname.endsWith('.myshopify.com') || u.hostname.endsWith('nightwither.de') || u.hostname.endsWith('.shopify.com'));
    return ok ? u.href : null;
  } catch (e) { return null; }
}

/* ---------- Drop Countdown ---------- */
function startCountdown() {
  const target = Date.parse(CONFIG.drop.date);
  if (!CONFIG.drop.date || isNaN(target) || target <= Date.now()) return;
  $('dropTitle').textContent = CONFIG.drop.title || 'Nächster Drop';
  $('drop').hidden = false;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const left = target - Date.now();
    if (left <= 0) { $('drop').hidden = true; clearInterval(timer); return; }
    const s = Math.floor(left / 1000);
    $('cDays').textContent = pad(Math.floor(s / 86400));
    $('cHours').textContent = pad(Math.floor((s % 86400) / 3600));
    $('cMins').textContent = pad(Math.floor((s % 3600) / 60));
    $('cSecs').textContent = pad(s % 60);
  };
  tick();
  const timer = setInterval(tick, 1000);
}

/* ---------- Goldfunken ---------- */
function sparks() {
  const canvas = $('sparks');
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  const count = w < 600 ? 60 : 110;
  const reset = (p, fresh) => {
    p.x = Math.random() * w; p.y = Math.random() * h;
    p.r = Math.random() * 1.4 + 0.3;
    p.dx = (Math.random() - 0.5) * 0.08; p.dy = -Math.random() * 0.12 - 0.02;
    p.life = fresh ? Math.random() : 1;
    return p;
  };
  const ps = Array.from({ length: count }, () => reset({}, true));
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of ps) {
      const a = Math.max(0, p.life) * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201, 168, 76, ${a})`;
      ctx.fill();
      p.x += p.dx; p.y += p.dy; p.life -= 0.0035;
      if (p.life <= 0 || p.y < -4) reset(p, false);
    }
    if (!reduceMotion) requestAnimationFrame(draw);
  };
  draw();
}

/* ---------- Bewegung ---------- */
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion;

const revealer = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add(e.target.classList.contains('steps') ? 'in' : 'drawn'); revealer.unobserve(e.target); }
  });
}, { threshold: 0.35 }) : { observe: (n) => n.classList.add('drawn', 'in'), unobserve() {} };

function tilt(card) {
  const media = card.querySelector('.card-media');
  card.addEventListener('pointermove', (e) => {
    const r = media.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    media.style.setProperty('--ry', `${(x - 0.5) * 9}deg`);
    media.style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
    media.style.setProperty('--mx', `${x * 100}%`);
    media.style.setProperty('--my', `${y * 100}%`);
  });
  card.addEventListener('pointerleave', () => {
    media.style.setProperty('--rx', '0deg');
    media.style.setProperty('--ry', '0deg');
  });
}

function buildTapes() {
  const words = state.live
    ? ['Jetzt im Shop', 'Streetwear aus der Nacht', 'Auf Bestellung gedruckt']
    : ['Erster Drop in Vorbereitung', 'Streetwear aus der Nacht', 'Bald im Shop'];
  const cats = CATEGORIES.filter((c) => c.id !== 'alle').map((c) => c.label);
  const fill = (id, list) => {
    const track = $(id);
    const items = [];
    for (let round = 0; round < 2; round++) {
      for (let k = 0; k < 2; k++) {
        list.forEach((w) => {
          const sp = el('span', '', w);
          const cr = document.createElement('img');
          cr.src = 'crown.webp'; cr.alt = '';
          sp.append(cr);
          items.push(sp);
        });
      }
    }
    track.replaceChildren(...items);
  };
  fill('tapeFront', words);
  fill('tapeBack', cats);
}

function heroDepth() {
  if (reduceMotion) return;
  const hero = document.querySelector('.hero');
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0;
  const loop = () => {
    tx += (px - tx) * 0.08; ty += (py - ty) * 0.08;
    hero.style.setProperty('--px', tx.toFixed(3));
    hero.style.setProperty('--py', ty.toFixed(3));
    raf = (Math.abs(px - tx) > 0.001 || Math.abs(py - ty) > 0.001) ? requestAnimationFrame(loop) : 0;
  };
  if (finePointer) {
    window.addEventListener('pointermove', (e) => {
      px = e.clientX / window.innerWidth - 0.5;
      py = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }
  const onScroll = () => {
    const y = Math.min(window.scrollY, window.innerHeight);
    hero.style.setProperty('--sy', y.toFixed(0));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function storyWords() {
  const p = document.querySelector('.story-quote p');
  const words = p.textContent.trim().split(/\s+/);
  p.replaceChildren();
  const spans = words.map((w, i) => {
    const sp = el('span', 'w', w);
    p.append(sp);
    if (i < words.length - 1) p.append(' ');
    return sp;
  });
  if (reduceMotion) { spans.forEach((s) => s.classList.add('lit')); return; }
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = p.getBoundingClientRect();
    const vh = window.innerHeight;
    const progress = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.5)));
    const n = Math.round(progress * spans.length);
    spans.forEach((s, i) => s.classList.toggle('lit', i < n));
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

/* ---------- Start ---------- */
async function loadProducts() {
  if (!CONFIG.token) { renderCats(); renderGrid(false); buildTapes(); return; }
  try {
    const data = await gql(PRODUCTS_QUERY);
    const s = data.shop || {};
    if (s.termsOfService?.url) policies.terms = s.termsOfService.url;
    if (s.refundPolicy?.url) policies.refund = s.refundPolicy.url;
    if (s.shippingPolicy?.url) policies.shipping = s.shippingPolicy.url;
    applyPolicies();
    state.products = data.products.nodes.map((p) => ({ ...p, _cat: categoryOf(p) }));
    state.live = state.products.length > 0;
  } catch (e) {
    console.error('Shopify:', e);
  }
  renderCats();
  renderGrid(false);
  buildTapes();
  loadCart();
}

function init() {
  if (!reduceMotion && !sessionStorage.getItem('nwu_intro')) {
    document.body.classList.add('intro');
    sessionStorage.setItem('nwu_intro', '1');
  }
  applyPolicies();
  sparks();
  heroDepth();
  storyWords();
  buildTapes();
  revealer.observe(document.querySelector('.steps'));
  startCountdown();
  loadProducts();

  const bar = $('bar');
  const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  $('cartOpen').addEventListener('click', (e) => {
    if (!state.live) { toast('Der Shop startet bald. Schau gern wieder vorbei.'); return; }
    renderCart();
    openLayer($('cart'), e.currentTarget);
  });
  $('scrim').addEventListener('click', closeLayers);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeLayers));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('scrim').hidden) closeLayers(); });

  $('pAdd').addEventListener('click', async () => {
    const v = findVariant(state.current, state.selected);
    if (!v || !v.availableForSale) return;
    const btn = $('pAdd');
    btn.disabled = true;
    btn.textContent = 'Wird hinzugefügt';
    try {
      await addToCart(v.id);
      $('product').hidden = true;
      $('cart').hidden = false;
      $('cart').querySelector('[data-close]').focus();
      toast('Im Warenkorb');
    } catch (e) {
      $('pMsg').textContent = 'Konnte nicht hinzugefügt werden. Bitte erneut versuchen.';
    } finally {
      renderOptions();
    }
  });

  $('checkout').addEventListener('click', (e) => {
    e.preventDefault();
    const url = state.cart && safeCheckout(state.cart.checkoutUrl);
    if (url) window.location.href = url;
    else toast('Der Checkout ist gerade nicht erreichbar. Bitte später erneut versuchen.');
  });
}

init();
