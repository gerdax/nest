"""Serve the player, chapter editor and dice tool without caching modules."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from image_catalog import image_manifest_bytes


class PlaygroundHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        if urlsplit(self.path).path == "/assets/image-manifest.json":
            from io import BytesIO
            content = image_manifest_bytes(Path(self.directory))
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            return BytesIO(content)
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8937)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(PlaygroundHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"nest: http://127.0.0.1:{args.port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
