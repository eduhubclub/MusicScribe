"""PyInstaller entry point for the Music Scribe localhost helper."""
from __future__ import annotations

import sys
from pathlib import Path

# When frozen, ensure the extracted package tree is importable.
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    root = Path(sys._MEIPASS)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
else:
    repo = Path(__file__).resolve().parents[1]
    backend = repo / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def main() -> None:
    from bandscribe.__main__ import main as run

    run()


if __name__ == "__main__":
    main()
