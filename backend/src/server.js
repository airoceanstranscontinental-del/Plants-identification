const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const loadSaplingsFromCSV = require("./loadCsv");
const { mapToForengersSapling } = require("./forengersMapper");

dotenv.config();

const app = express();

/* ================================
   PATHS
================================ */
const FRONTEND_PATH = path.join(__dirname, "..", "..", "frontend");
const uploadDir = path.join(__dirname, "..", "uploads");

/* ================================
   MIDDLEWARE
================================ */
app.use(express.json());
app.use(express.static(FRONTEND_PATH)); // ✅ SERVE FRONTEND

/* ================================
   FILE UPLOAD SETUP
================================ */
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

/* ================================
   LOAD FORENGERS SAPLINGS
================================ */
let FORENGERS_SAPLINGS = [];

async function initSaplings() {
  try {
    FORENGERS_SAPLINGS = await loadSaplingsFromCSV(
      path.join("data", "forengers_saplings.csv")
    );
    console.log("✅ Loaded Forengers saplings:", FORENGERS_SAPLINGS.length);
  } catch (err) {
    console.error("❌ Failed to load saplings CSV:", err.message);
  }
}
initSaplings();

/* ================================
   ROOT → FRONTEND
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

/* ================================
   HEALTH CHECKS
================================ */
app.get("/ping", (req, res) => {
  res.json({ pong: true });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    saplingsLoaded: FORENGERS_SAPLINGS.length,
    hasPlantnetKey: !!process.env.PLANTNET_API_KEY,
  });
});

/* ================================
   IDENTIFY PLANT (Pl@ntNet)
================================ */
app.post("/api/identify", upload.single("image"), async (req, res) => {
  console.log("➡️ /api/identify hit. File:", !!req.file);

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No image uploaded",
      });
    }

    if (!process.env.PLANTNET_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "PlantNet API key not configured",
      });
    }

    const imagePath = req.file.path;

    const form = new FormData();
    form.append("organs", "leaf");
    form.append("images", fs.createReadStream(imagePath));

    const project = "all";
    const url = `https://my-api.plantnet.org/v2/identify/${project}?api-key=${process.env.PLANTNET_API_KEY}`;

    console.log("🌐 Calling Pl@ntNet API...");

    const apiResponse = await fetch(url, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    const apiText = await apiResponse.text();

    fs.unlink(imagePath, () => {}); // cleanup temp file

    const apiJson = JSON.parse(apiText);

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json({
        success: false,
        error: "Pl@ntNet API error",
        details: apiJson,
      });
    }

    const results = Array.isArray(apiJson.results)
      ? apiJson.results
      : [];

    if (results.length === 0) {
      return res.json({
        success: true,
        apiPlant: null,
        forengersPlant: null,
        message: "No plant identified",
      });
    }

    const top = results[0];

    const apiPlant = {
      commonName:
        top.species?.commonNames?.[0] ||
        top.species?.scientificNameWithoutAuthor ||
        "Unknown",
      scientificName:
        top.species?.scientificNameWithoutAuthor || "Unknown",
      confidence: top.score ?? null,
    };

    const mapped = mapToForengersSapling(results, FORENGERS_SAPLINGS);

    const forengersPlant = mapped
      ? {
          id: mapped.sapling.id,
          name: mapped.sapling.displayName,
          scientificName: mapped.sapling.scientificName,
          matchConfidence: mapped.probability,
        }
      : null;

    console.log("✅ Sending result to frontend");

    return res.json({
      success: true,
      apiPlant,
      forengersPlant,
      remainingRequests:
        apiJson.remainingIdentificationRequests ?? null,
    });

  } catch (err) {
    console.error("❌ Error in /api/identify:", err);
    return res.status(500).json({
      success: false,
      error: "Identification failed",
    });
  }
});

/* ================================
   START SERVER
================================ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🌱 App running at http://localhost:${PORT}`);
});
