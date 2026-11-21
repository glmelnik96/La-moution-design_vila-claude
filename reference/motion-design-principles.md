# Motion-design principles → After Effects

Practical motion theory distilled from motion-design skills (remotion, gsap,
lottiefiles, gsap-scrolltrigger, haidrrrry) and mapped to what you can actually
do in ExtendScript. **Nothing in nature moves linearly.** The single biggest
quality lever in AE is *temporal easing*, not more keyframes.

The AE bridge for everything below is `setTemporalEaseAtKey(index, [inEase], [outEase])`
with `KeyframeEase(speed, influence)` objects (see `extendscript-patterns.md` §4).
`influence` is a percentage `0.1–100`; higher influence = longer the curve "holds"
its slope near that keyframe = more pronounced ease. `speed` is in units/sec
(usually leave `0` at rest keyframes so the curve flattens there).

---

## 1. Never ship linear motion

Default AE keyframes are LINEAR — the amateur look. For any move that should feel
physical, convert to BEZIER and apply easing. Rule of thumb:

- **Ease OUT** (fast start, slow stop) → things arriving/settling into place.
- **Ease IN** (slow start, fast end) → things leaving / accelerating away.
- **Ease IN-OUT** → self-contained A→B moves where both ends are at rest.
- **LINEAR** → only for constant-velocity mechanics (conveyors, continuous
  rotation, marquees) and for held/HOLD-style states.

## 2. Cubic-bezier → AE influence cheat-sheet

Web/GSAP eases are cubic-beziers `(x1,y1,x2,y2)`. AE keyframes do not take the
handles as-is, but the mapping to `KeyframeEase(speed, influence)` is **exact** (see
§2b) — use `M.bezierEase(prop, k, [x1,y1,x2,y2])` from `scripts/lib/cloudru-motion.jsx`
and you get the same curve in AE and in the HTML engine. The table below is the
zero-speed *shorthand* (good enough when both ends are at rest), translated to
AE `KeyframeEase.influence`:

| Feel | Web bezier | AE start-key outEase influence | AE end-key inEase influence |
|---|---|---|---|
| Gentle ease-out | `0, 0, 0.58, 1` | ~33 | ~75 |
| Standard ease-in-out | `0.42, 0, 0.58, 1` | ~66 | ~66 |
| Smooth "material" | `0.4, 0, 0.2, 1` | ~45 | ~85 |
| **Punchy expo-out** (the "premium" curve) | `0.16, 1, 0.3, 1` | ~10 | ~90 |
| Snappy expo-in-out | `0.87, 0, 0.13, 1` | ~90 | ~90 |
| Slow-mo hero | `0.25, 1, 0.25, 1` | ~20 | ~95 |

`0.16, 1, 0.3, 1` recurs across multiple skills as the go-to "expensive-looking"
ease for UI/title reveals — start-key barely eases, end-key eases hard. When in
doubt for a reveal, use it.

Applying it (start key eases out low, land key eases in high):

```jsx
var ease0 = new KeyframeEase(0, 10);   // leave the start
var ease1 = new KeyframeEase(0, 90);   // arrive at the end
prop.setTemporalEaseAtKey(1, [ease0], [ease0]);
prop.setTemporalEaseAtKey(2, [ease1], [ease1]);
```

**Arity gotcha (live-verified against AE 2024):** for a **non-separated** spatial
property like Position, `setTemporalEaseAtKey` takes a **single-element** array
`[ease]` — temporal ease is one scalar for the whole property, NOT one per
dimension. Passing `[e, e]` throws *"Value array does not have 1 elements."*
Only when Dimensions are **separated** (or for genuinely 1-D props) does the count
match the dimension count. Always `setInterpolationTypeAtKey(i, BEZIER, BEZIER)`
before applying ease.

```jsx
var e = new KeyframeEase(0, 90);
pos.setTemporalEaseAtKey(2, [e], [e]);   // 1 element for non-separated Position
```

### 2b. Exact bezier → KeyframeEase conversion (the math both engines share)

AE's temporal curve between key `k` (time `t0`, value `v0`) and key `k+1` (`t1`, `v1`) is a
cubic bezier in (time, value) space whose handles are expressed as **influence** (how far
along the segment's time span the handle reaches, in %) and **speed** (the handle's slope,
in value-units per second). A CSS `cubic-bezier(x1,y1,x2,y2)` is the same curve normalised
to a unit square. With `Δt = t1 − t0` and `Δv = v1 − v0` (for multi-dimensional properties
use the *length* of the delta — non-separated Position has one temporal ease):

