/**
 * interpreter.js
 * ピクトグラミング風の擬似言語インタプリタ（簡易版）。
 *
 * サポート命令:
 *  ピクトアニメーション系: R <部位> <角度>        ... 静止画ポーズ(瞬間回転)
 *                          RW <部位> <角度> <秒>  ... ウェイト付き回転アニメーション
 *                          M <x> <y>              ... 平行移動(瞬間)
 *                          MW <x> <y> <秒>         ... 平行移動アニメーション
 *                          IM <種類> <dx> <dy>       ... アイテムの平行移動(瞬間)
 *                          IMW <種類> <dx> <dy> <秒> ... アイテムの平行移動アニメーション
 *  ピクトグラフィックス系: PEN UP / PEN DOWN       ... ペンの上げ下げ
 *  共通命令: REPEAT <n> ... END                    ... 繰返し
 *           IF [式] ... END                       ... 条件分岐
 *           LET <変数> <値> (簡易代入。論文の変数定義に相当)
 *           WAIT <秒>                              ... 待機
 *           SP <文字列>                             ... 発話（吹き出し表示）
 *  新規拡張: EMOTION <感情名> [<秒>]                ... 感情表現コマンド
 *           例: EMOTION 喜び / EMOTION JOY 1.5
 *
 * コメントは // 以降を無視。命令と引数は空白区切り。式は[ ]で囲む。
 */

import { resolvePartName, resolveEmotionName, resolveItemName, createInitialPose, EMOTIONS, DIMS, NEUTRAL_ANGLES } from "./pictogram.js";

const POSE_ANGLE_KEYS = ["BODY", "LUA", "LLA", "RUA", "RLA", "LUL", "LLL", "RUL", "RLL"];

export class Interpreter {
  constructor({ onPoseChange, onConsole, onSpeak, onDone, onCommandExecuted, frameDelayMs = 16 }) {
    this.onPoseChange = onPoseChange || (() => {});
    this.onConsole = onConsole || (() => {});
    this.onSpeak = onSpeak || (() => {});
    this.onDone = onDone || (() => {});
    this.onCommandExecuted = onCommandExecuted || (() => {});
    this.frameDelayMs = frameDelayMs;
    this.reset();
  }

  reset() {
    this.pose = createInitialPose();
    this.emotion = "NORMAL";
    this.penDown = false;
    this.penPath = [];
    this.penColor = "#2B2B2E";
    this.items = [];
    this.vars = {};
    this.walkPhase = undefined; // 歩行モーション位相（0〜1、未定義で通常姿勢＝正面ピクトグラム表示）
    this.walkDir = 1; // 歩行中の向き（1=右向き、-1=左向き）
    this._stopRequested = false;
    this._running = false;
  }

  stop() {
    this._stopRequested = true;
  }

  log(msg, level = "info") {
    this.onConsole(msg, level);
  }

