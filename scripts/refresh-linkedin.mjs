import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'linkedin-activity.json');
const API = 'https://api.linkedin.com/rest';
const organizationId = process.env.LINKEDIN_ORGANIZATION_ID || '104983032';
const token = process.env.LINKEDIN_ACCESS_TOKEN;
const version = process.env.LINKEDIN_VERSION || '202608';
const fixtureDir = process.env.LINKEDIN_FIXTURE_DIR;
const headers = { Authorization: `Bearer ${token || ''}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' };

async function request(url, fixture) {
  if (fixtureDir) return JSON.parse(await readFile(path.join(fixtureDir, fixture), 'utf8'));
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`LinkedIn ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

const key = item => String(item.notificationId || item.id || `${item.action}:${item.generatedActivity || ''}:${item.lastModifiedAt || ''}`);
const orgId = urn => /^urn:li:organization:(\d+)$/.exec(urn || '')?.[1] || null;
const evidenceUrl = item => item.sourcePost ? `https://www.linkedin.com/feed/update/${item.sourcePost}/${item.generatedActivity ? `?dashCommentUrn=${encodeURIComponent(item.generatedActivity)}` : ''}` : null;

async function notifications() {
  if (fixtureDir) return (await request('', 'notifications.json')).elements || [];
  const found = [];
  for (let start = 0;; start += 100) {
    const params = new URLSearchParams({ q:'criteria', actions:'List(ADMIN_COMMENT,COMMENT_EDIT,COMMENT_DELETE)', organizationalEntity:`urn:li:organization:${organizationId}`, start:String(start), count:'100' });
    const elements = (await request(`${API}/organizationalEntityNotifications?${params}`)).elements || [];
    found.push(...elements);
    if (elements.length < 100) return found;
  }
}

async function resolve(item, index) {
  if (!item.sourcePost) return null;
  try {
    const post = await request(`${API}/posts/${encodeURIComponent(item.sourcePost)}`, `post-${index}.json`);
    const companyId = orgId(post.author || post.owner || post.containerEntity);
    if (!companyId || companyId === organizationId) return null;
    const company = await request(`${API}/organizations/${companyId}`, `organization-${index}.json`);
    return {
      id:key(item), action:item.action, sourcePost:item.sourcePost, commentUrn:item.generatedActivity || null,
      occurredAt:item.lastModifiedAt || item.createdAt || null,
      company:{ id:companyId, name:company.localizedName || company.name?.localized?.en_US || `LinkedIn organization ${companyId}`, vanityName:company.vanityName || null },
      evidenceUrl:evidenceUrl(item), status:item.action === 'COMMENT_DELETE' ? 'deleted' : 'active'
    };
  } catch (error) {
    return { id:key(item), action:item.action, sourcePost:item.sourcePost, commentUrn:item.generatedActivity || null, occurredAt:item.lastModifiedAt || null, status:'unresolved', error:error.message };
  }
}

export async function refresh() {
  if (!fixtureDir && !token) throw new Error('LINKEDIN_ACCESS_TOKEN is required');
  const current = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const retained = new Map((current.events || []).map(event => [event.id, event]));
  const incoming = await notifications();
  for (let i = 0; i < incoming.length; i += 1) {
    const event = await resolve(incoming[i], i);
    if (event) retained.set(event.id, { ...retained.get(event.id), ...event, firstCapturedAt:retained.get(event.id)?.firstCapturedAt || new Date().toISOString() });
  }
  const output = { schemaVersion:1, organizationId, lastSuccessfulRefresh:new Date().toISOString(), events:[...retained.values()].sort((a,b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))) };
  await mkdir(path.dirname(DATA_FILE), { recursive:true });
  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await refresh();
  console.log(`Captured ${result.events.filter(event => event.status === 'active').length} active LinkedIn comment events.`);
}
