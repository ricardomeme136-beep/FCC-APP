# WasteFlow — PRD & Estado do Projeto

## Problema (resumo)
Plataforma SaaS multiempresa de gestão de recolha de resíduos (estilo FCC). Uma única app Expo com navegação por perfil que contém três experiências: Painel de Gestão, App do Motorista e Portal do Cliente. Backend FastAPI + MongoDB. Interface em Português de Portugal.

## Arquitetura
- **Frontend**: Expo Router (React Native). Grupos de rota: `(manager)`, `(driver)`, `(customer)` + ecrãs de stack (`route/[id]`, `container/[id]`, `incident/[id]`, e páginas do menu "Mais"). Mapa via `react-native-maps` (nativo) com fallback esquemático em web (`FleetMap.web.tsx`).
- **Backend**: FastAPI modular (`core/`, `routers/`, `services/`). Motor async para MongoDB. JWT (bcrypt). Isolamento multi-tenant por `company_id` (`tenant_query`). Simulação de GPS em tempo real (loop asyncio, polling a cada 5s no frontend).
- **Otimização**: algoritmo próprio (nearest-neighbour + 2-opt) com restrições de capacidade e tipo de resíduo (`services/optimizer.py`). OR-Tools planeado para o futuro.
- **IA**: Claude Sonnet 4.6 via emergentintegrations, respostas ancoradas em dados reais (`routers/ai.py`).
- **Design**: Brutalist Mobile LIGHT — Space Grotesk (títulos) + JetBrains Mono (dados), radius 0, bordas 2pt, laranja de segurança #F97316.

## Atualização (2026-08-16b) — Redesign + Mapa GPS
- Novo design "Moderno Claro e Suave": cantos arredondados, sombras suaves, fundo cinza claro, cartões brancos, tipografia Space Grotesk, laranja mantido. Aplicado a toda a app (tema + componentes centralizados).
- Mapa em tempo real desenha as **rotas** (linhas coloridas a ligar contentores) + camiões a mover-se. Camada "ROTAS" ativável.
- Rota detalhada e app do Motorista mostram a geometria da rota num mapa de **navegação**.
- Backend: `services/routing.py` (OpenRouteService) + endpoints `GET /routes/{id}/geometry` e `POST /routes/navigate`. Fallback para linhas diretas quando não há key. Env: `ORS_API_KEY` (vazio por defeito). Para rotas por estrada reais, obter key gratuita em openrouteservice.org/dev e colocar em `/app/backend/.env`.

## Personas
Super Admin, Administrador da Empresa, Despachante, Motorista, Gestor de Operações, Gestor de Manutenção, Cliente.

## Implementado (2026-08-16)
- Autenticação JWT + 7 perfis + isolamento multi-tenant (testado: FCC vs SUMA disjuntos).
- Painel: 6 KPIs, mapa tempo real, rotas ativas/atrasadas, alertas inteligentes, ocorrências recentes.
- Mapa em tempo real com filtros de camadas + detalhe da viatura.
- Rotas: listagem, detalhe (sequência + mapa), GERAR ROTAS OTIMIZADAS, REOTIMIZAR.
- Contentores: listagem c/ filtros por tipo, detalhe com QR + histórico.
- Viaturas, Motoristas, Clientes, Depósitos, Centros de Tratamento, Estatísticas, Assistente IA, Definições.
- App do Motorista: A minha rota de hoje, próxima recolha, botões NAVEGAR/RECOLHIDO/PROBLEMA/IGNORAR, motivos de falha (cria ocorrência), idempotência, autorização e geofencing no backend.
- Portal do Cliente: contentores, horários/recolhas, comunicar problema.
- Ocorrências (tickets) com transições de estado; registo de auditoria.
- Analytics (custos, CO₂, combustível, ranking de motoristas).
- Dados demo: 3 empresas, 180 contentores, 6 rotas, 140 tarefas.

## Testes
Backend 24/24 (pytest) incluindo isolamento, autorização de motorista, geofence 409, idempotência. Frontend: 3 fluxos de perfil validados.

## Backlog / Próximas fases
- **P1**: Códigos QR digitalizados na app (expo-camera), modo offline com sincronização real, GPS em segundo plano do motorista, fotografias em Object Storage.
- **P1**: WebSockets para tempo real (atualmente polling), reprodução de histórico GPS animado.
- **P2**: OR-Tools como motor de otimização, desenho de zonas no mapa, geração automática de tarefas por horário, sensores IoT (enchimento), relatórios PDF/Excel/CSV, notificações push.
