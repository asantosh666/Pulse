// PULSE — bare-hand rhythm boxing, week-1 validation spike.
//
// Validation question: can Quest 3 hand tracking reliably detect intentional
// punches at 100-120 BPM, and does it feel responsive?
//
// Session: BPM select (punch an orb) -> 10s warmup (adaptive punch calibration)
// -> 3 rounds x 45s (100/110/120 BPM, ascending from the selected start, cyclic)
// -> 10s rests -> results screen. The results screen IS the validation output.

import * as THREE from 'three';
import { AudioEngine, } from './audio.js';
import { HandTracker } from './hands.js';
import { Visuals, GOLD, TEAL } from './visuals.js';

// Temporary diagnostic: surface any boot error on screen (week-1 spike).
window.addEventListener('error', (e) => {
  const el = document.getElementById('status');
  if (el) el.textContent = 'Boot error: ' + (e.message || e.error || 'unknown');
});

const ROUND_S = 45;
const REST_S = 10;
const WARMUP_S = 10;
const COUNT_IN = 4;              // count-in beats before orbs start
const SPAWN_BEATS = 2;           // orbs spawn this many beats ahead
const ORB_TRAVEL = 2.2;          // metres from spawn to hit plane
const HIT_Z = -0.55, ORB_Y = -0.25, ORB_X = 0.35;
const HIT_DIST = 0.35;           // metres: hand must be this close to the orb
const HIT_WIN = 0.12;            // seconds: +- window around the beat
const DEFAULT_THRESHOLD = 2.5;  // m/s provisional (warmup) & fallback

const overlay = document.getElementById('enter');
const statusEl = document.getElementById('status');

let renderer = null;
let xrCamera = null;
let audio = null;
let visuals = null;
const trackers = new Map(); // handedness -> HandTracker

// ---- session state -------------------------------------------------------
let state = 'idle';           // idle | select | warmup | round | rest | end
let stateT0 = 0;              // performance-clock time the state began
let startBpm = 100;
let roundBpms = [100, 110, 120];
let roundIdx = -1;
let beatDur = 0.6;
let beatTimes = [];           // audio-clock beat times for the current phase
let schedIdx = 0;             // next beat index for the audio scheduler
let orbBeats = [];            // {beatTime, hand, spawned, resolved, hit, viz}
let warmupBpm = 100;

let threshold = DEFAULT_THRESHOLD;
let score = 0, combo = 0;
let totalHits = 0, totalOrbs = 0;
let roundStats = [];          // {bpm, hits, total}
let sessionT0 = 0;
let handsEverSeen = false;
let htNagShown = false;
let lastT = 0;

const tmpV = new THREE.Vector3();

function setStatus(t) { statusEl.textContent = t; }

init();

async function init() {
  // Attach the tap handler FIRST so the button always responds, even if the
  // XR support check below hangs on some browsers.
  overlay.addEventListener('click', enter);
  window.__pulse_booted = true;
  try {
  if (!('xr' in navigator)) { setStatus('WebXR is not available in this browser.'); return; }
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { ok = false; }
  if (!ok) { setStatus('Immersive VR is not supported on this device/browser.'); return; }

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  document.getElementById('app').appendChild(renderer.domElement);

  xrCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 60);
  visuals = new Visuals();
  audio = new AudioEngine();

  window.addEventListener('resize', () => {
    if (!renderer) return;
    xrCamera.aspect = window.innerWidth / window.innerHeight;
    xrCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  // Audio lookahead scheduler: schedules kick/hat/bass just ahead of time.
  setInterval(pumpAudio, 25);
  } catch (e) {
    setStatus('Init failed: ' + (e && e.message ? e.message : e));
  }
}

async function enter() {
  window.__pulse_entered = true;
  if (!renderer) { setStatus('Still starting up — tap again in a moment.'); return; }
  overlay.classList.add('hidden');
  try {
    if (!audio.ready) await audio.init();
  } catch (e) {
    setStatus('Audio could not start: ' + e.message);
    overlay.classList.remove('hidden');
    return;
  }
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local'],
      optionalFeatures: ['hand-tracking'],
    });
  } catch (e) {
    setStatus('Could not start the VR session.');
    overlay.classList.remove('hidden');
    return;
  }
  await renderer.xr.setSession(session);
  sessionT0 = performance.now() / 1000;
  session.addEventListener('end', () => {
    overlay.classList.remove('hidden');
    setStatus('Tap to re-enter');
    for (const h of ['left', 'right']) visuals.hideHandViz(h);
    renderer.setAnimationLoop(null);
    resetSession();
  });
  resetSession();
  enterSelect();
  lastT = performance.now();
  renderer.setAnimationLoop(tick);
}

