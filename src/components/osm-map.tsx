import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { PresenceState } from '@/lib/types';

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  color: string;
  stale: boolean;
  status: string;
};

export type LatLng = { lat: number; lng: number };

/** A person whose position should be checked against building outlines. */
export type Person = LatLng & { id: string; accuracy: number | null; speed: number | null };

export type FitPadding = { top: number; right: number; bottom: number; left: number };

/** A zone as the map draws it. A draft is the one being placed, drawn fainter. */
export type ZoneShape = {
  id: string;
  name: string;
  level: 'red' | 'aware';
  lat: number;
  lng: number;
  radius: number;
  note: string | null;
  draft?: boolean;
};

/** The building a person is in or next to, when the map has decided that. */
export type BuildingRef = {
  state: PresenceState;
  /** The building's id in the map tiles (OpenStreetMap id times ten plus a type digit). */
  tileId: number | null;
  heightM: number | null;
};

export type OsmMapHandle = {
  /** `zoom` null keeps the current zoom; `bottom` keeps the target clear of something covering that much of the bottom. */
  flyTo: (lat: number, lng: number, zoom: number | null, animate: boolean, bottom?: number) => void;
  panTo: (lat: number, lng: number) => void;
  fit: (points: LatLng[], padding: FitPadding, animate: boolean) => void;
  /** Keeps the middle of the view clear of something covering the bottom of the map (0 to remove). */
  setPadding: (bottom: number) => void;
};

/** Where the map opens. It is applied once, when the page is created. */
export type MapStart = { lat: number; lng: number; zoom: number };

type Props = {
  start: MapStart;
  markers: MapMarker[];
  /** People's chosen icons by id, as SVG data addresses. Anyone missing is drawn as their initial. */
  avatars?: Record<string, string>;
  /** A route to draw, as [longitude, latitude] points, or null for none. */
  route?: [number, number][] | null;
  zones: ZoneShape[];
  people: Person[];
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  /** The user dragged the map themselves. */
  onUserMove?: () => void;
  /** The user pressed and held on the map. */
  onLongPress?: (lat: number, lng: number) => void;
  /** Inside/outside result for every person the map has been able to check so far. */
  onPresence?: (results: Record<string, PresenceState>) => void;
  /** Which building each person who is in or next to one is at. */
  onBuildings?: (buildings: Record<string, BuildingRef>) => void;
  onTilesChange?: (ok: boolean) => void;
  onLoadError?: () => void;
};

// Not a real site; it only gives the page a stable origin.
const BASE_URL = 'https://family-circle.invalid/';

// OpenStreetMap data served by OpenFreeMap. Its "liberty" style includes a 3D building layer.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

