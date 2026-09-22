const fs = require("fs");

const DB_FILE = "./anime-db.json";

const defaultDB = {
  anime: [],
  episodes: [],
  movies: []
};

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(defaultDB, null, 2)
  );
}

function loadDB() {
  const data = JSON.parse(
    fs.readFileSync(DB_FILE, "utf8")
  );

  // Backward-compatible migration
  if (!Array.isArray(data.anime)) {
    data.anime = [];
  }

  if (!Array.isArray(data.episodes)) {
    data.episodes = [];
  }

  if (!Array.isArray(data.movies)) {
    data.movies = [];
  }

  return data;
}

function saveDB(data) {
  if (!Array.isArray(data.anime)) {
    data.anime = [];
  }

  if (!Array.isArray(data.episodes)) {
    data.episodes = [];
  }

  if (!Array.isArray(data.movies)) {
    data.movies = [];
  }

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}

console.log("Anime database initialized successfully.");

module.exports = {
  loadDB,
  saveDB
};
