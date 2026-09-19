import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'data', 'linkedin-activity.json');
const START = '&lt;!-- LINKEDIN_AUTOMATION_START --&gt;';
const END = '&lt;!-- LINKEDIN_AUTOMATION_END --&gt;';
const DATA_START = '// LINKEDIN_DATA_START';
const DATA_END = '// LINKEDIN_DATA_END';
const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

const data = JSON.parse(await readFile(DATA, 'utf8'));
const active = data.events.filter(event => event.status === 'active' && event.company);
let html = await readFile(INDEX, 'utf8');
const dataBlock = `${DATA_START}\n      const linkedInLive = ${escapeHtml(JSON.stringify({ refreshedAt:data.lastSuccessfulRefresh, events:active }))};\n      for (const event of linkedInLive.events) {\n        const found = companies.find(company =&gt; company.name.toLocaleLowerCase() === event.company.name.toLocaleLowerCase());\n        if (found) { found.status = &#39;direct&#39;; found.evidence = event.evidenceUrl || found.evidence; }\n        else companies.push({ name:event.company.name, segment:&#39;Newly discovered&#39;, status:&#39;direct&#39;, evidence:event.evidenceUrl });\n      }\n      ${DATA_END}`;
html = html.replace(new RegExp(`${DATA_START}[\\s\\S]*?${DATA_END}`), dataBlock);
const payload = escapeHtml(JSON.stringify({ refreshedAt:data.lastSuccessfulRefresh, events:active, companies:[...new Map(active.map(e => [e.company.id,e.company])).values()] }));
const block = `${START}\n&lt;script&gt;\n(() =&gt; {\n  const live = ${payload};\n  const time = document.querySelector(&#39;.rr-date time&#39;);\n  if (time) {\n    if (live.refreshedAt) { const refreshed = new Date(live.refreshedAt); time.dateTime = refreshed.toISOString(); time.textContent = new Intl.DateTimeFormat(undefined, {dateStyle:&#39;long&#39;,timeStyle:&#39;short&#39;}).format(refreshed); }\n    else { time.removeAttribute(&#39;datetime&#39;); time.textContent = &#39;Awaiting first LinkedIn refresh&#39;; }\n    time.title = &#39;Last successful LinkedIn data refresh&#39;;\n  }\n  const known = new Set([...document.querySelectorAll(&#39;.rr-timeline a&#39;)].map(a =&gt; a.href));\n  const timeline = document.querySelector(&#39;.rr-timeline&#39;);\n  for (const event of [...live.events].reverse()) {\n    if (!timeline || !event.evidenceUrl || known.has(event.evidenceUrl)) continue;\n    const row=document.createElement(&#39;div&#39;); row.className=&#39;rr-event&#39;; const date=document.createElement(&#39;time&#39;); date.dateTime=event.occurredAt||&#39;&#39;; date.textContent=event.occurredAt?new Date(event.occurredAt).toLocaleDateString(undefined,{dateStyle:&#39;medium&#39;}):&#39;Date pending&#39;; const link=document.createElement(&#39;a&#39;); link.href=event.evidenceUrl; link.target=&#39;_blank&#39;; link.rel=&#39;noreferrer&#39;; link.textContent=event.company.name; row.append(date,link); timeline.prepend(row);\n  }\n  const metric=document.querySelector(&#39;.rr-activity-grid .rr-activity-stat strong&#39;); if(metric &amp;&amp; live.events.length) metric.textContent=String(Math.max(20,live.events.length));\n})();\n&lt;/script&gt;\n${END}`;
html = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
await writeFile(INDEX, html);
console.log(`Dashboard built with ${data.events.length} retained LinkedIn events.`);
