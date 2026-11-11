import * as implementation from './transport';

export type * from './transport';
const key = Symbol.for('@sx/tracing/transport/v2');
const registry = globalThis as typeof globalThis & {
  [key]?: typeof implementation;
};
const transport = (registry[key] ??= implementation);
export const startRecordingTransport: typeof implementation.startRecordingTransport =
  transport.startRecordingTransport;
export const cancelRecordingTransport: typeof implementation.cancelRecordingTransport =
  transport.cancelRecordingTransport;
export const hasRecordingTransport: typeof implementation.hasRecordingTransport =
  transport.hasRecordingTransport;
export const uploadRecording: typeof implementation.uploadRecording =
  transport.uploadRecording;
