-- ============================================================
-- JUSDIGITAL · Schema do banco de dados
-- PostgreSQL / Supabase
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ADVOGADOS (usuários do sistema)
-- ============================================================
CREATE TABLE advogados (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  oab           TEXT,                        -- ex: SP123456
  telefone      TEXT,
  plano         TEXT NOT NULL DEFAULT 'solo' CHECK (plano IN ('solo','escritorio','senior')),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLIENTES DO ADVOGADO
-- ============================================================
CREATE TABLE clientes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advogado_id   UUID NOT NULL REFERENCES advogados(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  cpf_cnpj      TEXT,
  email         TEXT,
  telefone      TEXT,                        -- usado para encaminhar WhatsApp
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clientes_advogado ON clientes(advogado_id);

-- ============================================================
-- PROCESSOS MONITORADOS
-- ============================================================
CREATE TABLE processos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advogado_id     UUID NOT NULL REFERENCES advogados(id) ON DELETE CASCADE,
  cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
  numero_cnj      TEXT NOT NULL,             -- ex: 0001234-56.2023.8.26.0100
  tribunal        TEXT,                      -- ex: TJSP
  endpoint_datajud TEXT,                    -- ex: api_publica_tjsp
  assunto         TEXT,
  classe          TEXT,
  fase_atual      TEXT,
  valor_causa     NUMERIC(15,2),
  data_distribuicao DATE,

  -- Controle de monitoramento
  urgente         BOOLEAN NOT NULL DEFAULT false,
  aguardando_retorno BOOLEAN NOT NULL DEFAULT false,
  arquivado       BOOLEAN NOT NULL DEFAULT false,

  -- Frequência inteligente de checagem
  -- 'diaria' | 'tres_dias' | 'semanal' | 'mensal'
  frequencia_checagem TEXT NOT NULL DEFAULT 'diaria',
  ultima_checagem     TIMESTAMPTZ,
  proxima_checagem    TIMESTAMPTZ,

  -- Hash do último estado (para detectar mudanças)
  hash_ultimo_estado  TEXT,
  ultima_movimentacao TIMESTAMPTZ,

  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(advogado_id, numero_cnj)
);
CREATE INDEX idx_processos_advogado   ON processos(advogado_id);
CREATE INDEX idx_processos_proxima    ON processos(proxima_checagem) WHERE arquivado = false;
CREATE INDEX idx_processos_cnj        ON processos(numero_cnj);

-- ============================================================
-- MOVIMENTAÇÕES (histórico completo de cada processo)
-- ============================================================
CREATE TABLE movimentacoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  data_hora       TIMESTAMPTZ NOT NULL,
  codigo          TEXT,                      -- código do DataJud
  descricao       TEXT NOT NULL,
  complemento     TEXT,
  detectada_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- quando o job detectou
);
CREATE INDEX idx_movimentacoes_processo ON movimentacoes(processo_id, data_hora DESC);

-- ============================================================
-- NOVIDADES (movimentações ainda não vistas pelo advogado)
-- ============================================================
CREATE TABLE novidades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advogado_id     UUID NOT NULL REFERENCES advogados(id) ON DELETE CASCADE,
  processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  movimentacao_id UUID NOT NULL REFERENCES movimentacoes(id) ON DELETE CASCADE,
  lida            BOOLEAN NOT NULL DEFAULT false,
  lida_em         TIMESTAMPTZ,
  criada_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_novidades_advogado      ON novidades(advogado_id, lida, criada_em DESC);
CREATE INDEX idx_novidades_nao_lidas     ON novidades(advogado_id) WHERE lida = false;

-- ============================================================
-- COMUNICAÇÕES (registro de encaminhamentos ao cliente)
-- ============================================================
CREATE TABLE comunicacoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  advogado_id     UUID NOT NULL REFERENCES advogados(id) ON DELETE CASCADE,
  cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
  canal           TEXT NOT NULL CHECK (canal IN ('whatsapp','email','outro')),
  mensagem        TEXT,                      -- texto que foi enviado
  encaminhado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retorno_esperado BOOLEAN NOT NULL DEFAULT false,
  retorno_recebido BOOLEAN NOT NULL DEFAULT false,
  retorno_em       TIMESTAMPTZ,
  lembrete_em      TIMESTAMPTZ               -- quando lembrar de cobrar retorno
);
CREATE INDEX idx_comunicacoes_processo ON comunicacoes(processo_id);
CREATE INDEX idx_comunicacoes_retorno  ON comunicacoes(advogado_id, retorno_esperado, retorno_recebido)
  WHERE retorno_esperado = true AND retorno_recebido = false;

-- ============================================================
-- DISPOSITIVOS (tokens FCM para push notification Flutter)
-- ============================================================
CREATE TABLE dispositivos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advogado_id   UUID NOT NULL REFERENCES advogados(id) ON DELETE CASCADE,
  fcm_token     TEXT NOT NULL,
  plataforma    TEXT CHECK (plataforma IN ('android','ios')),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(advogado_id, fcm_token)
);

-- ============================================================
-- LOG DO JOB NOTURNO (rastreabilidade)
-- ============================================================
CREATE TABLE job_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iniciado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizado_em     TIMESTAMPTZ,
  total_processos   INTEGER DEFAULT 0,
  checados          INTEGER DEFAULT 0,
  com_novidade      INTEGER DEFAULT 0,
  erros             INTEGER DEFAULT 0,
  detalhes_erro     JSONB,
  duracao_ms        INTEGER
);

-- ============================================================
-- FUNÇÃO: atualiza frequência de checagem automaticamente
-- Chamada após cada checagem do job
-- ============================================================
CREATE OR REPLACE FUNCTION atualizar_frequencia_checagem(p_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE processos SET
    frequencia_checagem = CASE
      WHEN ultima_movimentacao IS NULL                                        THEN 'diaria'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 7        THEN 'diaria'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 30       THEN 'tres_dias'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 90       THEN 'semanal'
      ELSE                                                                         'mensal'
    END,
    proxima_checagem = CASE
      WHEN ultima_movimentacao IS NULL                                        THEN NOW() + INTERVAL '1 day'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 7        THEN NOW() + INTERVAL '1 day'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 30       THEN NOW() + INTERVAL '3 days'
      WHEN EXTRACT(DAY FROM NOW() - ultima_movimentacao)::INTEGER < 90       THEN NOW() + INTERVAL '7 days'
      ELSE                                                                         NOW() + INTERVAL '30 days'
    END,
    ultima_checagem = NOW(),
    atualizado_em   = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNÇÃO: trigger updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_advogados_updated
  BEFORE UPDATE ON advogados
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_processos_updated
  BEFORE UPDATE ON processos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
