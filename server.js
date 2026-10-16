const express = require("express");
const cors = require("cors");
const { loadDB } = require("./database");
const { syncAll } = require("./sync-anime");
const { incrementalSync } = require("./fast-sync");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.json({
    status: true,
    message: "Anime API is running"
  });
});

// All anime
app.get("/api/anime", (req, res) => {
  const db = loadDB();

  res.json({
    status: true,
    total: db.anime.length,
    data: db.anime
  });
});

// Single anime + all episodes
app.get("/api/anime/:id", (req, res) => {
  const db = loadDB();

  const anime = db.anime.find(
    item => String(item.id) === String(req.params.id)
  );

  if (!anime) {
    return res.status(404).json({
      status: false,
      message: "Anime not found"
    });
  }

  const episodes = db.episodes
    .filter(
      episode => String(episode.anime_id) === String(anime.id)
    )
    .sort((a, b) => {
      if (a.season !== b.season) {
        return a.season - b.season;
      }

      return a.episode_number - b.episode_number;
    });

  res.json({
    status: true,
    data: {
      ...anime,
      episodes
    }
  });
});

// Episodes + season filter + pagination
app.get("/api/anime/:id/episodes", (req, res) => {
  const db = loadDB();

  const anime = db.anime.find(
    item => String(item.id) === String(req.params.id)
  );

  if (!anime) {
    return res.status(404).json({
      status: false,
      message: "Anime not found"
    });
  }

  let episodes = db.episodes.filter(
    episode => String(episode.anime_id) === String(anime.id)
  );

  // Season filter
  if (req.query.season !== undefined) {
    const season = Number(req.query.season);

    if (!Number.isInteger(season) || season < 1) {
      return res.status(400).json({
        status: false,
        message: "Invalid season number"
      });
    }

    episodes = episodes.filter(
      episode => Number(episode.season) === season
    );
  }

  // Sort
  episodes.sort((a, b) => {
    if (a.season !== b.season) {
      return a.season - b.season;
    }

    return a.episode_number - b.episode_number;
  });

  // Pagination
  const page = Math.max(
    1,
    Number.parseInt(req.query.page, 10) || 1
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number.parseInt(req.query.limit, 10) || 50
    )
  );

  const total = episodes.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;

  const paginatedEpisodes = episodes.slice(
    start,
    start + limit
  );

  res.json({
    status: true,
    anime_id: anime.id,
    anime_title: anime.title,

    filter: {
      season:
        req.query.season !== undefined
          ? Number(req.query.season)
          : "all"
    },

    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_previous: page > 1
    },

    data: paginatedEpisodes
  });
});

// Season list with episode counts
app.get("/api/anime/:id/seasons", (req, res) => {
  const db = loadDB();

  const anime = db.anime.find(
    item => String(item.id) === String(req.params.id)
  );

  if (!anime) {
    return res.status(404).json({
      status: false,
      message: "Anime not found"
    });
  }

  const animeEpisodes = db.episodes.filter(
    episode => String(episode.anime_id) === String(anime.id)
  );

  const seasonMap = {};

  for (const episode of animeEpisodes) {
    const season = Number(episode.season);

    if (!seasonMap[season]) {
      seasonMap[season] = {
        season,
        episode_count: 0,
        episodes: []
      };
    }

    seasonMap[season].episode_count++;

    seasonMap[season].episodes.push({
      episode_number: episode.episode_number,
      title: episode.title,
      source_url: episode.source_url
    });
  }

  const seasons = Object.values(seasonMap)
    .sort((a, b) => a.season - b.season);

  res.json({
    status: true,
    anime_id: anime.id,
    anime_title: anime.title,
    total_seasons: seasons.length,
    data: seasons
  });
});


