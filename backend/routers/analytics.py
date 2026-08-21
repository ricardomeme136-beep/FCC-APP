"""Analytics, dashboard KPIs, statistics, and smart anomaly alerts."""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends

from core.db import db, NO_ID
from core.security import current_user, tenant_query
from core.activity import annotate_driver_activity

router = APIRouter(prefix="/analytics", tags=["analytics"])

CO2_PER_KM = 0.9      # kg CO2 per km (heavy diesel truck)
FUEL_PER_KM = 0.35    # litres per km
COST_PER_KM = 1.2     # euros per km


def _today():
    return datetime.now(timezone.utc).date().isoformat()


@router.get("/dashboard")
async def dashboard(user: dict = Depends(current_user)):
    today = _today()
    tq = tenant_query(user)

    vehicles = await db.vehicles.find(tq, NO_ID).to_list(2000)
    active_trucks = len([v for v in vehicles if v.get("status") in ("en_route", "assigned")])

    tasks = await db.collection_tasks.find(
        tenant_query(user, {"scheduled_date": today}), NO_ID).to_list(10000)
    total = len(tasks)
    completed = len([t for t in tasks if t["status"] == "collected"])
    failed = len([t for t in tasks if t["status"] == "failed"])
    pending = len([t for t in tasks if t["status"] in ("scheduled", "en_route", "arrived")])

    # overdue: still pending on active routes past 40% of the day
    overdue = 0
    routes = await db.routes.find(tenant_query(user, {"date": today}), NO_ID).to_list(1000)
    delayed_routes = 0
    for r in routes:
        rtasks = [t for t in tasks if t["route_id"] == r["id"]]
        done = len([t for t in rtasks if t["status"] in ("collected", "failed")])
        if r["status"] == "in_progress" and rtasks and done / max(len(rtasks), 1) < 0.5:
            delayed_routes += 1
            overdue += len([t for t in rtasks if t["status"] in ("scheduled", "en_route")])

    active_incidents = await db.incidents.count_documents(
        tenant_query(user, {"status": {"$in": ["open", "assigned", "in_progress"]}}))

    active_routes = len([r for r in routes if r["status"] == "in_progress"])

    recent_incidents = await db.incidents.find(
        tenant_query(user), NO_ID).sort("created_at", -1).to_list(6)

    # Real driver presence — never derived from employment_status or the
    # simulated GPS loop, only from login/heartbeat + real route status.
    drivers = await db.drivers.find(tq, NO_ID).to_list(2000)
    await annotate_driver_activity(user, drivers)
    active_drivers = [d for d in drivers if d["activity_status"] != "offline"]
    # Specifically "on_route" — the same source of truth (annotate_driver_
    # activity) the painel's MOTORISTAS list and the live map already use to
    # decide EM ROTA / who gets a map marker. active_drivers above mixes in
    # "online" too (present in the app, no route) — kept as-is since it's
    # asserted on directly in tests/test_activity.py, but it must never be
    # what a "X motoristas em rota" KPI reads from.
    drivers_on_route = len([d for d in drivers if d["activity_status"] == "on_route"])

    # Presence list for the painel's MOTORISTAS section — distinct from
    # active_drivers above (which only feeds the "active_drivers" KPI count).
    # Includes OFFLINE drivers too (so "was active earlier today" stays
    # visible), as long as they have ever sent a heartbeat; a driver who has
    # never opened the app has nothing useful to show and is left out.
    # Never capped — presence has nothing to do with GPS/privacy, it's just
    # "who has the app open", so there is no reason to hide anyone here.
    presence_drivers = [d for d in drivers if d.get("last_seen_at")]
    STATUS_RANK = {"on_route": 0, "online": 1, "offline": 2}
    # Two-pass stable sort: most-recent last_seen_at first WITHIN each status
    # group, groups ordered on_route -> online -> offline.
    presence_drivers.sort(key=lambda d: d.get("last_seen_at") or "", reverse=True)
    presence_drivers.sort(key=lambda d: STATUS_RANK.get(d["activity_status"], 3))

    return {
        "kpis": {
            "active_trucks": active_trucks,
            "collections_today": total,
            "completed": completed,
            "failed": failed,
            "overdue": overdue,
            "active_incidents": active_incidents,
            "active_drivers": len(active_drivers),
            "drivers_on_route": drivers_on_route,
        },
        "active_routes": active_routes,
        "delayed_routes": delayed_routes,
        "pending": pending,
        "recent_incidents": recent_incidents,
        "active_drivers_list": [
            {
                "id": d["id"], "name": d["name"], "activity_status": d["activity_status"],
                "current_route_code": d.get("current_route_code"),
                "current_vehicle_plate": d.get("current_vehicle_plate"),
                "last_seen_at": d.get("last_seen_at"),
            }
            for d in presence_drivers
        ],
        "alerts": await _smart_alerts(user, routes, tasks),
    }


