# Valley Eats Today

A single-page site listing the restaurants in North Bend and Snoqualmie, Washington that are open on the day you visit, ordered by popularity, with each one's five most popular dishes and a picture of each. There is no build step and no backend: `index.html`, `styles.css`, `app.js`, `data.js`, and the `img/dishes` folder are everything.

## How it works

- `data.js` holds the restaurant list. Each entry has hours for every day of the week, a short description, Google and Yelp review counts, and up to five popular dishes with a photo each.
- `app.js` works out the current day in Pacific time, shows the places open that day, and adds an "Open now" badge when the current time falls inside a listing's hours. The day picker lets a visitor peek at other days (`?day=sat` in the URL does the same). Restaurants are ordered by total review count; the "A to Z" toggle (or `?sort=name`) switches to alphabetical.
- `img/dishes/` holds one small square photo per kind of dish (burger, pho, cinnamon roll, and so on). They are openly licensed photos from Wikimedia Commons chosen to represent each dish type, not photos taken at the restaurants. `credits.html` lists every photo's source and license, generated from `img/dishes/credits.json`.
- Everything runs in the visitor's browser, so the page can be served from any static host.

## Publishing on GitHub Pages

1. Create a new repository on GitHub (for example `valley-eats`) and push these files to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick `main` and the `/ (root)` folder, then save.
4. After a minute or two the site is live at `https://<your-username>.github.io/<repository-name>/`.

The `.nojekyll` file tells GitHub Pages to serve the files exactly as they are.

## Editing the restaurant list

Open `data.js`. Each restaurant looks like this:

```js
{
  "name": "Twede's Cafe",
  "town": "North Bend",            // "North Bend" or "Snoqualmie"
  "cuisine": "American diner",
  "address": "137 W North Bend Way, North Bend, WA 98045",
  "phone": "(425) 831-5511",
  "website": "https://twedescafe.com",
  "price": "$$",                   // "$", "$$", "$$$", or "$$$$"
  "chain": false,                  // true hides it when "Hide chains" is ticked
  "description": "One sentence about the place.",
  "hours": {
    "mon": [["06:30", "20:00"]],   // 24-hour times; several ranges allowed for split shifts
    "tue": [["06:30", "20:00"]],
    "wed": null,                   // null means closed that day
    "thu": [["06:30", "20:00"]],
    "fri": [["06:30", "21:00"]],
    "sat": [["06:30", "21:00"]],
    "sun": [["07:00", "15:00"]]
  },
  "hoursConfidence": "high",       // "low" shows an "Hours unverified" badge
  "googleRating": 4.4,             // shown on the card; either source may be null
  "googleReviews": 3266,
  "yelpRating": null,
  "yelpReviews": 731,
  "popularity": 3997,              // googleReviews + yelpReviews; drives the default sort order
  "dishes": [
    { "name": "Cherry Pie", "image": "img/dishes/cherry-pie.jpg" },
    { "name": "Twin Peaks Burger", "image": "img/dishes/hamburger.jpg" },
    { "name": "Chicken Fried Steak", "image": "img/dishes/chicken-fried-steak.jpg" },
    { "name": "Biscuits & Gravy", "image": "img/dishes/biscuits-gravy.jpg" },
    { "name": "Milkshake" }        // a dish with no image shows a blank tile; a plain string works too
  ]
}
```

To use a real photo for a dish, drop the file in `img/dishes/` and point that dish's `image` at it. Square images around 320px look best. If you add a photo you did not take yourself, add its source and license to `credits.html`.

A closing time earlier than the opening time (for example `["16:00", "01:00"]`) is read as running past midnight. Update the `updated` date in `RESTAURANTS_META` at the top of the file when you make changes so the footer stays honest.

## Dish Match

`play.html` turns the list into a game for two. Each person swipes the same stack of dishes from restaurants open on the day they pick; when both like a dish from the same restaurant (not necessarily the same dish), that restaurant is a match. The results screen ranks the matches and shows hours, links, and what each person liked.

