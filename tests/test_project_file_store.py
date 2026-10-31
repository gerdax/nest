"""Run with python3 -m unittest discover -s tests -p 'test_project_file_store.py'."""
from concurrent.futures import ProcessPoolExecutor
from functools import partial
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from project_file_store import InvalidProject, ProjectFileStore
from serve import PlaygroundHandler


def project(name='test'):
    return json.dumps({'version': 3, 'kind': 'nest-project', 'library': [], 'chapters': [], 'name': name})


def compete(directory, text):
    return ProjectFileStore(directory).save({'text': text, 'expectedRevision': None})[0]


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = ProjectFileStore(Path(self.temp.name) / 'saved-projects')

    def save(self, text=None, **extra):
        return self.store.save({'text': text or project(), 'expectedRevision': self.store.read()['revision'], **extra})

    def test_initial_and_conflict(self):
        self.assertIsNone(self.store.read()['text'])
        status, saved = self.save()
        self.assertEqual(status, 200)
        self.assertEqual(saved['revision'], hashlib.sha256(project().encode()).hexdigest())
        status, conflict = self.store.save({'text': project('other'), 'expectedRevision': None})
        self.assertEqual(status, 409)
        self.assertTrue(conflict['conflict'])
        self.assertEqual(conflict['text'], project())
        with self.assertRaises(InvalidProject):
            self.store.save({'text': project()})

    def test_identical_save_keeps_file_and_backup_count(self):
        self.save(project('first'))
        _, previous = self.save(project('second'))
        raw = self.store.path.read_bytes()
        metadata = self.store.path.stat()
        backups = sorted(self.store.directory.glob('*.backup.*'))
        with patch('project_file_store.os.replace', side_effect=AssertionError('No replacement expected')):
            with patch.object(self.store, '_backup', side_effect=AssertionError('No backup expected')):
                status, result = self.save(project('second'))
        self.assertEqual(status, 200)
        self.assertIs(result['available'], True)
        self.assertTrue(result['ok'])
        self.assertEqual(result['revision'], previous['revision'])
        self.assertNotIn('backupPath', result)
        self.assertEqual(self.store.path.read_bytes(), raw)
        self.assertEqual(self.store.path.stat().st_mtime_ns, metadata.st_mtime_ns)
        self.assertEqual(self.store.path.stat().st_ino, metadata.st_ino)
        self.assertEqual(sorted(self.store.directory.glob('*.backup.*')), backups)
        # A stale writer still conflicts even if its content matches the file.
        status, result = self.store.save({'text': project('second'), 'expectedRevision': None})
        self.assertEqual(status, 409)
        self.assertTrue(result['conflict'])

    def test_shape_and_size_validation(self):
        for text in ['{}', 'null', '{', json.dumps({'kind': 'nest-project', 'version': 3, 'library': {}, 'chapters': []})]:
            with self.assertRaises(InvalidProject):
                self.save(text)
        with patch('project_file_store.MAX_PROJECT_BYTES', 1):
            with self.assertRaises(InvalidProject):
                self.save()
        self.assertFalse(self.store.path.exists())

    def test_corrupt_prior_file_backed_up_exactly(self):
        self.store.directory.mkdir()
        raw = b'{broken JSON\nwith \xc5\xbc text'
        self.store.path.write_bytes(raw)
        self.assertEqual(self.store.read()['text'].encode(), raw)
        _, result = self.save()
        self.assertEqual((self.store.directory / Path(result['backupPath']).name).read_bytes(), raw)
        _, second = self.save(project('second'))
        self.assertNotEqual(result['backupPath'], second['backupPath'])
        self.assertEqual((self.store.directory / Path(result['backupPath']).name).read_bytes(), raw)

    def test_migration_source_preserved_only_on_first_write(self):
        source = '  {"original": "ż"}\n'
        _, result = self.save(migrationSourceText=source)
        backup = self.store.directory / Path(result['backupPath']).name
        self.assertEqual(backup.read_bytes(), source.encode())
        self.save(project('next'), migrationSourceText='other')
        self.assertEqual(len(list(self.store.directory.glob('*.migration.*'))), 1)
        self.assertEqual(backup.read_bytes(), source.encode())

    def test_failed_backup_or_replace_preserves_current_file(self):
        self.save()
        raw = self.store.path.read_bytes()
        with patch.object(self.store, '_backup', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.save(project('second'))
        self.assertEqual(self.store.path.read_bytes(), raw)
        with patch('project_file_store.os.replace', side_effect=OSError('failure')):
            with self.assertRaises(OSError):
                self.save(project('second'))
        self.assertEqual(self.store.path.read_bytes(), raw)
        self.assertEqual(list(self.store.directory.glob('.project-*')), [])

    def test_existing_backup_name_never_overwritten_or_deleted(self):
        self.save()
        backup = self.store.directory / 'nest-project.backup.fixed.json'
        backup.write_bytes(b'precious original')
        with patch('project_file_store.uuid.uuid4') as identifier:
            identifier.return_value.hex = 'fixed'
            with self.assertRaises(FileExistsError):
                self.save(project('second'))
        self.assertEqual(backup.read_bytes(), b'precious original')
        self.assertEqual(self.store.path.read_text(), project())

    def test_named_files_independent_revisions_and_backups(self):
        first = ProjectFileStore(self.store.directory, 'First project.json')
        second = ProjectFileStore(self.store.directory, 'second.json')
        _, a = first.save({'text': project('first'), 'expectedRevision': None})
        _, b = second.save({'text': project('second'), 'expectedRevision': None})
        self.assertEqual(a['path'], 'saved-projects/First project.json')
        self.assertEqual(b['path'], 'saved-projects/second.json')
        self.assertEqual(first.save({'text': project('new'), 'expectedRevision': None})[0], 409)
        self.assertEqual(second.read()['text'], project('second'))
        status, updated = first.save({'text': project('updated'), 'expectedRevision': a['revision']})
        self.assertEqual(status, 200)
        self.assertTrue(updated['backupPath'].startswith('saved-projects/First project.backup.'))
        self.assertIsNone(self.store.read()['text'])

    def test_filename_validation_and_symlink_rejection(self):
        for name in ['', '../escape.json', 'a/escape.json', r'a\escape.json', '.hidden.json', 'bad..json',
                     'a.backup.old.json', 'a.MIGRATION.old.json', 'pre-migration.json',
                     'nest-before-file-autosave-2026-10-31.json', 'plain.txt', 'x' * 121 + '.json']:
            with self.assertRaises(InvalidProject, msg=name):
                ProjectFileStore(self.store.directory, name)
        self.store.directory.mkdir()
        outside = Path(self.temp.name) / 'outside.json'
        outside.write_text(project('private'))
        link = self.store.directory / 'linked.json'
        link.symlink_to(outside)
        selected = ProjectFileStore(self.store.directory, link.name)
        with self.assertRaises(InvalidProject):
            selected.read()
        with self.assertRaises(InvalidProject):
            selected.save({'text': project('changed'), 'expectedRevision': None})
        self.assertEqual(outside.read_text(), project('private'))
        self.assertTrue(link.is_symlink())

    def test_listing_filters_recovery_files_and_nonregular_entries(self):
        self.assertEqual(self.store.list_projects(), {'available': True, 'files': []})
        self.store.directory.mkdir()
        for name in ['a.json', 'Z project.json', 'nest-project.json', 'a.backup.123.json',
                     'a.migration.123.json', 'nest-before-file-autosave-2026-10-31.json',
                     '.hidden.json', 'pre-migration-copy.json', 'wrong.txt', 'bad..json']:
            (self.store.directory / name).write_text('malformed JSON still lists')
        (self.store.directory / 'directory.json').mkdir()
        (self.store.directory / 'linked.json').symlink_to(self.store.directory / 'a.json')
        listed = self.store.list_projects()
        self.assertIs(listed['available'], True)
        self.assertEqual([item['name'] for item in listed['files']], ['Z project.json', 'a.json', 'nest-project.json'])
        self.assertEqual(listed['files'][1]['path'], 'saved-projects/a.json')

    def test_competing_processes(self):
        with ProcessPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(compete, [str(self.store.directory)] * 2, [project('a'), project('b')]))
        self.assertEqual(sorted(results), [200, 409])
        self.assertIn(json.loads(self.store.read()['text'])['name'], ['a', 'b'])


