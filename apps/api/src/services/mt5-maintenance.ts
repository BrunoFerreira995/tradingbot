import { join } from 'node:path';

export type Mt5MaintenanceAction = 'install' | 'doctor';

const root = join(import.meta.dir, '../../../..');

const commands: Record<Mt5MaintenanceAction, { file: string[]; timeoutMs: number }> = {
  install: {
    file: ['bash', join(root, 'packages/broker/scripts/install-mt5-bridge.sh')],
    timeoutMs: 120_000,
  },
  doctor: {
    file: [process.execPath, join(root, 'packages/broker/scripts/doctor-mt5.ts')],
    timeoutMs: 60_000,
  },
};

export function isMt5MaintenanceAction(
  value: string,
): value is Mt5MaintenanceAction {
  return value === 'install' || value === 'doctor';
}

export interface Mt5MaintenanceResult {
  action: Mt5MaintenanceAction;
  ok: boolean;
  exitCode: number | null;
  output: string;
}

export async function runMt5Maintenance(
  action: Mt5MaintenanceAction,
): Promise<Mt5MaintenanceResult> {
  const command = commands[action];
  const [program, ...args] = command.file;
  if (!program) throw new Error('Missing MT5 maintenance command');

  try {
    const proc = Bun.spawn([program, ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timer = setTimeout(() => proc.kill(), command.timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    const output = [stdout, stderr]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n');
    return { action, ok: exitCode === 0, exitCode, output };
  } catch (error) {
    return {
      action,
      ok: false,
      exitCode: null,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}
