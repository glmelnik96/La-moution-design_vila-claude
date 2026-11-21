# Expression library

Mechanical, verbatim port of the authoritative `SNIPPETS` array from
`Extensions-LLM-Chat/lib/pure/expressionLibrary.js` — Dan Ebberts /
motionscript.com classics, Animoplex patterns, and standard AE idioms. Every
entry is rendered; expression text is copied exactly from source. Replace
UPPERCASE placeholders where noted. Create any `Requires` effects first (via
`add_effect`) before applying.

> On localized AE (RU etc.) effect *display* names differ — reference effects by
> the exact name reported after `add_effect`, not the English name here.

**53 snippets.**

---

### Inertial bounce after keyframes (Ebberts)  `inertial-bounce`
- **Keywords:** bounce, inertia, spring, elastic, overshoot, jiggle, пружина, отскок
- **Target:** Any keyframed property (Position, Scale, Rotation)
- **Requires:** none

```jsx
var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) n--;
}
if (n > 0 && time - key(n).time < 1) {
  var t = time - key(n).time;
  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);
  var amp = 0.05, freq = 4.0, decay = 8.0;
  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);
} else {
  value;
}
```

Add AFTER setting keyframes — overshoots past each keyframe and settles. Tune: amp (strength), freq (oscillations/sec), decay (how fast it settles).

---

### Wiggle (organic random motion)  `wiggle-basic`
- **Keywords:** wiggle, random, shake, jitter, handheld, тряска, дрожание
- **Target:** Position / Rotation / Scale / any
- **Requires:** none

```jsx
wiggle(3, 30)
```

wiggle(frequency, amplitude). 3 = times per second, 30 = max deviation in units of the property.

---

### Wiggle one axis only  `wiggle-one-axis`
- **Keywords:** wiggle, horizontal, vertical, x only, y only, axis, одна ось
- **Target:** Position (2D)
- **Requires:** none

```jsx
var w = wiggle(3, 50);
[w[0], value[1]]
```

Wiggles X only; swap to [value[0], w[1]] for Y only. For 3D add value[2].

---

### Wiggle controlled by sliders  `wiggle-slider`
- **Keywords:** wiggle, slider, control, rig, adjustable, контроллер
- **Target:** Any
- **Requires:** ADBE Slider Control, ADBE Slider Control

```jsx
wiggle(effect("Wiggle Freq")("Slider"), effect("Wiggle Amp")("Slider"))
```

Add TWO Slider Controls first and rename them "Wiggle Freq" and "Wiggle Amp" (or keep default names and update the expression). Lets the user keyframe wiggle intensity.

---

### Seamlessly looping wiggle  `wiggle-loop`
- **Keywords:** wiggle, loop, seamless, cycle, gif, бесшовный
- **Target:** Any
- **Requires:** none

```jsx
var freq = 1, amp = 50, loopTime = 3;
var t = time % loopTime;
var w1 = wiggle(freq, amp, 1, 0.5, t);
var w2 = wiggle(freq, amp, 1, 0.5, t - loopTime);
linear(t, 0, loopTime, w1, w2)
```

Wiggle that repeats perfectly every loopTime seconds — for GIFs/loops.

---

### Loop keyframes (cycle)  `loop-cycle`
- **Keywords:** loop, repeat, cycle, loopout, зациклить, повтор
- **Target:** Any keyframed property
- **Requires:** none

```jsx
loopOut("cycle")
```

Requires 2+ keyframes. Variants: loopOut("pingpong") back-and-forth, loopOut("offset") keeps accumulating, loopOut("continue") extrapolates last velocity. loopIn() mirrors before the first key.

---

### Loop keyframes (pingpong)  `loop-pingpong`
- **Keywords:** loop, pingpong, back and forth, туда-сюда, маятник
- **Target:** Any keyframed property
- **Requires:** none

```jsx
loopOut("pingpong")
```

Plays keyframes forward then backward, repeating. Requires 2+ keyframes.

---

### Typewriter text reveal  `typewriter`
- **Keywords:** typewriter, typing, text reveal, letters, печатная машинка, набор текста
- **Target:** Text>Source Text
- **Requires:** none

