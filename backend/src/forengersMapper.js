/**
 * Helper functions to match Pl@ntNet API results
 * to a restricted Forengers sapling list.
 *
 * Pl@ntNet result structure (simplified):
 * results: [
 *   {
 *     score: 0.99,
 *     species: {
 *       scientificNameWithoutAuthor: "Hibiscus rosa-sinensis",
 *       commonNames: [ "Hibiscus", ... ]
 *     }
 *   },
 *   ...
 * ]
 */

function normalize(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Score a single candidate name (from Pl@ntNet result) against
 * a single Forengers sapling entry.
 */
function scoreCandidateName(candidateName, sapling) {
  const c = normalize(candidateName);
  if (!c) return 0;

  const namesToCheck = [
    sapling.displayName,
    sapling.scientificName,
    ...(sapling.aliases || []),
  ].map(normalize);

  for (const n of namesToCheck) {
    if (!n) continue;
    if (c.includes(n) || n.includes(c)) {
      return 1; // simple binary score
    }
  }
  return 0;
}

/**
 * Given `results` from Pl@ntNet and an array of FORENGERS_SAPLINGS,
 * return best match or null.
 */
function mapToForengersSapling(results, saplings) {
  if (!Array.isArray(results) || results.length === 0) return null;
  if (!Array.isArray(saplings) || saplings.length === 0) return null;

  let best = {
    sapling: null,
    result: null,
    score: 0,
    probability: 0,
  };

  for (const r of results) {
    const species = r.species || {};
    const commonNames = species.commonNames || [];
    const sciName = species.scientificNameWithoutAuthor || "";
    const candidates = [sciName, ...commonNames];

    for (const candidate of candidates) {
      for (const sapling of saplings) {
        const matchScore = scoreCandidateName(candidate, sapling);
        const prob = typeof r.score === "number" ? r.score : 0;

        if (
          matchScore > best.score ||
          (matchScore === best.score && prob > best.probability)
        ) {
          best = {
            sapling,
            result: r,
            score: matchScore,
            probability: prob,
          };
        }
      }
    }
  }

  if (best.score === 0) return null;
  return best;
}

module.exports = {
  mapToForengersSapling,
  normalize,
};
