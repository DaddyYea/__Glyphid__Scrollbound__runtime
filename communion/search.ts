// search.ts — DuckDuckGo web search, no API key required

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults = 4): Promise<SearchResult[]> {
  try {
    // DuckDuckGo HTML lite endpoint — no API key, no rate limit for light use
    const params = new URLSearchParams({ q: query, kl: 'us-en', s: '0' });
    const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html',
      },
      body: params.toString(),
    });

    if (!response.ok) throw new Error(`DDG returned ${response.status}`);

    const html = await response.text();
    return parseDDGHtml(html, maxResults);
  } catch (err) {
    console.warn('[search] DDG failed, trying instant answer API:', err);
    return fallbackInstantAnswer(query);
  }
}

function parseDDGHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks
  const blockRe = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];
    const titleMatch = titleRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (!titleMatch) continue;

    const url = titleMatch[1].startsWith('//') ? 'https:' + titleMatch[1] : titleMatch[1];
    const title = stripTags(titleMatch[2]);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

async function fallbackInstantAnswer(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ScrollboundRuntime/1.0' }
    });
    const data = await res.json() as any;

    const results: SearchResult[] = [];

    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText,
      });
    }

    for (const topic of (data.RelatedTopics || []).slice(0, 3)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `[No search results found for: ${query}]`;
  const lines = [`[Web search: "${query}"]`];
  for (const r of results) {
    lines.push(`• ${r.title}`);
    if (r.snippet) lines.push(`  ${r.snippet}`);
    lines.push(`  ${r.url}`);
  }
  return lines.join('\n');
}
