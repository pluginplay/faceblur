# Face Pipeline Incident Report

Input video: `/Users/dannyperry/Downloads/faceblur_test_1080_1.mp4`  
Debug video: `/private/var/folders/yx/nx6g9x516211k_sljvnz_z1h0000gn/T/faceblur_test_1080_1_faces_debug.mp4`  
Tracking JSON: `/private/var/folders/yx/nx6g9x516211k_sljvnz_z1h0000gn/T/faceblur_test_1080_1_faces_debug_tracking_output.json`

## Scope

This report documents verified ID/track failures in the requested windows:

- Frames `50-57`
- Frames `100-117`
- Frames `245-260`
- Frames `344-360` (includes requested 344/346/354 focus points)

Validation sources:

1. MCP video analyzer visual review
2. Frame-level `people` track data
3. Frame-level `faceTracks` association data
4. GMC telemetry embedded in `_gmc`

---

## Incident Log

## A) Frames 50-57: left cop ID handoff (`p1 -> p3`) and overlap conflict

### What is observed

- Frame `50`:
  - `p1` present with face association (`F1=Y`)
  - `p3` absent
- Frame `51`:
  - `p3` appears and immediately gets face association (`F3=Y`)
  - `p1` loses face association (`F1=N`)
- Frames `52-57`:
  - `p1` and `p3` both exist with significant spatial overlap, indicating duplicate/contested assignment
  - `p1` confidence decays from `0.76` (f51) to `0.53` (f57)

### Quantified evidence

- `p1/p3` overlap IoU by frame:
  - `52: 0.351`
  - `53: 0.338`
  - `54: 0.534`
  - `55: 0.481`
  - `56: 0.475`
  - `57: 0.368`
- `p1` center jumps from approximately `(0.381, 0.584)` at frame `50` to `(0.430, 0.673)` at frame `51` (abrupt reassignment signature).

### Impact

- Identity continuity for the left-side officer is broken.
- Two active IDs occupy overlapping space for several frames, raising hijack risk downstream.

---

## B) Frames 100-117: repeated ownership contention between `p7` and `p2`

### What is observed

- Face ownership toggles repeatedly between `p7` and `p2`:
  - `100-103`: `F7=Y`, `F2=N`
  - `104-107`: `F7=N`, `F2=Y`
  - `108`: `F7=Y`, `F2=N`
  - `109-110`: `F7=N`, `F2=Y`
  - `111`: `F7=Y`, `F2=N`
  - `112-113`: `F7=Y`, `F2=Y` (simultaneous ambiguity)
  - `114-117`: mostly `F7=Y`, `F2=N`
- Low-confidence transient track `p3` exists only `100-102` then dies.
- Additional overlaps (`p4` with `p7`) appear in latter half of the window.

### Quantified evidence

- Overlap IoU:
  - `p2/p7` overlap on `108-110`: `~0.217-0.232`
  - `p4/p7` overlap on `111-117`: up to `0.321`
- `p3` confidence drops `0.16 -> 0.08` then track disappears.
- GMC telemetry spikes in this window:
  - `111: dx=-13.3054, dy=4.045`
  - `114: dx=-10.5109, dy=5.7077`
  - `117: dx=-4.2617, dy=10.5815`

### Impact

- `p2` and `p7` are not identity-stable and compete for the same physical subjects.
- The user-observed PID theft behavior is consistent with this contention pattern.

---

## C) Frames 245-260: green suspect face track blinking

### What is observed

- Person track `p5` is present for all frames `245-260`.
- Face track for `p5` is intermittent (blinking), despite person visibility.

### Quantified evidence

- `p5` face missing on frames:
  - `246, 249, 250, 253, 255, 256, 257, 260`
- Dropout rate in this window:
  - `8 / 16` frames missing (`50%`)
- Full-frame face outages while people are present:
  - frame `246`: zero face tracks
  - frame `260`: zero face tracks

### Impact

- Exactly matches reported blink-out behavior when suspect remains visible.
- Weakens blur continuity and identity confidence for critical subject.

---

## D) Frames 344-360: `p4` takeover + repeated `p1` hijack behavior

### What is observed

- `p4` is stable and high-confidence through this interval (`~0.80-0.94`), matching report that left-side black cop is now `p4`.
- New ID `p14` appears near `p1` at frame `345`.
- `p1` and `p14` overlap heavily around `346-347`.
- `p1` confidence is weak through `345-353`, then jumps at `354` with positional shift (reattachment signature).
- `p5/p7` remain overlapping through much of this window, indicating ongoing identity contention on the right side.

### Quantified evidence

- `p1/p14` overlap:
  - `345: 0.288`
  - `346: 0.431`
  - `347: 0.430`
- `p5/p7` overlap:
  - recurrent `~0.25-0.45` from `344-360`
  - peak at frame `360`: `0.447`
- Face association starvation:
  - `344-350`: only `p4` has a face track despite 4-5 visible people
  - `p1` has no face association in `344-360`

### Impact

- Confirms repeated `p1` hijack/rebind behavior near `346` and `354`.
- Produces unstable ID history under crowding and partial occlusions.

---

## Global Quality Signals (same run)

- Frame count: `694`
- Tracks: `13` person IDs, `11` face-track groups
- Face tracking blackouts:
  - `91` frames with person tracks present but zero face tracks
  - longest zero-face run: frames `186-205` (`20` consecutive frames)
- Face coverage per long-lived ID is weak:
  - `p1`: `34/457` (`7.4%`)
  - `p7`: `28/427` (`6.6%`)
  - `p5` (green suspect): `85/604` (`14.1%`)
