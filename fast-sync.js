const { incrementalSync, discoverCatalog } = require("./desidubanime-sync");

if (require.main === module) {
  incrementalSync()
    .then(() => console.log("DesiDubAnime incremental sync finished."))
    .catch(error => {
      console.error("DesiDubAnime incremental sync failed:", error);
      process.exitCode = 1;
    });
}

module.exports = {
  syncAll: incrementalSync,
  incrementalSync,
  discoverCatalog
};
