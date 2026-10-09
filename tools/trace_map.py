"""Traces the official Chula Vista resort map into flat vector layers for the party map.

    python tools/trace_map.py <official-map.jpg>   ->  tools/map_layers.json (+ previews in tools/trace_preview/)

Roads and parking lots, water, sand traps, tree clusters and building roofs are picked out by colour,
cleaned up with morphology, and turned into simplified polygons in a 1000 x 1040 coordinate space
(the hotel-to-villas part of the official map). The page draws them flat, in its own colours.
"""
import json
import os
import sys

import cv2
import numpy as np

SRC = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, 'trace_preview')
os.makedirs(PREV, exist_ok=True)

img = cv2.imread(SRC)  # BGR, 3300 x 2550
CROP = (1300, 100, 3300, 2180)  # x0, y0, x1, y1 in the full-size official map
x0, y0, x1, y1 = CROP
crop = img[y0:y1, x0:x1]
W, H = 1000, 1040
small = cv2.resize(crop, (W, H), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(PREV, 'source.png'), small)
hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.int32)
hh, ss, vv = hsv[..., 0] * 2, hsv[..., 1] / 255.0, hsv[..., 2] / 255.0  # hue in degrees
b, g, r = [small[..., i].astype(np.int32) for i in range(3)]

# the legend box (lower left) is not part of the map
legend = np.zeros((H, W), bool)
legend[728:, :700] = True

def keep_big(mask, min_area):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    out = np.zeros_like(mask, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out |= lab == i
    return out

def morph(mask, close=0, open_=0):
    m = mask.astype(np.uint8)
    if close:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    if open_:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (open_, open_)))
    return m.astype(bool)

# road / parking asphalt: muted mauve-grey (#8c7973 family): low saturation, warm-ish, mid value
road = (ss < 0.26) & (vv > 0.40) & (vv < 0.61) & (r - b >= 6) & (r - b <= 42) & (r - g >= 0) & (r - g < 34) & ~legend
# white stall lines and the cars sitting in lots get absorbed by closing
road = morph(road, close=9, open_=5)
road = keep_big(road, 900)

water = (hh > 185) & (hh < 215) & (ss > 0.35) & (vv > 0.55) & ~legend
water = keep_big(morph(water, close=5, open_=3), 120)

sand = (hh > 20) & (hh < 45) & (ss > 0.30) & (ss < 0.70) & (vv > 0.75) & ~legend
sand = keep_big(morph(sand, close=5, open_=3), 80)

# trees: deep greens
trees = (hh > 80) & (hh < 170) & (vv < 0.62) & (ss > 0.35) & ~legend
trees = keep_big(morph(trees, close=7, open_=5), 150)

# roofs: dark red-brown (#7c4b44 family)
roof = (((hh < 25) | (hh > 340)) & (ss > 0.28) & (ss < 0.75) & (vv > 0.30) & (vv < 0.62)) & ~legend
roof = keep_big(morph(roof, close=7, open_=3), 400)

layers = {}
for name, mask, eps in [('road', road, 1.6), ('water', water, 1.4), ('sand', sand, 1.2), ('trees', trees, 2.2), ('roof', roof, 1.8)]:
    m = mask.astype(np.uint8) * 255
    cv2.imwrite(os.path.join(PREV, name + '.png'), m)
    contours, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    paths = []
    for c in contours:
        if cv2.contourArea(c) < 30:
            continue
        a = cv2.approxPolyDP(c, eps, True)[:, 0, :]
        if len(a) < 3:
            continue
        paths.append('M' + 'L'.join(f'{x} {y}' for x, y in a) + 'Z')
    # holes come out as their own contours; fill-rule evenodd renders them as holes
    layers[name] = ' '.join(paths)
    print(name, len(paths), 'paths', len(layers[name]) // 1024, 'KB')

json.dump({'w': W, 'h': H, 'crop': CROP, 'layers': layers}, open(os.path.join(HERE, 'map_layers.json'), 'w'))
