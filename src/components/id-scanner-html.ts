/**
 * The page behind the ID document camera. It opens the back camera and, on every few frames:
 *   1. looks for the document: a rectangle of the right shape whose four edges are all clearly visible,
 *      searched around the on-screen guide so it can say "move closer", "move back" or "centre it";
 *   2. measures focus, glare and light inside that rectangle and whether it has held still;
 *   3. once everything is good for about 0.7 s it takes the photo by itself, cropped to the document.
 * Then it reads the text off the photo with Tesseract.js (an open-source OCR engine, loaded from jsDelivr in the
 * background while the person lines the document up) and sends the text to the app, which parses it.
 *
 * It draws its own guide frame (colour changes, progress, a faint picture of what is wanted) so the frame and the
 * detection always use the same geometry. The app draws the title, hints, buttons and the results.
 *
 * Rules for editing: no backticks and no dollar-brace anywhere inside the string, so it stays a plain literal.
 */
export const ID_SCANNER_BASE_URL = 'https://family-circle.invalid/';

export const ID_SCANNER_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video, #ov { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  video { object-fit: cover; background: #000; }
  #flash { position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: #fff; opacity: 0; pointer-events: none; transition: opacity .3s; }
</style>
</head>
<body>
<video id="v" playsinline muted autoplay></video>
<svg id="ov" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="flash"></div>
<script>
(function () {
var TESS_VERSION = '5.1.1';
var TESS_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TESS_VERSION + '/dist/';
var TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@' + TESS_VERSION;
var TESS_LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int';

// ---- tuning
var ANALYSE_W = 288;          // frames are analysed at this width
var ANALYSE_EVERY_MS = 100;
var FOUND_SCORE = 0.55;       // how completely all four edges must be seen
var SCALE_OK = [0.9, 1.1];    // document size against the guide
var CENTRE_OK = 0.06;         // of the guide width
var GOOD_FRAMES = 6;          // consecutive good frames (about 0.7 s) before the photo is taken
var LUMA_MIN = 60, LUMA_MAX = 225;
var GLARE_BLOCK = 0.06;       // share of the document that is blown out white
var SHARP_FLOOR = 20;         // Laplacian variance at 640 px: below this is a blur
var SHARP_PEAK = 0.75;        // and it must be near the sharpest seen while lined up
var STEADY_RANGE = 0.03;      // the card may wander this much of the guide width (breathing and hand tremor are well inside)
var MISS_GRACE = 2;           // frames that may fall short without losing the hold
var CROP_MARGIN = 0.06;
var MAX_OUT_W = 1600;

var video = document.getElementById('v');
var ov = document.getElementById('ov');
var flash = document.getElementById('flash');
var stream = null, track = null;
var cfg = null;               // set by begin
var running = false;
var lastAnalyse = 0;
var good = 0, sharpSeen = [], recent = [];
var startedAt = 0, snap = false, done = false, lastFound = null, misses = 0;
var lastMsgKey = '', lastMsgAt = 0, looping = false;

function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
function fail(code, message) { post({ type: 'error', code: code, message: message }); }
function source() { return window.__frameSource ? window.__frameSource() : video; }
function dims(el) { return el.videoWidth ? [el.videoWidth, el.videoHeight] : [el.width, el.height]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ---- the guide frame, in screen pixels
function guideRect(ratio) {
  var W = window.innerWidth, H = window.innerHeight;
  var w = Math.min(W - 40, 440), h = w / ratio;
  if (h > H * 0.5) { h = H * 0.5; w = h * ratio; }
  return { x: (W - w) / 2, y: H * 0.4 - h / 2, w: w, h: h };
}
// the video fills the screen, cropped ("cover"): map a screen point to a video pixel
function toVideo(x, y, d) {
  var W = window.innerWidth, H = window.innerHeight;
  var s = Math.max(W / d[0], H / d[1]);
  return { x: (x - (W - d[0] * s) / 2) / s, y: (y - (H - d[1] * s) / 2) / s, s: s };
}
function guideInVideo(d) {
  var g = guideRect(cfg.ratio);
  var a = toVideo(g.x, g.y, d), b = toVideo(g.x + g.w, g.y + g.h, d);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

// ---- the overlay
var NS = 'http://www.w3.org/2000/svg';
var ui = {};
function el(tag, attrs, parent) {
  var e = document.createElementNS(NS, tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function ghost(kind, g, parent) {
  var grp = el('g', { fill: 'none', stroke: '#fff', 'stroke-opacity': '0.4', 'stroke-width': '2', 'stroke-linecap': 'round' }, parent);
  var X = function (f) { return g.x + g.w * f; }, Y = function (f) { return g.y + g.h * f; };
  if (kind === 'sa_card_back') {
    for (var i = 0; i < 4; i++) el('line', { x1: X(0.08), y1: Y(0.16 + i * 0.1), x2: X(0.08 + (i % 2 ? 0.5 : 0.7)), y2: Y(0.16 + i * 0.1) }, grp);
    for (var b = 0; b < 26; b++) el('line', { x1: X(0.08 + b * 0.0345), y1: Y(0.62), x2: X(0.08 + b * 0.0345), y2: Y(0.86), 'stroke-width': b % 3 ? '2' : '4' }, grp);
    return;
  }
  el('rect', { x: X(0.06), y: Y(0.26), width: g.w * 0.28, height: g.h * 0.52, rx: 6 }, grp);
  for (var j = 0; j < 5; j++) el('line', { x1: X(0.42), y1: Y(0.3 + j * 0.11), x2: X(0.42 + (j % 2 ? 0.34 : 0.48)), y2: Y(0.3 + j * 0.11) }, grp);
  if (kind === 'passport') { el('line', { x1: X(0.06), y1: Y(0.88), x2: X(0.94), y2: Y(0.88) }, grp); el('line', { x1: X(0.06), y1: Y(0.94), x2: X(0.94), y2: Y(0.94) }, grp); }
}
function buildOverlay() {
  var W = window.innerWidth, H = window.innerHeight, g = guideRect(cfg.ratio);
  ov.innerHTML = '';
  ov.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var defs = el('defs', {}, ov), mask = el('mask', { id: 'hole' }, defs);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }, mask);
  el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, fill: '#000' }, mask);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.6)', mask: 'url(#hole)' }, ov);
  ghost(cfg.kind, g, ov);
  ui.frame = el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, fill: 'none', stroke: '#fff', 'stroke-opacity': '0.85', 'stroke-width': '3' }, ov);
  var per = 2 * (g.w + g.h);
  ui.prog = el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, fill: 'none', stroke: '#22C55E', 'stroke-width': '7', 'stroke-dasharray': per, 'stroke-dashoffset': per }, ov);
  ui.per = per;
  post({ type: 'layout', x: g.x, y: g.y, w: g.w, h: g.h, screenW: W, screenH: H });
}
function paint(color, hold) {
  if (!ui.frame) return;
  ui.frame.setAttribute('stroke', color);
  ui.prog.setAttribute('stroke-dashoffset', String(ui.per * (1 - clamp(hold, 0, 1))));
}

