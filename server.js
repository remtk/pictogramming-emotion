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

// .env から GEMINI_API_KEY などを読む（dotenv不要）
(function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

// ==========================================
// 管理者設定: Google Apps Script (GAS) WebアプリURL
// 発行されたURLを以下の変数に貼り付けてください（空文字の場合はローカル保存のみ）
// ==========================================
const GAS_WEBHOOK_URL = ""; 

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

          function sendToGAS(url, body, redirectCount = 0) {
            if (redirectCount > 5) return; // 無限リダイレクト防止
            const urlObj = new URL(url);
            const reqOpts = {
              hostname: urlObj.hostname,
              path: urlObj.pathname + urlObj.search,
              method: "POST",
              headers: {
                "Content-Type": "text/plain",
                "Content-Length": Buffer.byteLength(body)
              }
            };
            const gasReq = https.request(reqOpts, (gasRes) => {
              // GASは302リダイレクトを返すことがあるので追いかける
              if ((gasRes.statusCode === 301 || gasRes.statusCode === 302 || gasRes.statusCode === 307 || gasRes.statusCode === 308) && gasRes.headers.location) {
                gasRes.resume(); // レスポンスを消費
                sendToGAS(gasRes.headers.location, body, redirectCount + 1);
              } else {
                gasRes.resume(); // レスポンスを消費
              }
            });
            gasReq.on("error", (e) => {
              console.error("Failed to send log to GAS:", e.message);
            });
            gasReq.write(body);
            gasReq.end();
          }

          sendToGAS(GAS_WEBHOOK_URL, reqBody);
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

  // APIエンドポイント: 問題を取得（全ユーザー共通）
  if (req.method === "GET" && reqPath === "/api/challenges") {
    if (fs.existsSync(QUESTIONS_FILE)) {
      const data = fs.readFileSync(QUESTIONS_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(data);
    } else {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // APIエンドポイント: AI自動作問（Gemini）。GASを使わずローカルで動かす
  if (req.method === "GET" && reqPath === "/api/generate-challenge") {
    const qs = new URL(req.url, "http://localhost").searchParams;
    generateChallengeWithGemini(qs.get("difficulty") || "1")
      .then((challenge) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(challenge));
      })
      .catch((err) => {
        console.error("AI generate failed:", err.message);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      });
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

function httpsJson(url, { method = "GET", body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: headers || {},
      timeout: 30000, // 30秒でタイムアウト
    };
    const req = https.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`Gemini HTTP ${res.statusCode}:`, data.slice(0, 500));
          reject(new Error(`Gemini HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Geminiの応答がJSONではありません: " + data.slice(0, 200)));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Gemini APIリクエストがタイムアウトしました（30秒）"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildGeneratePrompt(diffText) {
  return `あなたはプログラミング学習アプリ「ピクトグラミング+」の問題作成アシスタントです。
以下の独自言語仕様に従って、${diffText}レベルのプログラミング問題を1つ作成し、JSONのみを出力してください。

[言語仕様]
・EMOTION [感情] [秒]: 感情表現（JOY/喜び, SAD/悲しみ, ANGRY/怒り, SURPRISE/驚き, NORMAL/普通）
・SP "セリフ": 吹き出し
・PEN DOWN / PEN UP: 線の描画
・R [部位] [角度]: 部位の瞬間回転（BODY, LUA, LLA, RUA, RLA, LUL, LLL, RUL, RLL）
・RW [部位] [角度] [秒]: 回転アニメーション
・M x y / MW x y 秒: 平行移動
・WAIT 秒: 待機
・REPEAT n ... END: 繰り返し

[難易度の目安]
・初級: 単純な1〜3行（感情を変える、セリフを言うだけ）
・中級: 複数命令の順次処理（腕を動かしてから感情を変える等）
・上級: REPEATや図形描画を組み合わせる

[出力JSON] （これ以外のテキストは出力しない）
{
  "title": "問題のタイトル",
  "text": "ユーザーへの問題文",
  "hint": "ヒント",
  "sample": "正解コード（改行を含む）",
  "kind": "contains_code"
}`;
}

async function generateChallengeWithGemini(diffLevel) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が未設定です。プロジェクト直下の .env に書いてください。");
  }

  let diffText = "初級";
  if (String(diffLevel) === "2") diffText = "中級";
  if (String(diffLevel) === "3") diffText = "上級";

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildGeneratePrompt(diffText) }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  });

  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const json = await httpsJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });

  if (json.error) throw new Error(json.error.message || "Gemini API error");
  let text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const result = JSON.parse(text);
  return {
    title: result.title || "無題",
    text: result.text || "",
    hint: result.hint || "",
    sample: result.sample || "",
    kind: result.kind || "contains_code",
  };
}

server.listen(PORT, () => {
  console.log(`Pictogramming Emotion Edition: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log("AI作問: .env に GEMINI_API_KEY を書くと /api/generate-challenge が使えます");
  }
});
