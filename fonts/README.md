# DM Sans Figures

`dm-sans-figures-v17-{400,500,600,700}.woff2` hold DM Sans's ten digits, 0–9,
each set on one shared advance width per weight, so numbers line up in columns.
`styles.css` loads them as `'DM Sans Figures'` with `unicode-range: U+0030-0039`
and lists that family ahead of `'DM Sans'` in `--font-sans`; every character
that is not a digit still comes from DM Sans.

## Why

DM Sans has no tabular figures. The file Google Fonts serves (v17, latin
subset) and the upstream release (4.004, `google/fonts` `ofl/dmsans`) both lack
the `tnum` feature, so `font-variant-numeric: tabular-nums` does nothing with
them: a `1` is 312 units wide and a `0` 684. Before the site moved to DM Sans
throughout, its count and percent cells were set in DM Mono, which is
fixed-width.

## What was changed

Only spacing. For each weight the site loads, the digits keep their DM Sans
outlines; each outline is centred in one advance equal to the widest digit
outline plus 30 units on each side (the font's own tightest digit side bearing
is about 28 units). Advances (units per em 1000): 400 → 648, 500 → 656,
600 → 665, 700 → 672. Kerning and other layout tables are dropped; the files
carry only `.notdef` and the digits.

## Source

- `https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2`
  (the latin file `https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap`
  returned on 2026-11-20; variable, `wght` 100–1000),
  sha256 `9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543`.
- Built with fontTools 4.68.0 on Python 3.13. Output sha256:
  - 400 `228644ee351774465622da4a64461ae0a1a20069143922e7ba9a2e2a24593470`
  - 500 `104a52bc8dfa73a59e13243d0109490445ccde63e1b50a5a70947b0800fbe2de`
  - 600 `eb2d688570a63d5e79aa877727a2f6682d576f7c4f517ff1841291d7388d3d1b`
  - 700 `c803150fe2e447eacd0dd0240f3653339e1d4ef173d67c20d993e3c325fd2a2c`

The site repository holds no Python beyond the one exception `AGENTS.md`
names, so the build is recorded here rather than committed as a script. To
rebuild, save the following outside this repository and run
`python3 build_figures.py SOURCE.woff2 fonts`:

```python
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Subsetter, Options

SRC, OUT = sys.argv[1], sys.argv[2]
DIGITS = [ord(c) for c in '0123456789']
SIDE = 30
for weight in (400, 500, 600, 700):
    font = instancer.instantiateVariableFont(TTFont(SRC), {'wght': weight}, updateFontNames=False)
    opts = Options()
    opts.layout_features = []
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    sub = Subsetter(opts)
    sub.populate(unicodes=DIGITS)
    sub.subset(font)
    for t in ('GSUB', 'GPOS', 'GDEF', 'kern'):
        if t in font:
            del font[t]
    cmap, glyf, hmtx = font.getBestCmap(), font['glyf'], font['hmtx']
    names = [cmap[u] for u in DIGITS]
    for n in names:
        glyf[n].recalcBounds(glyf)
    target = max(glyf[n].xMax - glyf[n].xMin for n in names) + 2 * SIDE
    for n in names:
        g = glyf[n]
        assert not g.isComposite(), n
        dx = round((target - (g.xMax - g.xMin)) / 2) - g.xMin
        g.coordinates.translate((dx, 0))
        g.recalcBounds(glyf)
        hmtx[n] = (target, g.xMin)
    font['hhea'].advanceWidthMax = max(a for a, _ in hmtx.metrics.values())
    font['OS/2'].xAvgCharWidth = target
    name = font['name']
    for nid, text in ((1, 'DM Sans Figures'), (2, 'Regular'), (4, f'DM Sans Figures {weight}'),
                      (6, f'DMSansFigures-{weight}'), (16, 'DM Sans Figures'), (17, str(weight)),
                      (3, f'DMSansFigures-{weight};tabular digits derived from DM Sans 4.004')):
        name.removeNames(nameID=nid)
        name.setName(text, nid, 3, 1, 0x409)
    font.flavor = 'woff2'
    out = f'{OUT}/dm-sans-figures-v17-{weight}.woff2'
    font.save(out)
    check = TTFont(out)
    advs = {check['hmtx'][check.getBestCmap()[u]][0] for u in DIGITS}
    assert len(advs) == 1 and sorted(check.getBestCmap()) == DIGITS, (out, advs)
    print(out, 'advance', target)
```

`tests/typography_figures.test.mjs` reads the shipped files and fails unless
each maps exactly the ten digits on one advance.

## Licence

DM Sans is © 2014 The DM Sans Project Authors, under the SIL Open Font
License 1.1 (`OFL.txt`, copied from `google/fonts` `ofl/dmsans`). The licence
declares no Reserved Font Name; these files are a modified version distributed
under the same licence, renamed `DM Sans Figures`.
