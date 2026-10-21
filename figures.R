## Alice Balard
## 2026

library(yaml)
library(jsonlite)
library(dplyr)
library(ggplot2)
library(forcats)
library(stringr)
library(rredlist)
library(rnaturalearth)
library(rnaturalearthdata)
library(sf)
library(geodata)
library(terra)
library(tidyr)
library(tidygeocoder)
library(patchwork)
library(cowplot)
library(tidygeocoder)

####################
## Method by year ##
####################

files <- list.files("data", pattern = "\\.yaml$", full.names = TRUE)
files <- files[!grepl("TEMPLATE", files, ignore.case = TRUE)]
entries <- lapply(files, read_yaml) |> bind_rows()

get_year <- function(doi) {
  url <- paste0("https://api.crossref.org/works/", URLencode(doi, reserved = TRUE))
  res <- tryCatch(fromJSON(url)$message$published$`date-parts`[[1]][1], error = \(e) NA)
  Sys.sleep(0.1); res
}
entries$year <- sapply(entries$doi, get_year)

all_methods <- unique(trimws(unlist(strsplit(entries$method, "\\s*\\+\\s*"))))
coloursMet <- setNames(
  c("#0072B2", "#E69F00", "#009E73", "#CC79A7", "#F0E442", "#D55E00")[seq_along(all_methods)],
  all_methods
)

p1 <- entries |>
  filter(!is.na(year)) |>
  mutate(year = as.integer(year)) |>
  separate_longer_delim(method, delim = regex("\\s*\\+\\s*")) |>  # split on +
  mutate(method = trimws(method)) |>
  count(year, method) |>
  ggplot(aes(x = year, y = n, fill = method)) +
  geom_col(position = position_dodge(preserve = "single")) +
  scale_x_continuous(breaks = \(x) seq(floor(min(x)), ceiling(max(x)), by = 1)) +
  scale_fill_manual(values = coloursMet) +
  labs(x = "Publication year", y = "Number of studies", fill = "Method") +
  theme_minimal(base_size = 13) +
  theme(
    axis.text.x        = element_text(angle = 45, hjust = 1),
    panel.grid.major.x = element_blank()
  )

###############################################
## Fetch temperature and geographical ranges ##
###############################################

if (nchar(Sys.getenv("IUCN_REDLIST_KEY")) == 0 && file.exists(".env")) {
  lines <- readLines(".env")
  for (line in lines)
    if (grepl("^IUCN_REDLIST_KEY=", line))
      Sys.setenv(IUCN_REDLIST_KEY = sub("^IUCN_REDLIST_KEY=", "", line))
}
token <- Sys.getenv("IUCN_REDLIST_KEY")
if (nchar(token) == 0) stop("Set IUCN_REDLIST_KEY")

taxonomy    <- fromJSON("cache/taxonomy.json")
species_list <- unique(na.omit(sapply(taxonomy, `[[`, "species")))
species_list <- species_list[nchar(species_list) > 0]

cache_file <- "cache/iucn_extra.json"
cache <- if (file.exists(cache_file)) fromJSON(cache_file, simplifyVector = FALSE) else list()

for (sp in species_list) {
  if (!is.null(cache[[sp]])) { cat("  (cached)", sp, "\n"); next }
  
  cat("Fetching:", sp, "\n")
  parts <- strsplit(sp, " ")[[1]]
  
  res <- tryCatch(
    rl_species_latest(genus = parts[1], species = parts[2], key = token),
    error = function(e) { cat("  ERROR:", conditionMessage(e), "\n"); NULL }
  )
  
  if (is.null(res)) { cache[[sp]] <- list(); Sys.sleep(0.5); next }
  
  countries    <- tryCatch(sort(unique(res$locations$code)),                    error = \(e) NULL)
  realm        <- tryCatch(tolower(paste(res$systems$description$en, collapse = ", ")), error = \(e) NULL)
  elev_low     <- tryCatch(res$supplementary_info$lower_elevation_limit,        error = \(e) NULL)
  elev_high    <- tryCatch(res$supplementary_info$upper_elevation_limit,        error = \(e) NULL)
  habitat_text <- tryCatch(res$documentation$habitats,                          error = \(e) NULL)
  range_text   <- tryCatch(res$documentation$range,                             error = \(e) NULL)
  
  cache[[sp]] <- list(
    countries    = countries,
    realm        = realm,
    elev_low_m   = elev_low,
    elev_high_m  = elev_high,
    habitat_text = habitat_text,
    range_text   = range_text
  )
  Sys.sleep(0.5)
}

