"""Pydantic input models for request validation."""
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    identifier: str  # email OR username (e.g. a driver's employee number)
    password: str


class VehicleIn(BaseModel):
    plate: str
    brand: str = ""
    model: str = ""
    year: Optional[int] = None
    capacity_kg: float = 10000
    allowed_waste_types: List[str] = []
    status: str = "available"
    driver_id: Optional[str] = None


class DriverIn(BaseModel):
    name: str
    phone: str = ""
    license_number: str = ""
    license_type: str = ""
    vehicle_id: Optional[str] = None
    status: str = "available"  # OPERATIONAL state (available/assigned/...) — used by the optimizer. Do not confuse with employment_status below.
    # --- Real onboarding (Fase PROD1) — all optional ---
    employee_number: str = ""
    email: Optional[EmailStr] = None   # display/edit copy only — the login-authoritative email lives on the linked `users` document
    password: Optional[str] = None     # write-only: if set together with email, POST /drivers also creates the linked login account
    license_expiry: Optional[str] = None
    notes: str = ""
    employment_status: str = "ativo"   # ativo|inativo|ferias|baixa|indisponivel — availability/vínculo, separate from `status` above


class ContainerIn(BaseModel):
    address: str
    lat: float
    lng: float
    waste_type: str
    container_type: str = "1100L"
    capacity_kg: float = 500
    customer_id: Optional[str] = None
    zone_id: Optional[str] = None
    frequency: str = "weekly"
    schedule_days: List[str] = []
    status: str = "active"
    notes: str = ""


class ContainerUpdate(BaseModel):
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    waste_type: Optional[str] = None
    container_type: Optional[str] = None
    capacity_kg: Optional[float] = None
    status: Optional[str] = None
    zone_id: Optional[str] = None
    notes: Optional[str] = None


class DepotIn(BaseModel):
    name: str
    address: str = ""
    lat: float
    lng: float
    hours: str = "06:00 - 22:00"
    capacity: str = ""
    is_primary: bool = False  # default start/end point for routes when none is chosen manually


class FacilityIn(BaseModel):
    name: str
    kind: str = "treatment"  # landfill | recycling | treatment | transfer
    address: str = ""
    lat: float
    lng: float
    accepted_waste_types: List[str] = []
    hours: str = "06:00 - 22:00"
    contact: str = ""


class CustomerIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""


class IncidentIn(BaseModel):
    kind: str
    priority: str = "medium"
    description: str = ""
    container_id: Optional[str] = None
    customer_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    photo_url: Optional[str] = None


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None


class GpsIn(BaseModel):
    vehicle_id: str
    lat: float
    lng: float
    speed: float = 0
    heading: float = 0
    status: str = "en_route"


class TrackingSessionStartIn(BaseModel):
    lat: float
    lng: float


class TrackingPointIn(BaseModel):
    point_uuid: str  # client-generated — the idempotency key that makes a resent batch safe to replay
    lat: float
    lng: float
    timestamp: str  # device clock, ISO8601 — used to order points for playback/distance
    speed: Optional[float] = None
    heading: Optional[float] = None
    accuracy: Optional[float] = None
    altitude: Optional[float] = None


class TrackingPointsIn(BaseModel):
    points: List[TrackingPointIn]


class TaskCompleteIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    weight_kg: Optional[float] = None
    photo_url: Optional[str] = None
    notes: str = ""


class TaskFailIn(BaseModel):
    reason: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    photo_url: Optional[str] = None
    notes: str = ""


class OptimizeIn(BaseModel):
    date: Optional[str] = None
    num_trucks: int = 4
    zones: List[str] = []
    waste_types: List[str] = []
    # Explicit admin selections (Fase B) — all optional; omitted, behaviour is
    # identical to today's auto-selection.
    container_ids: Optional[List[str]] = None
    vehicle_ids: Optional[List[str]] = None
    driver_ids: Optional[List[str]] = None
    depot_id: Optional[str] = None
    facility_id: Optional[str] = None


class StopReorderIn(BaseModel):
    stop_ids: List[str]


class StopMoveIn(BaseModel):
    target_route_id: str


class StopCreateIn(BaseModel):
    container_ids: List[str]


# ---- Visual map route builder (Fase B2.1) ----

class LatLng(BaseModel):
    lat: float
    lng: float


class PreviewGeometryIn(BaseModel):
    points: List[LatLng]


class PreviewOptimizeStop(BaseModel):
    id: str
    lat: float
    lng: float


