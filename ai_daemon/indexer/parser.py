from __future__ import annotations
import os, tempfile, uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

@dataclass(frozen=True)
class ParsedEntry: id: str; created_at: str; content: str

def parse_or_adopt(path: Path) -> ParsedEntry:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        entry = ParsedEntry(str(uuid.uuid4()), datetime.now(UTC).isoformat(), raw)
        atomic_write(path, render(entry)); return entry
    try: header, content = raw[4:].split("\n---\n", 1)
    except ValueError as error: raise ValueError("unterminated frontmatter") from error
    values = dict(line.split(":", 1) for line in header.splitlines() if ":" in line)
    entry_id, created_at = values.get("id", "").strip(), values.get("created_at", "").strip()
    uuid.UUID(entry_id); datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return ParsedEntry(entry_id, created_at, content)

def render(entry: ParsedEntry) -> str: return f"---\nid: {entry.id}\ncreated_at: {entry.created_at}\n---\n{entry.content}"
def atomic_write(path: Path, content: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file: file.write(content); file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True); raise
