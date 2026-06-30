# Common Patterns

## Skeleton Projects

When implementing new functionality:
1. Search for battle-tested skeleton projects
2. Use parallel agents to evaluate options:
   - Security assessment
   - Extensibility analysis
   - Relevance scoring
   - Implementation planning
3. Clone best match as foundation
4. Iterate within proven structure

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:
- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:
- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)

### Data Model Rules (added 2026-06-30)

- Engine-specific parameters use discriminated union types (`EngineParams`), not flat union with all engines' fields.
- JSON columns store only current-state values; default/inherited values are resolved at read time (not duplicated in storage).
- Data model fields that are derivable from other fields should not be stored (e.g. `project_id` on segment derivable from chapter, `default_engine` derivable from `voice.engine`).
- UI state (like `overrides`, `locked_params`) belongs in component state or derived from data, not in persistent storage.
