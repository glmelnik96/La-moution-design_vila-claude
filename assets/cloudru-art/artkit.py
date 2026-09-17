# -*- coding: utf-8 -*-
r"""Cloud.ru art kit: the deck's backgrounds and glow panels rebuilt as live AE layers.

WHAT THE ARTWORK ACTUALLY IS (read out of the Figma file, not guessed from crops)
  Every artwork slide is the same two objects placed differently:
    planet   one bitmap (Figma image a28afec3, 4001x4096 @2x) - a segmented purple ring with
             an orange rim - shown through a rectangle 2-3x its size, rotated on s01, cropped
             on s15. The visible "arc" of s01/s09/s11/s15 is a piece of this ring.
    orbits   one vector "flower" of 18 elliptical loops (a denser 157-loop variant on s11),
             1.14 px white at 47 %, rotated -116.7 deg. Seen near its centre (s02, s13) the
             loops read as rays; seen from the side (s01, s09) as orbit lines.
  and every gradient panel/card is one radial gradient: an ellipse 0.9235x the box, purple
  #7459F9 from alpha 0 at 51.9 % of the radius to 0.7 at 95.2 % (s18's variant starts from an
  opaque near-black centre).

HOW IT MOVES (all motion passes through the Figma pose exactly at the slide's rest time)
  planet   turns about the ring's own centre (the arc glides along itself, the orange
           segment travels), a mild push during the dissolves; blur + opacity dissolves at cuts
  orbits   draw on with Trim Paths from the flower's centre outward (rays shoot out on s02/s13),
           counter-rotate slowly about that centre
  glow     a normalized gradient field under a rounded-rect alpha matte: on entrance the rim
           blooms inward (field 1.35x -> 1x) while the outline draws on; then the field breathes
           (+-3 %) and its centre wanders (+-16 px) on sine expressions with zero phase at the
           rest time; a panel that continues on the next slide morphs (matte + field) into its
           new box.

USAGE (from deck.py)
  ART[sid]              planet / orbit node data for the six artwork slides
  HEAD_ART              JSX: planet(), orbits(), glowPanel(), glowIn(), glowOut(), glowTravel()
  art_js(sid, ...)      JSX lines that build a slide's background layers in the master comp
  render_fields()       writes assets/gen/glow_purple.png + glow_dark.png (+ mirror)
  Assets for reuse: assets/src/s01_img_raw1.png (planet), assets/src/s01_vec.svg (orbit-18 at
  4042 px), s09_vec.svg (orbit-18 at 5784 px), s11_vec.svg (orbit-157).
"""
from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SRC = ASSETS / "src"
GEN = ASSETS / "gen"
AE_ROOT = Path("C:/dev/gct-pres")
PLANET_PNG = SRC / "s01_img_raw1.png"          # the shared bitmap (identical in all four exports)
SVG_INSET = 0.57                                # the SVG export is the node box + half the stroke

