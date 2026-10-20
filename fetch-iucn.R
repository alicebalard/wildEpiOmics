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

# Try loading token from .env file if not already set
if (nchar(Sys.getenv("IUCN_REDLIST_KEY")) == 0 && file.exists(".env")) {
  lines <- readLines(".env")
  for (line in lines) {
    if (grepl("^IUCN_REDLIST_KEY=", line)) {
      Sys.setenv(IUCN_REDLIST_KEY = sub("^IUCN_REDLIST_KEY=", "", line))
    }
  }
}
token <- Sys.getenv("IUCN_REDLIST_KEY")
if (nchar(token) == 0) stop("Set IUCN_REDLIST_KEY in a .env file or as env var")

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
    parts <- strsplit(sp, " ")[[1]]
    res <- rl_species(genus = parts[1], species = parts[2], key = token)
    assessments <- res$assessments
    if (!is.null(assessments) && nrow(assessments) > 0) {
      latest <- assessments[assessments$latest == TRUE, ]
      if (nrow(latest) == 0) latest <- assessments[1, ]  # fallback to first
      # Extract realm from systems field in assessment
      realm <- tryCatch({
        sys <- latest$systems[1]
        if (is.null(sys) || is.na(sys) || nchar(sys) == 0) NA_character_
        else {
          parts <- strsplit(sys, "[,;|/]+")[[1]]
          parts <- trimws(tolower(parts))
          parts <- parts[nchar(parts) > 0]
          paste(parts, collapse = ", ")
        }
      }, error = function(e) NA_character_)

      results[[sp]] <- list(
        iucn_status    = latest$red_list_category_code[1],
        iucn_url       = latest$url[1],
        iucn_realm     = if (!is.na(realm)) realm else NULL
      )
      cat("  OK", sp, ":", results[[sp]]$iucn_status, "\n")
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
