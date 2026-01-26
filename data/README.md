# Data schema for entries

Each file in `data/*.yaml` should follow this schema:

Required keys:
- `doi`: string, e.g. `10.1038/s41586-020-2012-7`
- `taxid`: integer (NCBI Taxonomy ID), e.g. `9606`
- `individuals`: integer (sample size)
- `data_url`: string (URL to source data repository)
- `method`: string (e.g., `WGS`, `Exome`, `RAD-seq`, `SNP array`)

Optional keys:
- `notes`: free text/markdown

Derived at build time (do not write manually):
- `species`, `order`, `class`
