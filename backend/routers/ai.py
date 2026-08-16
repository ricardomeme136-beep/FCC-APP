"""AI operations assistant — grounded strictly in real tenant data."""
import os
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core.db import db, NO_ID
from core.models import AiQuery
from core.security import current_user, tenant_query

router = APIRouter(prefix="/ai", tags=["ai"])

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

SYSTEM = (
    "És o assistente operacional da plataforma WasteFlow, um sistema de gestão de "
    "recolha de resíduos. Respondes SEMPRE em Português de Portugal, de forma "
    "concisa e profissional. Baseias-te EXCLUSIVAMENTE nos dados reais fornecidos "
    "no contexto JSON. NUNCA inventes números, nomes ou factos. Se a informação "
    "não estiver no contexto, diz claramente que não tens esses dados. Usa listas "
    "curtas quando fizer sentido."
)


async def _build_context(user: dict) -> dict:
    tq = tenant_query(user)
    today = datetime.now(timezone.utc).date().isoformat()
    vehicles = await db.vehicles.find(tq, NO_ID).to_list(500)
    drivers = await db.drivers.find(tq, NO_ID).to_list(500)
    routes = await db.routes.find(tenant_query(user, {"date": today}), NO_ID).to_list(500)
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"scheduled_date": today}), NO_ID).to_list(10000)
    incidents = await db.incidents.find(
        tenant_query(user, {"status": {"$in": ["open", "assigned", "in_progress"]}}),
        NO_ID).to_list(200)

    def dstat(d):
        dt = [t for t in tasks if t.get("driver_id") == d["id"]]
        comp = len([t for t in dt if t["status"] == "collected"])
        return {"nome": d["name"], "recolhas_concluidas": comp,
                "recolhas_falhadas": len([t for t in dt if t["status"] == "failed"]),
                "total_atribuido": len(dt)}

    fail_by_container = {}
    for t in tasks:
        if t["status"] == "failed":
            fail_by_container[t["container_id"]] = fail_by_container.get(t["container_id"], 0) + 1

    return {
        "data": today,
        "resumo": {
            "viaturas_total": len(vehicles),
            "viaturas_em_rota": len([v for v in vehicles if v.get("status") == "en_route"]),
            "recolhas_hoje": len(tasks),
            "concluidas": len([t for t in tasks if t["status"] == "collected"]),
            "falhadas": len([t for t in tasks if t["status"] == "failed"]),
            "pendentes": len([t for t in tasks if t["status"] in ("scheduled", "en_route", "arrived")]),
            "ocorrencias_ativas": len(incidents),
        },
        "rotas": [{"codigo": r["code"], "estado": r["status"],
                   "motorista": r.get("driver_name"),
                   "num_recolhas": r.get("num_stops"),
                   "distancia_km": r.get("distance_km"),
                   "duracao_estimada_min": r.get("duration_min")} for r in routes],
        "motoristas": [dstat(d) for d in drivers],
        "contentores_falhados_repetidamente": {k: v for k, v in fail_by_container.items() if v >= 2},
        "ocorrencias": [{"tipo": i["kind"], "prioridade": i.get("priority"),
                         "estado": i["status"]} for i in incidents[:30]],
    }


@router.post("/ask")
async def ask(body: AiQuery, user: dict = Depends(current_user)):
    context = await _build_context(user)
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"wf-{user['id']}",
            system_message=SYSTEM,
        ).with_model("anthropic", "claude-sonnet-4-6")
        prompt = (
            "CONTEXTO (dados reais da operação, em JSON):\n"
            + json.dumps(context, ensure_ascii=False)
            + "\n\nPERGUNTA DO GESTOR:\n" + body.question
        )
        answer = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        answer = ("Não foi possível contactar o assistente de IA neste momento. "
                  f"(Detalhe técnico: {type(e).__name__})")

    await db.ai_conversations.insert_one({
        "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
        "user_id": user["id"], "question": body.question, "answer": answer,
        "created_at": datetime.now(timezone.utc).isoformat()})
    return {"answer": answer, "context_summary": context["resumo"]}


@router.get("/suggestions")
async def suggestions(user: dict = Depends(current_user)):
    return {"suggestions": [
        "Quantas recolhas fizemos hoje?",
        "Quais são as rotas em atraso hoje?",
        "Qual é o motorista mais eficiente?",
        "Que contentores foram falhados várias vezes?",
        "Quantas ocorrências estão ativas?",
        "Que rotas podem ser melhoradas?",
    ]}
