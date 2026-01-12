const express = require("express");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const rateLimit = require("express-rate-limit");

const loadSaplingsFromCSV = require("./loadCsv");
const { mapToForengersSapling } = require("./forengersMapper");

dotenv.config();

const app = express();

/* ================================
   PATHS
================================ */
const FRONTEND_PATH = path.join(__dirname, "..", "..", "frontend");
/* ================================
   TRUST PROXY
================================ */
app.set("trust proxy", 1); // Trust the first proxy (e.g., Vercel, Heroku)

/* ================================
   MIDDLEWARE
================================ */
app.use(express.json());
app.use(express.static(FRONTEND_PATH)); // ✅ SERVE FRONTEND

/* ================================
   RATE LIMITER
================================ */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests, please try again later.",
});

app.use("/api/", apiLimiter);

/* ================================
   LOAD FORENGERS SAPLINGS
================================ */
let FORENGERS_SAPLINGS = [];

/* ================================
   ROOT → FRONTEND
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

/* ================================
   HEALTH CHECKS
================================ */
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
const Busboy = require('busboy');

app.post("/api/identify", async (req, res) => {
  console.log("➡️ /api/identify hit");

  if (!process.env.PLANTNET_API_KEY) {
    return res.status(500).json({
      success: false,
      error: "Server configuration error: API key not set"
    });
  }

  // Load saplings fresh each time
  if (FORENGERS_SAPLINGS.length === 0) {
    try {
      const csvPath = path.join(__dirname, "data", "forengers_saplings.csv");
      console.log("Loading CSV from:", csvPath);
      FORENGERS_SAPLINGS = await loadSaplingsFromCSV(csvPath);
      console.log("✅ Loaded", FORENGERS_SAPLINGS.length, "saplings");
    } catch (err) {
      console.error("❌ Failed to load saplings:", err.message);
    }
  }

  const busboy = Busboy({ headers: req.headers });
  let imageBuffer = null;
  let imageName = null;

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    return res.status(500).json({
      success: false,
      error: 'File upload error'
    });
  });

  busboy.on('file', (fieldname, file, filename) => {
    const chunks = [];
    imageName = filename;

    file.on('data', (chunk) => {
      chunks.push(chunk);
    });

    file.on('end', () => {
      imageBuffer = Buffer.concat(chunks);
    });
  });

  busboy.on('finish', async () => {
    if (!imageBuffer) {
      return res.status(400).json({
        success: false,
        error: "No image uploaded",
      });
    }

    try {
      // Write buffer to /tmp
      const imagePath = path.join('/tmp', `upload-${Date.now()}-${imageName.filename}`);
      fs.writeFileSync(imagePath, imageBuffer);

      const form = new FormData();
      form.append("organs", "leaf");
      form.append("images", fs.createReadStream(imagePath));

      const project = "all";
      const url = `https://my-api.plantnet.org/v2/identify/${project}?api-key=${process.env.PLANTNET_API_KEY}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      console.log("🌐 Calling Pl@ntNet API...");

      const apiResponse = await fetch(url, {
        method: "POST",
        body: form,
        headers: form.getHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const apiText = await apiResponse.text();
      const apiJson = JSON.parse(apiText);

      // Cleanup
      fs.unlinkSync(imagePath);

      if (!apiResponse.ok) {
        return res.status(apiResponse.status).json({
          success: false,
          error: "Pl@ntNet API error",
          details: apiJson,
        });
      }

      const results = Array.isArray(apiJson.results) ? apiJson.results : [];

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
        scientificName: top.species?.scientificNameWithoutAuthor || "Unknown",
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
        remainingRequests: apiJson.remainingIdentificationRequests ?? null,
      });
    } catch (err) {
      console.error("❌ Error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  req.pipe(busboy);
});
/* ================================
   START SERVER
================================ */

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🌱 App running at http://localhost:${PORT}`);
  });
}

// For Vercel
module.exports = app;