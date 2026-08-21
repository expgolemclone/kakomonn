import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

const scheduler = fsrs({ enable_fuzz: false });

export function ratingForResult(result) {
  if (result === "correct") {
    return Rating.Easy;
  }
  if (result === "incorrect") {
    return Rating.Again;
  }
  throw new TypeError("invalid answer result");
}

export function createNewCard(nowMs) {
  return createEmptyCard(new Date(nowMs));
}

export function scheduleAnswer(card, result, nowMs) {
  return scheduler.next(card, new Date(nowMs), ratingForResult(result)).card;
}

export function scheduleRating(card, rating, nowMs) {
  return scheduler.next(card, new Date(nowMs), rating).card;
}
