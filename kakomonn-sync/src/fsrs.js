import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

export const MASTERY_STABILITY_DAYS = 30;
const scheduler = fsrs({ enable_fuzz: false });

export function ratingForResult(result) {
  if (result === "correct") {
    return Rating.Good;
  }
  if (result === "incorrect") {
    return Rating.Again;
  }
  throw new TypeError("invalid answer result");
}

export function masteryDelta(previousStability, resultingStability) {
  const before = previousStability >= MASTERY_STABILITY_DAYS;
  const after = resultingStability >= MASTERY_STABILITY_DAYS;
  return before === after ? 0 : after ? 1 : -1;
}

export function createNewCard(nowMs) {
  return createEmptyCard(new Date(nowMs));
}

export function scheduleAnswer(card, result, nowMs) {
  return scheduler.next(card, new Date(nowMs), ratingForResult(result)).card;
}
