/**
 * pictogram.js
 * 人型ピクトグラムの骨格モデルと描画を担当する。
 * 論文「ピクトグラミング」(伊藤, 2018) の人型ピクトグラム仕様(9部位・ISO3864比率)を参考にした簡易実装。
 * 体(BODY) / 左右上腕(LUA,RUA) / 左右前腕(LLA,RLA) / 左右上腿(LUL,RUL) / 左右下腿(LLL,RLL)
 *
 * 新規拡張: 感情(EMOTION)を表す顔アイコンと色オーラをピクトグラム頭部付近に表示する。
 */

// 各部位の上位ID（連鎖回転関係）。論文 表6 に対応。
// 体(0)の回転は全部位、上腕(1,4)の回転は前腕(2,5)も追従する。
export const PART_IDS = {
  BODY: 0,
  LUA: 1, // 左上腕 Left Upper Arm
  LLA: 2, // 左前腕 Left Lower Arm
  LUL: 3, // 左上腿 Left Upper Leg
  LLL: 4, // 左下腿 Left Lower Leg（重複しないようID再割当て）
  RUA: 5,
  RLA: 6,
  RUL: 7,
  RLL: 8,
};

// 部位の親子関係（回転が連鎖する子部位）
const CHILD_OF = {
  BODY: ["LUA", "LUL", "RUA", "RUL", "LLA", "RLA", "LLL", "RLL"], // 体は全部位
  LUA: ["LLA"],
  RUA: ["RLA"],
  LUL: ["LLL"],
  RUL: ["RLL"],
  LLA: [],
  RLA: [],
  LLL: [],
  RLL: [],
};

// 日本語表記・ひらがな表記の対応（表5・表6 簡略版）
export const PART_ALIASES = {
  BODY: ["BODY", "体", "からだ"],
  LUA: ["LUA", "左上腕", "ひだりじょうわん"],
  LLA: ["LLA", "左前腕", "ひだりぜんわん"],
  RUA: ["RUA", "右上腕", "みぎじょうわん"],
  RLA: ["RLA", "右前腕", "みぎぜんわん"],
  LUL: ["LUL", "左上腿", "ひだりじょうたい"],
  LLL: ["LLL", "左下腿", "ひだりかたい"],
  RUL: ["RUL", "右上腿", "みぎじょうたい"],
  RLL: ["RLL", "右下腿", "みぎかたい"],
};

export function resolvePartName(token) {
  const t = token.trim();
  for (const key of Object.keys(PART_ALIASES)) {
    if (PART_ALIASES[key].includes(t)) return key;
  }
  return null;
}

// 初期姿勢（角度はすべて0 = 直立）
export function createInitialPose() {
  return {
    BODY: 0,
    LUA: 0,
    LLA: 0,
    RUA: 0,
    RLA: 0,
    LUL: 0,
    LLL: 0,
    RUL: 0,
    RLL: 0,
    x: 0, // 体全体の平行移動(横方向)
    y: 0, // 体全体の平行移動(縦方向)
  };
}

// 感情の定義（新規拡張部分）。色・表情シンボル・標準ポーズ（任意適用）を持つ。
export const EMOTIONS = {
  NORMAL: {
    key: "NORMAL",
    label: "ふつう",
    color: "#2B2B2E",
    face: "normal",
    aliases: ["NORMAL", "普通", "ふつう"],
  },
  JOY: {
    key: "JOY",
    label: "よろこび",
    color: "#E8A33D",
    face: "joy",
    aliases: ["JOY", "喜び", "よろこび"],
    pose: { LUA: 120, LLA: 0, RUA: -120, RLA: 0 },
  },
  SAD: {
    key: "SAD",
    label: "悲しみ",
    color: "#5B7C99",
    face: "sad",
    aliases: ["SAD", "悲しみ", "かなしみ"],
    pose: { LUA: -12, LLA: -18, RUA: 12, RLA: 18, BODY: -8 },
  },
  ANGRY: {
    key: "ANGRY",
    label: "いかり",
    color: "#C44536",
    face: "angry",
    aliases: ["ANGRY", "怒り", "いかり"],
    pose: { LUA: 55, LLA: -80, RUA: -55, RLA: 80 },
  },
  SURPRISE: {
    key: "SURPRISE",
    label: "おどろき",
    color: "#8B6BB5",
    face: "surprise",
    aliases: ["SURPRISE", "驚き", "おどろき"],
    pose: { LUA: 140, LLA: 0, RUA: -140, RLA: 0 },
  },
};

