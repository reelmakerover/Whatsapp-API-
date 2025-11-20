const express = require("express");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// ✅ Serve frontend folder
app.use(express.static(path.join(__dirname, "frontend")));

const client = new Client({ authStrategy: new LocalAuth() });
let connected = false;
let sending = false;
let progress = { sent: 0, total: 0, last: "", finished: false };

client.on("qr", (qr) => console.log("📱 Scan QR in WhatsApp Web to connect..."));
client.on("ready", () => {
  connected = true;
  console.log("✅ WhatsApp connected successfully!");
});
client.initialize();

// Upload Excel
app.post("/api/upload", (req, res) => {
  if (!req.files?.file) return res.status(400).json({ error: "No file uploaded." });
  const file = req.files.file;
  const uploadPath = path.join(__dirname, "clients.xlsx");
  file.mv(uploadPath, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true, path: uploadPath });
  });
});

// List templates
app.get("/api/templates", (req, res) => {
  const dir = path.join(__dirname, "templates");
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
  res.json(files);
});

// Get single template content
app.get("/api/templates/:name", (req, res) => {
  const file = path.join(__dirname, "templates", req.params.name);
  if (!fs.existsSync(file)) return res.send("");
  res.send(fs.readFileSync(file, "utf8"));
});

// Start campaign
app.post("/api/start", async (req, res) => {
  if (!connected) return res.status(400).json({ error: "WhatsApp not connected yet" });
  if (sending) return res.status(400).json({ error: "Another campaign running" });

  const { start = 1, templateBody } = req.body;
  const workbook = XLSX.readFile(path.join(__dirname, "clients.xlsx"));
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  sending = true;
  progress = { sent: 0, total: data.length, last: "", finished: false };

  async function sendAll() {
    for (let i = start - 1; i < data.length; i++) {
      const row = data[i];
      const num = String(row.Mobile || "").replace(/\D/g, "");
      const msg = templateBody.replace(/{{Name}}/g, row.Name || "");
      try {
        await client.sendMessage(`${num}@c.us`, msg);
        progress.sent++;
        progress.last = `✅ Sent to ${row.Name} (${num})`;
        console.log(progress.last);
      } catch (e) {
        progress.last = `❌ Failed for ${row.Name}`;
        console.log(progress.last);
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    sending = false;
    progress.finished = true;
  }

  sendAll();
  res.json({ success: true, message: "Campaign started!" });
});

// Progress endpoint
app.get("/api/progress", (req, res) => res.json(progress));

// ✅ Serve frontend index.html (Express v5 safe syntax)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(5000, () => {
  console.log("🚀 Server running at http://localhost:5000");
});
