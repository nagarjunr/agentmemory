import type { MemoryProvider } from '../types.js'

export class AgentSDKProvider implements MemoryProvider {
  name = 'agent-sdk'

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.query(systemPrompt, userPrompt)
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.query(systemPrompt, userPrompt)
  }

  private async query(systemPrompt: string, userPrompt: string): Promise<string> {
    if (process.env.AGENTMEMORY_SDK_CHILD === "1") {
      // We are already running inside a Claude Agent SDK-spawned session.
      // Spawning another one would let its plugin-hook-driven Stop loop
      // re-enter /agentmemory/summarize and cause unbounded recursion
      // (#149 follow-up). Degrade to empty string so callers short-circuit.
      return ""
    }

    // Mark any child process / SDK session spawned from here as a SDK
    // child. agentmemory hook scripts check this marker and skip their
    // REST calls to break the recursion loop.
    process.env.AGENTMEMORY_SDK_CHILD = "1"

    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const messages = query({
      prompt: userPrompt,
      options: {
        systemPrompt,
        maxTurns: 1,
        allowedTools: [],
      },
    })

    let result = ''
    for await (const msg of messages) {
      if (msg.type === 'result') {
        result = (msg as any).result ?? ''
      }
    }
    return result
  }
}