```jsx
var full = text.sourceText;
var dur = 2.0;
var chars = Math.floor(linear(time - inPoint, 0, dur, 0, full.length));
full.substr(0, chars)
```

Reveals the layer's own text over `dur` seconds starting at the layer in-point. Pure expression — no animator needed.

---

### Animated number counter  `counter-number`
- **Keywords:** counter, number, count up, increment, счетчик, число
- **Target:** Text>Source Text
- **Requires:** none

```jsx
Math.floor(linear(time, 0, 3, 0, 100)).toString()
```

Counts 0→100 over 3 seconds. For thousands separators see counter-formatted.

---

### Counter with thousands separator  `counter-formatted`
- **Keywords:** counter, number, comma, thousands, format, разряды, счетчик
- **Target:** Text>Source Text
- **Requires:** none

```jsx
var n = Math.round(linear(time, 0, 3, 0, 25000));
var s = "" + n, out = "";
while (s.length > 3) { out = "," + s.substr(-3) + out; s = s.substr(0, s.length - 3); }
s + out
```

Counts to 25 000 with commas (25,000). Change targets/timing in linear().

---

### Countdown timer mm:ss  `countdown-timer`
- **Keywords:** countdown, timer, clock, minutes, seconds, таймер, обратный отсчет
- **Target:** Text>Source Text
- **Requires:** none

```jsx
var t = Math.max(0, 10 - time);
var m = Math.floor(t / 60);
var s = Math.floor(t % 60);
m + ":" + (s < 10 ? "0" + s : s)
```

Counts down from 10s. Replace 10 with total seconds.

---

### Auto fade in/out at layer in/out points  `auto-fade`
- **Keywords:** fade, fade in, fade out, opacity, auto, появление, исчезновение
- **Target:** Transform>Opacity
- **Requires:** none

```jsx
var fade = 0.5;
Math.min(linear(time, inPoint, inPoint + fade, 0, 100), linear(time, outPoint - fade, outPoint, 100, 0))
```

No keyframes needed — fades 0.5s after in-point and 0.5s before out-point. Survives retiming the layer.

---

### Follow another layer with delay (lag)  `follow-delay`
- **Keywords:** follow, delay, lag, trail, chase, следовать, задержка, хвост
- **Target:** Transform>Position
- **Requires:** none

```jsx
var delay = 0.2;
thisComp.layer("LEADER").transform.position.valueAtTime(time - delay)
```

Replace LEADER with the source layer name (or use link_properties for a direct link without delay). For chains of copies use trail-by-index.

---

### Trail — each copy follows the layer above  `trail-by-index`
- **Keywords:** trail, snake, chain, follow, duplicate, хвост, цепочка
- **Target:** Transform>Position
- **Requires:** none

```jsx
var delay = 0.1;
thisComp.layer(index - 1).transform.position.valueAtTime(time - delay)
```

Apply to duplicates stacked under an animated leader: each layer follows the one above with 0.1s lag.

---

### Stagger animation by layer index  `stagger-by-index`
- **Keywords:** stagger, offset, cascade, delay, sequence, каскад, смещение
- **Target:** Any keyframed property (on duplicated layers)
- **Requires:** none

```jsx
var delay = 0.1 * (index - 1);
valueAtTime(time - delay)
```

Duplicate one keyframed layer N times — each copy plays the same animation 0.1s later. Classic cascade.

---

### Squash & stretch from velocity  `squash-stretch`
- **Keywords:** squash, stretch, velocity, cartoon, ball, деформация, мячик
- **Target:** Transform>Scale
- **Requires:** none

```jsx
var v = length(transform.position.velocity);
var f = linear(v, 0, 1500, 1, 1.3);
[value[0] / f, value[1] * f]
```

Volume-preserving: stretches along Y while moving fast. Animate Position with keyframes first. Tune 1500 (speed for max stretch) and 1.3 (max factor). For horizontal motion swap the axes.

---

### Rotate toward direction of motion  `rotate-to-motion`
- **Keywords:** rotate, direction, orient, velocity, arrow, поворот, направление
- **Target:** Transform>Rotation
- **Requires:** none

