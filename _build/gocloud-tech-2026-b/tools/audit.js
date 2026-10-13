// audit.js — layout audit of the deck's rest frames (run in the page via tools/evalpage.js):
//  · every text line, plate and QR sits inside a card (an ancestor with a fill) → a card's wipe clips its content;
//  · at rest no line or plate pokes out of its card (a layout error the clip would hide);
//  · cards of one slide do not overlap (gaps ≥ 0), the logo box overlaps no card.
// node _build/gocloud-tech-2026-b/tools/evalpage.js "_build/gocloud-tech-2026-b/index.html?slide=N&t=end" "window.__deck" "$(cat _build/gocloud-tech-2026-b/tools/audit.js)"
(function () {
  const sec = document.querySelector('section.on');
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const filled = (e) => { const c = getComputedStyle(e).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
  function card(e) { for (let p = e.parentElement; p && p !== sec; p = p.parentElement) if (filled(p) && !p.classList.contains('chip')) return p; return null; }
  const out = { slide: sec.dataset.key, orphans: [], poking: [], overlaps: [], items: 0 };
  const seen = (e) => { for (let p = e; p && p !== sec; p = p.parentElement) if (+getComputedStyle(p).opacity === 0) return false; return true; };
  const items = [...sec.querySelectorAll('.lt, .lt > span.a, .chip, svg.a')].filter((e) => e.getBoundingClientRect().width > 0 && seen(e));
  items.forEach(function (e) {
    out.items++;
    const c = card(e);
    const name = (e.textContent || e.tagName).trim().slice(0, 28);
    if (!c) { out.orphans.push(name); return; }
    // text: the glyph run (the inline box), not the line box; tolerance 0.5 px
    let r = R(e);
    if (e.classList.contains('lt') || e.tagName === 'SPAN') {
      const rg = document.createRange(); rg.selectNodeContents(e);
      const rr = rg.getBoundingClientRect(); r = { l: rr.left, t: r.t, r: rr.right, b: r.b };
    }
    const k = R(c);
    if (r.l < k.l - 0.5 || r.r > k.r + 0.5 || r.t < k.t - 0.5 || r.b > k.b + 0.5)
      out.poking.push([name, Math.round(r.l - k.l), Math.round(k.r - r.r), Math.round(r.t - k.t), Math.round(k.b - r.b)]);
  });
  const cards = [...sec.children].filter(filled).map(R);
  const logo = { l: 102, t: 103, r: 540.675, b: 462.938 };
  cards.concat([logo]).forEach(function (a, i, all) {
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 0.01 && oy > 0.01) out.overlaps.push([i, j, Math.round(ox), Math.round(oy)]);
    }
  });
  return out;
})()
