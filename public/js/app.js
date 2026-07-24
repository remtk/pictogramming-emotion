import { renderSVG, EMOTIONS, createInitialPose } from "./pictogram.js";
import { Interpreter } from "./interpreter.js";

const stage = document.getElementById("pictogram-stage");
const speechBubble = document.getElementById("speech-bubble");
const codeInput = document.getElementById("code-input");
const consolePanel = document.getElementById("console-panel");
const emotionPalette = document.getElementById("emotion-palette");
const referenceContent = document.getElementById("reference-content");

const btnRun = document.getElementById("btn-run");
const btnStop = document.getElementById("btn-stop");
const btnReset = document.getElementById("btn-reset");
const btnClear = document.getElementById("btn-clear");
const challengeCount = document.getElementById("challenge-count");
const challengeResult = document.getElementById("challenge-result");
const challengeTitle = document.getElementById("challenge-title");
const challengeText = document.getElementById("challenge-text");
const challengeHint = document.getElementById("challenge-hint");
const btnChallengePrev = document.getElementById("btn-challenge-prev");
const btnChallengeNext = document.getElementById("btn-challenge-next");
const btnChallengeHint = document.getElementById("btn-challenge-hint");
const btnChallengeInsert = document.getElementById("btn-challenge-insert");
const btnChallengeAdmin = document.getElementById("btn-challenge-admin");
const challengeEditor = document.getElementById("challenge-editor");
const challengeEditTitle = document.getElementById("challenge-edit-title");
const challengeEditText = document.getElementById("challenge-edit-text");
const challengeEditHint = document.getElementById("challenge-edit-hint");
const challengeEditSample = document.getElementById("challenge-edit-sample");
const challengeEditKind = document.getElementById("challenge-edit-kind");
const btnChallengeSave = document.getElementById("btn-challenge-save");
const btnChallengeReset = document.getElementById("btn-challenge-reset");

let currentState = {
  pose: createInitialPose(),
  emotion: "NORMAL",
  penDown: false,
  penPath: [],
  penColor: "#2B2B2E",
  items: [],
  walkPhase: undefined,
  walkDir: 1,
};

function draw() {
  stage.querySelectorAll("svg").forEach((el) => el.remove());
  stage.insertAdjacentHTML(
    "beforeend",
    renderSVG(currentState.pose, {
      emotion: currentState.emotion,
      penPath: currentState.penPath,
      penColor: currentState.penColor,
      items: currentState.items,
      walkPhase: currentState.walkPhase,
      walkDir: currentState.walkDir,
    })
  );
  updateActivePalette();
}

function updateActivePalette() {
  emotionPalette.querySelectorAll(".emotion-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.emo === currentState.emotion);
  });
}

function appendConsole(msg, level = "info") {
  const line = document.createElement("div");
  line.className = `console-line ${level}`;
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  consolePanel.appendChild(line);
  consolePanel.scrollTop = consolePanel.scrollHeight;
}

function showSpeech(text) {
  speechBubble.textContent = text;
  speechBubble.classList.add("visible");
  clearTimeout(showSpeech._t);
  showSpeech._t = setTimeout(() => speechBubble.classList.remove("visible"), 1400);
}

const interpreter = new Interpreter({
  onPoseChange: (state) => {
    currentState = state;
    draw();
  },
  onConsole: appendConsole,
  onSpeak: showSpeech,
  onDone: () => {
    btnRun.disabled = false;
    btnStop.disabled = true;
    addLogHistory("プログラムの実行が完了しました", "done");
    if (typeof sendComprehensiveLog === "function") {
      sendComprehensiveLog(codeInput.value);
    }
    evaluateCurrentChallenge();
  },
  onCommandExecuted: (cmd, details) => {
    handleCommandLog(cmd, details);
  }
});

draw();

// --- 感情パレット生成 -----------------------------------
function buildEmotionPalette() {
  emotionPalette.innerHTML = "";
  Object.values(EMOTIONS).forEach((emo) => {
    const chip = document.createElement("button");
    chip.className = "emotion-chip";
    chip.dataset.emo = emo.key;
    chip.innerHTML = `<span class="swatch" style="background:${emo.color}"></span>${emo.label}`;
    chip.title = `EMOTION ${emo.aliases[1] || emo.key} をコードに追加`;
    chip.addEventListener("click", () => {
      insertAtCursor(`EMOTION ${emo.aliases[1] || emo.key}\n`);
    });
    emotionPalette.appendChild(chip);
  });
  updateActivePalette();
}
buildEmotionPalette();