```jsx
var d = 0.01;
var v = transform.position.valueAtTime(time + d) - transform.position.valueAtTime(time);
length(v) > 0.001 ? radiansToDegrees(Math.atan2(v[1], v[0])) : value
```

Expression alternative to Layer > Transform > Auto-Orient. Add a constant offset (e.g. + 90) if the artwork points up.

---

### Circular / orbital motion  `circular-motion`
- **Keywords:** circle, orbit, rotation path, around, круг, орбита
- **Target:** Transform>Position
- **Requires:** none

```jsx
var center = [thisComp.width / 2, thisComp.height / 2];
var radius = 200, speed = 0.5;
var a = time * speed * 2 * Math.PI;
center + [Math.cos(a) * radius, Math.sin(a) * radius]
```

Orbits comp center. speed = revolutions per second.

---

### Pendulum swing (decaying)  `pendulum`
- **Keywords:** pendulum, swing, rock, oscillate, маятник, качание
- **Target:** Transform>Rotation
- **Requires:** none

```jsx
var freq = 1.0, amp = 30, decay = 0.7;
amp * Math.sin(freq * time * 2 * Math.PI) / Math.exp(decay * time)
```

Swings ±30° and settles. Set decay to 0 for perpetual swing. Move the anchor point to the pivot first.

---

### Box auto-sizes to text (sourceRectAtTime)  `auto-size-box`
- **Keywords:** box, background, auto size, sourcerectattime, lower third, плашка, подложка
- **Target:** Shape rectangle Size — use the exact sizePath returned by add_shape_rectangle (e.g. "Contents>Rectangle>Contents>Rectangle Path 1>Size")
- **Requires:** none

```jsx
var t = thisComp.layer("TEXT");
var r = t.sourceRectAtTime(time, false);
var pad = 20;
[r.width + pad * 2, r.height + pad * 2]
```

Replace TEXT with the text layer name. Apply to the sizePath from the add_shape_rectangle result. Also link the box position: thisComp.layer("TEXT").transform.position (offset by [r.left + r.width/2, r.top + r.height/2] for exact centering).

---

### Grid layout by layer index  `grid-by-index`
- **Keywords:** grid, layout, rows, columns, arrange, сетка, раскладка
- **Target:** Transform>Position
- **Requires:** none

```jsx
var cols = 5, spacing = 150, origin = [200, 200];
var i = index - 1;
[origin[0] + (i % cols) * spacing, origin[1] + Math.floor(i / cols) * spacing]
```

Apply to many duplicates — they arrange themselves into a grid by layer index.

---

### Random opacity flicker  `opacity-flicker`
- **Keywords:** flicker, random, opacity, neon, glitch, мерцание, неон
- **Target:** Transform>Opacity
- **Requires:** none

```jsx
seedRandom(Math.floor(time * 10), true);
random(20, 100)
```

New random opacity 10x per second. seedRandom driven by time is REQUIRED — with a constant seed the value freezes.

---

### Hard on/off blink  `blink`
- **Keywords:** blink, on off, strobe, toggle, мигание, строб
- **Target:** Transform>Opacity
- **Requires:** none

```jsx
var period = 0.5;
Math.floor(time / period) % 2 === 0 ? 100 : 0
```

Visible for `period` seconds, hidden for `period` seconds, repeating.

---

### Clamp position inside the comp  `clamp-to-comp`
- **Keywords:** clamp, bounds, limit, inside, границы, ограничить
- **Target:** Transform>Position
- **Requires:** none

```jsx
[clamp(value[0], 0, thisComp.width), clamp(value[1], 0, thisComp.height)]
```

Keeps the layer anchor inside frame regardless of keyframes/wiggle. Combine: apply after wiggle in the same expression.

---

### Stop-motion feel (posterizeTime)  `posterize-time`
- **Keywords:** stop motion, choppy, fps, posterize, frame rate, стоп-моушен
- **Target:** Any animated property
- **Requires:** none

```jsx
posterizeTime(8);
value
```

Re-samples the property at 8 fps for a hand-made look. Works on wiggle too: posterizeTime(8); wiggle(3, 30).

---

