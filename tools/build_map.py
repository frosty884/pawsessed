"""Builds the party map: a flat, night-themed redraw of the official Chula Vista resort map, written into
the <svg id="map"> in index.html.

    python tools/build_map.py [official-map.jpg]

1. Traces roads and parking lots, water, sand traps and tree cover from the official map by colour
   (at 2x), cleans and smooths them, and turns them into SVG paths.
2. Draws the walking route (placed by hand along the traced roads) as a smooth curve.
3. Adds flat building footprints, labels, step markers, the party callout and the animated touches.

Everything is in "map units": the hotel-to-villas crop of the official map scaled to 1000 x 1040.
A debug overlay of the trace and route is written to tools/trace_preview/build_debug.png.
"""
import math
import os
import random
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
DEFAULT_SRC = r'C:/Users/brand/.claude/uploads/1535a162-b018-4713-95ca-c80047de66e6/d9264231-image.jpg'
SRC = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
DEBUG = os.path.join(HERE, 'trace_preview')
os.makedirs(DEBUG, exist_ok=True)

CROP = (1300, 100, 3300, 2180)  # official-map pixels covered by the map space
MW, MH = 1000, 1040
S = 2  # trace resolution (pixels per map unit)
VB = (280, 20, 720, 1000)  # visible window: x, y, w, h
VX0, VY0, VW, VH = VB
VX1, VY1 = VX0 + VW, VY0 + VH

# ---------------------------------------------------------------------------------------------- layout
HOTEL = [
    [(212, 92), (352, 124), (352, 236), (212, 222)],   # guest rooms 4422-4101
    [(352, 112), (468, 96), (472, 262), (352, 262)],   # Kaminski's, Upper Dells ballroom, meeting rooms
    [(468, 96), (612, 128), (614, 296), (472, 262)],   # conference center (K&G grill on its front)
    [(622, 44), (792, 34), (796, 186), (626, 196)],    # guest rooms 3001-3621
]
CANOPY = [(384, 260), (450, 260), (450, 304), (384, 304)]  # entrance canopy
VILLA_A = dict(c=(841, 532), L=228, W=70, ang=38.2)  # golf villas, rooms 7101-7310
VILLA_D = dict(c=(846, 876), L=224, W=70, ang=39.7)  # golf villa D, rooms 7115-7431 (the party)
CHAPEL = (846, 950)
START = (408, 300)  # hotel entrance, under the canopy
GOLF_SEED = (520, 650)


def villa_poly(v):
    (cx, cy), L, W, a = v['c'], v['L'], v['W'], math.radians(v['ang'])
    u = (math.cos(a), math.sin(a))
    n = (-math.sin(a), math.cos(a))
    pts = []
    for su, sn in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        pts.append((cx + su * u[0] * L / 2 + sn * n[0] * W / 2, cy + su * u[1] * L / 2 + sn * n[1] * W / 2))
    return pts


def villa_door(v, out=6):
    (cx, cy), W, a = v['c'], v['W'], math.radians(v['ang'])
    return (cx + math.sin(a) * (W / 2 + out), cy - math.cos(a) * (W / 2 + out))  # the north-east (parking) side


END = villa_door(VILLA_D)

# ---------------------------------------------------------------------------------------------- trace
img = cv2.imread(SRC)
if img is None:
    raise SystemExit(f'cannot read {SRC}')
x0, y0, x1, y1 = CROP
crop = img[y0:y1, x0:x1]
big = cv2.resize(crop, (MW * S, MH * S), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(DEBUG, 'source.png'), cv2.resize(big, (MW, MH), interpolation=cv2.INTER_AREA))
hsv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV).astype(np.int32)
hh, ss, vv = hsv[..., 0] * 2, hsv[..., 1] / 255.0, hsv[..., 2] / 255.0
b, g, r = [big[..., i].astype(np.int32) for i in range(3)]
yy, xx = np.mgrid[0:MH * S, 0:MW * S]
legend = (xx < 700 * S) & (yy > 728 * S)  # the official map's legend box


def ell(k):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def close(m, k):
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ell(k)).astype(bool)


def open_(m, k):
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, ell(k)).astype(bool)


def keep_big(m, area):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= area
    return keep[lab]


def fill_holes(m, area):
    n, lab, st, _ = cv2.connectedComponentsWithStats((~m).astype(np.uint8), 4)
    small = np.zeros(n, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] < area
    return m | small[lab]


def smooth(m, sigma):
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma) > 0.5


