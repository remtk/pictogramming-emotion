/**
 * server.js
 * 依存パッケージなしで動く簡易静的ファイルサーバ。
 * `node server.js` で起動し、http://localhost:3000 で public/ 配下を配信する。
 */
const http = require("http");
const https = require("https"); // GASへの送信に使用
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const LOG_FILE = path.join(__dirname, "logs.csv");
const QUESTIONS_FILE = path.join(__dirname, "public", "questions.json"); // 問題データの保存先

// ==========================================
// 管理者設定: Google Apps Script (GAS) WebアプリURL
// 発行されたURLを以下の変数に貼り付けてください（空文字の場合はローカル保存のみ）
// ==========================================
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbz_1wXsaydCFO5g_SffaOK_DGoBdq4BLjwXIjCcBVbgCLb-Y6cDq1IEaIpHW9vIb3Zp/exec"; 

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

        // GASへの転送処理 (URLが設定されている場合)
        if (GAS_WEBHOOK_URL && GAS_WEBHOOK_URL.startsWith("https://")) {
          const reqBody = JSON.stringify({
            timestamp, session, action, joy, sad, angry, surprise, normal,
            lines, length, code: data.code || ""
          });

          const reqOpts = {
            method: "POST",
            headers: {
              "Content-Type": "text/plain", // GASはapplication/jsonだとCORSエラーになる場合があるためtext/plainを利用
              "Content-Length": Buffer.byteLength(reqBody)
            }
          };

          const gasReq = https.request(GAS_WEBHOOK_URL, reqOpts, (gasRes) => {
            // リダイレクトされる場合があるが、送信自体は完了しているため詳細なハンドリングは省略
            // console.log(`GAS webhook response: ${gasRes.statusCode}`);
          });

          gasReq.on("error", (e) => {
            console.error("Failed to send log to GAS:", e);
          });

          gasReq.write(reqBody);
          gasReq.end();
        }

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

  // APIエンドポイント: 問題を保存（管理者のみ、保存すると全ユーザーに反映）
  if (req.method === "POST" && reqPath === "/api/challenges") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data)) throw new Error("Invalid format");
        fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(data, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