export function resolveEmotionName(token) {
  const t = token.trim();
  for (const key of Object.keys(EMOTIONS)) {
    if (EMOTIONS[key].aliases.includes(t)) return key;
  }
  return null;
}

// ISO3864を参考にした各部位の寸法比率（簡易値・正面方向のみサポート）
const DIMS = {
  headR: 26,
  bodyW: 42,
  bodyH: 100,
  upperArmL: 54,
  lowerArmL: 48,
  armW: 22,
  upperLegL: 72,
  lowerLegL: 68,
  legW: 24,
};

const NEUTRAL_ANGLES = {
  LUA: -150,
  RUA: 150,
  LUL: -170,
  RUL: 170,
};

/**
 * 現在のpose（角度群）からSVGを描画する。
 * @param {object} pose - createInitialPose()形式
 * @param {object} opts - { emotion: 'NORMAL', penPath: [{x,y}], penColor }
 */
export function renderSVG(pose, opts = {}) {
  const emotion = EMOTIONS[opts.emotion] || EMOTIONS.NORMAL;
  const cx = 200 + (pose.x || 0);
  const cy = 200 + (pose.y || 0);
  const bodyAngle = pose.BODY || 0;

  // Limb commands rotate from a neutral standing pictogram pose.
  const limbBase = (k) => (NEUTRAL_ANGLES[k] || 0) + bodyAngle + (pose[k] || 0);
  const laUA = limbBase("LUA");
  const laLA = laUA + (pose.LLA || 0);
  const raUA = limbBase("RUA");
  const raLA = raUA + (pose.RLA || 0);
  const laUL = limbBase("LUL");
  const laLL = laUL + (pose.LLL || 0);
  const raUL = limbBase("RUL");
  const raLL = raUL + (pose.RLL || 0);

  const neckY = cy - DIMS.bodyH / 2;
  const hipY = cy + DIMS.bodyH / 2;
  const shoulderOffsetX = DIMS.bodyW * 0.58;
  const hipOffsetX = DIMS.bodyW * 0.3;

  function limb(originX, originY, angleDeg, len, width, childAngleDeg, childLen, label) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const ex = originX + len * Math.cos(rad);
    const ey = originY + len * Math.sin(rad);
    let childPart = "";
    if (childAngleDeg !== undefined) {
      const crad = ((childAngleDeg - 90) * Math.PI) / 180;
      const cex = ex + childLen * Math.cos(crad);
      const cey = ey + childLen * Math.sin(crad);
      childPart = `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${cex.toFixed(1)}" y2="${cey.toFixed(1)}" stroke="${emotion.color}" stroke-width="${width - 4}" stroke-linecap="round" data-part="${label}-lower"/>`;
    }
    return {
      svg: `<line x1="${originX.toFixed(1)}" y1="${originY.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${emotion.color}" stroke-width="${width}" stroke-linecap="round" data-part="${label}-upper"/>${childPart}`,
      end: { x: ex, y: ey },
    };
  }

  const leftArm = limb(cx - shoulderOffsetX, neckY, laUA, DIMS.upperArmL, DIMS.armW, laLA, DIMS.lowerArmL, "LA");
  const rightArm = limb(cx + shoulderOffsetX, neckY, raUA, DIMS.upperArmL, DIMS.armW, raLA, DIMS.lowerArmL, "RA");
  const leftLeg = limb(cx - hipOffsetX, hipY, laUL, DIMS.upperLegL, DIMS.legW, laLL, DIMS.lowerLegL, "LL");
  const rightLeg = limb(cx + hipOffsetX, hipY, raUL, DIMS.upperLegL, DIMS.legW, raLL, DIMS.lowerLegL, "RL");

  // ペン描画軌跡（ピクトグラフィックス）
  let penSVG = "";
  if (opts.penPath && opts.penPath.length > 1) {
    const d = opts.penPath
      .map((p, i) => `${i === 0 ? "M" : "L"} ${(200 + p.x).toFixed(1)} ${(200 + p.y).toFixed(1)}`)
      .join(" ");
    penSVG = `<path d="${d}" fill="none" stroke="${opts.penColor || '#2B2B2E'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // 体（胴体は角丸長方形を体角度で回転）
  const bodySVG = `<g transform="rotate(${bodyAngle} ${cx} ${cy})"><rect x="${(cx - DIMS.bodyW / 2).toFixed(1)}" y="${(cy - DIMS.bodyH / 2).toFixed(1)}" width="${DIMS.bodyW}" height="${DIMS.bodyH}" rx="${DIMS.bodyW / 2}" fill="${emotion.color}" data-part="BODY"/></g>`;

  // 頭（体の上、首位置から頭半径分上）
  const headRad = ((bodyAngle - 90) * Math.PI) / 180;
  const headCx = cx + (DIMS.headR + 6) * Math.cos(headRad - Math.PI / 2 + Math.PI / 2) ; // 簡易: 体角度に応じて首方向へ
  // 頭の中心は首から上方向(体角度に垂直な軸の逆方向)へ配置
  const headDirRad = (bodyAngle * Math.PI) / 180;
  const headX = cx - Math.sin(headDirRad) * (DIMS.bodyH / 2 + DIMS.headR + 4);
  const headY = cy - Math.cos(headDirRad) * (DIMS.bodyH / 2 + DIMS.headR + 4);
  const headSVG = `<circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="${DIMS.headR}" fill="${emotion.color}" data-part="HEAD"/>`;

  const faceSVG = renderFace(headX, headY, emotion.face);
  const auraSVG = renderAura(headX, headY, emotion);

  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" class="pictogram-svg">
    <g class="pen-layer">${penSVG}</g>
    <g class="limbs-back">${leftArm.svg}${leftLeg.svg}</g>
    ${bodySVG}
    <g class="limbs-front">${rightArm.svg}${rightLeg.svg}</g>
    ${headSVG}
    ${faceSVG}
    ${auraSVG}
  </svg>`;
}

