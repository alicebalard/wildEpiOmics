## Status

[![Build & Deploy](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml/badge.svg)](https://github.com/alicebalard/wildEpiOmics/actions/workflows/deploy.yml)
[![Parse Reviewed Entries](https://github.com/alicebalard/wildEpiOmics/actions/workflows/parse-reviewed.yml/badge.svg)](https://github.com/alicebalard/wildEpiOmics/actions/workflows/parse-reviewed.yml)

![Study count](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/alicebalard/wildEpiOmics/main/.meta/study_count.json)
![Last deploy](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/alicebalard/wildEpiOmics/main/.meta/last_deploy.json)

# Wildlife DNA methylation studies raw data catalog
Link to the webpage &rarr; [![Live Site](https://img.shields.io/badge/🌐_Live_Site-wildEpiOmics-blue)](https://alicebalard.github.io/wildEpiOmics/)

## How to add an entry?
With a gihub account:
- click on the tab "Issues", then "New issue" button, and fill the form
- your issue will be reviewed by a maintainer and added to the website

Without a gihub account, send ALL the following information to alice.cam.balard@gmail.com who will add your study:
- doi of the study (e.g. 10.1038/s41586-024-12345-6)
- NCBI Taxon ID (e.g. `9606` for human, `10090` for mouse; find yours at https://www.ncbi.nlm.nih.gov/datasets/taxonomy/tree/)
- tissue sampled (e.g. blood, liver...)
- URL of raw data (e.g. https://www.ncbi.nlm.nih.gov/sra/?term=SRP058411)
- method (e.g. `RRBS, WGBS...)
- number of sequenced individuals (e.g. 10, 15...)
- Notes (optional)
        
## Notes for maintainer:
- build.js has the combinations of genus/orders/class hardcoded, be careful if you add new genera to update this!