# Figma nodes, as read with the plugin API (x, y = origin of the un-rotated box, rotation in
# Figma degrees, CROP image transform: [[sx, 0, u0], [0, sy, v0]] in normalized image space).
ART = {
    "s01": dict(planet=dict(x=625.28, y=-2728, w=7968.02, h=8152.35, rot=-37.824, tr=[[1.0001, 0, -0.0001], [0, 0.9995, 0.0005]]),
                orbit=dict(x=3758.55, y=1223.03, w=4040.88, h=3699.89, rot=-116.745, svg="s01_vec.svg", sw=1.1395),
                w_planet=0.9, w_orbit=-0.35),
    "s02": dict(planet=None,
                orbit=dict(x=4962.44, y=-1137.32, w=5782.56, h=5294.6, rot=-116.745, svg="s09_vec.svg", sw=1.1395),
                w_planet=0, w_orbit=0.5),
    "s09": dict(planet=dict(x=-3886, y=-2607, w=9146.08, h=9358.2, rot=0, tr=[[1.0001, 0, -0.0001], [0, 0.9995, 0.0005]]),
                orbit=dict(x=4611.44, y=1632.68, w=5782.56, h=5294.6, rot=-116.745, svg="s09_vec.svg", sw=1.1395),
                w_planet=-0.8, w_orbit=0.3),
    "s11": dict(planet=dict(x=-2799, y=-6882, w=9146.08, h=9358.2, rot=0, tr=[[1.0001, 0, -0.0001], [0, 0.9995, 0.0005]]),
                orbit=dict(x=1381.57, y=1731.8, w=6125.05, h=5380.9, rot=50.886, svg="s11_vec.svg", sw=1.7142),
                w_planet=0.8, w_orbit=-0.3),
    "s13": dict(planet=None,
                orbit=dict(x=4962.44, y=-1137.32, w=5782.56, h=5294.6, rot=-116.745, svg="s09_vec.svg", sw=1.1395),
                w_planet=0, w_orbit=-0.5),
    "s15": dict(planet=dict(x=-687, y=-531, w=3264, h=2335, rot=0, tr=[[0.3569, 0, 0.3733], [0, 0.2494, 0.7144]]),
                orbit=None, w_planet=-0.7, w_orbit=0),
}

# glow field: radius 1 = R0 px in a FIELD px square; the ellipse of a w x h box has radii
# 0.9235 w / 0.9235 h, so the layer scale is 0.9235 * w / R0 * 100 (%).
FIELD, R0 = 2000, 666.67
GLOW_K = 0.9235
STOP_IN, STOP_OUT = 0.519239, 0.951943
PURPLE = (116, 89, 249)
WARM_BLACK = (10, 6, 0)


# ---------------------------------------------------------------- geometry
def rot_mat(deg):
    """Figma's rotation matrix in screen space (verified against its own render: 0.4/255)."""
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return np.array([[c, s], [-s, c]])


_ring_centre = None


def ring_centre():
    """Centre of the planet ring, from a circle fit to the inner edge of the bitmap's alpha."""
    global _ring_centre
    if _ring_centre is None:
        a = np.asarray(Image.open(PLANET_PNG).convert("RGBA"))[:, :, 3]
        h, w = a.shape
        gx, gy = w / 2, h / 2
        pts = []
        for ang in np.linspace(0, 2 * math.pi, 180, endpoint=False):
            dx, dy = math.cos(ang), math.sin(ang)
            for r in range(10, int(min(w, h) / 2), 2):
                x, y = int(gx + r * dx), int(gy + r * dy)
                if 0 <= x < w and 0 <= y < h and a[y, x] > 30:
                    pts.append((x, y)); break
        P = np.array(pts, float)
        A = np.c_[2 * P, np.ones(len(P))]
        b = (P ** 2).sum(axis=1)
        cx, cy, c0 = np.linalg.lstsq(A, b, rcond=None)[0]
        _ring_centre = (float(cx), float(cy), float(math.sqrt(c0 + cx * cx + cy * cy)))
    return _ring_centre


def planet_affine(n):
    """image px -> frame px for the bitmap under Figma node n: frame = A . img + b.

    Figma maps node-normalized coords through the CROP transform M (2x3) into image-normalized
    coords, so img = diag(BW, BH) . (M_lin . node/(W, H) + t); inverted and composed with the
    node's rotation about its origin (rot_mat) this gives the layer's similarity transform.
    Checked against the s01/p01/h01/b01 renders: mean |diff| <= 1.5/255 over the artwork."""
    im = Image.open(PLANET_PNG)
    BW, BH = im.size
    M = np.array([[n["tr"][0][0], n["tr"][0][1]], [n["tr"][1][0], n["tr"][1][1]]], float)
    t = np.array([n["tr"][0][2], n["tr"][1][2]], float)
    R = rot_mat(n["rot"])
    D = np.diag([n["w"], n["h"]])
    Mi = np.linalg.inv(M)
    A = R @ D @ Mi @ np.diag([1 / BW, 1 / BH])
    b = np.array([n["x"], n["y"]]) - R @ D @ Mi @ t
    return A, b


