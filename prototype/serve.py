"""Serve the playground without caching modules between motion experiments."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PlaygroundHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8937)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    handler = partial(PlaygroundHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Nest: http://127.0.0.1:{args.port}/prototype/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
