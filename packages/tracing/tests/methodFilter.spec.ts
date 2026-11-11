// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  releaseRecording,
  startRecording,
  trace,
  type TraceRecordingOptions,
} from '../src';

// Two shapes that exist in real recordings: a decorated class contributes two
// segments, the composed SDK contributes three.
const fromClass = trace(() => 'class', 'ManifestQuery.setStyles');
const fromSdk = trace(() => 'sdk', 'SDK.builderComponent.setStyles');
const lookalike = trace(() => 'lookalike', 'ManifestQuery.unsetStyles');
const nested = trace(() => 'nested', 'ManifestQuery.setStylesInternal');

function recordWith(methods: TraceRecordingOptions['methods']): string[] {
  startRecording({ cpu: false, methods });
  fromClass();
  fromSdk();
  lookalike();
  nested();
  return releaseRecording()
    .traces.flatMap(({ events }) => events.map(({ name }) => name))
    .sort();
}

describe('the methods filter', () => {
  it('matches the full identity including the namespace', () => {
    expect(
      recordWith(['editor-platform.SDK.builderComponent.setStyles']),
    ).toEqual(['SDK.builderComponent.setStyles']);
  });

  it('matches the recorded name in any namespace', () => {
    expect(recordWith(['SDK.builderComponent.setStyles'])).toEqual([
      'SDK.builderComponent.setStyles',
    ]);
  });

  it('does not match a partial path', () => {
    // name is 'SDK.builderComponent.setStyles'; dropping a leading segment is
    // not the same function, so a dotted entry has to spell it out.
    expect(recordWith(['builderComponent.setStyles'])).toEqual([]);
  });

  it('searches anywhere in the name for an entry with no dot', () => {
    // A bare entry is a plain substring search, so it reaches more than the
    // exact method: setStylesInternal extends it, and unsetStyles contains it.
    // Spell the path out when that is not wanted.
    expect(recordWith(['setStyles'])).toEqual([
      'ManifestQuery.setStyles',
      'ManifestQuery.setStylesInternal',
      'ManifestQuery.unsetStyles',
      'SDK.builderComponent.setStyles',
    ]);
  });

  it('searches on a partial segment too', () => {
    expect(recordWith(['Styles'])).toEqual([
      'ManifestQuery.setStyles',
      'ManifestQuery.setStylesInternal',
      'ManifestQuery.unsetStyles',
      'SDK.builderComponent.setStyles',
    ]);
  });

  it('treats a dotted entry as a path, not a search term', () => {
    // 'setSty' would hit as a bare term, but inside a path every segment has
    // to line up, so a partial one matches nothing.
    expect(recordWith(['builderComponent.setSty'])).toEqual([]);
    expect(recordWith(['Component.setStyles'])).toEqual([]);
  });

  it('records everything when no filter is given', () => {
    expect(recordWith(undefined)).toHaveLength(4);
  });

  it('accepts several entries', () => {
    expect(
      recordWith([
        'ManifestQuery.unsetStyles',
        'SDK.builderComponent.setStyles',
      ]),
    ).toEqual(['ManifestQuery.unsetStyles', 'SDK.builderComponent.setStyles']);
  });

  it('mixes a path and a search term', () => {
    expect(recordWith(['SDK.builderComponent.setStyles', 'unset'])).toEqual([
      'ManifestQuery.unsetStyles',
      'SDK.builderComponent.setStyles',
    ]);
  });
});
