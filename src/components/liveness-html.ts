/**
 * The page behind the selfie check. It opens the front camera, follows the face with Google's MediaPipe Face
 * Landmarker (loaded from jsDelivr / Google storage, so the phone needs internet), and walks the person through:
 *   1. look straight at the camera (frame is captured),
 *   2. turn the head to one side, then the other, in an order the app picks at random.
 * It reports progress to the app as JSON messages and finishes with three JPEGs.
 *
 * While the person looks straight ahead it also runs Minivision's Silent-Face-Anti-Spoofing models (Apache-2.0; MiniFASNetV2
 * and MiniFASNetV1SE, converted to ONNX and run with ONNX Runtime Web) on a few frames, to tell a live face from a photo
 * or a screen held up to the camera. The app sends the two model files in after the page loads.
 *
 * Head direction comes from the face model's own pose matrix. Its yaw is positive when the nose moves toward
 * the RIGHT of the un-mirrored camera image, which is the person's LEFT. Checked with real turned faces.
 *
 * Rules for editing: no backticks and no dollar-brace anywhere inside the string, so it stays a plain literal.
 */
export const LIVENESS_BASE_URL = 'https://family-circle.invalid/';

export const LIVENESS_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #000; }
</style>
</head>
<body>
<video id="v" playsinline muted autoplay></video>
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js"></script>
<script type="module">
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs';

var MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
var WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';

// Thresholds. Degrees are of head yaw; sizes are the face against the shorter side of the frame.
var TURN_DEG = 20;          // how far the head must turn to count
var CENTER_DEG = 10;        // how straight it must be to count as looking ahead
var PITCH_ROLL_MAX = 18;
var SIZE_MIN = 0.38, SIZE_MAX = 0.85;
var OFF_CENTER_X = 0.14, OFF_CENTER_Y = 0.2;
var ALIGN_FRAMES = 10;      // consecutive good frames before the straight-ahead frame is taken
var TURN_FRAMES = 3;        // consecutive frames past TURN_DEG
var RECENTER_FRAMES = 5;
var FACE_LOST_MS = 3000;
var MIN_LUMA = 55;
var ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
var SPOOF_FRAMES = 3, SPOOF_MAX = 6, SPOOF_REAL_MIN = 0.6, SPOOF_WAIT_MS = 25000, SPOOF_GROW = 1.1;

var video = document.getElementById('v');
var landmarker = null;
var stream = null;
var running = false;
var lastTime = -1;
var lastLumaCheck = 0;
var luma = 128;
var lastSent = 0;
var lastKey = '';

var run = null; // the check in progress
var fas = null, fasState = 'none', fasBusy = false, fasChunks = {}, fasWanted = false; // the anti-spoofing models

function post(msg) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
}
function fail(code, message) { post({ type: 'error', code: code, message: message }); }

function frameSource() { return window.__frameSource ? window.__frameSource() : video; }
function dims(el) { return el.videoWidth ? [el.videoWidth, el.videoHeight] : [el.width, el.height]; }

function capture() {
  var el = frameSource();
  var d = dims(el);
  var scale = Math.min(1, 960 / Math.max(d[0], d[1]));
  var c = document.createElement('canvas');
  c.width = Math.round(d[0] * scale);
  c.height = Math.round(d[1] * scale);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
}

function measureLight(el) {
  var now = performance.now();
  if (now - lastLumaCheck < 500) return;
  lastLumaCheck = now;
  var c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  var g = c.getContext('2d');
  g.drawImage(el, 0, 0, 24, 24);
  var px = g.getImageData(0, 0, 24, 24).data, sum = 0;
  for (var i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  luma = sum / (px.length / 4);
}

// What the model says about the face in this frame.
function read(res, el) {
  var faces = res.faceLandmarks ? res.faceLandmarks.length : 0;
  if (faces === 0) return { faces: 0 };
  if (faces > 1) return { faces: faces };
  var lm = res.faceLandmarks[0];
  var minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (var i = 0; i < lm.length; i++) {
    if (lm[i].x < minX) minX = lm[i].x; if (lm[i].x > maxX) maxX = lm[i].x;
    if (lm[i].y < minY) minY = lm[i].y; if (lm[i].y > maxY) maxY = lm[i].y;
  }
  var d = dims(el);
  var size = Math.max((maxX - minX) * d[0], (maxY - minY) * d[1]) / Math.min(d[0], d[1]);
  var m = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0] ? res.facialTransformationMatrixes[0].data : null;
  var yaw = 0, pitch = 0, roll = 0;
  if (m) {
    var R = function (r, c) { return m[c * 4 + r]; };
    yaw = Math.atan2(-R(2, 0), Math.hypot(R(2, 1), R(2, 2))) * 180 / Math.PI;
    pitch = Math.atan2(R(2, 1), R(2, 2)) * 180 / Math.PI;
    roll = Math.atan2(R(1, 0), R(0, 0)) * 180 / Math.PI;
    if (pitch > 90) pitch -= 180; else if (pitch < -90) pitch += 180;
  }
  return { faces: 1, size: size, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, yaw: yaw, pitch: pitch, roll: roll, box: [minX * d[0], minY * d[1], (maxX - minX) * d[0], (maxY - minY) * d[1]] };
}

