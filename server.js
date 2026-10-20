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
const QUESTION_BANK_FILE = path.join(__dirname, "question_bank.json"); // 問題バンク（蓄積用）

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

// BOMを除去してJSONファイルを読み込むヘルパー
function readBankFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let text = fs.readFileSync(filePath, "utf-8");
  // UTF-8 BOM (\uFEFF) を除去
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return JSON.parse(text);
}

// ==========================================
// 管理者設定: Google Apps Script (GAS) WebアプリURL
// 発行されたURLを以下の変数に貼り付けてください（空文字の場合はローカル保存のみ）
// ==========================================
const GAS_WEBHOOK_URL = ""; 

// ログファイルが存在しない場合はヘッダを作成
const CSV_HEADER = "Timestamp,SessionID,QuestionNumber,QuestionTitle,TrialCount,Result,Code\n";
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, CSV_HEADER);
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
        const timestamp = data.timestamp || new Date().toISOString();
        const session = data.sessionId || "unknown";
        const qNumber = data.questionNumber !== undefined ? data.questionNumber : "";
        const qTitle = (data.questionTitle || "").replace(/[\r\n,]/g, " ");
        const trial = data.trialCount !== undefined ? data.trialCount : 1;
        const result = data.result || "";
        // コード内容は改行やカンマを含むためダブルクォートで囲み、内部のダブルクォートは2つ重ねる（エスケープ）
        const code = `"${(data.code || "").replace(/"/g, '""')}"`;

        const csvRow = `${timestamp},${session},${qNumber},${qTitle},${trial},${result},${code}\n`;
        fs.appendFile(LOG_FILE, csvRow, (err) => {
          if (err) console.error("Failed to write log:", err);
        });

        // GASへの転送処理 (URLが設定されている場合)
        if (GAS_WEBHOOK_URL && GAS_WEBHOOK_URL.startsWith("https://")) {
          const reqBody = JSON.stringify({
            timestamp,
            session,
            questionNumber: qNumber,
            questionTitle: data.questionTitle || "",
            trialCount: trial,
            result,
            code: data.code || ""
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
              if ((gasRes.statusCode === 301 || gasRes.statusCode === 302 || gasRes.statusCode === 307 || gasRes.statusCode === 308) && gasRes.headers.location) {
                gasRes.resume();
                sendToGAS(gasRes.headers.location, body, redirectCount + 1);
              } else {
                gasRes.resume();
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
    const diff = qs.get("difficulty") || "1";
    const condition = qs.get("condition") || "";
    generateChallengeWithGemini(diff, condition)
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

  // APIエンドポイント: AIによる問題・正解コードの正確性検証
  if (req.method === "POST" && reqPath === "/api/validate-challenge") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const questionData = JSON.parse(body);
        validateChallengeWithGemini(questionData)
          .then((result) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
          })
          .catch((err) => {
            console.error("Validation failed:", err.message);
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: err.message }));
          });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
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

  // APIエンドポイント: 問題バンク（蓄積用）を取得
  if (req.method === "GET" && reqPath === "/api/question-bank") {
    try {
      const bank = readBankFile(QUESTION_BANK_FILE);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(bank));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // APIエンドポイント: 問題バンクへ問題を追加（デフォルト問題セットには影響しない）
  if (req.method === "POST" && reqPath === "/api/question-bank") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const newQuestion = JSON.parse(body);
        if (typeof newQuestion !== "object" || !newQuestion.title) {
          throw new Error("Invalid question format");
        }
        // 既存バンクを読み込み
        let bank = readBankFile(QUESTION_BANK_FILE);
        // タイムスタンプとIDを付与して追加
        newQuestion.id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        newQuestion.createdAt = new Date().toISOString();
        bank.push(newQuestion);
        fs.writeFileSync(QUESTION_BANK_FILE, JSON.stringify(bank, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, total: bank.length, id: newQuestion.id }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // APIエンドポイント: 問題バンクから特定の問題を削除
  if (req.method === "DELETE" && reqPath.startsWith("/api/question-bank/")) {
    const targetId = decodeURIComponent(reqPath.slice("/api/question-bank/".length));
    try {
      let bank = readBankFile(QUESTION_BANK_FILE);
      const before = bank.length;
      bank = bank.filter(q => q.id !== targetId);
      fs.writeFileSync(QUESTION_BANK_FILE, JSON.stringify(bank, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, deleted: before - bank.length, total: bank.length }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
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

function buildGeneratePrompt(diffText, condition = "") {
  const conditionRule = condition && condition.trim()
    ? `\n[特別な作成条件・指定]\n以下のユーザー指定条件を必ず満たす問題を作成してください:\n「${condition.trim()}」\n`
    : "";

  return `あなたはプログラミング学習アプリ「ピクトグラミング+」の問題作成アシスタントです。
以下の独自言語仕様と難易度基準に従って、${diffText}レベルのプログラミング問題を1つ作成し、JSONのみを出力してください。
${conditionRule}
[言語仕様]
・EMOTION [感情] [秒]: 感情表現（JOY/喜び, SAD/悲しみ, ANGRY/怒り, SURPRISE/驚き, NORMAL/普通）
・SP "セリフ": 吹き出し
・PEN DOWN / PEN UP / PEN COLOR "#色": 線の描画
・R [部位] [角度]: 部位の瞬間回転（BODY, LUA, LLA, RUA, RLA, LUL, LLL, RUL, RLL）
・RW [部位] [角度] [秒]: 回転アニメーション
・M x y / MW x y 秒: 平行移動
・WAIT 秒: 待機
・REPEAT n ... END: 繰り返し（入れ子・二重ループも可能）
・LET 変数名 値 / LET 変数名 [式]: 変数定義・更新（例: LET LEN 30, LET LEN [LEN + 20]）
・IF [式] ... END: 条件分岐（例: IF [SCORE >= 80] ... END）
・ITEM 種類 x y [倍率] / ITEM CLEAR: アイテム配置・消去（リンゴ, 星, ハート, 剣, ボール）
・IM / IMW 種類 dx dy 秒: アイテム移動
・IK / IKW 部位 x y 秒: 手足の座標指定（右腕, 左腕, 右脚, 左脚）

[重要ルール: R/RW回転命令の仕様]
・R / RW 命令は「相対回転（現在の角度からの変化量）」です。
・動かした部位を元の姿勢に戻すときは、「0」ではなく反転した反対の角度を指定してください。（例: -120度上げた腕を元に戻す正解コードは「RW RUA 120 1」です。「RW RUA 0 1」は間違いです）。

[難易度の厳格な基準]
・初級: 基本命令1〜2種類のみを使い、単純な動作を実現する（例: 感情を変えるだけ、セリフを言うだけ、腕を1本上げるだけ、直線歩行、アイテムを置くだけ）。ループや変数は使わない。
・中級: ループ（REPEAT）や複数命令の組み合わせ、順序の制御などを使う（例: REPEATによる正三角形や四角形の描画、腕を2本同時に動かしてから感情変化とセリフ、前傾してお辞儀してから元に戻す、アイテムを置いてIKで手を伸ばす）。
・上級: 変数（LET）・条件分岐（IF）・二重ループ（REPEATの入れ子）・複数の動作の同期（アイテム移動とピクトグラム移動の連携、変数を用いたスパイラル描画やカウントダウンジャンプ等）を組み合わせる。

[重要: 問題文（text）の書き方ルール（ネタバレ禁止）]
・問題文に「プログラムコードそのもの」や「命令名（MW 25 0, RW BODY 30, IF [CNT==6] など）」を直接答えとして書いてはいけません！
  （悪い例: 「REPEAT 12 のループを作成し、MW 25 0 と RW BODY 30 を実行してください」 ← 答えをそのまま書き写すだけで思考が不要になるためNG）
・問題文は「何を実現してほしいか（目的や仕様）」を日本語で自然に説明してください。
  （良い例: 「正12角形を描きながら一周するプログラムを作ってください。途中の6頂点目で驚きの表情にし、12頂点目で星を置いて『1周完了！』と喜ばせてください」）
・具体的な命令構文や計算式（「1周は360度なので360/12で計算します」「REPEATとIFを組み合わせます」など）は、問題文ではなく【ヒント（hint）】に記載してください。

[出力JSON] （これ以外のテキストは出力しない）
{
  "title": "【${diffText}】問題のタイトル",
  "text": "ユーザーへの問題文（命令名やコードの丸写しを禁止し、達成すべき動作・仕様を自然な日本語で説明）",
  "hint": "ヒント（使用する命令のヒントや考え方、計算の目安）",
  "sample": "正解コード（改行を含む）",
  "kind": "contains_code"
}`;
}

async function generateChallengeWithGemini(diffLevel, condition = "") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が未設定です。プロジェクト直下の .env に書いてください。");
  }

  let diffText = "初級";
  if (String(diffLevel) === "2") diffText = "中級";
  if (String(diffLevel) === "3") diffText = "上級";

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildGeneratePrompt(diffText, condition) }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  });

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModels = [primaryModel, "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

  let lastError = null;
  for (const model of fallbackModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const json = await httpsJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      });

      if (json.error) {
        throw new Error(json.error.message || `Gemini API error (${model})`);
      }
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
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${model} failed: ${err.message}. Trying next model...`);
    }
  }

  throw lastError || new Error("Gemini APIのリクエストに失敗しました。");
}

function buildValidatePrompt(challenge) {
  return `あなたはプログラミング学習アプリ「ピクトグラミング+」のコード検証アシスタントです。
登録されようとしているプログラミング問題と正解プログラムコードを検証し、正しく動作するか判定してください。

[言語仕様]
・EMOTION [感情] [秒]: 感情表現（JOY, SAD, ANGRY, SURPRISE, NORMAL / 喜び, 悲しみ, 怒り, 驚き, 普通）
・SP "セリフ": 吹き出し
・PEN DOWN / PEN UP / PEN COLOR "#色": 線の描画
・R [部位] [角度]: 部位の相対回転（BODY, LUA, LLA, RUA, RLA, LUL, LLL, RUL, RLL / 体, 左上腕, 左前腕, 右上腕, 右前腕, 左上腿, 左下腿, 右上腿, 右下腿）
・RW [部位] [角度] [秒]: 回転アニメーション
・M x y / MW x y 秒: 平行移動
・WAIT 秒: 待機
・REPEAT n ... END: 繰り返し
・LET 変数名 値 / LET 変数名 [式]: 変数
・IF [式] ... END: 条件分岐
・ITEM 種類 x y [倍率] / ITEM CLEAR: アイテム配置・消去（リンゴ, 星, ハート, 剣, ボール）
・IM / IMW 種類 dx dy 秒: アイテム移動
・IK / IKW 部位 x y 秒: 手足の座標指定（右腕, 左腕, 右脚, 左脚）

[検証対象の問題データ]
タイトル: ${challenge.title || ""}
問題文: ${challenge.text || ""}
正解コード:
\`\`\`
${challenge.sample || ""}
\`\`\`

[検証項目（以下を厳しくチェックしてください）]
1. 文法エラー: 未定義の命令、閉じられていないREPEAT/IF、引用符の閉じ忘れ、不適切な式構文がないか。
2. 幾何学・ロジックの正確さ: 
   - 「正n角形」を描く場合、1回の回転角は「360 / n」度である必要があります（例: 正12角形は 360/12 = 30度）。外角・回転角が幾何学的に破綻していないか。
   - ループ回数と回転角度の積が360度（または目的の角度）になっているか。
3. 問題文に記載された条件（特定の変数初期化、IF条件、ペンの色変更、アイテム配置、セリフ等）が正解コードで漏れなく実装されているか。
4. 単純なコピペやデタラメな文字列ではなく、実際に学習者が実行して題意通りの結果が得られるか。

[出力JSON形式] （JSONのみを出力してください）
{
  "valid": true または false,
  "reason": "検証結果の解説（NGの場合は修正すべき具体的なエラー理由・数式や構文の間違い、OKの場合は確認コメント）"
}`;
}

async function validateChallengeWithGemini(challenge) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // APIキーがない場合は構文チェックのみ（スキップ）
    return { valid: true, reason: "APIキー未設定のためAI検証をスキップしました。" };
  }

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildValidatePrompt(challenge) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModels = [primaryModel, "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

  for (const model of fallbackModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const json = await httpsJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      });

      if (json.error) throw new Error(json.error.message);
      let text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const result = JSON.parse(text);
      return {
        valid: Boolean(result.valid),
        reason: result.reason || "",
      };
    } catch (err) {
      console.warn(`Gemini validate (${model}) failed: ${err.message}`);
    }
  }

  return { valid: true, reason: "AIサーバーの応答が得られなかったため検証をパスしました。" };
}

server.listen(PORT, () => {
  console.log(`Pictogramming Emotion Edition: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log("AI作問: .env に GEMINI_API_KEY を書くと /api/generate-challenge が使えます");
  }
});
