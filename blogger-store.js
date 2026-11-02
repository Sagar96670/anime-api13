const axios = require("axios");
const cheerio = require("cheerio");

const API_BASE = "https://www.googleapis.com/blogger/v3";
const LABEL = "anime-api-v1";
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT = 20000;

function config() {
  return {
    blogId: String(process.env.BLOGGER_BLOG_ID || "").trim(),
    feedUrl: String(process.env.BLOGGER_FEED_URL || "").trim(),
    apiKey: String(process.env.BLOGGER_API_KEY || "").trim(),
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    refreshToken: String(process.env.GOOGLE_REFRESH_TOKEN || "").trim()
  };
}

function isBloggerConfigured() {
  const c = config();
  return Boolean(c.blogId && (c.feedUrl || c.apiKey || (c.clientId && c.clientSecret && c.refreshToken)));
}

function isBloggerWritable() {
  const c = config();
  return Boolean(c.blogId && c.clientId && c.clientSecret && c.refreshToken);
}

async function getAccessToken() {
  const c = config();
  if (!c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error("Blogger write access is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.");
  }

  const response = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token"
    }).toString(),
    {
      timeout: REQUEST_TIMEOUT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  if (!response.data || !response.data.access_token) {
    throw new Error("Google OAuth did not return an access token.");
  }
  return response.data.access_token;
}

async function listPosts() {
  const c = config();
  if (!c.blogId) throw new Error("BLOGGER_BLOG_ID is not configured.");

  const headers = {};
  if (!c.apiKey) headers.Authorization = "Bearer " + await getAccessToken();

  const posts = [];
  let pageToken = "";

  do {
    const params = {
      fetchBodies: true,
      maxResults: PAGE_SIZE,
      labels: LABEL
    };
    if (c.apiKey) params.key = c.apiKey;
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get(
      API_BASE + "/blogs/" + encodeURIComponent(c.blogId) + "/posts",
      { params, headers, timeout: REQUEST_TIMEOUT }
    );
    const items = Array.isArray(response.data && response.data.items)
      ? response.data.items
      : [];
    posts.push(...items);
    pageToken = response.data && response.data.nextPageToken || "";
  } while (pageToken);

  return posts;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function postContent(record) {
  return "<pre>" + escapeHtml(JSON.stringify(record)) + "</pre>";
}

function parsePost(post) {
  if (!post || typeof post.content !== "string") return null;
  try {
    const $ = cheerio.load(post.content);
    const raw = $("pre").first().text().trim() || $.root().text().trim();
    const record = JSON.parse(raw);
    if (!record || record.schema !== LABEL || !record.id || !record.anime) return null;
    return record;
  } catch {
    return null;
  }
}

async function listFeedPosts() {
  const c = config();
  if (!c.feedUrl) return null;
  const feedUrl = new URL(c.feedUrl);
  feedUrl.searchParams.set("alt", "json");
  feedUrl.searchParams.set("max-results", String(PAGE_SIZE));
  let startIndex = 1;
  const posts = [];
  while (true) {
    feedUrl.searchParams.set("start-index", String(startIndex));
    const response = await axios.get(feedUrl.href, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": "AnimeCatalogAPI/1.0" }
    });
    const feed = response.data && response.data.feed || {};
    const entries = Array.isArray(feed.entry) ? feed.entry : [];
    for (const entry of entries) {
      posts.push({
        id: entry.id && entry.id.$t || "",
        title: entry.title && entry.title.$t || "",
        content: entry.content && entry.content.$t || ""
      });
    }
    const total = Number(feed.openSearch$totalResults && feed.openSearch$totalResults.$t);
    startIndex += entries.length;
    if (!entries.length || entries.length < PAGE_SIZE ||
        (Number.isFinite(total) && total > 0 && startIndex > total)) break;
  }
  return posts;
}

async function loadBloggerDB() {
  if (!isBloggerConfigured()) {
    throw new Error("Blogger read access is not configured. Set BLOGGER_BLOG_ID and BLOGGER_API_KEY (or OAuth credentials).");
  }

  const posts = await listFeedPosts() || await listPosts();
  const db = { anime: [], episodes: [], movies: [] };

  for (const post of posts) {
    const record = parsePost(post);
    if (!record) continue;

    const item = { ...record.anime, blogger_post_id: post.id };
    const episodes = Array.isArray(record.episodes) ? record.episodes : [];

    if (record.type === "movie") {
      db.movies.push(item);
    } else if (record.type === "series") {
      db.anime.push(item);
      db.episodes.push(...episodes);
    }
  }

  db.anime.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  db.movies.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  db.episodes.sort((a, b) =>
    String(a.anime_id).localeCompare(String(b.anime_id)) ||
    Number(a.season) - Number(b.season) ||
    Number(a.episode_number) - Number(b.episode_number)
  );

  return db;
}

async function upsertCatalog(db) {
  if (!isBloggerWritable()) {
    throw new Error("Blogger write access is not configured. Set BLOGGER_BLOG_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.");
  }

  const c = config();
  const token = await getAccessToken();
  const posts = await listPosts();
  const existingByKey = new Map();

  for (const post of posts) {
    const record = parsePost(post);
    if (record) existingByKey.set(record.type + ":" + String(record.id), { id: post.id, content: post.content || "" });
  }

  const records = [];
  for (const anime of (db.anime || [])) {
    records.push({
      schema: LABEL,
      type: "series",
      id: String(anime.id),
      anime,
      episodes: (db.episodes || []).filter(ep => String(ep.anime_id) === String(anime.id))
    });
  }
  for (const movie of (db.movies || [])) {
    records.push({
      schema: LABEL,
      type: "movie",
      id: String(movie.id),
      anime: movie,
      episodes: []
    });
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let next = 0;
  const concurrency = 5;
  const workers = Array.from({ length: Math.min(concurrency, records.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= records.length) return;
      const record = records[index];
    const key = record.type + ":" + record.id;
    const existing = existingByKey.get(key);
    const postId = existing && existing.id;
    const body = {
      title: String(record.anime.title || record.id),
      content: postContent(record),
      labels: [LABEL, record.type]
    };

    if (postId && existing.content === postContent(record)) {
      unchanged++;
      continue;
    }

    if (postId) {
      await axios.put(
        API_BASE + "/blogs/" + encodeURIComponent(c.blogId) + "/posts/" + encodeURIComponent(postId),
        body,
        { headers: { Authorization: "Bearer " + token }, timeout: REQUEST_TIMEOUT }
      );
      updated++;
    } else {
      const response = await axios.post(
        API_BASE + "/blogs/" + encodeURIComponent(c.blogId) + "/posts",
        body,
        {
          params: { isDraft: false },
          headers: { Authorization: "Bearer " + token },
          timeout: REQUEST_TIMEOUT
        }
      );
      existingByKey.set(key, { id: response.data && response.data.id, content: body.content });
      inserted++;
    }
    }
  });
  await Promise.all(workers);

  return { total: records.length, inserted, updated, unchanged };
}

module.exports = {
  isBloggerConfigured,
  isBloggerWritable,
  loadBloggerDB,
  upsertCatalog
};
