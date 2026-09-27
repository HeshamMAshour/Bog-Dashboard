const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// If a Render Persistent Disk is used, set DATA_FILE_PATH=/var/data/data.xlsx.
// Otherwise the bundled data.xlsx is used (uploads can reset after service restart/redeploy).
const SEED_EXCEL = path.join(ROOT, "data.xlsx");
const DATA_FILE = process.env.DATA_FILE_PATH
  ? path.resolve(process.env.DATA_FILE_PATH)
  : SEED_EXCEL;

const REQUIRED_COLUMNS = [
  "ID", "Work Item Type", "Title", "State", "Tags", "Done Date", "Cost"
];

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(SEED_EXCEL, DATA_FILE);
    console.log(`[Data] Seed file copied to ${DATA_FILE}`);
  }
}
ensureDataFile();

function readExcelData(filePath = DATA_FILE) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames.includes("data") ? "data" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    defval: null,
    raw: false,
    dateNF: "yyyy-mm-dd hh:mm:ss"
  });

  return rows
    .filter(r => r.ID !== null && r.ID !== undefined && r.ID !== "")
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

function validateWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames.includes("data") ? "data" : wb.SheetNames[0];
  if (!sheetName) throw new Error("ملف Excel لا يحتوي على أي Sheet.");

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const headers = (rows[0] || []).map(v => String(v).trim());
  const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));

  if (missing.length) {
    throw new Error(`الأعمدة التالية غير موجودة: ${missing.join(", ")}`);
  }
  return { sheetName };
}

// Live browser connections.
const clients = new Set();
function broadcastExcelChanged(source = "upload") {
  const payload = `event: excel-changed\ndata: ${JSON.stringify({
    source,
    changedAt: new Date().toISOString()
  })}\n\n`;

  for (const client of clients) {
    try { client.write(payload); }
    catch (_) { clients.delete(client); }
  }
}

// Upload to temp file first, validate, then atomically replace active Excel.
const upload = multer({
  dest: path.join(ROOT, "tmp_uploads"),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".xlsx") return cb(new Error("يجب رفع ملف بصيغة .xlsx فقط."));
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
    const data = readExcelData();
    const stat = fs.statSync(DATA_FILE);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      updatedAt: new Date().toISOString(),
      excelModifiedAt: stat.mtime.toISOString(),
      count: data.length,
      data
    });
  } catch (e) {
    res.status(500).json({
      error: "تعذر قراءة ملف Excel",
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

app.post("/api/upload-excel", upload.single("excel"), (req, res) => {
  let tempPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "لم يتم اختيار ملف Excel." });
    }

    validateWorkbook(tempPath);

    // Test parse before replacing the live data file.
    const testData = readExcelData(tempPath);

    ensureDataFile();
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

    // Copy instead of rename so temp and data paths may be on different filesystems.
    fs.copyFileSync(tempPath, DATA_FILE);
    fs.unlinkSync(tempPath);
    tempPath = null;

    broadcastExcelChanged("upload");

    res.json({
      ok: true,
      message: "تم تحديث ملف Excel بنجاح.",
      count: testData.length,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    res.status(400).json({
      error: "تعذر استخدام ملف Excel",
      details: e.message
    });
  }
});

app.get("/download-excel", (req, res) => {
  ensureDataFile();
  res.download(DATA_FILE, "data.xlsx");
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
  console.log(`Excel source: ${DATA_FILE}`);
});