function insertAtCursor(text) {
  const start = codeInput.selectionStart;
  const end = codeInput.selectionEnd;
  const before = codeInput.value.slice(0, start);
  const after = codeInput.value.slice(end);
  codeInput.value = before + text + after;
  const pos = start + text.length;
  codeInput.setSelectionRange(pos, pos);
  codeInput.focus();
}

// --- 実行制御 -----------------------------------------------------------
btnRun.addEventListener("click", async () => {
  consolePanel.innerHTML = "";
  
  // 実行のたびに今回の統計情報をリセットする（送信用）
  currentRunStats = {
    emotions: { "JOY": 0, "SAD": 0, "ANGRY": 0, "SURPRISE": 0, "NORMAL": 0 },
    lineDrawCount: 0,
    lineDrawLength: 0,
  };
  
  btnRun.disabled = true;
  btnStop.disabled = false;
  addLogHistory("プログラムの実行を開始します", "start");
  await interpreter.run(codeInput.value);
});

btnStop.addEventListener("click", () => {
  interpreter.stop();
});

btnReset.addEventListener("click", () => {
  interpreter.stop();
  interpreter.reset();
  currentState = {
    pose: createInitialPose(),
    emotion: "NORMAL",
    penDown: false,
    penPath: [],
    penColor: "#2B2B2E",
    items: [],
    walkPhase: undefined,
    walkDir: 1,
  };
  draw();
  consolePanel.innerHTML = "";
  btnRun.disabled = false;
  btnStop.disabled = true;
});

btnClear.addEventListener("click", () => {
  codeInput.value = "";
  codeInput.focus();
});

// --- コード保存・呼び出し ---------------------------------------------------
const CODE_SLOT_PREFIX = "pictogramming-code-slot-";

function codeSlotKey(slot) {
  return `${CODE_SLOT_PREFIX}${slot}`;
}

function updateCodeSlotStatus() {
  for (let slot = 1; slot <= 3; slot++) {
    const status = document.getElementById(`code-slot-status-${slot}`);
    const loadBtn = document.querySelector(`[data-load-slot="${slot}"]`);
    const savedCode = localStorage.getItem(codeSlotKey(slot));
    const hasSavedCode = savedCode !== null && savedCode.length > 0;

    if (status) {
      status.textContent = hasSavedCode ? `スロット${slot}: 保存済み` : `スロット${slot}: 空`;
      status.classList.toggle("saved", hasSavedCode);
    }
    if (loadBtn) {
      loadBtn.disabled = !hasSavedCode;
    }
  }
}

document.querySelectorAll("[data-save-slot]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const slot = btn.dataset.saveSlot;
    localStorage.setItem(codeSlotKey(slot), codeInput.value);
    updateCodeSlotStatus();
    appendConsole(`スロット${slot}にコードを保存しました`, "ok");
  });
});

document.querySelectorAll("[data-load-slot]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const slot = btn.dataset.loadSlot;
    const savedCode = localStorage.getItem(codeSlotKey(slot));
    if (savedCode === null || savedCode.length === 0) {
      appendConsole(`スロット${slot}は空です`, "warn");
      updateCodeSlotStatus();
      return;
    }
    codeInput.value = savedCode;
    codeInput.focus();
    appendConsole(`スロット${slot}からコードを呼び出しました`, "ok");
  });
});

updateCodeSlotStatus();

btnStop.disabled = true;