// ---- finding the document: a rectangle of the right shape whose four edges are all there. Edges are marked once per
// frame and thickened a few pixels, so a rough guess at the size and position can be scored cheaply; the best few
// guesses are then refined for a small tilt and for the exact edges.
var SCALES = [];
for (var si = 0.6; si <= 1.4001; si += 0.04) SCALES.push(si);
var an = document.createElement('canvas'), anx = an.getContext('2d', { willReadFrequently: true });
var cr = document.createElement('canvas'), crx = cr.getContext('2d', { willReadFrequently: true });
var THICK = 4;

function dilate(map, w, h, alongY, passes) {
  var tmp = new Uint8Array(w * h), p, i, x, y, t;
  for (p = 0; p < passes; p++) {
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var v = map[i];
      if (!v) { if (alongY) v = (y > 0 && map[i - w]) || (y < h - 1 && map[i + w]) ? 1 : 0; else v = (x > 0 && map[i - 1]) || (x < w - 1 && map[i + 1]) ? 1 : 0; }
      tmp[i] = v;
    }
    t = map; map = tmp; tmp = t;
  }
  return map;
}

function analyse(elm, d) {
  var w = ANALYSE_W, h = Math.round(w * d[1] / d[0]);
  an.width = w; an.height = h;
  anx.drawImage(elm, 0, 0, w, h);
  var px = anx.getImageData(0, 0, w, h).data;
  var gray = new Uint8Array(w * h), i;
  for (i = 0; i < w * h; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
  var gx = new Int16Array(w * h), gy = new Int16Array(w * h), hist = new Uint32Array(128), n = 0, x, y;
  for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
    i = y * w + x;
    var dx = gray[i + 1] - gray[i - 1], dy = gray[i + w] - gray[i - w];
    gx[i] = dx; gy[i] = dy;
    var m = (Math.abs(dx) + Math.abs(dy)) >> 2; hist[m > 127 ? 127 : m]++; n++;
  }
  // an edge is anything among the strongest few per cent, but never fainter than a small floor
  var acc = 0, p = 127;
  for (i = 127; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.04) { p = i; break; } }
  var T = clamp(p * 4 * 0.45, 22, 90);
  var hp = new Uint8Array(w * h), hm = new Uint8Array(w * h), vp = new Uint8Array(w * h), vm = new Uint8Array(w * h);
  for (i = 0; i < w * h; i++) {
    if (gy[i] > T) hp[i] = 1; else if (-gy[i] > T) hm[i] = 1;
    if (gx[i] > T) vp[i] = 1; else if (-gx[i] > T) vm[i] = 1;
  }
  return { w: w, h: h, gx: gx, gy: gy, T: T, hp: dilate(hp, w, h, true, THICK), hm: dilate(hm, w, h, true, THICK), vp: dilate(vp, w, h, false, THICK), vm: dilate(vm, w, h, false, THICK) };
}

