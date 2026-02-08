/**
 * Import Worker
 *
 * Spawned as a child process to parse large export files using streaming JSON.
 * Never accumulates all conversations in memory — ingests each one as it streams in.
 *
 * Usage: node --max-old-space-size=4096 tsx communion/import/worker.ts <source> <filePath> <dataDir> <humanName>
 */

import { streamChatGPTExport } from './chatgpt';
import { IngestSession } from './ingest';

async function run() {
  const [, , source, filePath, dataDir, humanName] = process.argv;

  if (!source || !filePath) {
    process.stderr.write('Usage: worker.ts <source> <filePath> <dataDir> <humanName>\n');
    process.exit(1);
  }

  try {
    const agentId = source === 'chatgpt' ? 'chatgpt' : source;
    const agentName = source === 'chatgpt' ? 'ChatGPT' : source;

    // Initialize ingest session once
    const session = new IngestSession({
      dataDir: dataDir || 'data/communion',
      agentId,
      agentName,
      humanName: humanName || 'User',
      journalAssistantMessages: true,
    });
    await session.initialize();

    let result;

    switch (source) {
      case 'chatgpt':
      case 'openai': {
        // Stream-parse and ingest each conversation immediately — no accumulation
        result = await streamChatGPTExport(
          filePath,
          { skipSystem: true, skipTool: true, userName: humanName || 'User', assistantName: 'ChatGPT' },
          (convo) => {
            // Ingest synchronously within the stream callback
            // (journal writes are async but we fire-and-forget here)
            session.ingestConversation(convo);

            if (session.conversationsProcessed % 100 === 0) {
              process.stderr.write(`[WORKER] ${session.conversationsProcessed} conversations, ${session.scrollsCreated} scrolls...\n`);
            }
          },
        );
        break;
      }
      default:
        throw new Error(`Unknown source: "${source}"`);
    }

    process.stderr.write(JSON.stringify({
      status: 'parsed',
      totalConversations: result.totalConversations,
      totalMessages: result.totalMessages,
    }) + '\n');

    // Finalize — save archive to disk
    await session.finalize();

    const summary = {
      source,
      conversations: result.totalConversations,
      messages: result.totalMessages,
      scrollsCreated: session.scrollsCreated,
      journalEntries: session.journalEntries,
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
