"""Serve real app hosts with isolated storage and temporary browser diagnostics.

Use an unused port. Never use this server as a deployment server.
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8945)
    parser.add_argument('--project', type=Path, default=Path('/tmp/nest-realistic-large.nest.json'))
    parser.add_argument('--graph-source', type=Path, help='optional GraphView.js from a comparison revision')
    parser.add_argument('--no-store', action='store_true', help='match serve.py development cache policy')
    args = parser.parse_args()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store' if args.no_store else 'max-age=0')
            super().end_headers()

        def content(self, text, mime='text/html'):
            data = text.encode()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == '/__qa__/project.json':
                if not args.project.is_file():
                    self.send_error(503, 'Generate the benchmark project first')
                    return
                self.content(args.project.read_text(), 'application/json')
            elif url.path == '/away.html':
                self.content('<!doctype html><title>Navigation checkpoint</title><h1>Navigation checkpoint</h1><p>Use browser Back, then Forward.</p><a href="/editor.html">Studio</a><a href="/player.html">Player</a>')
            elif url.path in ('/editor.html', '/player.html'):
                name = url.path[1:]
                source = (ROOT / name).read_text()
                module = 'editor' if name == 'editor.html' else 'player'
                source = source.replace('src="./studio/', 'src="studio/')
                entry = f'<script type="module" src="studio/{module}.js"></script>'
                if entry not in source:
                    self.send_error(500, 'App entry module changed; update the diagnostic injection')
                    return
                source = source.replace(entry,
                    f'<script type="module">import {{installBrowserBenchmark}} from "/tests/fixtures/browser-benchmark.js";const qa=await installBrowserBenchmark();await import("/studio/{module}.js");qa.ready();</script>')
                self.content(source)
            elif url.path == '/studio/GraphView.js' and args.graph_source:
                self.content(args.graph_source.read_text(), 'text/javascript')
            elif url.path == '/studio/editor.js':
                source = (ROOT / 'studio/editor.js').read_text()
                source = source.replace('import { transactDocument }', 'import { transactDocument as originalTransactDocument }')
                source = source.replace('const $=s=>', "const transactDocument=(...args)=>window.__nestQA.measure('transaction.total',()=>originalTransactDocument(...args));\nconst $=s=>")
                source = source.replace('const saveProject=project=>persistence.save(project);', "const saveProject=project=>window.__nestQA.measure('save.total',()=>persistence.save(project));")
                self.content(source, 'text/javascript')
            else:
                super().do_GET()

    print(f'Browser QA: http://127.0.0.1:{args.port}/editor.html?fixture=small', flush=True)
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
