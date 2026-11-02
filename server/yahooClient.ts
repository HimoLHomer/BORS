import YahooFinance from "yahoo-finance2";
import { ExtendedCookieJar } from "yahoo-finance2/lib/cookieJar";
import { getCrumbClear } from "yahoo-finance2/lib/getCrumb";

const cookieJar = new ExtendedCookieJar();

/**
 * yahoo-finance2 memoizes its crumb request in a module-level promise and only
 * clears it on success. If the first crumb fetch fails (app started offline),
 * every later request re-throws that same stale error until the process restarts.
 * Clearing the crumb state makes the next request fetch a fresh session.
 */
export async function resetYahooSession(): Promise<void> {
  await getCrumbClear(cookieJar);
}

// Requests made while acquiring the crumb/cookie session.
const CRUMB_FLOW_URL = /finance\.yahoo\.com\/quote\/|\/v1\/test\/getcrumb|guce\.yahoo\.com|consent\.yahoo\.com/;

const sessionAwareFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isCrumbFlow = CRUMB_FLOW_URL.test(url);
  try {
    const res = await globalThis.fetch(input, init);
    if (isCrumbFlow && url.includes("/getcrumb") && res.status !== 200) void resetYahooSession();
    return res;
  } catch (error) {
    if (isCrumbFlow) void resetYahooSession();
    throw error;
  }
};

export const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  cookieJar,
  fetch: sessionAwareFetch,
});
