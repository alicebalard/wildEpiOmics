// Client-side logic: filter UI + selection + BibTeX download
let entries = window.__DATA__ || [];

const $cards = document.getElementById('cards');
const $fMethod = document.getElementById('f-method');
const $fCondition = document.getElementById('f-condition');
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

// --- Multi-value parsing -------------------------------------------------
// method: "RRBS+WGBS" -> ["RRBS","WGBS"]  (also tolerates / , ; & and "and")
function methodList(e) {
  if (!e.method) return [];
  return String(e.method)
    .split(/\s*[+/,;&]\s*|\s+and\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
}
// condition: "pollution; early-life adversity" -> ["pollution","early-life adversity"]
function conditionList(e) {
  if (!e.condition) return [];
  return String(e.condition)
    .split(/\s*;\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

function uniqueSorted(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Build a list of toggle-able checkboxes inside a container div.
function buildCheckboxes(container, values) {
  container.innerHTML = '';
  for (const v of values) {
    const label = document.createElement('label');
    label.className = 'checkbox-option';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = v;
    cb.addEventListener('change', render);

    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + v));
    container.appendChild(label);
  }
}

function populateFilters() {
  const methods    = uniqueSorted(entries.flatMap(methodList));
  const conditions = uniqueSorted(entries.flatMap(conditionList));
  const orders     = uniqueSorted(entries.map(e => e.order));
  const classes    = uniqueSorted(entries.map(e => e.class));
  const tissues    = uniqueSorted(entries.map(e => e.tissue));

  buildCheckboxes($fMethod, methods);
  buildCheckboxes($fCondition, conditions);
  buildCheckboxes($fOrder, orders);
  buildCheckboxes($fClass, classes);
  buildCheckboxes($fTissue, tissues);
}

function getCheckedValues(container) {
  return [...container.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
}

function applyFilters() {
  const fm    = new Set(getCheckedValues($fMethod));
  const fcond = new Set(getCheckedValues($fCondition));
  const fo    = new Set(getCheckedValues($fOrder));
  const fc    = new Set(getCheckedValues($fClass));
  const ft    = new Set(getCheckedValues($fTissue));
  const minInd = parseInt($fMinInd.value) || 0;
  const speciesText = ($fSpecies.value || '').trim().toLowerCase();

  return entries.filter(e => {
    // Method matches if the study uses ANY selected method (so a RRBS+WGBS
    // study shows up under both "RRBS" and "WGBS").
    if (fm.size && !methodList(e).some(m => fm.has(m))) return false;
    // Condition matches if the study tests ANY selected condition.
    if (fcond.size && !conditionList(e).some(c => fcond.has(c))) return false;
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
      // Clean markdown links: [text](url) -> url
      let cleanImageUrl = e.image;
      const urlMatch = e.image.match(/\[.*?\]\((.*?)\)/);
      if (urlMatch) cleanImageUrl = urlMatch[1];

      const imgContainer = document.createElement('div');
      imgContainer.className = 'image-container';

      const img = document.createElement('img');
      img.src = cleanImageUrl;
      img.alt = e.common_name || e.species || 'Species image';
      img.className = 'species-image';
      imgContainer.appendChild(img);

      // ---- IMAGE CREDIT ----
      if (e.image_credit) {
        const credit = document.createElement('div');
        credit.className = 'image-credit';
        credit.textContent = e.image_credit;
        imgContainer.appendChild(credit);
      }

      card.appendChild(imgContainer);
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
    const methods = methodList(e);
    const methodLabel = methods.length ? methods.join(' + ') : (e.method || '-');
    const isMultiomics = methods.length > 1;
    const conditions = conditionList(e);

    const meta = document.createElement('div');
    meta.className = 'meta';

    meta.innerHTML = `
      <span><strong>TaxID:</strong> ${e.taxid}</span>
      <span><strong>Order:</strong> ${e.order || '-'}</span>
      <span><strong>Class:</strong> ${e.class || '-'}</span>
      <span><strong>Method:</strong> ${methodLabel}${isMultiomics ? ' <em class="multiomics">multi-omics</em>' : ''}</span>
      <span><strong>N:</strong> ${e.individuals}</span>
      <span><strong>Tissue:</strong> ${e.tissue}</span>
      ${conditions.length ? `<span><strong>Condition:</strong> ${conditions.join(', ')}</span>` : ''}
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
      <a class="link" href="${doiHref}" target="_blank" rel="noopener">Article</a>
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

  // checkbox event listeners (card selection for BibTeX)
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
  // uncheck every filter checkbox
  document.querySelectorAll('.checkbox-group input[type=checkbox]').forEach(cb => (cb.checked = false));

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
  $btnClear.addEventListener('click', clearFilters);
  $fMinInd.addEventListener('input', render);
  $fSpecies.addEventListener('input', render);
  $btnBib.addEventListener('click', downloadBib);

  populateFilters();
  render();
});
