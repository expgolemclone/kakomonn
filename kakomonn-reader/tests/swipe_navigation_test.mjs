import assert from "node:assert/strict";
import test from "node:test";

import {
  IPHONE_NEXT_SWIPE_EDGE_GUARD_RATIO,
  IPHONE_NEXT_SWIPE_MAX_DURATION_MS,
  IPHONE_NEXT_SWIPE_MIN_DISTANCE_RATIO,
  isIPhoneNextQuestionSwipe,
} from "../src/swipe-navigation.mjs";

function swipeForWidth(viewportWidth) {
  return {
    durationMs: 250,
    endX: viewportWidth * 0.25,
    endY: 420,
    startX: viewportWidth * 0.75,
    startY: 400,
    viewportWidth,
  };
}

for (const viewportWidth of [320, 402, 430, 768]) {
  test(`accepts a central left swipe at ${viewportWidth}px viewport width`, () => {
    assert.equal(isIPhoneNextQuestionSwipe(swipeForWidth(viewportWidth)), true);
  });
}

test("keeps Safari edge gestures outside the reader gesture by viewport ratio", () => {
  const baseSwipe = swipeForWidth(402);
  const edgeGuard = baseSwipe.viewportWidth * IPHONE_NEXT_SWIPE_EDGE_GUARD_RATIO;
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      startX: edgeGuard * 0.99,
      endX: 0,
    }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      startX: baseSwipe.viewportWidth - edgeGuard * 0.99,
      endX: baseSwipe.viewportWidth * 0.25,
    }),
    false,
  );
});

test("uses viewport-relative minimum distance", () => {
  for (const viewportWidth of [320, 402, 768]) {
    const baseSwipe = swipeForWidth(viewportWidth);
    const minimumDistance =
      viewportWidth * IPHONE_NEXT_SWIPE_MIN_DISTANCE_RATIO;
    assert.equal(
      isIPhoneNextQuestionSwipe({
        ...baseSwipe,
        endX: baseSwipe.startX - minimumDistance * 0.99,
      }),
      false,
    );
    assert.equal(
      isIPhoneNextQuestionSwipe({
        ...baseSwipe,
        endX: baseSwipe.startX - minimumDistance,
      }),
      true,
    );
  }
});

test("rejects vertical, rightward, and slow gestures", () => {
  const baseSwipe = swipeForWidth(402);
  assert.equal(
    isIPhoneNextQuestionSwipe({ ...baseSwipe, endY: 650 }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      endX: baseSwipe.viewportWidth * 0.9,
    }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      durationMs: IPHONE_NEXT_SWIPE_MAX_DURATION_MS + 1,
    }),
    false,
  );
});