class QuietHandler(PlaygroundHandler):
    def log_message(self, *args):
        pass


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.storage = self.root / 'custom-storage'
        handler = partial(QuietHandler, directory=str(self.root), project_dir=self.storage)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.host = f'127.0.0.1:{self.server.server_port}'

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method='GET', path='/api/project', data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        try:
            connection.request(method, path, body=data, headers=headers or {})
            response = connection.getresponse()
            body = response.read()
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            self.assertIsNone(response.getheader('Access-Control-Allow-Origin'))
            return response.status, body
        finally:
            connection.close()

    def test_endpoint_save_conflict_and_bad_requests(self):
        self.assertEqual(json.loads(self.request()[1])['text'], None)
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host}
        payload = json.dumps({'text': project(), 'expectedRevision': None})
        status, body = self.request('POST', data=payload, headers=headers)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['ok'])
        self.assertEqual(self.request('POST', data=payload, headers=headers)[0], 409)
        self.assertEqual(self.request('POST', data='{}', headers=headers)[0], 400)
        self.assertEqual(self.request('POST', data=payload, headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('POST', data=payload, headers={'Content-Type': 'application/json', 'Content-Length': str(51 * 1024 * 1024)})[0], 413)

    def test_host_and_origin_guards(self):
        for headers in [{'Host': 'evil.example'}, {'Host': self.host, 'Origin': 'http://evil.example'},
                        {'Origin': 'null'}, {'Origin': 'http://localhost:1234'},
                        {'Origin': 'https://' + self.host}]:
            self.assertEqual(self.request(headers=headers)[0], 403)
        self.assertEqual(self.request(headers={'Host': 'localhost:8937', 'Origin': 'http://localhost:8937'})[0], 200)

    def test_named_http_routes_and_listing(self):
        headers = {'Content-Type': 'application/json'}
        payload = json.dumps({'text': project('named'), 'expectedRevision': None})
        selected = '/api/project?file=My%20project.json'
        self.assertEqual(self.request('POST', path=selected, data=payload, headers=headers)[0], 200)
        status, body = self.request(path=selected)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['path'], 'saved-projects/My project.json')
        self.assertEqual(json.loads(self.request()[1])['text'], None)
        self.assertEqual(self.request('POST', path=selected, data=payload, headers=headers)[0], 409)
        status, body = self.request(path='/api/projects')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'available': True, 'files': [
            {'name': 'My project.json', 'path': 'saved-projects/My project.json'}]})
        self.assertEqual(self.request(path='/api/projects', headers={'Origin': 'http://evil.example'})[0], 403)
        (self.storage / 'linked.json').symlink_to(self.storage / 'My project.json')
        for path in ['/api/project?file=', '/api/project?file=one.json&file=two.json',
                     '/api/project?file=../escape.json', '/api/project?file=a%2Fb.json',
                     '/api/project?file=%ZZ.json', '/api/project?file=%FF.json',
                     '/api/project?file', '/api/project?other=a.json', '/api/project?file=linked.json']:
            self.assertEqual(self.request(path=path)[0], 400, path)
            self.assertEqual(self.request('POST', path=path, data=payload, headers=headers)[0], 400, path)
        self.assertEqual(self.request(path='/api/projects?file=a.json')[0], 400)

    def test_storage_and_listings_not_public(self):
        self.storage.mkdir()
        (self.storage / 'nest-project.json').write_text(project())
        (self.root / 'saved-projects').mkdir()
        (self.root / 'saved-projects' / 'backup.json').write_text('secret')
        (self.root / 'alias').symlink_to(self.storage, target_is_directory=True)
        for path in ['/custom-storage/nest-project.json', '/saved-projects/backup.json', '/saved-projects/',
                     '/saved%2dprojects/backup.json', '/alias/nest-project.json', '/']:
            self.assertEqual(self.request(path=path)[0], 403, path)


if __name__ == '__main__':
    unittest.main()
