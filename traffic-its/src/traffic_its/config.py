"""Configuración del piloto: sin fuentes secretas ni calibraciones implícitas.

El formato productivo es JSON 0.1.0. Una plantilla de diseño no habilita un
pipeline accidentalmente. Ningún valor de una variable de fuente se resuelve
ni se incluye en la configuración pública.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError, model_validator

Point = tuple[FiniteFloat, FiniteFloat]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")]


class ConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _area(points: tuple[Point, ...]) -> float:
    """Área firmada de un polígono, sin dependencias numéricas externas."""
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])) / 2


def _non_collinear(points: tuple[Point, ...]) -> bool:
    if len(set(points)) < 4:
        return False
    a = points[0]
    return any(abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-8
               for b in points[1:] for c in points[1:])


def _inside_polygon(point: Point, polygon: tuple[Point, ...]) -> bool:
    """Incluye el borde; evita líneas de conteo fuera del carril asignado."""
    x, y = point
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
        if abs(cross) <= 1e-7 and min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1]):
            return True
        if (a[1] > y) != (b[1] > y):
            crossing_x = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < crossing_x:
                inside = not inside
    return inside


class SourceConfig(ConfigModel):
    kind: Literal["synthetic", "file", "rtsp"]
    mode: Literal["demo", "replay", "live"]
    uri_environment_variable: Annotated[str, Field(pattern=r"^[A-Z_][A-Z0-9_]*$")] | None = None
    public_alerts_enabled: Literal[False] = False

    @model_validator(mode="after")
    def consistent_source(self):
        expected = {"synthetic": "demo", "file": "replay", "rtsp": "live"}
        if self.mode != expected[self.kind]:
            raise ValueError("El tipo de fuente y su modo no corresponden")
        if self.kind != "synthetic" and not self.uri_environment_variable:
            raise ValueError("La fuente real requiere el nombre de una variable de entorno")
        if self.kind == "synthetic" and self.uri_environment_variable is not None:
            raise ValueError("La fuente sintética no usa una URI ni una variable de fuente")
        return self


class LocationConfig(ConfigModel):
    country: str = "DO"
    city: str | None = None
    latitude: Annotated[FiniteFloat, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[FiniteFloat, Field(ge=-180, le=180)] | None = None

    @model_validator(mode="after")
    def complete_coordinate(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("La ubicación requiere latitud y longitud juntas")
        return self


class ProcessingConfig(ConfigModel):
    target_processed_fps: Annotated[FiniteFloat, Field(gt=0, le=30)] = 5
    model_input_size_px: tuple[Annotated[int, Field(gt=0, le=2048)], Annotated[int, Field(gt=0, le=2048)]] = (416, 416)
    latest_frame_buffer_capacity: Annotated[int, Field(ge=1, le=2)] = 2
    video_timing: Literal["decoded_media_pts"] = "decoded_media_pts"
    speed_requires_valid_pts: Literal[True] = True
    speed_fit_min_observations: Annotated[int, Field(ge=6, le=120)] = 6
    speed_fit_window_seconds: tuple[FiniteFloat, FiniteFloat] = (1, 2)
    free_flow_speed_kmh: Annotated[FiniteFloat, Field(gt=0, le=200)] = 40
    free_flow_reference: Literal["manual_unvalidated", "validated_local"] = "manual_unvalidated"

    @model_validator(mode="after")
    def consistent_processing(self):
        if any(size % 32 for size in self.model_input_size_px):
            raise ValueError("El tamaño de inferencia debe ser múltiplo de 32")
        low, high = self.speed_fit_window_seconds
        if low <= 0 or high < low or high > 10:
            raise ValueError("La ventana de velocidad debe ser positiva y ordenada, hasta 10 segundos")
        return self


class ControlPoint(ConfigModel):
    image_px: Point
    ground_m: Point


class CalibrationConfig(ConfigModel):
    status: Literal["unconfigured", "valid", "synthetic"] = "unconfigured"
    calibration_id: Identifier | None = None
    camera_fixed: bool | None = None
    frame_size_px: tuple[Annotated[int, Field(gt=0)], Annotated[int, Field(gt=0)]] | None = None
    preset_id: str | None = None
    ground_units: Literal["metres"] = "metres"
    fit_points_image_px: tuple[Point, ...] = ()
    fit_points_ground_m: tuple[Point, ...] = ()
    independent_control_points: tuple[ControlPoint, ...] = ()
    homography_image_to_ground: tuple[tuple[FiniteFloat, FiniteFloat, FiniteFloat], tuple[FiniteFloat, FiniteFloat, FiniteFloat], tuple[FiniteFloat, FiniteFloat, FiniteFloat]] | None = None
    valid_roi_image_px: tuple[Point, ...] = ()
    validation_rmse_metres: Annotated[FiniteFloat, Field(ge=0)] | None = None

    @model_validator(mode="after")
    def coherent_calibration(self):
        if len(self.fit_points_image_px) != len(self.fit_points_ground_m):
            raise ValueError("Cada punto de imagen requiere su correspondencia en metros")
        if self.status == "unconfigured":
            return self
        if not self.calibration_id or not self.camera_fixed or not self.frame_size_px:
            raise ValueError("La calibración requiere identificación, cámara fija y resolución")
        if not _non_collinear(self.fit_points_image_px) or not _non_collinear(self.fit_points_ground_m):
            raise ValueError("La calibración requiere al menos cuatro correspondencias distintas no colineales")
        if len(self.independent_control_points) < 4:
            raise ValueError("Se requieren al menos cuatro puntos independientes de control")
        if len({point.image_px for point in self.independent_control_points}) < 4 or len({point.ground_m for point in self.independent_control_points}) < 4:
            raise ValueError("Se requieren cuatro puntos de control distintos, no copias de la misma referencia")
        for point in self.independent_control_points:
            if point.image_px in self.fit_points_image_px or point.ground_m in self.fit_points_ground_m:
                raise ValueError("Los puntos de control deben ser distintos de los usados para ajustar")
        if len(self.valid_roi_image_px) < 3 or abs(_area(self.valid_roi_image_px)) < 1e-6:
            raise ValueError("Se requiere una región de imagen válida con área positiva")
        if self.validation_rmse_metres is None or self.validation_rmse_metres > 0.5:
            raise ValueError("El error independiente declarado debe ser de hasta 0,5 metros; se comprobará otra vez al cargar la geometría")
        width, height = self.frame_size_px
        image_points = list(self.fit_points_image_px) + [p.image_px for p in self.independent_control_points] + list(self.valid_roi_image_px)
        if any(x < 0 or y < 0 or x > width or y > height for x, y in image_points):
            raise ValueError("Los puntos de calibración deben quedar dentro de la resolución declarada")
        return self


class LaneConfig(ConfigModel):
    id: Identifier
    polygon_image_px: tuple[Point, ...]
    centerline_ground_m: tuple[Point, ...] = ()

    @model_validator(mode="after")
    def valid_polygon(self):
        if len(self.polygon_image_px) < 3 or abs(_area(self.polygon_image_px)) < 1e-6:
            raise ValueError("El carril necesita un polígono con área positiva")
        if self.centerline_ground_m and (len(self.centerline_ground_m) < 2 or len(set(self.centerline_ground_m)) < 2):
            raise ValueError("El eje longitudinal necesita al menos dos puntos distintos")
        return self


class CountLineConfig(ConfigModel):
    id: Identifier
    lane_id: Identifier
    points_image_px: tuple[Point, Point]
    direction: Literal[-1, 1] = 1

    @model_validator(mode="after")
    def different_endpoints(self):
        if self.points_image_px[0] == self.points_image_px[1]:
            raise ValueError("La línea de conteo necesita extremos distintos")
        return self


class CapabilityGates(ConfigModel):
    metric_speed_enabled: bool = False
    lane_flow_enabled: bool = False
    specific_cause_publication_enabled: Literal[False] = False


class PrivacyConfig(ConfigModel):
    store_video: Literal[False] = False
    store_snapshots: Literal[False] = False
    store_faces_or_plates: Literal[False] = False
    store_persistent_vehicle_identifiers: Literal[False] = False
    live_video_preview_enabled: Literal[False] = False


class GPSFusionConfig(ConfigModel):
    enabled: Literal[False] = False


class SignalContext(ConfigModel):
    available: Literal[False] = False


class CameraConfig(ConfigModel):
    schema_version: Literal["0.1.0"] = "0.1.0"
    camera_id: Identifier
    road_segment_id: Identifier | None = None
    source: SourceConfig
    location: LocationConfig = Field(default_factory=LocationConfig)
    processing: ProcessingConfig = Field(default_factory=ProcessingConfig)
    calibration: CalibrationConfig = Field(default_factory=CalibrationConfig)
    lanes: tuple[LaneConfig, ...] = ()
    count_lines: tuple[CountLineConfig, ...] = ()
    shoulder_zones: tuple[tuple[Point, ...], ...] = ()
    normal_stop_zones: tuple[tuple[Point, ...], ...] = ()
    signal_context: SignalContext = Field(default_factory=SignalContext)
    gps_fusion: GPSFusionConfig = Field(default_factory=GPSFusionConfig)
    capability_gates: CapabilityGates = Field(default_factory=CapabilityGates)
    privacy: PrivacyConfig = Field(default_factory=PrivacyConfig)

    @model_validator(mode="after")
    def usable_capabilities(self):
        if self.road_segment_id is None:
            object.__setattr__(self, "road_segment_id", self.camera_id)
        if self.calibration.status == "synthetic" and self.source.kind != "synthetic":
            raise ValueError("Una calibración sintética solo se permite en demostración sintética")
        if self.source.kind == "synthetic" and self.calibration.status == "valid":
            raise ValueError("La demostración no puede presentarse como calibración real validada")
        lane_ids = [lane.id for lane in self.lanes]
        if len(set(lane_ids)) != len(lane_ids) or len({line.id for line in self.count_lines}) != len(self.count_lines):
            raise ValueError("Los identificadores de carriles y líneas deben ser únicos")
        if any(line.lane_id not in lane_ids for line in self.count_lines):
            raise ValueError("Cada línea debe pertenecer a un carril configurado")
        lane_by_id = {lane.id: lane for lane in self.lanes}
        if any(not _inside_polygon(point, lane_by_id[line.lane_id].polygon_image_px)
               for line in self.count_lines for point in line.points_image_px):
            raise ValueError("Los extremos de la línea deben estar dentro del carril asignado")
        if self.calibration.frame_size_px:
            width, height = self.calibration.frame_size_px
            if any(x < 0 or y < 0 or x > width or y > height
                   for lane in self.lanes for x, y in lane.polygon_image_px):
                raise ValueError("Los carriles deben quedar dentro de la resolución declarada")
        if self.capability_gates.metric_speed_enabled:
            if self.calibration.status == "unconfigured" or not self.lanes or any(not lane.centerline_ground_m for lane in self.lanes):
                raise ValueError("La velocidad requiere calibración y ejes longitudinales de carril")
            if self.processing.target_processed_fps * self.processing.speed_fit_window_seconds[1] + 1 < self.processing.speed_fit_min_observations:
                raise ValueError("La cadencia objetivo no permite las observaciones mínimas de velocidad en esa ventana")
        if self.capability_gates.lane_flow_enabled and (not self.lanes or not self.count_lines):
            raise ValueError("El aforo requiere carriles y líneas de conteo")
        return self


def load_camera_config(path: str | Path) -> CameraConfig:
    """Carga una configuración sin incluir valores secretos en los errores."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Configuración JSON inválida en línea {error.lineno}, columna {error.colno}") from None
    if not isinstance(payload, dict):
        raise ValueError("La configuración debe ser un objeto JSON")
    if payload.get("design_template_only") or payload.get("schema_version") == "1.0-design":
        raise ValueError("Esta es una plantilla de diseño, no una configuración operativa; utiliza configs/demo.json o configs/file.json y completa su geometría")
    try:
        return CameraConfig.model_validate(payload)
    except ValidationError as error:
        messages = [f"{'.'.join(map(str, item['loc'])) or 'configuración'}: {item['msg']}" for item in error.errors(include_input=False, include_context=False, include_url=False)]
        raise ValueError("Configuración no válida: " + "; ".join(messages)) from None


def public_config(config: CameraConfig) -> dict:
    """Metadatos de dashboard: nunca URI, nombres de secretos ni puntos de ajuste."""
    result = config.model_dump(mode="json")
    result["source"] = {"kind": config.source.kind, "mode": config.source.mode, "public_alerts_enabled": False}
    result["calibration"] = {
        "status": config.calibration.status,
        "calibration_id": config.calibration.calibration_id,
        "frame_size_px": config.calibration.frame_size_px,
        "validation_rmse_metres": config.calibration.validation_rmse_metres,
    }
    result["lanes"] = [{"id": lane.id} for lane in config.lanes]
    result["count_lines"] = [{"id": line.id, "lane_id": line.lane_id, "direction": line.direction} for line in config.count_lines]
    result.pop("shoulder_zones", None)
    result.pop("normal_stop_zones", None)
    return result