// --- サンプルコード -------------------------------------------------------
const SAMPLES = {
  basic: `// 基本サンプル：バンザイ
R LUA 165
R RUA -165`,
  emotion: `// 感情サンプル：喜び→驚き→悲しみと遷移する
EMOTION 喜び 0.8
SP "やったー！"
WAIT 1
EMOTION 驚き 0.5
SP "えっ！？"
WAIT 1
EMOTION 悲しみ 1
SP "そんな…"
WAIT 1
EMOTION 普通 0.6`,
  graphics: `// 図形サンプル：ピクトグラフィックスで三角形を描く
PEN DOWN
REPEAT 3
  MW 60 0 0.6
  R BODY 120
END
PEN UP
EMOTION 喜び`,
  graphics2: `// 図形サンプル2
PEN DOWN
REPEAT 8
  MW 120 0 0.6
  R BODY 135
END
PEN UP
EMOTION 喜び`,
  items: `// アイテム配置サンプル：リンゴと星を配置
ITEM CLEAR
ITEM リンゴ -80 -20 1.5
ITEM 星 80 -40 2.0
EMOTION 喜び 0.8
SP "わーい！"
WAIT 1.5
EMOTION 普通 0.6
ITEM CLEAR
SP "片付けたよ"`,
  itemAction: `// アイテム動作サンプル
ITEM ボール -220 -85 2.0
IMW ボール 220 0 3
IK 右腕 15 -85
IK 左腕 -15 -85
SP "キャッチ"`,
  ik: `//ボールキャッチ
ITEM CLEAR
ITEM ボール 0 -85 2.0
IK 右腕 15 -85
IK 左腕 -15 -85
SP "キャッチ"`,
};

document.getElementById("btn-sample-basic").addEventListener("click", () => {
  codeInput.value = SAMPLES.basic;
});
document.getElementById("btn-sample-emotion").addEventListener("click", () => {
  codeInput.value = SAMPLES.emotion;
});
document.getElementById("btn-sample-graphics").addEventListener("click", () => {
  codeInput.value = SAMPLES.graphics;
});
document.getElementById("btn-sample-graphics2")?.addEventListener("click", () => {
  codeInput.value = SAMPLES.graphics2;
});
document.getElementById("btn-sample-item")?.addEventListener("click", () => {
  codeInput.value = SAMPLES.items;
});
document.getElementById("btn-sample-item-action")?.addEventListener("click", () => {
  codeInput.value = SAMPLES.itemAction;
});
document.getElementById("btn-sample-ik")?.addEventListener("click", () => {
  codeInput.value = SAMPLES.ik;
});

// --- 命令リファレンス -------------------------------------------------------
const REFERENCE = [
  {
    group: "部位指定用コード一覧",
    items: [
      { code: "BODY または 体", desc: "体全体（胴体）" },
      { code: "LUA または 左上腕", desc: "左の二の腕" },
      { code: "LLA または 左前腕", desc: "左の肘から先" },
      { code: "RUA または 右上腕", desc: "右の二の腕" },
      { code: "RLA または 右前腕", desc: "右の肘から先" },
      { code: "LUL または 左上腿", desc: "左の太もも" },
      { code: "LLL または 左下腿", desc: "左の膝から下" },
      { code: "RUL または 右上腿", desc: "右の太もも" },
      { code: "RLL または 右下腿", desc: "右の膝から下" },
    ],
  },
  {
    group: "ピクトアニメーション命令",
    items: [
      { code: "R 部位 角度", desc: "指定した部位を瞬時に回転させる（例: R 左上腕 -90）" },
      { code: "RW 部位 角度 秒", desc: "指定秒数をかけて部位を回転させる（アニメーション）" },
      { code: "M x y", desc: "体全体を瞬時に平行移動する" },
      { code: "MW x y 秒", desc: "指定秒数をかけて体全体を平行移動する" },
    ],
  },
  {
    group: "ピクトグラフィックス命令",
    items: [
      { code: "PEN DOWN", desc: "ペンを下げて移動の軌跡を描き始める" },
      { code: "PEN UP", desc: "ペンを上げて描画を止める" },
      { code: "PEN COLOR \"#色\"", desc: "描画する線の色を変更する" },
    ],
  },
  {
    group: "共通命令",
    items: [
      { code: "REPEAT n ... END", desc: "n回繰り返す" },
      { code: "IF [式] ... END", desc: "式が真のときだけ実行する" },
      { code: "LET 変数 値", desc: "変数に値を代入する" },
      { code: "WAIT 秒", desc: "指定秒数待機する" },
      { code: "SP \"文字列\"", desc: "吹き出しでセリフを表示する" },
    ],
  },
  {
    group: "感情表現命令",
    emotion: true,
    items: [
      { code: "EMOTION 喜び [秒]", desc: "喜びの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 悲しみ [秒]", desc: "悲しみの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 怒り [秒]", desc: "怒りの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 驚き [秒]", desc: "驚きの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 普通 [秒]", desc: "通常の表情・色に戻す" },
    ],
  },
  {
    group: "アイテム操作命令",
    items: [
      { code: "ITEM 種類 x y [倍率]", desc: "指定座標にアイテムを配置（リンゴ, 星, ハート, 剣, ボール）" },
      { code: "ITEM CLEAR", desc: "配置したアイテムをすべて消去する" },
      { code: "IM 種類 x y", desc: "指定したアイテムを瞬時に平行移動する" },
      { code: "IMW 種類 x y 秒", desc: "指定秒数をかけてアイテムを平行移動する" },
    ],
  },
  {
    group: "座標指定（IK）命令",
    items: [
      { code: "IK 部位 x y", desc: "指定した手足を座標(x,y)に瞬時に移動させる（部位: 左腕, 右腕, 左脚, 右脚）" },
      { code: "IKW 部位 x y 秒", desc: "指定秒数をかけて手足を座標(x,y)に移動させる" },
    ],
  },
];

