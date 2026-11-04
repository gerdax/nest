"""Serve the player, chapter editor and dice tool without caching modules."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlsplit

from image_catalog import IMAGE_SUFFIXES, image_manifest_bytes, legacy_image_source
from project_file_store import InvalidProject, MAX_PROJECT_BYTES, ProjectFileStore
from runtime_catalog import DEBUG_ONLY_FILES, DICE_DIR, DICE_LICENSE, DICE_SUFFIXES, RUNTIME_FILES, RUNTIME_MODULE_DIRS


def public_file(path):
    parts, suffix = path.parts, path.suffix.lower()
    if not parts or any(part.startswith('.') for part in parts):
        return False
    name = path.as_posix()
    if name.casefold() in DEBUG_ONLY_FILES:
        return False
    if name in RUNTIME_FILES or name == 'dice.html':
        return True
    if parts[0] in RUNTIME_MODULE_DIRS and len(parts) == 2:
        return suffix in {'.js', '.css'}
    if parts[:2] == ('assets', 'img'):
        return suffix in IMAGE_SUFFIXES or (parts[:4] == ('assets', 'img', 'player-ui', 'fonts') and suffix == '.ttf')
    if parts[:2] == ('assets', 'fonts'):
        return suffix == '.ttf'
    if name.startswith(DICE_DIR + '/'):
        return name == f'{DICE_DIR}/{DICE_LICENSE}' or suffix in DICE_SUFFIXES
    # Browser-facing developer fixtures use the same local server as the app.
    return parts[:2] == ('tests', 'fixtures') and suffix in {'.html', '.js', '.css', '.json'}


def is_storage_path(candidate, directory):
    if candidate.is_relative_to(directory):
        return True
    # On case-insensitive or normalization-insensitive volumes, a different
    # spelling can still name the same directory.
    ancestor = Path(*candidate.parts[:len(directory.parts)])
    try:
        return ancestor.samefile(directory)
    except FileNotFoundError:
        return False


class PlaygroundHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, project_dir=None, **kwargs):
        root = Path(kwargs.get('directory') or '.').resolve()
        kwargs['directory'] = str(root)
        self.project_store = ProjectFileStore(project_dir or root / 'saved-projects')
        super().__init__(*args, **kwargs)

    def _json(self, status, value, head=False):
        content = json.dumps(value, ensure_ascii=True).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        if not head:
            self.wfile.write(content)

    @staticmethod
    def _authority(value):
        parsed = urlsplit('//' + value)
        if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('Invalid host')
        host = parsed.hostname
        if host != 'localhost':
            ipaddress.ip_address(host)
        return host, parsed.port or 80

    def _allowed_request(self):
        try:
            hosts = self.headers.get_all('Host', [])
            if len(hosts) != 1:
                raise ValueError('One Host header required')
            authority = self._authority(hosts[0])
            origins = self.headers.get_all('Origin', [])
            if origins:
                if len(origins) != 1:
                    raise ValueError('One Origin header required')
                origin = urlsplit(origins[0])
                if origin.scheme != 'http' or origin.path or origin.query or origin.fragment:
                    raise ValueError('Invalid Origin')
                if self._authority(origin.netloc) != authority:
                    raise ValueError('Cross-origin request denied')
            return True
        except (ValueError, TypeError):
            self._json(403, {'error': 'Request host or origin denied'})
            return False

    def _selected_store(self):
        query = urlsplit(self.path).query
        if not query:
            return self.project_store
        if re.search(r'%(?![0-9A-Fa-f]{2})', query):
            raise InvalidProject('Invalid query encoding')
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True, errors='strict')
        if not pairs:
            return self.project_store
        if len(pairs) != 1 or pairs[0][0] != 'file':
            raise InvalidProject('Expected one file query parameter')
        return ProjectFileStore(self.project_store.directory, pairs[0][1])

    def _get_project_api(self, head=False):
        route = urlsplit(self.path)
        if route.path not in ('/api/project', '/api/projects'):
            return False
        if self._allowed_request():
            try:
                if route.path == '/api/projects':
                    if route.query:
                        raise InvalidProject('Project listing takes no query parameters')
                    result = self.project_store.list_projects()
                else:
                    result = self._selected_store().read()
                self._json(200, result, head=head)
            except (InvalidProject, ValueError, UnicodeError):
                self._json(400, {'error': 'Invalid project selection or project file'}, head=head)
            except OSError:
                self._json(500, {'error': 'Unable to read project file'}, head=head)
        return True

    def do_GET(self):
        if not self._get_project_api():
            super().do_GET()

    def do_HEAD(self):
        if not self._get_project_api(head=True):
            super().do_HEAD()

    def do_POST(self):
        if urlsplit(self.path).path != '/api/project':
            self._json(404, {'error': 'Unknown endpoint'})
            return
        if not self._allowed_request():
            return
        if self.headers.get_content_type() != 'application/json':
            self._json(415, {'error': 'Content-Type must be application/json'})
            return
        try:
            store = self._selected_store()
            if self.headers.get('Transfer-Encoding'):
                raise InvalidProject('Transfer-Encoding is unsupported')
            lengths = self.headers.get_all('Content-Length', [])
            if len(lengths) != 1:
                raise InvalidProject('Content-Length is required')
            length = int(lengths[0])
            if length < 0 or length > MAX_PROJECT_BYTES:
                self._json(413, {'error': 'Request exceeds 50 MB'})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise InvalidProject('Incomplete body')
            request = json.loads(body)
            status, result = store.save(request)
            self._json(status, result)
        except (InvalidProject, ValueError, UnicodeError):
            self._json(400, {'error': 'Invalid project save request'})
        except OSError:
            self._json(500, {'error': 'Unable to save project file'})

    def send_head(self):
        root = Path(self.directory)
        if urlsplit(self.path).path == '/assets/image-manifest.json':
            content = image_manifest_bytes(root)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            return BytesIO(content)
        translated = Path(self.translate_path(self.path))
        requested_root = translated == root
        candidate = root / 'index.html' if requested_root else translated
        try:
            resolved = candidate.resolve()
            allowed = (resolved == candidate and resolved.is_relative_to(root)
                       and public_file(resolved.relative_to(root))
                       and not is_storage_path(resolved, self.project_store.directory)
                       and (not requested_root or candidate.is_file())
                       and not candidate.is_dir())
        except (OSError, RuntimeError):
            allowed = False
        if not allowed:
            self.send_error(403, 'Path is outside the public runtime')
            return None
        if not candidate.exists() and (images := root / 'assets' / 'img') in candidate.parents:
            source = legacy_image_source(root, candidate.relative_to(images))
            if source is not None and not is_storage_path(source, self.project_store.directory):
                original_path = self.path
                try:
                    self.path = '/' + quote(source.relative_to(root).as_posix())
                    return super().send_head()
                finally:
                    self.path = original_path
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, 'Directory listings are disabled')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='0.0.0.0',
                        help='interface to listen on (default: all IPv4 interfaces; use 127.0.0.1 for local only)')
    parser.add_argument('--port', type=int, default=8937)
    parser.add_argument('--project-dir', type=Path, help='project storage directory (default: saved-projects beside serve.py)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(PlaygroundHandler, directory=str(root), project_dir=args.project_dir)
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        local_host = '127.0.0.1' if args.host == '0.0.0.0' else args.host
        print(f'nest: http://{local_host}:{server.server_port}/', flush=True)
        if args.host == '0.0.0.0':
            print(f'Wi-Fi: open http://<your-Mac-IP>:{server.server_port}/ on your phone (same network).', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
