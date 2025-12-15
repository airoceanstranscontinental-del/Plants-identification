const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

/**
 * Load Forengers saplings from CSV into JS array.
 * CSV must have headers: id,common_name,scientific_name,aliases
 */
function loadSaplingsFromCSV(relativeCsvPath) {
  return new Promise((resolve, reject) => {
    const absolutePath = path.join(__dirname, "..", relativeCsvPath);
    const results = [];

    fs.createReadStream(absolutePath)
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          id: row.id,
          displayName: row.common_name,
          scientificName: row.scientific_name,
          aliases: row.aliases
            ? row.aliases.split(";").map((a) => a.trim())
            : [],
        });
      })
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
}

module.exports = loadSaplingsFromCSV;