function buildReference() {
  referenceContent.innerHTML = "";
  REFERENCE.forEach((group) => {
    const wrap = document.createElement("div");
    wrap.className = "ref-group";
    const h4 = document.createElement("h4");
    h4.textContent = group.group;
    wrap.appendChild(h4);
    group.items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "ref-item" + (group.emotion ? " emotion-ref" : "");
      div.innerHTML = `${escapeHtml(item.code)}<span class="desc">${escapeHtml(item.desc)}</span>`;
      div.addEventListener("click", () => insertAtCursor(item.code.replace(/\[式\]/, "[X >= 5]").replace(/\[秒\]/, "0.8") + "\n"));
      wrap.appendChild(div);
    });
    referenceContent.appendChild(wrap);
  });
}
buildReference();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

codeInput.value = SAMPLES.emotion;

// --- 問題出題 ---------------------------------------------------------------
const CHALLENGES = [
  {
    title: "喜びの表情にしよう",
    text: "EMOTION命令を使って、ピクトグラムを喜びの状態にしてください。",
    hint: "例: EMOTION JOY 0",
    sample: `// 問題1: 喜びの表情にしよう
EMOTION JOY 0`,
    check: ({ state, code }) => state.emotion === "JOY" || /EMOTION\s+(JOY|喜び|よろこび)/i.test(code),
    success: "正解です。喜びの感情にできています。",
    failure: "まだ喜びになっていません。EMOTION JOY を使ってみましょう。",
  },
  {
    title: "線で三角形を描こう",
    text: "ペンを下ろして、移動とBODY回転を使い、三角形を描いてください。",
    hint: "PEN DOWN、REPEAT 3、MW、R BODY 120 を組み合わせます。",
    sample: `// 問題2: 線で三角形を描こう
PEN DOWN
REPEAT 3
  MW 60 0 0.4
  R BODY 120
END
PEN UP`,
    check: ({ code, stats }) =>
      /PEN\s+DOWN/i.test(code) &&
      /R\s+BODY\s+120/i.test(code) &&
      (stats.lineDrawCount >= 3 || /REPEAT\s+3/i.test(code)),
    success: "正解です。三角形を描くための命令が使えています。",
    failure: "PEN DOWN、3回の移動、R BODY 120 が入っているか確認しましょう。",
  },
  {
    title: "セリフを表示しよう",
    text: "SP命令を使って、ピクトグラムにひとこと話させてください。",
    hint: "例: SP \"こんにちは\"",
    sample: `// 問題3: セリフを表示しよう
SP "こんにちは"`,
    check: ({ code }) => /(^|\n)\s*SP\s+"/i.test(code),
    success: "正解です。吹き出しを表示できています。",
    failure: "SP \"文字\" の形でセリフを書いてみましょう。",
  },
];

let currentChallengeIndex = 0;

function setChallengeResult(text, status = "") {
  if (!challengeResult) return;
  challengeResult.textContent = text;
  challengeResult.classList.toggle("pass", status === "pass");
  challengeResult.classList.toggle("fail", status === "fail");
}