function progress(phase, prompt, hint, f, extra) {
  var now = performance.now();
  var key = phase + '|' + prompt + '|' + hint;
  if (key === lastKey && now - lastSent < 150) return;
  lastKey = key; lastSent = now;
  var msg = { type: 'progress', phase: phase, prompt: prompt, hint: hint, faceOk: !!(f && f.faces === 1), yaw: f && f.faces === 1 ? Math.round(f.yaw) : null,
    step: run ? run.stepIndex : 0, total: run ? run.challenges.length + 1 : 3, direction: extra && extra.direction ? extra.direction : null };
  post(msg);
}

// ---- live-face check: Minivision's Silent-Face-Anti-Spoofing, written to match the project's own Python code.
// Crop the face box enlarged by 2.7 and by 4.0 (kept inside the picture), resize each to 80x80 with plain bilinear
// sampling (cv2.resize's default), feed BGR values 0..255 (their to_tensor does not divide by 255) to MiniFASNetV2 and
// MiniFASNetV1SE, add the two softmax results. Class 1 is a live face; classes 0 and 2 are spoofs.
function fasBox(srcW, srcH, bbox, scale) {
  var x = bbox[0], y = bbox[1], bw = bbox[2], bh = bbox[3];
  scale = Math.min((srcH - 1) / bh, Math.min((srcW - 1) / bw, scale));
  var nw = bw * scale, nh = bh * scale, cx = bw / 2 + x, cy = bh / 2 + y;
  var lx = cx - nw / 2, ly = cy - nh / 2, rx = cx + nw / 2, ry = cy + nh / 2;
  if (lx < 0) { rx -= lx; lx = 0; }
  if (ly < 0) { ry -= ly; ly = 0; }
  if (rx > srcW - 1) { lx -= rx - srcW + 1; rx = srcW - 1; }
  if (ry > srcH - 1) { ly -= ry - srcH + 1; ry = srcH - 1; }
  return [Math.trunc(lx), Math.trunc(ly), Math.trunc(rx), Math.trunc(ry)];
}
function fasResize(src, sw, sh, dw, dh) {
  var out = new Float32Array(dw * dh * 3), sx = sw / dw, sy = sh / dh, x, y, c;
  for (y = 0; y < dh; y++) {
    var fy = (y + 0.5) * sy - 0.5, y0 = Math.floor(fy), wy = fy - y0, y1 = y0 + 1;
    if (y0 < 0) { y0 = 0; wy = 0; if (y1 < 0) y1 = 0; }
    if (y1 > sh - 1) y1 = sh - 1;
    if (y0 > sh - 1) y0 = sh - 1;
    for (x = 0; x < dw; x++) {
      var fx = (x + 0.5) * sx - 0.5, x0 = Math.floor(fx), wx = fx - x0, x1 = x0 + 1;
      if (x0 < 0) { x0 = 0; wx = 0; if (x1 < 0) x1 = 0; }
      if (x1 > sw - 1) x1 = sw - 1;
      if (x0 > sw - 1) x0 = sw - 1;
      for (c = 0; c < 3; c++) {
        var a = src[(y0 * sw + x0) * 4 + c], b = src[(y0 * sw + x1) * 4 + c], d = src[(y1 * sw + x0) * 4 + c], e = src[(y1 * sw + x1) * 4 + c];
        out[(y * dw + x) * 3 + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return out;
}
function fasPatch(elm, d, bbox, scale) {
  var box = fasBox(d[0], d[1], bbox, scale), w = box[2] - box[0] + 1, h = box[3] - box[1] + 1;
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(elm, box[0], box[1], w, h, 0, 0, w, h);
  var rgb = fasResize(g.getImageData(0, 0, w, h).data, w, h, 80, 80), t = new Float32Array(3 * 80 * 80), i;
  for (i = 0; i < 6400; i++) { t[i] = rgb[i * 3 + 2]; t[6400 + i] = rgb[i * 3 + 1]; t[12800 + i] = rgb[i * 3]; } // B, G, R planes
  return t;
}
function softmax3(v) { var m = Math.max(v[0], v[1], v[2]), e0 = Math.exp(v[0] - m), e1 = Math.exp(v[1] - m), e2 = Math.exp(v[2] - m), s = e0 + e1 + e2; return [e0 / s, e1 / s, e2 / s]; }
async function fasScore(elm, box) {
  var d = dims(elm), gw = box[2] * SPOOF_GROW, gh = box[3] * SPOOF_GROW;
  var bbox = [Math.round(box[0] + box[2] / 2 - gw / 2), Math.round(box[1] + box[3] / 2 - gh / 2), Math.round(gw), Math.round(gh)];
  var sum = [0, 0, 0], i;
  for (i = 0; i < fas.length; i++) {
    var out = await fas[i].session.run({ input: new window.ort.Tensor('float32', fasPatch(elm, d, bbox, fas[i].scale), [1, 3, 80, 80]) });
    var p = softmax3(out.logits.data);
    sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
  }
  return sum[1] / fas.length; // the chance the face is live, 0..1
}
function b64Bytes(b64) { var bin = atob(b64), out = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function addModelChunk(c) {
  fasWanted = true;
  var list = fasChunks[c.name] = fasChunks[c.name] || { parts: [], total: c.total, scale: c.scale };
  list.parts[c.index] = c.data;
  var ready = true, k;
  for (k in fasChunks) { var n = 0, q; for (q = 0; q < fasChunks[k].total; q++) if (fasChunks[k].parts[q]) n++; if (n < fasChunks[k].total) ready = false; }
  if (ready && Object.keys(fasChunks).length >= 2 && fasState === 'none') initFas();
}
async function initFas() {
  fasState = 'loading';
  try {
    if (!window.ort) throw new Error('The runtime could not be loaded.');
    window.ort.env.wasm.wasmPaths = ORT_BASE;
    window.ort.env.wasm.numThreads = 1;
    var built = [], k;
    for (k in fasChunks) {
      var bytes = b64Bytes(fasChunks[k].parts.join(''));
      built.push({ scale: fasChunks[k].scale, session: await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) });
    }
    fas = built; fasChunks = {}; fasState = 'ready';
    post({ type: 'status', status: 'spoof-ready' });
  } catch (e) {
    fas = null; fasState = 'unavailable';
    post({ type: 'status', status: 'spoof-unavailable', message: String(e && e.message || e) });
  }
}
function sampleSpoof(elm, f) {
  if (fasState !== 'ready' || fasBusy || !run || run.spoof.length >= SPOOF_MAX || !f.box) return;
  run.spoofSkip = (run.spoofSkip || 0) + 1;
  if (run.spoofSkip % 2) return; // every other good frame
  fasBusy = true;
  var mine = run;
  fasScore(elm, f.box).then(function (p) { if (run === mine) mine.spoof.push(p); }).catch(function () { fasState = 'unavailable'; fas = null; }).then(function () { fasBusy = false; });
}
function spoofSummary(list) {
  if (!list.length) return null;
  var sum = 0, mn = 1, mx = 0, i;
  for (i = 0; i < list.length; i++) { sum += list[i]; if (list[i] < mn) mn = list[i]; if (list[i] > mx) mx = list[i]; }
  var mean = sum / list.length;
  return { model: 'MiniFASNetV2+V1SE (Minivision, Apache-2.0)', frames: list.length, realProb: Math.round(mean * 1000) / 1000, min: Math.round(mn * 1000) / 1000, max: Math.round(mx * 1000) / 1000, real: mean >= SPOOF_REAL_MIN };
}

function begin(cfg) {
  run = {
    challenges: cfg.challenges && cfg.challenges.length ? cfg.challenges : ['left', 'right'],
    timeoutMs: cfg.timeoutMs || 10000,
    alignTimeoutMs: cfg.alignTimeoutMs || 25000,
    phase: 'align', good: 0, index: 0, stepIndex: 0, since: performance.now(), startedAt: performance.now(),
    lastFace: performance.now(), peak: 0, images: {}, steps: [], spoof: [], spoofSkip: 0
  };
}

function alignHint(f) {
  if (f.faces === 0) return 'No face found';
  if (f.faces > 1) return 'One face only, please';
  if (luma < MIN_LUMA) return 'Find somewhere brighter';
  if (f.size < SIZE_MIN) return 'Move a little closer';
  if (f.size > SIZE_MAX) return 'Move back a little';
  if (Math.abs(f.cx - 0.5) > OFF_CENTER_X || Math.abs(f.cy - 0.5) > OFF_CENTER_Y) return 'Centre your face';
  if (Math.abs(f.yaw) > CENTER_DEG || Math.abs(f.pitch) > PITCH_ROLL_MAX || Math.abs(f.roll) > PITCH_ROLL_MAX) return 'Look straight at the camera';
  return null;
}

function step(f) {
  if (!run) return;
  var now = performance.now();
  if (f.faces === 1) run.lastFace = now;
  else if (now - run.lastFace > FACE_LOST_MS && run.phase !== 'align') { fail('face-lost', 'We lost sight of your face.'); run = null; return; }

  if (run.phase === 'align') {
    var hint = alignHint(f);
    if (hint) { run.good = 0; progress('align', 'Fit your face in the oval', hint, f); }
    else {
      run.good++;
      sampleSpoof(frameSource(), f);
      var needSpoof = fasWanted && fasState !== 'unavailable' && run.spoof.length < SPOOF_FRAMES && now - run.since < SPOOF_WAIT_MS;
      progress('align', 'Hold still', needSpoof && fasState === 'loading' ? 'Getting ready…' : '', f);
      if (run.good >= ALIGN_FRAMES && !needSpoof) {
        run.images.center = capture();
        run.phase = 'turn'; run.good = 0; run.since = now; run.peak = 0; run.stepIndex = 1;
      }
    }
    if (run && run.phase === 'align' && now - run.since > run.alignTimeoutMs) { fail('timeout', 'We could not get a clear view of your face.'); run = null; }
    return;
  }

  var want = run.challenges[run.index];
  if (run.phase === 'turn') {
    var sign = want === 'left' ? 1 : -1;
    var toward = f.faces === 1 ? f.yaw * sign : 0;
    if (f.faces === 1 && toward > run.peak) run.peak = toward;
    var wrong = f.faces === 1 && toward < -TURN_DEG;
    progress('turn', 'Slowly turn your head to the ' + want, wrong ? 'The other way' : (f.faces > 1 ? 'One face only, please' : ''), f, { direction: want });
    if (f.faces === 1 && toward >= TURN_DEG) run.good++; else run.good = 0;
    if (run.good >= TURN_FRAMES) {
      run.images[want] = capture();
      run.steps.push({ challenge: want, ok: true, ms: Math.round(now - run.since), peak: Math.round(run.peak) });
      run.index++; run.stepIndex++; run.good = 0; run.since = now; run.peak = 0;
      if (run.index >= run.challenges.length) { finish(); return; }
      run.phase = 'recenter';
      return;
    }
    if (now - run.since > run.timeoutMs) { fail('timeout', 'We did not see you turn your head to the ' + want + '.'); run = null; }
    return;
  }

  if (run.phase === 'recenter') {
    progress('recenter', 'Now look straight ahead', '', f);
    if (f.faces === 1 && Math.abs(f.yaw) <= CENTER_DEG) run.good++; else run.good = 0;
    if (run.good >= RECENTER_FRAMES) { run.phase = 'turn'; run.good = 0; run.since = now; run.peak = 0; return; }
    if (now - run.since > run.timeoutMs) { fail('timeout', 'Please look straight at the camera between turns.'); run = null; }
  }
}

function finish() {
  var r = run; run = null;
  post({ type: 'done', result: {
    center: r.images.center, left: r.images.left, right: r.images.right,
    steps: r.steps, durationMs: Math.round(performance.now() - r.startedAt), model: 'mediapipe-face-landmarker-0.10.21',
    antiSpoof: spoofSummary(r.spoof)
  } });
}

function tick() {
  if (!running) return;
  try {
    var el = frameSource();
    var d = dims(el);
    var fresh = window.__frameSource ? true : (el.readyState >= 2 && el.currentTime !== lastTime);
    if (fresh && d[0] > 0) {
      lastTime = el.currentTime;
      measureLight(el);
      step(read(landmarker.detectForVideo(el, performance.now()), el));
    }
  } catch (e) {
    fail('model-failed', String(e && e.message || e));
    running = false;
    return;
  }
  requestAnimationFrame(tick);
}

window.__cmd = function (json) {
  var cmd = JSON.parse(json);
  if (cmd.cmd === 'begin') begin(cmd);
  if (cmd.cmd === 'model') addModelChunk(cmd);
  if (cmd.cmd === 'stop') { run = null; running = false; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }
};
window.__state = function () { return run ? { phase: run.phase, index: run.index, spoof: run.spoof.slice() } : null; };
window.__fas = function () { return { state: fasState, wanted: fasWanted }; };

async function start() {
  post({ type: 'status', status: 'loading-model' });
  try {
    var fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    var opts = function (delegate) {
      return { baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate }, runningMode: 'VIDEO', numFaces: 2,
        outputFacialTransformationMatrixes: true, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
    };
    try { landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  } catch (e) {
    fail('model-failed', 'The face check could not load. Check your internet connection.');
    return;
  }
  if (!window.__frameSource) {
    post({ type: 'status', status: 'starting-camera' });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      fail(denied ? 'camera-denied' : 'camera-unavailable', denied ? 'Camera access was refused.' : 'The front camera could not be opened.');
      return;
    }
  }
  running = true;
  post({ type: 'status', status: 'ready' });
  requestAnimationFrame(tick);
}
start();
</script>
</body>
</html>`;
