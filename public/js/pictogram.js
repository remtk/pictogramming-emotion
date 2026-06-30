/**
 * pictogram.js
 * 人型ピクトグラムの骨格モデルと描画を担当する。
 * 論文「ピクトグラミング」(伊藤, 2018) の人型ピクトグラム仕様(9部位・ISO3864比率)を参考にした簡易実装。
 * 体(BODY) / 左右上腕(LUA,RUA) / 左右前腕(LLA,RLA) / 左右上腿(LUL,RUL) / 左右下腿(LLL,RLL)
 *
 * 新規拡張:
 *  - 感情(EMOTION)を表す顔アイコンと色オーラをピクトグラム頭部付近に表示する。
 *  - 移動中(歩行モーション)は正面ピクトグラムとは別の側面向け歩行シルエットを描画する。
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

// 初期姿勢（各部位の角度オフセットは0 = 気を付けの直立姿勢）
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
    pose: { LUA: 150, LLA: 0, RUA: -150, RLA: 0 },
  },
  SAD: {
    key: "SAD",
    label: "悲しみ",
    color: "#5B7C99",
    face: "sad",
    aliases: ["SAD", "悲しみ", "かなしみ"],
    pose: { LUA: 48, LLA: 14, RUA: -48, RLA: -14 },
  },
  ANGRY: {
    key: "ANGRY",
    label: "いかり",
    color: "#C44536",
    face: "angry",
    aliases: ["ANGRY", "怒り", "いかり"],
    pose: { LUA: 60, LLA: -120, RUA: -60, RLA: 120 },
  },
  SURPRISE: {
    key: "SURPRISE",
    label: "おどろき",
    color: "#8B6BB5",
    face: "surprise",
    aliases: ["SURPRISE", "驚き", "おどろき"],
    pose: { LUA: 170, LLA: 0, RUA: -170, RLA: 0 },
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
// 比率はそのまま、最初のオリジナル値から0.6倍にスケールダウンして表示サイズを小さくしている。
const DIMS = {
  headR: 15.6,
  bodyW: 33,
  bodyH: 60,
  upperArmL: 32.4,
  lowerArmL: 28.8,
  armW: 18,
  upperLegL: 43.2,
  lowerLegL: 40.8,
  legW: 16.8,
};

// 気を付け：腕・脚は真下、付け根は胴体に沿わせる
const NEUTRAL_ANGLES = {
  LUA: 177,
  RUA: 183,
  LUL: 178,
  RUL: 182,
};

/**
 * 現在のpose（角度群）からSVGを描画する。
 * opts.walkPhase が定義されている場合は正面ピクトグラムではなく、
 * 側面向けの歩行専用シルエット(renderWalkingSideSVG)を描画する。
 * @param {object} pose - createInitialPose()形式
 * @param {object} opts - { emotion: 'NORMAL', penPath: [{x,y}], penColor, walkPhase, walkDir }
 */
