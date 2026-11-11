// @vitest-environment node
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRecordingsDirectory } from '../src/server';

describe('recording storage convention', () => {
  it('defaults to the project launch directory, not package or UI assets', () => {
    expect(resolveRecordingsDirectory()).toBe(resolve(process.cwd(), '.recordings'));
  });
  it('resolves the single optional override relative to the launch directory', () => {
    expect(resolveRecordingsDirectory('captures')).toBe(resolve(process.cwd(), 'captures'));
    expect(resolveRecordingsDirectory(resolve('/tmp', 'consumer-recordings'))).toBe(resolve('/tmp', 'consumer-recordings'));
  });
});