// DesiDubAnime episode playback is hosted on its own watch page.
// Return the official watch-page URL; do not attempt to extract or proxy protected player media.
app.get("/api/anime/:id/episode/:season/:episode/stream", (req, res) => {
  const db = loadDB();
  const animeId = String(req.params.id);
  const season = Number(req.params.season);
  const episodeNumber = Number(req.params.episode);

  if (!Number.isInteger(season) || season < 1 ||
      !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    return res.status(400).json({
      status: false,
      message: "Invalid season or episode number"
    });
  }

  const episode = db.episodes.find(item =>
    String(item.anime_id) === animeId &&
    Number(item.season) === season &&
    Number(item.episode_number) === episodeNumber
  );

  if (!episode) {
    return res.status(404).json({ status: false, message: "Episode not found" });
  }

  // Play a direct HLS URL only when the catalog entry itself is an .m3u8 URL.
  // Otherwise, send users to the source's own watch page.
  let directHlsUrl = null;
  try {
    const sourceUrl = new URL(episode.source_url);
    if (sourceUrl.protocol === "https:" && /\.m3u8$/i.test(sourceUrl.pathname)) {
      directHlsUrl = sourceUrl.href;
    }
  } catch {}

  return res.json({
    status: true,
    anime_id: animeId,
    season,
    episode: episodeNumber,
    title: episode.title || ("Episode " + episodeNumber),
    ...(directHlsUrl
      ? { video_url: directHlsUrl, playback: "direct_hls" }
      : { watch_url: episode.source_url, playback: "external_watch_page" })
  });
});

// Search the DesiDubAnime-backed catalog.
app.get("/api/search", (req, res) => {
  const db = loadDB();
  const query = String(req.query.q || req.query.query || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));

  if (!query) {
    return res.status(400).json({
      status: false,
      message: "Search query is required. Use ?q=naruto"
    });
  }

  const series = db.anime
    .filter(item => [item.title, item.description, item.id].some(value =>
      String(value || "").toLowerCase().includes(query)
    ))
    .map(item => ({ ...item, content_type: "series" }));

  const movies = db.movies
    .filter(item => [item.title, item.description, item.id].some(value =>
      String(value || "").toLowerCase().includes(query)
    ))
    .map(item => ({ ...item, content_type: "movie" }));

  const data = [...series, ...movies].slice(0, limit);
  return res.json({
    status: true,
    query,
    total: series.length + movies.length,
    data
  });
});

// ==================== UNIFIED CATALOG API ====================

// Series + Movies together
app.get("/api/catalog", (req, res) => {
  const db = loadDB();

  const series = db.anime.map(item => ({
    ...item,
    content_type: "series"
  }));

  const movies = db.movies.map(item => ({
    ...item,
    content_type: "movie"
  }));

  const data = [...series, ...movies];

  res.json({
    status: true,
    total: data.length,
    series_total: series.length,
    movies_total: movies.length,
    data
  });
});

// ==================== MOVIE APIs ====================

// All movies
app.get("/api/movies", (req, res) => {
  const db = loadDB();

  res.json({
    status: true,
    total: db.movies.length,
    data: db.movies
  });
});

// Single movie
app.get("/api/movies/:id", (req, res) => {
  const db = loadDB();

  const movie = db.movies.find(
    item => String(item.id) === String(req.params.id)
  );

  if (!movie) {
    return res.status(404).json({
      status: false,
      message: "Movie not found"
    });
  }

  res.json({
    status: true,
    data: movie
  });
});

// Return the official DesiDubAnime movie/watch page rather than extracting protected media.
app.get("/api/movies/:id/stream", (req, res) => {
  const db = loadDB();
  const movie = db.movies.find(item => String(item.id) === String(req.params.id));

  if (!movie) {
    return res.status(404).json({ status: false, message: "Movie not found" });
  }

  return res.json({
    status: true,
    movie_id: movie.id,
    title: movie.title,
    watch_url: movie.watch_url || movie.source_url,
    playback: "external_watch_page"
  });
});

