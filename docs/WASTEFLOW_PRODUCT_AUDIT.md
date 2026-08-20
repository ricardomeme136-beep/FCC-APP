# Auditoria de produto & arquitetura — WasteFlow

Data: 2026-08-20
Âmbito: leitura completa do backend, frontend e fluxos reais da aplicação. Nenhum código foi alterado, criado ou commitado na produção desta auditoria.

Cada observação está ligada a um ficheiro ou endpoint concreto, nunca a uma impressão geral. Publicada originalmente como artifact interativo; este documento é a cópia de referência permanente dentro do repositório.

---

## Índice

1. Arquitetura
2. Fluxo operacional
3. Motoristas
4. Viaturas
5. Contentores
6. Ocorrências
7. Mapa
8. Rotas / Agenda
9. GPS / Navegação
10. Dashboard
11. Clientes
12. Roles
13. Design / UX
14. Histórico / Analytics
15. Notificações
16. Segurança / Auditoria
17. Produção
18. Prioridades (P0–P3)

---

## 1. Arquitetura

O esqueleto do produto — o que está bem separado, o que está a colar-se por dentro, e o que hoje funciona mas foi construído para a escala de um piloto, não de uma frota grande.

### Bem separado

- `tenant_query()` é o único ponto de entrada para isolar dados por empresa, e é usado de forma disciplinada em **todos** os routers sem exceção — é provavelmente a maior força estrutural do backend. Nenhum endpoint testado contorna esta função.
- Routers divididos por domínio (`auth`, `entities`, `routes`, `tasks`, `gps`, `incidents`, `analytics`, `route_templates`, `route_schedules`, `tracking`) — fronteiras claras, fáceis de navegar.
- A separação **route_template** (plano reutilizável, stops embutidos) vs. **route** (execução operacional, histórico imutável) é uma decisão de arquitetura genuinamente bem pensada e documentada no próprio código — não uma separação acidental.
- GPS em segundo plano (`backgroundLocationTask.ts`) e a UI de navegação em primeiro plano (`navegacao.tsx`) estão corretamente desacoplados — dois sistemas independentes, cada um com a sua única responsabilidade, confirmado ao investigar o bug do marcador.

### Acoplamento e duplicações

- `routers/routes.py` tem **1200 linhas** — de longe o maior ficheiro do backend (o segundo maior, `route_schedules.py`, tem 455). Faz criação manual, otimização automática, edição de paragens, ciclo de vida (iniciar/terminar/eliminar), atribuição, e ainda expõe `_route_code`, `assert_route_editable` e `check_scheduling_conflicts` como funções privadas importadas diretamente por `route_templates.py` e `route_schedules.py`. Funciona, mas é um acoplamento frágil — uma "API interna" que se tornou de facto pública sem ser desenhada para isso.
- O padrão `new Date().toISOString().slice(0,10)` (a causa do bug da "rota de sexta a aparecer como hoje") existia em pelo menos três sítios: `agenda.tsx` e `rota.tsx` (ambos já corrigidos numa sessão anterior) e ainda em `execucoes.tsx`/`template/[id].tsx` (`nextDays()`) e `mapa.tsx` — estes últimos por corrigir.
- No mapa (`leafletHtml.ts`), 8 tipos de marcador estão definidos mas só 3 (`truck`, `driver`, `waste_bin`) têm ícone próprio — os restantes caem todos no mesmo círculo genérico.

### Dívida técnica

- A coleção `collections` é escrita a cada recolha concluída (`tasks.py::complete_task`) mas **nunca lida por nenhum endpoint** — dados órfãos, prontos para alimentar um histórico/replay que ainda não existe (ver secção 14).
- `GET /zones` existe, mas não há `POST`/`PATCH` — zonas só podem ser criadas por seeding direto na base de dados, apesar de serem um filtro de primeira classe em contentores e templates.
- `mapa.tsx` tem um bloco de `console.log` permanente marcado "TEMPORARY — remover depois de confirmado" que nunca foi removido — o mesmo padrão já corrigido noutra sessão em `navegacao.tsx` (agora atrás de `SHOW_NAV_DEBUG=false`) ainda não foi aplicado aqui.
- Na raiz do repositório: dois ficheiros vazios sem propósito (`New Documento de Texto.txt`, `readme.txt`) e uma reorganização recente dos scripts `start-*.bat` (apagados, substituídos por `Temp-StartUp/`) que ficou por commitar — vale uma decisão deliberada em vez de ficar indefinidamente em limbo no `git status`.

