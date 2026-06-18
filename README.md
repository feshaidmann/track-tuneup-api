# track-tuneup-api

API de análise e correção de áudio profissional. Analisa uma faixa de áudio contra os padrões de loudness das principais plataformas e corrige automaticamente os problemas encontrados.

## Como rodar localmente

### Pré-requisitos

- Python 3.11+
- `ffmpeg` e `sox` instalados no sistema
- Conta no Supabase com um bucket chamado `audio-corrected`

### Instalação

```bash
pip install -r requirements.txt
```

### Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores:

```bash
cp .env.example .env
```

| Variável              | Descrição                                      |
|-----------------------|------------------------------------------------|
| `SUPABASE_URL`        | URL do seu projeto Supabase                    |
| `SUPABASE_SERVICE_KEY`| Chave de serviço (service_role) do Supabase    |

### Iniciar o servidor

```bash
uvicorn main:app --reload
```

A API estará disponível em `http://localhost:8000`.

## Endpoint

### POST /analyze

Analisa um arquivo de áudio e retorna diagnóstico completo com arquivo corrigido.

**Request:**

```json
{
  "file_url": "https://exemplo.com/minha-faixa.wav",
  "preset": "spotify"
}
```

Presets disponíveis: `spotify`, `apple_music`, `youtube`, `club`, `radio`, `cd_master`

**Response:**

```json
{
  "summary": "Encontramos 2 problemas e corrigimos automaticamente. Baixe a versão corrigida.",
  "summary_status": "warning",
  "metrics": [
    {
      "group": "loudness",
      "name": "Loudness Integrada",
      "metric": "integrated_lufs",
      "value": -9.5,
      "target": -14.0,
      "unit": "LUFS",
      "status": "critical",
      "corrected": true,
      "message": "Sua faixa estava 4.5 LU acima do target do Spotify. A plataforma reduziria o volume automaticamente, prejudicando o impacto. Corrigimos para -14.0 LUFS."
    }
  ],
  "corrected_file_url": "https://xyz.supabase.co/storage/v1/object/public/audio-corrected/uuid.wav"
}
```

## Docker

```bash
docker build -t track-tuneup-api .
docker run -p 8000:8000 --env-file .env track-tuneup-api
```
