const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// If a Render Persistent Disk is used, set DATA_FILE_PATH=/var/data/data.csv.
// Otherwise the bundled data.csv is used (uploads can reset after service restart/redeploy).
const SEED_CSV = path.join(ROOT, "data.csv");
const DATA_FILE = process.env.DATA_FILE_PATH
  ? path.resolve(process.env.DATA_FILE_PATH)
  : SEED_CSV;

const REQUIRED_COLUMNS = [
  "ID", "Work Item Type", "Title", "State", "Tags", "Done Date", "Cost"
];

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(SEED_CSV, DATA_FILE);
    console.log(`[Data] Seed file copied to ${DATA_FILE}`);
  }
}
ensureDataFile();

function readCsvData(filePath = DATA_FILE) {
  const records = parse(fs.readFileSync(filePath, "utf8"), {
    bom: true,
    skip_empty_lines: true
  });
  const headers = (records.shift() || []).map(value => value.trim());
  const missing = REQUIRED_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) {
    throw new Error(`الأعمدة التالية غير موجودة: ${missing.join(", ")}`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("ملف CSV يحتوي على أسماء أعمدة مكررة.");
  }
  return records
    .map(values => Object.fromEntries(headers.map((header, i) => [header, values[i]])))
    .filter(r => r.ID !== null && r.ID !== undefined && r.ID.trim() !== "")
    .map(r => ({
      id: r.ID,
      type: r["Work Item Type"] || "",
      title: r.Title || "",
      state: r.State || "",
      tag: r.Tags || "غير محدد",
      doneDate: r["Done Date"] || null,
      cost: Number(r.Cost || 0)
    }));
}

// Live browser connections.
const clients = new Set();
function broadcastDataChanged(source = "upload") {
  const payload = `event: data-changed\ndata: ${JSON.stringify({
    source,
    changedAt: new Date().toISOString()
  })}\n\n`;

  for (const client of clients) {
    try { client.write(payload); }
    catch (_) { clients.delete(client); }
  }
}

// Upload to a temporary file and validate before replacing the active CSV.
const upload = multer({
  dest: path.join(ROOT, "tmp_uploads"),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".csv") return cb(new Error("يجب رفع ملف بصيغة .csv فقط."));
    cb(null, true);
  }
});

app.disable("x-powered-by");
app.use(express.static(ROOT, {
  etag: false,
  maxAge: 0,
  setHeaders: res => res.setHeader("Cache-Control", "no-store")
}));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "operations-dashboard" });
});

app.get("/api/data", (req, res) => {
  try {
    ensureDataFile();
    const data = readCsvData();
    const stat = fs.statSync(DATA_FILE);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      updatedAt: new Date().toISOString(),
      dataModifiedAt: stat.mtime.toISOString(),
      count: data.length,
      data
    });
  } catch (e) {
    res.status(500).json({
      error: "تعذر قراءة ملف CSV",
      details: e.message
    });
  }
});

app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({
    connectedAt: new Date().toISOString()
  })}\n\n`);

  clients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_) {}
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.post("/api/upload-csv", upload.single("csv"), (req, res) => {
  let tempPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "لم يتم اختيار ملف CSV." });
    }

    // Test parse before replacing the live data file.
    const testData = readCsvData(tempPath);

    ensureDataFile();
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

    // Copy instead of rename so temp and data paths may be on different filesystems.
    fs.copyFileSync(tempPath, DATA_FILE);
    fs.unlinkSync(tempPath);
    tempPath = null;

    broadcastDataChanged("upload");

    res.json({
      ok: true,
      message: "تم تحديث ملف CSV بنجاح.",
      count: testData.length,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    res.status(400).json({
      error: "تعذر استخدام ملف CSV",
      details: e.message
    });
  }
});

app.get("/download-csv", (req, res) => {
  ensureDataFile();
  res.download(DATA_FILE, "data.csv");
});

// Multer / request error handler.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({
    error: "تعذر تنفيذ الطلب",
    details: err.message
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on port ${PORT}`);
  console.log(`CSV source: ${DATA_FILE}`);
});
