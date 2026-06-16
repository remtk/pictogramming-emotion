import test from "node:test";
import assert from "node:assert";
import {
  resolvePartName,
  resolveEmotionName,
  createInitialPose,
  EMOTIONS,
} from "../public/js/pictogram.js";

test("resolvePartName: 英語/日本語/ひらがな表記を解決できる", () => {
  assert.strictEqual(resolvePartName("LUA"), "LUA");
  assert.strictEqual(resolvePartName("左上腕"), "LUA");
  assert.strictEqual(resolvePartName("ひだりじょうわん"), "LUA");
  assert.strictEqual(resolvePartName("存在しない部位"), null);
});

test("resolveEmotionName: 感情名を解決できる(新規拡張)", () => {
  assert.strictEqual(resolveEmotionName("JOY"), "JOY");
  assert.strictEqual(resolveEmotionName("喜び"), "JOY");
  assert.strictEqual(resolveEmotionName("よろこび"), "JOY");
  assert.strictEqual(resolveEmotionName("悲しみ"), "SAD");
  assert.strictEqual(resolveEmotionName("怒り"), "ANGRY");
  assert.strictEqual(resolveEmotionName("驚き"), "SURPRISE");
  assert.strictEqual(resolveEmotionName("普通"), "NORMAL");
  assert.strictEqual(resolveEmotionName("謎"), null);
});

test("createInitialPose: 初期姿勢はすべて角度0", () => {
  const pose = createInitialPose();
  assert.strictEqual(pose.BODY, 0);
  assert.strictEqual(pose.LUA, 0);
  assert.strictEqual(pose.x, 0);
  assert.strictEqual(pose.y, 0);
});

test("EMOTIONS: 5種の感情が定義されている", () => {
  const keys = Object.keys(EMOTIONS);
  assert.deepStrictEqual(keys.sort(), ["ANGRY", "JOY", "NORMAL", "SAD", "SURPRISE"].sort());
  for (const k of keys) {
    assert.ok(EMOTIONS[k].color, `${k} に color が必要`);
    assert.ok(EMOTIONS[k].face, `${k} に face が必要`);
  }
});
