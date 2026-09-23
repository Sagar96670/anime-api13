const fs = require("fs");

const DB_FILE = "./anime-db.json";
const IS_VERCEL = process.env.VERCEL === "1";
const bundledDB = require("./anime-db.json");

const defaultDB = {
  anime: [],
  episodes: [],
  movies: []
};

let memoryDB = {
  anime: [],
  episodes: [],
  movies: []
};

if (!IS_VERCEL && !fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(defaultDB, null, 2)
  );
}

function loadDB() {
  const data = IS_VERCEL
    ? JSON.parse(JSON.stringify(bundledDB))
    : JSON.parse(
        fs.readFileSync(
          require("path").join(__dirname, "anime-db.json"),
          "utf8"
        )
      );

  if (!Array.isArray(data.anime)) data.anime = [];
  if (!Array.isArray(data.episodes)) data.episodes = [];
  if (!Array.isArray(data.movies)) data.movies = [];

  return data;
}

function saveDB(data) {
  if (!Array.isArray(data.anime)) data.anime = [];
  if (!Array.isArray(data.episodes)) data.episodes = [];
  if (!Array.isArray(data.movies)) data.movies = [];

  if (IS_VERCEL) {
    memoryDB = data;
    return;
  }

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}

console.log(
  IS_VERCEL
    ? "Anime database running in Vercel memory mode."
    : "Anime database initialized successfully."
);

module.exports = { loadDB, saveDB };
