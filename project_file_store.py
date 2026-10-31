"""Fixed-path, locked, recoverable project-file persistence for the local server."""
import fcntl
import hashlib
import json
import os
import re
import stat
from pathlib import Path
import tempfile
import uuid

MAX_PROJECT_BYTES = 50 * 1024 * 1024
DEFAULT_FILENAME = 'nest-project.json'


class InvalidProject(ValueError):
    pass


class ProjectFileStore:
    @staticmethod
    def validate_filename(filename):
        if (not isinstance(filename, str)
                or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\.json', filename) is None
                or '..' in filename
                or any(token in filename.lower() for token in ('.backup.', '.migration.', 'pre-migration', 'pre_migration', 'before-file-autosave'))):
            raise InvalidProject('Invalid or reserved project filename')
        return filename

    def __init__(self, directory, filename=DEFAULT_FILENAME):
        self.directory = Path(directory).resolve()
        self.filename = self.validate_filename(filename)
        self.path = self.directory / self.filename
        self.public_path = f'saved-projects/{self.filename}'

    def list_projects(self):
        files = []
        if self.directory.exists():
            for entry in self.directory.iterdir():
                try:
                    self.validate_filename(entry.name)
                    if stat.S_ISREG(entry.lstat().st_mode):
                        files.append({'name': entry.name, 'path': f'saved-projects/{entry.name}'})
                except (InvalidProject, FileNotFoundError):
                    continue
        return {'available': True, 'files': sorted(files, key=lambda item: item['name'])}

    def _state(self):
        if self.path.is_symlink():
            raise InvalidProject('Project files must not be symlinks')
        try:
            descriptor = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise InvalidProject('Project must be a regular file')
                raw = source.read()
        except FileNotFoundError:
            raw = None
        return {'available': True, 'text': None if raw is None else raw.decode('utf-8'),
                'revision': None if raw is None else hashlib.sha256(raw).hexdigest(),
                'path': self.public_path}

    def read(self):
        # os.replace makes reads see a complete old or new file.
        return self._state()

    def _backup(self, raw, label):
        name = f'{self.path.stem}.{label}.{uuid.uuid4().hex}.json'
        path = self.directory / name
        created = False
        try:
            with path.open('xb') as backup:
                created = True
                backup.write(raw)
                backup.flush()
                os.fsync(backup.fileno())
            self._sync_directory()
        except BaseException:
            if created:
                path.unlink(missing_ok=True)
            raise
        return f'saved-projects/{name}'

    def _sync_directory(self):
        descriptor = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def save(self, request):
        if not isinstance(request, dict) or 'expectedRevision' not in request:
            raise InvalidProject('expectedRevision is required')
        expected = request['expectedRevision']
        if expected is not None and not isinstance(expected, str):
            raise InvalidProject('expectedRevision must be a string or null')
        text = request.get('text')
        migration = request.get('migrationSourceText')
        if not isinstance(text, str) or ('migrationSourceText' in request and not isinstance(migration, str)):
            raise InvalidProject('text and migrationSourceText must be strings')
        try:
            raw = text.encode('utf-8')
            if len(raw) > MAX_PROJECT_BYTES:
                raise InvalidProject('Project exceeds 50 MB')
            project = json.loads(text)
        except (ValueError, UnicodeError) as error:
            raise InvalidProject('Invalid project JSON') from error
        if (not isinstance(project, dict) or type(project.get('version')) is not int
                or project['version'] != 3 or project.get('kind') != 'nest-project'
                or not isinstance(project.get('library'), list)
                or not isinstance(project.get('chapters'), list)):
            raise InvalidProject('Expected a version 3 nest-project with library and chapters arrays')
        self.directory.mkdir(parents=True, exist_ok=True)
        with (self.directory / '.project.lock').open('a+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = self._state()
            if state['revision'] != expected:
                return 409, dict(state, conflict=True)
            if state['text'] == text:
                return 200, dict(state, ok=True)
            backup_path = None
            if state['text'] is not None:
                backup_path = self._backup(state['text'].encode('utf-8'), 'backup')
            elif migration is not None:
                backup_path = self._backup(migration.encode('utf-8'), 'migration')
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.directory, prefix='.project-', delete=False) as output:
                    temporary = Path(output.name)
                    output.write(raw)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
                self._sync_directory()
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            result = dict(self._state(), ok=True)
            if backup_path is not None:
                result['backupPath'] = backup_path
            return 200, result
