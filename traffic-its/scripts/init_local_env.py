#!/usr/bin/env python3
"""Create private local-demo credentials without printing or replacing secrets."""
from pathlib import Path
import os
import secrets


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    destination = project / ".env"
    content = "\n".join([
        "# Generated for the local synthetic demo. Do not commit this file.",
        f"ITS_DB_PASSWORD={secrets.token_hex(32)}",
        f"ITS_API_TOKEN={secrets.token_hex(32)}",
        "ITS_DEMO=true",
        "ITS_CAMERA_CONFIG=demo.json",
        "ITS_BIND_HOST=127.0.0.1",
        "ITS_PORT=8000",
        "ITS_ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000",
        "",
    ])
    try:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(".env ya existe; se conservó sin cambios.")
        return
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
    print(".env creado con permisos privados y credenciales nuevas. No se mostraron sus valores.")


if __name__ == "__main__":
    main()
