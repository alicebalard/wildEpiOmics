
# wildEpiOmics

A minimal, free GitHub Pages site that lists openly available animal epigenomics datasets with filters and on-demand citation export.

## Quick start

1. **Create a GitHub repository** named `wildEpiOmics` and upload the contents of this folder.
2. In **Settings → Pages**, set **Source** to *Deploy from a branch* and choose `main` and `/ (root)`.
3. Your site will appear at `https://<your-username>.github.io/wildEpiOmics`.

## Data

- Edit `data/datasets.json` to add or modify entries.
- Schema is defined in `data/schema.json` and validated in CI for pull requests.
- This starter supports either:
  - Proper **CSL-JSON** citations in `citations`, or
  - Simple **text references** in `references_text` (fallback for clipboard/export).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

- Website code: MIT License (see `LICENSE`).
- Dataset metadata: provide source-specific licenses in each entry; assume rights and attribution per original repositories and publications.
