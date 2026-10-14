const { syncAll, discoverCatalog } = require("./desidubanime-sync");

if (require.main === module) {
  syncAll()
    .then(() => console.log("DesiDubAnime full sync finished."))
    .catch(error => {
      console.error("DesiDubAnime sync failed:", error);
      process.exitCode = 1;
    });
}

module.exports = { syncAll, discoverCatalog };
