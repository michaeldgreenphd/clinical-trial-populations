# Typography comparisons

Matching Chromium screenshots of the public dashboard, using the same published
data and default controls at desktop (1440 × 1000) and phone (390 × 1000) sizes.
Each image shows the first viewport; longer pages continue below it. Study details
shows the first study's open detail panel. The device evidence and trial outcomes
images show their respective secondary panes. Industry retains its public beta
curtain; these captures show the pane after opening it.

- Before: `999dc31a42e7ff878ee58ad5c19318d959797107`
- After: `bd8b6b2968ae8e2e44fc04520dea743e719adbe1`
- Captured locally on 2026-11-20. The custom domain was unavailable through the
  environment's network policy, so both revisions were served locally with the
  repository's published data and actual CDN fonts and chart libraries.
- The phone's summary-loading path was exercised in a fresh browser context,
  rather than by resizing a desktop session.

| Page | Desktop before | Desktop after | Phone before | Phone after |
| --- | --- | --- | --- | --- |
| Overview | [Before](before-overview-1440.jpg) | [After](after-overview-1440.jpg) | [Before](before-overview-390.jpg) | [After](after-overview-390.jpg) |
| Race | [Before](before-race-1440.jpg) | [After](after-race-1440.jpg) | [Before](before-race-390.jpg) | [After](after-race-390.jpg) |
| Ethnicity | [Before](before-ethnicity-1440.jpg) | [After](after-ethnicity-1440.jpg) | [Before](before-ethnicity-390.jpg) | [After](after-ethnicity-390.jpg) |
| Sex | [Before](before-sex-1440.jpg) | [After](after-sex-1440.jpg) | [Before](before-sex-390.jpg) | [After](after-sex-390.jpg) |
| Gender | [Before](before-gender-1440.jpg) | [After](after-gender-1440.jpg) | [Before](before-gender-390.jpg) | [After](after-gender-390.jpg) |
| Studies | [Before](before-studies-1440.jpg) | [After](after-studies-1440.jpg) | [Before](before-studies-390.jpg) | [After](after-studies-390.jpg) |
| Study details | [Before](before-study-detail-1440.jpg) | [After](after-study-detail-1440.jpg) | [Before](before-study-detail-390.jpg) | [After](after-study-detail-390.jpg) |
| Geography | [Before](before-geography-1440.jpg) | [After](after-geography-1440.jpg) | [Before](before-geography-390.jpg) | [After](after-geography-390.jpg) |
| FDA Oversight | [Before](before-fda-oversight-1440.jpg) | [After](after-fda-oversight-1440.jpg) | [Before](before-fda-oversight-390.jpg) | [After](after-fda-oversight-390.jpg) |
| AI Devices | [Before](before-ai-devices-1440.jpg) | [After](after-ai-devices-1440.jpg) | [Before](before-ai-devices-390.jpg) | [After](after-ai-devices-390.jpg) |
| Device evidence | [Before](before-device-links-1440.jpg) | [After](after-device-links-1440.jpg) | [Before](before-device-links-390.jpg) | [After](after-device-links-390.jpg) |
| Industry Sponsors | [Before](before-industry-1440.jpg) | [After](after-industry-1440.jpg) | [Before](before-industry-390.jpg) | [After](after-industry-390.jpg) |
| Trial outcomes | [Before](before-outcomes-1440.jpg) | [After](after-outcomes-1440.jpg) | [Before](before-outcomes-390.jpg) | [After](after-outcomes-390.jpg) |
| About | [Before](before-about-1440.jpg) | [After](after-about-1440.jpg) | [Before](before-about-390.jpg) | [After](after-about-390.jpg) |
| FAQ | [Before](before-faq-1440.jpg) | [After](after-faq-1440.jpg) | [Before](before-faq-390.jpg) | [After](after-faq-390.jpg) |

The [overview images one directory up](../) include the full page. The typography
change uses one DM Sans family, a shared rem-based scale, 16px body copy and 14px
supporting text. Chart annotations use their own canvas sizing, with 12px reserved
for source notes. The after captures showed no page-level horizontal overflow or
browser runtime errors across these 30 views.