```
key k   outInfluence = x1 · 100            outSpeed = y1 · Δv / (x1 · Δt)
key k+1 inInfluence  = (1 − x2) · 100      inSpeed  = (1 − y2) · Δv / ((1 − x2) · Δt)
```

This is the inverse of what Bodymovin/Lottie does when it exports AE keys to web beziers,
so the round trip is lossless. Practical clamps: AE requires `0.1 ≤ influence ≤ 100`, so
`x1 = 0` becomes influence 0.1 with speed 0 (a genuinely linear start), and `x2 = 1`
likewise. A `y > 1` (overshoot bezier) yields a speed larger than the average velocity — AE
accepts it, but the Cloud.ru brand forbids overshoot, so the token set has none.

Worked example — `enter` = `0.16, 1, 0.3, 1`, Position moving 40 px over 0.4 s:
`Δv/Δt = 100 px/s` → key 1 out: influence 16, speed 625; key 2 in: influence 70, speed 0.
That is the difference between the old "10 / 90 approximation" and the real curve: the real
one leaves the first key *fast* (speed 625) and lands with a long, heavy 70 % deceleration.

```jsx
// scripts/lib/cloudru-motion.jsx
M.bezierEase(pos, 1, CR.EASE.ENTER);   // eases the pair (key 1 → key 2)
M.tween(pos, 0, 400, [960, 580], [960, 540], "enter");  // keys + ease + flattened path in one call
```

`speed` must be signed like `Δv` for 1-D properties (a value decreasing from 100 to 0 has a
negative Δv, so the out-speed is negative). The lib handles that; do it by hand only if you
are not using the lib.

### Spatial tangents (shaping the motion path)

Separate from temporal ease. `setSpatialTangentsAtKey(index, inTan, outTan)` IS
available from ExtendScript — live-verified. **Each tangent is a 3-element
`[x, y, z]` vector even in a 2D comp** (pass `z = 0`); a 2-element array throws
*"Value array does not have 3 elements."* Read back with
`keyInSpatialTangent(i)` / `keyOutSpatialTangent(i)`.

```jsx
pos.setSpatialTangentsAtKey(1, [0,0,0], [120,-60,0]);  // out-handle at key 1
pos.setSpatialTangentsAtKey(2, [-120,-60,0], [0,0,0]); // in-handle at key 2
```

## 3. Overshoot / spring (the "bounce-back")

A spring overshoots the target then settles. AE has no native spring, three ways:

1. **Keyframe overshoot** — add a 3rd keyframe past the target then back:
   `0 → 110% → 100%` (scale) or `0px → +8px → 0px`, eased. Cheap, art-directable,
   render-stable. Best default for one-off UI pops.
2. **Overshoot expression** on the property (damped sine after the last key):
   ```jsx
   // amp=overshoot, freq=bounces/sec, decay=how fast it settles
   amp=0.12; freq=3.0; decay=5.0;
   n = nearestKey(time).index; if (key(n).time > time) n--;
   if (n > 0) { t = time - key(n).time;
     value + amp*Math.sin(t*freq*Math.PI*2)/Math.exp(decay*t) } else value
   ```
   Great for organic settle without extra keys; see `expression-library.md` for
   the proven inertia/overshoot variants.
3. **Two-key ease with heavy end influence** (~95) approximates a critically-damped
   spring (no overshoot, just soft landing).

Damped-harmonic intuition (from physics-based sources): more `amp` = bigger
overshoot, more `freq` = more wobbles, more `decay` = quicker to rest. Keep
`decay` high (4–7) so it doesn't feel floaty.

## 4. Disney principles that matter in AE

- **Anticipation** — a small counter-move before the main action (pull back
  before lunging forward). One extra keyframe; sells intent.
- **Follow-through & overlap** — parts arrive/leave at slightly different times;
  trailing elements keep moving after the leader stops. Achieve via staggered
  keyframe times per layer/property.
- **Slow in / slow out** — = easing (§1). The most important, most cheaply won.
- **Squash & stretch** — brief non-uniform Scale on impact/launch (e.g.
  `[110,90]` then `[100,100]`) to convey weight and speed. Keep volume roughly
  constant.