### Risco em escala

- Todo o endpoint de listagem tem um `.to_list(N)` fixo (1000 a 20000) sem paginação real — `GET /audit-logs` corta em 200, `GET /routes` em 1000. Sem problema à escala de piloto; corta dados silenciosamente assim que a operação crescer.
- `GET /schedule/calendar` materializa *todos* os schedules ativos que intersetam o intervalo pedido, em cada chamada — ótimo com poucos schedules, torna-se um leque de N queries por vista de agenda à medida que a recorrência cresce.
- MongoDB corre apenas num contentor Docker local, sem réplica, sem backup automático — ver secção 17.

> **Reorganização recomendada**: extrair `_route_code`, `assert_route_editable` e `check_scheduling_conflicts` para um módulo partilhado (ex. `core/route_shared.py`) antes de aparecer um terceiro consumidor. Decidir o destino de `collections` (usar ou deixar de escrever). Dar a `zones` um CRUD real ou despromovê-la a etiqueta livre.

---

## 2. Fluxo operacional

A rotina de um gestor, passo a passo, tal como a app a apresenta hoje.

- **Planear rota** — dois caminhos coexistem: reutilizar um template (aba ROTAS) ou criar uma execução avulsa (EXECUÇÕES → automático/mapa). Ambos funcionam bem isoladamente, mas nada na interface explica a um gestor novo qual escolher — a distinção só faz sentido depois de já se conhecer o modelo.
- **Agendar** — depois das últimas rondas, é hoje a área mais madura do produto: recorrência, cancelamento de uma ocorrência isolada sem afetar as restantes, proteção de edições manuais. Ver secção 8.
- **Escolher motorista/viatura** — os avisos de conflito são sempre "soft" (nunca bloqueiam), o que é uma escolha de design coerente e documentada — mas não existe uma vista central de "quem está livre hoje" antes de começar a atribuir; a informação só aparece um motorista de cada vez, no momento da escolha.
- **Acompanhar GPS** — o mapa admin e o mini-mapa do painel estão sólidos. A navegação do próprio motorista acabou de passar por três correções reais nesta ronda de trabalho (marcador, data, painel de contentor) — a parte mais fresca e ainda por validar em Android real.
- **Tratar ocorrências** — a parte mais fraca do fluxo hoje. Ver secção 6.
- **Consultar histórico** — os dados existem e nunca são apagados quando há trabalho real, mas não há uma página que os reúna; hoje é preciso ir rota a rota.
- **Reagir a avarias/faltas/férias** — só motoristas têm um campo de estado (`employment_status`), sem datas nem calendário. Viaturas não têm equivalente algum.
- **Analisar desempenho** — `/estatisticas` já calcula taxa de conclusão por motorista, custo, combustível, CO₂ e distribuição por tipo de resíduo — uma base sólida, mas sem seletor de período e sem exportação.

### Passos confusos

- Criar uma execução avulsa e agendar uma recorrente acabam ambos como o mesmo documento `routes`, por dois caminhos estruturalmente diferentes — não está errado, mas exige já entender o modelo para escolher bem.
- O botão "AGENDAR / CRIAR EXECUÇÃO" no editor de template e o botão "+ AGENDAR ROTA" na Agenda fazem essencialmente a mesma coisa a partir de dois pontos de entrada distintos.

---

## 3. Motoristas

O que já existe, o que falta, sem implementar nada.