class PreviewOptimizeIn(BaseModel):
    start: LatLng
    end: LatLng
    stops: List[PreviewOptimizeStop]


class ManualRouteEndpoint(BaseModel):
    depot_id: Optional[str] = None
    facility_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class ManualRouteStopIn(BaseModel):
    lat: float
    lng: float
    address: str = ""
    container_id: Optional[str] = None


class ManualRouteIn(BaseModel):
    date: str
    start: ManualRouteEndpoint = ManualRouteEndpoint()  # omitted -> falls back to the primary depot
    end: ManualRouteEndpoint = ManualRouteEndpoint()
    stops: List[ManualRouteStopIn]
    vehicle_id: Optional[str] = None
    driver_id: Optional[str] = None
    mode: str = "manual"


# ---- Real user/driver management (Fase PROD1) ----

class UserCreateIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str
    driver_id: Optional[str] = None
    customer_id: Optional[str] = None


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    disabled: Optional[bool] = None


class PasswordResetIn(BaseModel):
    new_password: str


class RouteAssignmentIn(BaseModel):
    driver_id: Optional[str] = None
    vehicle_id: Optional[str] = None


class RouteDeleteIn(BaseModel):
    password: str


class ContainerDeleteIn(BaseModel):
    password: Optional[str] = None


class RouteStartIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None


class RouteFinishIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None


class HeartbeatIn(BaseModel):
    # Informational only — activity_status is always derived server-side
    # from a real in_progress route, never trusted from the client.
    route_id: Optional[str] = None
    vehicle_id: Optional[str] = None


class AiQuery(BaseModel):
    question: str


# ---- Route templates (Fase 1) ----

class TemplateStopIn(BaseModel):
    lat: float
    lng: float
    address: str = ""
    container_ids: List[str] = []


class RouteTemplateCreateIn(BaseModel):
    name: str
    description: str = ""
    code: Optional[str] = None
    zone_id: Optional[str] = None
    waste_type: Optional[str] = None
    start_depot_id: Optional[str] = None
    end_facility_id: Optional[str] = None
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None
    end_lat: Optional[float] = None
    end_lng: Optional[float] = None
    stops: List[TemplateStopIn] = []
    default_driver_id: Optional[str] = None
    default_vehicle_id: Optional[str] = None


class RouteTemplateUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    zone_id: Optional[str] = None
    waste_type: Optional[str] = None
    start_depot_id: Optional[str] = None
    end_facility_id: Optional[str] = None
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None
    end_lat: Optional[float] = None
    end_lng: Optional[float] = None
    default_driver_id: Optional[str] = None
    default_vehicle_id: Optional[str] = None
    active: Optional[bool] = None


class TemplateStopReorderIn(BaseModel):
    stop_ids: List[str]


class TemplateStopCreateIn(BaseModel):
    # Either attach existing containers (clustered into stops, same as
    # routes.py's add_stop) or drop a free point with no containers yet
    # (same flexibility create_manual_route already gives operational routes).
    container_ids: List[str] = []
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: str = ""


class TemplateStopUpdateIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: Optional[str] = None
    container_ids: Optional[List[str]] = None


class SaveRouteAsTemplateIn(BaseModel):
    name: str
    description: str = ""


class SaveTrackingAsTemplateIn(BaseModel):
    name: str
    description: str = ""


# ---- Route executions from templates (Fase 2) ----

class CreateExecutionFromTemplateIn(BaseModel):
    date: str
    start_time: Optional[str] = None  # "HH:MM" — planned_start_time on the created route
    driver_id: Optional[str] = None
    vehicle_id: Optional[str] = None


# ---- Weekly scheduling / recurrence (Fase 3) ----

class RouteScheduleCreateIn(BaseModel):
    template_id: str
    name: Optional[str] = None
    recurrence_type: str  # "once" | "weekly" | "weekdays" | "daily"
    start_date: str
    end_date: Optional[str] = None
    weekdays: List[int] = []  # only meaningful when recurrence_type == "weekly" (0=Mon..6=Sun)
    planned_start_time: Optional[str] = None
    driver_id: Optional[str] = None
    vehicle_id: Optional[str] = None


class CancelOccurrenceIn(BaseModel):
    date: str  # "YYYY-MM-DD" — must be a real occurrence of this schedule's recurrence rule


class RouteScheduleUpdateIn(BaseModel):
    name: Optional[str] = None
    template_id: Optional[str] = None
    recurrence_type: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    weekdays: Optional[List[int]] = None
    planned_start_time: Optional[str] = None
    driver_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    active: Optional[bool] = None