// The quick score for an upright rectangle, from the thickened edge maps.
// A card brighter than the surface: the top edge brightens going down (hp), the bottom edge darkens (hm), the left edge
// brightens going right (vp) and the right edge darkens (vm). A darker card is the mirror image.
function scoreUpright(A, x0, y0, x1, y1) {
  var xa = Math.round(x0), xb = Math.round(x1), ya = Math.round(y0), yb = Math.round(y1), w = A.w;
  var mh = Math.round((xb - xa) * 0.1), mv = Math.round((yb - ya) * 0.1), x, y;
  var tP = 0, tM = 0, bP = 0, bM = 0, nh = 0, lP = 0, lM = 0, rP = 0, rM = 0, nv = 0;
  for (x = xa + mh; x <= xb - mh; x += 3) {
    var t = ya * w + x, b = yb * w + x;
    tP += A.hp[t]; tM += A.hm[t]; bP += A.hm[b]; bM += A.hp[b]; nh++;
  }
  for (y = ya + mv; y <= yb - mv; y += 3) {
    var l = y * w + xa, r = y * w + xb;
    lP += A.vp[l]; lM += A.vm[l]; rP += A.vm[r]; rM += A.vp[r]; nv++;
  }
  if (!nh || !nv) return { score: 0, min: 0 };
  var plus = [tP / nh, bP / nh, lP / nv, rP / nv], minus = [tM / nh, bM / nh, lM / nv, rM / nv];
  return pick(plus, minus);
}
function pick(plus, minus, plusLow, minusLow) {
  var best = null, set;
  for (set = 0; set < 2; set++) {
    var mine = (set ? minus : plus).slice(), other = set ? plus : minus, weakest = 0, s;
    // one edge may run the other way (a dark band along the top of a light card, a shadow)
    for (s = 1; s < 4; s++) if (mine[s] < mine[weakest]) weakest = s;
    // (and it may be a faint edge, counted at half the strength and a little less)
    mine[weakest] = Math.max(mine[weakest], other[weakest], plusLow ? 0.8 * (set ? minusLow : plusLow)[weakest] : 0, plusLow ? 0.8 * (set ? plusLow : minusLow)[weakest] : 0);
    var sides = mine.sort(function (a, b) { return b - a; });
    // all four edges are wanted, but one may be hidden by a shadow, glare or a card as dark as the table
    var mean4 = (sides[0] + sides[1] + sides[2] + sides[3]) / 4, mean3 = (sides[0] + sides[1] + sides[2]) / 3;
    var sc = mean3 * 0.6 + mean4 * 0.4;
    if (!best || sc > best.score) best = { score: sc, min: sides[3] };
  }
  return best;
}

