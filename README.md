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

## Previewing locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Opening `index.html` directly from the file system also works, because the data is loaded as a script rather than fetched.
