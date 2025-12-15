
let DATA = [];
let selectedIds = new Set();

function arrify(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
function uniqueSorted(arr) { return Array.from(new Set(arr)).sort((a,b)=>String(a).localeCompare(String(b))); }

function populateFilters(entries) {
  const species = uniqueSorted(entries.map(e => e.species).filter(Boolean));
  const genus = uniqueSorted(entries.map(e => e.genus).filter(Boolean));
  const techniques = uniqueSorted(entries.flatMap(e => e.technique || []).filter(Boolean));
  const repos = uniqueSorted(entries.map(e => e.repository).filter(Boolean));

  const fill = (id, items) => {
    const sel = document.getElementById(id);
    items.forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = v; sel.appendChild(opt); });
  };

  fill('speciesFilter', species);
  fill('genusFilter', genus);
  fill('techniqueFilter', techniques);
  fill('repoFilter', repos);
}

function renderTable(entries) {
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';

  entries.forEach(e => {
    const tr = document.createElement('tr');

    const tdSel = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(e.id);
    cb.addEventListener('change', () => { if (cb.checked) selectedIds.add(e.id); else selectedIds.delete(e.id); updateSelectionCount(); });
    tdSel.appendChild(cb);

    const tdTitle = document.createElement('td');
    tdTitle.innerHTML = `<a href="${e.url}" target="_blank" rel="noopener">${e.title}</a>`;

    const tdSpecies = document.createElement('td');
    tdSpecies.textContent = e.species || '';

    const tdTech = document.createElement('td');
    tdTech.textContent = arrify(e.technique).join(', ');

    const tdRepo = document.createElement('td');
    tdRepo.textContent = e.repository || '';

    const tdAcc = document.createElement('td');
    const acc = arrify(e.accession).join(', ');
    tdAcc.textContent = acc;

    const tdN = document.createElement('td');
    tdN.textContent = e.n_individuals != null ? String(e.n_individuals) : '';

    const tdTissue = document.createElement('td');
    tdTissue.textContent = arrify(e.tissue).join(', ');

    const tdSummary = document.createElement('td');
    tdSummary.textContent = e.summary || '';

    tr.append(tdSel, tdTitle, tdSpecies, tdTech, tdRepo, tdAcc, tdN, tdTissue, tdSummary);
    tbody.appendChild(tr);
  });
}

function applyFilters() {
  const searchText = document.getElementById('searchText').value.trim().toLowerCase();
  const species = document.getElementById('speciesFilter').value;
  const genus = document.getElementById('genusFilter').value;
  const technique = document.getElementById('techniqueFilter').value;
  const repo = document.getElementById('repoFilter').value;

  let filtered = DATA.filter(e => {
    const byText = !searchText || (
      (e.title || '').toLowerCase().includes(searchText) ||
      (e.summary || '').toLowerCase().includes(searchText) ||
      arrify(e.keywords).join(' ').toLowerCase().includes(searchText)
    );
    const bySpecies = !species || e.species === species;
    const byGenus = !genus || e.genus === genus;
    const byTechnique = !technique || arrify(e.technique).includes(technique);
    const byRepo = !repo || e.repository === repo;
    return byText && bySpecies && byGenus && byTechnique && byRepo;
  });

  renderTable(filtered);
}

function updateSelectionCount() {
  document.getElementById('selectionCount').textContent = `${selectedIds.size} selected`;
}

function selectedCitations() {
  const sel = DATA.filter(e => selectedIds.has(e.id));
  const csl = sel.flatMap(e => e.citations || []);
  const text = sel.flatMap(e => e.references_text || []);
  return { csl, text };
}

function copyAPA() {
  const { csl, text } = selectedCitations();
  if (csl.length === 0 && text.length === 0) { alert('Select at least one entry.'); return; }

  let out = '';
  if (csl.length > 0 && typeof window.Cite !== 'undefined') {
    const cite = new window.Cite(csl);
    out = cite.format('citation', { format: 'text', style: 'citation-apa', lang: 'en-US' });
  } else if (csl.length > 0) {
    out = csl.map(c => {
      const authors = (c.author || []).map(a => `${a.family}, ${a.given?.[0] || ''}.`).join(', ');
      const year = (c.issued && c.issued['date-parts'] && c.issued['date-parts'][0][0]) || 'n.d.';
      const journal = c['container-title'] || '';
      const vol = c.volume ? `, ${c.volume}` : '';
      const pages = c.page ? `, ${c.page}` : '';
      const doi = c.DOI ? ` https://doi.org/${c.DOI}` : '';
      return `${authors} (${year}). ${c.title}. ${journal}${vol}${pages}.${doi}`.trim();
    }).join('
');
  }

  if (text.length > 0) {
    const block = text.join('
');
    out = out ? (out + '
' + block) : block;
  }

  navigator.clipboard.writeText(out).then(() => alert('Citations copied to clipboard.'));
}

function downloadBib() {
  const { csl, text } = selectedCitations();
  if (csl.length === 0 && text.length === 0) { alert('Select at least one entry.'); return; }

  if (csl.length > 0 && typeof window.Cite !== 'undefined') {
    const cite = new window.Cite(csl);
    const bib = cite.format('bibtex');
    const blob = new Blob([bib], { type: 'text/x-bibtex;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'citations.bib';
    a.click();
  } else {
    const txt = (text.length > 0 ? text : csl.map(c => c.title)).join('
');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'citations.txt';
    a.click();
  }
}

function initEvents() {
  ['searchText', 'speciesFilter', 'genusFilter', 'techniqueFilter', 'repoFilter']
    .forEach(id => document.getElementById(id).addEventListener('input', applyFilters));

  document.getElementById('clearFilters').addEventListener('click', () => {
    ['searchText','speciesFilter','genusFilter','techniqueFilter','repoFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el.tagName === 'INPUT') el.value = '';
      else el.selectedIndex = 0;
    });
    applyFilters();
  });

  document.getElementById('copyAPA').addEventListener('click', copyAPA);
  document.getElementById('downloadBib').addEventListener('click', downloadBib);
}

async function loadData() {
  const res = await fetch('data/datasets.json');
  DATA = await res.json();
  populateFilters(DATA);
  renderTable(DATA);
  updateSelectionCount();
}

window.addEventListener('DOMContentLoaded', () => { initEvents(); loadData(); });