  // --- トークナイズ＆構文解析（行ベース簡易パーサ） -----------------
  parse(code) {
    const rawLines = code.split("\n");
    const lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      const commentIdx = line.indexOf("//");
      if (commentIdx >= 0) line = line.slice(0, commentIdx);
      line = line.trim();
      // 全角スペースを半角に正規化
      line = line.replace(/\u3000/g, " ");
      if (line.length === 0) continue;
      lines.push({ text: line, lineNo: i + 1 });
    }
    return this._buildBlocks(lines, 0, lines.length)[0];
  }

  // REPEAT/IF ... END のネストをツリー化する
  _buildBlocks(lines, start, end) {
    const block = [];
    let i = start;
    while (i < end) {
      const { text, lineNo } = lines[i];
      const tokens = this._tokenize(text);
      const head = tokens[0]?.toUpperCase();

      if (head === "REPEAT") {
        const count = tokens[1];
        // 対応するENDを探す
        let depth = 1;
        let j = i + 1;
        while (j < end && depth > 0) {
          const h2 = this._tokenize(lines[j].text)[0]?.toUpperCase();
          if (h2 === "REPEAT" || h2 === "IF") depth++;
          if (h2 === "END") depth--;
          if (depth === 0) break;
          j++;
        }
        if (j >= end) throw new SyntaxErrorWithLine("REPEATに対応するENDが見つかりません", lineNo);
        const body = this._buildBlocks(lines, i + 1, j)[0];
        block.push({ type: "REPEAT", count, body, lineNo });
        i = j + 1;
      } else if (head === "IF") {
        const cond = text.slice(text.indexOf("IF") + 2).trim();
        let depth = 1;
        let j = i + 1;
        while (j < end && depth > 0) {
          const h2 = this._tokenize(lines[j].text)[0]?.toUpperCase();
          if (h2 === "REPEAT" || h2 === "IF") depth++;
          if (h2 === "END") depth--;
          if (depth === 0) break;
          j++;
        }
        if (j >= end) throw new SyntaxErrorWithLine("IFに対応するENDが見つかりません", lineNo);
        const body = this._buildBlocks(lines, i + 1, j)[0];
        block.push({ type: "IF", cond, body, lineNo });
        i = j + 1;
      } else if (head === "END") {
        throw new SyntaxErrorWithLine("対応するREPEAT/IFのない END です", lineNo);
      } else {
        block.push({ type: "CMD", tokens, lineNo, raw: text });
        i++;
      }
    }
    return [block];
  }

  // 空白区切り。ただし [ ... ] は1引数として保持する。
  _tokenize(text) {
    const tokens = [];
    let i = 0;
    const str = text;
    while (i < str.length) {
      while (i < str.length && /\s/.test(str[i])) i++;
      if (i >= str.length) break;
      if (str[i] === "[") {
        const close = str.indexOf("]", i);
        if (close === -1) throw new Error("式の ] が見つかりません: " + str);
        tokens.push(str.slice(i, close + 1));
        i = close + 1;
      } else if (str[i] === '"') {
        const close = str.indexOf('"', i + 1);
        if (close === -1) throw new Error('文字列の " が閉じられていません: ' + str);
        tokens.push(str.slice(i, close + 1));
        i = close + 1;
      } else {
        let j = i;
        while (j < str.length && !/\s/.test(str[j])) j++;
        tokens.push(str.slice(i, j));
        i = j;
      }
    }
    return tokens;
  }

  // --- 式評価 -------------------------------------------------------
  evalExpr(token) {
    let t = token.trim();
    let isBracket = false;
    if (t.startsWith("[") && t.endsWith("]")) {
      t = t.slice(1, -1).trim();
      isBracket = true;
    }
    if (t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1);
    }
    // 全角記号を半角化
    t = t
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/＋/g, "+")
      .replace(/[－−‐—–]/g, "-")
      .replace(/＊/g, "*")
      .replace(/／/g, "/")
      .replace(/＞/g, ">")
      .replace(/＜/g, "<")
      .replace(/＝/g, "=");

    if (!isBracket) {
      // 単純な数値や変数名
      if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
      if (t in this.vars) return this.vars[t];
      return t; // 文字列扱い（部位名や感情名など）
    }

    // 変数参照を置換
    const replaced = t.replace(/[A-Za-zあ-んア-ヶ一-龥_][A-Za-zあ-んア-ヶ一-龥0-9_]*/g, (m) => {
      if (m in this.vars) return String(this.vars[m]);
      if (["true", "false"].includes(m)) return m;
      return m; // 未知の識別子はそのまま（評価時にエラーになる）
    });
    // 許可文字のみで構成されているか簡易チェック（XSS的な実行防止）
    if (!/^[0-9+\-*/%.()<>=! &|]+$/.test(replaced)) {
      throw new Error("不正な式です: " + token);
    }
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${replaced});`);
      return fn();
    } catch (e) {
      throw new Error("式の評価に失敗しました: " + token);
    }
  }

  // --- 実行 -----------------------------------------------------------
  async run(code) {
    this.reset();
    this._running = true;
    let ast;
    try {
      ast = this.parse(code);
    } catch (e) {
      this.log(`構文エラー (${e.lineNo ?? "?"}行目): ${e.message}`, "error");
      this.onDone();
      return;
    }
    try {
      await this._execBlock(ast);
      this.log("実行完了", "ok");
    } catch (e) {
      if (e instanceof StopRequested) {
        this.log("停止しました", "warn");
      } else {
        this.log(`実行エラー: ${e.message}`, "error");
      }
    } finally {
      this._running = false;
      this.onDone();
    }
  }

  async _execBlock(block) {
    for (const node of block) {
      if (this._stopRequested) throw new StopRequested();
      if (node.type === "REPEAT") {
        const n = Math.round(this.evalExpr(node.count));
        for (let k = 0; k < n; k++) {
          if (this._stopRequested) throw new StopRequested();
          await this._execBlock(node.body);
        }
      } else if (node.type === "IF") {
        let condVal;
        try {
          condVal = this.evalExpr(node.cond);
        } catch (e) {
          throw new ExecErrorWithLine(e.message, node.lineNo);
        }
        if (condVal) {
          await this._execBlock(node.body);
        }
      } else {
        await this._execCmd(node);
      }
    }
  }

  async _execCmd(node) {
    const [head, ...args] = node.tokens;
    const cmd = head.toUpperCase();
    try {
      switch (cmd) {
        case "R":
          this._opRotate(args, false);
          break;
        case "RW":
          await this._opRotate(args, true);
          break;
        case "M":
          this._opMove(args, false);
          break;
        case "MW":
          await this._opMove(args, true);
          break;
        case "PEN":
          await this._opPen(args);
          break;
        case "LET":
          this._opLet(args);
          break;
        case "WAIT":
          await this._sleep(this.evalExpr(args[0]) * 1000);
          break;
        case "SP":
          this.onSpeak(this.evalExpr(args[0]));
          await this._sleep(800);
          break;
        case "EMOTION":
          await this._opEmotion(args);
          break;
        case "ITEM":
          this._opItem(args);
          break;
        case "IM":
          this._opItemMove(args, false);
          break;
        case "IMW":
          await this._opItemMove(args, true);
          break;
        case "IK":
          this._opIK(args, false);
          break;
        case "IKW":
          await this._opIK(args, true);
          break;
        default:
          throw new Error(`未知の命令です: ${head}`);
      }
    } catch (e) {
      throw new ExecErrorWithLine(e.message, node.lineNo);
    }
  }

  _opLet(args) {
    const [name, valueToken] = args;
    if (!name || valueToken === undefined) throw new Error("LET 変数名 値 の形式で指定してください");
    this.vars[name] = this.evalExpr(valueToken);
  }

  _opRotate(args, animate) {
    if (args.length < 2) throw new Error("R/RW 部位 角度 [秒] の形式で指定してください");
    const partToken = args[0];
    const part = resolvePartName(partToken);
    if (!part) throw new Error(`不明な部位名です: ${partToken}`);
    const angle = this.evalExpr(args[1]);
    if (typeof angle !== "number" || Number.isNaN(angle)) throw new Error("角度は数値で指定してください");

    if (!animate) {
      this.pose[part] = (this.pose[part] || 0) + angle;
      this._emit();
      return Promise.resolve();
    }
    const duration = args[2] !== undefined ? this.evalExpr(args[2]) : 1;
    const startVal = this.pose[part] || 0;
    const targetVal = startVal + angle;
    return this._animateValue(duration, (progress) => {
      this.pose[part] = startVal + (targetVal - startVal) * progress;
      this._emit();
    });
  }

  // M/MW: 体全体の平行移動。
  // ペンが下がっている間は「歩行モーション」(walkPhase)を進行させ、
  // pictogram.js 側で側面向きの歩行ピクトグラムに切り替えて描画する。
  // 進行方向の左右(dxの符号)を walkDir として保持し、側面ピクトグラムの向きに反映する。
  _opMove(args, animate) {
    if (args.length < 2) throw new Error("M/MW x y [秒] の形式で指定してください");
    const x = this.evalExpr(args[0]);
    const y = this.evalExpr(args[1]);

    const bodyAngle = this.pose.BODY || 0;
    const bodyRad = (bodyAngle * Math.PI) / 180;
    const dx = x * Math.cos(bodyRad) - y * Math.sin(bodyRad);
    const dy = x * Math.sin(bodyRad) + y * Math.cos(bodyRad);

    this.onCommandExecuted("MOVE", { x, y, dx, dy, penDown: this.penDown });

    if (!animate) {
      this.pose.x = (this.pose.x || 0) + dx;
      this.pose.y = (this.pose.y || 0) + dy;
      this._emit();
      return Promise.resolve();
    }

    const duration = args[2] !== undefined ? this.evalExpr(args[2]) : 1;
    const startX = this.pose.x || 0;
    const startY = this.pose.y || 0;
    const targetX = startX + dx;
    const targetY = startY + dy;

    if (this.penDown && Math.abs(dx) > 0.001) {
      this.walkDir = dx >= 0 ? 1 : -1;
    }
    const walkStart = Math.random(); // 複数回のMWで位相が揃うのを避ける

    return this._animateValue(duration, (progress) => {
      this.pose.x = startX + (targetX - startX) * progress;
      this.pose.y = startY + (targetY - startY) * progress;
      if (this.penDown) {
        this.walkPhase = (walkStart + progress * 3) % 1; // 移動中は3周期分歩く
      }
      this._emit();
    });
  }

  async _opPen(args) {
    const mode = (args[0] || "").toUpperCase();
    this.onCommandExecuted("PEN", { mode });
    if (mode === "UP") {
      this.penDown = false;
      this.walkPhase = undefined;
      this.pose.BODY = 0;
    } else if (mode === "DOWN") {
      this.penDown = true;
      this.penPath.push({ x: this.pose.x, y: this.pose.y });
    } else if (mode === "COLOR") {
      this.penColor = this.evalExpr(args[1]);
    } else {
      throw new Error("PEN UP / PEN DOWN / PEN COLOR <色> を指定してください");
    }
    this._emit();
  }

  // 新規拡張: 感情表現コマンド本体。
  // EMOTION <感情名> [<秒>] : 感情を変更し、対応するプリセットポーズへ秒数をかけて遷移する。
  async _opEmotion(args) {
    if (args.length < 1) throw new Error("EMOTION 感情名 [秒] の形式で指定してください");
    const emoToken = args[0].replace(/^"|"$/g, "");
    const key = resolveEmotionName(emoToken);
    if (!key) throw new Error(`不明な感情名です: ${emoToken}（喜び/悲しみ/怒り/驚き/普通 から指定）`);
    const duration = args[1] !== undefined ? this.evalExpr(args[1]) : 0.6;
    this.emotion = key;
    const emoDef = EMOTIONS[key];

    this.onCommandExecuted("EMOTION", { emotion: key, label: emoDef.label, duration });

    const neutralPose = createInitialPose();
    const targetPose = { ...neutralPose, ...(emoDef.pose || {}) };
    const startPose = { ...this.pose };
    if (duration <= 0) {
      for (const k of POSE_ANGLE_KEYS) {
        this.pose[k] = targetPose[k];
      }
      this._emit();
      return;
    }
    await this._animateValue(duration, (progress) => {
      for (const k of POSE_ANGLE_KEYS) {
        this.pose[k] = startPose[k] + (targetPose[k] - startPose[k]) * progress;
      }
      this._emit();
    });
  }

  _opItem(args) {
    if (args.length < 1) throw new Error("ITEM 種類 [x] [y] [scale] または ITEM CLEAR を指定してください");
    const subCmd = args[0].toUpperCase();
    if (subCmd === "CLEAR") {
      this.items = [];
      this.onCommandExecuted("ITEM_CLEAR", {});
      this._emit();
      return;
    }
    
    const itemKey = resolveItemName(args[0].replace(/^"|"$/g, ""));
    if (!itemKey) throw new Error(`不明なアイテム名です: ${args[0]}`);
    
    const x = args[1] !== undefined ? this.evalExpr(args[1]) : 0;
    const y = args[2] !== undefined ? this.evalExpr(args[2]) : 0;
    const scale = args[3] !== undefined ? this.evalExpr(args[3]) : 1;
    
    this.items.push({ type: itemKey, x, y, scale });
    this.onCommandExecuted("ITEM", { type: itemKey, x, y, scale });
    this._emit();
  }

  _opItemMove(args, animate) {
    if (args.length < 3) throw new Error("IM/IMW 種類 x y [秒] の形式で指定してください");
    const itemKeyToken = args[0].replace(/^"|"$/g, "");
    const itemKey = resolveItemName(itemKeyToken);
    if (!itemKey) throw new Error(`不明なアイテム名です: ${itemKeyToken}`);
    
    // items配列の後ろから該当の種類のアイテムを探す
    const idx = [...this.items].reverse().findIndex(i => i.type === itemKey);
    if (idx < 0) throw new Error(`配置されていないアイテムです: ${itemKeyToken}`);
    const actualIdx = this.items.length - 1 - idx;
    const item = this.items[actualIdx];

    const dx = this.evalExpr(args[1]);
    const dy = this.evalExpr(args[2]);

    this.onCommandExecuted(animate ? "IMW" : "IM", { type: itemKey, dx, dy });

    if (!animate) {
      item.x += dx;
      item.y += dy;
      this._emit();
      return Promise.resolve();
    }

    const duration = args[3] !== undefined ? this.evalExpr(args[3]) : 1;
    const startX = item.x;
    const startY = item.y;
    const targetX = startX + dx;
    const targetY = startY + dy;

    return this._animateValue(duration, (progress) => {
      item.x = startX + (targetX - startX) * progress;
      item.y = startY + (targetY - startY) * progress;
      this._emit();
    });
  }

  // --- インバース・キネマティクス (IK) ---
  _opIK(args, animate) {
    if (args.length < 3) throw new Error("IK/IKW 腕・脚 x y [秒] の形式で指定してください");
    const targetLimb = args[0];
    const x = this.evalExpr(args[1]);
    const y = this.evalExpr(args[2]);

    const cx = 200 + (this.pose.x || 0);
    const cy = 200 + (this.pose.y || 0);
    const bodyRad = ((this.pose.BODY || 0) * Math.PI) / 180;
    
    const txWorld = 200 + x;
    const tyWorld = 200 + y;
    
    const dx = txWorld - cx;
    const dy = tyWorld - cy;
    
    const localTx = dx * Math.cos(-bodyRad) - dy * Math.sin(-bodyRad);
    const localTy = dx * Math.sin(-bodyRad) + dy * Math.cos(-bodyRad);

    const neckY = -DIMS.bodyH / 2;
    const hipY = DIMS.bodyH / 2;
    const shoulderY = neckY + 20;
    const shoulderOffsetX = DIMS.bodyW * 0.5;
    const hipOffsetX = DIMS.bodyW * 0.18;

    let ox, oy, L1, L2, upperKey, lowerKey, isRight;
    const targetAlias = targetLimb.trim().toUpperCase();

    if (["LA", "左腕", "ひだりうで"].includes(targetAlias)) {
      ox = -shoulderOffsetX; oy = shoulderY;
      L1 = DIMS.upperArmL; L2 = DIMS.lowerArmL;
      upperKey = "LUA"; lowerKey = "LLA"; isRight = false;
    } else if (["RA", "右腕", "みぎうで"].includes(targetAlias)) {
      ox = shoulderOffsetX; oy = shoulderY;
      L1 = DIMS.upperArmL; L2 = DIMS.lowerArmL;
      upperKey = "RUA"; lowerKey = "RLA"; isRight = true;
    } else if (["LL", "左脚", "ひだりあし"].includes(targetAlias)) {
      ox = -hipOffsetX; oy = hipY;
      L1 = DIMS.upperLegL; L2 = DIMS.lowerLegL;
      upperKey = "LUL"; lowerKey = "LLL"; isRight = false;
    } else if (["RL", "右脚", "みぎあし"].includes(targetAlias)) {
      ox = hipOffsetX; oy = hipY;
      L1 = DIMS.upperLegL; L2 = DIMS.lowerLegL;
      upperKey = "RUL"; lowerKey = "RLL"; isRight = true;
    } else {
      throw new Error(`IKの部位は 左腕, 右腕, 左脚, 右脚 のいずれかを指定してください`);
    }

    const vx = localTx - ox;
    const vy = localTy - oy;
    let D = Math.sqrt(vx * vx + vy * vy);

    if (D > L1 + L2) D = L1 + L2 - 0.01;

    const theta = Math.atan2(vy, vx);

    const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
    const beta = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));

    const bendDir = isRight ? -1 : 1;
    
    const upperRad = theta + bendDir * alpha;
    const lowerRadRelative = bendDir * (Math.PI - beta);

    const targetUpperDeg = (upperRad * 180) / Math.PI + 90;
    const targetLowerDeg = (lowerRadRelative * 180) / Math.PI;

    let angleUpper = targetUpperDeg - (NEUTRAL_ANGLES[upperKey] || 0);
    // 正規化 (-180 〜 180)
    while (angleUpper > 180) angleUpper -= 360;
    while (angleUpper < -180) angleUpper += 360;

    const angleLower = targetLowerDeg;

    if (!animate) {
      this.pose[upperKey] = angleUpper;
      this.pose[lowerKey] = angleLower;
      this._emit();
      return Promise.resolve();
    }
    
    const duration = args[3] !== undefined ? this.evalExpr(args[3]) : 1;
    const startUpper = this.pose[upperKey] || 0;
    const startLower = this.pose[lowerKey] || 0;

    // 最短距離で回転させるための補正
    let diffUpper = angleUpper - startUpper;
    while (diffUpper > 180) diffUpper -= 360;
    while (diffUpper < -180) diffUpper += 360;
    const finalUpper = startUpper + diffUpper;

    return this._animateValue(duration, (progress) => {
      this.pose[upperKey] = startUpper + (finalUpper - startUpper) * progress;
      this.pose[lowerKey] = startLower + (angleLower - startLower) * progress;
      this._emit();
    });
  }

  async _animateValue(duration, frameFn) {
    if (duration <= 0) {
      frameFn(1);
      return;
    }
    const totalMs = duration * 1000;
    const startTime = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        if (this._stopRequested) {
          resolve();
          return;
        }
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / totalMs);
        frameFn(progress);
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  _emit() {
    this.onPoseChange({
      pose: { ...this.pose },
      emotion: this.emotion,
      penDown: this.penDown,
      penPath: [...this.penPath],
      penColor: this.penColor,
      items: [...this.items],
      walkPhase: this.walkPhase,
      walkDir: this.walkDir,
    });
    if (this.penDown) {
      this.penPath.push({ x: this.pose.x, y: this.pose.y });
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = () => {
        if (this._stopRequested || performance.now() - start >= ms) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
}

class SyntaxErrorWithLine extends Error {
  constructor(message, lineNo) {
    super(message);
    this.lineNo = lineNo;
  }
}
class ExecErrorWithLine extends Error {
  constructor(message, lineNo) {
    super(`${message} (${lineNo}行目)`);
    this.lineNo = lineNo;
  }
}
class StopRequested extends Error {}
