# fetch-iucn.R — run locally to populate cache/iucn.json
#
# Install rredlist if needed:
#   install.packages("rredlist")
#
# Usage — set your IUCN token then source this script:
#   Sys.setenv(IUCN_REDLIST_KEY = "your_token_here")
#   source("fetch-iucn.R")
#
# Then commit the result:
#   git add cache/iucn.json && git commit -m "Populate IUCN cache" && git push

library(rredlist)
library(jsonlite)

`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a)) a else b

token <- Sys.getenv("IUCN_REDLIST_KEY")
if (nchar(token) == 0) stop("Set IUCN_REDLIST_KEY env var first")

# Read species names from the NCBI taxonomy cache
taxonomy <- fromJSON("cache/taxonomy.json")
species_names <- unique(sapply(taxonomy, `[[`, "species"))
species_names <- species_names[!is.na(species_names) & nchar(species_names) > 0]
cat("Found", length(species_names), "unique species\n")

# Load existing cache to avoid re-fetching
cache_file <- "cache/iucn.json"
existing <- if (file.exists(cache_file)) fromJSON(cache_file, simplifyVector = FALSE) else list()

results <- existing

for (sp in species_names) {
  if (!is.null(results[[sp]])) {
    cat("  (cached)", sp, "\n")
    next
  }
  tryCatch({
    # rredlist >= 1.0.0 uses rl_species() (IUCN v4 API)
    res <- rl_species(sp, key = token)
    # rl_species returns a list; taxon info is in res$taxon, assessment in res$assessments
    taxon <- res$taxon
    assessment <- if (!is.null(res$assessments) && length(res$assessments) > 0)
      res$assessments[[1]] else NULL
    if (!is.null(taxon) && !is.null(assessment)) {
      sis_id <- taxon$sis_id %||% taxon$taxonid
      results[[sp]] <- list(
        iucn_status    = assessment$red_list_category$code %||% assessment$category,
        iucn_pop_trend = assessment$population_trend$description %||% assessment$population_trend,
        iucn_url       = paste0("https://www.iucnredlist.org/species/", sis_id)
      )
      cat("  OK", sp, ":", results[[sp]]$iucn_status, "(", results[[sp]]$iucn_pop_trend, ")\n")
    } else {
      results[[sp]] <- NULL
      cat("  not found:", sp, "\n")
    }
  }, error = function(e) {
    cat("  ERROR", sp, ":", conditionMessage(e), "\n")
    results[[sp]] <<- NULL
  })
  Sys.sleep(0.5)
}

write(toJSON(results, pretty = TRUE, auto_unbox = TRUE), cache_file)
cat("\nWritten to", cache_file, "-", length(results), "entries\n")
cat("Now run: git add cache/iucn.json && git commit -m 'Populate IUCN cache' && git push\n")