### Property driven by a Slider Control  `slider-opacity`
- **Keywords:** slider, control, rig, driver, expression control, контроллер, слайдер
- **Target:** Any 1D property (Opacity, Rotation, …)
- **Requires:** ADBE Slider Control

```jsx
effect("Slider Control")("Slider")
```

Add the Slider Control effect FIRST (add_effect "ADBE Slider Control"), then apply. Keyframe the slider instead of the property — classic rig pattern. For text: Math.round(effect("Slider Control")("Slider")).toString().

---

### Scale by distance to another layer  `scale-by-distance`
- **Keywords:** distance, proximity, scale, near, attract, дистанция, близость
- **Target:** Transform>Scale
- **Requires:** none

```jsx
var target = thisComp.layer("NULL 1");
var d = length(transform.position, target.transform.position);
var s = linear(d, 0, 500, 150, 50);
[s, s]
```

Replace NULL 1 with the controller layer. Layers grow to 150% when near it, shrink to 50% when 500px away.

---

### Constant rotation (spin forever)  `spin-forever`
- **Keywords:** spin, rotate, rotation, time, constant, endless, вращение, крутится
- **Target:** Transform>Rotation
- **Requires:** none

```jsx
time * 90
```

90 = degrees per second (360 = full turn per second; negative = counter-clockwise). Zero keyframes needed. The time * n idiom works on any property.

---

### Overshoot & settle after last keyframe (spring pop)  `overshoot-settle`
- **Keywords:** overshoot, settle, spring, pop, snappy, juicy, перелет, пружинит
- **Target:** Any keyframed property (Scale, Position, Rotation)
- **Requires:** none

```jsx
var freq = 3, decay = 5;
var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) n--;
}
if (n > 0) {
  var t = time - key(n).time;
  var v = velocityAtTime(key(n).time - 0.001);
  value + v * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t) / (freq * 2 * Math.PI);
} else {
  value;
}
```

Softer than inertial-bounce: a single smooth spring past the target that settles — the classic "juicy" UI/logo pop. Add AFTER keyframes. Tune freq (oscillations/sec) and decay (settle speed).

---

### Property reacts to music (Audio Amplitude)  `audio-reactive`
- **Keywords:** audio, music, beat, react, amplitude, sound, музыка, звук, бит
- **Target:** Transform>Scale (or any property)
- **Requires:** none

```jsx
var a = thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider");
var s = linear(a, 0, 25, 100, 130);
[s, s]
```

FIRST: right-click the audio layer > Keyframe Assistant > Convert Audio to Keyframes — that creates the "Audio Amplitude" layer this reads. Tune 25 (max expected amplitude) and 100→130 (output range). For 1D properties drop the [s, s] wrapper.

---

### Stable random value per duplicated layer  `random-per-layer`
- **Keywords:** random, seed, seedrandom, duplicate, variation, разброс, случайный
- **Target:** Any 1D property (Rotation, Opacity, …)
- **Requires:** none

```jsx
seedRandom(index, true);
random(50, 100)
```

Each duplicate gets its OWN fixed random value — stable across frames thanks to timeless=true. For 2D: seedRandom(index, true); [random(0, thisComp.width), random(0, thisComp.height)].

---

### Snap zoom in/out at layer bounds  `snap-zoom`
- **Keywords:** snap, zoom, scale in, scale out, entrance, exit, intro, вылет, появление
- **Target:** Transform>Scale
- **Requires:** none

```jsx
var snap = 300, frames = 4;
var tr = frames * thisComp.frameDuration;
var tIn = easeOut(time, inPoint, inPoint + tr, [snap, snap], [0, 0]);
var tOut = easeIn(time, outPoint, outPoint - tr, [0, 0], [snap, snap]);
value + tIn + tOut
```

Scales down from +300% at the in-point and back up at the out-point over 4 frames. Trim the layer — the transitions follow. Pairs well with auto-fade.

---

### Point rotation at another layer (2D look-at)  `look-at-layer`
- **Keywords:** look at, aim, point at, target, arrow, eyes, смотреть, цель
- **Target:** Transform>Rotation
- **Requires:** none

