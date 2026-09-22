const axios = require("axios");
const cheerio = require("cheerio");
const { loadDB, saveDB } = require("./database");

const BASE = "https://animesalt.cx";

const CATEGORY_SEEDS = [
  "/category/type/anime/?type=series",
  "/category/type/cartoon/?type=series",
  "/category/type/anime/?type=movies",
  "/category/type/cartoon/?type=movies",
  "/category/status/ongoing/",
  "/category/network/netflix/",
  "/category/network/disney-channel/",
  "/category/network/hungama-tv/",
  "/category/network/sony-yay/",
  "/category/network/cartoon-network/",
  "/category/network/prime-video/",
  "/category/network/disney/",
  "/category/network/crunchyroll/"
];

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 " +
  "Chrome/140.0 Mobile Safari/537.36";

const REQUEST_TIMEOUT = 20000;
const RETRIES = 3;
const DELAY_MS = 500;
const SERIES_CONCURRENCY = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHTML(url) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: {
          "User-Agent": USER_AGENT
        }
      });

      return response.data;
    } catch (error) {
      lastError = error;

      console.log(
        `   Request failed (${attempt}/${RETRIES}): ${error.message}`
      );

      if (attempt < RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

function cleanUrl(href) {
  try {
    const u = new URL(href, BASE);

    if (u.hostname !== "animesalt.cx") {
      return null;
    }

    u.hash = "";

    return u.href;
  } catch {
    return null;
  }
}

function getSlugFromPath(pathname, type) {
  const regex =
    type === "series"
      ? /^\/series\/([^/]+)\/?$/i
      : /^\/movies\/([^/]+)\/?$/i;

  const match = pathname.match(regex);

  return match ? match[1] : null;
}

function extractCatalog(html, seriesMap, movieMap) {
  const $ = cheerio.load(html);

  $("a[href]").each((i, el) => {
    const href = cleanUrl($(el).attr("href"));

    if (!href) return;

    const u = new URL(href);

    const seriesSlug =
      getSlugFromPath(u.pathname, "series");

    const movieSlug =
      getSlugFromPath(u.pathname, "movies");

    if (seriesSlug) {
      seriesMap.set(seriesSlug, href);
    }

    if (movieSlug) {
      movieMap.set(movieSlug, href);
    }
  });

  return $;
}

function extractPagination(html, currentUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $("a[href]").each((i, el) => {
    const href = cleanUrl($(el).attr("href"));

    if (!href) return;

    const u = new URL(href);
    const current = new URL(currentUrl);

    if (u.origin !== current.origin) return;

    if (
      u.pathname.includes("/page/") &&
      u.pathname.startsWith("/category/")
    ) {
      urls.add(u.href);
    }
  });

  return [...urls];
}

async function discoverCatalog() {
  const visited = new Set();
  const queue = CATEGORY_SEEDS.map(
    seed => new URL(seed, BASE).href
  );

  const series = new Map();
  const movies = new Map();

  while (queue.length) {
    const url = queue.shift();

    if (visited.has(url)) {
      continue;
    }

    visited.add(url);

    console.log(
      `[CATALOG ${visited.size}] ${url}`
    );

    try {
      const html = await fetchHTML(url);

      extractCatalog(
        html,
        series,
        movies
      );

      const pagination =
        extractPagination(html, url);

      for (const next of pagination) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }

      console.log(
        `   Series=${series.size} Movies=${movies.size} Queue=${queue.length}`
      );

    } catch (error) {
      console.log(
        `   FAILED: ${error.message}`
      );
    }
  }

  return {
    series,
    movies,
    pages: visited.size
  };
}

function parseSeriesPage(html, url, slug) {
  const $ = cheerio.load(html);

  const title =
    $(".entry-title").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim();

  const poster =
    $("img[data-src]")
      .map((i, el) => $(el).attr("data-src"))
      .get()
      .map(src => {
        if (src && src.startsWith("//")) {
          return "https:" + src;
        }
        return src;
      })
      .find(src =>
        src &&
        /^https?:\/\//i.test(src) &&
        /image\.tmdb\.org/i.test(src)
      ) ||
    $("meta[property='og:image']").attr("content") ||
    "";

  const description =
    $("meta[property='og:description']").attr("content") ||
    $(".description").first().text().trim() ||
    $(".entry-content").first().text().trim() ||
    "";

  let postId = null;

  $(".season-btn[data-post]").each((i, el) => {
    if (!postId) {
      postId = $(el).attr("data-post");
    }
  });

  const seasons = new Set();

  $(".season-btn[data-season]").each((i, el) => {
    const season = $(el).attr("data-season");

    if (season) {
      seasons.add(Number(season));
    }
  });

  $("a[data-season]").each((i, el) => {
    const season = $(el).attr("data-season");

    if (season) {
      seasons.add(Number(season));
    }
  });

  $("option[value]").each((i, el) => {
    const value = $(el).attr("value");

    if (/^\d+$/.test(value || "")) {
      seasons.add(Number(value));
    }
  });

  return {
    id: slug,
    source_id: slug,
    title: title || slug,
    poster,
    description,
    source_url: url,
    post_id: postId,
    seasons: [...seasons].filter(
      Number.isFinite
    ).sort((a, b) => a - b)
  };
}

function parseEpisodes(html, animeId, season) {
  const $ = cheerio.load(html);
  const episodes = [];

  $("a[href]").each((i, el) => {
    const href = $(el).attr("href");

    if (!href) return;

    const match = href.match(
      /\/episode\/([^/]+)-(\d+)x(\d+)\/?/i
    );

    if (!match) return;

    const sourceId = match[1];
    const episodeSeason = Number(match[2]);
    const episodeNumber = Number(match[3]);

    if (episodeSeason !== Number(season)) {
      return;
    }

    const title =
      $(el).text().replace(/\s+/g, " ").trim();

    episodes.push({
      anime_id: animeId,
      source_id:
        `${sourceId}-${episodeSeason}x${episodeNumber}`,
      season: episodeSeason,
      episode_number: episodeNumber,
      title,
      source_url: cleanUrl(href)
    });
  });

  const unique = new Map();

  for (const ep of episodes) {
    unique.set(
      `${ep.season}:${ep.episode_number}`,
      ep
    );
  }

  return [...unique.values()].sort(
    (a, b) =>
      a.season - b.season ||
      a.episode_number - b.episode_number
  );
}

async function fetchSeasonEpisodes(
  anime,
  season
) {
  if (!anime.post_id) {
    return [];
  }

  const url =
    `${BASE}/wp-admin/admin-ajax.php` +
    `?action=action_select_season` +
    `&season=${encodeURIComponent(season)}` +
    `&post=${encodeURIComponent(anime.post_id)}`;

  try {
    const html = await fetchHTML(url);

    return parseEpisodes(
      html,
      anime.id,
      season
    );
  } catch (error) {
    console.log(
      `   Season ${season} failed: ${error.message}`
    );

    return [];
  }
}

function parseMoviePage(html, url, slug) {
  const $ = cheerio.load(html);

  const title =
    $(".entry-title").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim();

  const poster =
    $("meta[property='og:image']").attr("content") ||
    $(".cover img").first().attr("src") ||
    $(".poster img").first().attr("src") ||
    $("img").first().attr("src") ||
    "";

  const description =
    $("meta[property='og:description']").attr("content") ||
    $(".description").first().text().trim() ||
    $(".entry-content").first().text().trim() ||
    "";

  const iframe = $("iframe").first();

  const iframeUrl =
    iframe.attr("src") ||
    iframe.attr("data-src") ||
    "";

  let playerHash = null;

  if (iframeUrl) {
    const match =
      iframeUrl.match(
        /\/video\/([^/?#]+)/i
      );

    if (match) {
      playerHash = match[1];
    }
  }

  return {
    id: slug,
    source_id: slug,
    title: title || slug,
    poster,
    description,
    source_url: url,
    player_url: iframeUrl,
    player_hash: playerHash
  };
}

async function syncSeries(
  db,
  slug,
  url,
  indexes
) {
  try {
    console.log(`\n[SERIES] ${slug}`);

    const html = await fetchHTML(url);

    const parsed =
      parseSeriesPage(
        html,
        url,
        slug
      );

    const existingIndex =
      indexes.anime.get(slug);

    const animeRecord = {
      id: parsed.id,
      source_id: parsed.source_id,
      title: parsed.title,
      poster: parsed.poster,
      description: parsed.description,
      source_url: parsed.source_url,
      updated_at: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      db.anime[existingIndex] = {
        ...db.anime[existingIndex],
        ...animeRecord
      };
    } else {
      db.anime.push(animeRecord);
      indexes.anime.set(slug, db.anime.length - 1);
    }

    let seasons = parsed.seasons;

    if (!seasons.length) {
      seasons = [1];
    }

    console.log(
      `   Seasons: ${seasons.join(", ")}`
    );

    let totalEpisodes = 0;

    for (const season of seasons) {
      const episodes =
        await fetchSeasonEpisodes(
          parsed,
          season
        );

      for (const episode of episodes) {
        const episodeKey =
          parsed.id +
          "|" +
          Number(episode.season) +
          "|" +
          Number(episode.episode_number);

        const index =
          indexes.episodes.get(episodeKey);

        const record = {
          ...episode,
          updated_at:
            new Date().toISOString()
        };

        if (index >= 0) {
          db.episodes[index] = {
            ...db.episodes[index],
            ...record
          };
        } else {
          db.episodes.push(record);
          indexes.episodes.set(
            episodeKey,
            db.episodes.length - 1
          );
        }
      }

      totalEpisodes += episodes.length;

      await sleep(DELAY_MS);
    }

    console.log(
      `   Episodes synced: ${totalEpisodes}`
    );

    return true;

  } catch (error) {
    console.log(
      `   SERIES FAILED: ${error.message}`
    );

    return false;
  }
}

async function syncMovie(
  db,
  slug,
  url,
  indexes
) {
  try {
    console.log(`\n[MOVIE] ${slug}`);

    const html = await fetchHTML(url);

    const movie =
      parseMoviePage(
        html,
        url,
        slug
      );

    const record = {
      ...movie,
      updated_at:
        new Date().toISOString()
    };

    const index =
      indexes.movies.get(slug);

    if (index >= 0) {
      db.movies[index] = {
        ...db.movies[index],
        ...record
      };
    } else {
      db.movies.push(record);
      indexes.movies.set(slug, db.movies.length - 1);
    }

    console.log(
      `   Player hash: ${movie.player_hash || "none"}`
    );

    return true;

  } catch (error) {
    console.log(
      `   MOVIE FAILED: ${error.message}`
    );

    return false;
  }
}

async function runPool(
  items,
  worker,
  concurrency
) {
  let index = 0;

  async function runner() {
    while (true) {
      const current =
        index++;

      if (current >= items.length) {
        return;
      }

      await worker(items[current]);
    }
  }

  const workers = [];

  for (
    let i = 0;
    i < Math.min(concurrency, items.length);
    i++
  ) {
    workers.push(runner());
  }

  await Promise.all(workers);
}

async function syncAll() {
  console.log("\n==========================================");
  console.log("FULL ANIME SALT SYNC");
  console.log("==========================================");

  const db = loadDB();

  if (!Array.isArray(db.movies)) {
    db.movies = [];
  }

  const indexes = {
    anime: new Map(
      db.anime.map((item, index) => [
        item.id,
        index
      ])
    ),

    episodes: new Map(
      db.episodes.map((item, index) => [
        item.anime_id +
          "|" +
          Number(item.season) +
          "|" +
          Number(item.episode_number),
        index
      ])
    ),

    movies: new Map(
      db.movies.map((item, index) => [
        item.id,
        index
      ])
    )
  };

  console.log(
    `Indexes ready: anime=${indexes.anime.size}, episodes=${indexes.episodes.size}, movies=${indexes.movies.size}`
  );

  const catalog =
    await discoverCatalog();

  console.log("\n==========================================");
  console.log("CATALOG DISCOVERED");
  console.log("==========================================");

  console.log(
    "Archive pages:",
    catalog.pages
  );

  console.log(
    "Series:",
    catalog.series.size
  );

  console.log(
    "Movies:",
    catalog.movies.size
  );

  console.log(
    "Total:",
    catalog.series.size +
      catalog.movies.size
  );

  let seriesOK = 0;
  let seriesFailed = 0;

  console.log("\n==========================================");
  console.log("SYNCING SERIES");
  console.log("==========================================");

  await runPool(
    [...catalog.series.entries()],
    async ([slug, url]) => {
      const ok =
        await syncSeries(
          db,
          slug,
          url,
          indexes
        );

      if (ok) {
        seriesOK++;
      } else {
        seriesFailed++;
      }

    },
    SERIES_CONCURRENCY
  );

  let moviesOK = 0;
  let moviesFailed = 0;

  console.log("\n==========================================");
  console.log("SYNCING MOVIES");
  console.log("==========================================");

  await runPool(
    [...catalog.movies.entries()],
    async ([slug, url]) => {
      const ok =
        await syncMovie(
          db,
          slug,
          url,
          indexes
        );

      if (ok) {
        moviesOK++;
      } else {
        moviesFailed++;
      }

    },
    SERIES_CONCURRENCY
  );

  saveDB(db);

  console.log("\n==========================================");
  console.log("SYNC COMPLETE");
  console.log("==========================================");

  console.log(
    "Discovered series:",
    catalog.series.size
  );

  console.log(
    "Series synced:",
    seriesOK
  );

  console.log(
    "Series failed:",
    seriesFailed
  );

  console.log(
    "Discovered movies:",
    catalog.movies.size
  );

  console.log(
    "Movies synced:",
    moviesOK
  );

  console.log(
    "Movies failed:",
    moviesFailed
  );

  console.log(
    "Database anime:",
    db.anime.length
  );

  console.log(
    "Database episodes:",
    db.episodes.length
  );

  console.log(
    "Database movies:",
    db.movies.length
  );

  console.log("==========================================");
}

if (require.main === module) {
  syncAll()
    .then(() => {
      console.log("\nSync process finished.");
    })
    .catch(error => {
      console.error(
        "\nFATAL SYNC ERROR:",
        error
      );

      process.exitCode = 1;
    });
}

module.exports = {
  syncAll,
  discoverCatalog
};
