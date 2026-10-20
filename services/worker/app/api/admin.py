"""Endpoint admin & data dasar (BLUEPRINT 13)."""

import asyncio
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.api.deps import AuthUser, admin_user, current_user
from app.db import get_engine
from app.scheduler.runner import JOBS

router = APIRouter()
WIB = ZoneInfo("Asia/Jakarta")


@router.post("/v1/admin/jobs/{name}/run")
async def run_job(name: str, _: AuthUser = Depends(admin_user)) -> dict[str, Any]:
    fn = JOBS.get(name)
    if fn is None:
        raise HTTPException(404, f"job tidak dikenal: {name}. Tersedia: {sorted(JOBS)}")
    stats = await asyncio.to_thread(fn)
    return {"job": name, "stats": stats}


@router.get("/v1/gameweeks/current")
def gameweeks_current(_: AuthUser = Depends(current_user)) -> dict[str, Any]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select g.number, g.deadline_utc, g.is_current, g.is_next, g.is_finished,
                       g.is_blank, g.is_double, g.bonus_confirmed, g.leagues_updated
                from public.gameweeks g
                join public.seasons s on s.id = g.season_id and s.is_current
                where g.is_current or g.is_next
                order by g.number
                """
            )
        ).mappings()
        out: dict[str, Any] = {"current": None, "next": None}
        for r in rows:
            item = dict(r)
            item["deadline_wib"] = r["deadline_utc"].astimezone(WIB).isoformat()
            if r["is_current"]:
                out["current"] = item
            if r["is_next"]:
                out["next"] = item
    return out