// One side of a (possibly tilted) rectangle, from the raw gradients. (px,py) is the middle of the side, (ux,uy) runs
// along it and (nx,ny) points into the rectangle. Returns how much of the side has an edge with the document brighter
// than what is outside it (plus), and how much with it darker (minus).
function sideScore(A, px, py, ux, uy, nx, ny, len, tol, step) {
  var plus = 0, minus = 0, pl = 0, ml = 0, tot = 0, t, k, low = A.T * 0.5;
  for (t = -len * 0.4; t <= len * 0.4; t += step) {
    var bx = px + ux * t, by = py + uy * t, bp = 0, bm = 0;
    for (k = -tol; k <= tol; k++) {
      var xi = Math.round(bx + nx * k), yi = Math.round(by + ny * k);
      if (xi < 1 || yi < 1 || xi >= A.w - 1 || yi >= A.h - 1) continue;
      var i = yi * A.w + xi, v = A.gx[i] * nx + A.gy[i] * ny;
      if (v > bp) bp = v;
      if (-v > bm) bm = -v;
    }
    if (bp > A.T) plus++;
    if (bm > A.T) minus++;
    if (bp > low) pl++;
    if (bm > low) ml++;
    tot++;
  }
  return tot ? [plus / tot, minus / tot, pl / tot, ml / tot] : [0, 0, 0, 0];
}
function scoreRot(A, cx, cy, w, h, th, tol, step) {
  var c = Math.cos(th), s = Math.sin(th), ux = c, uy = s, vx = -s, vy = c;
  var top = sideScore(A, cx - vx * h / 2, cy - vy * h / 2, ux, uy, vx, vy, w, tol, step);
  var bot = sideScore(A, cx + vx * h / 2, cy + vy * h / 2, ux, uy, -vx, -vy, w, tol, step);
  var left = sideScore(A, cx - ux * w / 2, cy - uy * w / 2, vx, vy, ux, uy, h, tol, step);
  var right = sideScore(A, cx + ux * w / 2, cy + uy * w / 2, vx, vy, -ux, -uy, h, tol, step);
  return pick([top[0], bot[0], left[0], right[0]], [top[1], bot[1], left[1], right[1]], [top[2], bot[2], left[2], right[2]], [top[3], bot[3], left[3], right[3]]);
}
function inside(A, cx, cy, w, h, th) {
  var c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)), hw = (w * c + h * s) / 2 + 3, hh = (w * s + h * c) / 2 + 3;
  return cx - hw > 1 && cy - hh > 1 && cx + hw < A.w - 2 && cy + hh < A.h - 2;
}
function tighten(A, b, tol) {
  var it, prm, dd, keys = ['cx', 'cy', 'w', 'h'];
  var start = scoreRot(A, b.cx, b.cy, b.w, b.h, b.th, tol, 2);
  b.score = start.score; b.min = start.min;
  // steps of up to six pixels, and two whole pixels for width and height so each side really moves a pixel
  for (it = 0; it < 3; it++) for (prm = 0; prm < 4; prm++) {
    var key = keys[prm], bv = b[key], bs = b.score;
    for (dd = -6; dd <= 6; dd++) {
      if (!dd) continue;
      var t = { cx: b.cx, cy: b.cy, w: b.w, h: b.h, th: b.th };
      t[key] += dd;
      if (!inside(A, t.cx, t.cy, t.w, t.h, t.th)) continue;
      var sr = scoreRot(A, t.cx, t.cy, t.w, t.h, t.th, tol, 2);
      if (sr.score > bs) { bs = sr.score; bv = t[key]; }
    }
    b[key] = bv;
  }
  var fin = scoreRot(A, b.cx, b.cy, b.w, b.h, b.th, tol, 2);
  b.score = fin.score; b.min = fin.min;
}
var dbgCands = [];
function findDocument(A, g) {
  var cands = [], k, ox, oy, j, q;
  dbgCands = [];
  for (k = 0; k < SCALES.length; k++) {
    var w = g.w * SCALES[k], h = w / cfg.ratio;
    for (oy = -5; oy <= 5; oy++) for (ox = -5; ox <= 5; ox++) {
      var cx = g.cx + ox * g.w * 0.02, cy = g.cy + oy * g.w * 0.02;
      if (!inside(A, cx, cy, w, h, 0)) continue;
      var r = scoreUpright(A, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
      if (r.score < 0.2) continue;
      var c = { score: r.score, cx: cx, cy: cy, w: w, h: h, th: 0 }, merged = false;
      for (q = 0; q < cands.length; q++) {
        var o = cands[q];
        if (Math.abs(o.cx - c.cx) < 8 && Math.abs(o.cy - c.cy) < 8 && Math.abs(o.w / c.w - 1) < 0.1) { if (c.score > o.score) cands[q] = c; merged = true; break; }
      }
      if (!merged) cands.push(c);
    }
  }
  cands.sort(function (a, b) { return b.score - a.score; });
  cands = cands.slice(0, 3);
  var best = null;
  for (j = 0; j < cands.length; j++) {
    var b0 = cands[j];
    tighten(A, b0, 2);
    var deg, bt = null;
    for (deg = -9; deg <= 9; deg++) {
      var th = deg * Math.PI / 180;
      if (!inside(A, b0.cx, b0.cy, b0.w, b0.h, th)) continue;
      var rr = scoreRot(A, b0.cx, b0.cy, b0.w, b0.h, th, 2, 2);
      if (!bt || rr.score > bt.score) bt = { score: rr.score, cx: b0.cx, cy: b0.cy, w: b0.w, h: b0.h, th: th };
    }
    if (!bt) continue;
    tighten(A, bt, 2);
    tighten(A, bt, 1);
    bt.adj = bt.score - 0.4 * Math.max(0, 1 - bt.w / g.w);
    dbgCands.push({ coarse: Math.round(b0.score * 1000) / 1000, score: Math.round(bt.score * 1000) / 1000, adj: Math.round(bt.adj * 1000) / 1000, cx: Math.round(bt.cx), w: Math.round(bt.w), th: Math.round(bt.th * 57.3) });
    if (!best || bt.adj > best.adj) best = bt;
  }
  return best;
}

// ---- cutting the document out (straightened if it is tilted) and measuring it: light, glare, focus
// rect: {cx, cy, w, h, th} in source pixels; margin is the extra border kept around it, as a share of its size.
function cropInto(c, elm, rect, outW, outH, margin) {
  c.width = outW; c.height = outH;
  var g = c.getContext('2d'), k = 1 + 2 * margin;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, outW, outH);
  g.translate(outW / 2, outH / 2);
  g.scale(outW / (rect.w * k), outH / (rect.h * k));
  g.rotate(-rect.th);
  g.translate(-rect.cx, -rect.cy);
  g.drawImage(elm, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
function statsOf(c) {
  var cw = c.width, ch = c.height, px = c.getContext('2d').getImageData(0, 0, cw, ch).data;
  var g = new Float32Array(cw * ch), sum = 0, glare = 0, i;
  for (i = 0; i < cw * ch; i++) {
    var R = px[i * 4], G = px[i * 4 + 1], B = px[i * 4 + 2], l = 0.299 * R + 0.587 * G + 0.114 * B;
    g[i] = l; sum += l;
    if (R > 243 && G > 243 && B > 243) glare++;
  }
  var mean = sum / (cw * ch), s1 = 0, s2 = 0, n = 0, x, y;
  var x0 = Math.round(cw * 0.05), x1 = Math.round(cw * 0.95), y0 = Math.round(ch * 0.05), y1 = Math.round(ch * 0.95);
  for (y = y0 + 1; y < y1 - 1; y++) for (x = x0 + 1; x < x1 - 1; x++) {
    i = y * cw + x;
    var lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - cw] - g[i + cw];
    s1 += lap; s2 += lap * lap; n++;
  }
  var lm = s1 / n;
  return { light: Math.round(mean), glare: Math.round(glare / (cw * ch) * 1000) / 1000, sharp: Math.round((s2 / n - lm * lm) * 10) / 10 };
}
function measureRect(elm, rect) {
  var outW = 640, outH = Math.max(8, Math.round(rect.h * outW / rect.w));
  cropInto(cr, elm, rect, outW, outH, 0);
  return statsOf(cr);
}

// ---- messages to the app, at most a few a second unless the wording changes
function progress(state, hint, checks, hold) {
  var key = state + '|' + hint + '|' + JSON.stringify(checks);
  var now = performance.now();
  if (key === lastMsgKey && now - lastMsgAt < 250) return;
  lastMsgKey = key; lastMsgAt = now;
  post({ type: 'progress', state: state, hint: hint, checks: checks, hold: Math.round(hold * 100) / 100 });
}

// ---- taking the photo
function takePhoto(elm, rect, viaSnap) {
  done = true; running = false;
  flash.style.opacity = '0.85';
  setTimeout(function () { flash.style.opacity = '0'; }, 120);
  try { video.pause(); } catch (e) {}
  var k = 1 + 2 * CROP_MARGIN, scale = Math.min(1, MAX_OUT_W / (rect.w * k));
  var c = document.createElement('canvas');
  cropInto(c, elm, rect, Math.round(rect.w * k * scale), Math.round(rect.h * k * scale), CROP_MARGIN);
  var q = statsOf(c);
  var image = c.toDataURL('image/jpeg', 0.9).replace(/^data:image\/jpeg;base64,/, '');
  paint('#22C55E', 1);
  post({ type: 'captured', image: image, width: c.width, height: c.height, via: viaSnap ? 'manual' : 'auto', quality: q, tilt: Math.round(rect.th * 180 / Math.PI * 10) / 10, ms: Math.round(performance.now() - startedAt) });
  if (cfg.ocr) readText(c);
}

// ---- reading the text (Tesseract.js, loaded on first use; started early in the background)
var worker = null, workerP = null;
function loadOcr() {
  if (workerP) return workerP;
  workerP = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = TESS_BASE + 'tesseract.min.js';
    s.onload = res; s.onerror = function () { rej(new Error('The text reader could not be loaded.')); };
    document.head.appendChild(s);
  }).then(function () {
    return window.Tesseract.createWorker('eng', 1, { workerPath: TESS_BASE + 'worker.min.js', corePath: TESS_CORE, langPath: TESS_LANG, logger: function () {} });
  }).then(function (w) { worker = w; return w; });
  workerP.catch(function () { workerP = null; });
  return workerP;
}
function prepare(canvas, fromY, toY, wantW) {
  // grey, upscaled to about wantW wide, with the tones stretched so faint print is not lost
  var sw = canvas.width, sh = canvas.height, y0 = Math.round(sh * fromY), hh = Math.round(sh * (toY - fromY));
  var sc = Math.max(1, wantW / sw), out = document.createElement('canvas');
  out.width = Math.round(sw * sc); out.height = Math.round(hh * sc);
  var g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, y0, sw, hh, 0, 0, out.width, out.height);
  var img = g.getImageData(0, 0, out.width, out.height), p = img.data, hist = new Uint32Array(256), i;
  for (i = 0; i < p.length; i += 4) { var l = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; p[i] = l; hist[l]++; }
  var total = out.width * out.height, lo = 0, hi = 255, acc = 0;
  for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
  acc = 0;
  for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
  var span = Math.max(40, hi - lo);
  for (i = 0; i < p.length; i += 4) { var v = clamp(Math.round((p[i] - lo) * 255 / span), 0, 255); p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return out;
}
function luhn(d) { var s = 0, i; for (i = 0; i < d.length; i++) { var n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; }
function hasSaId(text) {
  var t = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1'), re = /(?:\d[ ]?){13}/g, m;
  while ((m = re.exec(t))) { var digits = m[0].replace(/ /g, ''); if (digits.length === 13 && luhn(digits)) return true; }
  return false;
}
async function readText(canvas) {
  var t0 = performance.now();
  try {
    post({ type: 'ocr-progress', status: 'loading' });
    var w = await loadOcr();
    post({ type: 'ocr-progress', status: 'reading' });
    var out = { engine: 'tesseract.js-' + TESS_VERSION, text: '', digits: '', mrz: '', confidence: 0 };
    if (cfg.kind === 'sa_card_back') { post({ type: 'ocr', ocr: null }); return; }
    await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    var r = await w.recognize(prepare(canvas, 0, 1, 1600));
    out.text = r.data.text || ''; out.confidence = Math.round(r.data.confidence || 0);
    if (cfg.kind === 'passport') {
      await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<' });
      var rm = await w.recognize(prepare(canvas, 0.66, 1, 1800));
      out.mrz = rm.data.text || '';
    } else if (!hasSaId(out.text)) {
      await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '0123456789 ' });
      var rd = await w.recognize(prepare(canvas, 0, 1, 1600));
      out.digits = rd.data.text || '';
    }
    out.ms = Math.round(performance.now() - t0);
    post({ type: 'ocr', ocr: out });
  } catch (e) {
    post({ type: 'ocr', ocr: null, error: String(e && e.message || e) });
  }
}

