# Pawsessed Lagoon · party site

Vortex's AquatiFur 2026 party: **Room 7416 · Golf Villas building D · 4th floor** · Fri–Sun Oct 9–11 · 8PM–2AM · 18+

Live at **https://frosty884.github.io/pawsessed/**

A static site (GitHub Pages, no build step) plus a small Google Apps Script backend bound to a Google Sheet, which powers:

- **Song requests**: title, artist and requester. Duplicates turn into ♥ votes. A device can send 4 requests per 10 minutes.
- **The live queue**: tick **Played** or **Removed** in the sheet and the song leaves the website's queue within a few seconds.
- **DJ portal** (footer → 🎧 DJ login, or add `?dj` to the URL): remove ✕ / mark played ✓ / undo, pause requests, close the raffle, set "now spinning", post an announcement banner, draw/hide the raffle winner, open the Google Sheet. The password is checked by the script, never in the page.
- **Mystery T-shirt raffle**: @handle plus Instagram or Telegram. The same handle is never entered twice. A live entry count, and a winner banner after the draw.

## Connect the Google Sheet (one time, ~5 minutes, works on a phone)

Use Chrome. On a phone, turn on **⋮ → Desktop site** for steps 2–6.

1. **Copy the code:** open <https://raw.githubusercontent.com/frosty884/pawsessed/main/apps-script/Code.gs>, long-press the text → **Select all** → **Copy**.
2. **New script:** open <https://script.google.com/home/projects/create> (signed in to the Google account that should own the sheet).
3. **Paste:** tap in the code area, long-press → **Select all**, then paste so the sample `myFunction` is replaced. Tap 💾 **Save**.
4. **Make the sheet:** in the toolbar pick the function **`setup`** → **▶ Run** → **Review permissions** → pick your account → **Advanced** → **Go to Untitled project (unsafe)** → **Allow**. (It's your own script. It only touches the sheet it creates.) The log shows `✅ Sheet ready: https://docs.google.com/…`. That's your sheet, also in Drive as *Pawsessed Lagoon · requests & raffle*.
5. **Publish it:** **Deploy → New deployment** → ⚙️ **Select type → Web app**. Set *Execute as* **Me** and *Who has access* **Anyone** → **Deploy** → **Copy** the Web app URL (ends in `/exec`).
6. **Connect the site:** send the `/exec` URL to Frosty, or paste it into [`js/config.js`](js/config.js) as `apiUrl: '…/exec'` and commit.

Alternative: create a Sheet first and use **Extensions → Apps Script** with the same code. That also adds a 🌴 Pawsessed menu in the sheet.

### Updating the script (same URL, ~2 minutes on a phone)

1. Copy the new code from <https://raw.githubusercontent.com/frosty884/pawsessed/main/apps-script/Code.gs> (long-press → Select all → Copy).
2. Open <https://script.google.com>, open the project, tap in the code, Select all, paste over it, tap 💾 Save.
3. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.** The web app URL stays the same.

The first visit after an update tidies the Requests and Raffle tabs automatically (the first version pre-filled checkboxes down to row 1000, which pushed every new row below them).

### Running the party from the sheet

| Tab | What to do |
| --- | --- |
| Requests | Tick **Played** when it's played, or **Removed** to drop it. Rows grey out. |
| Raffle | Every entry with handle, platform and which accounts they tapped. Odd-looking handles are still entered and marked `double-check`. Tick **Removed** (or ✕ in the DJ portal) to take an entry out of the draw. Draw from the DJ portal or the sheet menu. |
| Settings | `requestsOpen`, `raffleOpen` (checkboxes), `nowSpinning` (dropdown), `notice` (banner text), `raffleWinner` (clear it to hide the winner). |
| Log | Anything that went wrong: refused or failed submissions with the reason, newest last. |

DJ password: the one Vortex picked (stored as a hash in `Code.gs`). To change it, add a Script property `DJ_PASSWORD` under Apps Script → Project Settings.

## Develop & test

```bash
npm install
npm test            # 54 tests: the real Code.gs on an in-memory sheet, plus Chrome tests of the page
npm run serve       # http://localhost:8787/?api=http://localhost:8787/api/exec  (local mock backend)
npm run shots       # phone + desktop screenshots in tests/shots/
```

`tools/prep_assets.py` rebuilds the images, flyers and promo media from the promo project. `tools/build_map.py` redraws the map from the official Chula Vista resort map (roads, water and trees are traced; the route, buildings and labels are placed by hand in that file) and writes it into `index.html`.
