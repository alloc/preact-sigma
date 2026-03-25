# API Description Preferences

- Keep public API descriptions factual and behavioral. Move prescriptive advice and conventions to a separate best-practices document.
- State clearly where type inference comes from when that affects how the API should be written or consumed.
- Describe callbacks by what they receive, not by what they do not receive.
- When a returned value becomes a public reactive property, say that explicitly.
- Call out especially useful behavior when it clarifies intent, particularly for nested or non-obvious use cases.
- Keep AI-specific authoring conventions, naming guidance, and other best-practice material out of the public API surface.