- Pipeline runtime stats:
  - person detections: `926`
  - face detections: `1199`
  - associated faces: `1190`
  - unassociated faces: `9`

Note: despite low `unassociatedFaces`, continuity is poor because associations are sparse/unstable over time for key IDs.

---

## ML Pipeline Improvement Opportunities

These are prioritized by expected impact on the observed failure modes.

## 1) Raise temporal density of person detections (high impact)

### Why

- Current detection sampling is sparse (`detection_fps` path via scheduler), so tracker predicts through too many non-detection frames.
- In crowded interactions, this increases ID drift and handoff errors (`50-57`, `344+`).

### Current implementation hooks

- `FrameScheduler` computes stride from `video_fps / detection_fps`.
- `PipelineRunner` runs person detection only on detection frames.

### Suggested changes

- Increase `detection_fps` for crowded scenes (or adaptively boost near high-overlap periods).
- Add adaptive scheduling:
  - if overlap/conflict indicators spike, temporarily run denser detection for N frames.

---

## 2) Make association geometry less binary (high impact)

### Why

- In `OCSort::associate` and `associateOCR`, matches are hard-gated by `iou >= iou_thresh`.
- This causes track drops/rebirth when boxes jitter or partial occlusion temporarily lowers IoU.

### Current implementation hooks

- `ocsort.cpp`:
  - hard invalid geometry cost for `iou < iou_thresh`
  - OCR pass still requires IoU gate for acceptance

### Suggested changes

- Replace hard IoU gate with soft composite gate:
  - combine IoU + normalized center distance + area ratio
  - allow low-IoU recovery when center-distance and motion consistency are strong
- Keep stricter gate for spawning new IDs to avoid false merges.

---

## 3) Use ReID for rescue associations beyond overlap-only cases (high impact)

### Why

- Current logic is geometry-first to the point that appearance helps only after IoU already passes.
- This blocks ReID from fixing exactly the cases where IoU temporarily fails due to occlusion/camera motion.

### Current implementation hooks

- `ocsort.cpp`:
  - `reid_bonus` only applied for `iou >= iou_thresh`
  - OCR appearance weighting similarly gated

### Suggested changes

- Permit ReID-assisted matching in OCR when:
  - IoU is near-threshold (not necessarily above)
  - appearance similarity is high
  - center-distance/velocity consistency are acceptable
- Add a conservative cap so appearance cannot cause long-range teleport matches.

---

## 4) Stabilize face-to-person assignment with temporal memory (high impact)

### Why

- Face association is frame-local Hungarian assignment with no persistence term.
- This enables frequent face ownership toggles (`100-117`) and blink behavior (`245-260`).

### Current implementation hooks

- `FacePersonAssociator` uses per-frame IoU/overlap/center gates only.

### Suggested changes

- Add temporal prior in face-person association score:
  - bonus for last associated person ID for that face trajectory
  - penalty for switching IDs unless score margin exceeds threshold
- Optionally add short face-track interpolation for 1-3 frame gaps.

---

## 5) Add ambiguity suppression when two person IDs overlap too much (medium-high impact)

### Why

- Windows `50-57` and `344-360` show same-frame duplicate IDs with high overlap.

### Suggested changes

- Add overlap conflict resolution:
  - when two active IDs overlap above threshold and one has much lower confidence/history support, suppress or freeze the weaker ID update.
- Track-level hysteresis:
  - require stronger evidence before allowing rapid identity reassignment in crowded clusters.

---

## 6) GMC robustness checks and fallback behavior (medium impact)

### Why

- Large GMC displacement spikes correlate with identity churn (`100-117`).

### Current implementation hooks

- GMC applied to tracker state when sampled; no explicit quality gate in runner path beyond estimator success.

### Suggested changes

- Add GMC sanity checks (inlier quality, bounded transform magnitude).
- If warp quality is poor/spiky:
  - skip warp for that frame
  - increase detector frequency temporarily
  - reduce motion prior weight for assignment.

---

## 7) Improve face continuity output (medium impact)

### Why

- Even when person tracks are stable enough, face keyframes are sparse and blinky for important IDs.

### Suggested changes

- In post-processing:
  - fill short face-track gaps (1-2 frames) via interpolation or previous-face carry-forward when person box remains stable.
  - enforce minimum temporal persistence for face disappearance before declaring face missing.

---

## 8) Add explicit ID-switch metrics into pipeline stats (medium impact)

### Why

- Current stats track counts and timing but not identity health.

### Suggested changes

- Emit metrics per run:
  - same-frame high-overlap duplicate ID count
  - ID-switch estimate count (spatial continuity breakpoints)
  - face blink rate per person ID
  - percentage of frames with person present but no face

This allows regression testing from JSON without manual video review.

---

## 9) Parameter sweep recommendations for this clip (fast validation path)

Before algorithmic refactors, run controlled sweeps:

1. `detection_fps`: increase from current value to reduce prediction-only spans.
2. `tracker.iou_thresh`: evaluate lower and near-current values with added distance gate.
3. face association gates:
   - `face_person_iou_thresh` down slightly
   - tune overlap threshold + center requirement together
4. `max_age` and occlusion behavior:
   - ensure lost tracks are recovered before new IDs are spawned in short occlusions.

Use this same clip + windows as acceptance criteria.

---

## Recommended Implementation Order

1. Add instrumentation metrics (#8) and overlap conflict counters.
2. Improve assignment gating with soft geometry + ReID rescue (#2, #3).
3. Add temporal memory to face-person association (#4).
4. Add adaptive detection scheduling for crowded/high-conflict periods (#1).
5. Add GMC sanity gating (#6).
6. Add short-gap face continuity smoothing (#7).

