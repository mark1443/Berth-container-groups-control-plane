// Builds docs/berth-design-and-architecture.html from the markdown sources.
// Minimal markdown subset: headings, paragraphs, lists, tables, fenced code, inline code/bold/links, HTML comments.
import { readFileSync, writeFileSync } from "node:fs";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

const DIAGRAMS = {
  topology: `
<div class="diagram">
  <div class="dg-cp">
    <div class="dg-title">Berth control plane · one deployment</div>
    <div class="dg-row">
      <div class="dg-box">Web console<small>React · Vite</small></div><span class="dg-arrow">→</span>
      <div class="dg-box">HTTP API<small>Express · Zod at the boundary</small></div><span class="dg-arrow">→</span>
      <div class="dg-box">Services<small>groups · allocation · config · wiring · apply planner</small></div>
    </div>
    <div class="dg-row">
      <div class="dg-box dg-db">Postgres<small>desired + observed state · operations · encrypted credentials</small></div>
      <div class="dg-box">Job runner<small>discovery poller · drift detector · operation executor</small></div><span class="dg-arrow">→</span>
      <div class="dg-box dg-iface">Provider interface<small>docker · ecs · fake</small></div>
    </div>
  </div>
  <div class="dg-targets">
    <div class="dg-target"><span class="dg-proto">dockerode over SSH / mTLS</span><div class="dg-box dg-ext">Docker hosts<small>EC2 · VPS</small></div></div>
    <div class="dg-target"><span class="dg-proto">AWS SDK v3</span><div class="dg-box dg-ext">ECS clusters<small>EC2 launch type · bridge networking</small></div></div>
    <div class="dg-target"><span class="dg-proto">AWS SDK v3</span><div class="dg-box dg-ext">AWS services<small>SSM · Secrets Manager · EC2 security groups · Cloud Map</small></div></div>
  </div>
</div>`,
  apply: `
<ol class="flow">
  <li><b>Operator</b> clicks Apply → <code>POST /api/groups/shop/applies</code> with an <code>Idempotency-Key</code>.</li>
  <li><b>API</b> inserts the operation; the unique index on <code>(groupId, idempotencyKey)</code> replays an existing one instead of starting a second.</li>
  <li><b>API</b> claims port allocations in the same transaction; the partial unique index on <code>(providerId, hostPort, protocol)</code> rejects collisions with <code>409 PORT_IN_USE</code>.</li>
  <li><b>API</b> answers <code>202 { operation: PENDING }</code>. Nothing has touched a host yet.</li>
  <li><b>Executor</b> loads desired and observed state and computes <code>plan = diff(desired, observed, capabilities)</code> — a pure, unit-tested function.</li>
  <li><b>Executor → adapter</b>: <code>ensureNetwork(shop)</code> (Docker user-defined network or ECS Service Connect namespace).</li>
  <li>For each member in order <b>INTERNAL → EXPOSED → ENTRY</b>: write the step as <code>RUNNING</code> <em>before</em> the call, then <code>applyMember(plan)</code>. Success records the result; failure triggers <code>rollbackMember(previous)</code> and marks the operation <code>FAILED</code> at that step; a timeout leaves the step <code>UNKNOWN</code> for discovery to reconcile.</li>
  <li>On success: allocations → <code>APPLIED</code>, group → <code>APPLIED</code>, operation → <code>SUCCEEDED</code>.</li>
</ol>`,
};

