import test from "node:test";
import assert from "node:assert";

// ブラウザAPIをNode環境用に最小ポリフィル（アニメーション系命令は秒数0扱いで即時完了させる）
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { Interpreter } = await import("../public/js/interpreter.js");

function makeInterpreter() {
  const consoleLogs = [];
  const poseHistory = [];
  const speeches = [];
  let done = false;
  const interp = new Interpreter({
    onPoseChange: (s) => poseHistory.push(s),
    onConsole: (msg, level) => consoleLogs.push({ msg, level }),
    onSpeak: (t) => speeches.push(t),
    onDone: () => {
      done = true;
    },
  });
  return { interp, consoleLogs, poseHistory, speeches, isDone: () => done };
}

test("R命令: 部位を瞬時に回転できる", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run("R LUA -90");
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.pose.LUA, -90);
});

test("日本語表記の部位名を解決して回転できる", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run("R 左上腕 45");
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.pose.LUA, 45);
});

test("REPEAT命令: n回繰り返す", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run(`LET COUNT 0
REPEAT 3
  R BODY [COUNT * 10]
  LET COUNT [COUNT + 1]
END`);
  // 3回ループ後、最後の回転は (0,1,2)*10 のうち2*10=20度
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.pose.BODY, 20);
});

test("IF命令: 条件が真のときのみ実行される", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run(`LET X 10
IF [X >= 5]
  R BODY 30
END`);
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.pose.BODY, 30);
});

test("IF命令: 条件が偽のときは実行されない", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run(`LET X 1
IF [X >= 5]
  R BODY 30
END`);
  // poseHistoryが空 = 何も実行されていない
  assert.strictEqual(poseHistory.length, 0);
});

test("EMOTION命令(新規拡張): 感情名を解決し状態が変化する", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run("EMOTION 喜び 0");
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.emotion, "JOY");
});

test("EMOTION命令(新規拡張): 悲しみは左右対称な腕下ろしポーズになる", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run("EMOTION 悲しみ 0");
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.emotion, "SAD");
  assert.strictEqual(last.pose.BODY, 0);
  assert.strictEqual(last.pose.LUA, -312);
  assert.strictEqual(last.pose.RUA, -48);
});

test("EMOTION命令(新規拡張): 普通へ戻すとポーズも初期姿勢に戻る", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run(`EMOTION 悲しみ 0
EMOTION 普通 0`);
  const last = poseHistory[poseHistory.length - 1];
  assert.strictEqual(last.emotion, "NORMAL");
  assert.strictEqual(last.pose.LUA, 0);
  assert.strictEqual(last.pose.LLA, 0);
});

test("EMOTION命令(新規拡張): 不明な感情名はエラーになる", async () => {
  const { consoleLogs, interp } = makeInterpreter();
  await interp.run("EMOTION 知らない感情");
  const hasError = consoleLogs.some((l) => l.level === "error");
  assert.ok(hasError, "エラーログが出力されるはず");
});

test("SP命令: 吹き出しテキストが渡される", async () => {
  const { interp, speeches } = makeInterpreter();
  await interp.run('SP "こんにちは"');
  assert.deepStrictEqual(speeches, ["こんにちは"]);
});

test("PEN DOWN/UP: 軌跡が記録される", async () => {
  const { interp, poseHistory } = makeInterpreter();
  await interp.run(`PEN DOWN
M 10 0
M 10 10
PEN UP`);
  const last = poseHistory[poseHistory.length - 1];
  assert.ok(last.penPath.length >= 2);
});

test("未知の命令は構文エラーではなく実行エラーとして報告される", async () => {
  const { consoleLogs } = await (async () => {
    const ctx = makeInterpreter();
    await ctx.interp.run("FOOBAR 1 2");
    return ctx;
  })();
  const hasError = consoleLogs.some((l) => l.level === "error" && l.msg.includes("FOOBAR"));
  assert.ok(hasError);
});

test("REPEATに対応するENDがない場合は構文エラー", async () => {
  const { consoleLogs } = makeInterpreter();
  const ctx = makeInterpreter();
  await ctx.interp.run("REPEAT 3\nR BODY 10");
  const hasError = ctx.consoleLogs.some((l) => l.level === "error");
  assert.ok(hasError);
});
