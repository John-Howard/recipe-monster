# 👾 Recipe Monster

Turn a shelf of cookbooks into a searchable recipe library and a themed weekly menu planner.

1. **Scan** each book with your phone: photograph the ISBN barcode (title, author and cover are looked up for you), then photograph the index pages. Recipe names and page numbers are read and saved to a local SQLite database.
2. **Search** every recipe across every book by name, ingredient, diet, author or book.
3. **Plan** a week: pick a theme (e.g. *Slimming World*, *Fast 800*, an author such as *Dr Michael Mosley*, *Vegetarian*, *chicken*, or a combination), hit **Feed me a week!**, and watch the slot machine deal out breakfasts, lunches, dinners and puddings. Lock the ones you like, re-spin the rest, drag to swap days, or search and add recipes yourself.
4. Get a **shelf list**: which books to pull off the shelf, with page numbers, ready to print.

## Running it

Needs **Node.js 22.13 or newer** (it uses Node's built-in SQLite, so there's nothing to compile).

```bash
npm install
npm start          # http://localhost:3000
npm run demo       # same, but adds 5 made-up demo books the first time so you can play straight away
```

The terminal prints the address to open on your phone (for example `http://192.168.1.20:3000/scan.html`). The **📱 Scan** page in the app also shows it as a QR code: point your phone's camera at it. Phone and computer must be on the same Wi-Fi.

Your data lives in `data/recipe-monster.db` (plus `data/covers/` for cover photos). Set `RECIPE_MONSTER_DATA=/some/folder` to keep it elsewhere, and `PORT=8080` to change the port. **Library → ⋯** has backup/restore (JSON), demo-data controls and **Download missing covers**.

Covers are downloaded into `data/covers/` whenever one can be found: from the ISBN lookup's cover, then Open Library by ISBN, then Open Library by title and author. This happens when a book is saved; use **🔎 Find cover** in a book's edit dialog or **Download missing covers** in Library → ⋯ to fill in the rest. If nothing is found, a remote cover URL is kept as before.

> There's no login: anyone on your home network can open the app. Don't expose the port to the internet.

**Phone says "network connection lost" or can't connect?**
- Make sure the computer running Recipe Monster isn't asleep. Set it to stay awake while plugged in, at least while you're scanning.
- Phone and computer must be on the same Wi-Fi. Turn off mobile data / "Wi-Fi Assist" if the phone keeps switching away, and avoid guest networks, which often block devices from seeing each other.
- If the page won't load at all, the computer's firewall may be blocking port 3000. Allow Node.js through it (on Windows, choose "Private networks" when asked).
- The app retries dropped requests by itself, and AI page reads carry on even if the phone sleeps or loses Wi-Fi mid-read. Any page that still fails shows a **Retry** button.

## Reading index pages: AI or on-phone OCR

| | How | Quality |
|---|---|---|
| **🤖 AI reading** (recommended) | Set `ANTHROPIC_API_KEY` before `npm start`. Photos go to Claude's vision model. | Handles multi-column layouts, ingredient headings with sub-entries ("Chicken → – and leek pie 45"), wrapped lines and V/GF/DF markers well. |
| **📱 On-device OCR** (default, free) | Tesseract.js runs in the phone's browser, then a heuristic parser on the server turns the text into recipes. | Good on clean single-column indexes; expect to fix a few lines on the review screen. |

Either way you always get a review screen to fix names and page numbers before anything is saved. The model can be changed with `RECIPE_MONSTER_MODEL` (default `claude-opus-5-5`). With an API key set, the scanner also offers **Photo of cover**, which reads the title, author and likely diet tags from the cover. That's handy for books without a barcode.

Tips: good light, one page per photo, book held flat, page filling the frame.

**When a scan comes out wrong.** Each photographed page keeps its own results, so a bad page can be thrown away without losing the others:

- Every page thumbnail has **↺ / ↻** (rotate and read again) and **🗑️** (delete the page and everything read from it). Tap a thumbnail to see the photo and what was read from it. From there you can turn it upside down, read it again, switch that page to AI reading, or edit the raw OCR text and re-read it.
- With on-device OCR, a page that reads as gibberish (few recipes or low confidence) is automatically retried at 90°, 270° and 180°, and the best result is kept.
- On the review screen recipes are grouped by page, with **🔁 Re-read** and **🗑️ Delete page** on each group. Recipes that also appear on an earlier page are shown struck through and only saved once.

## Themes

Themes are built from chips:

- **Diet / theme tags** you give a book when you add it (*Slimming World*, *Fast 800*, *Batch cooking*...). Every recipe in the book inherits them.
- **Recipe tags**, guessed automatically from the name: main ingredient (chicken, fish, pulses...), dish (curry, pasta, soup, pie...), course (breakfast, dessert, sides...) and cuisine. Edit any recipe to change its tags.
- **Authors**, **books**, **free text** and **❤️ favourites**.

Chips of the same kind mean *either* (Fast 800 **or** Slimming World); different kinds mean *both* (Fast 800 **and** by Dr Michael Mosley). Click a chip to flip it to **not** (e.g. *not fish*). Save combinations you like as theme tiles.

The planner fits recipes to meals (breakfast slots only get breakfast recipes, lunches lean towards soups and salads), avoids repeats and back-to-back main ingredients or cuisines, prefers favourites and higher ratings, and skips what you've cooked in the last fortnight (tick ✅ on a card when you cook it). **Fewer books off the shelf** clusters the week into fewer books.

## Running in Docker (OrbStack) with HTTPS

Phone cameras only work on a secure origin, so the container serves HTTPS with a local [mkcert](https://github.com/FiloSottile/mkcert) certificate.

```
scripts/make-cert.sh
PUBLIC_URL=https://<lan-ip>:3443 docker compose up -d --build
```

Open https://localhost:3443 on the Mac. Your library lives in `./data`; `ANTHROPIC_API_KEY` and `RECIPE_MONSTER_MODEL` are read from the environment or a `.env` file.

To pull the API key from 1Password instead (nothing secret is written to disk; `.env.1password` only holds an `op://` reference):

```
PUBLIC_URL=https://<lan-ip>:3443 op run --env-file=.env.1password -- docker compose up -d --build
```

On the phone, AirDrop `certs/rootCA.pem` to it and install the profile. On iOS, then enable full trust in Settings → General → About → Certificate Trust Settings. On Android: Settings → Security → Install certificate → CA certificate. Then open `https://<lan-ip>:3443/scan.html`.

If the Mac's LAN IP changes, re-run `scripts/make-cert.sh` and update `PUBLIC_URL`.

Outside Docker, set `TLS_CERT` and `TLS_KEY` (file paths) to serve HTTPS, and `PUBLIC_URL` (comma-separated base URLs) to override the addresses shown for phones.

## Project layout

```
server/index.js        Express API + static files + live updates (server-sent events) to the desktop
server/db.js           SQLite schema, search (FTS5) and theme filters
server/planner.js      Week generator and re-roll
server/indexParser.js  OCR text → recipes heuristics
server/tagger.js       Auto-tagging from recipe names
server/ai.js           Optional Claude vision for index pages and covers
server/isbn.js         Open Library / Google Books lookup
public/                The app (plain ES modules, no build step); scan.html is the phone page
test/                  node --test suite (npm test)
```
