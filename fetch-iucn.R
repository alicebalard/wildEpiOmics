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
    res <- rl_search(sp, key = token)$result
    if (length(res) > 0) {
      r <- res[[1]]
      results[[sp]] <- list(
        iucn_status    = r$category,
        iucn_pop_trend = r$population_trend,
        iucn_url       = paste0("https://www.iucnredlist.org/species/", r$taxonid)
      )
      cat("  OK", sp, ":", r$category, "(", r$population_trend, ")\n")
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
