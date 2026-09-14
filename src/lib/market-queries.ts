import { useQuery } from "@tanstack/react-query";
import { loadMarket } from "@/lib/market.functions";
import type { MarketReport } from "@/lib/market-types";

/** Progressive market load: Spot first, then full report with futures. */
export function useMarketReport(start: string, end: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const spotQuery = useQuery({
    queryKey: ["market", start, end, "spot"],
    queryFn: () =>
      loadMarket({
        data: { startDate: start, endDate: end, phase: "spot" },
      }),
    staleTime: 5 * 60_000,
    enabled,
  });
  const fullQuery = useQuery({
    queryKey: ["market", start, end, "full"],
    queryFn: () =>
      loadMarket({
        data: { startDate: start, endDate: end, phase: "full" },
      }),
    staleTime: 5 * 60_000,
    enabled,
  });

  const report = (fullQuery.data ?? spotQuery.data) as MarketReport | undefined;
  return {
    report,
    isLoading: spotQuery.isLoading && !report,
    isFetching: spotQuery.isFetching || fullQuery.isFetching,
    isError: fullQuery.isError && spotQuery.isError,
    error: fullQuery.error ?? spotQuery.error,
    loadingFutures: Boolean(spotQuery.data && fullQuery.isFetching),
  };
}
