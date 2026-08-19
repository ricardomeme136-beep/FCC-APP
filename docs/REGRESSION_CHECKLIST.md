# Checklist de regressão — WasteFlow / FCC-APP

Última atualização: 2026-08-19 (fecho de sessão após Fase 2, commit `3d9dd84`).

Documento de referência, não um relatório de execução — marcar/atualizar
sempre que uma verificação real for feita. Ver `docs/SESSION_STATE.md` para
como isolar a base de dados antes de correr testes de backend.

## Backend (`pytest tests/ -q`, isolado)

- [ ] auth — login (email/username), tokens, `require_roles`, tenant isolation
- [ ] tenants — nenhum dado de uma empresa visível a outra
- [ ] drivers — CRUD, conta de login opcional, presença/atividade real
- [ ] vehicles — CRUD
- [ ] containers — CRUD, disponibilidade, arquivo/eliminação
- [ ] routes — optimize, criador manual, reorder/mover/adicionar/remover
      stops, reassign driver/vehicle, start/finish, delete/archive
- [ ] route templates — CRUD, stops (reorder/add/update/remove), duplicate,
      archive vs delete, save-as-template (rota e trajeto)
- [ ] executions — create-execution a partir de template, snapshot
      (`TestFutureRouteTemplateSnapshot`), `planned_start_time`,
      conflitos (warnings), template arquivado bloqueia criação
- [ ] tracking — sessões de gravação, pontos idempotentes, planned vs real
- [ ] GPS — `POST /gps/location` (anti-spoof), `GET /gps/live`,
      `GET /gps/history`
- [ ] dashboard — KPIs (`active_drivers`, `drivers_on_route`), presence list

## Frontend (`tsc --noEmit`, `npm test`, `expo export android/web`)

- [ ] login
- [ ] dashboard (painel)
- [ ] rotas (biblioteca de templates)
- [ ] templates (editor — renomear, stops, mover no mapa, agendar execução)
- [ ] execuções (lista, criar automático/mapa, detalhe)
- [ ] trajetos (lista, detalhe, criar rota a partir de trajeto)
- [ ] driver route (rota do dia do motorista)
- [ ] navigation (navegação turn-by-turn do motorista)
- [ ] contentores
- [ ] admin live map (mapa ao vivo)

## Android real (dispositivo físico — não corrido hoje, só documentado)

- [ ] login
- [ ] rota do dia
- [ ] iniciar rota
- [ ] ORS segue estrada (não linha reta)
- [ ] turn-by-turn
- [ ] ETA
- [ ] contentores (lista da paragem)
- [ ] completar contentor
- [ ] gravar trajeto
- [ ] background GPS (ecrã bloqueado / app em segundo plano)
- [ ] offline/reconnect (fila local, envio em lote ao reconectar)
- [ ] heading/compass — **[KNOWN ISSUE]** ainda não funciona corretamente
      no Android real, ver `docs/SESSION_STATE.md`

---

Esta checklist não foi executada nesta sessão de fecho — foi só criada/
atualizada, conforme pedido. Nenhuma das caixas acima foi marcada.
