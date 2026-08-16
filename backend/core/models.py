"""Pydantic input models for request validation."""
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
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
    status: str = "available"


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


class AiQuery(BaseModel):
    question: str
