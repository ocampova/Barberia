import sys, re, math, vtracer
from PIL import Image, ImageFilter, ImageDraw
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

SRC, OUT, FONTS = sys.argv[1], sys.argv[2], sys.argv[3]
K = 32
img = Image.open(SRC).convert("L")

# ---------------- símbolos vectorizados ----------------
def trace(name, box, mask=None, thr=110, blur=7, speckle=60):
    c = img.crop(box)
    c = c.resize((c.width * K, c.height * K), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))
    b = c.point(lambda v: 0 if v > thr else 255).convert("L")
    if mask: mask(ImageDraw.Draw(b), b.size)
    b.convert("RGB").save(f"{OUT}/{name}.png")
    vtracer.convert_image_to_svg_py(f"{OUT}/{name}.png", f"{OUT}/{name}.svg", colormode="binary",
        mode="spline", filter_speckle=speckle * K // 16, corner_threshold=80, length_threshold=12, splice_threshold=50, path_precision=2)
    svg = open(f"{OUT}/{name}.svg").read()
    parts = []
    for d, tf in re.findall(r'<path d="([^"]+)"[^>]*?transform="translate\(([^)]+)\)"', svg):
        tx, ty = map(float, tf.split(","))
        parts.append(f'<path d="{d}" transform="translate({box[0] + tx / K:.4f},{box[1] + ty / K:.4f}) scale({1 / K})"/>')
    return "\n".join(parts)

def mask_scissors(d, size):
    f = K / 16
    d.rectangle((357 * f, 0, size[0], size[1]), fill=255)       # desde aquí empieza la "g" (texto aparte)
    d.rectangle((300 * f, 496 * f, size[0], size[1]), fill=255) # cola de la "g"

def mask_seimar(d, size):
    # Conserva solo el interior del óvalo: el contorno se dibuja aparte, exacto.
    W, H = size
    m = Image.new("L", size, 255)
    f = K / 16
    ImageDraw.Draw(m).ellipse(((264 - 165) * f, (345 - 240) * f, (264 + 165) * f, (345 + 240) * f), fill=0)
    d.bitmap((0, 0), m, fill=255)

scissors = trace("tijeras", (68, 22, 92, 57), mask_scissors, thr=165, blur=12, speckle=12)
symbol = trace("seimar-simbolo", (186, 19, 216, 61), mask_seimar, blur=15)

# ---------------- textos con Montserrat ----------------
fonts = {w: TTFont(f"{FONTS}/montserrat-latin-{w}-normal.woff") for w in (500, 600, 700)}

def text_path(txt, weight, x0, x1, baseline, ref_h, ref="cap"):
    f = fonts[weight]; gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    names = [cmap[ord(ch)] for ch in txt]
    def bounds(n):
        bp = BoundsPen(gs); gs[n].draw(bp); return bp.bounds
    if ref == "cap": metric = bounds(cmap[ord("H")])[3]
    elif ref == "x": metric = bounds(cmap[ord("x")])[3]
    else: metric = bounds(cmap[ord("l")])[3]
    s = ref_h / metric
    # ancho natural (de la tinta del primer glifo a la del último)
    adv = [gs[n].width for n in names]
    first = bounds(names[0]); last = bounds(names[-1])
    natural = (sum(adv[:-1]) + (last[2] if last else adv[-1]) - (first[0] if first else 0)) * s
    track = (x1 - x0 - natural) / max(len(names) - 1, 1)
    x = x0 - (first[0] if first else 0) * s
    out = []
    for n, a in zip(names, adv):
        if n != "space":
            pen = SVGPathPen(gs)
            gs[n].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
            out.append(pen.getCommands())
        x += a * s + track
    return f'<path d="{" ".join(out)}"/>', s * upm

parts_v = {}
parts_v["ictor"], fs1 = text_path("ictor", 700, 92.2, 118.9, 42.6, 10.2, "asc")
parts_v["guilar"], _ = text_path("guilar", 700, 90.3, 119.8, 52.6, 8.6, "asc")
parts_v["barberia"], _ = text_path("BARBERÍA", 700, 72.2, 117.6, 67.4, 5.3)
parts_v["since"], _ = text_path("SINCE 2016", 700, 78.1, 111.8, 77.9, 3.9)
seimar_t, _ = text_path("SEIMAR", 500, 170.2, 233.8, 73.6, 7.3)
salon_t, _ = text_path("SALÓN", 500, 189.3, 215.6, 80.9, 2.9)

WHITE, GRAY, LINE = "#ffffff", "#b4b4b4", "#9a9a9a"

victor_inner = f'''<circle cx="95.45" cy="50.45" r="40.75" fill="none" stroke="#bdbdbd" stroke-width="0.85"/>
<g fill="{WHITE}">{scissors}
{parts_v["ictor"]}
{parts_v["guilar"]}
{parts_v["since"]}</g>
<g fill="{GRAY}">{parts_v["barberia"]}</g>
<g stroke="{LINE}" stroke-width="0.55"><line x1="72.2" y1="58.1" x2="119.6" y2="58.1"/><line x1="72.2" y1="69.9" x2="119.3" y2="69.9"/></g>'''

seimar_inner = f'''<rect x="190.8" y="21.8" width="22.5" height="37.3" rx="11.25" fill="none" stroke="#c4c4c4" stroke-width="0.8"/>
<g fill="{WHITE}">{symbol}
{seimar_t}
{salon_t}</g>
<g stroke="#8a8a8a" stroke-width="0.5"><line x1="177.8" y1="79.6" x2="185" y2="79.6"/><line x1="219.8" y1="79.6" x2="227" y2="79.6"/></g>'''

def svg(viewbox, inner, title, bg=None):
    x, y, w, h = viewbox
    rect = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{rect}{inner}</svg>\n')

V = (52.5, 7.5, 86, 86)
SM = (166, 17, 72, 68)
open(f"{OUT}/victor-aguilar.svg", "w").write(svg(V, victor_inner, "Víctor Aguilar Barbería"))
open(f"{OUT}/seimar-salon.svg", "w").write(svg(SM, seimar_inner, "Seimar Salón"))
open(f"{OUT}/logos.svg", "w").write(svg((0, 0, 300, 100), victor_inner + seimar_inner, "Víctor Aguilar Barbería · Seimar Salón", bg="#000"))
open(f"{OUT}/logos-transparente.svg", "w").write(svg((40, 5, 205, 90), victor_inner + seimar_inner, "Víctor Aguilar Barbería · Seimar Salón"))
print("ok")
