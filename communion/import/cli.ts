#!/usr/bin/env tsx
/**
 * Chat History Import CLI
 *
 * Usage:
 *   npx tsx communion/import/cli.ts chatgpt <path-to-conversations.json> [options]
 *
 * Options:
 *   --dry-run           Parse and report without persisting
 *   --after <date>      Only import conversations created after this date
 *   --before <date>     Only import conversations created before this date
 *   --title <pattern>   Only import conversations matching title (regex)
 *   --max <n>           Maximum conversations to import
 *   --max-msgs <n>      Maximum messages per conversation
 *   --skip-system       Skip system messages
 *   --skip-tool         Skip tool/function messages
 *   --user-name <name>  Display name for user messages (default: "User")
 *   --agent-name <name> Display name for assistant messages (default: "ChatGPT")
 *   --agent-id <id>     Agent ID for memory storage (default: "chatgpt")
 *   --data-dir <dir>    Data directory (default: "data/communion")
 *   --no-journal        Don't write assistant messages to journal
 */

import { existsSync } from 'fs';
import { parseChatGPTExport } from './chatgpt';
import { ingestConversations } from './ingest';
import { ImportOptions } from './types';

function printUsage(): void {
  console.log(`
Scrollbound Chat History Importer

Usage:
  npx tsx communion/import/cli.ts <source> <file> [options]

Sources:
  chatgpt    ChatGPT export (conversations.json)

Options:
  --dry-run            Parse and report without persisting
  --after <date>       Only conversations after this date (ISO or YYYY-MM-DD)
  --before <date>      Only conversations before this date
  --title <pattern>    Filter conversations by title (regex)
  --max <n>            Max conversations to import
  --max-msgs <n>       Max messages per conversation
  --skip-system        Skip system messages
  --skip-tool          Skip tool/function messages
  --user-name <name>   Display name for user (default: "User")
  --agent-name <name>  Display name for assistant (default: varies by source)
  --agent-id <id>      Agent ID for storage (default: varies by source)
  --data-dir <dir>     Data directory (default: "data/communion")
  --no-journal         Don't journal assistant messages

Examples:
  npx tsx communion/import/cli.ts chatgpt ~/Downloads/conversations.json
  npx tsx communion/import/cli.ts chatgpt export.json --dry-run
  npx tsx communion/import/cli.ts chatgpt export.json --after 2024-01-01 --max 50
  npx tsx communion/import/cli.ts chatgpt export.json --title "coding|project"
`);
}

function parseArgs(args: string[]): {
  source: string;
  file: string;
  importOptions: ImportOptions;
  agentId: string;
  agentName: string;
  dataDir: string;
  noJournal: boolean;
} {
  const source = args[0];
  const file = args[1];

  const importOptions: ImportOptions = {};
  let agentId = '';
  let agentName = '';
  let dataDir = 'data/communion';
  let noJournal = false;

  let i = 2;
  while (i < args.length) {
    const flag = args[i];
    switch (flag) {
      case '--dry-run':
        importOptions.dryRun = true;
        break;
      case '--after':
        importOptions.after = args[++i];
        break;
      case '--before':
        importOptions.before = args[++i];
        break;
      case '--title':
        importOptions.titleFilter = args[++i];
        break;
      case '--max':
        importOptions.maxConversations = parseInt(args[++i], 10);
        break;
      case '--max-msgs':
        importOptions.maxMessagesPerConversation = parseInt(args[++i], 10);
        break;
      case '--skip-system':
        importOptions.skipSystem = true;
        break;
      case '--skip-tool':
        importOptions.skipTool = true;
        break;
      case '--user-name':
        importOptions.userName = args[++i];
        break;
      case '--agent-name':
        agentName = args[++i];
        importOptions.assistantName = agentName;
        break;
      case '--agent-id':
        agentId = args[++i];
        break;
      case '--data-dir':
        dataDir = args[++i];
        break;
      case '--no-journal':
        noJournal = true;
        break;
      default:
        console.warn(`Unknown option: ${flag}`);
    }
    i++;
  }

  return { source, file, importOptions, agentId, agentName, dataDir, noJournal };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const { source, file, importOptions, agentId, agentName, dataDir, noJournal } = parseArgs(args);

  // Validate file exists
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  console.log(`\n[IMPORT] Source: ${source}`);
  console.log(`[IMPORT] File: ${file}`);
  if (importOptions.dryRun) console.log(`[IMPORT] ** DRY RUN — no data will be written **`);

  let conversations;
  let result;

  switch (source) {
    case 'chatgpt':
    case 'openai': {
      const defaults = {
        agentId: agentId || 'chatgpt',
        agentName: agentName || 'ChatGPT',
      };
      importOptions.assistantName = importOptions.assistantName || defaults.agentName;

      console.log(`[IMPORT] Parsing ChatGPT export...`);
      const parsed = parseChatGPTExport(file, importOptions);
      conversations = parsed.conversations;
      result = parsed.result;

      // Print parse summary
      console.log(`\n[PARSE RESULT]`);
      console.log(`  Conversations: ${result.totalConversations}`);
      console.log(`  Messages: ${result.totalMessages}`);
      if (result.dateRange.earliest) {
        console.log(`  Date range: ${result.dateRange.earliest.split('T')[0]} → ${result.dateRange.latest.split('T')[0]}`);
      }
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.log(`    - ${err}`);
      }

      // Show sample titles
      if (result.conversationTitles.length > 0) {
        console.log(`\n  Sample conversations:`);
        for (const title of result.conversationTitles.slice(0, 10)) {
          console.log(`    - ${title}`);
        }
        if (result.conversationTitles.length > 10) {
          console.log(`    ... and ${result.conversationTitles.length - 10} more`);
        }
      }

      // Ingest into memory
      if (conversations.length > 0) {
        console.log(`\n[INGEST] Writing to memory systems...`);
        const ingestResult = await ingestConversations(conversations, {
          dataDir,
          agentId: defaults.agentId,
          agentName: defaults.agentName,
          humanName: importOptions.userName || 'User',
          journalAssistantMessages: !noJournal,
          dryRun: importOptions.dryRun,
        });

        console.log(`\n[INGEST RESULT]`);
        console.log(`  Conversations processed: ${ingestResult.conversationsProcessed}`);
        console.log(`  Scrolls created: ${ingestResult.scrollsCreated}`);
        console.log(`  Journal entries: ${ingestResult.journalEntries}`);
      }

      break;
    }

    default:
      console.error(`Unknown source: "${source}". Supported: chatgpt`);
      console.error(`(xai and anthropic importers coming soon)`);
      process.exit(1);
  }

  console.log(`\n[IMPORT] Done.`);
}

main().catch(err => {
  console.error('[IMPORT] Fatal error:', err);
  process.exit(1);
});
