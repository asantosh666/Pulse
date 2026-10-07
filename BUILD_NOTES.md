# PULSE — Build Notes (week-1 validation spike)

## What this is
Bare-hand rhythm boxing for Quest 3 (WebXR). No controllers, no audio assets,
no store — a single web page. The week-1 question: **can Quest hand tracking
reliably detect intentional punches at 100–120 BPM, and does it feel
responsive?** Everything in this spike serves that question. The end-of-session
results screen (hit-rate per BPM round + peak hand speeds + threshold used) is
the validation output — screenshot it after each playtest.

## Session flow
1. **BPM select** — punch one of three floating orbs (100 / 110 / 120). Rounds
   then run 3×45s ascending cyclically from the pick (e.g. 110 → 110/120/100),
   so per-BPM hit-rate data stays comparable while the user chooses the start.
2. **Warmup (10s)** — "THROW SOME PUNCHES!" Kick metronome at the selected BPM,
   unscored practice orbs every beat (gold = right, teal = left). Measures peak
   hand speeds, then sets the punch threshold: `clamp(0.55 × peak, 1.8, 3.5)`.
   If the user barely punched (peak < 1.5 m/s) it falls back to 2.5 m/s.
3. **Rounds** — 4-beat count-in, then orbs: alternating R/L, a double every 8th
   orb. Kick on every beat, hat on offbeats, 4-note synth bass walk.
4. **Rests (10s)** between rounds. **Results screen** at the end.

## Detection approach
- **Palm position** = average of wrist + 4 finger metacarpals. Deliberately not
  fingertips: they're noisier and lag the fist's mass.
- **Speed** = asymmetrically-smoothed palm velocity. Fast attack (τ≈20ms) so
  the punch onset isn't dulled; slower release (τ≈90ms) to ride out tracking
  jitter on the way down.
- **Punch event** = smoothed speed crosses threshold, with two guards:
  hysteresis re-arm (speed must fall below 45% of threshold before the next
  punch can fire) + 250ms cooldown. One punch can't double-fire; fast waving
  can't machine-gun.
- **Hit** = a punch whose hand is within 0.35 m of the orb's hit-plane slot
  inside a ±120 ms window around the beat. Matched against the fixed slot
  (not the orb's interpolated position) — you punch *through the ring* where
  the orb arrives.
- **Miss** = orb passes beat + 120 ms unhit. Small fade, combo resets.

## Tuning knobs (all in code, all fair game)
| Knob | Default | Where |
|---|---|---|
| Punch threshold (adaptive) | 0.55 × warmup peak, clamp 1.8–3.5 m/s, fallback 2.5 | main.js `finishWarmup` |
| Provisional threshold (select/warmup) | 2.5 m/s | main.js `DEFAULT_THRESHOLD` |
| Hit timing window | ±120 ms | main.js `HIT_WIN` |
| Hit distance | 0.35 m from hit-plane slot | main.js `HIT_DIST` |
| Orb size | 0.16 m diameter (r=0.08) | visuals.js `buildOrbs` |
| Orb travel | 2.2 m over 2 beats (spawn z=-2.75 → hit z=-0.55) | main.js |
| Hit plane | x=±0.35, y=-0.25, z=-0.55 (local space, origin at headset) | main.js / visuals.js `buildTargets` |
| BPMs | 100 / 110 / 120 | main.js `startWarmup` |
| Round / rest / warmup | 45 s / 10 s / 10 s | main.js |
| Orb pattern | alternate R/L, double every 8th | main.js `startRound` |
| Punch cooldown | 250 ms | hands.js |
| Re-arm level | 45% of threshold | hands.js |
| Velocity smoothing | attack τ=20ms, release τ=90ms | hands.js |
| Floor height | y=-1.2 (compromise: seated ≈-1.15, standing ≈-1.6) | visuals.js |

## What would make this feel better (honest list)
1. **Per-hand thresholds.** Right and left peak speeds differ (dominant hand).
   One shared threshold is a compromise; calibrate per hand.
2. **Latency calibration.** Audio output latency on Quest browsers (~50–150 ms)
   means "on the beat" as heard ≠ the audio clock. A tap-to-calibrate offset
   (like Rock Band) would tighten perceived sync more than any detection tweak.
3. **Jitter filtering.** The 90 ms release smoothing is a guess. If playtests
   show phantom punches at 1.8 m/s, raise the clamp floor or add a 2-frame
   persistence requirement (speed must exceed threshold 2 frames running).
4. **Telegraphing.** Orbs currently just fly in. An approach ring that shrinks
   onto the target ring in the last beat would buy the player 200 ms of
   anticipation — the single cheapest feel upgrade.
5. **Fist-orientation check.** A fast open-hand wave currently counts the same
   as a punch. Requiring finger curl (fist) via joint angles would cut false
   positives and make hits feel more "thrown."
6. **Early/late feedback.** "EARLY"/"LATE" popups (±ms readout) instead of a
   binary hit/miss would teach timing and produce better validation data.
7. **Haptics are impossible** with bare hands — the impact *sound* carries the
   entire feeling of connection. It deserves the most tuning love (layering,
   slight pitch variation with punch speed).
8. **120 BPM doubles** may exceed comfortable hand alternation for casual
   players; if hit-rate craters specifically on doubles at 120, that's a
   charting problem, not a tracking problem — thin them out.
9. **The ∞ problem.** Horizon OS reserves palm-pinch (hold thumb+index, look
   at palm) as the system exit gesture. This spike uses punches, not pinches,
   so it sidesteps it — keep it that way.

## Playtest protocol
1. Open in Quest browser, tap to enter, enable hand tracking if nagged.
2. Punch a BPM orb. Warmup: throw real punches for 10 s (this sets YOUR threshold).
3. Play 3 rounds. Screenshot the results screen.
4. Report: per-BPM hit-rate, whether punches felt detected vs. ignored,
   any phantom hits, and which BPM felt best.
