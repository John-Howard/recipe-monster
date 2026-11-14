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

Your data lives in `data/recipe-monster.db` (plus `data/covers/` for cover photos). Set `RECIPE_MONSTER_DATA=/some/folder` to keep it elsewhere, and `PORT=8080` to change the port. **Library → ⋯** has backup/restore (JSON) and demo-data controls.

> There's no login: anyone on your home network can open the app. Don't expose the port to the internet.

## Reading index pages: AI or on-phone OCR

| | How | Quality |
|---|---|---|
| **🤖 AI reading** (recommended) | Set `ANTHROPIC_API_KEY` before `npm start`. Photos go to Claude's vision model. | Handles multi-column layouts, ingredient headings with sub-entries ("Chicken → – and leek pie 45"), wrapped lines and V/GF/DF markers well. |
| **📱 On-device OCR** (default, free) | Tesseract.js runs in the phone's browser, then a heuristic parser on the server turns the text into recipes. | Good on clean single-column indexes; expect to fix a few lines on the review screen. |

Either way you always get a review screen to fix names and page numbers before anything is saved. The model can be changed with `RECIPE_MONSTER_MODEL` (default `claude-opus-5-5`). With an API key set, the scanner also offers **Photo of cover**, which reads the title, author and likely diet tags from the cover. That's handy for books without a barcode.

Tips: good light, one page per photo, book held flat, page filling the frame.

## Themes

Themes are built from chips:

- **Diet / theme tags** you give a book when you add it (*Slimming World*, *Fast 800*, *Batch cooking*...). Every recipe in the book inherits them.
- **Recipe tags**, guessed automatically from the name: main ingredient (chicken, fish, pulses...), dish (curry, pasta, soup, pie...), course (breakfast, dessert, sides...) and cuisine. Edit any recipe to change its tags.
- **Authors**, **books**, **free text** and **❤️ favourites**.

Chips of the same kind mean *either* (Fast 800 **or** Slimming World); different kinds mean *both* (Fast 800 **and** by Dr Michael Mosley). Click a chip to flip it to **not** (e.g. *not fish*). Save combinations you like as theme tiles.

The planner fits recipes to meals (breakfast slots only get breakfast recipes, lunches lean towards soups and salads), avoids repeats and back-to-back main ingredients or cuisines, prefers favourites and higher ratings, and skips what you've cooked in the last fortnight (tick ✅ on a card when you cook it). **Fewer books off the shelf** clusters the week into fewer books.

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
