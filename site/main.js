(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Citation demo ---------- */
  // The Project Falcon sample notebook from Folio's screenshots.
  const pages = [
    { n: 1, title: "Project Falcon: overview", body: [
      "Project Falcon is an internal research programme on low-cost aerial sensing.",
      ["The project was launched with a budget of 2 million dollars", " for its first two years."],
      "Funding is reviewed at the end of each phase.",
    ] },
    { n: 2, title: "Team", body: [
      "Staffing for the first phase was finalised in March.",
      ["The Falcon team is led by Dr. Priya Rao and has 14 engineers based in Pune.", ""],
      "Two of the engineers work part time with the hardware lab.",
    ] },
    { n: 3, title: "Roadmap", body: [
      "Phase one delivers the flight platform and its ground station.",
      ["Phase two of Project Falcon targets satellite imaging,", " using the same ground station."],
      "A third phase is under discussion.",
    ] },
  ];
  // citation index -> page index
  const cites = [1, 0, 2];
  const pageEl = $("#page"), pgEl = $("#pg");
  const chips = $$("button.chip");

  function openCite(c) {
    const p = pages[cites[c]];
    pgEl.textContent = `page ${p.n} / ${pages.length}`;
    pageEl.innerHTML = `<h4>${p.title}</h4>` + p.body.map((b) =>
      Array.isArray(b) ? `<p><mark>${b[0]}</mark>${b[1]}</p>` : `<p>${b}</p>`).join("") +
      `<p class="fold">text.pdf · ${p.n}</p>`;
    chips.forEach((ch) => ch.setAttribute("aria-pressed", String(+ch.dataset.c === c)));
  }
  chips.forEach((ch) => ch.addEventListener("click", () => openCite(+ch.dataset.c)));
  openCite(0);

  /* ---------- Evaluation ladder (docs/eval/results.md) ---------- */
  const rows = [
    { name: "Vector search only", sub: "v1 baseline", h1: 77, h3: 88, mrr: 0.830 },
    { name: "+ keyword search", sub: "RRF", h1: 74, h3: 88, mrr: 0.821 },
    { name: "+ query rewrite", sub: "", h1: 77, h3: 93, mrr: 0.847 },
    { name: "+ multi-query", sub: "off by default", h1: 72, h3: 95, mrr: 0.830 },
    { name: "+ reranker & gate", sub: "biggest single win", h1: 91, h3: 95, mrr: 0.937 },
    { name: "+ structure-aware chunks", sub: "v2, current", h1: 93, h3: 98, mrr: 0.952 },
  ];
  const reads = {
    h1: "Hit@1: the right page is the first result. The reranker lifts it from 72% to 91%; the earlier stages widen the net but put near-misses on top.",
    h3: "Hit@3: the right page is in the top three. Every stage helps a little here; structured chunks reach 98%.",
    mrr: "Mean reciprocal rank: 1.0 would be the right page first every time. The full pipeline scores 0.952.",
  };
  const ladder = $("#ladder"), readEl = $("#eval-read");
  ladder.innerHTML = rows.map((r) => `<li class="rung"><p class="rung-name">${r.name}${r.sub ? `<small>${r.sub}</small>` : ""}</p>` +
    `<div class="rung-bar"><span class="rung-fill"></span></div><p class="rung-val"></p></li>`).join("");
  const rungs = $$(".rung", ladder);
  let metric = "h1";
  function draw() {
    const vals = rows.map((r) => r[metric]);
    const best = Math.max(...vals);
    rungs.forEach((el, i) => {
      const v = vals[i];
      const pct = metric === "mrr" ? v * 100 : v;
      $(".rung-fill", el).style.width = `${pct}%`;
      $(".rung-val", el).textContent = metric === "mrr" ? v.toFixed(3) : `${v}%`;
      el.classList.toggle("best", v === best);
      el.classList.toggle("jump", i === 4 && v !== best && metric === "h1");
    });
    readEl.textContent = reads[metric];
  }
  $$(".seg button").forEach((b) => b.addEventListener("click", () => {
    metric = b.dataset.m;
    $$(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  }));
  const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { draw(); obs.disconnect(); } }, { threshold: 0.25 });
  obs.observe(ladder);
  readEl.textContent = reads[metric];

  /* ---------- Copy ---------- */
  $$(".copy").forEach((btn) => btn.addEventListener("click", async () => {
    const text = btn.parentElement.querySelector("code").textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; btn.classList.add("done"); }
    catch { btn.textContent = "Select it"; }
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
  }));
})();