function resetSession() {
  state = 'idle';
  score = 0; combo = 0;
  totalHits = 0; totalOrbs = 0;
  roundStats = [];
  roundIdx = -1;
  threshold = DEFAULT_THRESHOLD;
  orbBeats = [];
  handsEverSeen = false; htNagShown = false;
  for (const tr of trackers.values()) { tr.reset(); tr.peak = 0; }
}

// ---- state transitions ----------------------------------------------------

function enterSelect() {
  state = 'select';
  visuals.hideHud();
  visuals.hideEndPanel();
  visuals.showSelect();
  visuals.showPrompt('PUNCH YOUR BPM\nto begin', { px: 44 });
}

function startWarmup(bpm) {
  startBpm = bpm;
  warmupBpm = bpm;
  // Rounds ascend cyclically from the selected start: 110 -> [110,120,100].
  const order = [100, 110, 120];
  const s = order.indexOf(bpm);
  roundBpms = [order[s], order[(s + 1) % 3], order[(s + 2) % 3]];
  state = 'warmup';
  stateT0 = performance.now() / 1000;
  visuals.hideSelect();
  visuals.showHud();
  visuals.setScore(0); visuals.setCombo(0); visuals.setStats(0, 0);
  visuals.setRound('WARMUP');
  visuals.showPrompt('THROW SOME PUNCHES!\nsteady rhythm, like the kick', { px: 42 });
  // Warmup beat grid: kick only, practice orbs every beat (unscored).
  beatDur = 60 / warmupBpm;
  const t0 = audio.now() + 0.3;
  beatTimes = [];
  const n = Math.ceil(WARMUP_S / beatDur);
  for (let i = 0; i < n; i++) beatTimes.push(t0 + i * beatDur);
  schedIdx = 0;
  orbBeats = [];
  for (let i = 2; i < n; i++) {
    orbBeats.push({
      beatTime: beatTimes[i], hand: i % 2 === 0 ? 'right' : 'left',
      spawned: false, resolved: false, hit: false, viz: null, practice: true,
    });
  }
  for (const tr of trackers.values()) { tr.reset(); tr.peak = 0; }
}

function finishWarmup() {
  // Adaptive threshold: 55% of measured peak, clamped, with a sane
  // fallback if the user barely punched during warmup.
  const peaks = [...trackers.values()].map(t => t.peak);
  const peak = Math.max(0, ...peaks);
  threshold = peak < 1.5 ? DEFAULT_THRESHOLD : Math.min(3.5, Math.max(1.8, 0.55 * peak));
  for (const tr of trackers.values()) tr.reset();
  clearOrbs();
  audio.blip(audio.now() + 0.05, 660, 0.12);
  setTimeout(() => audio.blip(audio.now() + 0.05, 990, 0.15), 180);
  visuals.showPrompt(`LOCKED IN: ${threshold.toFixed(1)} m/s\nround 1 incoming`, { px: 42 });
  setTimeout(() => { if (state === 'warmupDone') startRound(0); }, 2200);
  state = 'warmupDone'; // brief interstitial; startRound fires from the timeout
}

function startRound(r) {
  roundIdx = r;
  const bpm = roundBpms[r];
  state = 'round';
  stateT0 = performance.now() / 1000;
  beatDur = 60 / bpm;
  const t0 = audio.now() + 0.15;
  const nBeats = Math.floor(ROUND_S / beatDur);
  beatTimes = [];
  for (let i = 0; i < COUNT_IN + nBeats; i++) beatTimes.push(t0 + i * beatDur);
  schedIdx = 0;
  // Orb pattern: alternate R/L, a double every 8th orb.
  orbBeats = [];
  let k = 0;
  for (let i = COUNT_IN; i < beatTimes.length; i++) {
    const dbl = (k % 8 === 7);
    if (dbl) {
      for (const h of ['right', 'left']) {
        orbBeats.push({ beatTime: beatTimes[i], hand: h, spawned: false, resolved: false, hit: false, viz: null, practice: false });
      }
    } else {
      orbBeats.push({
        beatTime: beatTimes[i], hand: k % 2 === 0 ? 'right' : 'left',
        spawned: false, resolved: false, hit: false, viz: null, practice: false,
      });
    }
    k++;
  }
  roundStats[r] = { bpm, hits: 0, total: orbBeats.length };
  totalOrbs += orbBeats.length;
  visuals.hidePrompt();
  visuals.setRound(`ROUND ${r + 1}/3 · ${bpm} BPM`);
}

