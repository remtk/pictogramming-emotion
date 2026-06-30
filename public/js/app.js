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

let currentState = {
  pose: createInitialPose(),
  emotion: "NORMAL",
  penDown: false,
  penPath: [],
  penColor: "#2B2B2E",
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

btnStop.disabled = true;

// --- サンプルコード -------------------------------------------------------
const SAMPLES = {
  basic: `// 基本サンプル：両手を上げる
R LUA -120
R LLA -10
R RUA -120
R RLA 10`,
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

// --- 命令リファレンス -------------------------------------------------------
const REFERENCE = [
  {
    group: "ピクトアニメーション命令",
    items: [
      { code: "R 部位 角度", desc: "指定した部位を瞬時に回転させる（例: R LUA -90）" },
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
    group: "感情表現命令（新規拡張）",
    emotion: true,
    items: [
      { code: "EMOTION 喜び [秒]", desc: "喜びの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 悲しみ [秒]", desc: "悲しみの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 怒り [秒]", desc: "怒りの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 驚き [秒]", desc: "驚きの表情・ポーズ・色オーラに遷移する" },
      { code: "EMOTION 普通 [秒]", desc: "通常の表情・色に戻す" },
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

// --- ログデータ管理 --------------------------------------------------------
const sessionId = Math.random().toString(36).substring(2, 10);

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
      stats: runLog.stats,
      code: code
    })
  }).catch(err => console.error("Failed to send log:", err));
}

function handleCommandLog(cmd, details) {
  if (cmd === "EMOTION") {
    const { emotion, label, duration } = details;
    runLog.stats.emotions[emotion] = (runLog.stats.emotions[emotion] || 0) + 1;
    addLogHistory(`感情を「${label}」に変更しました（${duration}秒）`, "info");
  } else if (cmd === "MOVE") {
    const { x, y, dx, dy, penDown } = details;
    if (penDown) {
      const length = Math.round(Math.sqrt(dx * dx + dy * dy));
      runLog.stats.lineDrawCount += 1;
      runLog.stats.lineDrawLength += length;
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
const btnLogDownload = document.getElementById("btn-log-download");

btnLogDownload?.addEventListener("click", () => {
  window.location.href = "/api/logs/csv";
});

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
