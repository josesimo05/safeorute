"""API del piloto. El proceso HTTP no abre cámaras ni ejecuta inferencia."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import hmac
import json
import os
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from .store import CursorAhead, CursorExpired, Store


class ReviewRequest(BaseModel):
    action: Literal['acknowledge', 'approve', 'suppress', 'resolve']
    note: str = Field(default='', max_length=1000)


def create_app(database_url: str | None = None, token: str | None = None,
               demo: bool | None = None, allowed_origins: list[str] | None = None) -> FastAPI:
    database_url = database_url or os.getenv('ITS_DATABASE_URL', 'sqlite:///./data/its.db')
    expected_token = os.getenv('ITS_API_TOKEN', '') if token is None else token
    demo_enabled = os.getenv('ITS_DEMO', 'false').lower() in {'true', '1', 'yes'} if demo is None else demo
    if not expected_token and not demo_enabled:
        raise RuntimeError('ITS_API_TOKEN must be configured for a non-demo service')
    origins = (allowed_origins if allowed_origins is not None else
        [item.strip() for item in os.getenv('ITS_ALLOWED_ORIGINS', '').split(',') if item.strip()])
    if '*' in origins:
        raise RuntimeError('Configure exact ITS_ALLOWED_ORIGINS, not a wildcard')
    store = Store(database_url)

    @asynccontextmanager
    async def lifespan(app):
        await asyncio.to_thread(store.initialize)
        yield
        store.engine.dispose()

    app = FastAPI(title='SafeRoute ITS — piloto de una cámara', version='0.1.0', lifespan=lifespan)
    app.state.store = store
    app.state.demo = demo_enabled
    app.add_middleware(CORSMiddleware, allow_origins=origins,
        allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type'])
    bearer = HTTPBearer(auto_error=False)

    def token_valid(value: str | None) -> bool:
        return bool(expected_token and value and hmac.compare_digest(expected_token.encode('utf-8'), value.encode('utf-8')))

    async def read_access(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> bool:
        if credentials:
            if credentials.scheme.lower() == 'bearer' and token_valid(credentials.credentials):
                return False
            raise HTTPException(401, 'Credenciales no válidas', headers={'WWW-Authenticate': 'Bearer'})
        if demo_enabled:
            return True
        raise HTTPException(401, 'Autenticación requerida', headers={'WWW-Authenticate': 'Bearer'})

    async def operator_access(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
        if not credentials or credentials.scheme.lower() != 'bearer' or not token_valid(credentials.credentials):
            raise HTTPException(401, 'Autenticación de operador requerida', headers={'WWW-Authenticate': 'Bearer'})

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request: Request, _error: SQLAlchemyError):
        # Never reflect a DSN, SQL statement or bound parameters to clients.
        return JSONResponse(status_code=503, content={'detail': 'Histórico temporalmente no disponible'})

    @app.get('/healthz')
    async def healthz():
        return {'status': 'ok', 'service': 'saferoute-its', 'version': '0.1.0'}

    @app.get('/readyz')
    async def readyz():
        try:
            await asyncio.to_thread(store.ping)
        except SQLAlchemyError:
            return JSONResponse(status_code=503, content={'status': 'not_ready'})
        return {'status': 'ready', 'database': 'connected', 'camera_validation': 'not_asserted'}

    @app.get('/v1/snapshot')
    async def snapshot(demo_only: bool = Depends(read_access)):
        return await asyncio.to_thread(store.snapshot, demo_only)

    @app.get('/v1/cameras')
    async def camera_list(demo_only: bool = Depends(read_access)):
        return {'items': await asyncio.to_thread(store.list_cameras, demo_only)}

    @app.get('/v1/cameras/{camera_id}/health')
    async def camera_health(camera_id: str, demo_only: bool = Depends(read_access)):
        state = await asyncio.to_thread(store.get_state, camera_id, demo_only)
        if state is None:
            raise HTTPException(404, 'Cámara no disponible')
        return {'camera_id': camera_id, 'health': state.get('health'),
            'arrival_age_seconds': state.get('arrival_age_seconds'),
            'capture_age_seconds': state.get('capture_age_seconds'), 'stale': state.get('stale')}

    @app.get('/v1/segments/{segment_id}/state')
    async def segment_state(segment_id: str, demo_only: bool = Depends(read_access)):
        current = await asyncio.to_thread(store.snapshot, demo_only)
        selected = [item for item in current['states'] if item.get('road_segment_id') == segment_id]
        if not selected:
            raise HTTPException(404, 'Tramo no disponible')
        return {'road_segment_id': segment_id, 'items': selected}

    @app.get('/v1/metrics/history')
    async def metric_history(camera_id: str | None = None, limit: int = Query(100, ge=1, le=500),
                             start: AwareDatetime | None = None, end: AwareDatetime | None = None,
                             demo_only: bool = Depends(read_access)):
        if start and end and end < start:
            raise HTTPException(422, 'Intervalo de tiempo inválido')
        if start and end and (end - start).total_seconds() > 31 * 86400:
            raise HTTPException(422, 'Consultar como máximo 31 días por petición')
        result = await asyncio.to_thread(store.history, camera_id, limit, start, end, demo_only)
        return {'items': result, 'limit': limit, 'time_axis': 'received_at; capture_at may be unknown'}

    @app.get('/v1/alerts')
    async def alert_list(limit: int = Query(100, ge=1, le=500), demo_only: bool = Depends(read_access)):
        return {'items': await asyncio.to_thread(store.list_alerts, demo_only, limit)}

    @app.get('/v1/alerts/{alert_id}')
    async def alert_detail(alert_id: str, demo_only: bool = Depends(read_access)):
        result = await asyncio.to_thread(store.get_alert, alert_id, demo_only)
        if result is None:
            raise HTTPException(404, 'Alerta no disponible')
        return result

    @app.post('/v1/alerts/{alert_id}/review', dependencies=[Depends(operator_access)])
    async def review(alert_id: str, body: ReviewRequest):
        try:
            result = await asyncio.to_thread(store.review_alert, alert_id, body.action, 'operator', body.note)
        except ValueError:
            raise HTTPException(422, 'Revisión inválida') from None
        if result is None:
            raise HTTPException(404, 'Alerta no disponible')
        return result

    @app.get('/v1/events')
    async def events(cursor: int = Query(0, ge=0, le=9223372036854775807),
                     limit: int = Query(100, ge=1, le=500), demo_only: bool = Depends(read_access)):
        try:
            result = await asyncio.to_thread(store.events_after, cursor, limit, demo_only)
        except CursorExpired:
            raise HTTPException(410, 'Cursor vencido; recuperar /v1/snapshot') from None
        except CursorAhead:
            raise HTTPException(400, 'Cursor por delante de la secuencia disponible') from None
        return {'items': result, 'cursor': result[-1]['cursor'] if result else str(cursor)}

    @app.websocket('/v1/stream')
    async def stream(websocket: WebSocket):
        origin = websocket.headers.get('origin')
        own_origin = ('https' if websocket.url.scheme == 'wss' else 'http') + '://' + websocket.headers.get('host', '')
        if origin and origin not in origins and origin != own_origin:
            await websocket.close(code=1008)
            return
        if 'token' in websocket.query_params:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
            if len(raw) > 4096:
                await websocket.close(code=1008)
                return
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ValueError('Invalid authentication envelope')
            candidate = message.get('token')
            if candidate:
                if not isinstance(candidate, str) or not token_valid(candidate):
                    await websocket.close(code=1008)
                    return
                demo_only = False
            elif demo_enabled:
                demo_only = True
            else:
                await websocket.close(code=1008)
                return
            cursor_text = str(message.get('cursor', '0'))
            if not cursor_text.isdecimal() or len(cursor_text) > 19:
                raise ValueError('Invalid cursor')
            cursor = int(cursor_text)
            # Validate retention before announcing the stream ready.
            pending = await asyncio.to_thread(store.events_after, cursor, 100, demo_only)
            await websocket.send_json({'event_type': 'stream.ready', 'cursor': str(cursor)})
            heartbeat_at = asyncio.get_running_loop().time()
            while True:
                for event in pending:
                    # Slow clients cannot accumulate an unbounded output queue.
                    await asyncio.wait_for(websocket.send_json(event), timeout=5)
                    cursor = int(event['cursor'])
                clock = asyncio.get_running_loop().time()
                if clock - heartbeat_at > 10:
                    await asyncio.wait_for(websocket.send_json({'event_type': 'heartbeat', 'cursor': str(cursor)}), timeout=5)
                    heartbeat_at = clock
                # A short receive permits prompt disconnect detection and limits
                # inbound client chatter; the protocol needs only initial auth.
                try:
                    incoming = await asyncio.wait_for(websocket.receive_text(), timeout=.25)
                    if len(incoming) > 4096:
                        await websocket.close(code=1008)
                        return
                except asyncio.TimeoutError:
                    pass
                pending = await asyncio.to_thread(store.events_after, cursor, 100, demo_only)
        except (CursorExpired, CursorAhead):
            await websocket.send_json({'event_type': 'resync_required', 'detail': 'Recuperar /v1/snapshot'})
            await websocket.close(code=1008)
        except WebSocketDisconnect:
            return
        except asyncio.TimeoutError:
            await websocket.close(code=1008)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            await websocket.close(code=1008)
        except SQLAlchemyError:
            await websocket.send_json({'event_type': 'stream.unavailable'})
            await websocket.close(code=1013)

    static_dir = Path(__file__).parent / 'static'
    if static_dir.is_dir():
        app.mount('/static', StaticFiles(directory=static_dir), name='static')

    @app.get('/', include_in_schema=False)
    async def dashboard():
        index = static_dir / 'index.html'
        if not index.is_file():
            return JSONResponse(status_code=503, content={'detail': 'Dashboard no instalado'})
        return FileResponse(index, headers={'Cache-Control': 'no-store'})

    return app