def planet_pose(n):
    """AE layer transform for the planet bitmap under Figma node n (anchor = ring centre)."""
    A, b = planet_affine(n)
    k = float(np.linalg.norm(A[:, 0]))                # uniform scale (columns agree to 1e-4)
    rot = math.degrees(math.atan2(A[1][0], A[0][0]))  # screen-space angle = AE rotation
    uc, vc, rr = ring_centre()
    p = A @ np.array([uc, vc]) + b
    return dict(ax=uc, ay=vc, px=float(p[0]), py=float(p[1]), sc=100 * k, rot=rot, ring_r=rr * k)


def svg_paths(fn):
    """Sub-paths of a Figma SVG export as AE Shape data in node-local px (tangents relative).

    Absolute M / L / H / V / C / Z with implicit repeats, which is what Figma writes for both the
    orbit flowers (cubics) and the line icons (H/V runs). Closed sub-paths carry c=True."""
    src = Path(fn).read_text(encoding="utf-8") if Path(fn).is_absolute() else (SRC / fn).read_text(encoding="utf-8")
    d = " ".join(re.findall(r'\sd="([^"]+)"', src))
    toks = re.findall(r"[MLHVCZmlhvcz]|-?[\d.]+(?:e-?\d+)?", d)
    paths = []
    verts, tin, tout, closed = [], [], [], False
    cur = (0.0, 0.0)
    cmd = None

    def flush():
        if len(verts) >= 2 or (verts and closed):
            paths.append(dict(v=[[round(x - SVG_INSET, 2), round(y - SVG_INSET, 2)] for x, y in verts],
                              i=[[round(x, 2), round(y, 2)] for x, y in tin],
                              o=[[round(x, 2), round(y, 2)] for x, y in tout], c=closed))

    i = 0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t.upper()
            i += 1
            if cmd == "Z":
                closed = True
                flush()
                verts, tin, tout, closed = [], [], [], False
                cmd = None
            continue
        if cmd is None:
            i += 1
            continue
        if cmd == "M":
            flush()
            cur = (float(toks[i]), float(toks[i + 1]))
            verts, tin, tout, closed = [cur], [(0, 0)], [(0, 0)], False
            i += 2
            cmd = "L"                                   # implicit repeats after M are linetos
        elif cmd == "L":
            pt = (float(toks[i]), float(toks[i + 1]))
            verts.append(pt); tin.append((0, 0)); tout.append((0, 0)); cur = pt
            i += 2
        elif cmd == "H":
            pt = (float(toks[i]), cur[1])
            verts.append(pt); tin.append((0, 0)); tout.append((0, 0)); cur = pt
            i += 1
        elif cmd == "V":
            pt = (cur[0], float(toks[i]))
            verts.append(pt); tin.append((0, 0)); tout.append((0, 0)); cur = pt
            i += 1
        elif cmd == "C":
            c1 = (float(toks[i]), float(toks[i + 1])); c2 = (float(toks[i + 2]), float(toks[i + 3])); p3 = (float(toks[i + 4]), float(toks[i + 5]))
            tout[-1] = (c1[0] - cur[0], c1[1] - cur[1])
            verts.append(p3); tin.append((c2[0] - p3[0], c2[1] - p3[1])); tout.append((0, 0))
            cur = p3
            i += 6
        else:
            i += 1
    flush()
    return paths


def orbit_pose(n):
    paths = svg_paths(n["svg"])
    starts = np.array([p["v"][0] for p in paths])
    cx, cy = starts.mean(axis=0)                    # where the loops converge: the rays' origin
    R = rot_mat(n["rot"])
    F = np.diag([1, -1]) if n.get("flip") else np.eye(2)   # a mirrored node: Figma flips, then rotates
    p = R @ F @ np.array([cx, cy]) + np.array([n["x"], n["y"]])
    return dict(ax=float(cx), ay=float(cy), px=float(p[0]), py=float(p[1]), rot=-n["rot"], sw=n["sw"],
                sy=-100 if n.get("flip") else 100), paths


