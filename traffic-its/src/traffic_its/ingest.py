"""Ingesta sin grabación: PTS del medio, épocas y un buffer reciente acotado.

El tiempo de recepción NO se usa como sustituto de PTS. La fuente RTSP debe
usarse desde un proceso vigilado: los timeouts nativos no equivalen a poder
cancelar inmediatamente una llamada bloqueada de un codec.
"""
from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
import math
import os
import random
from pathlib import Path
from threading import Condition, Event, Thread
import time
from typing import Iterator
from urllib.parse import urlsplit
from uuid import uuid4

from .domain import VideoFrame


class SourceError(RuntimeError):
    """Error deliberadamente sin URI, parámetros, credenciales ni detalle FFmpeg."""


def _field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


class VideoSource:
    """Decodifica una fuente configurada; un archivo termina, no se reconecta."""

    def __init__(self, config, stop_event: Event | None = None):
        self.config = config
        self.stop_event = stop_event or Event()
        self.status = "starting"
        self.last_error: str | None = None
        self.reconnect_count = 0
        self.timestamp_resets = 0
        self._container = None
        self._epoch = str(uuid4())

    def _source_uri(self) -> str:
        source = _field(self.config, "source")
        name = _field(source, "uri_environment_variable")
        uri = os.environ.get(name, "") if name else ""
        if not uri:
            raise SourceError("La variable de la fuente no está configurada.")
        kind = _field(source, "kind")
        if kind == "file" and not Path(uri).is_file():
            raise SourceError("El archivo autorizado no está disponible.")
        if kind == "rtsp" and urlsplit(uri).scheme.lower() not in {"rtsp", "rtsps"}:
            raise SourceError("La fuente RTSP debe usar un protocolo permitido.")
        return uri

    def frames(self) -> Iterator[VideoFrame]:
        source = _field(self.config, "source")
        if _field(source, "kind") == "synthetic":
            yield from self._synthetic_frames()
            return
        try:
            uri = self._source_uri()
        except SourceError as error:
            self.status = "source_unavailable"
            self.last_error = str(error)
            raise
        live = _field(source, "kind") == "rtsp"
        retry_delay = 1.0
        while not self.stop_event.is_set():
            self._epoch = str(uuid4())
            try:
                import av

                # Decoder error logs can embed userinfo/query credentials. The
                # worker exposes only our safe error strings, never native logs.
                av.logging.set_level(av.logging.PANIC)
                # FFmpeg's rw_timeout is microseconds; PyAV's timeout is seconds.
                options = {"rtsp_transport": "tcp", "rw_timeout": "5000000"} if live else {}
                self._container = av.open(uri, mode="r", options=options, timeout=(5.0, 5.0))
                if not self._container.streams.video:
                    raise SourceError("La fuente no contiene un stream de video utilizable.")
                self.status = "running"
                self.last_error = None
                retry_delay = 1.0
                previous_pts = None
                timing_invalid = False
                last_yielded = None
                playback_origin = None
                wall_origin = time.monotonic()
                processing = _field(self.config, "processing")
                target_fps = float(_field(processing, "target_processed_fps", 5))
                period = 1 / max(0.1, target_fps)
                for decoded in self._container.decode(video=0):
                    if self.stop_event.is_set():
                        break
                    media_time = None
                    if decoded.pts is not None and decoded.time_base is not None:
                        candidate = float(decoded.pts * decoded.time_base)
                        if math.isfinite(candidate):
                            media_time = candidate
                    # Missing, duplicate/backward or discontinuous PTS invalidates
                    # the timing interval and starts a new tracking epoch.
                    discontinuity = media_time is None or (
                        previous_pts is not None
                        and (media_time <= previous_pts or media_time - previous_pts > 10.0)
                    )
                    raw_media_time = media_time
                    if discontinuity:
                        if not timing_invalid:
                            self.timestamp_resets += 1
                            self._epoch = str(uuid4())
                            last_yielded = None
                            playback_origin = None
                            wall_origin = time.monotonic()
                        # Keep one degraded epoch while time remains stalled;
                        # resetting every frame would hide freezes from health.
                        timing_invalid = True
                        media_time = None
                    else:
                        timing_invalid = False
                    previous_pts = raw_media_time
                    if media_time is not None and last_yielded is not None and media_time - last_yielded < period - 1e-7:
                        continue
                    # A file is paced by its real presentation timeline, otherwise
                    # a latest-frame reader could consume it all before analytics.
                    if not live and media_time is not None:
                        if playback_origin is None:
                            playback_origin = media_time
                            wall_origin = time.monotonic()
                        wait = media_time - playback_origin - (time.monotonic() - wall_origin)
                        if wait > 0 and self.stop_event.wait(min(wait, 10.0)):
                            break
                    image = decoded.to_ndarray(format="bgr24")
                    received = time.monotonic()
                    last_yielded = media_time
                    yield VideoFrame(image, media_time, self._epoch, datetime.now(UTC), received)
                if not live:
                    self.status = "stopped" if self.stop_event.is_set() else "replay_finished"
                    return
                self.status = "reconnecting"
                self.last_error = "Se interrumpió el stream; se reintentará la conexión."
            except SourceError:
                self.status = "source_unavailable"
                self.last_error = "La fuente configurada no contiene video utilizable."
                if not live:
                    raise SourceError(self.last_error) from None
            except Exception:
                # A native error often embeds the complete URL: never propagate it.
                self.status = "source_unavailable" if not live else "reconnecting"
                self.last_error = "No se pudo abrir o decodificar la fuente configurada."
                if not live:
                    raise SourceError(self.last_error) from None
            finally:
                if self._container is not None:
                    try:
                        self._container.close()
                    except Exception:
                        pass
                    self._container = None
            self.reconnect_count += 1
            if self.stop_event.wait(retry_delay * random.uniform(0.9, 1.1)):
                break
            retry_delay = min(30.0, retry_delay * 2)
        self.status = "stopped"

    def _synthetic_frames(self) -> Iterator[VideoFrame]:
        import cv2
        import numpy as np
        from .vision import synthetic_objects

        processing = _field(self.config, "processing")
        fps = float(_field(processing, "target_processed_fps", 5))
        period = 1 / max(0.1, fps)
        self.status = "synthetic_running"
        start = time.monotonic()
        index = 0
        while not self.stop_event.is_set():
            media_time = index * period
            wait = start + media_time - time.monotonic()
            if wait > 0 and self.stop_event.wait(wait):
                break
            image = np.full((360, 640, 3), (45, 55, 48), dtype=np.uint8)
            cv2.rectangle(image, (100, 0), (540, 359), (75, 75, 75), -1)
            cv2.line(image, (100, 0), (100, 359), (210, 210, 210), 3)
            cv2.line(image, (540, 0), (540, 359), (210, 210, 210), 3)
            for y in range(0, 360, 45):
                cv2.line(image, (320, y), (320, min(359, y + 25)), (220, 220, 220), 3)
            for detection in synthetic_objects(media_time):
                x1, y1, x2, y2 = map(int, detection.xyxy)
                color = {2: (70, 170, 210), 3: (180, 130, 70), 5: (75, 170, 100), 7: (130, 90, 170)}[detection.class_id]
                cv2.rectangle(image, (x1, y1), (x2, y2), color, -1)
            # The raster never leaves RAM; the dashboard receives metadata only.
            yield VideoFrame(image, media_time, self._epoch, datetime.now(UTC), time.monotonic())
            index += 1
        self.status = "stopped"

    def close(self) -> None:
        self.stop_event.set()
        # Do not concurrently close an active native decoder from another thread;
        # its read timeout and the process watchdog own interruption.