function render(md, { shiftHeadings = 0 } = {}) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let pendingDiagram = null;
  const flushPara = (buf) => { if (buf.length) { out.push(`<p>${inline(buf.join(" "))}</p>`); buf.length = 0; } };
  let para = [];
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^<!--\s*diagram:\s*(\w+)\s*-->/);
    if (m) { pendingDiagram = m[1]; i++; continue; }
    if (line.startsWith("```")) {
      flushPara(para);
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      if (lang === "mermaid") {
        if (pendingDiagram && DIAGRAMS[pendingDiagram]) out.push(DIAGRAMS[pendingDiagram]);
        else out.push(`<details class="src"><summary>Diagram source (Mermaid — renders on GitHub)</summary><pre><code>${esc(buf.join("\n"))}</code></pre></details>`);
        pendingDiagram = null;
      } else {
        out.push(`<pre><code class="lang-${lang}">${esc(buf.join("\n"))}</code></pre>`);
      }
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(para);
      const level = Math.min(6, h[1].length + shiftHeadings);
      const text = h[2];
      const id = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++; continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara(para);
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const header = splitRow(rows[0]);
      const body = rows.slice(2).map(splitRow);
      out.push(`<table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara(para);
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^\s{2,}\S/.test(lines[i]) && items.length && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
        } else {
          items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (line.trim() === "") { flushPara(para); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  return out.join("\n");
}

const read = (p) => readFileSync(p, "utf8");
const stripTitle = (md) => md.replace(/^# .*\n/, "");

const capMap = stripTitle(read("CAPABILITY-MAP.md"));
const spec = stripTitle(read("SPEC.md"));
const arch = stripTitle(read("docs/architecture.md"));
const adrFiles = [
  "ADR-001-provider-abstraction.md",
  "ADR-002-group-port-model.md",
  "ADR-003-config-and-secrets.md",
  "ADR-004-service-discovery-and-wiring.md",
  "ADR-005-stack-and-hosting.md",
  "ADR-006-apply-as-idempotent-reconcile.md",
];
const adrs = adrFiles.map((f) => read(`docs/decisions/${f}`));

const css = `
:root{--ink:#1b1f24;--muted:#5b6470;--line:#e3e7ec;--bg:#ffffff;--soft:#f6f8fa;--accent:#0b5fff;--warn:#b35c00;--ok:#1e7f4f}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:980px;margin:0 auto;padding:40px 28px 80px}
header.hero{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:32px}
header.hero h1{font-size:34px;line-height:1.15;margin:0 0 8px}
header.hero p{margin:0;color:var(--muted)}
.badges{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
.badge{font-size:12px;letter-spacing:.02em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:3px 10px;color:var(--muted)}
.badge.status{border-color:#f0c58a;color:var(--warn);background:#fff7ec}.badge.status.ok{border-color:#a9d9bf;color:var(--ok);background:#eef8f2}
.callout{border:1px solid #cfe0ff;background:#f3f7ff;border-radius:10px;padding:16px 18px;margin:0 0 32px}
.callout h3{margin:0 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent)}
.callout ol{margin:0;padding-left:20px}
nav.toc{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:36px;font-size:15px}
nav.toc a{color:var(--ink);text-decoration:none;margin-right:16px;white-space:nowrap}
nav.toc a:hover{color:var(--accent)}
section.part{margin-top:56px;padding-top:24px;border-top:2px solid var(--ink)}
section.part>h1{font-size:28px;margin:0 0 4px}
section.part>p.lead{color:var(--muted);margin:0 0 20px}
h2{font-size:22px;margin:36px 0 10px}
h3{font-size:17px;margin:26px 0 8px}
h4{font-size:15px;margin:20px 0 6px}
p{margin:10px 0}
code{font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
pre{background:#0f172a;color:#e5edf7;border-radius:10px;padding:14px 16px;overflow:auto;font-size:13px;line-height:1.5}
pre code{background:none;border:0;padding:0;color:inherit;font-size:inherit}
table{width:100%;border-collapse:collapse;margin:14px 0 18px;font-size:14.5px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}
tr:nth-child(even) td{background:#fbfcfd}
ul,ol{padding-left:24px;margin:8px 0}
li{margin:4px 0}
details.src{margin:10px 0 18px}
details.src summary{cursor:pointer;color:var(--muted);font-size:14px}
article.adr{border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:18px 0}
article.adr h2{margin:0 0 6px;font-size:20px}
article.adr h3{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 6px}
article.adr h4{margin:14px 0 4px}
/* topology diagram */
.diagram{display:grid;grid-template-columns:1fr 240px;gap:18px;margin:18px 0 24px}
.dg-cp{border:1.5px solid var(--ink);border-radius:12px;padding:14px}
.dg-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px}
.dg-row{display:flex;align-items:stretch;gap:8px;margin:8px 0}
.dg-box{flex:1;border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:8px 10px;font-size:13.5px;font-weight:600;display:flex;flex-direction:column;justify-content:center}
.dg-box small{display:block;font-weight:400;color:var(--muted);font-size:12px;line-height:1.35;margin-top:2px}
.dg-db{background:#eef6f1;border-color:#bfe0cd}
.dg-iface{background:#eaf1ff;border-color:#bcd2ff}
.dg-ext{background:#fff;border-style:dashed}
.dg-arrow{align-self:center;color:var(--muted)}
.dg-targets{display:flex;flex-direction:column;justify-content:space-between;gap:10px}
.dg-target{display:flex;flex-direction:column}
.dg-proto{font-size:11.5px;color:var(--muted);padding-left:4px;margin-bottom:2px}
.dg-proto::before{content:"⟶ ";color:var(--accent)}
/* flow */
ol.flow{counter-reset:step;list-style:none;padding:0;margin:14px 0 20px;border-left:2px solid var(--line)}
ol.flow li{counter-increment:step;position:relative;padding:4px 0 4px 36px;margin:0 0 8px}
ol.flow li::before{content:counter(step);position:absolute;left:-13px;top:6px;width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
footer{margin-top:60px;color:var(--muted);font-size:13.5px;border-top:1px solid var(--line);padding-top:16px}
@media print{.wrap{padding:0}pre{white-space:pre-wrap}section.part{break-before:page}}
@media (max-width:760px){.diagram{grid-template-columns:1fr}.dg-row{flex-direction:column}.dg-arrow{display:none}}
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Berth — Design and Architecture (accepted)</title><style>${css}</style></head>
<body><div class="wrap">
<header class="hero">
  <h1>Berth — Design and Architecture</h1>
  <p>A control plane for container groups across Docker hosts (EC2 / VPS) and ECS: discover what runs, group it, give the group one port, manage env and secrets, wire the apps together.</p>
  <div class="badges"><span class="badge status ok">Status: Accepted · 21 Oct 2026</span><span class="badge">v0.2</span><span class="badge">Spec-driven · contract-first · ADRs</span></div>
</header>
<div class="callout">
  <h3>Approved 21 Oct 2026</h3>
  <ol>
    <li><b>ECS runtime:</b> EC2 launch type with bridge networking — Berth allocates host ports on ECS exactly as on Docker hosts.</li>
    <li><b>Hosting:</b> Berth runs as a Replit deployment and reaches hosts over SSH; no agent on hosts.</li>
    <li><b>Still open</b> (end of the Spec): ALB scope, Service Connect vs existing Cloud Map, auth, secret reveal, scale — proceeding on the stated defaults.</li>
  </ol>
</div>
<nav class="toc"><a href="#part-map">1 · Capability map</a><a href="#part-spec">2 · Spec</a><a href="#part-arch">3 · Architecture</a><a href="#part-adrs">4 · Decisions (ADRs)</a></nav>

<section class="part" id="part-map"><h1>1 · Capability map</h1><p class="lead">Phase 0 of the spec-driven workflow: module boundaries and build order, reviewed before any module spec.</p>
${render(capMap)}
</section>

<section class="part" id="part-spec"><h1>2 · Spec</h1><p class="lead">What we are building, why, how we will know it is done, and the rules of engagement.</p>
${render(spec)}
</section>

<section class="part" id="part-arch"><h1>3 · Architecture</h1><p class="lead">System shape, domain model, the provider contract, port and config models, apply flow, HTTP API, security, failure modes.</p>
${render(arch)}
</section>

<section class="part" id="part-adrs"><h1>4 · Decisions (ADRs)</h1><p class="lead">Each expensive-to-reverse choice, with the alternatives rejected and why. Stored in <code>docs/decisions/</code>.</p>
${adrs.map((md) => `<article class="adr">${render(md, { shiftHeadings: 1 })}</article>`).join("\n")}
</section>

<footer>Sources: <code>CAPABILITY-MAP.md</code>, <code>SPEC.md</code>, <code>docs/architecture.md</code>, <code>docs/decisions/ADR-001…006</code>. These files move into the project repository on approval. Mermaid diagrams in the markdown render on GitHub; this page uses static equivalents.</footer>
</div></body></html>`;

writeFileSync("docs/berth-design-and-architecture.html", html);
console.log("wrote docs/berth-design-and-architecture.html", html.length, "bytes");
