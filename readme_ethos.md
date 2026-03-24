# README Ethos

This file captures general guidance for writing product or library READMEs.

## Source Discipline

- When writing or rewriting a README from an API surface, prefer the API definition or primary interface documentation as the source of truth.
- If documentation work is intentionally constrained to a specific source, do not pull in extra context from unrelated files.
- If something is unclear from the allowed source, make educated guesses instead of inventing unsupported details.
- When API documentation changes, reread the updated source and refresh the README to match the new understanding.
- Keep the README aligned with the latest published API description.

## Scope

- Focus the README on the public surface, not internal implementation details.
- Avoid documenting internal types, private abstractions, or incidental structure unless they are part of the intended user experience.
- Avoid repeating guidance that already exists in dedicated best-practices or style documents.

## Style

- Prefer "show" over "tell".
- When introducing a concept, give it its own short paragraph and its own example snippet.
- Keep snippets minimal by default.
- Reserve larger snippets for big-picture, end-to-end examples.