def poly_mask(polys, scale, shape):
    m = np.zeros(shape, np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.round(np.array(p) * scale).astype(np.int32)], 1)
    return m.astype(bool)


bldg_polys = HOTEL + [CANOPY, villa_poly(VILLA_A), villa_poly(VILLA_D)]
bldg2 = poly_mask(bldg_polys, S, (MH * S, MW * S))

road = (ss < 0.26) & (vv > 0.40) & (vv < 0.61) & (r - b >= 6) & (r - b <= 42) & (r - g >= 0) & (r - g < 34) & ~legend
road = close(road, 13)
road = fill_holes(road, 5000)
road = open_(road, 7)
road = keep_big(road, 4000)
road = smooth(road, 4.0) & ~bldg2

water = (hh > 185) & (hh < 215) & (ss > 0.35) & (vv > 0.55) & ~legend
water = smooth(keep_big(open_(close(water, 9), 5), 500), 2.0)
_n, _lab, _st, _cen = cv2.connectedComponentsWithStats(water.astype(np.uint8), 8)
_keep = np.zeros(_n, bool)
_keep[1:] = (_cen[1:, 1] > 300 * S) & (_st[1:, cv2.CC_STAT_AREA] > 300 * S * S)
water = _keep[_lab]

trees = (hh > 80) & (hh < 170) & (vv < 0.62) & (ss > 0.35) & ~legend
trees = smooth(keep_big(open_(close(trees, 9), 7), 800), 3.0)


def down(m):
    return cv2.resize(m.astype(np.float32), (MW, MH), interpolation=cv2.INTER_AREA) > 0.5


road1, water1, trees1, bldg1 = down(road), down(water), down(trees), down(bldg2)

# the golf course: the open ground south of the main road that holds the sand traps
n, lab, st, _ = cv2.connectedComponentsWithStats((~road1 & ~water1).astype(np.uint8), 4)
golf1 = lab == lab[GOLF_SEED[1], GOLF_SEED[0]]
golf1 &= np.mgrid[0:MH, 0:MW][0] > 380
golf1 = smooth(open_(golf1, 9), 4.0)
golf2 = cv2.resize(golf1.astype(np.uint8), (MW * S, MH * S), interpolation=cv2.INTER_NEAREST).astype(bool)

sand = (hh > 20) & (hh < 45) & (ss > 0.30) & (ss < 0.70) & (vv > 0.75) & ~legend & golf2 & ~cv2.dilate(bldg2.astype(np.uint8), ell(41)).astype(bool)
sand = smooth(keep_big(open_(close(sand, 9), 5), 400), 2.5)

# the putting green near the first villas: darker, smooth green blob
green = (hh > 120) & (hh < 175) & (ss > 0.40) & (vv > 0.40) & (vv < 0.70) & golf2 & (xx > 650 * S) & (xx < 790 * S) & (yy > 540 * S) & (yy < 640 * S)
green = smooth(keep_big(open_(close(green, 9), 5), 400), 3.0)


def to_path(mask, eps=1.3, min_area=60):
    m = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in contours:
        if cv2.contourArea(c) < min_area * S * S:
            continue
        a = cv2.approxPolyDP(c, eps * S, True)[:, 0, :].astype(np.float64) / S
        if len(a) < 3:
            continue
        mids = (a + np.roll(a, -1, axis=0)) / 2
        d = f'M{mids[-1][0]:.1f} {mids[-1][1]:.1f}'
        for p, q in zip(a, mids):
            d += f'Q{p[0]:.1f} {p[1]:.1f} {q[0]:.1f} {q[1]:.1f}'
        out.append(d + 'Z')
    return ' '.join(out)


# ---------------------------------------------------------------------------------------------- route
# The walk, placed by hand along the traced roads: out the entrance, left along the front drive and the
# bottom of the big lot, down to the villa road, along the first villa lot, around the bend and across the
# second lot to villa D. build_debug.png shows it over the official map; the check below measures how
# much of it sits on traced asphalt.
route_pts = [START, (418, 326), (470, 336), (560, 336), (660, 332), (760, 330), (826, 342), (856, 380),
             (875, 445), (925, 495), (968, 540), (985, 575), (960, 615), (918, 652), (884, 700), (876, 770), END]
STEP2_I = 7

def catmull(pts):
    d = f'M{pts[0][0]:.1f} {pts[0][1]:.1f}'
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f' C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}'
    return d