- **Férias / baixa / folga** — existe um campo de estado (`ativo`|`inativo`|`ferias`|`baixa`|`indisponivel`), mas sem intervalo de datas. `check_scheduling_conflicts` nunca sabe disto — só o valor atual, atualizado à mão. **Prioridade P1**: desbloqueia tudo o resto desta secção.
- **Horários / turnos** — inexistente. Não há hora de entrada/saída própria do motorista, só o `planned_start_time` de cada execução.
- **Substituições** — nada automatizado; hoje é uma edição manual do `driver_id` numa execução (e a proteção `schedule_overridden` já impede que essa troca seja apagada por uma futura edição da recorrência — uma boa base já pronta).
- **Histórico** — parcial: `GET /drivers/{id}` já calcula taxa de conclusão/falha a partir das tarefas, mas não há uma linha do tempo de eventos (mudanças de estado, avaliações).
- **Documentos** — carta de condução já tem número, tipo e *data de validade* no modelo — mas nenhum alerta é gerado quando essa data se aproxima, e não há upload de ficheiro.
- **Permissões** — já bem implementadas; um motorista só vê e edita o que é seu.

> **Ordem sugerida**: 1) Indisponibilidade com datas · 2) Alerta de validade de carta (o campo já existe) · 3) Turnos/horários · 4) Documentos anexados · 5) Substituição assistida.

---

## 4. Viaturas

A área com menos investimento do produto hoje — sem paralelo com o que já existe em motoristas.

- O modelo (`VehicleIn`) tem só `plate`, `brand`, `model`, `year`, `capacity_kg`, `allowed_waste_types` e um `status` em **texto livre, sem validação** — qualquer valor é aceite; a UI convenciona "available/assigned/en_route/maintenance/out_of_service" mas o backend nunca impõe isso.
- **Quilometragem** — não existe nenhum campo. Sem isto, manutenção programada por km é impossível.
- **Avariada / em reparação / inspeção / manutenção programada / histórico de avarias / oficina / mecânicos / alertas** — nenhum destes existe, nem sequer como campo básico. É a lacuna mais limpa (greenfield) de toda a auditoria.

