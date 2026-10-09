"""Builds the web assets for the party site from the promo project and the chat exports.

    python tools/prep_assets.py      (run from the site folder)

Re-run it if any source art changes. Everything it writes lives in assets/ and media/.
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMO = os.path.join(ROOT, '..', 'promo')
CHAT1 = os.path.join(ROOT, '..', 'photos')
CHAT2 = os.path.join(ROOT, '..', 'ChatExport_2026-10-08', 'photos')
UPLOADS = r'C:/Users/brand/.claude/uploads/1535a162-b018-4713-95ca-c80047de66e6'
MAGIA = r'C:/Users/brand/AppData/Local/Temp/claude/C--pawsessed/1535a162-b018-4713-95ca-c80047de66e6/scratchpad/magia/assets'
A = os.path.join(ROOT, 'assets')
F = os.path.join(A, 'flyers')
M = os.path.join(ROOT, 'media')
for d in (A, F, M):
    os.makedirs(d, exist_ok=True)


def save_webp(im, path, q=86):
    im.save(path, 'WEBP', quality=q, method=6)
    print('wrote', os.path.relpath(path, ROOT), im.size, os.path.getsize(path) // 1024, 'KB')


def save_jpg(im, path, q=82):
    im.convert('RGB').save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    print('wrote', os.path.relpath(path, ROOT), im.size, os.path.getsize(path) // 1024, 'KB')


# ---- logo layers (cut from Jake's flyer for the promo) at 2x their CSS size is plenty: keep native
logo = json.load(open(os.path.join(PROMO, 'assets', 'logo.json')))
for name in logo['layers']:
    save_webp(Image.open(os.path.join(PROMO, 'assets', name + '.png')), os.path.join(A, name + '.webp'), 90)
json.dump(logo, open(os.path.join(A, 'logo.json'), 'w'), indent=1)

# ---- hero + doodles
hero = Image.open(os.path.join(PROMO, 'assets', 'hero.png'))
save_webp(hero.resize((640, round(640 * hero.height / hero.width)), Image.LANCZOS), os.path.join(A, 'hero.webp'), 88)
for i, name in [(2, 'skull'), (3, 'ghost-wave'), (4, 'ghost-lean'), (0, 'bat-a'), (1, 'bat-b')]:
    im = Image.open(os.path.join(PROMO, 'assets', f'doodle_{i}.png'))
    im.thumbnail((200, 200), Image.LANCZOS)
    save_webp(im, os.path.join(A, name + '.webp'), 88)

# ---- page background: the painted night lagoon from the story render
save_jpg(Image.open(os.path.join(PROMO, 'assets', 'bg_story_nomoon.png')), os.path.join(A, 'bg.jpg'), 78)

# ---- past flyers (newest first)
def fit(im, h=900):
    im = im.convert('RGB')
    if im.height > h:
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    return im


flyers = []


def flyer(slug, im, title, when):
    save_jpg(fit(im), os.path.join(F, slug + '.jpg'), 80)
    w, h = fit(im).size
    flyers.append({'src': f'assets/flyers/{slug}.jpg', 'w': w, 'h': h, 'title': title, 'when': when})


flyer('pawsessed-lagoon', Image.open(os.path.join(UPLOADS, '28701084-image.png')), 'Pawsessed Lagoon', 'AquatiFur 2026 · this weekend')
flyer('vortex-denfur', Image.open(os.path.join(CHAT1, 'photo_3@24-08-2026_20-47-54.jpg')), 'Come Party with Vortex', 'DenFur 2026')
mg = Image.open(os.path.join(MAGIA, 'bg.png')).convert('RGBA')
mg.alpha_composite(Image.open(os.path.join(MAGIA, 'girl.png')).convert('RGBA'))
lg = Image.open(os.path.join(MAGIA, 'logo.png')).convert('RGBA')
lg = lg.resize((round(lg.width * 0.62), round(lg.height * 0.62)), Image.LANCZOS)
mg.alpha_composite(lg, (24, mg.height - lg.height - 18))
flyer('magia', mg, 'Magia', 'Anime Magic Con afterparty · Aug 22')
w4l = Image.open(os.path.join(UPLOADS, '1b74fe93-image.png')).crop((14, 222, 878, 1782))
flyer('waifu4laifu', w4l, 'waifu4laifu', 'Anime Midwest hotel party · July 4')
flyer('freakend', Image.open(os.path.join(CHAT2, 'photo_11@28-08-2026_00-10-54.jpg')), 'Freakend', 'May 9')
flyer('furry-pop-up', Image.open(os.path.join(CHAT2, 'photo_1@03-06-2026_19-13-28.jpg')), 'Furry Pop-Up Night', 'Miss Egg Roll, Chicago')
flyer('pu-s2e9', Image.open(os.path.join(CHAT1, 'photo_18@24-08-2026_21-00-44.jpg')), 'Project Unknown S2E9', 'Mar 15')
flyer('pu-s2e8', Image.open(os.path.join(CHAT1, 'photo_16@24-08-2026_21-00-44.jpg')), 'Project Unknown S2E8', 'Mar 1')
flyer('synergy', Image.open(os.path.join(CHAT1, 'photo_17@24-08-2026_21-00-44.jpg')), 'Greenline × Project Unknown: Synergy', 'Feb 28')
flyer('pu-s2e6', Image.open(os.path.join(MAGIA, 'flyer-s2e-matrix.jpg')), 'Project Unknown S2E6', 'Jan 25')
flyer('pu-s2e2', Image.open(os.path.join(MAGIA, 'flyer-s2e2.jpg')), 'Project Unknown S2E2', 'Dec 14, 2025')
flyer('vortex-aqf-2025', Image.open(os.path.join(CHAT1, 'photo_19@24-08-2026_21-11-00.jpg')), 'Run It Up, Turbo', 'Vortex @ AquatiFur 2025')
json.dump(flyers, open(os.path.join(A, 'flyers.json'), 'w'), indent=1)

# ---- promo media: the phone loop (shown on the page, best for Telegram), the story, posters
shutil.copy(os.path.join(PROMO, 'pawsessed-lagoon-telegram.mp4'), os.path.join(M, 'pawsessed-lagoon.mp4'))
shutil.copy(os.path.join(PROMO, 'pawsessed-lagoon-story.mp4'), os.path.join(M, 'pawsessed-lagoon-story.mp4'))
subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', '3', '-i', os.path.join(M, 'pawsessed-lagoon.mp4'), '-frames:v', '1', os.path.join(M, 'poster.png')])
poster = Image.open(os.path.join(M, 'poster.png')).convert('RGB')
save_jpg(poster.resize((540, 1212), Image.LANCZOS), os.path.join(M, 'poster.jpg'), 80)
os.remove(os.path.join(M, 'poster.png'))

# ---- link preview (Telegram / Discord / iMessage cards): 1200x630
og = Image.open(os.path.join(PROMO, 'assets', 'bg.png')).convert('RGB').crop((0, 60, 1080, 627)).resize((1200, 630), Image.LANCZOS)
og = og.filter(ImageFilter.GaussianBlur(1.2))
canvas = og.convert('RGBA')
L = logo['layers']
logo_img = Image.new('RGBA', (640, 530))
for name in ['logo_palm', 'logo_bat0', 'logo_bat1', 'logo_bat2', 'logo_paw', 'logo_lagoon', 'logo_aqua']:
    logo_img.alpha_composite(Image.open(os.path.join(PROMO, 'assets', name + '.png')), (L[name]['x'], L[name]['y']))
d = ImageDraw.Draw(logo_img)
r = logo['ring']
d.arc([r['cx'] - r['r'], r['cy'] - r['r'], r['cx'] + r['r'], r['cy'] + r['r']], 63.7, 273, fill=(255, 111, 210, 255), width=10)
logo_img = logo_img.resize((560, 464), Image.LANCZOS)
glow = logo_img.filter(ImageFilter.GaussianBlur(14))
canvas.alpha_composite(glow, (40, 90))
canvas.alpha_composite(logo_img, (40, 80))
fonts = os.path.join(PROMO, 'fonts')
try:
    import urllib  # noqa
except Exception:
    pass
txt = ImageDraw.Draw(canvas)


def font(path, size):
    return ImageFont.truetype(path, size)


# Fredoka is woff2 only; fall back to a bold system face for the preview card
sys_bold = 'C:/Windows/Fonts/segoeuib.ttf'
big = font(sys_bold, 96)
mid = font(sys_bold, 40)
small = font(sys_bold, 30)
x0 = 640
txt.text((x0, 160), 'ROOM', font=mid, fill=(255, 200, 236), stroke_width=4, stroke_fill=(20, 8, 46))
txt.text((x0, 196), '7416', font=font(sys_bold, 150), fill=(255, 255, 255), stroke_width=7, stroke_fill=(20, 8, 46))
txt.text((x0, 372), 'Golf Villas · Building D · 4th floor', font=small, fill=(255, 255, 255), stroke_width=4, stroke_fill=(20, 8, 46))
txt.text((x0, 420), 'Fri–Sun · Oct 9–11 · 8PM–2AM', font=small, fill=(255, 122, 217), stroke_width=4, stroke_fill=(20, 8, 46))
txt.text((x0, 468), 'AquatiFur · hosted by Vortex · 18+', font=small, fill=(255, 224, 20), stroke_width=4, stroke_fill=(20, 8, 46))
save_jpg(canvas, os.path.join(A, 'og.jpg'), 86)
