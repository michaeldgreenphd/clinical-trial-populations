#!/usr/bin/env Rscript
# ---------------------------------------------------------------------------
# scrape_fda_metadata.R
#
# Scrapes additional metadata from the FDA CDRH PMN database for each
# AI/ML-enabled device listed in the source CSV. Joins the scraped fields
# with the original dataset and exports an enriched CSV.
#
# Usage:
#   Rscript scripts/scrape_fda_metadata.R
#
# Requirements:
#   install.packages(c("rvest", "httr", "dplyr", "readr", "purrr", "stringr"))
# ---------------------------------------------------------------------------

library(rvest)
library(httr)
library(dplyr)
library(readr)
library(purrr)
library(stringr)

# --- Configuration ---------------------------------------------------------
INPUT_CSV  <- "data/ai-ml-enabled-devices-csv_20260305.csv"
OUTPUT_CSV <- "data/ai-ml-devices-enriched.csv"

# FDA database URL routing by submission type prefix
# K = 510(k) PMN, DEN = De Novo, P = PMA
get_fda_url <- function(submission_number) {
  sn <- toupper(trimws(submission_number))
  if (startsWith(sn, "DEN")) {
    return(paste0("https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=",
                  URLencode(submission_number)))
  } else if (startsWith(sn, "P")) {
    return(paste0("https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=",
                  URLencode(submission_number)))
  } else {
    return(paste0("https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=",
                  URLencode(submission_number)))
  }
}

# Polite scraping: pause between requests (seconds)
REQUEST_DELAY <- 2

# Maximum retries per URL
MAX_RETRIES <- 3

# --- Helper: scrape a single FDA submission page ---------------------------
scrape_submission <- function(submission_number) {
  url <- get_fda_url(submission_number)

  for (attempt in seq_len(MAX_RETRIES)) {
    tryCatch({
      message(sprintf("  [%d/%d] Fetching %s ...", attempt, MAX_RETRIES, submission_number))

      resp <- GET(
        url,
        user_agent("CivicTrial-FDAScraper/1.0 (research; contact: info@civictrial.com)"),
        timeout(30)
      )

      if (http_error(resp)) {
        warning(sprintf("HTTP %d for %s", status_code(resp), submission_number))
        Sys.sleep(REQUEST_DELAY * attempt)
        next
      }

      page <- read_html(content(resp, as = "text", encoding = "UTF-8"))

      # The FDA PMN page typically renders device details inside HTML tables.
      # We parse all tables and look for label-value pairs.
      tables <- page %>% html_elements("table")

      # Build a named list from all table cells that look like key-value rows
      metadata <- list(
        regulation_number = NA_character_,
        regulation_name   = NA_character_,
        product_code_desc = NA_character_,
        decision          = NA_character_,
        applicant         = NA_character_,
        review_advise_comm = NA_character_
      )

      # Strategy: iterate through all <th>/<td> pairs in tables
      for (tbl in tables) {
        rows <- tbl %>% html_elements("tr")
        for (row in rows) {
          cells <- row %>% html_elements("th, td")
          if (length(cells) >= 2) {
            label <- cells[[1]] %>% html_text2() %>% str_squish() %>% tolower()
            value <- cells[[2]] %>% html_text2() %>% str_squish()

            if (str_detect(label, "regulation number"))
              metadata$regulation_number <- value
            if (str_detect(label, "regulation name"))
              metadata$regulation_name <- value
            if (str_detect(label, "product code") && str_detect(label, "description|name"))
              metadata$product_code_desc <- value
            if (str_detect(label, "decision"))
              metadata$decision <- value
            if (str_detect(label, "applicant"))
              metadata$applicant <- value
            if (str_detect(label, "advisory committee|review panel"))
              metadata$review_advise_comm <- value
          }
        }
      }

      return(as_tibble(metadata))

    }, error = function(e) {
      warning(sprintf("Error on attempt %d for %s: %s", attempt, submission_number, e$message))
      Sys.sleep(REQUEST_DELAY * attempt)
    })
  }

  # All retries exhausted
  warning(sprintf("All %d attempts failed for %s", MAX_RETRIES, submission_number))
  return(tibble(
    regulation_number  = NA_character_,
    regulation_name    = NA_character_,
    product_code_desc  = NA_character_,
    decision           = NA_character_,
    applicant          = NA_character_,
    review_advise_comm = NA_character_
  ))
}

# --- Main ------------------------------------------------------------------
main <- function() {
  message("Loading input CSV: ", INPUT_CSV)
  devices <- read_csv(INPUT_CSV, show_col_types = FALSE)

  message(sprintf("Found %d devices. Starting scrape...\n", nrow(devices)))

  # Iterate through each submission number and scrape
  scraped <- devices$`Submission Number` %>%
    imap_dfr(function(sub_num, idx) {
      message(sprintf("[%d/%d] Processing: %s", idx, nrow(devices), sub_num))
      result <- scrape_submission(sub_num)

      # Polite delay between requests
      Sys.sleep(REQUEST_DELAY)

      # Bind the submission number for the join
      result$submission_number_key <- sub_num
      return(result)
    })

  # Join scraped metadata back to original dataset
  enriched <- devices %>%
    left_join(scraped, by = c("Submission Number" = "submission_number_key"))

  # Export enriched CSV
  message(sprintf("\nWriting enriched CSV to: %s", OUTPUT_CSV))
  write_csv(enriched, OUTPUT_CSV)

  # Summary
  filled <- enriched %>%
    summarise(
      has_reg_number = sum(!is.na(regulation_number)),
      has_reg_name   = sum(!is.na(regulation_name)),
      has_pc_desc    = sum(!is.na(product_code_desc)),
      has_decision   = sum(!is.na(decision))
    )

  message("\n--- Scraping Summary ---")
  message(sprintf("Total devices:             %d", nrow(enriched)))
  message(sprintf("With Regulation Number:    %d", filled$has_reg_number))
  message(sprintf("With Regulation Name:      %d", filled$has_reg_name))
  message(sprintf("With Product Code Desc:    %d", filled$has_pc_desc))
  message(sprintf("With Decision:             %d", filled$has_decision))
  message(sprintf("Output:                    %s", OUTPUT_CSV))
  message("Done.")
}

main()
