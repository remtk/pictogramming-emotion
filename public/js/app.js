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
};

function draw() {
  stage.querySelectorAll("svg").forEach((el) => el.remove());
  stage.insertAdjacentHTML(
    "beforeend",
    renderSVG(currentState.pose, {
      emotion: currentState.emotion,
      penPath: currentState.penPath,
      penColor: currentState.penColor,
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
  },
});

draw();

// --- 感情パレット生成（新規拡張UI） -----------------------------------
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
