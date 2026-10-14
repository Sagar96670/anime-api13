const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "anime-db.json");
const IS_VERCEL = process.env.VERCEL === "1";
const bundledDB = require("./anime-db.json");

const defaultDB = {
  anime: [],
  episodes: [],
  movies: []
};

// On Vercel, keep the database in per-instance memory. The filesystem is
// read-only there, so catalog updates must be generated locally and deployed
// as anime-db.json.
let memoryDB = JSON.parse(JSON.stringify(bundledDB || defaultDB));

function normalizeDB(data) {
  if (!data || typeof data !== "object") data = {};
  if (!Array.isArray(data.anime)) data.anime = [];
  if (!Array.isArray(data.episodes)) data.episodes = [];
  if (!Array.isArray(data.movies)) data.movies = [];
  return data;
}

if (!IS_VERCEL && !fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
}

function loadDB() {
  const data = IS_VERCEL
    ? JSON.parse(JSON.stringify(memoryDB))
    : JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  return normalizeDB(data);
}

function saveDB(data) {
  normalizeDB(data);

  if (IS_VERCEL) {
    memoryDB = JSON.parse(JSON.stringify(data));
    return;
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

console.log(
  IS_VERCEL
    ? "Anime database running in Vercel memory mode."
    : "Anime database initialized successfully."
);

module.exports = { loadDB, saveDB };
