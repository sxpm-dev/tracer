import { useDashboard } from './extensions';

export function useTimelineRange() {
  const { navigation, recording, traceDataExcluded } = useDashboard();
  const view = navigation?.state;
  const range: [number, number] | undefined =
    view?.from === undefined
      ? undefined
      : [view.from, view.to ?? recording.duration];
  const selectRange = (value: [number, number]) =>
    navigation?.onChange({
      ...navigation.state,
      frameOffset: 0,
      from: value[0],
      to: value[1],
    });
  return {
    range: traceDataExcluded ? undefined : range,
    selectRange: traceDataExcluded ? undefined : selectRange,
  };
}
