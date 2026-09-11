import assert from "node:assert/strict";
import test from "node:test";

import {
  IPHONE_NEXT_SWIPE_EDGE_GUARD_PX,
  IPHONE_NEXT_SWIPE_MAX_DURATION_MS,
  IPHONE_NEXT_SWIPE_MIN_DISTANCE_PX,
  isIPhoneNextQuestionSwipe,
} from "../src/swipe-navigation.js";

const baseSwipe = {
  durationMs: 250,
  endX: 120,
  endY: 420,
  startX: 300,
  startY: 400,
  viewportWidth: 402,
};

test("accepts a central left swipe", () => {
  assert.equal(isIPhoneNextQuestionSwipe(baseSwipe), true);
});

test("keeps Safari edge gestures outside the reader gesture", () => {
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      startX: IPHONE_NEXT_SWIPE_EDGE_GUARD_PX - 1,
      endX: 0,
    }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      startX: baseSwipe.viewportWidth - IPHONE_NEXT_SWIPE_EDGE_GUARD_PX + 1,
      endX: 100,
    }),
    false,
  );
});

test("rejects short, vertical, rightward, and slow gestures", () => {
  assert.equal(
    isIPhoneNextQuestionSwipe({
      ...baseSwipe,
      endX: baseSwipe.startX - IPHONE_NEXT_SWIPE_MIN_DISTANCE_PX + 1,
    }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({ ...baseSwipe, endY: 650 }),
    false,
  );
  assert.equal(
    isIPhoneNextQuestionSwipe({ ...baseSwipe, endX: 380 }),
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