// Names and colours come from other users' profiles, so the page builds DOM with textContent and
// validates colours instead of ever injecting them as HTML.
//
// Inside/outside works by loading the building footprints around a person into a second, hidden map
// (so it works wherever the visible map is looking) and testing their position against them. GPS is
// unreliable indoors, so a fix worse than 50 m is reported as "imprecise" rather than guessed, and a
// failure to load the building data as "unknown".
const HTML_TEMPLATE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/maplibre-gl.css">
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; }
  body { background: #e5e3df; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  .mk { position: relative; width: 42px; height: 42px; }
  .mk.stale { opacity: .55; }
  .pin { box-sizing: border-box; width: 42px; height: 42px; border-radius: 50%; border: 3px solid #fff;
         color: #fff; font: 700 17px/36px system-ui, sans-serif; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .tag { position: absolute; top: 46px; left: 50%; transform: translateX(-50%); max-width: 140px; padding: 0 7px;
         border-radius: 9px; background: rgba(255,255,255,.92); color: #111827; font: 600 12px/18px system-ui, sans-serif;
         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
  .maplibregl-popup-content { padding: 10px 14px; font: 14px/1.35 system-ui, sans-serif; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/maplibre-gl.js"></script>
<script>
(function () {
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  if (!window.maplibregl) { post({ type: 'loadError' }); return; }

  var map;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: '${STYLE_URL}',
      center: [__LNG__, __LAT__],
      zoom: __ZOOM__,
      minZoom: 5,
      pitch: 55,
      minPitch: 35,
      maxPitch: 70,
      dragRotate: false,
      attributionControl: false
    });
  } catch (e) { post({ type: 'loadError' }); return; }
  map.touchZoomRotate.disableRotation();
  // No credit control is drawn on the map (by request); the credits are in Settings > Map credits.

  var tilesOk = true, lastTileError = 0;
  map.on('error', function (e) {
    if (!e || !(e.tile || e.sourceId)) return;
    var now = Date.now();
    if (tilesOk || now - lastTileError > 10000) { tilesOk = false; lastTileError = now; post({ type: 'tiles', ok: false }); }
  });
  map.on('sourcedata', function (e) {
    if (!tilesOk && e && e.tile) { tilesOk = true; post({ type: 'tiles', ok: true }); }
  });
  map.on('dragstart', function () { post({ type: 'userMove' }); });

  // ---------- long press: add a safety zone here ----------
  var pressTimer = null, pressStart = null, lastLongPress = 0;
  function longPress(lat, lng) {
    var now = Date.now();
    if (now - lastLongPress < 1000) return;
    lastLongPress = now;
    post({ type: 'longPress', lat: lat, lng: lng });
  }
  var surface = map.getCanvasContainer();
  surface.addEventListener('touchstart', function (ev) {
    clearTimeout(pressTimer);
    if (ev.touches.length !== 1) { pressStart = null; return; }
    var t = ev.touches[0];
    pressStart = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(function () {
      if (!pressStart) return;
      var box = surface.getBoundingClientRect();
      var at = map.unproject([pressStart.x - box.left, pressStart.y - box.top]);
      longPress(at.lat, at.lng);
    }, 650);
  }, { passive: true });
  surface.addEventListener('touchmove', function (ev) {
    if (!pressStart || !ev.touches.length) return;
    var t = ev.touches[0];
    if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) { clearTimeout(pressTimer); pressStart = null; }
  }, { passive: true });
  ['touchend', 'touchcancel'].forEach(function (name) {
    surface.addEventListener(name, function () { clearTimeout(pressTimer); pressStart = null; }, { passive: true });
  });
  map.on('contextmenu', function (e) { longPress(e.lngLat.lat, e.lngLat.lng); });

  // ---------- safety zones ----------
  var pendingZones = null;

  function circlePolygon(lat, lng, radius) {
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, ring = [];
    for (var i = 0; i <= 64; i++) {
      var a = 2 * Math.PI * i / 64;
      ring.push([lng + radius * Math.cos(a) / kx, lat + radius * Math.sin(a) / ky]);
    }
    return { type: 'Polygon', coordinates: [ring] };
  }

  var pendingRoute;
  function setRoute(line) {
    var source = map.getSource('route');
    var data = line && line.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } : { type: 'FeatureCollection', features: [] };
    if (!source) { pendingRoute = data; return; }
    source.setData(data);
  }

  function setZones(list) {
    var source = map.getSource('zones');
    if (!source) { pendingZones = list; return; }
    source.setData({
      type: 'FeatureCollection',
      features: list.map(function (z) {
        return {
          type: 'Feature',
          properties: { name: String(z.name || ''), level: z.level === 'red' ? 'red' : 'aware', note: String(z.note || ''), radius: Number(z.radius) || 0, draft: !!z.draft },
          geometry: circlePolygon(z.lat, z.lng, z.radius)
        };
      })
    });
  }

  function zonePopup(p) {
    var el = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = p.name;
    el.appendChild(title);
    var kind = document.createElement('div');
    kind.textContent = (p.level === 'red' ? 'Red zone: avoid' : 'Be-aware zone') + ' (' + p.radius + ' m)';
    kind.style.color = p.level === 'red' ? '#B91C1C' : '#B45309';
    kind.style.fontWeight = '600';
    el.appendChild(kind);
    if (p.note) { var note = document.createElement('div'); note.textContent = p.note; el.appendChild(note); }
    return el;
  }

  // ---------- markers ----------
  var markers = {}, markerData = {};

  // Someone shown inside a building is drawn on that building, not wherever a noisy GPS fix puts them
  // (in a city centre that is often 10-30 m away, on the street).
  function markerPosition(m) {
    var e = presence[m.id];
    var snap = e && (e.state === 'inside' || e.state === 'indoors') ? e.snap : null;
    return snap ? [snap.lng, snap.lat] : [m.lng, m.lat];
  }

  function refreshMarkerPositions() {
    Object.keys(markers).forEach(function (id) {
      if (markerData[id]) markers[id].marker.setLngLat(markerPosition(markerData[id]));
    });
  }

  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

  // Each person is an icon (their colour and initial) with their name underneath. The map library puts its
  // own class on the element, so classes are only ever toggled here, never replaced.
  function buildMarker() {
    var el = document.createElement('div');
    el.className = 'mk';
    var pin = document.createElement('div');
    pin.className = 'pin';
    var tag = document.createElement('div');
    tag.className = 'tag';
    el.appendChild(pin);
    el.appendChild(tag);
    return el;
  }

  // Chosen icons arrive separately (as SVG data addresses) because they are large and rarely change.
  var avatarById = {};
  var AVATAR_PREFIX = 'data:image/svg+xml;charset=utf-8,';

  function paintMarker(el, m) {
    el.classList.toggle('stale', !!m.stale);
    var pin = el.querySelector('.pin'), tag = el.querySelector('.tag');
    var av = avatarById[m.id];
    if (typeof av === 'string' && av.indexOf(AVATAR_PREFIX) === 0 && av.indexOf('"') < 0) {
      pin.style.background = '#fff url("' + av + '") center / cover no-repeat';
      pin.textContent = '';
    } else {
      pin.style.background = isHex(m.color) ? m.color : '#1D4ED8';
      pin.textContent = (Array.from(String(m.name || '').trim())[0] || '?').toUpperCase();
    }
    tag.textContent = String(m.name || '');
  }

  function setAvatars(map) {
    avatarById = map && typeof map === 'object' ? map : {};
    Object.keys(markers).forEach(function (id) { if (markerData[id]) paintMarker(markers[id].el, markerData[id]); });
  }

  function popupContent(m) {
    var el = document.createElement('div');
    var name = document.createElement('strong');
    name.textContent = m.name;
    el.appendChild(name);
    el.appendChild(document.createElement('br'));
    var status = document.createElement('span');
    status.textContent = m.status;
    el.appendChild(status);
    return el;
  }

  function setMarkers(list) {
    var seen = {};
    list.forEach(function (m) {
      seen[m.id] = true;
      markerData[m.id] = m;
      var existing = markers[m.id];
      if (!existing) {
        var el = buildMarker();
        paintMarker(el, m);
        var popup = new maplibregl.Popup({ closeButton: false, offset: 26, maxWidth: '240px' }).setDOMContent(popupContent(m));
        var marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(markerPosition(m)).setPopup(popup).addTo(map);
        markers[m.id] = { marker: marker, el: el, popup: popup };
      } else {
        existing.marker.setLngLat(markerPosition(m));
        paintMarker(existing.el, m);
        existing.popup.setDOMContent(popupContent(m));
      }
    });
    Object.keys(markers).forEach(function (id) {
      if (!seen[id]) { markers[id].marker.remove(); delete markers[id]; delete markerData[id]; }
    });
  }

  // ---------- inside / outside a building ----------
  var IMPRECISE_ABOVE_M = 150;
  var probe = null;

  function getProbe() {
    if (probe) return probe;
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-400px;top:0;width:256px;height:256px;pointer-events:none';
    document.body.appendChild(el);
    try {
      probe = new maplibregl.Map({
        container: el,
        style: {
          version: 8,
          sources: { om: { type: 'vector', url: '${TILEJSON_URL}' } },
          layers: [{ id: 'b', type: 'fill', source: 'om', 'source-layer': 'building', paint: { 'fill-opacity': 0 } }]
        },
        center: [0, 0], zoom: 16, interactive: false, attributionControl: false, fadeDuration: 0
      });
    } catch (e) { probe = null; }
    return probe;
  }

  // Points the hidden map at a location and resolves true once its building tiles have loaded.
  function moveProbe(lat, lng) {
    return new Promise(function (resolve) {
      var p = getProbe();
      if (!p) { resolve(false); return; }
      var finished = false, failed = false;
      function onError() { failed = true; }
      function done(ok) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        p.off('error', onError);
        resolve(ok && !failed && p.isSourceLoaded('om'));
      }
      var timer = setTimeout(function () { done(false); }, 10000);
      p.on('error', onError);
      p.once('idle', function () { done(true); });
      p.jumpTo({ center: [lng, lat], zoom: 16 });
      p.triggerRepaint();
    });
  }

  function ringContains(ring, x, y) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polyContains(poly, x, y) {
    if (!ringContains(poly[0], x, y)) return false;
    for (var h = 1; h < poly.length; h++) if (ringContains(poly[h], x, y)) return false;
    return true;
  }

  // Shortest distance in metres from a point to the edges of a polygon (outer ring and courtyards).
  function polyDistanceM(poly, lat, lng) {
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, best = Infinity;
    poly.forEach(function (ring) {
      for (var i = 0; i < ring.length - 1; i++) {
        var ax = (ring[i][0] - lng) * kx, ay = (ring[i][1] - lat) * ky;
        var bx = (ring[i + 1][0] - lng) * kx, by = (ring[i + 1][1] - lat) * ky;
        var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        var px = ax + t * dx, py = ay + t * dy;
        var d = Math.sqrt(px * px + py * py);
        if (d < best) best = d;
      }
    });
    return best;
  }

  // The nearest point on a polygon's outer wall to a position.
  function nearestOnWall(poly, lat, lng) {
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, best = null, ring = poly[0];
    for (var i = 0; i < ring.length - 1; i++) {
      var ax = (ring[i][0] - lng) * kx, ay = (ring[i][1] - lat) * ky;
      var bx = (ring[i + 1][0] - lng) * kx, by = (ring[i + 1][1] - lat) * ky;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
      if (!best || d < best.d) best = { d: d, lat: lat + py / ky, lng: lng + px / kx };
    }
    return best;
  }

  // Where to draw someone who is inside a building: their own position if it is already inside it,
  // otherwise the nearest point of the building, a few metres in from the wall.
  function snapInto(geometry, p) {
    var polys = polygonsOf(geometry), best = null, k;
    for (k = 0; k < polys.length; k++) if (polyContains(polys[k], p.lng, p.lat)) return { lat: p.lat, lng: p.lng };
    for (k = 0; k < polys.length; k++) {
      var wall = nearestOnWall(polys[k], p.lat, p.lng);
      if (wall && (!best || wall.d < best.wall.d)) best = { wall: wall, poly: polys[k] };
    }
    if (!best) return null;
    var ring = best.poly[0], n = ring.length - 1, cx = 0, cy = 0;
    for (var i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
    cx /= n; cy /= n;
    var kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
    var vx = (cx - best.wall.lng) * kx, vy = (cy - best.wall.lat) * ky, len = Math.sqrt(vx * vx + vy * vy);
    if (!len) return { lat: best.wall.lat, lng: best.wall.lng };
    var step = Math.min(3, len);
    var inward = { lat: best.wall.lat + (vy / len * step) / ky, lng: best.wall.lng + (vx / len * step) / kx };
    return polyContains(best.poly, inward.lng, inward.lat) ? inward : { lat: best.wall.lat, lng: best.wall.lng };
  }

  function polygonsOf(g) {
    if (!g) return [];
    return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  }

  function bbox(ring) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    ring.forEach(function (c) {
      if (c[0] < b[0]) b[0] = c[0];
      if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0];
      if (c[1] > b[3]) b[3] = c[1];
    });
    return b;
  }

  function highlight(state, f, geometry) {
    var props = f.properties || {};
    return {
      type: 'Feature',
      properties: {
        state: state,
        h: Math.max(Number(props.render_height) || 0, 2),
        base: Number(props.render_min_height) || 0,
        fid: f.id === undefined ? null : f.id
      },
      geometry: geometry
    };
  }

  // A phone's reported accuracy is roughly one standard deviation of its position error. Rather than
  // testing a single point against the outlines, weigh every building the fix could plausibly belong to:
  //   - how much of the uncertainty around the fix falls inside each building,
  //   - how many floors it has (a 30-storey tower holds far more people than the pavement beside it),
  //   - poor accuracy while GPS was requested, which is itself a sign of being indoors,
  //   - moving at vehicle speed, which is a sign of being on the road.
  var FLOOR_WEIGHT = 0.6;
  var CONFIDENT = 0.6;
  var INDOORS_THRESHOLD = 0.6;
  // Someone already shown inside a building stays there until it is clearly less likely, and keeps the
  // same building unless another is clearly more likely, so a position between two buildings doesn't flicker.
  var INDOORS_LEAVE = 0.45;
  var STICKY = 0.75;
  // Next to tall buildings the reported accuracy is optimistic (signals bounce off the walls).
  var CANYON_INFLATE = 1.5;
  // ...and however good the reported accuracy, position error there is rarely below this.
  var CANYON_FLOOR = 0;
  var TALL_M = 40;
  var CANYON_RANGE_M = 80;
  var SAMPLES = (function () {
    function halton(i, base) { var f = 1, r = 0; while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); } return r; }
    var pts = [];
    for (var i = 1; i <= 500; i++) {
      var radius = Math.sqrt(-2 * Math.log(halton(i, 2))), angle = 2 * Math.PI * halton(i, 3);
      pts.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return pts;
  })();

  function accuracyLikelihood(accuracy) {
    if (accuracy <= 12) return 0.5;
    if (accuracy <= 25) return 1;
    if (accuracy <= 40) return 2;
    if (accuracy <= 80) return 4;
    return 6;
  }

  // The answer is always one of two things: on the street (no building), or exactly one building.
  // prev is this person's previous answer, used only to stop the answer flickering.
  function locate(features, p, prev) {
    var accuracy = p.accuracy == null ? 25 : p.accuracy;
    var sigmaReported = Math.max(5, Math.min(150, accuracy));
    var kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
    var wide = Math.max(Math.max(1, CANYON_INFLATE) * sigmaReported, CANYON_FLOOR);
    var dLng = (3 * wide + 20) / kx, dLat = (3 * wide + 20) / ky;

    var cands = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i], g = f.geometry, props = f.properties || {}, polys = polygonsOf(g);
      for (var k = 0; k < polys.length; k++) {
        var b = bbox(polys[k][0]);
        if (b[2] < p.lng - dLng || b[0] > p.lng + dLng || b[3] < p.lat - dLat || b[1] > p.lat + dLat) continue;
        var h = Number(props.render_height) || 0;
        cands.push({ key: f.id === undefined ? 'i' + i : String(f.id), f: f, g: g, poly: polys[k], b: b, h: h });
      }
    }

    var canyon = cands.some(function (cd) {
      if (cd.h < TALL_M) return false;
      var gapX = Math.max(cd.b[0] - p.lng, 0, p.lng - cd.b[2]) * kx, gapY = Math.max(cd.b[1] - p.lat, 0, p.lat - cd.b[3]) * ky;
      return Math.sqrt(gapX * gapX + gapY * gapY) <= CANYON_RANGE_M;
    });
    var sigma = canyon ? Math.max(sigmaReported * Math.max(1, CANYON_INFLATE), CANYON_FLOOR) : sigmaReported;

    // Where do samples of the fix's uncertainty land? Overlapping outlines and parts: the tallest wins.
    var groups = {}, outsideCount = 0, near = null, nearDist = Infinity;
    for (var s = 0; s < SAMPLES.length; s++) {
      var x = p.lng + SAMPLES[s][0] * sigma / kx, y = p.lat + SAMPLES[s][1] * sigma / ky, hit = null;
      for (var c = 0; c < cands.length; c++) {
        var cd = cands[c];
        if (x < cd.b[0] || x > cd.b[2] || y < cd.b[1] || y > cd.b[3]) continue;
        if (polyContains(cd.poly, x, y) && (!hit || cd.h > hit.h)) hit = cd;
      }
      if (!hit) { outsideCount++; continue; }
      var grp = groups[hit.key] || (groups[hit.key] = { key: hit.key, f: hit.f, g: hit.g, hits: 0, h: 0 });
      grp.hits++;
      if (hit.h > grp.h) grp.h = hit.h;
    }
    for (var n = 0; n < cands.length; n++) {
      var d = polyDistanceM(cands[n].poly, p.lat, p.lng);
      if (d < nearDist) { nearDist = d; near = cands[n]; }
    }

    // GPS speed is accurate outdoors: vehicle pace means on the road, walking pace means on the street
    // far more often than indoors, and standing still says nothing either way.
    var moving = p.speed != null && p.speed > 2.5;
    // (Only trusted with a decent fix: a poor one comes from the network, where speed means nothing.)
    var walking = !moving && p.speed != null && p.speed >= 0.8 && accuracy <= 25;
    var indoorLikelihood = moving ? 0.1 : accuracyLikelihood(accuracy) * (walking ? 0.2 : 1);
    var total = outsideCount / SAMPLES.length, list = [];
    Object.keys(groups).forEach(function (key) {
      var gr = groups[key];
      var floors = Math.max(1, Math.min(60, Math.round(gr.h / 3.2)));
      gr.floors = floors;
      gr.w = (gr.hits / SAMPLES.length) * FLOOR_WEIGHT * floors * indoorLikelihood;
      total += gr.w;
      list.push(gr);
    });
    list.sort(function (a, b) { return b.w - a.w; });
    var best = list[0] || null;
    var pBest = best && total ? best.w / total : 0;
    var pIndoors = total ? list.reduce(function (sum, gr) { return sum + gr.w; }, 0) / total : 0;
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var detail = {
      sigma: Math.round(sigma), canyon: canyon, moving: moving, walking: walking, candidates: cands.length,
      pIndoors: r2(pIndoors), pBest: r2(pBest),
      top: list.slice(0, 3).map(function (gr) { return { height: gr.h, floors: gr.floors, sharePct: Math.round(100 * gr.hits / SAMPLES.length), p: r2(total ? gr.w / total : 0) }; }),
      nearDistance: near ? Math.round(nearDist * 10) / 10 : null,
      nearHeight: near ? near.h : null
    };

    // Indoors or on the street? Then, if indoors, which single building.
    var wasInside = !!prev && (prev.state === 'inside' || prev.state === 'indoors');
    if (best && pIndoors >= (wasInside ? INDOORS_LEAVE : INDOORS_THRESHOLD)) {
      var chosen = best;
      if (prev && prev.bestKey) {
        list.forEach(function (gr) { if (gr.key === prev.bestKey && gr.w >= STICKY * best.w) chosen = gr; });
      }
      var pChosen = total ? chosen.w / total : 0;
      // A confident "inside" needs a good fix; otherwise it is only "probably".
      var state = pChosen >= CONFIDENT && accuracy <= 30 ? 'inside' : 'indoors';
      detail.chosenP = r2(pChosen);
      return { state: state, features: [highlight(state, chosen.f, chosen.g)], bestKey: chosen.key, snap: snapInto(chosen.g, p), detail: detail };
    }
    var reach = Math.min(30, Math.max(10, sigma));
    if (near && nearDist <= reach) return { state: 'around', features: [highlight('around', near.f, near.g)], detail: detail };
    return { state: 'outside', features: [], detail: detail };
  }

  function classify(p) {
    if (p.accuracy != null && p.accuracy > IMPRECISE_ABOVE_M) return Promise.resolve({ state: 'imprecise' });
    return moveProbe(p.lat, p.lng).then(function (ok) {
      if (!ok) return { state: 'unknown' };
      return locate(probe.querySourceFeatures('om', { sourceLayer: 'building' }), p, presence[p.id]);
    });
  }

  // What is being claimed, ignoring how sure: on the street, in one particular building, or nothing at all.
  function answerOf(r) {
    if (r.state === 'inside' || r.state === 'indoors') return 'B:' + r.bestKey;
    if (r.state === 'imprecise' || r.state === 'unknown') return r.state;
    return 'street';
  }
  function isUncertain(answer) { return answer === 'imprecise' || answer === 'unknown'; }

  function speedBand(s) { return s == null || s < 0.8 ? 0 : s <= 2.5 ? 1 : 2; }

  function metres(a, b) {
    var kx = 111320 * Math.cos(a.lat * Math.PI / 180), ky = 110540;
    var dx = (a.lng - b.lng) * kx, dy = (a.lat - b.lat) * ky;
    return Math.sqrt(dx * dx + dy * dy);
  }

  var presence = {}, wanted = {}, queue = [], running = false, hiddenIds = {};

  // The green building replaces the grey one, so the grey one is flattened while it is highlighted.
  function hideBaseBuildings(ids) {
    var target = { source: 'openmaptiles', sourceLayer: 'building' };
    Object.keys(hiddenIds).forEach(function (k) {
      if (ids[k] === undefined) { map.setFeatureState({ source: target.source, sourceLayer: target.sourceLayer, id: hiddenIds[k] }, { hl: false }); delete hiddenIds[k]; }
    });
    Object.keys(ids).forEach(function (k) {
      if (hiddenIds[k] === undefined) { map.setFeatureState({ source: target.source, sourceLayer: target.sourceLayer, id: ids[k] }, { hl: true }); hiddenIds[k] = ids[k]; }
    });
  }

  function publishPresence() {
    var results = {}, details = {}, buildings = {}, features = [], ids = {};
    Object.keys(presence).forEach(function (id) {
      if (!wanted[id]) return;
      results[id] = presence[id].state;
      var first = (presence[id].features || [])[0];
      if (first) buildings[id] = { state: presence[id].state, tileId: first.properties.fid, heightM: first.properties.h };
      details[id] = { accuracy: presence[id].accuracy, lat: presence[id].lat, lng: presence[id].lng, info: presence[id].detail || null };
      (presence[id].features || []).forEach(function (f) {
        features.push(f);
        if (f.properties.fid !== null) ids[String(f.properties.fid)] = f.properties.fid;
      });
    });
    var source = map.getSource('presence');
    if (source) { source.setData({ type: 'FeatureCollection', features: features }); hideBaseBuildings(ids); }
    refreshMarkerPositions();
    post({ type: 'presence', results: results, details: details, buildings: buildings });
  }

  function pump() {
    if (running) return;
    var p = queue.shift();
    if (!p) return;
    running = true;
    classify(p).then(function (r) {
      if (!wanted[p.id]) return;
      var prev = presence[p.id];
      var answer = answerOf(r);
      var settled = !!prev && !!prev.answer && !isUncertain(prev.answer) && !isUncertain(answer);
      if (settled && answer !== prev.answer && prev.pending !== answer) {
        // A different answer (street or another building) must be seen twice in a row before it
        // replaces the one on screen; a single odd reading is ignored.
        prev.pending = answer;
        prev.lat = p.lat; prev.lng = p.lng; prev.accuracy = p.accuracy; prev.speed = p.speed;
        return;
      }
      presence[p.id] = {
        state: r.state, features: r.features || [], bestKey: r.bestKey || null, snap: r.snap || null, detail: r.detail || null,
        answer: answer, pending: null, lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed
      };
      publishPresence();
    }).catch(function () {}).then(function () { running = false; pump(); });
  }

  var history = {};

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  // Someone standing still is placed at the median of their last few readings, so one wild reading (some
  // are hundreds of metres off) cannot move them. Anyone moving is used exactly as reported.
  function smooth(p) {
    var h = history[p.id] || (history[p.id] = []);
    var last = h[h.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) h.push({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, t: Date.now() });
    // Nine readings, because GPS errors come in runs: real data had three wild readings in a row.
    var cutoff = Date.now() - 120000;
    while (h.length > 9 || (h.length && h[0].t < cutoff)) h.shift();
    // Three readings in agreement far from where they were means they really moved: start again from those.
    if (h.length >= 6) {
      var recent = h.slice(-3);
      var here = { lat: median(h.map(function (x) { return x.lat; })), lng: median(h.map(function (x) { return x.lng; })) };
      var far = metres(recent[2], here) > Math.max(40, 3 * (p.accuracy == null ? 25 : p.accuracy));
      var agree = metres(recent[0], recent[2]) < 25 && metres(recent[1], recent[2]) < 25;
      if (far && agree) { h = history[p.id] = recent; }
    }
    var still = h.length >= 3 && h.every(function (x) { return x.speed == null || x.speed < 0.8; });
    if (!still) return p;
    return {
      id: p.id, speed: p.speed,
      lat: median(h.map(function (x) { return x.lat; })),
      lng: median(h.map(function (x) { return x.lng; })),
      accuracy: p.accuracy == null ? null : median(h.map(function (x) { return x.accuracy == null ? p.accuracy : x.accuracy; }))
    };
  }

  function setPeople(list) {
    wanted = {};
    var removed = false;
    list.forEach(function (reported) {
      var p = smooth(reported);
      wanted[p.id] = true;
      var prev = presence[p.id];
      var moved = !prev || metres(prev, p) >= 8;
      var accuracyChanged = prev && Math.abs((prev.accuracy || 0) - (p.accuracy || 0)) > 15;
      var movingChanged = prev && speedBand(prev.speed) !== speedBand(p.speed);
      var awaitingConfirmation = prev && prev.pending;
      if (moved || accuracyChanged || movingChanged || awaitingConfirmation) {
        queue = queue.filter(function (q) { return q.id !== p.id; });
        queue.push(p);
      }
    });
    Object.keys(presence).forEach(function (id) { if (!wanted[id]) { delete presence[id]; removed = true; } });
    Object.keys(history).forEach(function (id) { if (!wanted[id]) delete history[id]; });
    if (removed) publishPresence();
    pump();
  }

  // ---------- commands from the app ----------
  window.__cmd = function (json) {
    var c = JSON.parse(json);
    if (c.type === 'markers') setMarkers(c.markers);
    else if (c.type === 'avatars') setAvatars(c.avatars);
    else if (c.type === 'people') setPeople(c.people);
    else if (c.type === 'zones') setZones(c.zones);
    else if (c.type === 'route') setRoute(c.line);
    else if (c.type === 'padding') map.easeTo({ padding: { top: 0, right: 0, left: 0, bottom: c.bottom }, duration: 250 });
    else if (c.type === 'flyTo') {
      // bottom keeps the target clear of anything covering the bottom of the map
      var pad = { top: 0, right: 0, left: 0, bottom: c.bottom || 0 };
      var zoomTo = c.zoom == null ? map.getZoom() : c.zoom;
      if (c.animate) map.easeTo({ center: [c.lng, c.lat], zoom: zoomTo, padding: pad, duration: 600 });
      else map.jumpTo({ center: [c.lng, c.lat], zoom: zoomTo, padding: pad });
    }
    else if (c.type === 'panTo') map.easeTo({ center: [c.lng, c.lat], duration: 600 });
    else if (c.type === 'fit') {
      var duration = c.animate ? 600 : 0;
      if (c.points.length === 1) {
        map.easeTo({ center: [c.points[0].lng, c.points[0].lat], zoom: 16, duration: duration });
      } else {
        var bounds = new maplibregl.LngLatBounds();
        c.points.forEach(function (p) { bounds.extend([p.lng, p.lat]); });
        map.fitBounds(bounds, { padding: { top: c.top, right: c.right, bottom: c.bottom, left: c.left }, maxZoom: 17, duration: duration });
      }
    }
  };

  map.on('load', function () {
    // Flatten a base building while it is highlighted (feature-state "hl"), so the two never fight.
    var layers = map.getStyle().layers;
    var b = -1;
    layers.forEach(function (l, i) { if (l.id === 'building-3d') b = i; });
    var above = b >= 0 && layers[b + 1] ? layers[b + 1].id : undefined;
    if (b >= 0) {
      map.setPaintProperty('building-3d', 'fill-extrusion-height', ['case', ['boolean', ['feature-state', 'hl'], false], 0, ['get', 'render_height']]);
      map.setPaintProperty('building-3d', 'fill-extrusion-base', ['case', ['boolean', ['feature-state', 'hl'], false], 0, ['get', 'render_min_height']]);
    }
    // Zones lie on the ground, under the buildings, so they tint streets without hiding anything.
    var groundAbove = layers.some(function (l) { return l.id === 'building'; }) ? 'building' : undefined;
    map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    var zoneColor = ['match', ['get', 'level'], 'red', '#DC2626', '#F59E0B'];
    map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': zoneColor, 'fill-opacity': ['case', ['get', 'draft'], 0.12, 0.22] } }, groundAbove);
    map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': zoneColor, 'line-width': 2.5, 'line-opacity': ['case', ['get', 'draft'], 0.6, 0.95] } }, groundAbove);
    map.on('click', 'zones-fill', function (e) {
      var f = e.features && e.features[0];
      if (!f || f.properties.draft) return;
      new maplibregl.Popup({ closeButton: false, maxWidth: '240px' }).setLngLat(e.lngLat).setDOMContent(zonePopup(f.properties)).addTo(map);
    });
    if (pendingZones) { setZones(pendingZones); pendingZones = null; }

    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 9, 'line-opacity': 0.95 } }, groundAbove);
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563EB', 'line-width': 5 } }, groundAbove);
    if (pendingRoute) { map.getSource('route').setData(pendingRoute); pendingRoute = null; }

    map.addSource('presence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    function extrusion(id, state, color) {
      map.addLayer({
        id: id, type: 'fill-extrusion', source: 'presence',
        filter: ['==', ['get', 'state'], state],
        paint: {
          'fill-extrusion-color': color,
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.92
        }
      }, above);
    }
    extrusion('presence-around', 'around', '#BBF7D0');
    extrusion('presence-indoors', 'indoors', '#4ADE80');
    extrusion('presence-inside', 'inside', '#16A34A');
    map.addLayer({ id: 'presence-outline', type: 'line', source: 'presence', paint: { 'line-color': '#15803D', 'line-width': 3 } }, above);
    post({ type: 'ready' });
  });
})();
</script>
</body>
</html>`;

// The map is created already looking at the given place, so it never shows a world or continent view
// on its way there. minZoom stops anyone zooming out to one either.
function buildHtml(view: MapStart): string {
  const num = (n: number) => String(Number(n.toFixed(5)));
  return HTML_TEMPLATE.replace('__LNG__', num(view.lng)).replace('__LAT__', num(view.lat)).replace('__ZOOM__', num(view.zoom));
}

export const OsmMap = forwardRef<OsmMapHandle, Props>(function OsmMap(
  { start, markers, avatars, route, zones, people, style, onReady, onUserMove, onLongPress, onPresence, onBuildings, onTilesChange, onLoadError },
  ref,
) {
  // Fixed for the life of the page: changing it would reload the map.
  const [html] = useState(() => buildHtml(start));
  const web = useRef<WebView>(null);
  const [readyToken, setReadyToken] = useState(0);
  const lastMarkers = useRef('');
  const lastAvatars = useRef('');
  const lastRoute = useRef('');
  const lastPeople = useRef('');
  const lastZones = useRef('');

  const send = useCallback((cmd: object) => {
    // Double-encoded so the payload is always a valid JS string literal.
    web.current?.injectJavaScript(`window.__cmd(${JSON.stringify(JSON.stringify(cmd))});true;`);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (lat, lng, zoom, animate, bottom) => send({ type: 'flyTo', lat, lng, zoom, animate, bottom: bottom ?? 0 }),
      panTo: (lat, lng) => send({ type: 'panTo', lat, lng }),
      fit: (points, padding, animate) => send({ type: 'fit', points, animate, ...padding }),
      setPadding: (bottom) => send({ type: 'padding', bottom }),
    }),
    [send],
  );

  useEffect(() => {
    if (readyToken === 0) return;
    const payload = JSON.stringify(markers);
    if (payload === lastMarkers.current) return;
    lastMarkers.current = payload;
    send({ type: 'markers', markers });
  }, [readyToken, markers, send]);

  useEffect(() => {
    if (readyToken === 0) return;
    const payload = JSON.stringify(avatars ?? {});
    if (payload === lastAvatars.current) return;
    lastAvatars.current = payload;
    send({ type: 'avatars', avatars: avatars ?? {} });
  }, [readyToken, avatars, send]);

  useEffect(() => {
    if (readyToken === 0) return;
    const payload = JSON.stringify(route ?? null);
    if (payload === lastRoute.current) return;
    lastRoute.current = payload;
    send({ type: 'route', line: route ?? null });
  }, [readyToken, route, send]);

  useEffect(() => {
    if (readyToken === 0) return;
    const payload = JSON.stringify(zones);
    if (payload === lastZones.current) return;
    lastZones.current = payload;
    send({ type: 'zones', zones });
  }, [readyToken, zones, send]);

  useEffect(() => {
    if (readyToken === 0) return;
    // Rounded so GPS jitter doesn't resend the same person every few seconds.
    const payload = JSON.stringify(
      people.map((p) => [
        p.id,
        Math.round(p.lat * 1e5),
        Math.round(p.lng * 1e5),
        Math.round(p.accuracy ?? -1),
        (p.speed ?? 0) < 0.8 ? 0 : (p.speed ?? 0) <= 2.5 ? 1 : 2,
      ]),
    );
    if (payload === lastPeople.current) return;
    lastPeople.current = payload;
    send({ type: 'people', people });
  }, [readyToken, people, send]);

  function onMessage(event: WebViewMessageEvent) {
    let message: {
      type: string;
      ok?: boolean;
      results?: Record<string, PresenceState>;
      details?: unknown;
      buildings?: Record<string, BuildingRef>;
      lat?: number;
      lng?: number;
    };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    switch (message.type) {
      case 'ready':
        // A (re)loaded page starts empty, so forget what was last sent.
        lastMarkers.current = '';
        lastPeople.current = '';
        lastZones.current = '';
        setReadyToken((t) => t + 1);
        onReady?.();
        break;
      case 'userMove':
        onUserMove?.();
        break;
      case 'longPress':
        if (typeof message.lat === 'number' && typeof message.lng === 'number') onLongPress?.(message.lat, message.lng);
        break;
      case 'presence':
        if (__DEV__) console.log('[presence]', JSON.stringify(message.details ?? {}));
        onPresence?.(message.results ?? {});
        onBuildings?.(message.buildings ?? {});
        break;
      case 'tiles':
        onTilesChange?.(message.ok === true);
        break;
      case 'loadError':
        onLoadError?.();
        break;
    }
  }

  return (
    <WebView
      ref={web}
      source={{ html, baseUrl: BASE_URL }}
      style={[{ flex: 1, backgroundColor: '#e5e3df' }, style]}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      setSupportMultipleWindows={false}
      applicationNameForUserAgent="FamilyCircle/1.0"
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(request) => {
        // Only the page itself loads in here; links such as the attribution open in the browser.
        if (request.url === BASE_URL || request.url.startsWith('about:')) return true;
        void Linking.openURL(request.url);
        return false;
      }}
    />
  );
});
