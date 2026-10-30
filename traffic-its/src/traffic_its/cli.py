"""Entradas separadas para API, una cámara y entrega; demo local explícita."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import signal
from threading import Event, Thread, Timer
import urllib.request

from . import __version__

ROOT = Path(__file__).resolve().parents[2]
# Writable, task-specific caches; never redirect the user's home directory.
cache_root = Path(os.environ.get('ITS_CACHE_DIRECTORY', '/tmp/saferoute-its-cache'))
os.environ.setdefault('MPLCONFIGDIR', str(cache_root / 'matplotlib'))
os.environ.setdefault('XDG_CACHE_HOME', str(cache_root / 'xdg'))
for cache_path in (os.environ['MPLCONFIGDIR'], os.environ['XDG_CACHE_HOME']):
    Path(cache_path).mkdir(parents=True, exist_ok=True)
LOG = logging.getLogger('traffic_its')


def default_database() -> str:
    return os.environ.get('ITS_DATABASE_URL', 'sqlite:///' + str(ROOT / 'data' / 'its.db'))


def config_path(value: str | None) -> Path:
    if value or os.environ.get('ITS_CONFIG'):
        return Path(value or os.environ['ITS_CONFIG'])
    path = ROOT / 'configs' / 'demo.json'
    return path if path.exists() else Path(__file__).with_name('default_demo.json')


def store_with_retry(database: str, stop: Event):
    from .store import Store
    store = Store(database)
    for attempt in range(8):
        try:
            store.initialize()
            return store
        except Exception:
            if stop.wait(min(8, 1 + attempt)):
                break
    raise RuntimeError('La base no está disponible; comprueba el servicio y las credenciales sin publicarlas.')


def relay(store, stop: Event):
    """LISTEN es opcional: polling del log durable no pierde notificaciones."""
    last_prune = 0.0
    import time
    while not stop.is_set():
        try:
            store.relay_pending()
            if time.monotonic() - last_prune > 3600:
                store.prune()
                last_prune = time.monotonic()
        except Exception:
            LOG.warning('relay_temporarily_unavailable')
        stop.wait(.25)


def doctor(model: str | None = None) -> dict:
    import av
    import cv2
    import onnxruntime as ort
    result = {
        'service_version': __version__, 'checked_at': datetime.now(UTC).isoformat(),
        'packages': {name: importlib.metadata.version(name) for name in
                     ['av', 'fastapi', 'numpy', 'onnxruntime', 'opencv-python', 'supervision', 'SQLAlchemy', 'psycopg']},
        'opencv_runtime': cv2.__version__, 'ffmpeg_libraries': av.library_versions,
        'onnx_providers': ort.get_available_providers(),
        'accuracy_validation': 'not_performed_on_real_traffic',
        'source_credentials_included': False,
    }
    if model:
        from .domain import VideoFrame
        from .vision import YoloXDetector
        import numpy as np
        import time
        manifest = json.loads(Path(__file__).with_name('model_manifest.json').read_text())
        detector = YoloXDetector(model, expected_sha256=manifest['sha256'])
        frame = VideoFrame(np.zeros((360, 640, 3), np.uint8), 0, 'doctor', datetime.now(UTC), time.monotonic())
        result['model'] = {'sha256': detector.model_sha256, 'blank_frame_detections': len(detector.detect(frame)),
                           'test_kind': 'runtime_smoke_not_accuracy_benchmark'}
    return result


def download_model(output: str):
    manifest = json.loads(Path(__file__).with_name('model_manifest.json').read_text())
    path = Path(output)
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() == manifest['sha256']:
            print(json.dumps({'model': path.name, 'status': 'already_verified', 'sha256': manifest['sha256']}))
            return
        raise ValueError('El archivo existente no coincide; no se sobrescribirá silenciosamente.')
    with urllib.request.urlopen(manifest['source_url'], timeout=30) as response:
        data = response.read(manifest['size_bytes'] + 1)
    if len(data) != manifest['size_bytes'] or hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise ValueError('El artefacto descargado no coincide con el manifiesto fijado.')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.part')
    temporary.write_bytes(data)
    temporary.replace(path)
    print(json.dumps({'model': path.name, 'status': 'verified', 'sha256': manifest['sha256']}))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='SafeRoute ITS — MVP de una cámara')
    parser.add_argument('--env-file', help='Archivo dotenv optativo; no se ejecuta como código shell')
    parser.add_argument('--database-url', help='Normalmente se usa ITS_DATABASE_URL; no incluir contraseñas en el historial shell')
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('api', 'demo'):
        command = commands.add_parser(name)
        command.add_argument('--host', default='127.0.0.1')
        command.add_argument('--port', type=int, default=8000)
        if name == 'demo':
            command.add_argument('--duration', type=float, default=None)
    worker_command = commands.add_parser('worker')
    worker_command.add_argument('--config', default=None)
    worker_command.add_argument('--duration', type=float, default=None)
    commands.add_parser('relay')
    doctor_command = commands.add_parser('doctor')
    doctor_command.add_argument('--model')
    download_command = commands.add_parser('download-model')
    download_command.add_argument('--output', default='models/yolox_nano.onnx')
    commands.add_parser('schema')
    args = parser.parse_args(argv)
    if args.env_file:
        from dotenv import load_dotenv
        if not Path(args.env_file).is_file():
            parser.error('El archivo de variables indicado no está disponible.')
        load_dotenv(args.env_file, override=False)
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s %(message)s')
    stop = Event()
    def terminate(*_):
        stop.set()
    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    try:
        if args.command == 'doctor':
            print(json.dumps(doctor(args.model), indent=2))
            return 0
        if args.command == 'download-model':
            download_model(args.output)
            return 0
        if args.command == 'schema':
            from sqlalchemy.schema import CreateTable, CreateIndex
            from sqlalchemy.dialects import postgresql
            from .store import metadata
            dialect = postgresql.dialect()
            for table in metadata.sorted_tables:
                print(str(CreateTable(table).compile(dialect=dialect)) + ';')
                for index in table.indexes:
                    print(str(CreateIndex(index).compile(dialect=dialect)) + ';')
            return 0
        database = args.database_url or default_database()
        store = store_with_retry(database, stop)
        if args.command == 'worker':
            from .config import load_camera_config
            from .worker import run_worker
            final = run_worker(load_camera_config(config_path(args.config)), store, stop, duration=args.duration)
            return 2 if final and final.get('health', {}).get('status') == 'source_unavailable' else 0
        if args.command == 'relay':
            relay(store, stop)
            return 0
        from .api import create_app
        import uvicorn
        if args.command == 'demo':
            from .config import load_camera_config
            from .worker import run_worker
            config = load_camera_config(ROOT / 'configs' / 'demo.json' if (ROOT / 'configs' / 'demo.json').exists() else Path(__file__).with_name('default_demo.json'))
            failure = []
            def demo_worker():
                try:
                    run_worker(config, store, stop)
                except Exception:
                    LOG.error('demo_worker_failed')
                    failure.append(True)
                    stop.set()
            jobs = [Thread(target=demo_worker, daemon=True), Thread(target=relay, args=(store,stop), daemon=True)]
            for job in jobs:
                job.start()
            app = create_app(database_url=database, demo=True)
        else:
            jobs = []
            app = create_app(database_url=database)
        server = uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port, access_log=False))
        timer = Timer(args.duration, stop.set) if args.command == 'demo' and args.duration else None
        if timer:
            timer.start()
        def stop_server():
            stop.wait()
            server.should_exit = True
        watcher = Thread(target=stop_server, daemon=True)
        watcher.start()
        try:
            server.run()
        finally:
            stop.set()
            if timer:
                timer.cancel()
            for job in jobs:
                job.join(timeout=8)
        return 1 if args.command == 'demo' and failure else 0
    except Exception as error:
        # Never stringify errors from sources or database connections.
        LOG.error('operation_failed_%s', type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
