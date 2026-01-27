## Deployment Status

[![Deploy to GitHub Pages](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml/badge.svg)](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml)

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
