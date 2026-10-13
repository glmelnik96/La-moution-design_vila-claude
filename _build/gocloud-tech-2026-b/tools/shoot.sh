#!/bin/sh
# shoot.sh — stills of the deck with html/render/render.js (run from the repo root).
#   sh _build/gocloud-tech-2026-b/tools/shoot.sh rest [slides...]        rest frame of each slide → out/gctb/rest/sNN.png
#   sh _build/gocloud-tech-2026-b/tools/shoot.sh beats N t1,t2,... [scale] [query]   stills of slide N → out/gctb/bN/
#   sh _build/gocloud-tech-2026-b/tools/shoot.sh sheet N [beats] [query]           beat sheet of slide N → out/gctb/bN/sheet.png
# query: extra URL parameters, e.g. "&fresh" (full build instead of the carry-over) or "&order=s4,s5,s6,s7,s8"
PAGE=_build/gocloud-tech-2026-b/index.html
mode=$1; shift
case "$mode" in
  rest)
    list=${*:-"1 2 3 4 5 6 7 8"}
    mkdir -p out/gctb/rest
    for i in $list; do
      node html/render/render.js "$PAGE?render&slide=$i" --out out/gctb/rest --w 2304 --h 1280 --beats 99 --to 99 --quiet >/dev/null &&
        mv out/gctb/rest/beat_099000.png out/gctb/rest/s0$i.png || echo "slide $i failed"
    done ;;
  beats)
    n=$1; t=$2
    node html/render/render.js "$PAGE?render&slide=$n$4" --out out/gctb/b$n --w 2304 --h 1280 --beats "$t" --to 99 --scale ${3:-0.5} --quiet ;;
  sheet)
    n=$1
    node html/render/render.js "$PAGE?render&slide=$n$3" --out out/gctb/b$n --w 2304 --h 1280 --beats ${2:-all} --scale 0.5 --sheet out/gctb/b$n/sheet.png --quiet ;;
esac