```jsx
var d = thisComp.layer("TARGET").transform.position - transform.position;
radiansToDegrees(Math.atan2(d[1], d[0]))
```

Replace TARGET with the layer to track. Add a constant offset (e.g. + 90) if the artwork points up instead of right. For facing own movement use rotate-to-motion.

---

### Pin 2D effect point to a 3D layer (toComp)  `effect-point-to-3d`
- **Keywords:** tocomp, 3d, effect point, lens flare, null, track, привязать, блик
- **Target:** Effect point property (e.g. Lens Flare > Center of Flare)
- **Requires:** none

```jsx
thisComp.layer("NULL 1").toComp([0, 0, 0])
```

Replace NULL 1 with the (3D) layer to follow. The 2D effect point then tracks the 3D layer through camera moves — classic lens-flare-on-a-3D-null setup.

---

### Keep size when parent scales (inverse scale)  `keep-scale-when-parented`
- **Keywords:** parent, scale, inverse, compensate, keep size, родитель, масштаб
- **Target:** Transform>Scale
- **Requires:** none

```jsx
var ps = parent.transform.scale.value;
var out = [];
for (var i = 0; i < ps.length; i++) out[i] = value[i] * 100 / ps[i];
out
```

Child keeps its on-screen size while the parent scales. The layer must HAVE a parent or the expression errors — apply after parenting.

---

### Loop keyframes accumulating (offset)  `loop-offset`
- **Keywords:** loop, offset, accumulate, walk cycle, stairs, зациклить, накопление
- **Target:** Any keyframed property
- **Requires:** none

```jsx
loopOut("offset")
```

Repeats the keyframed move ADDING the delta each cycle — walk cycles, endless steps. loopOut("continue") instead extrapolates the last velocity in a straight line. Requires 2+ keyframes.

---

### Clamp any value to a range (safe wiggle)  `clamp-range`
- **Keywords:** clamp, limit, range, min max, restrict, ограничение, диапазон
- **Target:** Any 1D property (Opacity, Slider, …)
- **Requires:** none

```jsx
clamp(wiggle(3, 40), 0, 100)
```

clamp(expr, min, max) — guard rails so wiggled/linked values stay legal (Opacity 0–100 here). Replace the wiggle with any expression or plain `value`.

---

### Pulse on every layer marker  `marker-pulse`
- **Keywords:** marker, pulse, beat, sync, music, маркер, бит, пульс
- **Target:** Transform>Scale (add to both dims) or any
- **Requires:** none

```jsx
var amp = 15, decay = 6, freq = 8;
var n = 0;
if (marker.numKeys > 0) {
  n = marker.nearestKey(time).index;
  if (marker.key(n).time > time) n--;
}
if (n > 0) {
  var t = time - marker.key(n).time;
  value + amp * Math.sin(freq * t) / Math.exp(decay * t);
} else {
  value;
}
```

Add layer markers on the beats (add_marker), the property pulses at each one. For Scale wrap: value + [p, p] where p is the pulse term.

---

### Show/hide via Checkbox Control  `checkbox-toggle`
- **Keywords:** checkbox, toggle, visibility, show, hide, switch, чекбокс, видимость, переключатель
- **Target:** Transform>Opacity
- **Requires:** ADBE Checkbox Control

```jsx
effect("Checkbox Control")("Checkbox") == 1 ? 100 : 0
```

Add the Checkbox Control effect FIRST (add_effect "ADBE Checkbox Control"). One checkbox can drive many layers — link their Opacity to a checkbox on a controller null. Core MOGRT rig pattern.

---

### Switch variants via Dropdown Menu Control  `dropdown-switch`
- **Keywords:** dropdown, menu, switch, variant, option, mogrt, выпадающий, меню, вариант
- **Target:** Any 1D property (Opacity shown)
- **Requires:** ADBE Dropdown Control

```jsx
var choice = effect("Dropdown Menu Control")("Menu").value;
choice == 1 ? 100 : choice == 2 ? 50 : 0
```

Add the effect FIRST (add_effect "ADBE Dropdown Control"). choice is 1-based. Extend the ternary chain per menu item — standard multi-variant MOGRT switch.

---

