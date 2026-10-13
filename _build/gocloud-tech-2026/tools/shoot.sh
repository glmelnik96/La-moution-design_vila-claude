#!/bin/sh
# shoot.sh — stills of the deck with html/render/render.js (run from the repo root).
#   sh _build/gocloud-tech-2026/tools/shoot.sh rest [slides...]          rest frame of each slide → out/gct/rest/sNN.png
#   sh _build/gocloud-tech-2026/tools/shoot.sh beats N t1,t2,...          stills of slide N → out/gct/bN/
#   sh _build/gocloud-tech-2026/tools/shoot.sh sheet N                    auto beat sheet of slide N → out/gct/bN/sheet.png
PAGE=_build/gocloud-tech-2026/index.html
mode=$1; shift
case "$mode" in
  rest)
    list=${*:-"1 2 3 4 5 6 7"}
    mkdir -p out/gct/rest
    for i in $list; do
      node html/render/render.js "$PAGE?render&slide=$i" --out out/gct/rest --w 2304 --h 1280 --beats 99 --to 99 --quiet >/dev/null &&
        mv out/gct/rest/beat_099000.png out/gct/rest/s0$i.png || echo "slide $i failed"
    done ;;
  beats)
    n=$1; t=$2
    node html/render/render.js "$PAGE?render&slide=$n" --out out/gct/b$n --w 2304 --h 1280 --beats "$t" --to 99 --scale ${3:-0.5} --quiet ;;
  sheet)
    n=$1
    node html/render/render.js "$PAGE?render&slide=$n" --out out/gct/b$n --w 2304 --h 1280 --beats ${2:-all} --scale 0.5 --sheet out/gct/b$n/sheet.png --quiet ;;
esac
