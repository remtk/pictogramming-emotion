/**
 * netlify/functions/question-bank.js
 * Netlify Functions として動作するサーバーレス関数。
 * 問題バンクの取得・追加・削除を処理する。
 *
 * データの永続化: Netlify Blobs を使用する。
 * Netlify Blobs が使えない環境ではメモリ内配列にフォールバックする。
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

// ---- Netlify Blobs ヘルパー ----------------------------------------
// Netlify Blobs が使えるかどうかを実行時に判定する
let blobsAvailable = false;
let getStore;

try {
  ({ getStore } = require("@netlify/blobs"));
  blobsAvailable = !!(process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_SITE_ID);
  if (blobsAvailable) {
    console.log("[question-bank] Netlify Blobs を使用します");
  } else {
    console.warn("[question-bank] Blobs 環境変数が未設定。メモリモードで動作します（再起動でデータが消えます）");
  }
} catch (e) {
  console.warn("[question-bank] @netlify/blobs のロードに失敗:", e.message);
}

// 初期データ（180問のシードデータ）の読み込み
let seedQuestions = [];
try {
  seedQuestions = require("./question_bank_seed.json");
  if (!Array.isArray(seedQuestions)) seedQuestions = [];
} catch (e) {
  console.warn("[question-bank] シードデータの読み込みに失敗:", e.message);
}

// メモリキャッシュ（Blobs が使えない場合のフォールバック、初期値に180問をセット）
let memoryBank = [...seedQuestions];

async function readBank() {
  if (blobsAvailable) {
    try {
      const store = getStore({ name: "question-bank", consistency: "strong" });
      const data = await store.get("bank", { type: "json" });
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
      // データがまだ保存されていないか空の場合、シードデータ（180問）で初期化
      if (seedQuestions.length > 0) {
        console.log(`[question-bank] シードデータ（${seedQuestions.length}問）でBlobsを初期化します`);
        try {
          await store.setJSON("bank", seedQuestions);
        } catch (we) {
          console.warn("[question-bank] Blobs初期保存警告:", we.message);
        }
        return [...seedQuestions];
      }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e.message && e.message.includes("404")) {
        // 未作成の場合はシードを保存して返す
        if (seedQuestions.length > 0) {
          try {
            const store = getStore({ name: "question-bank", consistency: "strong" });
            await store.setJSON("bank", seedQuestions);
          } catch (_) {}
          return [...seedQuestions];
        }
        return [];
      }
      console.error("[question-bank] Blobs 読み取りエラー:", e.message);
      return memoryBank.length > 0 ? memoryBank : [...seedQuestions];
    }
  }
  return memoryBank.length > 0 ? memoryBank : [...seedQuestions];
}

async function writeBank(bank) {
  if (blobsAvailable) {
    try {
      const store = getStore({ name: "question-bank", consistency: "strong" });
      await store.setJSON("bank", bank);
      return;
    } catch (e) {
      console.error("[question-bank] Blobs 書き込みエラー:", e.message);
    }
  }
  // フォールバック: メモリに保存
  memoryBank = bank;
}

// ---- メインハンドラ ------------------------------------------------
exports.handler = async (event, context) => {
  // プリフライトリクエスト (CORS OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const method = event.httpMethod;
  const rawPath = event.path || "";
  // パスから ID を抽出 (DELETE /api/question-bank/:id の場合)
  const idMatch = rawPath.match(/(?:\/api\/question-bank|\/question-bank)\/(.+)$/);
  const targetId = idMatch ? decodeURIComponent(idMatch[1]) : null;

  // ============================================================
  // GET: 問題バンク一覧を取得
  // ============================================================
  if (method === "GET") {
    try {
      const bank = await readBank();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(bank),
      };
    } catch (err) {
      console.error("GET error:", err.message);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // ============================================================
  // POST: 問題バンクへ問題を追加
  // ============================================================
  if (method === "POST") {
    try {
      let newQuestion;
      try {
        newQuestion = JSON.parse(event.body || "{}");
      } catch {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Invalid JSON body" }),
        };
      }

      if (typeof newQuestion !== "object" || !newQuestion.title) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Invalid question format: title が必要です" }),
        };
      }

      const bank = await readBank();

      // ID と qid を付与
      newQuestion.id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      if (!newQuestion.qid) {
        const userCount = bank.filter(q => q.qid && q.qid.startsWith("NEW-")).length + 1;
        newQuestion.qid = `NEW-${String(userCount).padStart(2, "0")}`;
      }
      newQuestion.createdAt = new Date().toISOString();

      bank.push(newQuestion);
      await writeBank(bank);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          total: bank.length,
          id: newQuestion.id,
          qid: newQuestion.qid,
          persistent: blobsAvailable,
        }),
      };
    } catch (err) {
      console.error("POST error:", err.message);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // ============================================================
  // DELETE: 指定IDの問題を削除
  // ============================================================
  if (method === "DELETE" && targetId) {
    try {
      let bank = await readBank();
      const before = bank.length;
      bank = bank.filter(q => q.id !== targetId);
      await writeBank(bank);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          deleted: before - bank.length,
          total: bank.length,
        }),
      };
    } catch (err) {
      console.error("DELETE error:", err.message);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Method Not Allowed" }),
  };
};