### Auto text box that tracks alignment (position part)  `auto-box-anchored`
- **Keywords:** box, background, anchor, alignment, left, right, sourcerectattime, плашка, выравнивание, подложка
- **Target:** Shape rectangle Position — the sibling of the Size path from add_shape_rectangle (e.g. "Contents>Rectangle>Contents>Rectangle Path 1>Position")
- **Requires:** none

```jsx
var t = thisComp.layer("TEXT");
var r = t.sourceRectAtTime(time, false);
[r.left + r.width / 2, r.top + r.height / 2]
```

Companion to auto-size-box: apply THIS to the rectangle Position and the size expression to Size, then set the box layer position equal to the TEXT layer position (or parent it). The box now hugs the text even with left/right paragraph alignment — fixes the classic "box drifts on left-aligned text" problem.

---

### Camera shake rig (slider-driven wiggle)  `camera-shake`
- **Keywords:** camera, shake, earthquake, handheld, impact, камера, землетрясение, дрожание
- **Target:** Transform>Position of an adjustment layer, camera or parent null
- **Requires:** ADBE Slider Control, ADBE Slider Control

```jsx
wiggle(effect("Shake Freq")("Slider"), effect("Shake Amp")("Slider"))
```

Add TWO Slider Controls first and rename them "Shake Freq" and "Shake Amp" (freq ~8, amp ~15 for handheld; freq 20+, amp 40+ for impact). On a 2D adjustment-layer rig also scale the layer to ~103% so edges never show. Keyframe the Amp slider to ramp the shake in/out.

---

### Move layer along a mask path (pointOnPath)  `attach-to-path`
- **Keywords:** path, follow, motion path, pointonpath, trajectory, путь, маске, траектория
- **Target:** Transform>Position
- **Requires:** ADBE Slider Control

```jsx
var L = thisComp.layer("PATH");
var p = L.mask("Mask 1").maskPath;
var t = effect("Progress")("Slider") / 100;
L.toComp(p.pointOnPath(clamp(t, 0, 1)))
```

Draw a mask path on a layer named PATH, add a Slider Control renamed "Progress" to THIS layer, keyframe it 0→100. To aim along the path add to Rotation: var tg = thisComp.layer("PATH").mask("Mask 1").maskPath.tangentOnPath(effect("Progress")("Slider")/100); radiansToDegrees(Math.atan2(tg[1], tg[0])).

---

### Draw-on line reveal (Trim Paths End)  `trim-paths-reveal`
- **Keywords:** trim, paths, draw on, write on, line, stroke, reveal, прорисовка, линия, обводка
- **Target:** Shape layer "Contents>Trim Paths 1>End" (add the Trim Paths operator to the shape group first)
- **Requires:** none

```jsx
linear(time, inPoint, inPoint + 1, 0, 100)
```

Trim Paths is a shape operator, not an effect — it must exist on the shape layer before applying (Add > Trim Paths in the shape contents). Draws the stroke on over 1s from the layer in-point; retiming the layer retimes the reveal. Reverse (0←100 swap) for erase-off.

---

### Freeze frame via Time Remap + slider  `freeze-frame`
- **Keywords:** freeze, frame, hold, still, time remap, стоп-кадр, заморозить, пауза
- **Target:** Time Remap (enable Layer > Time > Enable Time Remapping first)
- **Requires:** ADBE Slider Control

```jsx
framesToTime(Math.round(effect("Freeze Frame")("Slider")))
```

Enable Time Remapping on the footage layer FIRST, add a Slider Control renamed "Freeze Frame", then apply to the Time Remap property. The slider picks the source frame to hold — keyframe it for play/freeze/play sequences.

---

### Loop footage seamlessly (Time Remap)  `time-remap-loop`
- **Keywords:** loop, footage, video, seamless, time remap, зациклить, видео, футаж
- **Target:** Time Remap (enable Layer > Time > Enable Time Remapping first)
- **Requires:** none

```jsx
(time - inPoint) % (source.duration - thisComp.frameDuration)
```

Enable Time Remapping FIRST, then apply and extend the layer out-point as far as needed. Subtracting one frame duration skips the blank last time-remap frame — the classic loop bug fix.

