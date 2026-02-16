// Client-side logic: filter UI + selection + BibTeX download
let entries = window.__DATA__ || [];

const $cards = document.getElementById('cards');
const $fMethod = document.getElementById('f-method');
const $fOrder = document.getElementById('f-order');
const $fClass = document.getElementById('f-class');
const $fTissue = document.getElementById('f-tissue');
const $fMinInd = document.getElementById('f-min-ind');
const $fSpecies = document.getElementById('f-species');
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
  const tissues = uniqueSorted(entries.map(e => e.tissue));

  for (const v of methods) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fMethod.appendChild(o); }
  for (const v of orders) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fOrder.appendChild(o); }
  for (const v of classes) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fClass.appendChild(o); }
  for (const v of tissues) { const o = document.createElement('option'); o.value = v; o.textContent = v; $fTissue.appendChild(o); }
}

function getSelectedValues(sel) {
  return [...sel.options].filter(o => o.selected).map(o => o.value);
}

function applyFilters() {
  const fm = new Set(getSelectedValues($fMethod));
  const fo = new Set(getSelectedValues($fOrder));
  const fc = new Set(getSelectedValues($fClass));
  const ft = new Set(getSelectedValues($fTissue));  
  const minInd = parseInt($fMinInd.value) || 0;
  const speciesText = ($fSpecies.value || '').trim().toLowerCase();

  return entries.filter(e => {
    if (fm.size && !fm.has(e.method)) return false;
    if (fo.size && !fo.has(e.order)) return false;
    if (fc.size && !fc.has(e.class)) return false;
    if (ft.size && !ft.has(e.tissue)) return false;
    if (minInd > 0 && (parseInt(e.individuals) || 0) < minInd) return false;
    if (speciesText && !(e.species || '').toLowerCase().includes(speciesText)) return false;
    
    return true;
  });
}

function render() {
  let list = applyFilters();
  
  // Sort alphabetically by species name (fallback to TaxID)
  list.sort((a, b) => {
    const nameA = (a.species || '').toLowerCase();
    const nameB = (b.species || '').toLowerCase();
    return nameA.localeCompare(nameB) || String(a.taxid).localeCompare(String(b.taxid));
  });
  
  $cards.innerHTML = '';

  for (const e of list) {
    const card = document.createElement('div');
    card.className = 'card';

    // ---- IMAGE ----
    if (e.image) {
      const img = document.createElement('img');
      img.src = e.image;
      img.alt = e.common_name || e.species || 'Species image';
      img.className = 'species-image';
      card.appendChild(img);
    }

    // ---- HEADER ----
    const title = document.createElement('h3');
    title.textContent = e.species || `TaxID ${e.taxid}`;
    card.appendChild(title);

    // ---- COMMON NAME ----
    if (e.common_name) {
      const cn = document.createElement('div');
      cn.className = 'common-name';
      cn.textContent = e.common_name;
      card.appendChild(cn);
    }

    // ---- META ----
    const meta = document.createElement('div');
    meta.className = 'meta';

    meta.innerHTML = `
      <span><strong>TaxID:</strong> ${e.taxid}</span>
      <span><strong>Order:</strong> ${e.order || '-'}</span>
      <span><strong>Class:</strong> ${e.class || '-'}</span>
      <span><strong>Method:</strong> ${e.method}</span>
      <span><strong>N:</strong> ${e.individuals}</span>
      <span><strong>Tissue:</strong> ${e.tissue}</span>

    `;
    card.appendChild(meta);

    // ---- LINKS ----
    const links = document.createElement('div');
    links.className = 'actions';

    const doiHref = `https://doi.org/${encodeURIComponent(e.doi)}`;
    const dataHref = e.data_url;
    links.innerHTML = `
      <label>
        <input type="checkbox" class="checkbox" data-doi="${e.doi}" ${selected.has(e.doi) ? 'checked' : ''}/>
        Select
      </label>
      <a class="link" href="${doiHref}" target="_blank" rel="noopener">DOI</a>
    `;
    if (dataHref) {
      links.innerHTML += `
      <a class="link" href="${dataHref}" target="_blank" rel="noopener">Source data</a>
      `;
    }
    card.appendChild(links);

    // ---- NOTES ----
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

  // checkbox event listeners
  document.querySelectorAll('.checkbox').forEach(cb => {
    cb.addEventListener('change', (ev) => {
      const doi = ev.target.getAttribute('data-doi');
      if (ev.target.checked) selected.add(doi);
      else selected.delete(doi);

      $selCount.textContent = selected.size ? `${selected.size} selected` : '';
    });
  });

  $selCount.textContent = selected.size ? `${selected.size} selected` : '';
}

function clearFilters() {
  // clear multi-selects
  [...$fMethod.options].forEach(o => (o.selected = false));
  [...$fOrder.options].forEach(o => (o.selected = false));
  [...$fClass.options].forEach(o => (o.selected = false));
  [...$fTissue.options].forEach(o => (o.selected = false));
  
  // clear scalar inputs
  $fMinInd.value = '';
  $fSpecies.value = '';
  
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

document.addEventListener('DOMContentLoaded', function() {
  $fMethod.addEventListener('change', render);
  $fOrder.addEventListener('change', render);
  $fClass.addEventListener('change', render);
  $fTissue.addEventListener('change', render);
  $btnClear.addEventListener('click', clearFilters);
  $fMinInd.addEventListener('input', render);
  $fSpecies.addEventListener('input', render);
  $btnBib.addEventListener('click', downloadBib);

  populateFilters();
  render();
});
