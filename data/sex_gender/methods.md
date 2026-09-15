# Sex and gender: methods

Parser rules version `parsers.R@2026-08-17 / outcomes@2026-09-10 / units@2026-09-14` (module 1.1.0); snapshot 2026-09-15; generated 2026-09-15T00:24:54.491255+00:00.

## Where the sex and gender numbers come from

Every count on the Sex and Gender tabs is produced by the deterministic parser from our sex and gender manuscript, applied to each trial's baseline-characteristics tables on ClinicalTrials.gov (API v2). A baseline measure is a candidate sex or gender table if, and only if, its title contains "sex" or "gender". Labels are mapped to five buckets (Female, Male, Explicit Unknown, Gender diverse, Cis/trans-qualified) by an ordered vocabulary; nothing is inferred from enrollment.

## The five reporting states

Every trial with posted results is in exactly one state. Reported: at least one Female, Male, gender diverse or cis/trans-qualified count above zero. Explicit Unknown only: the sponsor posted a sex or gender table whose only non-zero category is Unknown (or a synonym such as Not reported, Missing, Prefer not to answer). Uninformative: a sex or gender table was posted but carries no usable count (an empty template, every value NA, every value zero, or no recognizable label); the reason and any free-text "not collected" note are shown as sub-labels. Not Reported (Missing): the trial has no sex- or gender-titled baseline table at all. Parse error: the record could not be read; these trials are counted on the audit page and nowhere else. These states are never merged, and "Not Reported (Missing)" is never computed from enrollment arithmetic.

## How many trials have no sex or gender table

On the 2026-09-15 pull, 0 studies with posted results carried no sex- or gender-titled baseline measure. This is a measured property of that pull, re-measured every week, not a rule of the registry.

## What counts as reporting gender

A trial reports gender only if it posted a gender-diverse category (for example Non-binary, Genderqueer, Transgender, Two-Spirit, Intersex) or a cis/trans-qualified category (for example Transgender Female, Cisgender Man) with a non-zero count. A table titled "Gender" that carries only Female and Male, or only Woman and Man, is sex data under a gender label: it is counted as reported sex, and flagged as gender-labeled binary only. Cis/trans-qualified categories are never added to Female or Male; they are shown as their own bucket with the source labels on drill-down.

## Why a bare "Other" counts as gender diverse

A category labelled simply "Other" in a sex or gender table is counted toward the gender-diverse bucket, because in these tables it is the sponsor's catch-all for identities outside Female and Male and the manuscript's vocabulary accepted it as such; it is the single largest source of gender reporting, and the source labels are listed on drill-down so a reader can see how much of the bucket it is.

## Which tables enter the composition and percent-female figures

Reporting status counts every sex or gender table, but participant composition and percent female use only tables that count participants: a table whose values are counts of units (tests, eyes, fractures), means, medians or percentages is kept in the reporting counts and excluded from composition (is_participant_count is false).

## How percent female is calculated

Two series are shown, over the same trials: those that report sex with a participant-count table and have at least one Female or Male participant. The primary series is the average across trials of each trial's own female share, female / (female + male); the secondary series is participant-weighted, the sum of female participants over the sum of female plus male participants. Gender-diverse and cis/trans-qualified participants are excluded from both denominators, and explicitly Unknown participants are never counted as missing.

## Why the Explicit Unknown tile is smaller than the old Unknown tile

The Explicit Unknown tile holds only participants the sponsor placed in an Unknown category. The retired pipeline added the gap between registered enrollment and the sum of the posted table to the same tile ("denominator balancing"). That gap is now stored separately as enrollment minus parsed, is shown nowhere as unknown, and never affects a trial's reporting state. In the last snapshot published under the retired rule, 87.7% of the participants in the Unknown tile were that inferred remainder, so the tile shrinks by about that share at cutover.

## Trials that say sex was not collected

A few trials post a sex table with no participants and a note that sex was not collected. They are filed as Uninformative with the declared-not-collected sub-label. In the manuscript's 2026-06-09 extract three such trials (NCT06668909, NCT07280208, NCT05591014) were filed as Not Reported by a manual step the dashboard does not replicate.

## How closely the parser matches the manuscript's manual review

On the manuscript's 2026-06-09 extract of 66,210 trials with a sex- or gender-titled table, the parser's reporting state agreed with the manually corrected ground truth for 66,177 trials (99.95%). Treat that as the ceiling of a deterministic parser; the 33 disagreements are listed with the parser bundle.

## Why the trend charts start a new series

Snapshots published before the parser cutover were produced by the retired rule, and the stored records from those weeks do not hold the raw tables, so they cannot be re-parsed. The Sex and Gender trend charts therefore start a new series at the first pull under the parser; earlier points are labelled as produced by the retired rule and the two series are not spliced. From the cutover on, the selected raw tables are retained with every weekly backup so any future rule change can be re-applied to every snapshot.

## Race and ethnicity still use the earlier rule

The Race and Ethnicity tabs keep the earlier pipeline, including denominator balancing, in this release; their quality charts therefore still derive the missing layer from enrollment. The same three-state separation is scheduled for those dimensions separately.

## Version

Parser rules version: parsers.R@2026-08-17 / outcomes@2026-09-10 / units@2026-09-14. Parser module version: 1.1.0. Current snapshot reporting states: reported 79,270, explicit_unknown_only 66, uninformative 720, not_reported 0, parse_error 0.

