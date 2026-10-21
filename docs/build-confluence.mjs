// Builds docs/confluence-pages.json (Confluence storage-format bodies) from the markdown sources.
import { readFileSync, writeFileSync } from "node:fs";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => /^https?:/.test(href) ? `<a href="${href}">${t}</a>` : `<code>${href}</code>`);

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

const codeMacro = (code, lang = "text", title) => {
  const safe = code.replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<ac:structured-macro ac:name="code">${title ? `<ac:parameter ac:name="title">${esc(title)}</ac:parameter>` : ""}<ac:parameter ac:name="language">${lang}</ac:parameter><ac:plain-text-body><![CDATA[${safe}]]></ac:plain-text-body></ac:structured-macro>`;
};
const LANG = { ts: "typescript", typescript: "typescript", json: "json", yaml: "yaml", bash: "bash", sh: "bash", markdown: "text", mermaid: "text", "": "text" };

const DIAGRAMS = {
  topology: `<table><tbody>
<tr><th colspan="3">Berth control plane · one deployment (Replit)</th><th>Reaches</th></tr>
<tr><td><strong>Web console</strong><br/>React · Vite</td><td><strong>HTTP API</strong><br/>Express · Zod at the boundary</td><td><strong>Services</strong><br/>groups · allocation · config · wiring · apply planner</td><td rowspan="2"><strong>Docker hosts</strong> (EC2 · VPS) — dockerode over SSH / mTLS<br/><br/><strong>ECS clusters</strong> (EC2 launch type · bridge networking) — AWS SDK v3<br/><br/><strong>AWS services</strong> — SSM · Secrets Manager · EC2 security groups · Cloud Map</td></tr>
<tr><td><strong>Postgres</strong><br/>desired + observed state · operations · encrypted credentials</td><td><strong>Job runner</strong><br/>discovery poller · drift detector · operation executor</td><td><strong>Provider interface</strong><br/>docker · ecs · fake adapters</td></tr>
</tbody></table>`,
  apply: `<ol>
<li><strong>Operator</strong> clicks Apply → <code>POST /api/groups/shop/applies</code> with an <code>Idempotency-Key</code>.</li>
<li><strong>API</strong> inserts the operation; the unique index on <code>(groupId, idempotencyKey)</code> replays an existing one instead of starting a second.</li>
<li><strong>API</strong> claims port allocations in the same transaction; the partial unique index on <code>(providerId, hostPort, protocol)</code> rejects collisions with <code>409 PORT_IN_USE</code>.</li>
<li><strong>API</strong> answers <code>202 { operation: PENDING }</code>. Nothing has touched a host yet.</li>
<li><strong>Executor</strong> loads desired and observed state and computes <code>plan = diff(desired, observed, capabilities)</code> — a pure, unit-tested function.</li>
<li><strong>Executor → adapter</strong>: <code>ensureNetwork(shop)</code> (Docker user-defined network or ECS Service Connect namespace).</li>
<li>For each member in order <strong>INTERNAL → EXPOSED → ENTRY</strong>: write the step as <code>RUNNING</code> <em>before</em> the call, then <code>applyMember(plan)</code>. Success records the result; failure triggers <code>rollbackMember(previous)</code> and marks the operation <code>FAILED</code> at that step; a timeout leaves the step <code>UNKNOWN</code> for discovery to reconcile.</li>
<li>On success: allocations → <code>APPLIED</code>, group → <code>APPLIED</code>, operation → <code>SUCCEEDED</code>.</li>
</ol>`,
};

function render(md, { shiftHeadings = 0 } = {}) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let pendingDiagram = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^<!--\s*diagram:\s*(\w+)\s*-->/);
    if (m) { pendingDiagram = m[1]; i++; continue; }
    if (line.trim() === "---") { flushPara(); out.push("<hr/>"); i++; continue; }
    if (line.startsWith("```")) {
      flushPara();
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      if (lang === "mermaid") {
        if (pendingDiagram && DIAGRAMS[pendingDiagram]) out.push(DIAGRAMS[pendingDiagram]);
        out.push(`<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Diagram source (Mermaid)</ac:parameter><ac:rich-text-body>${codeMacro(buf.join("\n"), "text")}</ac:rich-text-body></ac:structured-macro>`);
        pendingDiagram = null;
      } else {
        out.push(codeMacro(buf.join("\n"), LANG[lang] ?? "text"));
      }
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = Math.min(6, h[1].length + shiftHeadings);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const header = splitRow(rows[0]);
      const body = rows.slice(2).map(splitRow);
      out.push(`<table><tbody><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara();
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
      // task checkboxes render as plain text markers
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it.replace(/^\[ \]\s+/, "☐ ").replace(/^\[x\]\s+/i, "☑ "))}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (line.trim() === "") { flushPara(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n");
}

const read = (p) => readFileSync(p, "utf8");
const stripTitle = (md) => md.replace(/^# .*\n/, "");
const info = (title, body) => `<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">${esc(title)}</ac:parameter><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;

const adrFiles = [
  "ADR-001-provider-abstraction.md", "ADR-002-group-port-model.md", "ADR-003-config-and-secrets.md",
  "ADR-004-service-discovery-and-wiring.md", "ADR-005-stack-and-hosting.md", "ADR-006-apply-as-idempotent-reconcile.md",
];

const parentBody = `
${info("Status", `<p><strong>Design accepted 21 Oct 2026.</strong> Decisions at approval: ECS uses the EC2 launch type (bridge networking); the control plane runs as a Replit deployment reaching hosts over SSH. Generated from the repository sources <code>CAPABILITY-MAP.md</code>, <code>SPEC.md</code>, <code>docs/architecture.md</code>, <code>docs/decisions/</code>, <code>tasks/plan.md</code>; the repository is the source of truth.</p>`)}
<p><strong>Berth</strong> (working title) is a control plane for container groups across Docker hosts (EC2 / VPS) and ECS: it discovers what runs, lets you group it, takes one port per group and does the port-mapping bookkeeping, manages environment variables and secrets, and wires the apps in a group together.</p>
<h2>Pages</h2>
<ac:structured-macro ac:name="children"><ac:parameter ac:name="all">true</ac:parameter></ac:structured-macro>
<h2>Capability map</h2>
${render(stripTitle(read("CAPABILITY-MAP.md")))}
`;

const specBody = `${info("Status", "<p>Accepted 21 Oct 2026. Open questions 1 and 4 resolved; the rest proceed on stated defaults.</p>")}\n${render(stripTitle(read("SPEC.md")))}`;
const archBody = `${info("Status", "<p>Accepted, v0.2 (21 Oct 2026).</p>")}\n${render(stripTitle(read("docs/architecture.md")))}`;
const adrBody = `<p>Each expensive-to-reverse choice, with the alternatives rejected and why. One section per ADR; the files live in <code>docs/decisions/</code>.</p>\n` +
  adrFiles.map((f) => render(read(`docs/decisions/${f}`), { shiftHeadings: 1 })).join("\n<hr/>\n");
const planBody = `${render(stripTitle(read("tasks/plan.md")))}\n<h2>Task list</h2>\n${render(stripTitle(read("tasks/todo.md")), { shiftHeadings: 1 })}`;

const pages = {
  parent: { title: "Berth — Design and Architecture", body: parentBody },
  children: [
    { key: "spec", title: "Berth — Spec", body: specBody },
    { key: "architecture", title: "Berth — Architecture", body: archBody },
    { key: "adrs", title: "Berth — Decisions (ADRs)", body: adrBody },
    { key: "plan", title: "Berth — Implementation Plan", body: planBody },
  ],
};
writeFileSync("docs/confluence-pages.json", JSON.stringify(pages, null, 1));
for (const p of [pages.parent, ...pages.children]) console.log(p.title, p.body.length, "chars");