write(toJSON(cache, pretty = TRUE, auto_unbox = TRUE), cache_file)
cat("\nSaved to", cache_file, "—", sum(sapply(cache, \(x) length(x) > 0)), "entries\n")

##############
## Make map ##
##############

country_df <- lapply(names(cache), function(sp) {
  cc <- unlist(cache[[sp]]$countries)
  if (is.null(cc) || length(cc) == 0) return(NULL)
  cc <- as.character(cc)
  cc[is.na(cc)] <- "NA"
  data.frame(species = sp, iso_a2 = cc, stringsAsFactors = FALSE)
}) |> bind_rows()

country_counts <- country_df |>
  group_by(iso_a2) |>
  summarise(n_species = n_distinct(species), .groups = "drop")

world     <- ne_countries(scale = "medium", returnclass = "sf") |> select(iso_a2, geometry)
map_data  <- world |> left_join(country_counts, by = "iso_a2")

# ── Geocode sampling locations (split on comma for multiple) ─────────────────
loc_cache_file <- "cache/locations_geocoded.rds"
loc_input <- entries |>
  filter(!is.na(location) & nchar(location) > 0) |>
  select(taxid, location) |>
  rowwise() |>
  mutate(loc_split = list(trimws(strsplit(location, ",")[[1]]))) |>
  tidyr::unnest(loc_split) |>
  filter(nchar(loc_split) > 0) |>
  distinct(loc_split) |>
  rename(address = loc_split)

if (file.exists(loc_cache_file)) {
  locs_geo <- readRDS(loc_cache_file)
  new_locs <- loc_input |> filter(!address %in% locs_geo$address)
  if (nrow(new_locs) > 0) {
    new_geo  <- new_locs |> geocode(address = address, method = "osm", lat = lat, long = lon)
    locs_geo <- bind_rows(locs_geo, new_geo)
    saveRDS(locs_geo, loc_cache_file)
  }
} else {
  locs_geo <- loc_input |> geocode(address = address, method = "osm", lat = lat, long = lon)
  saveRDS(locs_geo, loc_cache_file)
}

locs_geo <- locs_geo |> filter(!is.na(lon), !is.na(lat))

p2 <- ggplot(map_data) +
  geom_sf(aes(fill = n_species), colour = "white", linewidth = 0.15) +
  scale_fill_viridis_c(
    option = "mako", direction = -1,
    na.value = "#e8e8e8",
    name = "N species\nstudied"
  ) +
  geom_point(
    data = locs_geo |> filter(!is.na(lon)),
    aes(x = lon, y = lat),
    colour = "white", fill = "#e8272c",
    shape = 21, size = 2.5, stroke = 0.6
  ) +
  geom_point(
    data  = locs_geo,
    aes(x = lon, y = lat),
    colour = "white", fill = "#e8272c",
    shape = 21, size = 2.5, stroke = 0.6
  ) +
  coord_sf(expand = FALSE) +
  labs(
    title    = "Geographic distribution of wild epigenomics study species",
    subtitle = "Based on IUCN range data · red dots = sampling locations") +
  theme_void(base_size = 12) +
  theme(
    plot.title      = element_text(face = "bold", margin = margin(b = 4), hjust = 0.5),
    plot.subtitle = element_text(colour = "grey40", hjust = 0.5),
    legend.position = "right"
  )

###################################
## Temperature range per species ##
###################################

`%||%` <- function(a, b) if (!is.null(a)) a else b

wc_dir <- "cache/worldclim"
dir.create(wc_dir, showWarnings = FALSE)
tavg      <- worldclim_global(var = "tavg", res = 10, path = wc_dir)
tavg_mean <- mean(tavg)

world_cents <- ne_countries(scale = "medium", returnclass = "sf") |>
  st_centroid() |>
  select(iso_a2)

