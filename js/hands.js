// PULSE — hand tracking: palm position, velocity, punch events, warmup peaks.
//
// Detection approach (see BUILD_NOTES.md for the full rationale):
// - Palm position = average of wrist + 4 finger metacarpals (stable, jitter-
//   resistant; fingertips are noisier and lag the fist's mass).
// - Speed = asymmetrically-smoothed palm velocity (fast attack ~20ms so the
//   punch onset isn't dulled, slower release ~90ms to ride out jitter).
// - A punch fires when smoothed speed crosses the adaptive threshold, with
//   hysteresis re-arm (must fall below 45% of threshold) + a 250ms cooldown,
//   so one punch can't double-fire and fast waving can't machine-gun.

import * as THREE from 'three';

// Joints averaged for the palm/fist position.
const PALM_JOINTS = [
  'wrist',
  'index-finger-metacarpal',
  'middle-finger-metacarpal',
  'ring-finger-metacarpal',
  'pinky-finger-metacarpal',
];

// Fixed 25-joint order for the visualizer (matches the WebXR hand spec).
export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-proximal', 'index-finger-intermediate', 'index-finger-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-proximal', 'middle-finger-intermediate', 'middle-finger-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-proximal', 'ring-finger-intermediate', 'ring-finger-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-proximal', 'pinky-finger-intermediate', 'pinky-finger-distal', 'pinky-finger-tip',
];

export class HandTracker {
  constructor(handedness) {
    this.handedness = handedness;
    this.pos = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._hasPrev = false;
    this.speed = 0;          // smoothed m/s
    this.peak = 0;           // max smoothed speed seen (warmup + session)
    this._rearmed = true;
    this._lastPunchT = -1e9;
    this.jointPos = new Float32Array(25 * 3);
    this.jointValid = new Uint8Array(25);
  }

  reset() {
    this._hasPrev = false;
    this.speed = 0;
    this._rearmed = true;
    this._lastPunchT = -1e9;
  }

  // nowS: seconds (performance clock). dt: seconds since last frame.
  // threshold: m/s punch threshold. measuring: record peak speeds.
  update(src, frame, refSpace, nowS, dt, threshold, measuring) {
    const out = { tracked: false, pos: this.pos, speed: 0, punched: false };
    if (!src.hand) return out;

    // --- palm position ------------------------------------------------
    let n = 0;
    this._tmp.set(0, 0, 0);
    for (const name of PALM_JOINTS) {
      const j = src.hand.get(name);
      if (!j) continue;
      let pose = null;
      try { pose = frame.getJointPose(j, refSpace); } catch (e) { pose = null; }
      if (!pose) continue;
      const p = pose.transform.position;
      this._tmp.x += p.x; this._tmp.y += p.y; this._tmp.z += p.z;
      n++;
    }
    if (n < 2) return out; // not enough joints: treat as untracked
    this._tmp.multiplyScalar(1 / n);
    out.tracked = true;

    // --- velocity ------------------------------------------------------
    if (this._hasPrev && dt > 0.0005 && dt < 0.25) {
      const raw = this._tmp.distanceTo(this._prev) / dt;
      // Asymmetric smoothing: attack fast (don't dull the punch onset),
      // release slower (ride out tracking jitter on the way down).
      const tau = raw > this.speed ? 0.02 : 0.09;
      const k = 1 - Math.exp(-dt / tau);
      this.speed += (raw - this.speed) * k;
    }
    this._prev.copy(this._tmp);
    this._hasPrev = true;
    this.pos.copy(this._tmp);
    out.speed = this.speed;

    if (measuring) this.peak = Math.max(this.peak, this.speed);

    // --- punch event: threshold cross + hysteresis re-arm + cooldown ---
    if (this.speed < threshold * 0.45) this._rearmed = true;
    if (this._rearmed && this.speed >= threshold && nowS - this._lastPunchT > 0.25) {
      out.punched = true;
      this._rearmed = false;
      this._lastPunchT = nowS;
    }

    // --- joints for the visualizer ------------------------------------
    for (let i = 0; i < 25; i++) {
      let ok = false;
      try {
        const j = src.hand.get(JOINT_NAMES[i]);
        if (j) {
          const pose = frame.getJointPose(j, refSpace);
          if (pose) {
            const p = pose.transform.position;
            this.jointPos[i * 3] = p.x;
            this.jointPos[i * 3 + 1] = p.y;
            this.jointPos[i * 3 + 2] = p.z;
            ok = true;
          }
        }
      } catch (e) { ok = false; }
      this.jointValid[i] = ok ? 1 : 0;
    }
    return out;
  }
}