def _ridge(sid):
    """Thin bright lines of the render (the rings) as a clipped high-pass map."""
    from PIL import ImageFilter
    im = Image.open(ASSETS / f"{sid}_full.png").convert("L")
    r = np.asarray(im).astype(float) - np.asarray(im.filter(ImageFilter.GaussianBlur(4))).astype(float)
    return np.clip(r, 0, 40)


def _samples(paths, per=200):
    pts = []
    for pth in paths:
        v, i, o = pth["v"], pth["i"], pth["o"]
        for k in range(len(v) - 1):
            p0 = np.array(v[k]) + SVG_INSET; p3 = np.array(v[k + 1]) + SVG_INSET
            p1 = p0 + np.array(o[k]); p2 = p3 + np.array(i[k + 1])
            t = np.linspace(0, 1, per)[:, None]
            pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3)
    return np.concatenate(pts)


def refine_pose(sid, pose, paths):
    """Fit the layer pose to the render: the mirrored node's dump geometry places its rings ~10 px off
    (the reported box does not match w/h under any rotation), so search shift, rotation and scale about
    the anchor for the best overlap of the paths with the render's ridge map. Same transform as the layer:
    world = R_ae(rot) . diag(sx, sy) . (q - anchor) + pos."""
    ridge = _ridge(sid)
    P = _samples(paths) - np.array([pose["ax"], pose["ay"]])
    sy = pose.get("sy", 100) / 100.0
    r0 = math.radians(pose["rot"])
    M0 = np.array([[math.cos(r0), -math.sin(r0)], [math.sin(r0), math.cos(r0)]]) @ np.diag([1, sy])
    Q0 = (M0 @ P.T).T + np.array([pose["px"], pose["py"]])
    near = (Q0[:, 0] > -200) & (Q0[:, 0] < 2120) & (Q0[:, 1] > -200) & (Q0[:, 1] < 1280)
    P = P[near]                                        # only the part of the drawing that can reach the frame
    if len(P) > 8000:
        P = P[np.random.default_rng(0).choice(len(P), 8000, replace=False)]

    def score(dx, dy, dth, sc):
        r = math.radians(pose["rot"] + dth)
        c, s_ = math.cos(r), math.sin(r)
        M = np.array([[c, -s_], [s_, c]]) @ np.diag([sc, sy * sc])
        Q = (M @ P.T).T + np.array([pose["px"] + dx, pose["py"] + dy])
        ins = (Q[:, 0] >= 0) & (Q[:, 0] < 1920) & (Q[:, 1] >= 0) & (Q[:, 1] < 1080)
        if ins.sum() < 300:
            return -1.0
        q = Q[ins].astype(int)
        return float(ridge[q[:, 1], q[:, 0]].mean())

    base = score(0, 0, 0, 1)
    best = (base, (0, 0, 0.0, 1.0))
    for dth in np.arange(-0.6, 0.61, 0.15):
        for sc in np.arange(0.9925, 1.00751, 0.0025):
            for dx in range(-16, 17, 4):
                for dy in range(-16, 17, 4):
                    v = score(dx, dy, dth, sc)
                    if v > best[0]:
                        best = (v, (dx, dy, float(dth), float(sc)))
    bx, by, bth, bsc = best[1]
    for dth in np.arange(bth - 0.1, bth + 0.101, 0.05):
        for sc in np.arange(bsc - 0.002, bsc + 0.00201, 0.001):
            for dx in range(bx - 3, bx + 4):
                for dy in range(by - 3, by + 4):
                    v = score(dx, dy, dth, sc)
                    if v > best[0]:
                        best = (v, (dx, dy, float(dth), float(sc)))
    dx, dy, dth, sc = best[1]
    print("  refine %s orbit: ridge %.1f -> %.1f  shift (%d, %d) rot %+.2f scale %.4f" % (sid, base, best[0], dx, dy, dth, sc))
    out = dict(pose)
    out["px"] += dx; out["py"] += dy; out["rot"] += dth
    out["sx"] = 100 * sc; out["sy"] = sy * 100 * sc
    return out


