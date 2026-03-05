import process from 'node:process';

const [, , inputText, clusterArg = 'WM', baseUrlArg = 'http://localhost:3000', agentId = ''] = process.argv;
if (!inputText) {
  console.error('Usage: node scripts/llm_ablation_compare.mjs "text" [CLUSTER] [baseUrl] [agentId]');
  process.exit(1);
}

const cluster = clusterArg.toUpperCase();
const baseUrl = baseUrlArg.replace(/\/$/, '');

async function getJson(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function postJson(path, payload) {
  return getJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function getReceipt() {
  const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const data = await getJson(`/debug/llm-receipt${q}`);
  return data.receipt || null;
}

async function setAblation(name, value) {
  return postJson('/debug/llm-ablation', { ablations: { [name]: value } });
}

async function sendMessage(text) {
  await postJson('/message', { text });
}

async function waitForNewReceipt(previousRequestId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await getReceipt();
    if (r && r.requestId && r.requestId !== previousRequestId) return r;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for a new receipt');
}

function summarize(label, receipt) {
  const wm = receipt?.clusterChars?.WM ?? 0;
  const sem = receipt?.clusterChars?.SEM_R ?? 0;
  const socio = receipt?.clusterChars?.SOCIO ?? 0;
  const chars = receipt?.charCounts?.total ?? 0;
  const issues = (receipt?.issues || []).join(', ') || 'none';
  return `${label}: tick=${receipt?.tickId ?? 'n/a'} chars=${chars} WM=${wm} SEM=${sem} SOCIO=${socio} issues=${issues}`;
}

const ablationState = await getJson('/debug/llm-ablation');
const original = ablationState.ablations || {};

try {
  const before = await getReceipt();
  const beforeId = before?.requestId || '';

  await setAblation(cluster, false);
  await sendMessage(`[ABLATION ON] ${inputText}`);
  const onReceipt = await waitForNewReceipt(beforeId);

  await setAblation(cluster, true);
  await sendMessage(`[ABLATION OFF:${cluster}] ${inputText}`);
  const offReceipt = await waitForNewReceipt(onReceipt.requestId);

  console.log(summarize('ON ', onReceipt));
  console.log(summarize('OFF', offReceipt));
  console.log(`Delta chars: ${(offReceipt?.charCounts?.total ?? 0) - (onReceipt?.charCounts?.total ?? 0)}`);
} finally {
  await postJson('/debug/llm-ablation', { ablations: original });
}
