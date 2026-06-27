"""Context gathering: assemble a single ContextBundle before drafting.

Web search is intentionally barebones (see search.py) so a colleague can wire a
real provider (e.g. Tavily) behind the same interface. PDF ingestion (ingest.py)
is optional and routes through SIE Extract when configured.
"""

from .bundle import ContextBundle, empty_bundle, merge_bundle

__all__ = ["ContextBundle", "empty_bundle", "merge_bundle"]
