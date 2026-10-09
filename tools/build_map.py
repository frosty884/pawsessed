"""Builds the flat party map SVG from the traced official-map layers and writes it into index.html.

    python tools/trace_map.py <official-map.jpg>    (once: makes tools/map_layers.json)
    python tools/build_map.py                        (writes the <svg id="map"> in index.html)

Coordinates are the traced crop space (1000 x 1040, hotel at the top, villas at the bottom right).
Buildings are drawn as flat footprints at the positions on the official map.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
L = json.load(open(os.path.join(HERE, 'map_layers.json')))['layers']


def rect(cx, cy, w, h, ang, rx=8):
    return f'<rect x="{cx - w / 2:.1f}" y="{cy - h / 2:.1f}" width="{w}" height="{h}" rx="{rx}" transform="rotate({ang} {cx} {cy})"/>'


# walking route along the road centrelines: hotel entrance -> main road -> villa road -> villa D
ROUTE = [(405, 300), (410, 342), (418, 400), (440, 468), (540, 444), (650, 410), (760, 376), (848, 348),
         (900, 380), (950, 420), (982, 478), (972, 545), (925, 585), (862, 616), (814, 656), (802, 700),
         (830, 745), (872, 788), (880, 812)]


def smooth_path(pts):
    # Catmull-Rom through the points, as cubic Beziers
    d = f'M{pts[0][0]} {pts[0][1]}'
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f' C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]} {p2[1]}'
    return d


route = smooth_path(ROUTE)
end = ROUTE[-1]

svg = f'''    <svg class="map" id="map" viewBox="0 0 1000 1040" role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">Walking route from the hotel entrance to Golf Villa D</title>
      <desc id="map-desc">Traced from the official Chula Vista resort map. Leave the Hotel Entrance and Guest Registration, walk down through the drop-off to the main road, go left along it away from the waterparks to the end, follow the villa road past the first Golf Villas building and its parking lot, and keep going to the last villa building, D, by the Chapel on the Green. The party is on the 4th floor in room 7416.</desc>
      <defs>
        <radialGradient id="pinGlow"><stop offset="0" stop-color="#ff7ad9" stop-opacity=".7"/><stop offset="1" stop-color="#ff7ad9" stop-opacity="0"/></radialGradient>
        <filter id="neon" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect width="1000" height="1040" fill="#173b26"/>
      <!-- golf course -->
      <path d="M300 540 C 420 470 600 420 760 395 C 800 470 760 560 720 640 C 690 720 700 800 680 1040 L 0 1040 L 0 720 C 120 640 200 590 300 540 Z" fill="#1f4d30"/>
      <path class="map-water" fill-rule="evenodd" d="{L['water']}"/>
      <path class="map-sand" fill-rule="evenodd" d="{L['sand']}"/>
      <path class="map-trees" fill-rule="evenodd" d="{L['trees']}"/>
      <path class="map-road" fill-rule="evenodd" d="{L['road']}"/>

      <!-- buildings, flat footprints where the official map draws them -->
      <g class="map-bldg">
        <path d="M0 26 L200 52 L204 160 L0 158 Z"/>
        <path d="M206 86 L352 122 L468 96 L622 120 L624 298 L560 300 L440 262 L350 262 L212 230 Z"/>
        <path d="M620 40 L790 32 L800 188 L626 196 Z"/>
        <path d="M0 290 L52 290 L52 440 L0 440 Z"/>
      </g>
      <g class="map-villa">{rect(840, 532, 250, 74, 39)}</g>
      <g class="villa-d">
        <ellipse cx="845" cy="878" rx="190" ry="120" fill="url(#pinGlow)" class="glow"/>
        <g class="map-villa-d">{rect(845, 878, 248, 76, 41)}</g>
        <rect class="d-outline" x="{845 - 136}" y="{878 - 50}" width="272" height="100" rx="14" fill="none" transform="rotate(41 845 878)"/>
        <text class="roof-letter" x="845" y="888" text-anchor="middle">D</text>
      </g>
      <g transform="translate(818 932)" class="chapel">
        <path d="M0 26V8a9 9 0 0 1 18 0v18M22 26V4a11 11 0 0 1 22 0v22M48 26V8a9 9 0 0 1 18 0v18"/>
      </g>

      <!-- labels -->
      <text class="map-label small" x="100" y="110" text-anchor="middle">Condos</text>
      <text class="map-label" x="330" y="190" text-anchor="middle">Main hotel</text>
      <rect x="566" y="190" width="72" height="44" rx="9" fill="#e8762c" stroke="#fff3d6" stroke-width="3"/>
      <text class="kg" x="602" y="221" text-anchor="middle">K&amp;G</text>
      <text class="map-label small" x="710" y="104" text-anchor="middle">Rooms</text>
      <text class="map-label small" x="710" y="130" text-anchor="middle">3001–3621</text>
      <text class="map-label small" x="14" y="476">← Lost Rios</text>
      <text class="map-label small" x="160" y="520" text-anchor="middle">waterparks</text>
      <text class="map-label small" x="930" y="460" text-anchor="middle" transform="rotate(39 930 460)">villa parking</text>
      <text class="map-label small" x="925" y="800" text-anchor="middle" transform="rotate(38 925 800)">villa parking</text>
      <text class="map-label small" x="700" y="608" text-anchor="middle">Golf Villas</text>
      <text class="map-label tiny" x="700" y="634" text-anchor="middle">rooms 7101–7310</text>
      <text class="map-label tiny" x="850" y="1000" text-anchor="middle">Chapel on the Green</text>
      <text class="map-label faint" x="430" y="700" text-anchor="middle">Cold Water Canyon</text>
      <text class="map-label faint" x="430" y="734" text-anchor="middle">golf course</text>
      <text class="map-label small" x="14" y="640" transform="rotate(-19 14 640)">to River Rd · Hwy 13</text>

      <!-- walking route -->
      <path id="route" class="route" d="{route}" fill="none"/>
      <g id="paws"></g>
      <g>
        <g transform="translate(405 248)">
          <rect x="-150" y="-34" width="300" height="48" rx="24" fill="#1d0b3a" stroke="#ffe014" stroke-width="3"/>
          <text y="0" text-anchor="middle" class="map-label small">Hotel Entrance</text>
        </g>
        <circle cx="405" cy="302" r="22" fill="#ffe014" stroke="#1d0b3a" stroke-width="4"/>
        <text x="405" y="311" text-anchor="middle" class="map-step">1</text>
      </g>
      <g><circle cx="848" cy="348" r="22" fill="#ffe014" stroke="#1d0b3a" stroke-width="4"/><text x="848" y="357" text-anchor="middle" class="map-step">2</text></g>
      <g class="pin">
        <circle cx="{end[0]}" cy="{end[1]}" r="22" fill="#ffe014" stroke="#1d0b3a" stroke-width="4"/>
        <text x="{end[0]}" y="{end[1] + 9}" text-anchor="middle" class="map-step">3</text>
        <g class="pin-bubble">
          <path d="M520 806 h236 a22 22 0 0 1 22 22 v20 l60 24 l-60 6 v20 a22 22 0 0 1 -22 22 h-236 a22 22 0 0 1 -22 -22 v-70 a22 22 0 0 1 22 -22 z" fill="#ff3fa4" stroke="#1d0b3a" stroke-width="4"/>
          <text x="638" y="862" text-anchor="middle" class="pin-room">7416</text>
          <text x="638" y="902" text-anchor="middle" class="pin-floor">Villa D · 4th floor</text>
        </g>
      </g>
      <text class="map-note" x="16" y="1028">traced from the Chula Vista resort map · tap to zoom</text>
    </svg>'''

p = os.path.join(SITE, 'index.html')
s = open(p, encoding='utf-8').read()
a = s.index('    <svg class="map" id="map"')
b = s.index('    </svg>', a) + len('    </svg>')
s = s[:a] + svg + s[b:]
open(p, 'w', encoding='utf-8').write(s)
print('map written', len(svg) // 1024, 'KB')