- **Secondary action** — supporting motion (a shadow, a highlight, a subtle
  rotation) that reinforces the primary without competing.
- **Staging** — one clear focal point per moment; don't animate everything at
  once. Use timing and contrast to direct the eye.

## 5. Stagger & choreography

Sequencing beats simultaneity. For N similar layers (list items, letters, cards),
offset each start by a small delay so they cascade:

- **Keyframe stagger** — shift each layer's keyframes by `i * offset` frames.
  Typical offset: 2–5 frames at 30fps (~0.06–0.16s). Too large = sluggish.
- **Expression stagger** (no baked keyframes) — drive from a controller time with
  `delay = index * 0.06; t = time - inPoint - delay;` then map `t` through your
  ease. Reorder/insert layers freely without re-keying.
- **Direction & anchor** — cascade in reading order (top-left → bottom-right) or
  from a focal point outward. Consistent direction reads as intentional.
- **Overlap the tail** — start element `i+1` before `i` fully finishes (~50–70%
  through) so the sequence flows instead of stepping.

## 6. Timing & duration heuristics

Think in **frames**, not just seconds — snap to the comp fps.

| Move | Duration (feel) | @30fps | @60fps |
|---|---|---|---|
| Micro UI (hover, tap, toggle) | 0.10–0.20s | 3–6f | 6–12f |
| Standard element in/out | 0.30–0.50s | 9–15f | 18–30f |
| Title / hero reveal | 0.60–1.0s | 18–30f | 36–60f |
| Scene transition | 0.5–0.8s | 15–24f | 30–48f |

- **Enter faster than you think, exit faster still.** Exits at ~70% of the enter
  duration feel snappier.
- **Match easing to duration**: short moves tolerate strong eases; long moves need
  gentler curves or they feel like they stall.
- Snap keyframe times to whole frames (`comp.frameDuration`) to avoid sub-frame
  judder on export.

## 7b. IBM Carbon motion system (productive vs expressive)

IBM's motion guide is the reference when the brief is "design-system / editorial /
technical" rather than playful. Core creed: **motion is essential and efficient — it
guides the eye and confirms cause/effect. Avoid motion that is unnatural, distracting,
or purely decorative.** A perpetual idle wiggle/float on titles violates this — it is
the canonical anti-pattern. Keep content still once settled; carry "life" via
choreographed entrances/exits, the subject's own animation, and ambient *background*
drift only.

Two families:
- **Productive** — quick, efficient; microinteractions, UI feedback (fast).
- **Expressive** — smooth, gentle; larger moves, attention/interruption (slower).

Easing tokens (`@carbon/motion`). Entrance **decelerates** (ease-out), exit
**accelerates** (ease-in), standard for on-screen A→B:

| Token | cubic-bezier | AE influence (start out / land in) |
|---|---|---|
| productive-standard | `0.2, 0, 0.38, 0.9` | ~40 / ~70 |
| productive-entrance | `0, 0, 0.38, 0.9` | ~20 / ~70 |
| productive-exit | `0.2, 0, 1, 0.9` | ~40 / ~10 |
| expressive-standard | `0.4, 0.14, 0.3, 1` | ~55 / ~85 |
| expressive-entrance | `0, 0, 0.3, 1` | ~20 / ~85 |
| expressive-exit | `0.4, 0.14, 1, 1` | ~55 / ~10 |

`reveal()`'s (12 start / 90 land) is essentially expressive-entrance — correct for
hero title reveals.

Durations scale with **object size / distance travelled** (bigger = longer):
fast-01/02 = 70/110 ms (small UI, toggles), moderate-01/02 = 150/240 ms (standard
elements, dialogs), slow-01/02 = 400/700 ms (large panels, hero moves). At 30 fps:
70 ms≈2f, 110 ms≈3f, 150 ms≈5f, 240 ms≈7f, 400 ms≈12f, 700 ms≈21f.

## 7. Quick decision tree

1. Is it constant-velocity mechanics? → LINEAR, done.
2. Arriving/settling? → BEZIER, ease-out heavy (end influence ~85–95).
3. Leaving? → BEZIER, ease-in.
4. Self-contained A→B at rest both ends? → ease-in-out.
5. Should it feel bouncy/alive? → add overshoot (§3).
6. Multiple similar elements? → stagger them (§5), don't fire simultaneously.
7. Feels dead? → add anticipation + follow-through (§4) before adding more keys.
