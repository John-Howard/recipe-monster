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

Covers are downloaded into `data/covers/` whenever one can be found: from the ISBN lookup's cover, then Open Library by ISBN, then Open Library by title and author. This happens when a book is saved; use **🔎 Find cover** in a book's edit dialog or **Download missing covers** in Library → ⋯ to fill in the rest. If nothing is found, a remote cover URL is kept as before. To swap your own cover photos for online ones, use **🌐 Replace with online cover** on a book, or **Refresh all covers from the internet** in Library → ⋯; the old photo is deleted only when a replacement is found.

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

## Courses

Every recipe has one course (starter, main, dessert, side, breakfast, snack or other), kept separate from its tags. It is first guessed from the name by simple rules, and the planner uses it so dinners are real mains and puddings are real desserts. With `ANTHROPIC_API_KEY` set, new recipes are also classified by Claude in the background, and **🍽️ Re-check courses with AI** in the library tools redoes the whole shelf, showing progress as it goes. Changing a recipe's course yourself locks it in: neither the rules nor the AI will overwrite it.

Snacks (trail mix, crackers, popcorn, bliss balls, flapjacks...) have their own course. Recipes whose course came from the rules are re-guessed on every start; AI and hand-set courses are left alone, so run **Re-check courses with AI** once to move older AI-classified snacks across. The planner doesn't schedule snacks.

## Managing tags

Tags are edited as pills in the recipe dialog (Enter or comma to add, × to remove, with suggestions from your existing tags). **🏷️ Manage tags** in the library tools lists every tag with its recipe and book counts, and lets you rename (renaming to an existing tag merges them) or delete it everywhere. On the Find page, tick recipes (or Select all) and use the bar at the bottom to add or remove a tag on all of them. None of this touches courses.

## Themes

Themes are built from chips:

- **Diet / theme tags** you give a book when you add it (*Slimming World*, *Fast 800*, *Batch cooking*...). Every recipe in the book inherits them.
- **Recipe tags**, guessed automatically from the name: main ingredient (chicken, fish, pulses...), dish (curry, pasta, soup, pie...), course (breakfast, dessert, sides...) and cuisine. Edit any recipe to change its tags.
- **Authors**, **books**, **free text** and **❤️ favourites**.

Chips of the same kind mean *either* (Fast 800 **or** Slimming World); different kinds mean *both* (Fast 800 **and** by Dr Michael Mosley). Click a chip to flip it to **not** (e.g. *not fish*). Save combinations you like as theme tiles.

The planner fits recipes to meals (breakfast slots only get breakfast recipes, lunches lean towards soups and salads), avoids repeats and back-to-back main ingredients or cuisines, prefers favourites and higher ratings, and skips what you've cooked in the last fortnight (tick ✅ on a card when you cook it). **Fewer books off the shelf** clusters the week into fewer books.

Evenings are built around a main (the dinner slot). Switch on **🥗 Starters at weekends** and/or **🍮 Puddings at weekends** and Saturday and Sunday get a starter and a pudding that complement the main (not the same main ingredient or dish type, and a light pudding after a heavy main). On weekdays each day has a faint **＋ starter** / **＋ pudding** button if you want one; ✕ on a starter or pudding removes it again. Older plans with a pudding meal still open, with weekend puddings switched on.

The plan you are working on is shared between devices: change it on the desktop and it appears on your phone (and vice versa).

## Running in Docker (OrbStack) with HTTPS

Phone cameras only work on a secure origin, so a [Caddy](https://caddyserver.com) container serves HTTPS with a local [mkcert](https://github.com/FiloSottile/mkcert) certificate.

```
brew install mkcert
make certs
# add these lines to /etc/hosts (the ::1 line avoids a 5s .local lookup delay on macOS):
#   127.0.0.1 recipe-monster.local
#   ::1       recipe-monster.local
make up
```

Open https://recipe-monster.local on the Mac. Your library lives in `./data`; `ANTHROPIC_API_KEY` and `RECIPE_MONSTER_MODEL` are read from the environment or a `.env` file. `make help` lists the other targets (`down`, `logs`, `test`, `check`).

`GOOGLE_BOOKS_API_KEY` is optional and avoids 429 quota errors on the Google Books ISBN fallback (create a key in Google Cloud Console with the Books API enabled).

If `op` is installed, `make up` runs through `op run --env-file=.env.1password`, so the API keys are pulled from 1Password and nothing secret is written to disk (`.env.1password` only holds `op://` references).

If another stack (such as the GIS demo) already holds port 443, use `HTTPS_PORT=8443 make up` and open `https://recipe-monster.local:8443`.

On the phone, AirDrop `certs/rootCA.pem` to it and install the profile. On iOS, then enable full trust in Settings → General → About → Certificate Trust Settings. On Android: Settings → Security → Install certificate → CA certificate. Then open `https://<lan-ip>/scan.html` (the /etc/hosts entry only works on the Mac).

If the Mac's LAN IP changes, re-run `make certs` and `make up`.

Outside Docker, set `TLS_CERT` and `TLS_KEY` (file paths) to serve HTTPS, and `PUBLIC_URL` (comma-separated base URLs) to override the addresses shown for phones.

Set `LOG_REQUESTS=1` to log every request (method, path, status, client address, user agent); when Node serves TLS itself, handshake failures are always logged.

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