function renderChallenge() {
  const challenge = CHALLENGES[currentChallengeIndex];
  if (!challenge || !challengeTitle) return;

  challengeCount.textContent = `問題 ${currentChallengeIndex + 1}/${CHALLENGES.length}`;
  challengeTitle.textContent = challenge.title;
  challengeText.textContent = challenge.text;
  challengeHint.textContent = challenge.hint;
  challengeHint.hidden = true;
  btnChallengeHint.textContent = "ヒント";
  btnChallengePrev.disabled = currentChallengeIndex === 0;
  btnChallengeNext.disabled = currentChallengeIndex === CHALLENGES.length - 1;
  setChallengeResult("未実行");
}

function evaluateCurrentChallenge() {
  const challenge = CHALLENGES[currentChallengeIndex];
  if (!challenge) return;

  let passed = false;
  const code = codeInput.value;
  if (challenge.kind === "joy") {
    passed = currentState.emotion === "JOY" || /EMOTION\s+(JOY|喜び|よろこび)/i.test(code);
  } else if (challenge.kind === "triangle") {
    passed = /PEN\s+DOWN/i.test(code) && /R\s+BODY\s+120/i.test(code) && (currentRunStats.lineDrawCount >= 3 || /REPEAT\s+3/i.test(code));
  } else if (challenge.kind === "speech") {
    passed = /(^|\n)\s*SP\s+"/i.test(code);
  } else {
    passed = true; // "any"
  }

  setChallengeResult(passed ? "できました" : "もう少し", passed ? "pass" : "fail");
  appendConsole(passed ? (challenge.success || "正解です。") : (challenge.failure || "もう一度確認してみましょう。"), passed ? "ok" : "warn");
}

btnChallengePrev?.addEventListener("click", () => {
  currentChallengeIndex = Math.max(0, currentChallengeIndex - 1);
  renderChallenge();
  if (!challengeEditor.hidden && isAdminMode) openChallengeEditor();
});

btnChallengeNext?.addEventListener("click", () => {
  currentChallengeIndex = Math.min(CHALLENGES.length - 1, currentChallengeIndex + 1);
  renderChallenge();
  if (!challengeEditor.hidden && isAdminMode) openChallengeEditor();
});

btnChallengeHint?.addEventListener("click", () => {
  challengeHint.hidden = !challengeHint.hidden;
  btnChallengeHint.textContent = challengeHint.hidden ? "ヒント" : "ヒント非表示";
});

btnChallengeInsert?.addEventListener("click", () => {
  codeInput.value = CHALLENGES[currentChallengeIndex].sample;
  codeInput.focus();
  setChallengeResult("未実行");
});

renderChallenge();

// --- 問題編集（管理者モード） -----------------------------------------------
// 合言葉で管理者モードを解除し、問題を自由に編集・保存できる。
// 保存先はサーバーの questions.json → 全ユーザーに一括反映される。
const ADMIN_PASSWORD = "teacher"; // ここを変えると合言葉を変更できる
let isAdminMode = false;

// 起動時にサーバーから問題を読み込む
async function loadChallengesFromStorage() {
  try {
    const res = await fetch("/api/challenges");
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return; // サーバーにまだない場合は初期値をそのまま使う
    data.forEach((s, i) => {
      if (!CHALLENGES[i]) return;
      if (s.title)  CHALLENGES[i].title  = s.title;
      if (s.text)   CHALLENGES[i].text   = s.text;
      if (s.hint)   CHALLENGES[i].hint   = s.hint;
      if (s.sample) CHALLENGES[i].sample = s.sample;
      if (s.kind)   CHALLENGES[i].kind   = s.kind;
    });
  } catch (e) {
    console.warn("問題の読み込みに失敗しました", e);
  }
}

// サーバーに問題を保存（全ユーザーに反映される）
async function saveChallengesToStorage() {
  const data = CHALLENGES.map(c => ({
    title: c.title, text: c.text, hint: c.hint, sample: c.sample, kind: c.kind || "any",
  }));
  const res = await fetch("/api/challenges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Server error");
}

function openChallengeEditor() {
  const c = CHALLENGES[currentChallengeIndex];
  if (!c) return;
  challengeEditTitle.value  = c.title;
  challengeEditText.value   = c.text;
  challengeEditHint.value   = c.hint;
  challengeEditSample.value = c.sample;
  challengeEditKind.value   = c.kind || "any";
  challengeEditor.hidden = false;
  btnChallengeAdmin.textContent = "🔓 編集中";
}

