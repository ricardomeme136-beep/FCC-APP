# Estado da sessão — WasteFlow / FCC-APP

Última atualização: 2026-08-19 (fecho de sessão após Fase 2, commit `3d9dd84`).

## Implementado e estável

- Autenticação (JWT, bcrypt, login por email ou username)
- Multi-tenant (isolamento por `company_id` em todos os endpoints)
- Motoristas (CRUD real, conta de login opcional, presença/atividade real)
- Viaturas (CRUD)
- Contentores (CRUD, arquivo/eliminação)
- Criação e execução de rotas (otimização automática + criador manual/mapa)
- `route_stops` (paragens persistidas, reorder/mover/adicionar/remover)
- Tracking / gravar trajeto (sessões de gravação do motorista, imutáveis)
- GPS em background no Android (só durante rota em curso ou gravação ativa)
- Fila offline de pontos GPS (persistente, envio em lote, idempotente)
- Mapa ao vivo do admin (GPS real, filtro de privacidade)
- Routing via OpenRouteService (ORS), com fallback a linha reta sem chave
- Navegação turn-by-turn (apresentação PT-PT, ícones de manobra)
- ETA operacional (navegação + tempo de serviço por contentor)
- Route templates (biblioteca de rotas reutilizáveis, aba ROTAS)
- Criação de execução a partir de template (aba EXECUÇÕES)
- Proteção de rotas históricas (`assert_route_editable` — completed/cancelled
  bloqueadas, in_progress só permite reoptimize)

## Fases concluídas

- **Fase 0** — checkpoint de estabilidade + proteção de rotas históricas (commit `ac8beb1`)
- **Fase 1** — route templates: modelo, CRUD, editor, save-as-template (rota e trajeto) (commit `3e6768d`)
- **Fase 2** — criar execução a partir de template, snapshot garantido (commit `3d9dd84`)

## Próximo passo

**FASE 3 — Agenda semanal / recorrência**

Objetivo futuro (ainda não iniciado):
- calendário;
- dias da semana;
- escolher template;
- hora;
- motorista;
- viatura;
- várias execuções da mesma rota;
- recorrência.

## Pendentes conhecidos (não corrigidos hoje)

- Heading/bússola no Android real ainda não está a funcionar corretamente
  — comportamento visual do ponteiro GPS precisa de melhoria/revalidação
- Sistema de disponibilidade dos motoristas (férias, baixa, folga,
  indisponível, override com password) — não implementado
- Estados das viaturas (disponível, avariada, em reparação, indisponível)
  — não implementado
- Futura role de mecânico — não implementada
- Ocorrências numa aba própria — não implementado
- Contentores com ocorrência ativa a vermelho no mapa — não implementado
- Sistema consistente de ícones por entidade — por rever/uniformizar
- Decidir/remover a aba Clientes
- Redesign geral ainda incompleto
- GPS/mapa "heading-up" — investigado como viável (via `leaflet-rotate`),
  não implementado; pode ser avaliado no futuro
- Validar novamente navegação real em estrada (Android físico)

## Base de testes — regra obrigatória

Os testes de backend **têm de correr sempre** com `MONGO_URL`/`DB_NAME`
explicitamente apontados para uma base isolada, exportados no ambiente
*antes* de arrancar o backend E antes de correr o `pytest` — nunca deixar
que o backend ou os testes usem a base real de `backend/.env`
(`wasteflow`). Isto é crítico porque alguns testes (`_direct_db()` em
`test_route_stops.py`, `test_activity.py`, etc.) fazem escrita direta na
base de dados; se `MONGO_URL`/`DB_NAME` não estiverem no ambiente antes do
processo arrancar, o `load_dotenv()` de `core/db.py` carrega os valores
reais do `.env` como fallback e essas escritas vão parar à base ao vivo.

Padrão usado nesta sessão (repetir sempre):
```
MONGO_URL=mongodb://localhost:27017 DB_NAME=<nome_temporario_isolado> \
  .venv/Scripts/python.exe -m uvicorn server:app --host 127.0.0.1 --port <porta_livre>

MONGO_URL=... DB_NAME=<mesmo_nome> .venv/Scripts/python.exe seed_test_fixtures.py

export MONGO_URL=... DB_NAME=<mesmo_nome> EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:<porta>
.venv/Scripts/python.exe -m pytest tests/ -q
```
No fim: parar o processo isolado e `drop_database()` na base temporária.
Já foi confirmado que esta base isolada nunca coincide com a porta 8000
(backend real do utilizador) nem com a base `wasteflow` (dados reais da
FCC Meio Ambiente + fixtures QA antigas).

Este processo já está a ser seguido corretamente — não foi necessário
alterar código para o garantir.