ROUTE_D = catmull(route_pts)
seg = [math.dist(route_pts[i], route_pts[i + 1]) for i in range(len(route_pts) - 1)]
total = sum(seg)
cum = [0]
for s_ in seg:
    cum.append(cum[-1] + s_)
STEP2 = route_pts[STEP2_I]
STEP2_T = cum[STEP2_I] / total
road_near = cv2.dilate(road1.astype(np.uint8), ell(9)).astype(bool)
on = 0
samples = 0
for i in range(len(route_pts) - 1):
    for t in np.linspace(0, 1, max(2, int(seg[i] / 2)), endpoint=False):
        x = route_pts[i][0] + t * (route_pts[i + 1][0] - route_pts[i][0])
        y = route_pts[i][1] + t * (route_pts[i + 1][1] - route_pts[i][1])
        samples += 1
        on += road_near[int(y), int(x)]
print(f'route length {round(total)}, {100 * on / samples:.0f}% on traced roads, step 2 at {STEP2_T:.2f}')

# ---------------------------------------------------------------------------------------------- trees
rnd = random.Random(11)
tree_list = []
SP = 18
road_d = cv2.dilate(road1.astype(np.uint8), ell(5)).astype(bool)
golf_core = cv2.erode(golf1.astype(np.uint8), ell(37)).astype(bool)
for gy in range(VY0 - 10, VY1 + 10, SP):
    for gx in range(VX0 - 10, VX1 + 10, SP):
        x = gx + (SP / 2 if (gy // SP) % 2 else 0) + rnd.uniform(-5, 5)
        y = gy + rnd.uniform(-5, 5)
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < MW and 0 <= yi < MH):
            continue
        if trees1[yi, xi] and not road_d[yi, xi] and not bldg1[yi, xi] and not water1[yi, xi] and not golf_core[yi, xi]:
            tree_list.append((x, y, rnd.uniform(8.5, 12.5), rnd.random() < 0.3))
tree_list.sort(key=lambda t: t[1])
print('trees', len(tree_list))

# ---------------------------------------------------------------------------------------------- svg
F = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
P = lambda pts: ' '.join(f'{F(x)},{F(y)}' for x, y in pts)


def rot_text(cls, txt, x, y, ang, extra=''):
    return f'<text class="{cls}" x="{F(x)}" y="{F(y)}" text-anchor="middle" transform="rotate({F(ang)} {F(x)} {F(y)})"{extra}>{txt}</text>'


def lights(v, n_long=9, n_short=3):
    # little party lights around the outline of a villa (in the villa's rotated frame)
    (cx, cy), L, W, ang = v['c'], v['L'] + 14, v['W'] + 14, v['ang']
    pts = []
    for i in range(n_long):
        t = (i + 0.5) / n_long
        pts += [(cx - L / 2 + t * L, cy - W / 2), (cx - L / 2 + t * L, cy + W / 2)]
    for i in range(n_short):
        t = (i + 0.5) / n_short
        pts += [(cx - L / 2, cy - W / 2 + t * W), (cx + L / 2, cy - W / 2 + t * W)]
    cols = ['#ff7ad9', '#7fe3ff', '#ffe014', '#b98cff']
    out = [f'<g class="m-lights" transform="rotate({F(ang)} {F(cx)} {F(cy)})">']
    for k, (x, y) in enumerate(pts):
        out.append(f'<circle cx="{F(x)}" cy="{F(y)}" r="3.4" fill="{cols[k % 4]}" style="--k:{k % 7}"/>')
    out.append('</g>')
    return ''.join(out)


va, vd = villa_poly(VILLA_A), villa_poly(VILLA_D)


def inset(poly, k=0.9):
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in poly]


roofline_svg = ''.join(f'<polygon points="{P(inset(p, 0.9))}"/>' for p in HOTEL)
FLIES = [(352, 505, 0), (455, 645, 1.6), (612, 770, 3.1), (690, 452, 4.4), (915, 655, 2.2), (742, 1004, 5.3)]
flies_svg = ''.join(f'<circle cx="{x}" cy="{y}" r="7" style="--f:-{f}s"/>' for x, y, f in FLIES)
hotel_svg = ''.join(f'<polygon points="{P(p)}"/>' for p in HOTEL)
ridge = lambda v: (lambda a, c, L: f'<line x1="{F(c[0] - math.cos(a) * (L / 2 - 14))}" y1="{F(c[1] - math.sin(a) * (L / 2 - 14))}" x2="{F(c[0] + math.cos(a) * (L / 2 - 14))}" y2="{F(c[1] + math.sin(a) * (L / 2 - 14))}"/>')(math.radians(v['ang']), v['c'], v['L'])
trees_svg = ''.join(
    f'<use href="#{"tr2" if alt else "tr"}" x="{F(x - rr)}" y="{F(y - rr)}" width="{F(2 * rr)}" height="{F(2 * rr)}"/>'
    for x, y, rr, alt in tree_list)
