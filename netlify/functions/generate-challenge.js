/**
 * netlify/functions/generate-challenge.js
 * Netlify Functions として動作するサーバーレス関数。
 * Gemini API を呼び出してプログラミング問題を自動生成する。
 *
 * 環境変数:
 *   GEMINI_API_KEY  - Google AI Studio で発行した API キー
 *   GEMINI_MODEL    - 使用するモデル名（省略可、既定: gemini-2.0-flash）
 */

const https = require("https");

function httpsJson(url, { method = "GET", body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: headers || {},
      timeout: 30000,
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

[重要ルール: R/RW回転命令の仕様]
・R / RW 命令は「相対回転（現在の角度からの変化量）」です。
・動かした部位を元の姿勢に戻すときは、「0」ではなく反転した反対の角度を指定してください。（例: -120度上げた腕を元に戻す正解コードは「RW RUA 120 1」です。「RW RUA 0 1」は間違いです）。

[難易度の目安]
・初級: 単純な1〜3行（感情を変える、セリフを言うだけ）
・中級: 複数命令の順次処理（腕を動かしてから感情を変える、元の姿勢に戻す等）
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
    throw new Error("GEMINI_API_KEY が未設定です。Netlifyの環境変数に設定してください。");
  }

  let diffText = "初級";
  if (String(diffLevel) === "2") diffText = "中級";
  if (String(diffLevel) === "3") diffText = "上級";

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildGeneratePrompt(diffText) }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  });

  const primaryModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const fallbackModels = [primaryModel, "gemini-2.0-flash-lite", "gemini-1.5-flash"];

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

// Netlify Functions のエントリポイント
exports.handler = async (event, context) => {
  // CORS ヘッダー（同一オリジンからのリクエストのみ許可）
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  // プリフライトリクエスト対応
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const difficulty = (event.queryStringParameters || {}).difficulty || "1";

  try {
    const challenge = await generateChallengeWithGemini(difficulty);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(challenge),
    };
  } catch (err) {
    console.error("AI generate failed:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