function closeChallengeEditor() {
  challengeEditor.hidden = true;
  btnChallengeAdmin.textContent = "🔒 編集ロック解除";
}

btnChallengeAdmin?.addEventListener("click", () => {
  if (isAdminMode) {
    challengeEditor.hidden ? openChallengeEditor() : closeChallengeEditor();
    return;
  }
  const input = prompt("管理者パスワードを入力してください");
  if (input === null) return;
  if (input !== ADMIN_PASSWORD) { alert("パスワードが違います"); return; }
  isAdminMode = true;
  appendConsole("管理者モードで問題を編集できます", "ok");
  openChallengeEditor();
});

btnChallengeSave?.addEventListener("click", async () => {
  if (!isAdminMode) return;
  const c = CHALLENGES[currentChallengeIndex];
  c.title  = challengeEditTitle.value;
  c.text   = challengeEditText.value;
  c.hint   = challengeEditHint.value;
  c.sample = challengeEditSample.value;
  c.kind   = challengeEditKind.value;
  try {
    await saveChallengesToStorage();
    renderChallenge();
    closeChallengeEditor(); // 保存成功時にエディタを閉じる
    appendConsole(`問題 ${currentChallengeIndex + 1} を保存しました（全ユーザーに反映）`, "ok");
  } catch (e) {
    appendConsole("保存に失敗しました。サーバーが起動しているか確認してください。", "error");
  }
});

btnChallengeReset?.addEventListener("click", async () => {
  if (!isAdminMode) return;
  if (!confirm("問題を初期状態に戻しますか？サーバーの questions.json が削除され、全ユーザーの問題が初期値に戻ります。")) return;
  try {
    // サーバーに空配列を送ることでリセット（アプリ側のデフォルトが使われる）
    await fetch("/api/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    location.reload();
  } catch (e) {
    appendConsole("リセットに失敗しました", "error");
  }
});

// 起動時にサーバーから問題を読み込み、再描画
loadChallengesFromStorage().then(() => renderChallenge());

// --- ログデータ管理 --------------------------------------------------------
const sessionId = Math.random().toString(36).substring(2, 10);
const displaySessionEl = document.getElementById("display-session-id");
if (displaySessionEl) displaySessionEl.textContent = sessionId;
const modalSessionEl = document.getElementById("modal-session-id");
if (modalSessionEl) modalSessionEl.textContent = sessionId;

let runLog = {
  stats: {
    emotions: {
      "JOY": 0,
      "SAD": 0,
      "ANGRY": 0,
      "SURPRISE": 0,
      "NORMAL": 0,
    },
    lineDrawCount: 0,
    lineDrawLength: 0,
  },
  history: [],
};

let currentRunStats = {
  emotions: { "JOY": 0, "SAD": 0, "ANGRY": 0, "SURPRISE": 0, "NORMAL": 0 },
  lineDrawCount: 0,
  lineDrawLength: 0,
};

const emotionLabels = {
  "JOY": "喜び",
  "SAD": "悲しみ",
  "ANGRY": "怒り",
  "SURPRISE": "驚き",
  "NORMAL": "普通"
};

function clearLog() {
  runLog = {
    stats: {
      emotions: {
        "JOY": 0,
        "SAD": 0,
        "ANGRY": 0,
        "SURPRISE": 0,
        "NORMAL": 0,
      },
      lineDrawCount: 0,
      lineDrawLength: 0,
    },
    history: [],
  };
  updateLogUI();
}

function addLogHistory(text, type = "info") {
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  runLog.history.push({ time, text, type });
}

function sendComprehensiveLog(code) {
  fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionId,
      action: "RUN_PROGRAM",
      stats: currentRunStats,
      code: code
    })
  }).catch(err => console.error("Failed to send log:", err));
}

