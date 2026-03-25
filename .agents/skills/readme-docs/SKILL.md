---
name: readme-docs
description: Refresh README-style documentation, llms.txt, and best-practices docs from the current API declaration file or primary public API source.
---

# README Docs

Use this skill when updating a library or product README from an API declaration file or other primary public API source.

## Workflow

1. Re-read the current declaration file or primary public API documentation first. Treat it as the source of truth for exported surface and documented behavior unless the task says otherwise.
2. Re-read the existing `README`, `llms.txt`, and any existing best-practices or conventions document before editing.
3. Regenerate only the sections that actually changed. Do not rewrite stable sections for style alone.
4. Keep the `README` usage-first:
   - focus on public behavior, not internals
   - prefer short paragraphs and minimal snippets
   - reserve larger examples for big-picture explanations
   - follow big-picture examples with a short bullet list when that clarifies non-obvious behavior
5. Keep the best-practices document convention-first:
   - capture naming, inference, structure, and design guidance
   - do not turn it into an API reference
6. Keep `llms.txt` precise and exhaustive:
   - start with a glossary for repo-specific terminology
   - cover concepts, supported features, and best practices without ambiguity
   - update it whenever README changes reflect public-surface changes
7. When public capabilities, signatures, overloads, tracked behavior, reactive getter behavior, constructor rules, composition rules, lazy initialization behavior, or guidance-worthy usage patterns change, update the affected docs to match.
8. When examples depend on signatures, inference, or cleanup behavior, make them match the source exactly.
9. When an API returns an unsubscribe or cleanup function, show that return value in the example unless the example is explicitly about ignoring it.
10. After editing, reread the updated docs against the source and spot-check that:
    - examples use supported exports and signatures
    - the `README` does not duplicate best-practices guidance
    - changed behavior is documented accurately
    - `llms.txt` matches the current surface and doc guidance

## Writing Guidance

- Prefer the primary public API source over older prose when they disagree.
- Keep the `README` aligned with the latest published API description.
- Focus on the public surface, not private abstractions or incidental structure.
- Avoid repeating guidance that already belongs in a dedicated best-practices document.
- Prefer showing behavior through examples over describing it abstractly.
- Give each major concept its own short paragraph and example.
- Keep snippets minimal by default.
- Keep naming consistent with the current repo or package.
- Avoid documenting private or internal-only types unless they are part of the intended public experience.
