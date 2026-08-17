# Correr o FCC-APP (WasteFlow) localmente no Windows

Este guia arranca o projeto por completo na tua máquina, sem depender da
infraestrutura cloud onde foi originalmente construído (plataforma Emergent).
Nenhuma funcionalidade foi alterada — isto é só configuração de ambiente.

## Pré-requisitos

- **Docker Desktop** (para o MongoDB local) — https://www.docker.com/products/docker-desktop/
- **Python 3.11, 3.12 ou 3.13** — https://www.python.org/downloads/
- **Node.js 20+** (inclui `npm`) — https://nodejs.org/
- Git (já tens, é este repositório)

Confirma que tens tudo instalado abrindo um novo PowerShell e correndo:

```powershell
docker --version
python --version
node --version
npm --version
```

## 1. Base de dados (MongoDB via Docker)

A partir da raiz do repositório:

```powershell
docker compose up -d
```

Confirma que está a correr:

```powershell
docker ps
```

Deves ver um contentor chamado `wasteflow-mongo` com estado `Up`. Os dados
ficam num volume Docker nomeado (`wasteflow_mongo_data`) — sobrevivem a
reinícios do PC e a `docker compose down` (só desaparecem com
`docker compose down -v`).

## 2. Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

> Se o PowerShell recusar ativar o venv com um erro sobre "execution
> policies", corre isto primeiro (só afeta esta sessão do terminal):
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

```powershell
pip install --upgrade pip
pip install -r requirements-local.txt
```

`requirements-local.txt` é como o `requirements.txt` original, mas sem o
pacote `emergentintegrations` (privado da plataforma Emergent, não instalável
fora dela) e sem o que só existia para o servir (SDKs Google AI/AWS, Stripe,
etc.). O `requirements.txt` original fica intocado. Ver o cabeçalho desse
ficheiro para detalhes.

> Se algum pacote falhar a instalar por incompatibilidade com Python 3.13,
> repete os passos acima criando o venv com `py -3.12 -m venv .venv` (ou
> `py -3.11`) em vez de `python -m venv .venv`.

Configura as variáveis de ambiente:

```powershell
Copy-Item .env.example .env
```

O `.env.example` já vem com valores que funcionam imediatamente para
desenvolvimento local (incluindo um `JWT_SECRET` de exemplo — gera o teu
próprio se fores partilhar isto com alguém). Não é preciso editar nada para
arrancar.

Popula a base de dados com dados de demonstração (3 empresas, contentores,
rotas, utilizadores):

```powershell
python seed_data.py
```

Arranca o backend:

```powershell
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Confirma que está no ar abrindo no browser:
`http://localhost:8000/api/health` → deve devolver
`{"status":"healthy",...}`.

Deixa este terminal aberto e a correr.

## 3. Frontend (Expo)

Noutro terminal PowerShell, a partir da raiz do repositório:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
```

Por omissão, `EXPO_PUBLIC_BACKEND_URL=http://localhost:8000` — funciona
diretamente para a versão web e para emuladores Android/iOS. **Se fores testar
num telemóvel físico com a app Expo Go**, edita `frontend\.env` e troca
`localhost` pelo IP local do teu PC (descobre com `ipconfig`, campo "IPv4
Address"), por exemplo `http://192.168.1.50:8000`.

Arranca a app:

```powershell
npm run web
```

ou, para escolher a plataforma interativamente (web / Android / iOS /
Expo Go):

```powershell
npx expo start
```

Abre a app (o comando acima mostra o URL, tipicamente
`http://localhost:8081`) e entra com uma das contas de demonstração
(password para todas: `WasteFlow2026!`):

| Perfil | Email |
|---|---|
| Administrador | admin@wasteflow.pt |
| Despachante | despachante@wasteflow.pt |
| Motorista | motorista@wasteflow.pt |
| Cliente | cliente@wasteflow.pt |
| Gestor de Operações | gestor@wasteflow.pt |
| Gestor de Manutenção | manutencao@wasteflow.pt |

## Comandos do dia-a-dia (depois da primeira instalação)

Terminal 1:
```powershell
docker compose up -d
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2:
```powershell
cd frontend
npm run web
```

## Troubleshooting

**"Assistente IA" (`/assistente`) responde sempre com mensagem de
indisponibilidade.**
Esperado localmente — `emergentintegrations` não é instalado por
`requirements-local.txt` (ver secção 2). O resto da aplicação funciona
normalmente; isto é uma limitação isolada e intencional desta fase. Nada foi
quebrado: o próprio código já tinha este fallback implementado.

**O mapa mostra linhas retas em vez de seguir estradas.**
Esperado sem `ORS_API_KEY` configurada — é o comportamento de fallback já
existente no código (`services/routing.py`). Regista-te gratuitamente em
https://openrouteservice.org/dev/#/signup e coloca a chave em
`backend\.env` para ativar rotas por estrada reais.

**`pip install -r requirements-local.txt` falha num pacote específico.**
Confirma a versão do Python (`python --version`). Se estiver em 3.13 e o
erro for sobre compilar uma extensão nativa, recria o venv com Python 3.12
ou 3.11 (ver secção 2).

**`docker compose up -d` falha ou o Docker não arranca.**
Confirma que o Docker Desktop está aberto e a correr (ícone na bandeja do
sistema) antes de correr o comando.

**O telemóvel físico (Expo Go) não consulta o backend.**
Confirma que `frontend\.env` usa o IP LAN do PC (não `localhost`) e que o
telemóvel está na mesma rede Wi-Fi. Confirma também que a firewall do
Windows não está a bloquear a porta 8000 para ligações de rede local.
