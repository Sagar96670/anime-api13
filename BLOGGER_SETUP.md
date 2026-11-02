# Blogger JSON catalog setup

This branch adds Blogger API v3 as the primary catalog store. The existing JSON database remains a fallback until Blogger credentials are configured. Existing public HTML files and player controls are not changed.

## 1. Create a Blogger blog

1. Create a public Blogger blog dedicated to API data.
2. In Blogger settings, keep the blog public so the API can read published posts.
3. Find the numeric Blog ID in Blogger settings or the Blogger dashboard URL.

The scraper stores one post per anime/movie. The post title is the anime title; the post body contains a JSON record inside a `<pre>` element. Posts use the labels `anime-api-v1` and `series` or `movie`. The API reads the public Blogger JSON Feed (`/feeds/posts/default?alt=json`) and uses Blogger API v3 OAuth for writes.

## 2. Enable Blogger API v3

1. Open Google Cloud Console and create/select a project.
2. Enable **Blogger API v3**.
3. Create an API key for reading published posts from the public blog.
4. Create an OAuth 2.0 Client ID (Web application or Desktop application).
5. Authorize the Google account that owns the Blogger blog with scope `https://www.googleapis.com/auth/blogger`.
6. Obtain a refresh token for that account. Keep the client secret and refresh token private.

A service account is not used here; writes are performed as the Blogger owner through OAuth 2.0.

## 3. Configure environment variables

Copy `.env.example` to `.env` for local testing and fill in:

- `BLOGGER_BLOG_ID`
- `BLOGGER_FEED_URL` (for example `https://your-blog.blogspot.com/feeds/posts/default?alt=json`)
- `BLOGGER_API_KEY` (optional fallback for reading through API v3)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `SYNC_SECRET`
- `CRON_SECRET`

Never commit `.env` or share OAuth secrets in chat. Add the same variables in Vercel Project Settings → Environment Variables, for Production and Preview only as needed.

## 4. First sync

Install dependencies and run the scraper locally:

```bash
npm install
npm run sync:full
```

The scraper first validates that it has found a meaningful catalog, writes the local JSON fallback, then inserts/updates Blogger posts. Existing Blogger posts are updated by the stable `type:id` key; unchanged posts are skipped.

Do not trigger the first full sync until Blogger OAuth and blog ID values are configured.

## 5. API endpoints

- `GET /api/v1/catalog` — combined anime + movie catalog.
- `GET /api/anime` — all series.
- `GET /api/anime/:id` — series details and all episodes.
- `GET /api/anime/:id/seasons` — seasons and episode counts.
- `GET /api/anime/:id/episodes?season=1&page=1&limit=30` — paginated episodes.
- `GET /api/movies` and `GET /api/movies/:id` — movie catalog/details.
- `GET /api/v1/health` — reports active storage mode.
- `POST /api/v1/sync` — manual sync; send `Authorization: Bearer <SYNC_SECRET>`.

When Blogger credentials are present, catalog endpoints read Blogger API v3 posts and use a short per-instance cache. Without Blogger feed/API credentials they continue to read the bundled/local JSON database, allowing safe migration and rollback.

## 6. Scheduled sync

Vercel Cron calls `GET /api/cron/sync` daily at 03:00 UTC. Set `CRON_SECRET` in Vercel; Vercel sends it as a Bearer token. Hobby Cron schedules are limited to once per day; more frequent schedules require a plan that supports them.

The scheduled endpoint runs the current full DesiDubAnime sync. If the source grows enough that a full run exceeds the Vercel function duration, move the scrape into bounded resumable batches rather than increasing the timeout blindly.

## 7. Playback and UI compatibility

No files under `public/` are changed by this feature. Existing episode/movie pages keep their current markup and player behavior. The API continues to expose the existing `/api/anime`, `/api/movies`, season, episode and stream routes.

## 8. Verify after deployment

1. Open `/api/v1/health`; expect `storage: "blogger-api-v3"` and `blogger_configured: true`.
2. Open `/api/v1/catalog`; verify totals and a few anime records.
3. Open an existing anime details, seasons and episodes endpoint.
4. Test the player page without changing its UI.
5. Test sync with a protected POST request only after the first Blogger read succeeds.
