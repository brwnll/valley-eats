/* Site configuration. The Google Maps Platform key here is a browser key: it is meant to be public,
   so restrict it in Google Cloud to this site's address (Websites restriction) and to Places API (New) only. */
window.SITE_URL = "https://brwnll.github.io/valley-eats/";
window.PLACES_API_KEY = "AIzaSyBtROLZPmY4zUHYt3ILXWblWYVmHX_WJnE";

/* Dish Match two-phone games sync through this Firebase Realtime Database. Its security rules
   (database.rules.json) only allow small game records under games/<random id>, which can't be listed. */
window.MATCH_DB_URL = "https://valley-eats-514412-default-rtdb.firebaseio.com";
