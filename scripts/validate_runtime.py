"""Fail-fast verification for the controlled macOS arm64 RAG runtime."""
from __future__ import annotations
import platform
import sqlite3
import sys

def require(condition: bool, message: str) -> None:
    if not condition: raise RuntimeError(message)

def main() -> None:
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    require(sys.version_info[:2] == (3, 12), "Python 3.12 is required")
    print(f"Architecture: {platform.machine()}")
    require(platform.machine() == "arm64", "Phase A requires an arm64 runtime")
    connection = sqlite3.connect(":memory:")
    try:
        print(f"SQLite: {sqlite3.sqlite_version}")
        compile_options = {row[0] for row in connection.execute("PRAGMA compile_options")}
        connection.execute("CREATE VIRTUAL TABLE fts_probe USING fts5(content)")
        print("FTS5: PASS")
        require(hasattr(connection, "enable_load_extension"), "SQLite extension loading is unavailable in this Python runtime")
        connection.enable_load_extension(True)
        print("ENABLE_LOAD_EXTENSION: PASS")
        import sqlite_vec
        sqlite_vec.load(connection)
        connection.enable_load_extension(False)
        version = connection.execute("SELECT vec_version()").fetchone()[0]
        print(f"sqlite-vec: {version}")
        connection.execute("CREATE VIRTUAL TABLE vec_probe USING vec0(embedding float[3])")
        print("vec0 creation: PASS")
        connection.execute("INSERT INTO vec_probe(rowid, embedding) VALUES (?, ?)", (1, "[1.0, 0.0, 0.0]"))
        connection.execute("INSERT INTO vec_probe(rowid, embedding) VALUES (?, ?)", (2, "[0.0, 1.0, 0.0]"))
        print("vector insertion: PASS")
        row = connection.execute("SELECT rowid, distance FROM vec_probe WHERE embedding MATCH ? AND k = 1", ("[0.9, 0.1, 0.0]",)).fetchone()
        require(row and row[0] == 1, f"vector search returned unexpected result: {row}")
        print("vector search: PASS")
        print("RUNTIME VALIDATION: PASS")
    finally: connection.close()

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(f"RUNTIME VALIDATION: FAIL — {error}", file=sys.stderr)
        raise SystemExit(1)
