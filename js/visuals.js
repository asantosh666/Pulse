// PULSE — visuals. Dark gym void: fog, floor grid, 4 corner light posts,
// floating dust. Additive light only, no postprocessing (72fps budget).
// All UI is floating text sprites — no DOM inside the headset.

import * as THREE from 'three';

export const GOLD = 0xffd27f; // right hand
export const TEAL = 0x2fd6c0; // left hand

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  return new THREE.CanvasTexture(cv);
}

export class Visuals {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050a);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.055);
    this.time = 0;
    this.dotTex = this._makeDotTexture();
    this.postPulse = 0;

    this.buildFloor();
    this.buildPosts();
    this.buildDust();
    this.buildTargets();
    this.buildOrbs();
    this.buildBursts();
    this.buildPopups();
    this.buildHandViz();
    this.buildPrompt();
    this.buildHud();
    this.buildSelect();
    this.buildEndPanel();
  }

  // ---- shared soft round dot ------------------------------------------
  _makeDotTexture() {
    return canvasTexture(64, 64, (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    });
  }

  // ---- floating text sprite --------------------------------------------
  makeLabel(w, h, sw, sh) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
    spr.scale.set(sw, sh, 1);
    spr.userData = { cv, tex, w, h };
    return spr;
  }

  // Multi-line ('\n') + auto-shrink so text can never clip.
  setLabel(spr, str, opts = {}) {
    const { px = 44, color = 'rgba(240,244,255,0.95)', weight = 700 } = opts;
    const { cv, tex, w, h } = spr.userData;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, w, h);
    const lines = String(str).split('\n');
    let size = px;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const fits = () => lines.every(l => {
      x.font = `${weight} ${size}px system-ui, sans-serif`;
      return x.measureText(l).width <= w - 36;
    });
    while (size > 10 && !fits()) size -= 2;
    x.font = `${weight} ${size}px system-ui, sans-serif`;
    x.fillStyle = color;
    const lh = size * 1.28, y0 = h / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => x.fillText(l, w / 2, y0 + i * lh));
    tex.needsUpdate = true;
  }

  // ---- floor grid -------------------------------------------------------
  buildFloor() {
    const grid = new THREE.GridHelper(26, 26, 0x2a3f66, 0x131a2c);
    grid.position.y = -1.2; // compromise between seated and standing eye height
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.scene.add(grid);
    // Soft glow disc under the player.
    const tex = canvasTexture(256, 256, (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,180,90,0.35)');
      g.addColorStop(0.6, 'rgba(255,150,80,0.10)');
      g.addColorStop(1, 'rgba(255,150,80,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 40),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -1.19;
    this.scene.add(disc);
  }

  // ---- 4 corner light posts ----------------------------------------------
  buildPosts() {
    const tex = canvasTexture(64, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
    this.posts = [];
    const spots = [[-2.4, -2.4], [2.4, -2.4], [-2.4, 0.8], [2.4, 0.8]];
    const cols = [0xffd27f, 0x2fd6c0, 0x7fb2ff, 0xb79fff];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: cols[i], transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.2, 12, 1, true), mat);
      m.position.set(spots[i][0], 0.4, spots[i][1]);
      this.scene.add(m);
      this.posts.push(m);
    }
  }

  pulsePosts() { this.postPulse = 1; }

  // ---- floating dust ------------------------------------------------------
  buildDust() {
    const N = 240;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = Math.random() * 3.6 - 1.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.11 + aSeed * 6.2831) * 0.5;
          p.y += sin(uTime * 0.08 + aSeed * 12.566) * 0.35;
          p.z += cos(uTime * 0.09 + aSeed * 9.425) * 0.5;
          vA = 0.2 + 0.5 * aSeed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.010 + 0.020 * aSeed) * (700.0 / -mv.z);
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vA * 0.4;
          gl_FragColor = vec4(0.65, 0.72, 1.0, a);
        }`,
    });
    this.dust = new THREE.Points(g, m);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  // ---- target rings at the hit plane ---------------------------------------
  // Two faint rings where orbs arrive: punch THROUGH the ring.
  buildTargets() {
    this.targetRings = {};
    for (const h of ['left', 'right']) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.10, 0.125, 40),
        new THREE.MeshBasicMaterial({
          color: h === 'right' ? GOLD : TEAL, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      m.position.set(h === 'right' ? 0.35 : -0.35, -0.25, -0.55);
      this.scene.add(m);
      this.targetRings[h] = { m, flash: 0 };
    }
  }

  flashTarget(h) { this.targetRings[h].flash = 1; }

  // ---- orb pool --------------------------------------------------------------
  // Orbs spawn 2 beats ahead at z=-2.75 and reach the hit plane (z=-0.55)
  // exactly on their beat. Size ~0.16m: big, hittable targets.
  buildOrbs() {
    this.orbPool = [];
    for (let i = 0; i < 14; i++) {
      const grp = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.dotTex, color: 0xffffff, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(0.36, 0.36, 1);
      grp.add(core); grp.add(glow);
      grp.visible = false;
      this.scene.add(grp);
      this.orbPool.push({ grp, core, glow, active: false });
    }
  }

  // Returns the pool record, or null if the pool is exhausted.
  spawnOrbVisual(hand) {
    const o = this.orbPool.find(o => !o.active);
    if (!o) return null;
    o.active = true;
    const col = hand === 'right' ? GOLD : TEAL;
    o.core.material.color.set(col);
    o.glow.material.color.set(col);
    o.grp.visible = true;
    o.grp.position.set(hand === 'right' ? 0.35 : -0.35, -0.25, -2.75);
    o.grp.scale.set(1, 1, 1);
    o.glow.material.opacity = 0.8;
    o.core.material.transparent = false; // reset after a miss-fade
    o.core.material.opacity = 1;
    return o;
  }

  // progress: 0 at spawn -> 1 at the hit plane.
  moveOrbVisual(o, progress) {
    const z = -2.75 + progress * 2.2;
    o.grp.position.z = z;
    // Grow slightly + brighten as it arrives: telegraphs the hit moment.
    const s = 1 + 0.25 * progress * progress;
    o.grp.scale.set(s, s, s);
  }

  killOrbVisual(o) { o.active = false; o.grp.visible = false; }

  fadeOrbVisual(o, k) { // k: 0..1 fade amount (miss)
    o.glow.material.opacity = 0.8 * (1 - k);
    o.core.material.transparent = true;
    o.core.material.opacity = 1 - k;
    const s = 1 - 0.4 * k;
    o.grp.scale.set(s, s, s);
  }

  // ---- hit particle bursts (pooled points) --------------------------------------
  buildBursts() {
    const N = 320;
    this.bN = N;
    this.bPos = new Float32Array(N * 3);
    this.bCol = new Float32Array(N * 3);
    this.bVel = new Float32Array(N * 3);
    this.bLife = new Float32Array(N);
    for (let i = 0; i < N; i++) this.bPos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.bCol, 3));
    const m = new THREE.PointsMaterial({
      size: 0.045, vertexColors: true, map: this.dotTex, alphaTest: 0.01,
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.burstPts = new THREE.Points(g, m);
    this.burstPts.frustumCulled = false;
    this.scene.add(this.burstPts);
    this.bCursor = 0;
    this._c = new THREE.Color();
  }

  spawnBurst(p, colorHex, count = 20) {
    this._c.set(colorHex);
    for (let k = 0; k < count; k++) {
      const i = this.bCursor;
      this.bCursor = (this.bCursor + 1) % this.bN;
      this.bPos[i * 3] = p.x; this.bPos[i * 3 + 1] = p.y; this.bPos[i * 3 + 2] = p.z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 0.8 + Math.random() * 1.8;
      this.bVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.bVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9 + 0.4;
      this.bVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp + 1.2; // bias toward player
      this.bCol[i * 3] = this._c.r; this.bCol[i * 3 + 1] = this._c.g; this.bCol[i * 3 + 2] = this._c.b;
      this.bLife[i] = 0.5 + Math.random() * 0.3;
    }
  }

  updateBursts(dt) {
    for (let i = 0; i < this.bN; i++) {
      if (this.bLife[i] <= 0) continue;
      this.bLife[i] -= dt;
      if (this.bLife[i] <= 0) { this.bPos[i * 3 + 1] = -999; continue; }
      const dr = Math.exp(-dt * 2.4);
      this.bVel[i * 3] *= dr; this.bVel[i * 3 + 1] *= dr; this.bVel[i * 3 + 2] *= dr;
      this.bPos[i * 3] += this.bVel[i * 3] * dt;
      this.bPos[i * 3 + 1] += this.bVel[i * 3 + 1] * dt;
      this.bPos[i * 3 + 2] += this.bVel[i * 3 + 2] * dt;
    }
    this.burstPts.geometry.attributes.position.needsUpdate = true;
    this.burstPts.geometry.attributes.color.needsUpdate = true;
  }

  // ---- score popups (pooled rising text) ------------------------------------------
  buildPopups() {
    this.popups = [];
    for (let i = 0; i < 10; i++) {
      const spr = this.makeLabel(384, 128, 0.42, 0.14);
      spr.visible = false;
      this.scene.add(spr);
      this.popups.push({ spr, t: 1e9, dur: 0.9 });
    }
    this.popCursor = 0;
  }

  popup(text, pos, color = 'rgba(255,240,210,0.95)', big = false) {
    const p = this.popups[this.popCursor];
    this.popCursor = (this.popCursor + 1) % this.popups.length;
    this.setLabel(p.spr, text, { px: big ? 64 : 44, color });
    p.spr.position.copy(pos);
    p.spr.position.y += 0.12;
    p.t = 0;
    p.spr.visible = true;
    p.baseY = p.spr.position.y;
  }

  updatePopups(dt) {
    for (const p of this.popups) {
      if (p.t > p.dur) { p.spr.visible = false; continue; }
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.spr.position.y = p.baseY + k * 0.35;
      p.spr.material.opacity = 1 - k;
    }
  }

  // ---- hand visualization: fist glow + joint points ---------------------------
  buildHandViz() {
    this.handPts = {};
    this.fistGlows = {};
    const cols = { right: GOLD, left: TEAL };
    for (const h of ['right', 'left']) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
      const m = new THREE.PointsMaterial({
        size: 0.018, map: this.dotTex, alphaTest: 0.01, transparent: true, opacity: 0.9,
        color: cols[h], blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false; pts.visible = false;
      this.scene.add(pts);
      this.handPts[h] = pts;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.dotTex, color: cols[h], transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(0.11, 0.11, 1);
      glow.visible = false;
      this.scene.add(glow);
      this.fistGlows[h] = glow;
    }
  }

  setHandViz(h, jointPos, jointValid, palmPos) {
    const pts = this.handPts[h];
    let n = 0;
    for (let i = 0; i < 25; i++) if (jointValid[i]) n++;
    if (n < 8) {
      pts.visible = false; this.fistGlows[h].visible = false;
      return;
    }
    const attr = pts.geometry.attributes.position;
    let c = 0;
    for (let i = 0; i < 25; i++) {
      if (!jointValid[i]) continue;
      attr.array[c * 3] = jointPos[i * 3];
      attr.array[c * 3 + 1] = jointPos[i * 3 + 1];
      attr.array[c * 3 + 2] = jointPos[i * 3 + 2];
      c++;
    }
    attr.needsUpdate = true;
    pts.geometry.setDrawRange(0, c);
    pts.visible = true;
    this.fistGlows[h].position.copy(palmPos);
    this.fistGlows[h].visible = true;
  }

  hideHandViz(h) {
    this.handPts[h].visible = false;
    this.fistGlows[h].visible = false;
  }

  // ---- big center prompt ----------------------------------------------------
  buildPrompt() {
    this.prompt = this.makeLabel(768, 192, 1.15, 0.29);
    this.prompt.position.set(0, 0.18, -1.5);
    this.scene.add(this.prompt);
    this.promptOp = 0;
    this.prompt.material.opacity = 0;
  }

  showPrompt(text, opts) {
    this.setLabel(this.prompt, text, opts);
    this.promptOp = 1;
  }

  hidePrompt() { this.promptOp = 0; }

  // ---- HUD ------------------------------------------------------------------
  buildHud() {
    this.hudScore = this.makeLabel(512, 128, 0.55, 0.14);
    this.hudScore.position.set(-1.05, 0.62, -1.7);
    this.hudCombo = this.makeLabel(512, 160, 0.62, 0.19);
    this.hudCombo.position.set(0, 0.72, -1.7);
    this.hudStats = this.makeLabel(512, 128, 0.55, 0.14);
    this.hudStats.position.set(1.05, 0.62, -1.7);
    this.hudRound = this.makeLabel(640, 128, 0.62, 0.12);
    this.hudRound.position.set(0, -0.58, -1.7);
    for (const s of [this.hudScore, this.hudCombo, this.hudStats, this.hudRound]) {
      s.visible = false;
      this.scene.add(s);
    }
    this.comboPop = 0;
  }

  showHud() { for (const s of [this.hudScore, this.hudCombo, this.hudStats, this.hudRound]) s.visible = true; }
  hideHud() { for (const s of [this.hudScore, this.hudCombo, this.hudStats, this.hudRound]) s.visible = false; }

  setScore(v) { this.setLabel(this.hudScore, `SCORE\n${v}`, { px: 40 }); }
  setCombo(v) {
    this.setLabel(this.hudCombo, v > 1 ? `${v}\nCOMBO` : '', { px: 52, color: 'rgba(255,214,130,0.98)' });
    if (v > 1) this.comboPop = 1;
  }
  setStats(hits, total) {
    const acc = total > 0 ? Math.round(100 * hits / total) : 100;
    this.setLabel(this.hudStats, `${hits}/${total}\n${acc}%`, { px: 40 });
  }
  setRound(txt) { this.setLabel(this.hudRound, txt, { px: 36, color: 'rgba(160,175,210,0.9)' }); }

  // ---- BPM select orbs --------------------------------------------------------
  buildSelect() {
    this.selectGroup = new THREE.Group();
    this.selectOrbs = [];
    const bpms = [100, 110, 120];
    bpms.forEach((bpm, i) => {
      const x = (i - 1) * 0.55;
      const grp = new THREE.Group();
      grp.position.set(x, 0.02, -1.25);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.dotTex, color: i === 1 ? GOLD : TEAL, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(0.30, 0.30, 1);
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 20, 16),
        new THREE.MeshBasicMaterial({ color: i === 1 ? GOLD : TEAL })
      );
      const label = this.makeLabel(384, 128, 0.34, 0.11);
      this.setLabel(label, `${bpm}\nBPM`, { px: 40 });
      label.position.y = 0.24;
      grp.add(glow); grp.add(core); grp.add(label);
      grp.userData = { bpm, glow, base: 0.30, phase: i * 2.1, pos: grp.position };
      this.selectGroup.add(grp);
      this.selectOrbs.push(grp);
    });
    const title = this.makeLabel(768, 128, 0.9, 0.15);
    this.setLabel(title, 'PUNCH YOUR BPM', { px: 46 });
    title.position.set(0, 0.52, -1.25);
    this.selectGroup.add(title);
    this.selectGroup.visible = false;
    this.scene.add(this.selectGroup);
  }

  showSelect() { this.selectGroup.visible = true; }
  hideSelect() { this.selectGroup.visible = false; }

  // ---- end-of-session results panel ----------------------------------------------
  buildEndPanel() {
    this.endPanel = this.makeLabel(1024, 640, 1.35, 0.84);
    this.endPanel.position.set(0, 0.12, -1.7);
    this.endPanel.visible = false;
    this.scene.add(this.endPanel);
  }

  showEndPanel(text) {
    this.setLabel(this.endPanel, text, { px: 40 });
    this.endPanel.visible = true;
  }
  hideEndPanel() { this.endPanel.visible = false; }

  // ---- per-frame ------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.dust.material.uniforms.uTime.value = this.time;
    // Posts breathe; pulsePosts() spikes them on the beat.
    this.postPulse = Math.max(0, this.postPulse - dt * 2.2);
    for (const p of this.posts) p.material.opacity = 0.26 + 0.5 * this.postPulse;
    // Target rings: idle shimmer + hit flash decay.
    for (const h of ['left', 'right']) {
      const r = this.targetRings[h];
      r.flash = Math.max(0, r.flash - dt * 3);
      r.m.material.opacity = 0.28 + 0.12 * Math.sin(this.time * 2.2) + 0.6 * r.flash;
      const s = 1 + 0.35 * r.flash;
      r.m.scale.set(s, s, s);
    }
    // Select orbs breathe.
    if (this.selectGroup.visible) {
      for (const o of this.selectOrbs) {
        const s = o.userData.base * (1 + 0.10 * Math.sin(this.time * 2.6 + o.userData.phase));
        o.userData.glow.scale.set(s, s, 1);
      }
    }
    // Combo pop.
    this.comboPop = Math.max(0, this.comboPop - dt * 4);
    const cs = 1 + 0.3 * this.comboPop;
    this.hudCombo.scale.set(0.62 * cs, 0.19 * cs, 1);
    // Prompt fade.
    const k = 1 - Math.exp(-dt * 4);
    this.prompt.material.opacity += ((this.promptOp ? 1 : 0) - this.prompt.material.opacity) * k;
    this.updateBursts(dt);
    this.updatePopups(dt);
  }
}
