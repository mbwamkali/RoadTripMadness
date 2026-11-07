/**
 * The real price of gas, so the game's prices move with it. A weekly job
 * (.github/workflows/gas-price.yml, scripts/update-gas-price.py) saves the
 * U.S. Energy Information Administration's latest national average for
 * regular gasoline to public/data/gas-price.json; the game reads that static
 * file at start-up (no server, and it still works offline with the last copy).
 *
 * The game's prices are set for REFERENCE_USD. Each new trip locks in the
 * level at its start (state.priceLevel), so prices never jump mid-trip, and
 * every cash amount, found or paid, moves together: buying power never changes.
 */

/** The real price the game's base prices were set for: the week of 2 November 2026. */
export const REFERENCE_USD = 4.153;
/** The level never goes past these, whatever the file says. */
export const MIN_LEVEL = 0.5;
export const MAX_LEVEL = 2;

export interface GasPrice {
  usd: number;
  week: string;
}

let current: GasPrice = { usd: REFERENCE_USD, week: "2026-11-02" };

/** The latest real price the game knows. */
export const gasPrice = (): GasPrice => current;

/** Real price ÷ reference price, to two decimals, within MIN_LEVEL..MAX_LEVEL. */
export function levelFor(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 1;
  return (
    Math.round(
      Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, usd / REFERENCE_USD)) * 100,
    ) / 100
  );
}

/** The price level a trip starting now uses. */
export const priceLevelNow = () => levelFor(current.usd);

/** Reads public/data/gas-price.json; keeps the built-in price if it can't. */
export async function loadGasPrice(
  url = `${import.meta.env.BASE_URL}data/gas-price.json`,
): Promise<GasPrice> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (r.ok) {
      const j = (await r.json()) as Partial<GasPrice>;
      if (typeof j.usd === "number" && j.usd > 0)
        current = { usd: j.usd, week: String(j.week ?? "") };
    }
  } catch {
    // Offline or missing: the built-in price stands.
  }
  return current;
}
