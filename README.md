# Pawsessed Lagoon · party site

Vortex's AquatiFur 2026 party: **Room 7416 · Golf Villas building D · 4th floor** · Fri–Sun Oct 9–11 · 8PM–2AM · 18+

Live at **https://frosty884.github.io/pawsessed/**

A static site (GitHub Pages, no build step) plus a small Google Apps Script backend bound to a Google Sheet, which powers:

- **Song requests**: title, artist and requester. Duplicates turn into ♥ votes. A device can send 4 requests per 10 minutes.
- **The live queue**: tick **Played** or **Removed** in the sheet and the song leaves the website's queue within a few seconds.
- **DJ portal** (footer → 🎧 DJ login, or add `?dj` to the URL): remove ✕ / mark played ✓ / undo, pause requests, close the raffle, set "now spinning", post an announcement banner. The password is checked by the script, never in the page.
- **Mystery T-shirt raffle**: @handle plus Instagram or Telegram. The same handle is never entered twice. A live entry count, and a winner banner after the draw.

## Connect the Google Sheet (one time, about 5 minutes)

1. Create a new Google Sheet (call it "Pawsessed Lagoon").
2. **Extensions → Apps Script.** Delete what's there, paste all of [`apps-script/Code.gs`](apps-script/Code.gs), and save.
3. In the function dropdown pick **`setup`** → **Run**. Google asks you to authorize: Review permissions → your account → Advanced → *Go to project (unsafe)* → Allow. (It's your own script. It only touches this sheet.) The **Requests**, **Raffle** and **Settings** tabs appear.
4. **Deploy → New deployment** → gear icon → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
5. Paste that URL into [`js/config.js`](js/config.js) as `apiUrl: 'https://script.google.com/macros/s/…/exec'` and push. (Or just send the URL to whoever manages the repo.)

Reload the sheet once and a **🌴 Pawsessed** menu appears: **Draw raffle winner**, **Mark every queued request played**, **Push sheet edits to the website now** and **Set up / repair**.

If you edit `Code.gs` later, use **Deploy → Manage deployments → ✏️ → Version: New version** so the URL stays the same.

### Running the party from the sheet

| Tab | What to do |
| --- | --- |
| Requests | Tick **Played** when it's played, or **Removed** to drop it. Rows grey out. |
| Raffle | Every entry with handle, platform and which accounts they tapped. Use the menu to draw. |
| Settings | `requestsOpen`, `raffleOpen` (checkboxes), `nowSpinning` (dropdown), `notice` (banner text), `raffleWinner` (clear it to hide the winner). |

DJ password: the one Vortex picked (stored as a hash in `Code.gs`). To change it, add a Script property `DJ_PASSWORD` under Apps Script → Project Settings.

## Develop & test

```bash
npm install
npm test            # 35 tests: the real Code.gs on an in-memory sheet, plus Chrome tests of the page
npm run serve       # http://localhost:8787/?api=http://localhost:8787/api/exec  (local mock backend)
npm run shots       # phone + desktop screenshots in tests/shots/
```

`tools/prep_assets.py` rebuilds the images, flyers and promo media from the promo project.
