/**
 * netlify/functions/generate-challenge.js
 * Netlify Functions として動作するサーバーレス関数。
 * Gemini API を呼び出してプログラミング問題を自動生成する。
 *
 * 環境変数:
 *   GEMINI_API_KEY  - Google AI Studio で発行した API キー
 *   GEMINI_MODEL    - 使用するモデル名（省略可。未設定時はAPIで自動検出）
 */

const https = require("https");

function httpsRequest(url, { method = "GET", body, headers } = {}) {
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
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("リクエストがタイムアウトしました（30秒）"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function httpsJson(url, opts = {}) {
  const res = await httpsRequest(url, opts);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode}: ${res.body.slice(0, 400)}`);
  }
  return JSON.parse(res.body);
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
・動かした部位を元の姿勢に戻すときは、「0」ではなく反転した反対の角度を指定してください。

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

// ListModels APIで実際に使えるモデルを取得する
async function listAvailableModels(apiKey) {
  for (const apiVer of ["v1beta", "v1"]) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVer}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`;
      const json = await httpsJson(url);
      if (json.models && json.models.length > 0) {
        const models = json.models
          .filter(m =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes("generateContent") &&
            /flash|pro/i.test(m.name)
          )
          .map(m => ({ name: m.name.replace("models/", ""), apiVer }));
        if (models.length > 0) {
          console.log(`[ListModels/${apiVer}] Found:`, models.map(m => m.name).join(", "));
          return models;
        }
      }
    } catch (e) {
      console.warn(`ListModels ${apiVer} failed: ${e.message}`);
    }
  }
  return [];
}

async function generateChallengeWithGemini(diffLevel) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が未設定です。Netlifyの環境変数に設定してください。");
  }

  let diffText = "初級";
  if (String(diffLevel) === "2") diffText = "中級";
  if (String(diffLevel) === "3") diffText = "上級";

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: buildGeneratePrompt(diffText) }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  });

  // 使用するモデルリストを決定
  let modelsToTry = [];

  if (process.env.GEMINI_MODEL) {
    // 環境変数で明示指定されている場合
    const m = process.env.GEMINI_MODEL;
    modelsToTry = [
      { name: m, apiVer: "v1beta" },
      { name: m, apiVer: "v1" },
    ];
  } else {
    // APIで自動検出
    const available = await listAvailableModels(apiKey);
    if (available.length > 0) {
      // flash系を優先
      modelsToTry = available.sort((a, b) => {
        const score = (name) => {
          if (/flash-lite/i.test(name)) return 1;
          if (/flash/i.test(name)) return 0;
          return 2;
        };
        return score(a.name) - score(b.name);
      });
    } else {
      // 自動検出できなかった場合のフォールバック（v1betaとv1を両方試す）
      const names = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.0-pro", "gemini-1.5-pro"];
      modelsToTry = names.flatMap(name => [
        { name, apiVer: "v1beta" },
        { name, apiVer: "v1" },
      ]);
    }
  }

  let lastError = null;
  for (const { name, apiVer } of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${name}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const json = await httpsJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(reqBody),
        },
        body: reqBody,
      });

      if (json.error) {
        throw new Error(json.error.message || `Gemini API error (${name})`);
      }

      let text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const result = JSON.parse(text);
      console.log(`[Success] model=${name} apiVer=${apiVer}`);
      return {
        title: result.title || "無題",
        text: result.text || "",
        hint: result.hint || "",
        sample: result.sample || "",
        kind: result.kind || "contains_code",
      };
    } catch (err) {
      lastError = err;
      console.warn(`Model ${name} (${apiVer}) failed: ${err.message}`);
    }
  }

  throw lastError || new Error("Gemini APIのリクエストに失敗しました。");
}

// Netlify Functions のエントリポイント
exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

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
    return { statusCode: 200, headers, body: JSON.stringify(challenge) };
  } catch (err) {
    console.error("AI generate failed:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
