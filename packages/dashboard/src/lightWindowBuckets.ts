/** Share a light capture window across chart slices without inventing exact call times. */
export function distributeLightWindow(
  window: { at: number; span: number },
  duration: number,
  bucketCount: number,
  add: (index: number, share: number) => void,
) {
  const width = duration / bucketCount;
  if (width <= 0 || window.span <= 0) {
    add(
      Math.max(
        0,
        Math.min(bucketCount - 1, Math.floor(window.at / Math.max(width, 1))),
      ),
      1,
    );
    return;
  }
  const start = Math.max(0, Math.min(duration, window.at));
  const end = Math.max(start, Math.min(duration, window.at + window.span));
  if (end === start) {
    add(Math.max(0, Math.min(bucketCount - 1, Math.floor(start / width))), 1);
    return;
  }
  const first = Math.floor(start / width);
  const last = Math.min(bucketCount - 1, Math.ceil(end / width) - 1);
  for (let index = first; index <= last; index += 1) {
    const overlap =
      Math.min(end, (index + 1) * width) - Math.max(start, index * width);
    if (overlap > 0) {
      add(index, overlap / (end - start));
    }
  }
}

/**
 * Upper bound on timeline marks. Without it a long capture sends one mark per
 * second for every series: four minutes is 240, an hour is 3,600. Past this
 * many the buckets widen instead, so the payload stays bounded and the axis
 * stays readable.
 */
export const MAX_TIMELINE_MARKS = 120;

/** Milliseconds each timeline bucket covers: one second until the cap bites. */
export function bucketWidth(duration: number) {
  const seconds = Math.max(1, Math.ceil(duration / 1_000));
  return seconds <= MAX_TIMELINE_MARKS
    ? 1_000
    : Math.ceil(seconds / MAX_TIMELINE_MARKS) * 1_000;
}

export function oneSecondBuckets(duration: number) {
  const count = Math.max(1, Math.ceil(duration / bucketWidth(duration)));
  return Array<number>(count).fill(0);
}

export function secondIndex(
  at: number,
  count: number,
  // Callers that predate the cap pass no duration; below the cap a bucket is
  // one second, so this matches what they already assumed.
  duration = count * 1_000,
) {
  const width = bucketWidth(duration);
  return Math.max(0, Math.min(count - 1, Math.floor(at / width)));
}

export function lightWindowCrossesSecond(
  window: { at: number; span: number },
  duration: number,
) {
  const width = bucketWidth(duration);
  const start = Math.max(0, Math.min(duration, window.at));
  const end = Math.max(start, Math.min(duration, window.at + window.span));
  return Math.ceil(end / width) > Math.floor(start / width) + 1;
}

export function distributeLightWindowBySecond(
  window: { at: number; span: number },
  duration: number,
  add: (index: number, share: number) => void,
) {
  const width = bucketWidth(duration);
  const count = Math.max(1, Math.ceil(duration / width));
  const start = Math.max(0, Math.min(duration, window.at));
  const end = Math.max(start, Math.min(duration, window.at + window.span));
  if (end === start) {
    add(secondIndex(start, count, duration), 1);
    return;
  }
  const first = secondIndex(start, count, duration);
  const last = Math.min(count - 1, Math.ceil(end / width) - 1);
  for (let index = first; index <= last; index += 1) {
    const overlap =
      Math.min(end, (index + 1) * width) - Math.max(start, index * width);
    if (overlap > 0) {
      add(index, overlap / (end - start));
    }
  }
}
