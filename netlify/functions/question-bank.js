/**
 * netlify/functions/question-bank.js
 * Netlify Functions として動作するサーバーレス関数。
 * 問題バンクの取得・追加・削除を処理する。
 * データの永続化には Netlify Blobs を使用する。
 *
 * 対応リクエスト:
 *   GET  /api/question-bank        → 問題バンク一覧を取得
 *   POST /api/question-bank        → 問題バンクへ問題を追加
 *   DELETE /api/question-bank/:id  → 指定IDの問題を削除
 */

const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

// Blobs ストアから問題バンク配列を取得する
async function readBank(store) {
  try {
    const data = await store.get("bank", { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // まだデータが存在しない場合は空配列
    return [];
  }
}

// Blobs ストアへ問題バンク配列を保存する
async function writeBank(store, bank) {
  await store.setJSON("bank", bank);
}

exports.handler = async (event, context) => {
  // プリフライトリクエスト (CORS OPTIONS) への対応
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // Netlify Blobs ストアを初期化
  const store = getStore({
    name: "question-bank",
    consistency: "strong",
  });

  const method = event.httpMethod;
  // パスから ID を抽出 (DELETE /api/question-bank/:id の場合)
  const rawPath = event.path || "";
  const idMatch = rawPath.match(/\/api\/question-bank\/(.+)$/);
  const targetId = idMatch ? decodeURIComponent(idMatch[1]) : null;

  // ============================================================
  // GET: 問題バンク一覧を取得
  // ============================================================
  if (method === "GET" && !targetId) {
    try {
      const bank = await readBank(store);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(bank),
      };
    } catch (err) {
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
      const newQuestion = JSON.parse(event.body || "{}");
      if (typeof newQuestion !== "object" || !newQuestion.title) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Invalid question format: title が必要です" }),
        };
      }

      const bank = await readBank(store);

      // ID と qid を付与
      newQuestion.id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      if (!newQuestion.qid) {
        const userCount = bank.filter(q => q.qid && q.qid.startsWith("NEW-")).length + 1;
        newQuestion.qid = `NEW-${String(userCount).padStart(2, "0")}`;
      }
      newQuestion.createdAt = new Date().toISOString();

      bank.push(newQuestion);
      await writeBank(store, bank);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          total: bank.length,
          id: newQuestion.id,
          qid: newQuestion.qid,
        }),
      };
    } catch (err) {
      return {
        statusCode: 400,
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
      let bank = await readBank(store);
      const before = bank.length;
      bank = bank.filter(q => q.id !== targetId);
      await writeBank(store, bank);

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