export function renderSVG(pose, opts = {}) {
  if (opts.walkPhase !== undefined) {
    return renderWalkingSideSVG(pose, opts);
  }

  const emotion = EMOTIONS[opts.emotion] || EMOTIONS.NORMAL;
  const cx = 200 + (pose.x || 0);
  const cy = 200 + (pose.y || 0);
  const bodyAngle = pose.BODY || 0;
  const bodyRad = (bodyAngle * Math.PI) / 180;

  // Limb commands rotate from a neutral standing pictogram pose.
  const limbBase = (k) => (NEUTRAL_ANGLES[k] || 0) + (pose[k] || 0);
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
  const shoulderY = neckY + 20;
  const shoulderOffsetX = DIMS.bodyW * 0.5;
  const hipOffsetX = DIMS.bodyW * 0.18;

  // ローカル座標(体の中心を原点)からワールド座標へ変換（BODY回転を適用）
  function toWorld(localX, localY) {
    return {
      x: cx + localX * Math.cos(bodyRad) - localY * Math.sin(bodyRad),
      y: cy + localX * Math.sin(bodyRad) + localY * Math.cos(bodyRad),
    };
  }

  function limb(originLocalX, originLocalY, angleDeg, len, width, childAngleDeg, childLen, label) {
    const origin = toWorld(originLocalX, originLocalY);
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const exLocal = originLocalX + len * Math.cos(rad);
    const eyLocal = originLocalY + len * Math.sin(rad);
    const elbow = toWorld(exLocal, eyLocal);
    let childPart = "";
    if (childAngleDeg !== undefined) {
      const crad = ((childAngleDeg - 90) * Math.PI) / 180;
      const cexLocal = exLocal + childLen * Math.cos(crad);
      const ceyLocal = eyLocal + childLen * Math.sin(crad);
      const end = toWorld(cexLocal, ceyLocal);
      childPart = `<line x1="${elbow.x.toFixed(1)}" y1="${elbow.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="${emotion.color}" stroke-width="${width - 2}" stroke-linecap="round" data-part="${label}-lower"/>`;
    }
    return {
      svg: `<line x1="${origin.x.toFixed(1)}" y1="${origin.y.toFixed(1)}" x2="${elbow.x.toFixed(1)}" y2="${elbow.y.toFixed(1)}" stroke="${emotion.color}" stroke-width="${width}" stroke-linecap="round" data-part="${label}-upper"/>${childPart}`,
      end: elbow,
    };
  }

  const shoulderLocalY = shoulderY - cy;
  const hipLocalY = hipY - cy;
  const leftArm = limb(-shoulderOffsetX, shoulderLocalY, laUA, DIMS.upperArmL, DIMS.armW, laLA, DIMS.lowerArmL, "LA");
  const rightArm = limb(shoulderOffsetX, shoulderLocalY, raUA, DIMS.upperArmL, DIMS.armW, raLA, DIMS.lowerArmL, "RA");
  const leftLeg = limb(-hipOffsetX, hipLocalY, laUL, DIMS.upperLegL, DIMS.legW, laLL, DIMS.lowerLegL, "LL");
  const rightLeg = limb(hipOffsetX, hipLocalY, raUL, DIMS.upperLegL, DIMS.legW, raLL, DIMS.lowerLegL, "RL");

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

  // 頭: toWorld() で胴体ローカル座標から変換することで BODY 回転と完全に連動させる
  const headLocalY = -(DIMS.bodyH / 2) - DIMS.headR + DIMS.headR * 0.3;
  const headPos = toWorld(0, headLocalY);
  const headSVG = `<circle cx="${headPos.x.toFixed(1)}" cy="${headPos.y.toFixed(1)}" r="${DIMS.headR}" fill="${emotion.color}" data-part="HEAD"/>`;

  const faceSVG = renderFace(headPos.x, headPos.y, emotion.face);
  const auraSVG = renderAura(headPos.x, headPos.y, emotion);

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

// --- 新規拡張: 横向き歩行ピクトグラム ---------------------------------
// 「非常口」ピクトグラムのような側面シルエットで、脚を前後に開閉させながら歩く。
// walkPhase(0〜1)の周期で前脚・後脚・腕の振りをsin波で動かす。
// walkDir(1=右向き/-1=左向き)に応じて全体を左右反転する。
const WALK_DIMS = {
  headR: DIMS.headR,
  torsoLen: DIMS.bodyH * 0.62, // 体幹（首〜股）
  torsoW: DIMS.bodyW * 0.62,
  upperLegL: DIMS.upperLegL,
  lowerLegL: DIMS.lowerLegL,
  legW: DIMS.legW * 0.85,
  upperArmL: DIMS.upperArmL * 0.85,
  lowerArmL: DIMS.lowerArmL * 0.85,
  armW: DIMS.armW * 0.8,
};

function renderWalkingSideSVG(pose, opts) {
  const emotion = EMOTIONS[opts.emotion] || EMOTIONS.NORMAL;
  const dir = opts.walkDir >= 0 ? 1 : -1;
  const cx = 200 + (pose.x || 0);
  const cy = 200 + (pose.y || 0);
  const t = (opts.walkPhase || 0) * Math.PI * 2;

  // 股(hip)を原点とするローカル座標。+x = 進行方向、+y = 下方向。
  const hipLocalY = WALK_DIMS.lowerLegL * 0.55; // 脚の沈み込みを考慮した股の高さ
  const shoulderLocalY = hipLocalY - WALK_DIMS.torsoLen;

  // 脚: 前後逆位相。前に出た脚は伸び、後ろの脚は膝を曲げて地面を蹴る。
  const frontSwing = Math.sin(t) * 40; // 度
  const backSwing = Math.sin(t + Math.PI) * 40;
  const frontKnee = Math.max(0, -Math.sin(t)) * 55; // 前脚が後方にあるときに少し曲げる
  const backKnee = Math.max(0, Math.sin(t + Math.PI * 0.15)) * 60; // 後ろへ蹴り上げる脚を曲げる

  // 腕: 脚と逆位相で自然に振る（右脚が前なら左腕が前）
  const armSwing = Math.sin(t + Math.PI) * 50; // 腕の振りを大きくしました（元は32）

  function rad(deg) {
    return (deg * Math.PI) / 180;
  }

  // ローカル座標(原点=股、+x=進行方向、+y=下)からワールド座標へ。
  // walkDir=-1のときはX軸を反転して左向きにする。
  function toWorld(lx, ly) {
    return { x: cx + lx * dir, y: cy + ly };
  }

  // 角度0度=真下、正の角度=進行方向(前)へ振る、という極座標で関節を伸ばす。
  function joint(originLocal, angleDeg, len) {
    const a = rad(angleDeg);
    const lx = originLocal.lx + len * Math.sin(a);
    const ly = originLocal.ly + len * Math.cos(a);
    return { lx, ly };
  }

  function limbSVG(originLocal, upperAngle, upperLen, kneeBend, lowerLen, width, label) {
    const hipPt = toWorld(originLocal.lx, originLocal.ly);
    const kneeLocal = joint(originLocal, upperAngle, upperLen);
    const kneePt = toWorld(kneeLocal.lx, kneeLocal.ly);
    const lowerAngle = upperAngle + kneeBend * dir * -1; // 膝から下は曲がる方向(常に後方)へ
    const footLocal = joint(kneeLocal, upperAngle - kneeBend, lowerLen);
    const footPt = toWorld(footLocal.lx, footLocal.ly);
    return `<line x1="${hipPt.x.toFixed(1)}" y1="${hipPt.y.toFixed(1)}" x2="${kneePt.x.toFixed(1)}" y2="${kneePt.y.toFixed(1)}" stroke="${emotion.color}" stroke-width="${width}" stroke-linecap="round" data-part="${label}-upper"/>` +
      `<line x1="${kneePt.x.toFixed(1)}" y1="${kneePt.y.toFixed(1)}" x2="${footPt.x.toFixed(1)}" y2="${footPt.y.toFixed(1)}" stroke="${emotion.color}" stroke-width="${(width - 2).toFixed(1)}" stroke-linecap="round" data-part="${label}-lower"/>` +
      `<circle cx="${kneePt.x.toFixed(1)}" cy="${kneePt.y.toFixed(1)}" r="${(width / 2).toFixed(1)}" fill="${emotion.color}"/>`;
  }

  const hipOrigin = { lx: 0, ly: hipLocalY };
  // 後ろ脚(画面奥に描く): 進行方向と逆に振れている方
  const backLeg = limbSVG(hipOrigin, backSwing, WALK_DIMS.upperLegL, backKnee, WALK_DIMS.lowerLegL, WALK_DIMS.legW, "BACK_LEG");
  // 前脚(手前): 進行方向に振れている方
  const frontLeg = limbSVG(hipOrigin, frontSwing, WALK_DIMS.upperLegL, frontKnee, WALK_DIMS.lowerLegL, WALK_DIMS.legW, "FRONT_LEG");

  // 体幹(股〜肩)。わずかに前傾させて歩行の躍動感を出す。
  const torsoLean = 6;
  // joint()は角度0で下に向かうため、上に向かせるために長さを負にする
  const shoulderLocal = joint(hipOrigin, -torsoLean, -WALK_DIMS.torsoLen);
  const hipWorld = toWorld(hipOrigin.lx, hipOrigin.ly);
  const shoulderWorld = toWorld(shoulderLocal.lx, shoulderLocal.ly);
  const torsoSVG = `<line x1="${hipWorld.x.toFixed(1)}" y1="${hipWorld.y.toFixed(1)}" x2="${shoulderWorld.x.toFixed(1)}" y2="${shoulderWorld.y.toFixed(1)}" stroke="${emotion.color}" stroke-width="${WALK_DIMS.torsoW.toFixed(1)}" stroke-linecap="round" data-part="TORSO"/>`;

  // 腕(肩から1本、肘で曲げる)。後ろ脚と同位相で振る(自然な対角線運動)。
  const armOrigin = shoulderLocal;
  // 腕が前に振れる時ほど肘を大きく曲げ、下腕が前・上向きになるようにする
  // limbSVGは第4引数を「後方への曲がり角度」として減算するため、前方に曲げるにはマイナス値を渡す
  const elbowBend = 45 + armSwing * 0.8; 
  const armSVG = limbSVG(armOrigin, -torsoLean + armSwing, WALK_DIMS.upperArmL, -elbowBend, WALK_DIMS.lowerArmL, WALK_DIMS.armW, "ARM");

  // 頭: 肩のさらに上、進行方向をわずかに見る。
  // 同様に長さを負にして上方向に伸ばす
  const headLocal = joint(shoulderLocal, -torsoLean, -WALK_DIMS.headR * 1.15);
  const headWorld = toWorld(headLocal.lx, headLocal.ly);
  const headSVG = `<circle cx="${headWorld.x.toFixed(1)}" cy="${headWorld.y.toFixed(1)}" r="${WALK_DIMS.headR}" fill="${emotion.color}" data-part="HEAD"/>`;

  // 顔は進行方向側に寄せて表示する（側面なので目は省略し、簡易な表情のみ）
  const faceSVG = renderSideFace(headWorld.x, headWorld.y, emotion.face, dir);
  const auraSVG = renderAura(headWorld.x, headWorld.y, emotion);

  // ペン軌跡(ワールド座標、歩行時も継続して描く)
  let penSVG = "";
  if (opts.penPath && opts.penPath.length > 1) {
    const d = opts.penPath
      .map((p, i) => `${i === 0 ? "M" : "L"} ${(200 + p.x).toFixed(1)} ${(200 + p.y).toFixed(1)}`)
      .join(" ");
    penSVG = `<path d="${d}" fill="none" stroke="${opts.penColor || '#2B2B2E'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" class="pictogram-svg">
    <g class="pen-layer">${penSVG}</g>
    <g class="walk-back-leg">${backLeg}</g>
    ${torsoSVG}
    <g class="walk-arm">${armSVG}</g>
    <g class="walk-front-leg">${frontLeg}</g>
    ${headSVG}
    ${faceSVG}
    ${auraSVG}
  </svg>`;
}

// 側面向けの簡易表情（進行方向側に目と口を寄せる）
function renderSideFace(hx, hy, face, dir) {
  const eyeX = hx + dir * (WALK_DIMS.headR * 0.35);
  const eyeY = hy - 1;
  const mouthX = hx + dir * (WALK_DIMS.headR * 0.55);
  const mouthY = hy + 4;
  switch (face) {
    case "joy":
      return `<g class="face" data-face="joy">
        <path d="M ${eyeX - dir * 3} ${eyeY} Q ${eyeX} ${eyeY - 4} ${eyeX + dir * 3} ${eyeY}" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <path d="M ${mouthX - dir * 4} ${mouthY} Q ${mouthX} ${mouthY + 4} ${mouthX + dir * 4} ${mouthY - 1}" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      </g>`;
    case "sad":
      return `<g class="face" data-face="sad">
        <circle cx="${eyeX}" cy="${eyeY}" r="1.6" fill="#fff"/>
        <path d="M ${mouthX - dir * 4} ${mouthY + 2} Q ${mouthX} ${mouthY - 2} ${mouthX + dir * 4} ${mouthY + 2}" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      </g>`;
    case "angry":
      return `<g class="face" data-face="angry">
        <line x1="${eyeX - dir * 4}" y1="${eyeY - 3}" x2="${eyeX + dir * 3}" y2="${eyeY}" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="${mouthX - dir * 4}" y1="${mouthY}" x2="${mouthX + dir * 4}" y2="${mouthY}" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      </g>`;
    case "surprise":
      return `<g class="face" data-face="surprise">
        <circle cx="${eyeX}" cy="${eyeY}" r="2.2" fill="#fff"/>
        <circle cx="${mouthX}" cy="${mouthY + 1}" r="2.6" fill="#fff"/>
      </g>`;
    default:
      return `<g class="face" data-face="normal">
        <circle cx="${eyeX}" cy="${eyeY}" r="1.6" fill="#fff"/>
        <line x1="${mouthX - dir * 3}" y1="${mouthY}" x2="${mouthX + dir * 3}" y2="${mouthY}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      </g>`;
  }
}

// --- 感情の顔アイコン（正面ピクトグラム用・新規拡張）---------------------------------
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
