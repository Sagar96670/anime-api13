const axios = require("axios");
const cheerio = require("cheerio");
const { loadDB, saveDB } = require("./database");

const BASE = "https://www.desidubanime.me";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
const TIMEOUT = 20000;
const DELAY_MS = 250;
const CONCURRENCY = 3;
const CATALOG_SEEDS = [
  "/",
  "/anime/",
  "/az-list/",
  "/anime-type/tv/",
  "/anime-type/movie/"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHTML(url) {
  const response = await axios.get(url, {
    timeout: TIMEOUT,
    maxRedirects: 5,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const finalUrl = response.request?.res?.responseUrl || url;
  if (new URL(finalUrl).pathname !== new URL(url).pathname) {
    console.log("[REDIRECT]", url, "=>", finalUrl);
  }
  return typeof response.data === "string" ? response.data : "";
}

function absoluteInternalUrl(href, base = BASE) {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (!["desidubanime.me", "www.desidubanime.me"].includes(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function animeSlug(url) {
  if (url.pathname === "/anime/" || url.pathname === "/anime") return null;
  if (!/^\/anime\/[^/]+\/?$/i.test(url.pathname)) return null;
  return url.pathname.split("/").filter(Boolean)[1] || null;
}

function watchEpisodeInfo(url, anchorText = "") {
  if (!/^\/watch\/[^/]+\/?$/i.test(url.pathname)) return null;
  const slug = url.pathname.split("/").filter(Boolean)[1] || "";
  const match = (slug + " " + anchorText).match(/(?:episode|ep)[\s-]*(\d+)/i);
  const number = match ? Number(match[1]) : null;
  if (!Number.isInteger(number) || number < 1) return null;
  const cleanTitle = String(anchorText || "")
    .replace(/\s+/g, " ")
    .replace(/^.*?episode\s*\d+\s*[:|/\-]*\s*/i, "")
    .trim();
  return {
    slug,
    episode_number: number,
    title: cleanTitle || ("Episode " + number),
    source_url: url.href
  };
}

function getPoster($) {
  const candidates = [
    $("meta[property='og:image']").attr("content"),
    $("meta[name='twitter:image']").attr("content"),
    $(".film-poster img").first().attr("src"),
    $(".film-poster img").first().attr("data-src"),
    $(".anime-poster img").first().attr("src"),
    $("img").first().attr("src"),
    $("img").first().attr("data-src")
  ];
  return candidates.find(value => value && /^https?:\/\//i.test(value)) || "";
}

function parseAnimePage(html, pageUrl, id) {
  const $ = cheerio.load(html);
  const title =
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").text().trim() ||
    id;
  const description =
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content") ||
    $(".description").first().text().trim() ||
    "";
  const poster = getPoster($);
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const typeMatch = bodyText.match(/\bType\s*(TV|Movie|OVA|ONA|Special)\b/i);
  const contentType = typeMatch && /movie/i.test(typeMatch[1]) ? "movie" : "series";

  const seasons = new Set();
  $("button, a, option, [data-season]").each((_, el) => {
    const text = $(el).text() + " " + ($(el).attr("data-season") || "") + " " + ($(el).attr("value") || "");
    const match = text.match(/season\s*(\d+)/i);
    if (match) seasons.add(Number(match[1]));
    const dataSeason = Number($(el).attr("data-season"));
    if (Number.isInteger(dataSeason) && dataSeason > 0) seasons.add(dataSeason);
  });

  const episodesByKey = new Map();
  $("a[href], [data-href], [data-url]").each((_, el) => {
    const rawHref = $(el).attr("href") || $(el).attr("data-href") || $(el).attr("data-url");
    const url = absoluteInternalUrl(rawHref, pageUrl);
    if (!url) return;
    const info = watchEpisodeInfo(url, $(el).text());
    if (!info) return;

    let season = 1;
    const context = $(el).parent().parent().text().slice(0, 300);
    const seasonMatch = context.match(/season\s*(\d+)/i);
    if (seasonMatch) season = Number(seasonMatch[1]);
    const key = season + ":" + info.episode_number;
    episodesByKey.set(key, {
      anime_id: id,
      source_id: info.slug,
      season,
      episode_number: info.episode_number,
      title: info.title,
      source_url: info.source_url
    });
  });

  if (!seasons.size && episodesByKey.size) {
    for (const episode of episodesByKey.values()) seasons.add(episode.season || 1);
  }

  return {
    anime: {
      id,
      source_id: id,
      title,
      poster,
      description,
      source_url: pageUrl,
      source: "desidubanime.me",
      content_type: contentType,
      seasons: [...seasons].sort((a, b) => a - b),
      updated_at: new Date().toISOString()
    },
    episodes: [...episodesByKey.values()].sort((a, b) =>
      a.season - b.season || a.episode_number - b.episode_number
    ),
    contentType
  };
}

function extractCatalogLinks(html, currentUrl) {
  const $ = cheerio.load(html);
  const anime = new Map();
  const pages = new Set();

  $("a[href]").each((_, el) => {
    const url = absoluteInternalUrl($(el).attr("href"), currentUrl);
    if (!url) return;

    const slug = animeSlug(url);
    if (slug) anime.set(slug, url.href);

    const isCatalogPage =
      /^\/az-list\/(?:page\/\d+\/)?$/i.test(url.pathname) ||
      /^\/anime\/(?:page\/\d+\/)?$/i.test(url.pathname) ||
      /^\/anime-type\/(?:tv|movie)\/(?:page\/\d+\/)?$/i.test(url.pathname) ||
      /[?&](?:page|page_no)=\d+/i.test(url.search);
    if (isCatalogPage) pages.add(url.href);
  });

  return { anime, pages };
}

async function discoverCatalog() {
  const queue = CATALOG_SEEDS.map(path => new URL(path, BASE).href);
  const visited = new Set();
  const anime = new Map();

  while (queue.length && visited.size < 250) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const html = await fetchHTML(url);
      const found = extractCatalogLinks(html, url);
      for (const [slug, href] of found.anime) anime.set(slug, href);
      for (const next of found.pages) {
        if (!visited.has(next)) queue.push(next);
      }
      console.log("[CATALOG]", url, "found:", found.anime.size, "unique total:", anime.size, "pagination links:", found.pages.size);
    } catch (error) {
      console.log("[CATALOG FAILED]", url, error.message);
    }
    await sleep(DELAY_MS);
  }

  return { anime, pages: visited.size };
}

async function runPool(items, worker, concurrency = CONCURRENCY) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function syncAll() {
  console.log("Starting full DesiDubAnime catalog sync...");
  const catalog = await discoverCatalog();
  if (catalog.anime.size === 0) {
    throw new Error("Catalog discovery returned no anime pages; keeping the existing database unchanged.");
  }
  const db = { anime: [], episodes: [], movies: [] };

  await runPool([...catalog.anime.entries()], async ([id, url]) => {
    try {
      const html = await fetchHTML(url);
      const parsed = parseAnimePage(html, url, id);
      if (parsed.contentType === "movie") {
        db.movies.push({
          ...parsed.anime,
          id,
          source_url: url,
          watch_url: parsed.episodes[0]?.source_url || null
        });
      } else {
        db.anime.push(parsed.anime);
        db.episodes.push(...parsed.episodes);
      }
      console.log("[SYNCED]", parsed.anime.title, "episodes:", parsed.episodes.length);
    } catch (error) {
      console.log("[DETAIL FAILED]", id, error.message);
    }
    await sleep(DELAY_MS);
  });

  db.anime.sort((a, b) => a.title.localeCompare(b.title));
  db.movies.sort((a, b) => a.title.localeCompare(b.title));
  db.episodes.sort((a, b) =>
    String(a.anime_id).localeCompare(String(b.anime_id)) ||
    a.season - b.season ||
    a.episode_number - b.episode_number
  );

  if (db.anime.length === 0 && db.movies.length === 0) {
    throw new Error("No anime or movies were parsed; keeping the existing database unchanged.");
  }

  // Do not replace the populated catalog with a partial scrape.
  const existing = loadDB();
  const existingTitles = existing.anime.length + existing.movies.length;
  const newTitles = db.anime.length + db.movies.length;
  const existingEpisodes = existing.episodes.length;
  if (existingTitles >= 100 && newTitles < Math.ceil(existingTitles * 0.5)) {
    throw new Error("Incomplete source scrape (" + newTitles + "/" + existingTitles + " titles); keeping the existing database unchanged.");
  }
  if (existingEpisodes >= 1000 && db.episodes.length < Math.ceil(existingEpisodes * 0.2)) {
    throw new Error("Episode scrape appears incomplete (" + db.episodes.length + "/" + existingEpisodes + " episodes); keeping the existing database unchanged.");
  }

  saveDB(db);
  console.log("DesiDubAnime sync complete:", {
    catalogPages: catalog.pages,
    anime: db.anime.length,
    episodes: db.episodes.length,
    movies: db.movies.length
  });
  return db;
}

async function incrementalSync() {
  // Rebuild the catalog from the configured source to avoid stale records.
  return syncAll();
}

module.exports = { syncAll, incrementalSync, discoverCatalog, parseAnimePage };