> **Para uma empresa de recolha real** — prioridade: 1) `status` como enum real + `odometer_km` (P1, baixo esforço) · 2) manutenção programada por data OU km com alerta (P1) · 3) histórico de avarias/reparações em coleção própria (P2) · 4) papel de mecânico + oficina (P2, depende de #1-3) · 5) alerta de inspeção periódica (P2).

---

## 5. Contentores

- **Bem feito:** `last_collection` é realmente atualizado a cada recolha (`tasks.py::complete_task`), `qr_code` é gerado automaticamente, o histórico de tarefas por contentor está disponível em `GET /containers/{id}`, e a disponibilidade para o criador de rotas é calculada em tempo real com uma *razão explícita* ("Sem localização GPS", "Já atribuído à Rota X") em vez de um booleano cego.
- `next_collection` existe no modelo mas **nunca é escrito por ninguém** — campo morto, sempre `null`.
- `frequency` e `schedule_days` existem no modelo mas não há código que os leia — parecem puramente descritivos hoje, não alimentam `next_collection` nem nenhuma sugestão.
- `photos: []` existe no documento, mas não há endpoint para lá colocar uma foto fora do fluxo de conclusão de tarefa/incidente — fica sempre vazio.
- "Contentores problemáticos" só existe como um dos alertas rotativos do dashboard (`_smart_alerts`, ≥2 falhas), partilhando um limite de 8 alertas com outros tipos — não há uma lista dedicada.
- `capacity_kg` é guardado mas não usado em lado nenhum visível — nem no criador de rotas nem em alertas automáticos de "cheio" (isso só chega via ocorrência manual).

> **Prioridade**: calcular `next_collection` a partir de `frequency` (P1 — ativa um campo já existente e já mostrado no mapa e no detalhe) · lista dedicada de contentores problemáticos (P2) · foto do contentor fora de incidentes (P3).

---

## 6. Ocorrências

O modelo de dados é mais capaz do que a interface deixa transparecer.

- O modelo já suporta `kind`, `priority`, `description`, `container_id`, `customer_id`, `lat`/`lng` e `photo_url`.
- **Mas a lista não tem filtros** (nem por estado nem por prioridade), e não existe nenhum botão para o gestor **criar uma ocorrência manualmente** a partir da app — hoje só nascem automaticamente (recolha falhada) ou através do motorista.
- O detalhe (`incident/[id].tsx`) mostra tipo, prioridade, descrição e 4 botões de transição de estado — e mais nada. **Sem foto, apesar de `photo_url` já existir no modelo.** Sem mapa, apesar de `lat`/`lng` já existirem. Sem thread de comentários.
- Quando uma recolha falha, o backend já grava `route_id` e `driver_id` diretamente na ocorrência (`tasks.py::fail_task`) — mas o modelo de entrada usado na criação manual (`IncidentIn`) não expõe esses campos, por isso uma ocorrência criada à mão nunca fica ligada a uma rota/viatura/motorista.

> **Prioridade**: mostrar a foto no detalhe e adicionar filtros à lista (P1, o dado já existe — é o ganho mais barato de toda a auditoria) · expor `route_id`/`vehicle_id`/`driver_id` na criação manual (P1) · mapa no detalhe (P2) · thread de comentários (P2) · SLA/tempo até resolução (P3).

---

## 7. Mapa

"Tudo o que representa pessoa deve parecer pessoa. Contentor deve parecer contentor. Viatura deve parecer viatura." — hoje, 2 em 3.

- **Pessoa parece pessoa:** o motorista em rota já usa um ícone próprio (figura humana, nome, cone de direção quando há heading, esmaecido quando a posição está desatualizada) — bem conseguido.
- **Contentor parece contentor:** ícone de caixote (`waste_bin`) próprio, com clustering — mas *só* os contentores agrupam; motoristas nunca são agrupados, uma decisão certa e deliberada.
- **Viatura NÃO parece viatura:** no mapa admin, uma viatura em rota é sempre representada com o ícone `driver` (uma pessoa) — nunca com o ícone `truck` (só usado na navegação do próprio motorista). "Onde está a viatura X" mostra sempre um boneco, nunca um camião.
- Ocorrências e depósitos/centros de tratamento partilham o mesmo círculo genérico com uma letra dentro (ex. "★"/"C") — nenhum tem forma própria; `leafletHtml.ts` só distingue de facto `truck`/`driver`/`waste_bin`.
- Tocar num marcador de ocorrência não faz nada — `onMarker()` em `mapa.tsx` só trata ids `drv-`/`c-`/`dep-`; a informação está visível mas não é inspecionável.

> **Prioridade**: ícone próprio de ocorrência (triângulo de aviso) + torná-la clicável (P1, esforço baixo) · ícone próprio de viatura distinto do de motorista (P2) · remover o `console.log` de debug permanente (P3, trivial).

---

## 8. Rotas / Agenda

A área mais amadurecida do produto neste momento, depois de quatro rondas seguidas de trabalho.

- Templates com paragens embutidas, execuções com snapshot garantido e testado, recorrência (uma vez / dias da semana / dias úteis / todos os dias) com exclusão de datas individuais (`skip_dates`) e proteção de edições manuais (`schedule_overridden`) — este conjunto já cobre bem os cenários reais descritos nesta ronda.
- Múltiplas rotas por dia já funcionam de ponta a ponta, incluindo no ecrã do motorista (ordenadas por hora, a "em curso" sempre em primeiro).
- Conflitos de motorista/viatura já usam sobreposição real de horário (com margem de 30 min quando a duração é desconhecida), não apenas "mesmo dia".

### Por fazer

- Não há vista "por motorista" da agenda — só por dia; um motorista com rotas espalhadas por vários dias não tem uma vista agregada só dele.
- A validação de sobreposição continua a ser sempre um aviso, nunca um bloqueio — decisão consciente e já documentada no código, mas vale reconfirmar que é o comportamento pretendido a longo prazo, não só para o piloto.

---

## 9. GPS / Navegação

Sem alterar nada — só uma leitura honesta do que ainda é frágil.

- **Posição:** watcher em primeiro plano (`High`/1.5s/3m) e tarefa em segundo plano (`Balanced`/8s/20m) corretamente separados — mas a coexistência prolongada dos dois em Android real, ao longo de um turno inteiro, ainda não foi comprovadamente validada além dos testes pontuais mais recentes.
- **Heading:** fusão bússola+GPS com suavização, testada em unidade — mas o comportamento em bússolas de hardware variado (muitas vezes ruidosas em telemóveis mais baratos) continua na lista de pendentes conhecidos, segundo o próprio `SESSION_STATE.md`.
- **Follow vs. marcador:** corrigidos recentemente para serem independentes — o marcador move-se sempre, a câmara só acompanha quando faz sentido.
- **ORS:** maduro — falha com sinalização clara na UI ("ROUTING INDISPONÍVEL"), nunca finge ter dados que não tem.
- **ETA:** soma condução + serviço, documentado como aproximação, não pretende ser exato.
- **Contentor atual:** acabou de ser redesenhado (sempre visível, avança automaticamente) — ainda por validar em dispositivo real.
- **Offline:** fila de sincronização e idempotência por `point_uuid` existem em teoria; sem evidência de teste com perda de rede real prolongada.
- **Bateria:** nunca medida em campo — um turno de 8h com GPS `High` em primeiro plano mais a tarefa em segundo plano é uma incógnita real.

> **O que se considera mais frágil**: qualquer coisa que dependa da bússola de hardware variado, e o cenário de gestão agressiva de bateria em alguns fabricantes Android (Xiaomi/Huawei/Samsung) — mitigado pelo serviço em primeiro plano, mas nunca testado especificamente nesses aparelhos.

---

## 10. Dashboard

- Já tem 7 KPIs bem escolhidos (motoristas/viaturas em rota, recolhas hoje, concluídas, falhadas, em atraso, ocorrências ativas), mapa em miniatura, lista de presença de motoristas, alertas inteligentes e ocorrências recentes — sem gordura óbvia a remover.
- Distância total, custo, combustível, CO₂ e desempenho por motorista já existem, mas corretamente *fora* do painel, em `/estatisticas` — uma separação já bem feita, não uma lacuna.

> **Recomendação**: manter como está. O único KPI plausível em falta ("viaturas indisponíveis") só vale a pena depois de a secção 4 existir — hoje esse dado nem seria fiável.

---

## 11. Clientes

- A aba existe mas é uma lista só de leitura (33 linhas de código) — sem criar, editar ou eliminar na interface, apesar de o backend já ter `POST /customers`.
- Contentores têm `customer_id` opcional, mas nada no fluxo operacional depende disto hoje — o único uso real é restringir o que o role `customer` vê.

> **Faz sentido?** Só se a FCC vier a atender clientes B2B com contratos/SLA próprios — plausível para uma empresa de resíduos que serve municípios, condomínios ou empresas. Hoje está claramente pela metade. Recomenda-se uma escolha deliberada: ou se esconde a aba do menu principal até haver um caso de uso concreto, ou se investe a sério (CRUD completo + ligação a contratos) — não deixar a meio indefinidamente.

---

## 12. Roles

| Role | Estado hoje | Recomendação |
|---|---|---|
| **super_admin** | Tudo, todas as empresas | Já correto. |
| **company_admin** | Tudo no seu tenant, inclui eliminar com password | Já correto. |
| **dispatcher** | Planeia/agenda/atribui, sem eliminar histórico sensível | Já correto. |
| **operations_manager** | Hoje é sinónimo de dispatcher (mesmo grupo de permissões) | Decidir se é intencional; se não, unificar. |
| **maintenance_manager** | *Existe mas está semanticamente vazio* — nada de manutenção existe ainda | Candidato natural a gerir a secção 4 quando for construída. |
| **driver** | Bem restringido às suas próprias rotas/tarefas | Já correto. |
| **customer** | Bem restringido, mas sem superfície própria de auto-serviço | Depende da decisão da secção 11. |
| **mechanic** *(novo)* | Não existe | Só faz sentido junto com a secção 4 — veria ordens de trabalho e viaturas, nunca rotas/motoristas. |
| **supervisor** *(novo)* | Não existe | Só relevante numa estrutura maior, com mais de um nível de gestão — não urgente agora. |

---

## 13. Design / UX

### Consistência

- Sistema de tokens central (`theme.ts`) — cor, espaço, raio, tipografia — aplicado de forma disciplinada; componentes partilhados (`Btn`, `Card`, `Badge`, `ActionMenu`, `ConfirmModal`) reutilizados em quase todo o produto em vez de reinventados por página.
- Azul institucional FCC reservado para identidade/estrutura, laranja reservado para "atenção" — regra documentada e respeitada.
- Agenda e o editor de templates já têm tratamento responsivo dedicado (grelha semanal vs. tabs por dia) — um bom padrão ainda por replicar noutras páginas densas.

### Páginas que ainda parecem protótipo

- **Clientes** — lista sem interação, já discutido na secção 11.
- **Ocorrências** — lista sem filtros + 4 botões de transição, já discutido na secção 6.
- **Estatísticas** — página única, sem filtro de período.
- Inconsistência de ícones no mapa (secção 7) — vale um levantamento sistemático "1 tipo = 1 ícone" antes do produto crescer mais.

---

## 14. Histórico / Analytics

- **Histórico de rota:** os dados existem (rotas, tarefas e paragens preservados sempre que há trabalho real) mas sem página dedicada — hoje só se vê uma rota de cada vez.
- **Replay GPS:** a infraestrutura já existe — `gps_positions` com `tracking_session_id` e timestamps ordenados (trajetos gravados) — mas não há um leitor/replay visual numa linha do tempo, só o traçado estático no mapa.
- **Planeado vs. real:** já implementado (`actual_distance_km`/`actual_duration_min` comparados com o planeado, visível no detalhe de uma rota concluída).
- **Performance por motorista:** já existe em `/analytics/stats`.
- **Performance por rota/template:** não existe — nenhuma agregação por `template_id` ao longo do tempo.
- **Custos:** já calculados (`cost_eur`/`fuel_l`/`co2_kg`) mas com constantes fixas no código (`COST_PER_KM=1.2`), não configuráveis por empresa.
- **Exportações:** nenhuma, em lado nenhum (nem CSV nem PDF).

> **Prioridade**: página de histórico de rotas com filtros (P1/P2) · performance por template (P2) · exportação CSV (P2) · custos configuráveis por empresa (P3) · replay visual (P3).

---

## 15. Notificações

- Só 2 dos 8 tipos pedidos existem hoje: nova ocorrência e recolha falhada — ambos in-app apenas, nunca push real.
- `expo-notifications` só é usado para a permissão do serviço em primeiro plano no Android, nunca para enviar uma notificação de facto.
- As notificações existentes são quase sempre broadcast (`target_user_id: None`) — nunca dirigidas a um motorista específico.

> **Prioridade por tipo**:
> **P1**: rota atribuída (o `driver_id` já é conhecido no momento certo) · ocorrência urgente (quase pronto — só filtrar `priority=high`) · rota não iniciada passada a hora (precisa de um job periódico — não existe nenhuma infraestrutura de cron hoje).
> **P2**: viatura avariada / motorista indisponível (dependem das secções 3/4) · mudança de horário · rota concluída.
> Antes de qualquer push real: registo de token por dispositivo + envio via Expo Push API — nada disto existe ainda.

---

## 16. Segurança / Auditoria

### Pontos fortes reais

- `write_audit()` chamado de forma consistente em quase toda a mutação sensível — criar, editar, eliminar, arquivar, em praticamente todas as entidades.
- Eliminar um recurso com histórico real (rota, contentor) exige sempre password verificada no servidor, nunca só no cliente.
- bcrypt com 12 rounds, JWT assinado, roles verificados em cada endpoint sensível via `require_roles()`.

### Gaps

- Tokens JWT válidos por **30 dias**, sem refresh nem revogação individual (só via `disabled=true` no utilizador) — um token comprometido fica válido um mês inteiro.
- Sem *rate-limiting* no login — força bruta não mitigada.
- `GET /audit-logs` existe (restrito a super_admin/company_admin) mas não há nenhuma página frontend a consumi-lo.
- O isolamento multi-tenant é sólido no código, mas depende inteiramente da disciplina de cada novo endpoint chamar `tenant_query()` — não há nenhuma camada automática que rejeite uma query sem esse filtro.

> **Prioridade**: *rate-limit* no login (P1) · reduzir tempo de vida do JWT + refresh token (P1/P2, antes de expor à internet) · UI para audit-logs (P2) · considerar um teste automático que falhe se um endpoint novo não usar `tenant_query()` (P3).

---

## 17. Produção

Confirmado por leitura direta dos ficheiros de configuração — `docker-compose.yml`, `.env.example`, `eas.json`.

- MongoDB só local via Docker, sem backups.
- Backend corre por `uvicorn` manual num PC — nada disto sobrevive ao PC desligar.
- Frontend liga por IP de LAN ou um túnel Cloudflare temporário, explicitamente descartável ("a URL muda a cada reinício, nunca fixar").
- Sem domínio próprio, sem HTTPS real no backend.
- `eas.json` só tem o perfil `development` — não há sequer forma de gerar um APK distribuível fora de um dev-client.
- Sem CI/CD (nenhum workflow automatizado) — a suite de testes só corre manualmente.
- Sem monitorização nem logs centralizados — só a consola local do `uvicorn`.
- Sem mecanismo de atualização da app (nenhum EAS Update, nenhuma versão mínima forçada).

> **Contexto**: isto é inteiramente esperado e correto para a fase atual — validar o produto antes de gastar em infraestrutura. Mas a lista do que falta antes de "24/7 sem PC" é, literalmente, tudo o que está acima.

---

## 18. Prioridades

Compilado a partir de todas as secções anteriores — cada item com o benefício, o risco de o ignorar, a dificuldade estimada e as dependências.

### P0 — Bloqueadores (nada disto, não há produto fora do PC do utilizador)

**Hosting do backend + domínio + HTTPS**
- Benefício: acesso 24/7 sem depender do PC ligado.
- Risco de ignorar: a app para de funcionar sempre que o PC desliga — inutiliza qualquer piloto real.
- Dificuldade: média — configuração, não desenvolvimento.
- Dependências: nenhuma.

**MongoDB gerido na cloud, com backups**
- Benefício: dados reais da FCC protegidos e acessíveis de qualquer lado.
- Risco de ignorar: perda total de dados se o portátil local falhar hoje.
- Dificuldade: baixa-média.
- Dependências: nenhuma.

**Perfil de produção no EAS + build assinado**
- Benefício: instalar num telemóvel real fora de um dev-client.
- Risco de ignorar: impossível distribuir a app aos motoristas.
- Dificuldade: baixa.
- Dependências: nenhuma.

**JWT_SECRET de produção + revisão de segredos**
- Benefício: evita comprometer todas as contas no dia em que o backend fica público.
- Risco de ignorar: crítico — o valor de exemplo do `.env.example` nunca deve chegar a produção.
- Dificuldade: trivial.
- Dependências: hosting do backend.

### P1 — Importante antes de piloto real

**Validar em Android real os 3 fixes recentes (marcador GPS, data da Agenda, painel de contentor)**
- Benefício: fecha os bugs P1 mais recentes antes de qualquer coisa nova.
- Risco de ignorar: regressão silenciosa num fluxo já corrigido no código.
- Dificuldade: já feita — só falta o teste.
- Dependências: nenhuma.

**Foto visível + filtros na área de ocorrências**
- Benefício: o dado já existe — é o ganho mais barato de toda a auditoria.
- Risco de ignorar: uma área central do produto continua a parecer inacabada.
- Dificuldade: baixa.
- Dependências: nenhuma.

**Indisponibilidade de motoristas com datas**
- Benefício: os avisos de conflito passam a ser fiáveis de verdade.
- Risco de ignorar: continuar a agendar motoristas indisponíveis sem aviso automático.
- Dificuldade: média.
- Dependências: nenhuma.

**Estado real de viaturas (enum + manutenção básica)**
- Benefício: evita atribuir uma viatura avariada a uma rota.
- Risco de ignorar: acidente operacional — motorista chega à viatura e não pode sair.
- Dificuldade: média.
- Dependências: nenhuma.

**Notificação de rota atribuída + ocorrência urgente**
- Benefício: reduz a dependência de o motorista abrir a app para descobrir.
- Risco de ignorar: comunicação continua 100% manual/verbal.
- Dificuldade: baixa-média — precisa de registo de push token.
- Dependências: nenhuma.

**Rate-limit no login + revisão do tempo de vida do JWT**
- Benefício: reduz a superfície de ataque antes de ficar exposto à internet.
- Risco de ignorar: força bruta e tokens roubados válidos durante um mês.
- Dificuldade: baixa.
- Dependências: mais urgente assim que o backend for público.

**CI a correr a suite de testes em cada alteração**
- Benefício: apanha regressões antes de chegarem ao piloto.
- Risco de ignorar: continua a depender só de execução manual.
- Dificuldade: baixa.
- Dependências: nenhuma.

### P2 — Importante mas pode esperar

**Odómetro + manutenção programada de viaturas**
- Benefício: previne avarias antes de acontecerem.
- Risco de ignorar: manutenção continua reativa, nunca preventiva.
- Dificuldade: média.
- Dependências: estado real de viaturas (P1).

**Página de histórico de rotas + performance por template**
- Benefício: decisões informadas sobre que rotas otimizar.
- Risco de ignorar: dados existentes continuam invisíveis, um-a-um.
- Dificuldade: média.
- Dependências: nenhuma.

**Ícones próprios no mapa (viatura, ocorrência) + ocorrência clicável**
- Benefício: o mapa passa a ler-se de imediato, sem depender de cor/legenda.
- Risco de ignorar: confusão visual entre motorista e viatura persiste.
- Dificuldade: baixa.
- Dependências: nenhuma.

**Thread de comentários em ocorrências**
- Benefício: contexto acumulado sem reescrever a descrição.
- Risco de ignorar: perda de histórico de decisões numa ocorrência longa.
- Dificuldade: média.
- Dependências: foto+filtros em ocorrências (P1).

**Papel de mecânico + oficina**
- Benefício: `maintenance_manager` deixa de estar vazio.
- Risco de ignorar: role sem função continua a existir sem propósito.
- Dificuldade: média.
- Dependências: estado/manutenção de viaturas (P1/P2).

**Exportação CSV das estatísticas + UI para audit-logs**
- Benefício: dados já calculados tornam-se partilháveis/auditáveis.
- Risco de ignorar: continuam presos dentro da app.
- Dificuldade: baixa.
- Dependências: nenhuma.

### P3 — Melhorias futuras

**Replay visual de GPS gravado**
- Benefício: reconstituir visualmente um trajeto passado.
- Dificuldade: média-alta.
- Dependências: nenhuma — os dados já existem.

**Custos configuráveis por empresa (em vez de constantes fixas)**
- Dificuldade: baixa.
- Dependências: nenhuma.

**Decidir o futuro da aba Clientes — investir ou esconder**
- Dificuldade: baixa (decisão) / média (se investir).
- Dependências: nenhuma.

**Substituições automáticas de motorista**
- Dificuldade: alta.
- Dependências: indisponibilidade com datas (P1).

**Papel de supervisor**
- Dificuldade: baixa.
- Dependências: crescimento real da equipa de gestão.

---

*Auditoria só de leitura — nenhum ficheiro de código foi alterado, criado ou commitado.*
