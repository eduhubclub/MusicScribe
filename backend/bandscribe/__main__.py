"""CLI / PyInstaller entry: `python -m bandscribe --port 8765`.

Always binds localhost only — refuse 0.0.0.0 / LAN interfaces.
"""
from __future__ import annotations

import argparse
import sys


LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def main(argv: list[str] | None = None) -> None:
    from . import paths

    paths.apply_cache_env()

    parser = argparse.ArgumentParser(prog="music-scribe-helper", description="Music Scribe local helper")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (localhost only)")
    parser.add_argument("--port", type=int, default=8765, help="TCP port")
    args = parser.parse_args(argv)

    host = (args.host or "").strip()
    if host not in LOCAL_HOSTS:
        print(
            f"Refusing to bind host {host!r}: Music Scribe helper must stay on 127.0.0.1 only.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    import uvicorn

    # Import server after cache env is set so model paths resolve correctly.
    uvicorn.run("bandscribe.server:app", host=host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