class LatestFrameBuffer:
    """Threaded bounded reader; overload drops the oldest decoded frame."""

    def __init__(self, source: VideoSource, capacity: int = 2):
        if capacity not in (1, 2):
            raise ValueError("El buffer admite uno o dos frames.")
        self.source = source
        self.capacity = capacity
        self.dropped_frames = 0
        self.error: str | None = None
        self.done = Event()
        self._frames: deque[VideoFrame] = deque()
        self._condition = Condition()
        self._thread: Thread | None = None

    def start(self) -> "LatestFrameBuffer":
        if self._thread is not None:
            return self
        self._thread = Thread(target=self._read, name="its-frame-reader", daemon=True)
        self._thread.start()
        return self

    def _read(self) -> None:
        try:
            for frame in self.source.frames():
                with self._condition:
                    if len(self._frames) >= self.capacity:
                        self._frames.popleft()
                        self.dropped_frames += 1
                    self._frames.append(frame)
                    self._condition.notify_all()
        except Exception:
            self.error = self.source.last_error or "No se pudo leer la fuente configurada."
        finally:
            self.done.set()
            with self._condition:
                self._condition.notify_all()

    def get(self, timeout: float = 1.0) -> VideoFrame | None:
        with self._condition:
            if not self._frames and not self.done.is_set():
                self._condition.wait(timeout=max(0.0, timeout))
            if not self._frames:
                return None
            # Return the newest sample and explicitly account for samples skipped.
            self.dropped_frames += max(0, len(self._frames) - 1)
            frame = self._frames[-1]
            self._frames.clear()
            return frame

    def frames(self) -> Iterator[VideoFrame]:
        self.start()
        while not self.done.is_set() or self.pending_count:
            frame = self.get()
            if frame is not None:
                yield frame

    @property
    def pending_count(self) -> int:
        with self._condition:
            return len(self._frames)

    @property
    def finished(self) -> bool:
        return self.done.is_set() and self.pending_count == 0

    @property
    def dropped(self) -> int:
        return self.dropped_frames

    def close(self) -> None:
        self.source.close()
        if self._thread is not None:
            self._thread.join(timeout=6.0)

    stop = close
