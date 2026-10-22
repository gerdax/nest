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
    parser.add_argument("--host", default="0.0.0.0",
                        help="interface to listen on (default: all IPv4 interfaces; use 127.0.0.1 for local only)")
    parser.add_argument("--port", type=int, default=8937)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(PlaygroundHandler, directory=str(root))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        local_host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
        print(f"nest: http://{local_host}:{server.server_port}/", flush=True)
        if args.host == "0.0.0.0":
            print(f"Wi-Fi: open http://<your-Mac-IP>:{server.server_port}/ on your phone (same network).", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
