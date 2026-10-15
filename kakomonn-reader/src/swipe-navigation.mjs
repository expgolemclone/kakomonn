export const IPHONE_NEXT_SWIPE_EDGE_GUARD_RATIO = 0.15;
export const IPHONE_NEXT_SWIPE_MIN_DISTANCE_RATIO = 0.24;
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
  if (!values.every(Number.isFinite) || viewportWidth <= 0) {
    return false;
  }

  const edgeGuard = viewportWidth * IPHONE_NEXT_SWIPE_EDGE_GUARD_RATIO;
  const minimumDistance = viewportWidth * IPHONE_NEXT_SWIPE_MIN_DISTANCE_RATIO;
  if (
    startX < edgeGuard ||
    startX > viewportWidth - edgeGuard ||
    durationMs < 0 ||
    durationMs > IPHONE_NEXT_SWIPE_MAX_DURATION_MS
  ) {
    return false;
  }

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  return (
    deltaX <= -minimumDistance &&
    Math.abs(deltaX) >= Math.abs(deltaY) * IPHONE_NEXT_SWIPE_HORIZONTAL_RATIO
  );
}