---

### Timecode burn-in HH:MM:SS:FF  `timecode`
- **Keywords:** timecode, clock, burn in, frames, counter, таймкод, время, часы
- **Target:** Text>Source Text
- **Requires:** none

```jsx
var fps = 1 / thisComp.frameDuration;
var t = Math.max(0, time);
var h = Math.floor(t / 3600);
var m = Math.floor((t % 3600) / 60);
var s = Math.floor(t % 60);
var f = Math.floor((t % 1) * fps + 0.0001);
function p2 (n) { return (n < 10 ? "0" : "") + n }
p2(h) + ":" + p2(m) + ":" + p2(s) + ":" + p2(f)
```

Live comp timecode on a text layer — dailies/burn-in staple. Use (time - inPoint) instead of time to count from the layer start.

---

### Camera auto-focus on a layer (Focus Distance)  `autofocus-dof`
- **Keywords:** focus, dof, depth, field, camera, rack focus, автофокус, фокус, резкость
- **Target:** Camera Options>Focus Distance (on the camera layer)
- **Requires:** none

```jsx
var t = thisComp.layer("TARGET");
length(toWorld(anchorPoint), t.toWorld(t.anchorPoint))
```

Replace TARGET with the layer to keep sharp. Enable Depth of Field on the camera. Swap TARGET over time (or use a null) for automatic rack-focus.

---

### Pin layer to comp edge/corner (responsive)  `pin-to-edge`
- **Keywords:** pin, edge, corner, responsive, margin, угол, край, отступ
- **Target:** Transform>Position
- **Requires:** none

```jsx
var margin = 50;
[thisComp.width - margin, thisComp.height - margin]
```

Pins to the bottom-right corner with a 50px margin — survives comp resizes (9:16 adaptations). Variants: top-left [margin, margin]; bottom-center [thisComp.width/2, thisComp.height - margin]. Mind the anchor point.

---

### Shrink text to fit a max width  `auto-fit-text`
- **Keywords:** fit, shrink, width, auto scale, text, ужать, ширина, вместить
- **Target:** Transform>Scale (of the text layer)
- **Requires:** none

```jsx
var maxW = 800;
var w = sourceRectAtTime(time, false).width;
var s = w > 0 ? Math.min(100, maxW / w * 100) : 100;
[s, s]
```

Long strings scale down to stay within maxW pixels; short ones stay at 100%. Essential for data-driven/localized text. Set maxW to the safe width of your template.

---

### Constant stroke width while layer scales  `keep-stroke-width`
- **Keywords:** stroke, width, constant, compensate, outline, толщина, обводка, масштаб
- **Target:** Shape layer stroke width (e.g. "Contents>Shape 1>Contents>Stroke 1>Stroke Width")
- **Requires:** none

```jsx
value * 100 / transform.scale[0]
```

The stroke keeps its on-screen thickness while the layer scale animates (zooms, pops). Assumes uniform scale — for non-uniform use the axis that matters.

---

### Heartbeat / BPM pulse  `heartbeat-pulse`
- **Keywords:** heartbeat, pulse, bpm, throb, beat, пульс, сердце, сердцебиение
- **Target:** Transform>Scale
- **Requires:** none

```jsx
var bpm = 60, amp = 8;
var p = Math.pow(Math.sin(time * bpm * Math.PI / 60), 8) * amp;
value + [p, p]
```

Sharp organic pulse at bpm beats per minute (pow-of-sin narrows the spike). amp = size of the pulse in scale %. Great for hearts, likes, notification badges; no keyframes needed.

---

### Text reveal word by word  `word-by-word-reveal`
- **Keywords:** word, words, reveal, text, subtitles, слово, словам, субтитры
- **Target:** Text>Source Text
- **Requires:** none

```jsx
var words = text.sourceText.split(" ");
var dur = 2.0;
var n = Math.floor(linear(time - inPoint, 0, dur, 0, words.length));
words.slice(0, n).join(" ")
```

Reveals the layer's own text one word at a time over dur seconds from the in-point — kinetic-subtitle staple. Sister of the typewriter snippet (per-letter).
