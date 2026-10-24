import { AutonomyLevel, createSession, DroidClient, type CreateSessionOptions, type DroidSession } from '@factory/droid-sdk/node';
import { commandServer, type CommandLog } from './runTool.ts';

// The host default can be script_only, which routes every tool call through one opaque Script
// tool that the permission handler can't inspect. The CLI accepts toolExecutionMode at session
// init, but createSession (SDK 0.10) doesn't forward it, so add it to the init request.
const initializeSession = DroidClient.prototype.initializeSession;
DroidClient.prototype.initializeSession = function (params) {
  return initializeSession.call(this, { ...params, toolExecutionMode: 'direct_only' } as typeof params);
};

// Droid sessions inherit the host's global setup (MCP servers, web tools, subagents, automations).
// Keep only the file tools a compile needs plus our run_command; everything else is disabled so
// no tool can reach the network or delegate around the policy. Execute is disabled on purpose:
// see runTool.ts. At Off autonomy the CLI hides Create/Edit, so Low is the lowest usable level.
export const KEPT_TOOL_IDS = ['Read', 'LS', 'Glob', 'Grep', 'Create', 'Edit', 'ApplyPatch', 'TodoWrite'];

const TOOL_NOTE = `Tool access in this session: call these tools directly: ${KEPT_TOOL_IDS.join(', ')}, and run_command for shell commands. No other tools exist here. If a call is denied, do not retry it or work around it; report the denial.`;

async function disabledToolIdsFor(cwd: string): Promise<string[]> {
  const probe = await createSession({ cwd, autonomyLevel: AutonomyLevel.Low });
  try {
    const all = (await probe.listTools()) as Array<{ id: string }>;
    return all.map((t) => t.id).filter((id) => !KEPT_TOOL_IDS.includes(id));
  } finally {
    await probe.close();
  }
}

export async function createLockedSession(
  options: CreateSessionOptions & { cwd: string; onCommand: (d: CommandLog) => void | Promise<void> },
): Promise<{ session: DroidSession; kept: string[]; disabled: string[] }> {
  const { onCommand, ...rest } = options;
  const disabled = await disabledToolIdsFor(rest.cwd);
  const session = await createSession({
    ...rest,
    autonomyLevel: AutonomyLevel.Low,
    disabledToolIds: disabled,
    disableBuiltinSkills: true,
    mcpServers: [commandServer(rest.cwd, onCommand)],
    systemPrompt: { type: 'preset', preset: 'droid', append: TOOL_NOTE },
  });
  const kept = ((await session.listTools()) as Array<{ id: string }>).map((t) => t.id).filter((id) => !disabled.includes(id));
  return { session, kept, disabled };
}
