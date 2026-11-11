// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getRecordingState,
  releaseRecording,
  startRecording,
  trace,
} from '../src';

afterEach(() => {
  if (getRecordingState().isRecording) {
    releaseRecording();
  }
});

function recordThrown(error: unknown) {
  startRecording({ cpu: false, mode: 'full', withArguments: false });
  let caught: unknown;
  try {
    trace(() => {
      throw error;
    }, 'failingCall')();
  } catch (value) {
    caught = value;
  }
  expect(caught).toBe(error);
  const recording = releaseRecording();
  // Exercise the JSON transport boundary where the old foreign Error became {}.
  return JSON.parse(JSON.stringify(recording)).traces[0].events[0];
}

describe('recorded errors', () => {
  it('preserves name, message and stack from another realm without call arguments', () => {
    const error = runInNewContext('new TypeError("component does not exist")');
    expect(error).not.toBeInstanceOf(Error);
    expect(JSON.parse(JSON.stringify(error))).toEqual({});
    const event = recordThrown(error);
    expect(event).toMatchObject({
      error: {
        message: 'component does not exist',
        name: 'TypeError',
        stack: expect.stringContaining('TypeError: component does not exist'),
      },
      status: 'error',
    });
    expect(event.arguments).toBeUndefined();
  });

  it('records local error causes without following cycles indefinitely', () => {
    const cause = new Error('underlying failure');
    const error = new Error('lookup failed', { cause });
    Object.defineProperty(cause, 'cause', { value: error });
    expect(recordThrown(error).error).toMatchObject({
      cause: { cause: '[Circular]', message: 'underlying failure' },
      message: 'lookup failed',
      name: 'Error',
    });
  });

  it('snapshots rejected objects with bigint and cyclic data before serialization', async () => {
    const rejection: Record<string, unknown> = {
      code: 42n,
      message: 'rejected',
      toJSON: () => {
        throw new Error('must not invoke a custom serializer');
      },
    };
    rejection.self = rejection;
    startRecording({ cpu: false });
    await expect(
      trace(() => Promise.reject(rejection), 'rejectingCall')(),
    ).rejects.toBe(rejection);
    const recording = releaseRecording();
    rejection.message = 'changed after failure';
    const event = JSON.parse(JSON.stringify(recording)).traces[0].events[0];
    expect(event.error).toEqual({
      code: '42n',
      message: 'rejected',
      self: '[Circular]',
      toJSON: '[Function]',
    });
  });

  it('keeps the original failure when a thrown proxy cannot be inspected', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(recordThrown(revoked.proxy).error).toBe(
      '[Uninspectable thrown value]',
    );
  });

  it('does not replace the original error when a cause getter throws', () => {
    const error = new Error('original');
    Object.defineProperty(error, 'cause', {
      get() {
        throw new Error('getter failure');
      },
    });
    expect(recordThrown(error).error).toMatchObject({
      cause: '[Unreadable]',
      message: 'original',
    });
  });

  it('bounds deeply nested causes and long messages', () => {
    let cause = new Error('root');
    for (let i = 0; i < 20; i++) {
      cause = new Error('x'.repeat(10000), { cause });
    }
    const serialized = JSON.stringify(recordThrown(cause).error);
    expect(serialized).toContain('[Truncated]');
    expect(serialized).toContain('[truncated]');
    expect(serialized.length).toBeLessThan(100000);
  });

  it('retains primitive rejection reasons', () => {
    expect(recordThrown('missing component').error).toBe('missing component');
  });
});
