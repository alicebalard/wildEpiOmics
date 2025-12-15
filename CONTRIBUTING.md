
# Contributing to wildEpiOmics

Thanks for contributing! To add or update a dataset:

1. Check `data/schema.json` for required fields.
2. Edit `data/datasets.json`.
3. Prefer **open** repositories (NCBI SRA/ENA/GEO/ArrayExpress/EVA) and stable accession links.
4. Provide **citations** as CSL-JSON when possible. If not available, add a short reference in `references_text`.
5. Open a Pull Request. CI will validate the JSON against the schema.

**Field conventions**
- `technique`: use terms like `RRBS`, `WGBS`, `ATAC-seq`, `RNA-seq`, `custom RRBS (epiGBS)`.
- `species`: free text accepted for now. Add `genus` when certain.
- `accession`: string or array of strings (e.g., `PRJNA…`, `SRP…`).
- `tissue`: string or array.

**Code of Conduct**
Be respectful and constructive. Submissions should reference openly available data.
