import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';

const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: process.cwd(),
  additionalExtensionPaths: ['./extensions/kimi-usage.ts'],
});

await resourceLoader.reload();

const { session } = await createAgentSession({
  resourceLoader,
  sessionManager: SessionManager.inMemory(),
});

if (!session) {
  throw new Error('Session was not created');
}

console.log('PI_RUNTIME_OK');