s2x, s2y = STEP2
ex, ey = END
dcx, dcy = VILLA_D['c']
acx, acy = VILLA_A['c']

svg = f'''    <svg class="map" id="map" viewBox="{VX0} {VY0} {VW} {VH}" role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">Walking route from the hotel entrance to Golf Villa D</title>
      <desc id="map-desc">Start at the Hotel Entrance and Guest Registration. Walk out the front doors, go left along the front of the hotel past the conference center and the parking lot, follow the road as it turns down toward the golf course, pass the first Golf Villas building and keep going to the last villa, building D, by the Chapel on the Green. The party is on the 4th floor in room 7416.</desc>
      <defs>
        <radialGradient id="mMoon" cx="92%" cy="2%" r="80%"><stop offset="0" stop-color="#bfe8ff" stop-opacity=".16"/><stop offset=".55" stop-color="#bfe8ff" stop-opacity=".03"/><stop offset="1" stop-color="#bfe8ff" stop-opacity="0"/></radialGradient>
        <radialGradient id="mVig" cx="50%" cy="48%" r="72%"><stop offset=".62" stop-color="#030612" stop-opacity="0"/><stop offset="1" stop-color="#030612" stop-opacity=".62"/></radialGradient>
        <radialGradient id="mGlowD"><stop offset="0" stop-color="#ff5fcf" stop-opacity=".55"/><stop offset=".5" stop-color="#ff5fcf" stop-opacity=".18"/><stop offset="1" stop-color="#ff5fcf" stop-opacity="0"/></radialGradient>
        <radialGradient id="mWisp"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".3" stop-color="#ffd6f2" stop-opacity=".9"/><stop offset="1" stop-color="#ff7ad9" stop-opacity="0"/></radialGradient>
        <linearGradient id="mCard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5ec8"/><stop offset=".55" stop-color="#ff3fa4"/><stop offset="1" stop-color="#c41f86"/></linearGradient>
        <pattern id="mMow" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(-21)"><rect width="44" height="22" fill="#fff" fill-opacity=".045"/></pattern>
        <filter id="mShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="4" dy="7" stdDeviation="5" flood-color="#02040c" flood-opacity=".6"/></filter>
        <filter id="mNeon" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="mBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
        <symbol id="tr" viewBox="-12 -12 24 24"><circle cx="1.6" cy="2.6" r="10.5" fill="#030d07" fill-opacity=".55"/><circle r="10" fill="#123c27"/><circle cx="-3" cy="-3.4" r="5.2" fill="#1d5a3a"/><circle r="10" fill="none" stroke="#a6e6ff" stroke-opacity=".09"/></symbol>
        <symbol id="tr2" viewBox="-12 -12 24 24"><circle cx="1.6" cy="2.6" r="10.5" fill="#030d07" fill-opacity=".55"/><circle r="10" fill="#0f3322"/><circle cx="-3" cy="-3.4" r="5" fill="#1a4f34"/><circle r="10" fill="none" stroke="#a6e6ff" stroke-opacity=".08"/></symbol>
        <symbol id="mNote" viewBox="0 0 20 28"><path d="M7 21.5a5.5 4.2 -20 1 1 -1 -2.6V3l12-3v17.5a5.5 4.2 -20 1 1 -1 -2.6V5.5L7 8Z"/></symbol>
        <clipPath id="mGolfClip"><path d="{to_path(golf2, 1.6, 400)}"/></clipPath>
        <mask id="mReveal" maskUnits="userSpaceOnUse" x="{VX0}" y="{VY0}" width="{VW}" height="{VH}"><path class="m-reveal" d="{ROUTE_D}" pathLength="1" fill="none" stroke="#fff" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/></mask>
      </defs>

      <rect x="{VX0}" y="{VY0}" width="{VW}" height="{VH}" fill="#0e2619"/>
      <g class="m-golf"><path d="{to_path(golf2, 1.6, 400)}"/><rect x="{VX0}" y="{VY0}" width="{VW}" height="{VH}" fill="url(#mMow)" clip-path="url(#mGolfClip)"/></g>
      <path class="m-water" fill-rule="evenodd" d="{to_path(water, 1.2, 40)}"/>
      <path class="m-sand" fill-rule="evenodd" d="{to_path(sand, 1.2, 60)}"/>
      <ellipse class="m-green" cx="714" cy="586" rx="36" ry="22" transform="rotate(-14 714 586)"/>
      <g class="m-flag"><line x1="722" y1="586" x2="722" y2="552"/><path d="M722 552l20 7-20 7z"/></g>
      <path class="m-road" fill-rule="evenodd" d="{to_path(road, 1.3, 80)}"/>
      <g class="m-trees">{trees_svg}</g>

      <g class="m-bldg" filter="url(#mShadow)">{hotel_svg}<polygon class="m-canopy" points="{P(CANOPY)}"/></g>
      <g class="m-roofline">{roofline_svg}</g>
      <g class="m-villa" filter="url(#mShadow)"><polygon points="{P(va)}"/><g class="m-ridge">{ridge(VILLA_A)}</g></g>
      <ellipse class="m-dglow" cx="{dcx}" cy="{dcy}" rx="200" ry="150" fill="url(#mGlowD)"/>
      <g class="m-villa-d" filter="url(#mShadow)"><polygon points="{P(vd)}"/><g class="m-ridge">{ridge(VILLA_D)}</g></g>
      <polygon class="m-neon" points="{P(villa_poly(dict(VILLA_D, L=VILLA_D['L'] + 8, W=VILLA_D['W'] + 8)))}" filter="url(#mNeon)"/>
      {lights(VILLA_D)}
      <g class="m-chapel" transform="translate({CHAPEL[0] - 33} {CHAPEL[1] - 15})"><path d="M0 26V8a9 9 0 0 1 18 0v18M22 26V4a11 11 0 0 1 22 0v22M48 26V8a9 9 0 0 1 18 0v18"/></g>

      <!-- labels on the ground -->
      <text class="ml ml-roof" x="452" y="168" text-anchor="middle">MAIN HOTEL</text>
      <text class="ml ml-roof2" x="709" y="118" text-anchor="middle">ROOMS</text>
      <text class="ml ml-roof2" x="709" y="140" text-anchor="middle">3001–3621</text>
      <g class="m-kg"><rect x="548" y="196" width="66" height="36" rx="9"/><text x="581" y="222" text-anchor="middle">K&amp;G</text></g>
      {rot_text('ml ml-roof2', 'GOLF VILLAS', acx, acy + 6, VILLA_A['ang'])}
      {rot_text('ml ml-d', 'VILLA D', dcx + 16, dcy + 21, VILLA_D['ang'])}
      <text class="ml ml-small" x="{CHAPEL[0]}" y="{CHAPEL[1] + 40}" text-anchor="middle">Chapel on the Green</text>
      {rot_text('ml-area', 'PARKING', 810, 250, -3)}
      {rot_text('ml-area', 'PARKING', 952, 800, 40)}
      <path id="mGolfLine" d="M312 812 Q 440 770 590 752" fill="none"/>
      <text class="ml-area ml-golf"><textPath href="#mGolfLine" startOffset="50%" text-anchor="middle">COLD WATER CANYON</textPath></text>
      <text class="ml ml-edge" x="290" y="425">← waterparks</text>
      {rot_text('ml ml-edge', '← River Rd · Hwy 13', 360, 586, -21, ' text-anchor="start"')}

      <!-- the walk -->
      <g mask="url(#mReveal)">
        <path class="m-route-glow" d="{ROUTE_D}" filter="url(#mBlur)"/>
        <path class="m-route" id="route" d="{ROUTE_D}"/>
      </g>
      <g id="paws"></g>
      <g class="m-wisp" aria-hidden="true">
        <circle r="18" fill="url(#mWisp)"><animateMotion dur="6.5s" begin="indefinite" repeatCount="indefinite" rotate="auto"><mpath href="#route"/></animateMotion></circle>
      </g>
      <g class="m-fly" aria-hidden="true">{flies_svg}</g>
      <g class="m-pulse"><circle cx="{F(ex)}" cy="{F(ey)}" r="26"/><circle cx="{F(ex)}" cy="{F(ey)}" r="26" style="animation-delay:1.1s"/></g>

      <g class="m-step" style="--d:0s"><circle cx="{START[0]}" cy="{START[1]}" r="21"/><text x="{START[0]}" y="{START[1] + 9}" text-anchor="middle">1</text></g>
      <g class="m-step" style="--d:{STEP2_T * 2.4:.2f}s"><circle cx="{F(s2x)}" cy="{F(s2y)}" r="21"/><text x="{F(s2x)}" y="{F(s2y + 9)}" text-anchor="middle">2</text></g>
      <g class="m-step" style="--d:2.4s"><circle cx="{F(ex)}" cy="{F(ey)}" r="21"/><text x="{F(ex)}" y="{F(ey + 9)}" text-anchor="middle">3</text></g>
      <g class="m-start"><rect x="{START[0] - 112}" y="{START[1] - 78}" width="224" height="42" rx="21"/><path d="M{START[0] - 9} {START[1] - 37}h18l-9 11z"/><text x="{START[0]}" y="{START[1] - 50}" text-anchor="middle">Hotel Entrance</text></g>

      <!-- the party -->
      <g class="m-ghost"><image href="assets/ghost-wave.webp" x="566" y="560" width="58" height="51"/></g>
      <g class="m-notes">
        <g transform="translate({F(dcx)} {F(dcy - 26)})"><g class="m-note" style="--n:0s;color:#ff7ad9"><use href="#mNote" x="-10" y="-14" width="20" height="28"/></g></g>
        <g transform="translate({F(dcx + 38)} {F(dcy - 26)})"><g class="m-note" style="--n:1.2s;color:#7fe3ff"><use href="#mNote" x="-8.5" y="-12" width="17" height="24"/></g></g>
        <g transform="translate({F(dcx - 38)} {F(dcy - 18)})"><g class="m-note" style="--n:2.3s;color:#ffe014"><use href="#mNote" x="-7.5" y="-10.5" width="15" height="21"/></g></g>
      </g>
      <path class="m-leader" d="M630 912 C 700 912 742 892 {F(dcx - 52)} {F(dcy + 4)}"/>
      <circle class="m-leader-dot" cx="{F(dcx - 52)}" cy="{F(dcy + 4)}" r="6"/>
      <g class="m-card">
        <rect x="294" y="838" width="336" height="150" rx="24" filter="url(#mShadow)"/>
        <text class="m-card-k" x="318" y="876">THE PARTY IS IN</text>
        <text class="m-card-room" x="314" y="946">7416</text>
        <text class="m-card-sub" x="318" y="976">Golf Villa D · 4th floor</text>
      </g>
      <g class="m-ghost m-ghost2"><image href="assets/ghost-lean.webp" x="540" y="852" width="70" height="70"/></g>

      <rect x="{VX0}" y="{VY0}" width="{VW}" height="{VH}" fill="url(#mMoon)" pointer-events="none"/>
      <rect x="{VX0}" y="{VY0}" width="{VW}" height="{VH}" fill="url(#mVig)" pointer-events="none"/>
    </svg>'''

