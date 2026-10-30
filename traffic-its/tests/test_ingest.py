from datetime import UTC, datetime
from fractions import Fraction
import os
from types import SimpleNamespace
from threading import Event

import av
import numpy as np
import pytest

from traffic_its.domain import VideoFrame
from traffic_its.ingest import LatestFrameBuffer, SourceError, VideoSource


def config(kind="file", fps=100):
    return SimpleNamespace(source=SimpleNamespace(kind=kind, uri_environment_variable="TEST_ITS_SOURCE"),
                           processing=SimpleNamespace(target_processed_fps=fps))


def test_file_uses_actual_pts_and_finishes_replay_without_camera_failure(tmp_path, monkeypatch):
    path = tmp_path / "variable.mkv"
    with av.open(str(path), "w") as container:
        stream = container.add_stream("ffv1", rate=10)
        stream.width, stream.height = 32, 24
        stream.pix_fmt = "yuv420p"
        stream.time_base = Fraction(1, 1000)
        for pts in [0, 100, 400]:
            frame = av.VideoFrame.from_ndarray(np.zeros((24, 32, 3), np.uint8), format="bgr24")
            frame.pts, frame.time_base = pts, Fraction(1, 1000)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    monkeypatch.setenv("TEST_ITS_SOURCE", str(path))
    source = VideoSource(config())
    frames = list(source.frames())
    assert len(frames) == 3
    assert [frame.media_time_s for frame in frames] == pytest.approx([0, .1, .4])
    assert len({frame.epoch for frame in frames}) == 1
    assert source.status == "replay_finished"
    assert all(frame.capture_at is None for frame in frames)
    assert frames[0].image.shape == (24, 32, 3)


def test_source_errors_never_expose_configured_secret_uri(tmp_path, monkeypatch):
    path = tmp_path / "not-video-secret-pass.txt"
    path.write_text("not a movie")
    monkeypatch.setenv("TEST_ITS_SOURCE", str(path))
    source = VideoSource(config())
    with pytest.raises(SourceError) as failure:
        list(source.frames())
    assert str(path) not in str(failure.value)
    assert "secret-pass" not in source.last_error
    assert source.status == "source_unavailable"


def test_synthetic_source_has_media_timing_and_stops_cooperatively():
    stop = Event()
    source = VideoSource(config("synthetic", 100), stop)
    frames = source.frames()
    first, second = next(frames), next(frames)
    stop.set()
    assert list(frames) == []
    assert first.media_time_s == 0
    assert second.media_time_s == pytest.approx(.01)
    assert first.capture_at is None
    assert source.status == "stopped"


def test_latest_buffer_is_bounded_and_returns_newest_decoded_frame():
    class FastSource:
        status = "running"
        last_error = None
        def frames(self):
            for number in range(10):
                yield VideoFrame(None, number, "epoch", datetime.now(UTC), float(number))
            self.status = "replay_finished"
        def close(self):
            pass
    reader = LatestFrameBuffer(FastSource(), capacity=2).start()
    assert reader.done.wait(2)
    assert reader.pending_count == 2
    assert reader.get().media_time_s == 9
    assert reader.dropped == 9
    assert reader.finished
    reader.close()


def test_reader_sanitizes_native_error_details():
    class BrokenSource:
        last_error = None
        def frames(self):
            raise RuntimeError("rtsp://user:secret@private-camera")
            yield
        def close(self):
            pass
    reader = LatestFrameBuffer(BrokenSource()).start()
    assert reader.done.wait(2)
    assert "secret" not in reader.error
    assert reader.finished


def test_missing_and_stalled_pts_invalidates_speed_once_per_bad_timing_period(tmp_path, monkeypatch):
    path = tmp_path / "fixture.bin"
    path.write_bytes(b"fixture")
    monkeypatch.setenv("TEST_ITS_SOURCE", str(path))
    class FakeFrame:
        time_base = Fraction(1, 1000)
        def __init__(self, pts):
            self.pts = pts
        def to_ndarray(self, format):
            return np.zeros((10, 10, 3), np.uint8)
    class FakeContainer:
        streams = SimpleNamespace(video=[object()])
        def decode(self, video):
            return iter([FakeFrame(0), FakeFrame(0), FakeFrame(0), FakeFrame(200), FakeFrame(None), FakeFrame(None)])
        def close(self):
            pass
    monkeypatch.setattr(av, "open", lambda *a, **k: FakeContainer())
    source = VideoSource(config())
    frames = list(source.frames())
    assert [frame.media_time_s for frame in frames] == [0, None, None, .2, None, None]
    assert frames[0].epoch != frames[1].epoch
    assert frames[1].epoch == frames[2].epoch == frames[3].epoch
    assert frames[3].epoch != frames[4].epoch
    assert frames[4].epoch == frames[5].epoch
    assert source.timestamp_resets == 2
