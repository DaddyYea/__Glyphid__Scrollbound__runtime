/**
 * Import Worker
 *
 * Spawned as a child process to parse large export files using streaming JSON.
 * Never loads the full file into memory — processes one conversation at a time.
 *
 * Usage: node --max-old-space-size=4096 tsx communion/import/worker.ts <source> <filePath> <dataDir> <humanName>
 */

import { streamChatGPTExport } from './chatgpt';
import { ingestConversations } from './ingest';
import type { ImportedConversation } from './types';

async function run() {
  const [, , source, filePath, dataDir, humanName] = process.argv;

  if (!source || !filePath) {
    process.stderr.write('Usage: worker.ts <source> <filePath> <dataDir> <humanName>\n');
    process.exit(1);
  }

  try {
    // Collect conversations incrementally via streaming
    const conversations: ImportedConversation[] = [];
    let result;

    switch (source) {
      case 'chatgpt':
      case 'openai': {
        result = await streamChatGPTExport(
          filePath,
          { skipSystem: true, skipTool: true, userName: humanName || 'User', assistantName: 'ChatGPT' },
          (convo) => {
            conversations.push(convo);
            // Log progress every 100 conversations
            if (conversations.length % 100 === 0) {
              process.stderr.write(`[WORKER] Parsed ${conversations.length} conversations so far...\n`);
            }
          },
        );
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
    process.stderr.write(`[WORKER ERROR] ${msg}\n`);
    process.stdout.write(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

run();