function handleCommandLog(cmd, details) {
  if (cmd === "EMOTION") {
    const { emotion, label, duration } = details;
    runLog.stats.emotions[emotion] = (runLog.stats.emotions[emotion] || 0) + 1;
    currentRunStats.emotions[emotion] = (currentRunStats.emotions[emotion] || 0) + 1;
    addLogHistory(`感情を「${label}」に変更しました（${duration}秒）`, "info");
  } else if (cmd === "MOVE") {
    const { x, y, dx, dy, penDown } = details;
    if (penDown) {
      const length = Math.round(Math.sqrt(dx * dx + dy * dy));
      runLog.stats.lineDrawCount += 1;
      runLog.stats.lineDrawLength += length;
      currentRunStats.lineDrawCount += 1;
      currentRunStats.lineDrawLength += length;
      addLogHistory(`線を描画しました (長さ: ${length}px)`, "info");
    } else {
      const length = Math.round(Math.sqrt(dx * dx + dy * dy));
      addLogHistory(`ピクトグラムを移動しました (距離: ${length}px)`, "info");
    }
  } else if (cmd === "PEN") {
    const { mode } = details;
    if (mode === "DOWN") {
      addLogHistory(`ペンを下げました`, "info");
    } else if (mode === "UP") {
      addLogHistory(`ペンを上げました`, "info");
    }
  } else if (cmd === "ITEM") {
    const { type, x, y, scale } = details;
    addLogHistory(`アイテム「${type}」を (${x}, ${y}) に配置しました`, "info");
  } else if (cmd === "IM" || cmd === "IMW") {
    const { type, dx, dy } = details;
    const length = Math.round(Math.sqrt(dx * dx + dy * dy));
    addLogHistory(`アイテム「${type}」を移動しました (距離: ${length}px)`, "info");
  } else if (cmd === "ITEM_CLEAR") {
    addLogHistory(`すべてのアイテムを消去しました`, "info");
  }
}

function updateLogUI() {
  document.getElementById("stat-line-count").textContent = `${runLog.stats.lineDrawCount} 回`;
  document.getElementById("stat-line-length").textContent = `${runLog.stats.lineDrawLength} px`;

  const emotionsList = document.getElementById("stats-emotions-list");
  if (emotionsList) {
    emotionsList.innerHTML = "";
    Object.keys(runLog.stats.emotions).forEach(key => {
      const card = document.createElement("div");
      card.className = "stat-emotion-card";
      const label = emotionLabels[key] || key;
      const count = runLog.stats.emotions[key];
      card.innerHTML = `<span class="count">${count}</span><span class="label">${label}</span>`;
      emotionsList.appendChild(card);
    });
  }

  const historyList = document.getElementById("history-log-list");
  if (historyList) {
    historyList.innerHTML = "";
    if (runLog.history.length === 0) {
      historyList.innerHTML = `<div class="log-item" style="color:var(--ink-soft); font-style:italic;">ログ履歴はありません。プログラムを実行すると記録されます。</div>`;
    } else {
      runLog.history.forEach(item => {
        const div = document.createElement("div");
        div.className = `log-item ${item.type}`;
        div.innerHTML = `<span class="log-time">[${item.time}]</span><span class="log-text">${escapeHtml(item.text)}</span>`;
        historyList.appendChild(div);
      });
      historyList.scrollTop = historyList.scrollHeight;
    }
  }
}

// --- モーダル制御 ---------------------------------------------------------
const logModal = document.getElementById("log-modal");
const btnLogTrigger = document.getElementById("btn-log-trigger");
const btnModalClose = document.getElementById("btn-modal-close");
const btnModalCloseFooter = document.getElementById("btn-modal-close-footer");
const btnLogClear = document.getElementById("btn-log-clear");

btnLogTrigger.addEventListener("click", () => {
  updateLogUI();
  logModal.classList.add("active");
});

const closeModal = () => {
  logModal.classList.remove("active");
};

btnModalClose.addEventListener("click", closeModal);
btnModalCloseFooter.addEventListener("click", closeModal);
logModal.addEventListener("click", (e) => {
  if (e.target === logModal) closeModal();
});

btnLogClear.addEventListener("click", () => {
  if (confirm("ログと統計情報をクリアしますか？")) {
    clearLog();
  }
});

// 初期適用
clearLog();

// --- 座標表示ツールチップ ・ ドラッグ共通 ---
const stageEl = document.getElementById("pictogram-stage");
const coordTooltip = document.getElementById("coord-tooltip");