function startRest() {
  state = 'rest';
  stateT0 = performance.now() / 1000;
  clearOrbs();
  const next = roundBpms[roundIdx + 1];
  visuals.showPrompt(next !== undefined ? `REST\nnext: ${next} BPM` : 'REST', { px: 48 });
}

function endSession() {
  state = 'end';
  clearOrbs();
  visuals.hidePrompt();
  visuals.hideHud();
  const peaks = [...trackers.entries()].map(([h, t]) => ({ h, peak: t.peak }));
  const pr = peaks.find(p => p.h === 'right'), pl = peaks.find(p => p.h === 'left');
  const lines = ['SESSION COMPLETE', ''];
  for (const s of roundStats) {
    const acc = s.total > 0 ? Math.round(100 * s.hits / s.total) : 0;
    lines.push(`${s.bpm} BPM — ${s.hits}/${s.total}  (${acc}%)`);
  }
  const acc = totalOrbs > 0 ? Math.round(100 * totalHits / totalOrbs) : 0;
  lines.push('');
  lines.push(`overall ${totalHits}/${totalOrbs} (${acc}%) · score ${score}`);
  lines.push(`peak R ${pr ? pr.peak.toFixed(1) : '–'} m/s · L ${pl ? pl.peak.toFixed(1) : '–'} m/s`);
  lines.push(`threshold ${threshold.toFixed(1)} m/s`);
  visuals.showEndPanel(lines.join('\n'));
}

function clearOrbs() {
  for (const o of orbBeats) if (o.viz) visuals.killOrbVisual(o.viz);
  orbBeats = [];
}

// ---- audio scheduler (25ms lookahead) --------------------------------------

function pumpAudio() {
  if (!audio || !audio.ready) return;
  if (state !== 'round' && state !== 'warmup') return;
  const ahead = audio.now() + 0.18;
  while (schedIdx < beatTimes.length && beatTimes[schedIdx] < ahead) {
    const t = beatTimes[schedIdx];
    if (state === 'round') {
      audio.grooveBeat(t, schedIdx, beatDur);
      if (schedIdx % 4 === 0) visuals.pulsePosts();
    } else {
      audio.kick(t); // warmup: kick only, keep it simple
      if (schedIdx % 2 === 0) visuals.pulsePosts();
    }
    schedIdx++;
  }
}

// ---- hit detection ------------------------------------------------------------

function tryHit(hand, pos) {
  const now = audio.now();
  let best = null, bestDt = 1e9;
  for (const o of orbBeats) {
    if (o.resolved || o.hand !== hand) continue;
    const dtm = Math.abs(now - o.beatTime);
    if (dtm > HIT_WIN) continue;
    tmpV.set(hand === 'right' ? ORB_X : -ORB_X, ORB_Y, HIT_Z);
    if (pos.distanceTo(tmpV) > HIT_DIST) continue;
    if (dtm < bestDt) { bestDt = dtm; best = o; }
  }
  if (!best) return false;
  best.resolved = true;
  best.hit = true;
  const col = hand === 'right' ? GOLD : TEAL;
  if (best.viz) {
    tmpV.copy(best.viz.grp.position);
    visuals.spawnBurst(tmpV, col, 22);
    visuals.killOrbVisual(best.viz);
  }
  visuals.flashTarget(hand);
  audio.impact(now);
  if (!best.practice) {
    combo++;
    totalHits++;
    roundStats[roundIdx].hits++;
    const pts = 100 + Math.min(combo, 40);
    score += pts;
    visuals.setScore(score);
    visuals.setCombo(combo);
    visuals.setStats(totalHits, totalOrbs - remainingOrbs());
    if (combo % 10 === 0) visuals.popup(`${combo} COMBO!`, tmpV, 'rgba(255,214,130,1)', true);
    else visuals.popup(`+${pts}`, tmpV);
  } else {
    visuals.popup('NICE!', tmpV, 'rgba(160,255,200,0.95)');
  }
  return true;
}

function remainingOrbs() {
  let n = 0;
  for (const o of orbBeats) if (!o.resolved) n++;
  return n;
}

function resolveMisses() {
  const now = audio.now();
  for (const o of orbBeats) {
    if (o.resolved) continue;
    if (now > o.beatTime + HIT_WIN) {
      o.resolved = true;
      if (o.viz) {
        // Small fade-out for misses — no explosion, just gone.
        o.fading = 0;
      }
      if (!o.practice) {
        if (combo > 0) visuals.popup('miss', tmpV.set(0, 0.35, -1.2), 'rgba(150,160,190,0.7)');
        combo = 0;
        visuals.setCombo(0);
        visuals.setStats(totalHits, totalOrbs - remainingOrbs());
      }
    }
  }
}

