from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Iterator, MutableMapping


class SessionStore(MutableMapping[str, dict[str, object]]):
    """Thread-safe bounded in-memory session store with LRU eviction."""

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._items: OrderedDict[str, dict[str, object]] = OrderedDict()
        self.lock = threading.RLock()

    def __getitem__(self, key: str) -> dict[str, object]:
        with self.lock:
            value = self._items[key]
            self._items.move_to_end(key)
            return value

    def __setitem__(self, key: str, value: dict[str, object]) -> None:
        with self.lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self._limit:
                self._items.popitem(last=False)

    def __delitem__(self, key: str) -> None:
        with self.lock:
            del self._items[key]

    def __iter__(self) -> Iterator[str]:
        with self.lock:
            return iter(tuple(self._items))

    def __len__(self) -> int:
        with self.lock:
            return len(self._items)

    def get(self, key: str, default: dict[str, object] | None = None) -> dict[str, object] | None:
        try:
            return self[key]
        except KeyError:
            return default

    def clear(self) -> None:
        with self.lock:
            self._items.clear()