p = os.path.join(SITE, 'index.html')
html = open(p, encoding='utf-8').read()
a = html.index('    <svg class="map" id="map"')
bnd = html.index('    </svg>', a) + len('    </svg>')
html = html[:a] + svg + html[bnd:]
open(p, 'w', encoding='utf-8').write(html)
print('map written', len(svg) // 1024, 'KB')

# ---------------------------------------------------------------------------------------------- debug overlay
dbg = cv2.imread(os.path.join(DEBUG, 'source.png'))
ov = dbg.copy()
for m, col in [(road1, (200, 200, 200)), (golf1, (90, 200, 90)), (water1, (255, 160, 40))]:
    ov[m] = (ov[m] * 0.4 + np.array(col) * 0.6).astype(np.uint8)
for poly in bldg_polys:
    cv2.polylines(ov, [np.round(np.array(poly)).astype(np.int32)], True, (60, 60, 255), 2)
cv2.polylines(ov, [np.round(np.array(route_pts)).astype(np.int32)], False, (255, 0, 255), 3)
for pt, lbl in [(START, '1'), (STEP2, '2'), (END, '3'), (CHAPEL, 'C')]:
    cv2.circle(ov, (int(pt[0]), int(pt[1])), 9, (0, 255, 255), -1)
    cv2.putText(ov, lbl, (int(pt[0]) - 5, int(pt[1]) + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
cv2.rectangle(ov, (VX0, VY0), (VX1, VY1), (0, 255, 255), 2)
cv2.imwrite(os.path.join(DEBUG, 'build_debug.png'), ov)