// ---- per-frame -------------------------------------------------------------------

function getTracker(h) {
  if (!trackers.has(h)) trackers.set(h, new HandTracker(h));
  return trackers.get(h);
}

function tick(time, frame) {
  const nowS = time / 1000;
  const dt = Math.min(0.05, Math.max(0.001, (time - lastT) / 1000));
  lastT = time;
  const nowA = audio && audio.ready ? audio.now() : 0;

  const session = renderer.xr.getSession();
  const refSpace = renderer.xr.getReferenceSpace();

  if (frame && session && refSpace) {
    const seen = { left: false, right: false };
    for (const src of session.inputSources) {
      if (!src.hand) continue;
      const h = src.handedness;
      if (h !== 'left' && h !== 'right') continue;
      const tr = getTracker(h);
      const measuring = state === 'warmup' || state === 'round';
      const ev = tr.update(src, frame, refSpace, nowS, dt, threshold, measuring);
      if (!ev.tracked) continue;
      handsEverSeen = true;
      seen[h] = true;
      visuals.setHandViz(h, tr.jointPos, tr.jointValid, tr.pos);

      if (ev.punched && state !== 'idle' && state !== 'end') {
        if (state === 'select') {
          // Punch-to-select: generous radius, any of the 3 orbs.
          for (const o of visuals.selectOrbs) {
            if (ev.pos.distanceTo(o.userData.pos) < 0.5) {
              audio.blip(audio.now(), 990, 0.12);
              startWarmup(o.userData.bpm);
              break;
            }
          }
        } else if (state === 'round' || state === 'warmup') {
          tryHit(h, ev.pos);
        }
      }
    }
    for (const h of ['left', 'right']) if (!seen[h]) visuals.hideHandViz(h);

    // --- state timing ------------------------------------------------
    if (state === 'warmup' && nowS - stateT0 >= WARMUP_S) finishWarmup();
    else if (state === 'round') {
      // Spawn orbs 2 beats ahead.
      for (const o of orbBeats) {
        if (!o.spawned && nowA >= o.beatTime - SPAWN_BEATS * beatDur) {
          o.viz = visuals.spawnOrbVisual(o.hand);
          o.spawned = true;
        }
      }
      resolveMisses();
      if (nowA > roundEndT()) {
        if (roundIdx < 2) startRest();
        else endSession();
      }
    } else if (state === 'warmup') {
      for (const o of orbBeats) {
        if (!o.spawned && nowA >= o.beatTime - SPAWN_BEATS * beatDur) {
          o.viz = visuals.spawnOrbVisual(o.hand);
          o.spawned = true;
        }
      }
      resolveMisses();
      // Live peak readout during warmup.
      const tr = [...trackers.values()];
      const pr = tr.find(t => t.handedness === 'right');
      const pl = tr.find(t => t.handedness === 'left');
      if ((nowS * 2 | 0) !== tick._w) {
        tick._w = nowS * 2 | 0;
        visuals.setRound(`WARMUP · R ${(pr ? pr.peak : 0).toFixed(1)} / L ${(pl ? pl.peak : 0).toFixed(1)} m/s`);
      }
    } else if (state === 'rest' && nowS - stateT0 >= REST_S) {
      startRound(roundIdx + 1);
    }

    // --- orb motion ---------------------------------------------------
    if ((state === 'round' || state === 'warmup') && nowA > 0) {
      for (const o of orbBeats) {
        if (!o.viz || !o.viz.active) continue;
        if (o.resolved && !o.hit) {
          // Miss fade.
          o.fading = (o.fading || 0) + dt * 3;
          if (o.fading >= 1) visuals.killOrbVisual(o.viz);
          else visuals.fadeOrbVisual(o.viz, o.fading);
          continue;
        }
        if (o.resolved) continue;
        const progress = 1 - (o.beatTime - nowA) / (SPAWN_BEATS * beatDur);
        visuals.moveOrbVisual(o.viz, Math.max(0, Math.min(1.15, progress)));
      }
    }

    if (!htNagShown && !handsEverSeen && nowS - sessionT0 > 8) {
      htNagShown = true;
      visuals.showPrompt('enable hand tracking\n(Quest: hand tracking in settings)', { px: 36 });
    }
  }

  visuals.update(dt);
  renderer.render(visuals.scene, xrCamera);
}
tick._w = -1;

function roundEndT() {
  return beatTimes.length ? beatTimes[beatTimes.length - 1] + 1.0 : 1e9;
}
