"""Entrada de alojamiento público: solo simulación, sin credenciales ni fuentes reales.

La base de ensayo vive en almacenamiento temporal y no sustituye el histórico
operativo. El host debe proporcionar su origen HTTPS para autorizar WebSocket.
"""
from __future__ import annotations

from contextlib import contextmanager
import logging
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit


def public_settings(environment) -> dict:
    origin = environment.get('ITS_PUBLIC_ORIGIN') or environment.get('RENDER_EXTERNAL_URL', '')
    try:
        parsed = urlsplit(origin)
        hostname = parsed.hostname
    except ValueError:
        raise ValueError('El origen HTTPS público no es válido.') from None
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {'', '/'} or parsed.query or parsed.fragment
            or any(ord(character) <= 32 for character in origin)
            or not re.fullmatch(r'[A-Za-z0-9.-]+', hostname)):
        raise ValueError('Configura ITS_PUBLIC_ORIGIN con el origen HTTPS público, sin ruta ni credenciales.')
    try:
        port = int(environment.get('PORT', '10000'))
        if not 1 <= port <= 65535:
            raise ValueError
        parsed.port
    except ValueError:
        raise ValueError('El puerto configurado no es válido.') from None
    scenario = environment.get('ITS_DEMO_SCENARIO', 'congestion')
    if scenario not in {'fluido', 'congestion'}:
        raise ValueError('ITS_DEMO_SCENARIO debe ser fluido o congestion.')
    return {'origin': origin.rstrip('/'), 'port': port, 'scenario': scenario}


@contextmanager
def isolated_environment(settings: dict, directory: str):
    """No reutiliza secretos, fuentes ni base de un entorno operativo."""
    changes = {
        'ITS_DATABASE_URL': 'sqlite:///' + str(Path(directory).resolve() / 'public-demo.db'),
        'ITS_API_TOKEN': '', 'ITS_DEMO': 'true',
        'ITS_ALLOWED_ORIGINS': settings['origin'],
        'ITS_CONFIG': '', 'ITS_CAMERA_SOURCE': '', 'ITS_MODEL_PATH': '', 'ITS_MODEL_SHA256': '',
    }
    previous = {key: os.environ.get(key) for key in changes}
    os.environ.update(changes)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def main() -> int:
    try:
        settings = public_settings(os.environ)
    except ValueError as error:
        print(str(error))  # Only our fixed safe errors; never values from the host.
        return 2
    # Automatic cleanup on a normal stop; a new process always has a new store.
    with tempfile.TemporaryDirectory(prefix='saferoute-public-demo-') as directory:
        with isolated_environment(settings, directory):
            from .cli import main as run
            logging.getLogger(__name__).info('public_synthetic_readonly_demo')
            return run(['demo', '--host', '0.0.0.0', '--port', str(settings['port']),
                        '--scenario', settings['scenario']])


if __name__ == '__main__':
    raise SystemExit(main())
