"""Fill slides 1 and 2 of the Anthropic Healthcare deck.

    python3 slides/fill_user_deck.py <source.pptx> [-o out.pptx]

Those two slides ship as title-only placeholders. This adds their content on the
same grid the rest of the deck uses (measured off slide 6):

    title      18pt bold      y=0.29     margins x=0.35 .. 9.65
    subtitle   10.5pt         y=0.69
    col header 11pt           y=1.02     hairline rule beneath at y=1.32
    body       8.5pt / 9pt
    footnote   7pt            y=5.26
    columns    split at x=5.90 with a vertical hairline

Every figure is sourced in a comment beside it. Canvas is 10 x 5.625in.
"""
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

IMG = Path(__file__).parent / "img"

FONT = "Century Schoolbook"
INK = RGBColor(0x11, 0x18, 0x27)
MUTED = RGBColor(0x6D, 0x6C, 0x66)
GREEN = RGBColor(0x15, 0x80, 0x3D)
TERRA = RGBColor(0xB4, 0x48, 0x3D)
RULE = RGBColor(0xD9, 0xD8, 0xD3)


def textbox(slide, x, y, w, h, runs, *, size=8.5, color=INK, bold=False,
            italic=False, space_after=0, line_spacing=None, align=None):
    """Add a text box. `runs` is a string or a list of (text, overrides) pairs;
    a run of "\n" starts a new paragraph."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    if isinstance(runs, str):
        runs = [(runs, {})]

    para = tf.paragraphs[0]
    if align:
        para.alignment = align
    if line_spacing:
        para.line_spacing = line_spacing
    for text, over in runs:
        if text == "\n":
            para = tf.add_paragraph()
            if align:
                para.alignment = align
            if line_spacing:
                para.line_spacing = line_spacing
            para.space_before = Pt(space_after)
            continue
        run = para.add_run()
        run.text = text
        f = run.font
        f.name = FONT
        f.size = Pt(over.get("size", size))
        f.bold = over.get("bold", bold)
        f.italic = over.get("italic", italic)
        f.color.rgb = over.get("color", color)
    return box


def hairline(slide, x, y, w, color=RULE, weight=0.9):
    """Thin horizontal rule — the divider idiom used on slide 6."""
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                 Inches(w), Pt(weight))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def vrule(slide, x, y, h, color=RULE, weight=0.9):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                 Pt(weight), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def restyle_title(slide, text):
    """Normalise the placeholder title onto the slide-6 grid."""
    box = slide.shapes[0]
    box.left, box.top = Inches(0.35), Inches(0.29)
    box.width, box.height = Inches(9.30), Inches(0.42)
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_top = 0
    para = tf.paragraphs[0]
    for run in list(para.runs)[1:]:
        run._r.getparent().remove(run._r)
    run = para.runs[0] if para.runs else para.add_run()
    run.text = text
    run.font.name, run.font.size, run.font.bold = FONT, Pt(18), True
    run.font.color.rgb = INK


# --------------------------------------------------------------------------- #
# Slide 1 — what the clinical-trial work established, and the pivot to AI
# --------------------------------------------------------------------------- #
def build_slide1(slide):
    restyle_title(slide, "Conclusions from Civic Sample Project so Far")
    textbox(slide, 0.35, 0.69, 9.30, 0.28, [
        ("Four demographic dimensions across ", {}),
        ("79,297 trials with posted results", {"bold": True}),
        (" — and the same questions now aimed at FDA-authorized medical AI.", {}),
    ], size=10.5, color=MUTED, italic=True)

    # ---- Band A: the four dashboard dimensions ----------------------------- #
    textbox(slide, 0.35, 1.00, 6.0, 0.26,
            "What we built for clinical trials, 2009–2026", size=11, color=INK)
    hairline(slide, 0.35, 1.32, 9.30)

    # Source: data/dashboard-summary.json (2026-07-26 snapshot), all study types.
    # Widths preserve each capture's native aspect ratio at a common height.
    dims = [
        ("crop-race.png",      682 / 682,   "RACE",      "57.0%", "of trials report it. White is 64.2% of participants with known race — the dominant slice."),
        ("crop-ethnicity.png", 806 / 806, "ETHNICITY", "39.1%", "of trials report it. The largest slice is “unknown”: 52.4% of all participants."),
        ("crop-sex.png",       916 / 916, "SEX",       "97.3%", "of trials report it — the one dimension that is near-complete. Female 51.5%."),
        ("crop-geography.png", 1850 / 1150, "GEOGRAPHY", "37.3%", "of trial sites sit in the South. CA, TX, FL and NY dominate the map."),
    ]
    img_h = 1.58
    widths = [img_h * r for _, r, _, _, _ in dims]
    gap = (9.30 - sum(widths)) / (len(dims) - 1)

    x = 0.35
    for (fname, _, label, stat, desc), w in zip(dims, widths):
        slide.shapes.add_picture(str(IMG / fname), Inches(x), Inches(1.42),
                                 width=Inches(w), height=Inches(img_h))
        cap_w = max(w, 1.85)
        textbox(slide, x, 3.06, cap_w, 0.15, label, size=7, color=MUTED, bold=True)
        textbox(slide, x, 3.20, cap_w, 0.34, [
            (stat, {"size": 10, "bold": True, "color": GREEN}),
            (" " + desc.replace("\n", " "), {"size": 7, "color": MUTED}),
        ], line_spacing=0.92)
        x += w + gap

    # ---- Band B: the pivot to medical AI ----------------------------------- #
    hairline(slide, 0.35, 3.62, 9.30)
    textbox(slide, 0.35, 3.70, 6.0, 0.26,
            "The same four questions, now for medical AI", size=11, color=INK)

    # Source: ai-ml-enabled-devices-csv_20260305.csv (FDA list, 2026-03-05).
    slide.shapes.add_picture(str(IMG / "crop-ai-devices.png"), Inches(0.35),
                             Inches(4.06), width=Inches(4.55), height=Inches(0.87))
    textbox(slide, 0.35, 4.99, 4.55, 0.16,
            "FDA AI/ML-Enabled Device List · 1,451 authorizations to 2026-03-05",
            size=7, color=MUTED)

    vrule(slide, 5.20, 4.02, 1.05)

    textbox(slide, 5.42, 4.02, 4.23, 1.15, [
        ("96.2% arrive by the 510(k) predicate route", {"size": 9, "bold": True, "color": TERRA}),
        (" — substantial equivalence to a device already marketed, with no new "
         "clinical evidence required. Only 18 of 1,451 went through full PMA review.", {}),
        ("\n", {}),
        ("The FDA publishes no demographics for these validation cohorts.", {"size": 9, "bold": True}),
        (" So Claude reads each device’s public 510(k)/De Novo/PMA summary and its "
         "open-access manuscripts, quoting the evidence before committing a value.", {}),
    ], size=8, color=INK, space_after=4, line_spacing=0.95)

    textbox(slide, 0.35, 5.26, 9.30, 0.22,
            "Dashboard: civicsample.com · trial figures from data/dashboard-summary.json "
            "(2026-07-26 snapshot, all study types) · device figures from the FDA "
            "AI/ML-Enabled Device List",
            size=7, color=MUTED)


# --------------------------------------------------------------------------- #
# Slide 2 — token usage against the award, and the open questions
# --------------------------------------------------------------------------- #
def build_slide2(slide):
    restyle_title(slide, "What we did with tokens, and where feedback would be most useful")
    textbox(slide, 0.35, 0.69, 9.30, 0.28, [
        ("$11.11", {"bold": True}),
        (" of the ", {}),
        ("$38,133", {"bold": True}),
        (" award spent so far — the pilot was about proving the extraction before "
         "scaling it, not about volume.", {}),
    ], size=10.5, color=MUTED, italic=True)

    # ---- Left column: what the pilot actually cost -------------------------- #
    textbox(slide, 0.35, 1.00, 5.35, 0.26, "What the pilot cost", size=11, color=INK)
    hairline(slide, 0.35, 1.32, 5.35)

    # Source: data/{fda,lit,trials_lit}_token_metrics.json
    stats = [("2.63M", "tokens", "2.41M in · 220K out"),
             ("36", "documents", "373 PDF pages"),
             ("3×", "models each", "Haiku · Sonnet · Opus"),
             ("0.03%", "of award used", "$11.11 of $38,133")]
    for i, (big, lab, sub) in enumerate(stats):
        x = 0.35 + i * 1.35
        textbox(slide, x, 1.42, 1.30, 0.24, big, size=13, bold=True, color=GREEN)
        textbox(slide, x, 1.66, 1.30, 0.14, lab, size=8, bold=True, color=INK)
        textbox(slide, x, 1.80, 1.30, 0.14, sub, size=6.5, color=MUTED)

    textbox(slide, 0.35, 2.06, 5.35, 0.20,
            "Per-model comparison from the FDA pilot, as shown on the dashboard",
            size=8, color=MUTED, italic=True)
    slide.shapes.add_picture(str(IMG / "crop-models.png"), Inches(0.35), Inches(2.28),
                             width=Inches(5.35), height=Inches(1.39))

    textbox(slide, 0.35, 3.78, 5.35, 1.35, [
        ("Scaling from here.", {"bold": True}),
        (" The proposal budgets ~2.9B tokens for 1,200 devices and 75,000 "
         "manuscripts, and the $38,133 assumes all three models over the whole "
         "corpus. A single model is $2.8K–$8.6K of that.", {}),
        ("\n", {}),
        ("One correction before this is presented.", {"bold": True, "color": TERRA}),
        (" The dashboard still prices Opus 4.7 at $15/$75 per 1M — the current "
         "rate is $5/$25, so the projections above read ~3× high. The proposal’s "
         "own budget uses the correct rate; only the dashboard display is stale.",
         {"color": TERRA}),
    ], size=8, color=INK, space_after=4, line_spacing=0.95)

    # ---- Right column: the questions ---------------------------------------- #
    vrule(slide, 5.90, 1.38, 3.75)
    textbox(slide, 6.05, 1.00, 3.60, 0.26,
            "Where feedback would help most", size=11, color=INK)
    hairline(slide, 6.05, 1.32, 3.60)

    asks = [
        ("All three models, or one?",
         "We run every document through Haiku, Sonnet and Opus and treat agreement as "
         "the reliability signal. That is most of the award. Would one model plus an "
         "adversarial verification pass buy more confidence per dollar?"),
        ("Prompt caching may not reach us.",
         "Our reusable prefix — system prompt plus tool schema — is only ~1,400 "
         "tokens. That clears Sonnet 4.6’s 1,024-token minimum but falls under Opus "
         "4.7 (2,048) and Haiku 4.5 (4,096). Is it worth restructuring to cross it?"),
        ("Batch API on offline runs.",
         "Nothing here is latency-sensitive — GitHub Actions runs the pipeline "
         "nightly. That looks like 50% of the award left on the table."),
        ("Haiku leaked tool-call markup into 4 extracted values.",
         "Sonnet and Opus: zero. We are targeting >95% precision and recall — is our "
         "paired evidence/value schema too deep for Haiku, or is this a prompt fix?"),
    ]
    y = 1.44
    for i, (q, sub) in enumerate(asks, 1):
        textbox(slide, 6.05, y, 0.18, 0.14, str(i), size=8.5, bold=True, color=TERRA)
        textbox(slide, 6.26, y, 3.39, 0.15, q, size=8.5, bold=True, color=INK)
        textbox(slide, 6.26, y + 0.16, 3.39, 0.62, sub, size=7, color=MUTED,
                line_spacing=0.95)
        y += 1.00

    textbox(slide, 0.35, 5.26, 9.30, 0.22,
            "Token counts from data/fda_token_metrics.json, lit_token_metrics.json and "
            "trials_lit_token_metrics.json · rates per Anthropic list pricing "
            "· cache minimums per Anthropic prompt-caching docs",
            size=7, color=MUTED)


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("-o") + 1]) if "-o" in sys.argv \
        else src.with_name("Presentation_for_Anthropic_Healthcare_filled.pptx")
    prs = Presentation(str(src))
    build_slide1(prs.slides[0])
    build_slide2(prs.slides[1])
    prs.save(str(out))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
