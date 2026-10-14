const express = require("express");
const axios = require("axios");
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

  return res.json({
    status: true,
    anime_id: animeId,
    season,
    episode: episodeNumber,
    title: episode.title || ("Episode " + episodeNumber),
    watch_url: episode.source_url,
    playback: "external_watch_page"
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

// HLS proxy
app.get("/api/hls-proxy", async (req, res) => {
  try {
    const target = req.query.url;

    if (!target) {
      return res.status(400).send("Missing url");
    }

    const targetUrl = new URL(target);

    const allowedHosts = [
      "ravok.buzz",
      "as-cdn27.top",
      "as-cdn28.top",
      "as-cdn29.top",
      "as-cdn30.top"
    ];

    if (!allowedHosts.includes(targetUrl.hostname)) {
      return res.status(403).send("Host not allowed");
    }

    const response = await axios.get(targetUrl.toString(), {
      responseType: "arraybuffer",
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).send(
        Buffer.from(response.data)
      );
    }

    const contentType =
      String(response.headers["content-type"] || "").toLowerCase();

    const isPlaylist =
      targetUrl.pathname.endsWith(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("mpegurl");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");

    if (isPlaylist) {
      let playlist =
        Buffer.from(response.data).toString("utf8");

      const proxyUrl = (url) =>
        "/api/hls-proxy?url=" +
        encodeURIComponent(url);

      const lines = playlist.split(/\r?\n/);

      const rewritten = lines.map(line => {
        const trimmed = line.trim();

        if (!trimmed) {
          return line;
        }

        if (trimmed.startsWith("#")) {
          return line.replace(
            /URI="([^"]+)"/g,
            (match, uri) => {
              try {
                const absolute =
                  new URL(uri, targetUrl).toString();

                return 'URI="' +
                  proxyUrl(absolute) +
                  '"';
              } catch {
                return match;
              }
            }
          );
        }

        try {
          const absolute =
            new URL(trimmed, targetUrl).toString();

          return proxyUrl(absolute);
        } catch {
          return line;
        }
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.apple.mpegurl"
      );

      return res.send(rewritten.join("\n"));
    }

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] ||
      "application/octet-stream"
    );

    return res.send(Buffer.from(response.data));

  } catch (error) {
    console.error("HLS proxy error:", error.message);

    return res.status(502).send(
      "HLS proxy error: " + error.message
    );
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

  // Start sync in the background so the API
  // can become available immediately.
  runAutoSync();

  // Continue checking for new anime/episodes/movies.
  setInterval(
    runAutoSync,
    SYNC_INTERVAL_MS
  );

  console.log(
    `[AUTO SYNC] Interval: ${SYNC_INTERVAL_MS / 60000} minutes`
  );
});