async def _smart_alerts(user, routes, tasks):
    alerts = []
    # Fase 1 — alertas: repeated-failure alerts are persisted, deduplicated
    # documents (routers/alerts.py + routers/tasks.py upsert them on every
    # failed/successful collection) — no longer recomputed from the full
    # collection_tasks history on every dashboard load, which is what made
    # them look permanent (nothing ever marked one "no longer relevant").
    # occurrence_count>=2 keeps the exact same visibility threshold as before.
    open_alerts = await db.alerts.find(
        tenant_query(user, {"status": "open", "occurrence_count": {"$gte": 2}}),
        NO_ID).sort("last_failure_at", -1).to_list(200)
    for a in open_alerts:
        # .get() rather than a["..."] on purpose: one malformed alert
        # document (there is no legitimate way to produce one through the
        # app, only e.g. a manual DB edit) must never take down the whole
        # dashboard for every KPI/section on this endpoint.
        if not a.get("id"):
            continue
        alerts.append({
            "id": a["id"], "type": a.get("type"), "severity": a.get("severity", "high"),
            "message": a.get("message", ""), "container_id": a.get("container_id"),
        })
    # route running slower than historic average duration
    for r in routes:
        if r["status"] == "in_progress" and r.get("duration_min"):
            hist_avg = await db.routes.aggregate([
                {"$match": tenant_query(user, {"status": "completed",
                                               "actual_duration_min": {"$ne": None}})},
                {"$group": {"_id": None, "avg": {"$avg": "$actual_duration_min"}}},
            ]).to_list(1)
            if hist_avg and hist_avg[0]["avg"]:
                avg = hist_avg[0]["avg"]
                if r["duration_min"] > avg * 1.25:
                    pct = round((r["duration_min"] / avg - 1) * 100)
                    alerts.append({
                        "type": "slow_route", "severity": "medium",
                        "message": f"A Rota {r['code']} está {pct}% mais lenta que a média.",
                        "route_id": r["id"],
                    })
    return alerts[:8]


@router.get("/stats")
async def stats(user: dict = Depends(current_user)):
    tq = tenant_query(user)
    all_tasks = await db.collection_tasks.find(tq, NO_ID).to_list(20000)
    total = len(all_tasks)
    completed = [t for t in all_tasks if t["status"] == "collected"]
    failed = [t for t in all_tasks if t["status"] == "failed"]
    ignored = [t for t in all_tasks if t["status"] == "ignored"]

    routes = await db.routes.find(tq, NO_ID).to_list(5000)
    total_km = sum(r.get("distance_km", 0) for r in routes)
    total_weight = sum(t.get("load_kg") or 0 for t in completed)

    # per-driver performance
    drivers = await db.drivers.find(tq, NO_ID).to_list(2000)
    driver_stats = []
    for d in drivers:
        dtasks = [t for t in all_tasks if t.get("driver_id") == d["id"]]
        dcomp = [t for t in dtasks if t["status"] == "collected"]
        dfail = [t for t in dtasks if t["status"] == "failed"]
        driver_stats.append({
            "id": d["id"], "name": d["name"],
            "completed": len(dcomp), "failed": len(dfail),
            "total": len(dtasks),
            "completion_rate": round(len(dcomp) / max(len(dtasks), 1) * 100, 1),
        })
    driver_stats.sort(key=lambda x: x["completion_rate"], reverse=True)

    # waste breakdown
    waste = {}
    for t in completed:
        waste[t["waste_type"]] = waste.get(t["waste_type"], 0) + (t.get("load_kg") or 0)

    return {
        "totals": {
            "total": total, "completed": len(completed), "failed": len(failed),
            "ignored": len(ignored),
            "completion_rate": round(len(completed) / max(total, 1) * 100, 1),
            "distance_km": round(total_km, 1),
            "weight_kg": round(total_weight, 1),
            "fuel_l": round(total_km * FUEL_PER_KM, 1),
            "co2_kg": round(total_km * CO2_PER_KM, 1),
            "cost_eur": round(total_km * COST_PER_KM, 1),
            "cost_per_collection": round(total_km * COST_PER_KM / max(len(completed), 1), 2),
        },
        "drivers": driver_stats,
        "waste_breakdown": waste,
        "routes_count": len(routes),
    }
