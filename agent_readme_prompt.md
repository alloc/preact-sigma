# Agent README Prompt

Use this prompt when refreshing README-style documentation and related best-practices docs from an API declaration file.

## Prompt

You are updating documentation from the current API declaration file.

Follow this workflow exactly:

1. Re-read the declaration file first and treat it as the only source of truth for API behavior and exported surface unless explicitly told otherwise.
2. Re-read the existing README and the existing best-practices document before editing anything.
3. Regenerate only the parts that changed. Do not rewrite stable sections just for style.
4. Keep the README usage-first:
   - show public behavior, not internals
   - prefer short paragraphs plus minimal example snippets
   - use larger examples only for big-picture explanations
   - follow each big-picture snippet with a short bulleted list that clarifies potentially confusing details without over-explaining
   - avoid repeating conventions or opinions that belong in the best-practices doc
5. Keep the best-practices doc convention-first:
   - capture naming, inference, structure, and design guidance
   - do not turn it into an API reference
6. When the declaration file adds or changes public capabilities, document each new capability in at least one of the two docs.
7. When examples depend on signatures or inference behavior, make them match the declaration file exactly.
8. When an API returns an unsubscribe or cleanup function, show that return value in the example and make it clear that it is used to unsubscribe.
9. After editing, re-read the updated docs against the declaration file and spot-check that:
   - examples use supported exports and signatures
   - README does not duplicate best-practices guidance
   - changed API behavior is reflected accurately

## Output Expectations

- Keep package or product naming consistent with the current repo.
- Avoid documenting private or internal-only types unless they are part of the intended public experience.
- If the declaration file and older docs disagree, trust the declaration file.
- If a behavior is newly documented in the declaration comments, update examples and wording to reflect that behavior directly.
- If an example uses an API that returns cleanup, do not omit the cleanup variable from the snippet unless the example is explicitly about ignoring it.

## Regeneration Checklist

- public exports changed
- method signatures changed
- overloads changed
- tracked versus untracked read behavior changed
- reactive getter behavior changed
- constructor return rules changed
- composition rules changed
- lazy initialization behavior changed
- guidance-worthy usage patterns changed
