"""Shared test helpers."""
from __future__ import annotations
import sqlite3


def vector_extension_available() -> bool:
    """True only on an extension-capable Python (e.g. ai_daemon/.runtime/arm64), matching
    JournalDatabase._load_vector_extension's own checks."""
    try:
        import sqlite_vec  # noqa: F401
    except ImportError:
        return False
    connection = sqlite3.connect(":memory:")
    try:
        connection.enable_load_extension(True)
        return True
    except AttributeError:
        return False
    finally:
        connection.close()
