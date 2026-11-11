import {
  cancelRecordingTransport,
  startRecordingTransport,
  type TraceSessionOptions,
  uploadRecording,
} from './recordingTransport';
import {
  getRecordingState,
  releaseRecording,
  setGlobalSessionApi,
  startRecording,
  type TraceRecording,
  type TraceRecordingOptions,
  type TraceRecordingState,
} from '@sx/tracing';

export async function recordSession(
  title: string,
  options: TraceRecordingOptions & TraceSessionOptions,
): Promise<TraceRecordingState> {
  if (getRecordingState().isRecording) {
    throw new Error('Tracing is already recording');
  }
  const state = startRecording(options);
  try {
    await startRecordingTransport(title, state, options);
    return state;
  } catch (error) {
    cancelRecordingTransport(state.sessionId!);
    if (getRecordingState().sessionId === state.sessionId) {
      releaseRecording();
    }
    throw error;
  }
}

export async function releaseSession(): Promise<TraceRecording> {
  const recording = releaseRecording();
  await uploadRecording(recording);
  return recording;
}

setGlobalSessionApi({ recordSession, releaseSession });