// ---- the loop
function tick() {
  if (!running) { looping = false; return; }
  var now = performance.now();
  if (now - lastAnalyse >= ANALYSE_EVERY_MS && cfg) {
    lastAnalyse = now;
    try { step(now); } catch (e) { fail('scan-failed', String(e && e.message || e)); running = false; return; }
  }
  requestAnimationFrame(tick);
}

function step(now) {
  var elm = source(), d = dims(elm);
  if (!(d[0] > 0) || (elm.readyState !== undefined && elm.readyState < 2)) return;
  var gv = guideInVideo(d), k = ANALYSE_W / d[0];
  var A = analyse(elm, d);
  var found = findDocument(A, { x: gv.x * k, y: gv.y * k, w: gv.w * k, h: gv.h * k, cx: gv.cx * k, cy: gv.cy * k });
  var checks = { edges: false, size: false, sharp: false, glare: false, steady: false };
  var rect = null, hint = '', state = 'searching';

  if (!found || found.score < FOUND_SCORE || found.min < 0.05) {
    misses++;
    if (misses > MISS_GRACE) { good = 0; recent = []; sharpSeen = []; }
    hint = good > 0 ? 'Hold still' : 'Fit the whole document inside the frame';
    if (good > 0) state = 'holding';
    else if (found && found.score > 0.35) state = 'adjusting';
  } else {
    checks.edges = true;
    rect = { cx: found.cx / k, cy: found.cy / k, w: found.w / k, h: found.h / k, th: found.th };
    var sc = rect.w / gv.w, dx = (rect.cx - gv.cx) / gv.w, dy = (rect.cy - gv.cy) / gv.w;
    var m = measureRect(elm, rect);
    lastFound = { rect: rect, m: m, sc: sc };
    checks.size = sc >= SCALE_OK[0] && sc <= SCALE_OK[1] && Math.abs(dx) <= CENTRE_OK && Math.abs(dy) <= CENTRE_OK;
    checks.glare = m.glare < GLARE_BLOCK;
    var lightOk = m.light >= LUMA_MIN && m.light <= LUMA_MAX;
    sharpSeen.push(m.sharp); if (sharpSeen.length > 25) sharpSeen.shift();
    var peak = Math.max.apply(null, sharpSeen);
    checks.sharp = m.sharp >= SHARP_FLOOR && m.sharp >= peak * SHARP_PEAK;
    recent.push([rect.cx, rect.cy, rect.w]); if (recent.length > GOOD_FRAMES) recent.shift();
    var wander = 0;
    if (recent.length >= 3) {
      var axis, spread;
      for (axis = 0; axis < 3; axis++) {
        var vals = recent.map(function (r) { return r[axis]; }).sort(function (a, b) { return a - b; });
        spread = recent.length >= 5 ? vals[vals.length - 2] - vals[1] : vals[vals.length - 1] - vals[0];
        if (spread > wander) wander = spread;
      }
    }
    checks.steady = recent.length >= 3 && wander / gv.w < STEADY_RANGE;

    state = 'adjusting';
    if (sc < SCALE_OK[0]) hint = 'Move a little closer';
    else if (sc > SCALE_OK[1]) hint = 'Move back a little';
    else if (!checks.size) hint = 'Centre the document in the frame';
    else if (m.light < LUMA_MIN) hint = 'More light needed. Try the torch';
    else if (m.light > LUMA_MAX) hint = 'Too bright. Move out of direct light';
    else if (!checks.glare) hint = 'Tilt it slightly to avoid the glare';
    else if (!checks.sharp) hint = 'Hold steady while it focuses';
    else if (!checks.steady) hint = 'Hold still';
    var allGood = checks.edges && checks.size && checks.glare && lightOk && checks.sharp && checks.steady;
    if (allGood) { good++; misses = 0; state = 'holding'; hint = 'Hold still'; }
    else { misses++; if (misses > MISS_GRACE) good = 0; else if (good > 0) { state = 'holding'; hint = 'Hold still'; } }
    if (good >= GOOD_FRAMES && !snap) { takePhoto(elm, rect, false); return; }
  }
  if (snap && !done) { takePhoto(elm, rect || { cx: gv.cx, cy: gv.cy, w: gv.w, h: gv.h, th: 0 }, true); return; }
  var hold = clamp(good / GOOD_FRAMES, 0, 1);
  paint(state === 'holding' ? '#22C55E' : state === 'adjusting' ? '#FBBF24' : '#FFFFFF', hold);
  progress(state, hint, checks, hold);
}