# ---------------------------------------------------------------- glow fields
def render_fields():
    ys, xs = np.mgrid[0:FIELD, 0:FIELD]
    r = np.sqrt((xs + 0.5 - FIELD / 2) ** 2 + (ys + 0.5 - FIELD / 2) ** 2) / R0
    t = np.clip((r - STOP_IN) / (STOP_OUT - STOP_IN), 0, 1)
    GEN.mkdir(exist_ok=True)
    purple = np.zeros((FIELD, FIELD, 4), np.uint8)
    purple[:, :, :3] = PURPLE
    purple[:, :, 3] = np.round(255 * 0.7 * t).astype(np.uint8)
    Image.fromarray(purple, "RGBA").save(GEN / "glow_purple.png")
    dark = np.zeros((FIELD, FIELD, 4), float)
    for ch in range(3):
        dark[:, :, ch] = WARM_BLACK[ch] + (PURPLE[ch] - WARM_BLACK[ch]) * t
    dark[:, :, 3] = 255 * (1 - 0.3 * t)
    Image.fromarray(np.round(dark).astype(np.uint8), "RGBA").save(GEN / "glow_dark.png")
    dst = AE_ROOT / "gen"; dst.mkdir(parents=True, exist_ok=True)
    for f in ("glow_purple.png", "glow_dark.png"):
        shutil.copy2(GEN / f, dst / f)
    (AE_ROOT / "src").mkdir(parents=True, exist_ok=True)
    shutil.copy2(PLANET_PNG, AE_ROOT / "src" / "planet.png")


def field_scale(w, h):
    return 100 * GLOW_K * w / R0, 100 * GLOW_K * h / R0


