import { resolve } from 'node:path';
import { homedir } from 'node:os';

export function resolvePath(input: string): string {
  // Only expand the current user's home dir (~/ or bare ~).
  // ~username/ style paths are not supported and are passed through to resolve() as-is.
  if (input === '~' || input.startsWith('~/')) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