window.__cmd = function (json) {
  var c = JSON.parse(json);
  if (c.cmd === 'begin') {
    cfg = { kind: c.kind, ratio: c.ratio, ocr: !!c.ocr };
    good = 0; misses = 0; recent = []; sharpSeen = []; snap = false; done = false; startedAt = performance.now();
    buildOverlay();
    try { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    flash.style.opacity = '0';
    running = true;
    if (!looping) { looping = true; requestAnimationFrame(tick); }
    if (cfg.ocr && cfg.kind !== 'sa_card_back') setTimeout(function () { loadOcr().catch(function () {}); }, 400);
  } else if (c.cmd === 'snap') snap = true;
  else if (c.cmd === 'torch' && track) { try { track.applyConstraints({ advanced: [{ torch: !!c.on }] }); } catch (e) {} }
  else if (c.cmd === 'stop') {
    running = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; workerP = null; }
  }
};
window.__debug = function () { return { good: good, sharpSeen: sharpSeen.slice(), running: running, done: done, last: lastFound }; };
window.__guideVideo = function () { return guideInVideo(dims(source())); };
window.__find = function () {
  var elm = source(), d = dims(elm), gv = guideInVideo(d), k = ANALYSE_W / d[0], A = analyse(elm, d);
  var f = findDocument(A, { x: gv.x * k, y: gv.y * k, w: gv.w * k, h: gv.h * k, cx: gv.cx * k, cy: gv.cy * k });
  return { f: f, cands: dbgCands, T: A.T, aw: A.w, ah: A.h, guide: { x: gv.x * k, y: gv.y * k, w: gv.w * k, h: gv.h * k, cx: gv.cx * k, cy: gv.cy * k } };
};

async function start() {
  post({ type: 'status', status: 'starting-camera' });
  if (!window.__frameSource) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
      track = stream.getVideoTracks()[0];
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
      await video.play();
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      fail(denied ? 'camera-denied' : 'camera-unavailable', denied ? 'Camera access was refused.' : 'The camera could not be opened.');
      return;
    }
  }
  var caps = track && track.getCapabilities ? track.getCapabilities() : {};
  post({ type: 'status', status: 'ready', torch: !!caps.torch });
}
start();
})();
</script>
</body>
</html>`;
