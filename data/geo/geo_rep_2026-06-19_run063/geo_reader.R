#' geo_reader.R -- the reference reader for the geography contract.
#' Sourced by the dashboard. Depends only on readr and dplyr.
#'
#' THE CONTRACT IN ONE SENTENCE: never decide rendering yourself. Read
#' display_rule, look it up in d2_display_rule_vocabulary.csv, and do what it
#' says. A row with display_rule = withheld has no number and no substitute.
#'
#' THE VIEWS ARE NOT DEFINED IN THIS FILE. They are read from
#' b1_view_definitions.csv, which is the same file CONTRACT.md renders and the
#' figures filter by. An earlier version hardcoded them here and the three
#' artifacts drifted: the contract said 13 geographies, this reader returned 34
#' and the figure plotted 13.

read_geo <- function(run_dir, geo_level = NULL, estimand = NULL, metric = NULL,
                     include_gate_failures = TRUE, include_withheld = TRUE) {
  stopifnot(dir.exists(run_dir))
  lf <- list.files(run_dir, pattern = "^geo_representation_long_.*[.]csv$",
                   full.names = TRUE)
  if (length(lf) != 1)
    stop("expected exactly one geo_representation_long_*.csv in ", run_dir)
  long <- readr::read_csv(lf, show_col_types = FALSE, progress = FALSE)
  vocab <- readr::read_csv(file.path(run_dir, "d2_display_rule_vocabulary.csv"),
                           show_col_types = FALSE, progress = FALSE)
  out <- long
  if (!is.null(geo_level)) out <- out[out$geo_level %in% geo_level, , drop = FALSE]
  if (!is.null(estimand))  out <- out[out$estimand  %in% estimand,  , drop = FALSE]
  if (!is.null(metric))    out <- out[out$metric    %in% metric,    , drop = FALSE]
  if (!include_gate_failures) out <- out[out$gate_status == "pass", , drop = FALSE]
  if (!include_withheld)      out <- out[out$display_rule != "withheld", , drop = FALSE]
  out <- dplyr::left_join(out, vocab, by = "display_rule")
  if (any(is.na(out$ui_meaning)))
    stop("display_rule value not in the published vocabulary: ",
         paste(unique(out$display_rule[is.na(out$ui_meaning)]), collapse = ", "))
  out
}

#' rankable(x) -- the rows an app may put in a ranking or a top-N list.
rankable <- function(x) x[x$display_rule %in% c("show", "badge_concentration"), , drop = FALSE]

#' view_definitions(run_dir) -- the shipped view table. Read it rather than
#' hardcoding a view; it is what the contract and the figures use.
view_definitions <- function(run_dir)
  readr::read_csv(file.path(run_dir, "b1_view_definitions.csv"),
                  show_col_types = FALSE, progress = FALSE)

#' geo_view(run_dir, view_name) -- one named view, built from its definition.
geo_view <- function(run_dir, view_name) {
  d <- view_definitions(run_dir)
  r <- d[d$view_name == view_name, , drop = FALSE]
  if (nrow(r) != 1) stop("unknown view: ", view_name, ". Known: ",
                         paste(d$view_name, collapse = ", "))
  read_geo(run_dir, r$geo_level, strsplit(r$estimands, "[|]")[[1]], r$metric,
           include_gate_failures = r$include_gate_failures,
           include_withheld = r$include_withheld)
}

#' geo_tab_views(run_dir) -- every view the geography tab needs, by name.
geo_tab_views <- function(run_dir) {
  d <- view_definitions(run_dir)
  stats::setNames(lapply(d$view_name, function(v) geo_view(run_dir, v)), d$view_name)
}