# ---------------------------------------------------------------- JSX
HEAD_ART = r"""
// ---- art kit: planet / orbits / glow panels (tools/artkit.py) ----
function lin(p, t0, v0, t1, v1) { p.setValueAtTime(t0, v0); p.setValueAtTime(t1, v1); }
// the shared ring bitmap; omega = deg/s (AE sense, clockwise), pose exact at vt
function planet(m, name, path, pose, tIn, tOut, first, TX, omega, vt) {
  var l = m.layers.add(foot(path));
  l.name = name;
  P(l).property("ADBE Anchor Point").setValue([pose.ax, pose.ay]);
  pos(l).setValue([pose.px, pose.py]);
  var a = first ? tIn : tIn - TX, b = tOut + TX, lead = first ? 0.9 : 2 * TX;
  l.inPoint = a; l.outPoint = b;
  var s0 = pose.sc;
  lin(P(l).property("ADBE Rotate Z"), a, pose.rot + omega * (a - vt), b, pose.rot + omega * (b - vt));
  keys(scl(l), [[a, [s0 * 0.97, s0 * 0.97]], [a + lead, [s0, s0]], [tOut - TX, [s0, s0]], [b, [s0 * 1.04, s0 * 1.04]]]);
  scl(l).expression = "var k = 1 + 0.025 * (time - " + vt + ") / " + (b - a) + "; [value[0] * k, value[1] * k]";   // slow push, exact at vt
  keys(opa(l), [[a, 0], [a + lead, 100], [tOut - TX, 100], [b, 0]]);
  var fx = l.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
  try { fx.property("ADBE Gaussian Blur 2-0003").setValue(true); } catch (e0) {}
  var bl = 24 * 100 / s0;                            // layer-space radius, same look at any scale
  keys(fx.property("ADBE Gaussian Blur 2-0001"), [[a, first ? bl * 0.75 : bl], [a + lead, 0], [tOut - TX, 0], [b, bl * 1.15]]);
  return l;
}
// the loop flower as a native shape layer: draws on from its centre, turns about it
function orbits(m, name, paths, pose, tIn, tOut, first, TX, omega, vt, drawAt, drawDur) {
  var S = m.layers.addShape();
  S.name = name;
  P(S).property("ADBE Anchor Point").setValue([pose.ax, pose.ay]);
  pos(S).setValue([pose.px, pose.py]);
  scl(S).setValue([pose.sx === undefined ? 100 : pose.sx, pose.sy === undefined ? 100 : pose.sy]);   // sy -100: mirrored in Figma
  var a = first ? tIn : tIn - TX, b = tOut + TX, lead = first ? 0.9 : 2 * TX;
  S.inPoint = a; S.outPoint = b;
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "orbits";
  for (var i = 0; i < paths.length; i++) {
    var gg = groupNamed(S, "orbits");
    var pth = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
    var sh = new Shape();
    sh.vertices = paths[i].v; sh.inTangents = paths[i].i; sh.outTangents = paths[i].o; sh.closed = false;
    pth.property("ADBE Vector Shape").setValue(sh);
  }
  var g2 = groupNamed(S, "orbits");
  var sk = g2.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
  sk.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
  sk.property("ADBE Vector Stroke Width").setValue(pose.sw);
  sk.property("ADBE Vector Stroke Opacity").setValue(47);
  var g3 = groupNamed(S, "orbits");
  var trim = g3.property("ADBE Vectors Group").addProperty("ADBE Vector Filter - Trim");
  try { trim.property("ADBE Vector Trim Type").setValue(1); } catch (e1) {}
  tw(trim.property("ADBE Vector Trim End"), drawAt * 1000, (drawAt + drawDur) * 1000, 0, 100, "in");
  lin(P(S).property("ADBE Rotate Z"), a, pose.rot + omega * (a - vt), b, pose.rot + omega * (b - vt));
  scl(S).expression = "var k = 1 + 0.04 * (time - " + vt + ") / " + (b - a) + "; [value[0] * k, value[1] * k]";      // the rays breathe out, exact at vt
  keys(opa(S), [[a, 0], [a + lead, 100], [tOut - TX, 100], [b, 0]]);
  var fx = S.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
  try { fx.property("ADBE Gaussian Blur 2-0003").setValue(true); } catch (e0) {}
  keys(fx.property("ADBE Gaussian Blur 2-0001"), [[a, first ? 12 : 16], [a + lead, 0], [tOut - TX, 0], [b, 18]]);
  return S;
}
// glow panel = matte (rounded rect) + field (normalized gradient bitmap) + outline
function glowPanel(c, name, x, y, w, h, r, dark, sw, scol, sop, T0, center) {
  var fld = png(c, name + "_g", dark ? GLOW_DARK : GLOW_PURPLE, 0, 0, 100);
  P(fld).property("ADBE Anchor Point").setValue([1000, 1000]);
  pos(fld).setValue([x + w / 2, y + h / 2]);
  scl(fld).setValue([GLOW_S * w, GLOW_S * h]);
  var mt = rrect(c, name + "_m", x, y, w, h, r, [1, 1, 1], null, 0);
  try { fld.setTrackMatte(mt, TrackMatteType.ALPHA); } catch (e0) { fld.trackMatteType = TrackMatteType.ALPHA; }
  var st = rrect(c, name, x, y, w, h, r, null, scol, sw, center);
  if (sop < 100) groupNamed(st, "frame").property("ADBE Vectors Group").property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Opacity").setValue(sop);
  // life: breathing + wandering centre, zero at the rest time T0 so the Figma pose holds there
  scl(fld).expression = "var k = 1 + 0.03 * Math.sin((time - " + T0 + ") * 2 * Math.PI / 6.5); [value[0] * k, value[1] * k]";
  pos(fld).expression = "value + [16 * Math.sin((time - " + T0 + ") * 0.75), 10 * Math.sin((time - " + T0 + ") * 1.15)]";
  return { f: fld, m: mt, s: st, w: w, h: h, ins: center ? 0 : sw / 2 };
}
function glowIn(G, ms0, dur) {
  var s = [GLOW_S * G.w, GLOW_S * G.h];
  tw(scl(G.f), ms0, ms0 + dur, [s[0] * 1.35, s[1] * 1.35], s, "in");   // the rim blooms inward
  tw(opa(G.f), ms0, ms0 + dur * 0.5, 0, 100, "in");
  drawOn(G.s, ms0, dur);
  G.f.inPoint = f(ms0 - 40 > 0 ? ms0 - 40 : 0); G.m.inPoint = G.f.inPoint; G.s.inPoint = G.f.inPoint;
}
function glowOut(G, ms0, dur) {
  tw(opa(G.f), ms0, ms0 + dur, 100, 0, "out");
  tw(opa(G.s), ms0, ms0 + dur, 100, 0, "out");
}
// continue into the next slide's box: matte + outline morph, the field re-fits the ellipse
function glowTravel(G, ms0, ms1, a, b) {
  morph(G.m, ms0, ms1, a, b, 0);
  morph(G.s, ms0, ms1, a, b, G.ins);
  var sc = scl(G.f), ps = pos(G.f);
  sc.setValueAtTime(f(ms0), [GLOW_S * a[2], GLOW_S * a[3]]);
  sc.setValueAtTime(f(ms1), [GLOW_S * b[2], GLOW_S * b[3]]);
  ps.setValueAtTime(f(ms0), [a[0] + a[2] / 2, a[1] + a[3] / 2]);
  ps.setValueAtTime(f(ms1), [b[0] + b[2] / 2, b[1] + b[3] / 2]);
  ease(sc, 60, 60); ease(ps, 60, 60);
}
"""


