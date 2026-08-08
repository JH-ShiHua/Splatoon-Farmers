"""Serve the controller UI locally without browser caching."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parents[1] / "web"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=str(WEB_ROOT))
    ThreadingHTTPServer(("127.0.0.1", 4173), handler).serve_forever()