- **One phone:** players take turns and pass the phone. Matches pop up during the second turn.
- **Two phones (live):** the first player sends a link and both swipe at the same time, each on their own phone. Each phone shows how far along the partner is, and a match pops up on both phones as soon as both have liked the same restaurant. Either player can start another round, and the other phone offers to join it.

Both players get the same stack because it is built from the same day, filters, and random seed. Games in progress are also saved in the browser on each device (`localStorage`), so a reload picks up where it left off. The game code is in `play.js` and `play.css`, and it reads the same `data.js` as the list.

**How the live sync works.** Two-phone games live in a Firebase Realtime Database (`MATCH_DB_URL` in `config.js`, in the Google Cloud project "Valley Eats", free Spark plan with no billing). Each game is a small record at `games/<random 20-character id>` holding the day, filters, seed, and for each player a first name, progress, and the ids of liked dishes. Each phone writes only its own player record over the database's REST API and listens to the whole game through a server-sent event stream, so there is no SDK to load. The security rules in `database.rules.json` (paste them into Firebase console → Realtime Database → Rules if you change them) allow reading a game only by its id, creating a game once, and updating only the two player records within strict size and shape limits. Nothing can be listed, and games can't be deleted or rewritten. On the free plan the worst case is that the database hits its limits and live sync stops; it can't run up a bill.

If the database can't be reached when a game starts, two-phone mode falls back to the older link game: the first player swipes and sends a link carrying their likes after the `#`, the second player swipes afterwards, and can send a results link back.

## Restaurant photos from Google

Each card can show a photo of the restaurant itself from Google Maps, through the Google Places API. This is optional; without it the cards simply have no header photo.

**How it works.** Google's terms let a site store place IDs but nothing else from the Places API, not photos and not photo references. So `places.js` holds one Google place ID per restaurant, and the visitor's browser asks Google for the current photo when a card scrolls into view. Photos are kept only for that page view. If Google returns nothing three times in a row, the page stops asking until it is reloaded.

**The pieces.**

- `config.js` holds the site address and a Google Maps browser key (`PLACES_API_KEY`). A static site has no server to hide a key on, so the key is visible to every visitor; what protects it is restricting it in Google Cloud to this site's address (Websites restriction) and to Places API (New) only. Requests from any other site are then refused.
- `scripts/fetch_places.py` finds each restaurant's place ID by name and address and writes `places.js`. It skips restaurants that already have an ID, drops matches at a different street number, and prints anything worth a second look. To fix a wrong match, edit that entry's `placeId` in `places.js`, or delete the entry.
- `.github/workflows/refresh-places.yml` runs that script when `data.js` changes and once a week, so new restaurants pick up a place ID on their own.

**Billing is required for photos.** A Google Cloud project with no billing account still answers place lookups (with a cap of 100 searches a day), but Google leaves the photos out of every response. To turn photos on, link an active billing account to the project under Billing in Google Cloud Console. Nothing on the site needs to change afterwards.

**What it costs.** As of November 2026, per Google's [pricing table](https://developers.google.com/maps/billing-and-pricing/pricing):

| Request | When it happens | Price |
| --- | --- | --- |
| Place lookup (IDs only) | once per card that comes into view | free, unlimited |
| Place photo | once per card that comes into view and has a photo | first 1,000 a month free, then $7 per 1,000 |
| Text search | once per restaurant when `fetch_places.py` looks it up | first 5,000 a month free |

A visitor who scrolls the whole list loads about 90 photos, so the free allowance covers roughly eleven full scrolls a month. To keep the bill bounded, set a daily cap on photo requests under Google Maps Platform → Quotas → Places API (New). A cap of 32 a day stays inside the free allowance; visitors past the cap just see cards without photos until the next day.

**Attribution.** Google requires its logo and the photographer's name next to each photo, which the caption on every photo provides, plus the terms and privacy page linked in the footer.

To use your own photo of a restaurant instead, add this to that restaurant in `data.js`:

```js
"photo": { "url": "img/places/twedes.jpg", "credit": "Photo: your name" }
```

## Previewing locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Opening `index.html` directly from the file system also works, because the data is loaded as a script rather than fetched.
