from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    host = os.environ.get("UI_HOST", "127.0.0.1")
    port = int(os.environ.get("UI_PORT", "8766"))
    server = ThreadingHTTPServer((host, port), NoCacheHandler)
    print(f"Serving UI on http://{host}:{port}/")
    server.serve_forever()