// --- ピクトグラム・アイテムのドラッグ移動 -----------------------------------------
(function setupDrag() {
  let dragging = false;
  let dragTarget = null; // 'pictogram' | { itemIndex: number }
  let dragStartSvgX = 0, dragStartSvgY = 0;
  let dragStartValX = 0, dragStartValY = 0;

  function toSvgCoord(e) {
    const svg = stageEl.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * 400,
      y: ((clientY - rect.top) / rect.height) * 400,
    };
  }

  function isOnPictogram(e) {
    const part = e.target?.getAttribute("data-part");
    return part === "HEAD" || part === "BODY" || part === "TORSO";
  }

  // クリックしたSVG要素がアイテムかどうか判定し、対応する items のインデックスを返す
  function getItemIndex(e) {
    let el = e.target;
    while (el && el !== stageEl) {
      const idxStr = el.getAttribute("data-index");
      if (idxStr !== null) {
        return parseInt(idxStr, 10);
      }
      el = el.parentElement;
    }
    return -1;
  }

  function onPointerDown(e) {
    if (interpreter._running) return;
    const coord = toSvgCoord(e);
    if (!coord) return;

    // アイテムを優先チェック
    const itemIdx = getItemIndex(e);
    if (itemIdx >= 0) {
      dragging = true;
      dragTarget = { itemIndex: itemIdx };
      dragStartSvgX = coord.x;
      dragStartSvgY = coord.y;
      dragStartValX = currentState.items[itemIdx].x;
      dragStartValY = currentState.items[itemIdx].y;
      stageEl.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }

    if (isOnPictogram(e)) {
      dragging = true;
      dragTarget = "pictogram";
      dragStartSvgX = coord.x;
      dragStartSvgY = coord.y;
      dragStartValX = currentState.pose.x || 0;
      dragStartValY = currentState.pose.y || 0;
      stageEl.style.cursor = "grabbing";
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const coord = toSvgCoord(e);
    if (!coord) return;
    const dx = coord.x - dragStartSvgX;
    const dy = coord.y - dragStartSvgY;

    if (dragTarget === "pictogram") {
      currentState.pose.x = dragStartValX + dx;
      currentState.pose.y = dragStartValY + dy;
    } else if (dragTarget?.itemIndex >= 0) {
      const item = currentState.items[dragTarget.itemIndex];
      if (item) {
        item.x = dragStartValX + dx;
        item.y = dragStartValY + dy;
      }
    }
    draw();
    e.preventDefault();
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    dragTarget = null;
    stageEl.style.cursor = "";
  }

  stageEl.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  stageEl.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);

  stageEl.addEventListener("mouseover", (e) => {
    if (interpreter._running) return;
    if (isOnPictogram(e) || getItemIndex(e) >= 0) stageEl.style.cursor = "grab";
  });
  stageEl.addEventListener("mouseout", () => {
    if (!dragging) stageEl.style.cursor = "";
  });
})();

// --- 座標表示ツールチップ ---------------------------------------------------
if (stageEl && coordTooltip) {
  stageEl.addEventListener("mouseenter", () => {
    coordTooltip.style.display = "block";
  });

  stageEl.addEventListener("mouseleave", () => {
    coordTooltip.style.display = "none";
  });

  stageEl.addEventListener("mousemove", (e) => {
    const svg = stageEl.querySelector("svg");
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    if (rx < 0 || rx > rect.width || ry < 0 || ry > rect.height) {
      coordTooltip.style.display = "none";
      return;
    }
    coordTooltip.style.display = "block";

    // SVG(viewBox=400x400)に対する相対座標
    const svgX = (rx / rect.width) * 400;
    const svgY = (ry / rect.height) * 400;

    // 中央(200, 200)を原点としたコマンド用の座標系
    const cmdX = Math.round(svgX - 200);
    const cmdY = Math.round(svgY - 200);

    coordTooltip.textContent = `X: ${cmdX}, Y: ${cmdY}`;

    // ツールチップの位置をカーソルに追従
    const stageRect = stageEl.getBoundingClientRect();
    const tx = e.clientX - stageRect.left + 12;
    const ty = e.clientY - stageRect.top + 12;
    coordTooltip.style.transform = `translate(${tx}px, ${ty}px)`;
  });
}
