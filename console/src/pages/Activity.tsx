import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { go, Link } from "../router";
import { Button, Feed, Input, Loading, PageTitle, Panel } from "../ui";

const PAGE = 100;

export function ActivityPage({ query }: { query: URLSearchParams }) {
  const filters = {
    workspace: query.get("workspace") ?? undefined,
    user: query.get("user") ?? undefined,
    search: query.get("search") ?? undefined,
  };
  const [text, setText] = useState(filters.search ?? "");

  const feed = useInfiniteQuery({
    queryKey: ["activity", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.activity({ ...filters, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * PAGE : undefined),
    refetchInterval: 20_000,
  });
  const entries = feed.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <>
      <PageTitle
        aside={
          (filters.workspace || filters.user) && (
            <Link to="/activity" className="text-xs text-info hover:underline">
              Clear filter
            </Link>
          )
        }
      >
        Activity log
      </PageTitle>
      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          go("/activity", { ...filters, search: text.trim() || undefined });
        }}
      >
        <Input
          placeholder="Search actions, items, users or businesses…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      <Panel>
        {feed.isLoading ? (
          <Loading />
        ) : (
          <Feed entries={entries} showBusiness={!filters.workspace} />
        )}
        {feed.hasNextPage && (
          <div className="pt-3 text-center">
            <Button
              size="sm"
              disabled={feed.isFetchingNextPage}
              onClick={() => feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? "loading…" : "Load older"}
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
