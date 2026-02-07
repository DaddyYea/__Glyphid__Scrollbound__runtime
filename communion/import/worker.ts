/**
 * Import Worker
 *
 * Spawned as a child process with extra memory for parsing large export files.
 * Reads args from process.argv, writes JSON result to stdout.
 *
 * Usage: node --max-old-space-size=4096 tsx communion/import/worker.ts <source> <filePath> <dataDir> <humanName>
 */

import { parseChatGPTExport } from './chatgpt';
import { ingestConversations } from './ingest';

async function run() {
  const [, , source, filePath, dataDir, humanName] = process.argv;

  if (!source || !filePath) {
    process.stderr.write('Usage: worker.ts <source> <filePath> <dataDir> <humanName>\n');
    process.exit(1);
  }

  try {
    let conversations;
    let result;

    switch (source) {
      case 'chatgpt':
      case 'openai': {
        const parsed = parseChatGPTExport(filePath, {
          skipSystem: true,
          skipTool: true,
          userName: humanName || 'User',
          assistantName: 'ChatGPT',
        });
        conversations = parsed.conversations;
        result = parsed.result;
        break;
      }
      default:
        throw new Error(`Unknown source: "${source}"`);
    }

    // Send parse result as a progress line
    process.stderr.write(JSON.stringify({
      status: 'parsed',
      totalConversations: result.totalConversations,
      totalMessages: result.totalMessages,
    }) + '\n');

    // Ingest
    const agentId = source === 'chatgpt' ? 'chatgpt' : source;
    const agentName = source === 'chatgpt' ? 'ChatGPT' : source;

    const ingestResult = await ingestConversations(conversations, {
      dataDir: dataDir || 'data/communion',
      agentId,
      agentName,
      humanName: humanName || 'User',
      journalAssistantMessages: true,
    });

    // Final result to stdout
    const summary = {
      source,
      conversations: result.totalConversations,
      messages: result.totalMessages,
      scrollsCreated: ingestResult.scrollsCreated,
      journalEntries: ingestResult.journalEntries,
      dateRange: result.dateRange,
      errors: result.errors,
    };

    process.stdout.write(JSON.stringify(summary));
    process.exit(0);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

run();