def head_consts():
    return ('var GLOW_PURPLE = %s, GLOW_DARK = %s, PLANET = %s, GLOW_S = %.6f;'
            % (json.dumps((AE_ROOT / "gen" / "glow_purple.png").as_posix()),
               json.dumps((AE_ROOT / "gen" / "glow_dark.png").as_posix()),
               json.dumps((AE_ROOT / "src" / "planet.png").as_posix()), 100 * GLOW_K / R0))


def art_js(sid, t_in, t_out, first, TX, vt):
    """Background layers of one artwork slide in the master comp (planet below orbits)."""
    a = ART[sid]
    o = []
    if a["planet"]:
        pose = planet_pose(a["planet"])
        o.append('planet(m, %s, PLANET, %s, %.4f, %.4f, %s, %.3f, %.3f, %.4f);'
                 % (json.dumps("PLANET " + sid), json.dumps(pose), t_in, t_out, "true" if first else "false", TX, a["w_planet"], vt))
    if a["orbit"]:
        pose, paths = orbit_pose(a["orbit"])
        if a["orbit"].get("flip"):
            pose = refine_pose(sid, pose, paths)
        draw_at = t_in + 0.3 if first else t_in - TX + 0.2
        o.append('orbits(m, %s, %s, %s, %.4f, %.4f, %s, %.3f, %.3f, %.4f, %.4f, %.2f);'
                 % (json.dumps("ORBITS " + sid), json.dumps(paths, separators=(",", ":")), json.dumps(pose), t_in, t_out,
                    "true" if first else "false", TX, a["w_orbit"], vt, draw_at, 2.2))
    return o


if __name__ == "__main__":
    render_fields()
    print("ring centre / radius (bitmap px):", tuple(round(v, 1) for v in ring_centre()))
    for sid, a in ART.items():
        if a["planet"]:
            p = planet_pose(a["planet"])
            print("%s planet: anchor (%.0f,%.0f) pos (%.0f,%.0f) scale %.2f%% rot %.2f  ring r %.0f px"
                  % (sid, p["ax"], p["ay"], p["px"], p["py"], p["sc"], p["rot"], p["ring_r"]))
        if a["orbit"]:
            p, paths = orbit_pose(a["orbit"])
            if a["orbit"].get("flip"):
                p = refine_pose(sid, p, paths)
            print("%s orbits: %d loops, %d verts, centre (%.0f,%.0f) -> pos (%.0f,%.0f) rot %.2f"
                  % (sid, len(paths), sum(len(q["v"]) for q in paths), p["ax"], p["ay"], p["px"], p["py"], p["rot"]))
