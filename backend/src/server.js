const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const loadSaplingsFromCSV = require("./loadCsv");
const { mapToForengersSapling } = require("./forengersMapper");

dotenv.config();

const app = express();

// Multer for file uploads
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

app.use(cors());
app.use(express.json());

// In-memory sapling list
let FORENGERS_SAPLINGS = [];

// Load CSV on startup
async function initSaplings() {
  try {
    FORENGERS_SAPLINGS = await loadSaplingsFromCSV("data/forengers_saplings.csv");
    console.log("✅ Loaded Forengers saplings:", FORENGERS_SAPLINGS.length);
  } catch (err) {
    console.error("❌ Failed to load saplings CSV:", err.message);
  }
}
initSaplings();

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    saplingsLoaded: FORENGERS_SAPLINGS.length,
    hasPlantnetKey: !!process.env.PLANTNET_API_KEY,
  });
});

// Main identify route (Pl@ntNet)
app.post("/api/identify", upload.single("image"), async (req, res) => {
  console.log("➡️  /api/identify hit. File:", !!req.file);

  try {
    if (!req.file) {
      console.log("❌ No image file in request");
      return res
        .status(400)
        .json({ success: false, error: "No image uploaded" });
    }

    if (!process.env.PLANTNET_API_KEY) {
      console.log("❌ PLANTNET_API_KEY missing");
      return res
        .status(500)
        .json({ success: false, error: "PlantNet API key not configured" });
    }

    const imagePath = req.file.path;

    // Build multipart/form-data request for Pl@ntNet
    const form = new FormData();
    // You can change "leaf" to "flower" or let user choose later
    form.append("organs", "leaf");
    form.append("images", fs.createReadStream(imagePath));

    const project = "all"; // or a specific flora if you want

    const url = `https://my-api.plantnet.org/v2/identify/${project}?api-key=${process.env.PLANTNET_API_KEY}`;

    console.log("🌐 Calling Pl@ntNet API...");
    const apiResponse = await fetch(url, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    const apiText = await apiResponse.text();

    // Delete temp file
    fs.unlink(imagePath, () => {});

    let apiJson = null;
    try {
      apiJson = JSON.parse(apiText);
    } catch (e) {
      console.error("❌ Failed to parse Pl@ntNet JSON:", apiText);
      return res.status(502).json({
        success: false,
        error: "Invalid response from Pl@ntNet",
        details: apiText,
      });
    }

    if (!apiResponse.ok) {
      console.error("❌ Pl@ntNet error:", apiResponse.status, apiJson);
      return res.status(apiResponse.status).json({
        success: false,
        error: "Pl@ntNet API error",
        status: apiResponse.status,
        details: apiJson,
      });
    }

    const results = apiJson.results || [];
    console.log("✅ Pl@ntNet results count:", results.length);

    const top = results[0] || null;

    const apiPlant = top
      ? {
          commonName:
            top.species?.commonNames?.[0] ||
            top.species?.scientificNameWithoutAuthor ||
            "Unknown",
          scientificName: top.species?.scientificNameWithoutAuthor || "",
          confidence: typeof top.score === "number" ? top.score : null,
        }
      : null;

    // Map to Forengers sapling list
    const mapped = mapToForengersSapling(results, FORENGERS_SAPLINGS);

    const forengersPlant = mapped
      ? {
          id: mapped.sapling.id,
          name: mapped.sapling.displayName,
          scientificName: mapped.sapling.scientificName,
          matchConfidence: mapped.probability,
        }
      : null;

    console.log("✅ Mapping result:", forengersPlant || apiPlant || "no match");

    return res.json({
      success: true,
      apiPlant,
      forengersPlant,
      checkedResults: results.length,
      remainingRequests: apiJson.remainingIdentificationRequests,
    });
  } catch (err) {
    console.error("❌ Error in /api/identify:", err);
    return res
      .status(500)
      .json({ success: false, error: "Identification failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🌱 Backend running at http://localhost:${PORT}`);
});