parse_temp_text <- function(txt) {
  if (length(txt) == 0 || all(is.na(txt)) || all(nchar(na.omit(txt)) == 0)) return(NULL)
  txt <- paste(na.omit(txt), collapse = " ")
  m <- str_match_all(txt,
                     "([-−]?\\d+(?:\\.\\d+)?)\\s*(?:to|–|-|and)\\s*([-−]?\\d+(?:\\.\\d+)?)\\s*°?\\s*C")[[1]]
  if (nrow(m) == 0) return(NULL)
  list(
    temp_min_C = min(as.numeric(gsub("−", "-", m[, 2]))),
    temp_max_C = max(as.numeric(gsub("−", "-", m[, 3]))),
    source     = "iucn_text"
  )
}

cache_out  <- "cache/iucn_temp.json"
temp_cache <- if (file.exists(cache_out)) fromJSON(cache_out, simplifyVector = FALSE) else list()

for (sp in names(cache)) {
  if (!is.null(temp_cache[[sp]])) { cat("  (cached)", sp, "\n"); next }
  entry <- cache[[sp]]
  cat("Processing:", sp, "\n")
  
  result <- parse_temp_text(entry$habitat_text) %||% parse_temp_text(entry$range_text)
  
  if (is.null(result)) {
    countries <- as.character(unlist(entry$countries))
    countries[is.na(countries)] <- "NA"
    pts  <- world_cents |> filter(iso_a2 %in% countries)
    if (nrow(pts) > 0) {
      vals <- terra::extract(tavg_mean, vect(pts))$mean
      vals <- vals[!is.na(vals)]
      if (length(vals) > 0)
        result <- list(
          temp_min_C = round(min(vals), 1),
          temp_max_C = round(max(vals), 1),
          source     = "worldclim_country_centroids"
        )
    }
  }
  
  temp_cache[[sp]] <- if (!is.null(result)) result else list()
}

write(toJSON(temp_cache, pretty = TRUE, auto_unbox = TRUE), cache_out)
cat("\nSaved to", cache_out, "\n")

temp_df <- lapply(names(temp_cache), function(sp) {
  x <- temp_cache[[sp]]
  if (length(x) == 0) return(NULL)
  data.frame(species = sp, temp_min_C = x$temp_min_C,
             temp_max_C = x$temp_max_C, source = x$source)
}) |> bind_rows()

p3 <- temp_df |>
  mutate(
    species   = factor(species, levels = species[order(temp_min_C)]),
    range_mid = (temp_min_C + temp_max_C) / 2
  ) |>
  ggplot(aes(y = species)) +
  geom_segment(aes(x = temp_min_C, xend = temp_max_C,
                   yend = species, colour = range_mid),
               linewidth = 3, lineend = "round") +
  geom_text(aes(x = temp_min_C, label = paste0(temp_min_C, "°")),
            hjust = 1.2, size = 3, colour = "grey40") +
  geom_text(aes(x = temp_max_C, label = paste0(temp_max_C, "°")),
            hjust = -0.2, size = 3, colour = "grey40") +
  scale_colour_gradientn(
    colours = c("#2166ac", "#74add1", "#abd9e9", "#fee090", "#f46d43", "#d73027"),
    name    = "Mid\ntemp (°C)"
  ) +
  geom_vline(xintercept = 0, linetype = "dashed", colour = "grey60", linewidth = 0.4) +
  labs(x = "Mean annual temperature range (°C)", y = NULL,
       title    = "Temperature range of study species",
       subtitle = "Based on WorldClim at country level · sorted by minimum temperature") +
  theme_minimal(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", margin = margin(b = 4), hjust = 0.5),
    plot.subtitle = element_text(colour = "grey40", hjust = 0.5),
    legend.position = "right"
  )

####################
## Combined figure ##
####################

plot <- cowplot::plot_grid(
  p1, p2, p3, nrow = 3, labels = c("A", "B", "C")) +
  plot_annotation(
    title   = paste0("Wild epigenomics catalog: overview on the ", Sys.Date()),
    theme   = theme(plot.title = element_text(size = 16, face = "bold")))

ggsave("plot.pdf", plot, width = 8, height = 12)