// --- 感情の顔アイコン（新規拡張）---------------------------------
function renderFace(hx, hy, face) {
  const eyeY = hy - 3;
  const lEyeX = hx - 6;
  const rEyeX = hx + 6;
  const mouthY = hy + 6;
  switch (face) {
    case "joy":
      return `<g class="face" data-face="joy">
        <path d="M ${lEyeX - 4} ${eyeY} Q ${lEyeX} ${eyeY - 5} ${lEyeX + 4} ${eyeY}" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${rEyeX - 4} ${eyeY} Q ${rEyeX} ${eyeY - 5} ${rEyeX + 4} ${eyeY}" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${hx - 7} ${mouthY} Q ${hx} ${mouthY + 7} ${hx + 7} ${mouthY}" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </g>`;
    case "sad":
      return `<g class="face" data-face="sad">
        <circle cx="${lEyeX}" cy="${eyeY}" r="1.8" fill="#fff"/>
        <circle cx="${rEyeX}" cy="${eyeY}" r="1.8" fill="#fff"/>
        <path d="M ${hx - 7} ${mouthY + 5} Q ${hx} ${mouthY - 2} ${hx + 7} ${mouthY + 5}" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${lEyeX - 2} ${eyeY + 5} L ${lEyeX - 1} ${eyeY + 10}" stroke="#cfe3f5" stroke-width="1.6" stroke-linecap="round"/>
      </g>`;
    case "angry":
      return `<g class="face" data-face="angry">
        <line x1="${lEyeX - 5}" y1="${eyeY - 4}" x2="${lEyeX + 3}" y2="${eyeY - 1}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="${rEyeX + 5}" y1="${eyeY - 4}" x2="${rEyeX - 3}" y2="${eyeY - 1}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${hx - 6} ${mouthY + 3} Q ${hx} ${mouthY - 1} ${hx + 6} ${mouthY + 3}" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </g>`;
    case "surprise":
      return `<g class="face" data-face="surprise">
        <circle cx="${lEyeX}" cy="${eyeY}" r="2.6" fill="#fff"/>
        <circle cx="${rEyeX}" cy="${eyeY}" r="2.6" fill="#fff"/>
        <circle cx="${hx}" cy="${mouthY + 2}" r="3" fill="#fff"/>
      </g>`;
    default:
      return `<g class="face" data-face="normal">
        <circle cx="${lEyeX}" cy="${eyeY}" r="1.8" fill="#fff"/>
        <circle cx="${rEyeX}" cy="${eyeY}" r="1.8" fill="#fff"/>
        <line x1="${hx - 6}" y1="${mouthY + 2}" x2="${hx + 6}" y2="${mouthY + 2}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </g>`;
  }
}

// 感情オーラ（頭部周辺の淡い色リング）。EMOTIONコマンド実行時にCSSアニメーションでフェードする。
function renderAura(hx, hy, emotion) {
  if (emotion.key === "NORMAL") return "";
  return `<circle class="emotion-aura" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${DIMS.headR + 10}" fill="none" stroke="${emotion.color}" stroke-width="3" opacity="0.55"/>`;
}