// HLS proxy for DIRECT, authorized media URLs only.
// Configure exact CDN hostnames in HLS_ALLOWED_HOSTS (comma-separated).
// This intentionally does not scrape/extract media from third-party watch pages.
function getAllowedHlsHosts() {
  return String(process.env.HLS_ALLOWED_HOSTS || "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
}

function getAllowedHlsUrl(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  const allowedHosts = getAllowedHlsHosts();
  if (target.protocol !== "https:" ||
      target.username || target.password ||
      !allowedHosts.includes(target.hostname.toLowerCase())) {
    return null;
  }
  return target;
}

function proxiedHlsUrl(targetUrl) {
  return "/api/hls-proxy?url=" + encodeURIComponent(targetUrl.href);
}

app.get("/api/hls-proxy", async (req, res) => {
  const target = getAllowedHlsUrl(String(req.query.url || ""));
  if (!target) {
    return res.status(403).json({
      status: false,
      message: "HLS source host is not allowed. Configure HLS_ALLOWED_HOSTS with the authorized media CDN hostname."
    });
  }

  const isManifest = /\.m3u8$/i.test(target.pathname);
  try {
    const upstream = await axios.get(target.href, {
      responseType: isManifest ? "text" : "stream",
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 300,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": isManifest ? "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*" : "*/*",
        ...(req.headers.range ? { Range: req.headers.range } : {})
      }
    });

    if (isManifest) {
      let body = typeof upstream.data === "string"
        ? upstream.data
        : String(upstream.data || "");
      if (!body.trimStart().startsWith("#EXTM3U")) {
        return res.status(502).json({
          status: false,
          message: "Configured HLS URL did not return an HLS playlist."
        });
      }

      const rewriteUri = raw => {
        const value = String(raw || "").trim();
        if (!value || value.startsWith("data:")) return raw;
        try {
          const child = new URL(value, target.href);
          if (!getAllowedHlsHosts().includes(child.hostname.toLowerCase()) ||
              child.protocol !== "https:") return raw;
          // Some authorized HLS providers use a shared query token on relative segments.
          if (!/^[a-z][a-z0-9+.-]*:/i.test(value) &&
              !value.startsWith("//") &&
              !child.search &&
              target.search) {
            child.search = target.search;
          }
          return proxiedHlsUrl(child);
        } catch {
          return raw;
        }
      };

      body = body
        .replace(/URI="([^"]+)"/g, (match, uri) => {
          const rewritten = rewriteUri(uri);
          return rewritten === uri ? match : 'URI="' + rewritten + '"';
        })
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return line;
          return rewriteUri(trimmed);
        })
        .join("\n");

      res.status(upstream.status);
      res.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.send(body);
    }

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      if (upstream.headers[header]) res.set(header, upstream.headers[header]);
    }
    res.set("Cache-Control", "no-store");
    if (upstream.status === 206) res.status(206);
    upstream.data.on("error", error => {
      console.error("[HLS PROXY] upstream stream error:", error.message);
      if (!res.headersSent) res.status(502);
      res.end();
    });
    return upstream.data.pipe(res);
  } catch (error) {
    console.warn("[HLS PROXY] request failed:", error.message);
    return res.status(502).json({
      status: false,
      message: "Authorized HLS source could not be fetched. Check the URL, CDN allowlist, and upstream CORS/access requirements."
    });
  }
});

// ==========================================
// AUTO SYNC SCHEDULER
// ==========================================

let syncRunning = false;

const SYNC_INTERVAL_MS =
  Number(process.env.SYNC_INTERVAL_MS) ||
  30 * 60 * 1000; // 30 minutes

async function runAutoSync() {
  if (syncRunning) {
    console.log(
      "[AUTO SYNC] Previous sync is still running. Skipping."
    );
    return;
  }

  syncRunning = true;

  try {
    const db = loadDB();

    const hasData =
      db.anime.length > 0 ||
      db.episodes.length > 0 ||
      db.movies.length > 0;

    if (!hasData) {
      console.log(
        "\n[AUTO SYNC] Database is empty. Starting FULL sync..."
      );

      await syncAll();

      console.log(
        "[AUTO SYNC] Initial FULL sync completed."
      );
    } else {
      console.log(
        "\n[AUTO SYNC] Database already has data. Starting FAST sync..."
      );

      await incrementalSync();

      console.log(
        "[AUTO SYNC] FAST sync completed."
      );
    }
  } catch (error) {
    console.error(
      "[AUTO SYNC] Sync failed:",
      error.message
    );
  } finally {
    syncRunning = false;
  }
}

// ==========================================
// SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Anime API running on http://localhost:${PORT}`
  );

  // Vercel functions are short-lived and read the bundled database.
  // Run sync locally and deploy the refreshed anime-db.json instead.
  if (process.env.VERCEL !== "1") {
    runAutoSync();
    setInterval(runAutoSync, SYNC_INTERVAL_MS);
    console.log(
      `[AUTO SYNC] Interval: ${SYNC_INTERVAL_MS / 60000} minutes`
    );
  } else {
    console.log("[AUTO SYNC] Disabled on Vercel; refresh anime-db.json locally before deploying.");
  }
});
