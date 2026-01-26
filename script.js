// Client-side logic: filter UI + selection + BibTeX download
const payload = JSON.parse(document.getElementById('entries').textContent);
let entries = payload.entries || [];

const $cards = document.getElementById('cards');
const $fMethod = document.getElementById('f-method');
const $fOrder = document.getElementById('f-order');
const $fClass = document.getElementById('f-class');
const $fTaxid = document.getElementById('f-taxid');
const $btnClear = document.getElementById('btn-clear');
const $btnBib = document.getElementById('btn-download-bib');
const $selCount = document.getElementById('sel-count');

let selected = new Set();

async function loadBibMap() {
  const res = await fetch('public/bibtex.json');
  if (!res.ok) throw new Error('Failed to load bibtex map');
  return res.json();
}
let bibMapPromise = loadBibMap();

function uniqueSorted(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateFilters() {
  const methods = uniqueSorted(entries.map(e => e.method));
  const orders = uniqueSorted(entries.map(e => e.order));
  const classes = uniqueSorted(entries.map(e => e.class));

  for (const v of methods) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fMethod.appendChild(o); }
  for (const v of orders) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fOrder.appendChild(o); }
  for (const v of classes) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fClass.appendChild(o); }
}

function getSelectedValues(sel) {
  return [...sel.options].filter(o => o.selected).map(o => o.value);
}

function applyFilters() {
  const fm = new Set(getSelectedValues($fMethod));
  const fo = new Set(getSelectedValues($fOrder));
  const fc = new Set(getSelectedValues($fClass));
  const taxText = ($fTaxid.value || '').trim();
  const taxSet = new Set(taxText ? taxText.split(/[\,\s]+/).filter(Boolean) : []);

  return entries.filter(e => {
    if (fm.size && !fm.has(e.method)) return false;
    if (fo.size && !fo.has(e.order)) return false;
    if (fc.size && !fc.has(e.class)) return false;
    if (taxSet.size && !taxSet.has(String(e.taxid))) return false;
    return true;
  });
}

function render() {
  const list = applyFilters();
  $cards.innerHTML = '';

  for (const e of list) {
    const card = document.createElement('div');
    card.className = 'card';

    const t = document.createElement('h3');
    t.textContent = e.species ? `${e.species}` : `TaxID ${e.taxid}`;
    card.appendChild(t);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `
      <span><strong>TaxID:</strong> ${e.taxid}</span>
      <span><strong>Order:</strong> ${e.order || '-'}</span>
      <span><strong>Class:</strong> ${e.class || '-'}</span>
      <span><strong>Method:</strong> ${e.method}</span>
      <span><strong>N:</strong> ${e.individuals}</span>
    `;
    card.appendChild(meta);

    const links = document.createElement('div');
    links.className = 'actions';
    const doiHref = `https://doi.org/${encodeURIComponent(e.doi)}`;
    const dataHref = e.data_url;
    links.innerHTML = `
      <label><input type="checkbox" class="checkbox" data-doi="${e.doi}" ${selected.has(e.doi) ? 'checked' : ''}/> Select</label>
      <a class="link" href="${doiHref}" target="_blank" rel="noopener">DOI</a>
      <a class="link" href="${dataHref}" target="_blank" rel="noopener">Source data</a>
    `;
    card.appendChild(links);

    if (e.notes) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Notes';
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = e.notes;
      details.appendChild(pre);
      card.appendChild(details);
    }

    $cards.appendChild(card);
  }

  document.querySelectorAll('.checkbox').forEach(cb => {
    cb.addEventListener('change', (ev) => {
      const doi = ev.target.getAttribute('data-doi');
      if (ev.target.checked) selected.add(doi); else selected.delete(doi);
      $selCount.textContent = selected.size ? `${selected.size} selected` : '';
    });
  });

  $selCount.textContent = selected.size ? `${selected.size} selected` : '';
}

function clearFilters() {
  [...$fMethod.options].forEach(o => (o.selected = false));
  [...$fOrder.options].forEach(o => (o.selected = false));
  [...$fClass.options].forEach(o => (o.selected = false));
  $fTaxid.value = '';
  render();
}

async function downloadBib() {
  const bibMap = await bibMapPromise;
  const dois = [...selected];
  if (!dois.length) return;
  const parts = [];
  for (const d of dois) { if (bibMap[d]) parts.push(bibMap[d]); }
  if (!parts.length) return;
  const blob = new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `references_${new Date().toISOString().slice(0,10)}.bib`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

$fMethod.addEventListener('change', render);
$fOrder.addEventListener('change', render);
$fClass.addEventListener('change', render);
$fTaxid.addEventListener('input', render);
$btnClear.addEventListener('click', clearFilters);
$btnBib.addEventListener('click', downloadBib);

populateFilters();
render();
