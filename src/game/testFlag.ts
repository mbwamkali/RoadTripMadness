/**
 * Set while a test trip is running (src/game/testTrip.ts, opened with ?test=...).
 * A test trip never writes the saved trip, high scores, career or ride choice,
 * because the preview build shares those with the live game.
 */
export const testing = {
  on: false,
  /** ?tough=1: the car takes no damage, so you can look around a fight. */
  tough: false,
};
