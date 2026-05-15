import type { FunctionComponent } from "preact";

import { Sigma, useSigma, useSigmaSync } from "preact-sigma";

type SearchResult = {
  id: string;
  title: string;
};

type SearchResultsState = {
  query: string;
  results: readonly SearchResult[];
};

class SearchResults extends Sigma<SearchResultsState> {
  constructor(query: string, results: readonly SearchResult[]) {
    super({
      query,
      results,
    });
  }

  syncExternalQuery(query: string, results: readonly SearchResult[]) {
    this.query = query;
    this.results = results;
  }
}

interface SearchResults extends SearchResultsState {}

export const ExternalQuerySyncExample: FunctionComponent<{
  query: string;
  results: readonly SearchResult[];
}> = ({ query, results }) => {
  const search = useSigma(() => new SearchResults(query, results));

  useSigmaSync(search, { query, results }, ({ query, results }) => {
    search.syncExternalQuery(query, results);
  });

  return (
    <section>
      <h2>Results for {search.query || "everything"}</h2>
      <ul>
        {search.results.map((result) => (
          <li key={result.id}>{result.title}</li>
        ))}
      </ul>
    </section>
  );
};
