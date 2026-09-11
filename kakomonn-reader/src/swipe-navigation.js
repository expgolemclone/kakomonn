export const IPHONE_NEXT_SWIPE_EDGE_GUARD_PX = 60;
export const IPHONE_NEXT_SWIPE_MIN_DISTANCE_PX = 96;
export const IPHONE_NEXT_SWIPE_MAX_DURATION_MS = 900;
export const IPHONE_NEXT_SWIPE_HORIZONTAL_RATIO = 1.5;

export function isIPhoneNextQuestionSwipe({
  durationMs,
  endX,
  endY,
  startX,
  startY,
  viewportWidth,
}) {
  const values = [durationMs, endX, endY, startX, startY, viewportWidth];
  if (!values.every(Number.isFinite)) {
    return false;
  }
  if (
    viewportWidth <= IPHONE_NEXT_SWIPE_EDGE_GUARD_PX * 2 ||
    startX < IPHONE_NEXT_SWIPE_EDGE_GUARD_PX ||
    startX > viewportWidth - IPHONE_NEXT_SWIPE_EDGE_GUARD_PX ||
    durationMs < 0 ||
    durationMs > IPHONE_NEXT_SWIPE_MAX_DURATION_MS
  ) {
    return false;
  }

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  return (
    deltaX <= -IPHONE_NEXT_SWIPE_MIN_DISTANCE_PX &&
    Math.abs(deltaX) >= Math.abs(deltaY) * IPHONE_NEXT_SWIPE_HORIZONTAL_RATIO
  );
}
