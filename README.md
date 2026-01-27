## Status

[![Build & Deploy](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml/badge.svg)](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml)
[![Parse Reviewed Entries](https://github.com/alicebalard/wildEpiOmics/actions/workflows/parse-reviewed.yml/badge.svg)](https://github.com/alicebalard/wildEpiOmics/actions/workflows/parse-reviewed.yml)

![Study count](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/alicebalard/wildEpiOmics/main/.meta/study_count.json)
![Last deploy](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/alicebalard/wildEpiOmics/main/.meta/last_deploy.json)

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-wildEpiOmics-blue)](https://alicebalard.github.io/wildEpiOmics/)

# Biodiversity Study Catalog

Static site that lists studies with DOI, NCBI TaxID, number of individuals, source-data link, and method.
At build time it resolves **species / order / class** via NCBI E-utilities and retrieves **BibTeX** for DOIs using DOI content negotiation.

## Quickstart
```bash
npm ci
npm run build
# open index.html in a browser, or host locally
```

## Deploy
Push to `main` triggers GitHub Actions to build and deploy to GitHub Pages.

## References
- NCBI E-utilities reference & usage guidance: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
- DOI content negotiation (BibTeX): https://www.crossref.org/documentation/retrieve-metadata/content-negotiation/ and https://www.doi.org/doi-handbook/HTML/content-negotiation.html
