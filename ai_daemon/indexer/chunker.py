from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class Chunk: heading_path: str; raw_content: str; chunk_index: int

def chunk_markdown(content: str, max_chars: int = 4_000) -> list[Chunk]:
    headings: list[str] = []; sections: list[tuple[str, list[str]]] = [("", [])]; in_fence = False
    for line in content.splitlines(keepends=True):
        if line.lstrip().startswith("```"): in_fence = not in_fence
        stripped = line.lstrip()
        if not in_fence and stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            if 1 <= level <= 6 and stripped[level:].startswith(" "):
                headings = headings[:level - 1] + [stripped[level:].strip()]; sections.append((" > ".join(headings), [line])); continue
        sections[-1][1].append(line)
    chunks: list[Chunk] = []
    for heading, lines in sections:
        text = "".join(lines).strip()
        if not text: continue
        for piece in split_large(text, max_chars): chunks.append(Chunk(heading, piece, len(chunks)))
    return chunks

def split_large(text: str, limit: int) -> list[str]:
    if len(text) <= limit: return [text]
    paragraphs = text.split("\n\n"); result: list[str] = []; current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > limit: result.append(current); current = paragraph
        else: current = f"{current}\n\n{paragraph}" if current else paragraph
    if current: result.append(current)
    return result
