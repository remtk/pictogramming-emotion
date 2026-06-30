/**
 * server.js
 * 依存パッケージなしで動く簡易静的ファイルサーバ。
 * `node server.js` で起動し、http://localhost:3000 で public/ 配下を配信する。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const LOG_FILE = path.join(__dirname, "logs.csv");

// ログファイルが存在しない場合はヘッダを作成
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, "Timestamp,SessionID,Action,Joy,Sad,Angry,Surprise,Normal,LineCount,LineLength,Code\n");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);

  // APIエンドポイント: ログの記録
  if (req.method === "POST" && reqPath === "/api/logs") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const timestamp = new Date().toISOString();
        const session = data.sessionId || "unknown";
        const action = data.action || "RUN";
        const joy = data.stats?.emotions?.JOY || 0;
        const sad = data.stats?.emotions?.SAD || 0;
        const angry = data.stats?.emotions?.ANGRY || 0;
        const surprise = data.stats?.emotions?.SURPRISE || 0;
        const normal = data.stats?.emotions?.NORMAL || 0;
        const lines = data.stats?.lineDrawCount || 0;
        const length = data.stats?.lineDrawLength || 0;
        // コード内容は改行やカンマを含むためダブルクォートで囲み、内部のダブルクォートは2つ重ねる（エスケープ）
        const code = `"${(data.code || "").replace(/"/g, '""')}"`;

        const csvRow = `${timestamp},${session},${action},${joy},${sad},${angry},${surprise},${normal},${lines},${length},${code}\n`;
        fs.appendFile(LOG_FILE, csvRow, (err) => {
          if (err) console.error("Failed to write log:", err);
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // APIエンドポイント: CSVのダウンロード
  if (req.method === "GET" && reqPath === "/api/logs/csv") {
    if (fs.existsSync(LOG_FILE)) {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pictogramming_logs.csv"'
      });
      fs.createReadStream(LOG_FILE).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Log file not found");
    }
    return;
  }

  if (reqPath === "/") reqPath = "/index.html";

  const filePath = path.normalize(path.join(ROOT, reqPath));

  // ディレクトリトラバーサル対策
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + reqPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Pictogramming Emotion Edition: http://localhost:${PORT}`);
});
