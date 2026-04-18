// src/services/datajud.js
// Consulta a API pública do DataJud/CNJ
// Documentação: https://datajud-wiki.cnj.jus.br/api-publica

import fetch from 'node-fetch'
import 'dotenv/config'

const BASE_URL = 'https://api-publica.datajud.cnj.jus.br'
const API_KEY  = process.env.DATAJUD_API_KEY

// ── Mapa J.TR → endpoint do tribunal ──────────────────────────────────────────
const TRIBUNAL_MAP = {
  '3.00': 'api_publica_stj',
  '4.01': 'api_publica_trf1',  '4.02': 'api_publica_trf2',
  '4.03': 'api_publica_trf3',  '4.04': 'api_publica_trf4',
  '4.05': 'api_publica_trf5',  '4.06': 'api_publica_trf6',
  '5.00': 'api_publica_tst',
  '5.01': 'api_publica_trt1',  '5.02': 'api_publica_trt2',
  '5.03': 'api_publica_trt3',  '5.04': 'api_publica_trt4',
  '5.05': 'api_publica_trt5',  '5.06': 'api_publica_trt6',
  '5.07': 'api_publica_trt7',  '5.08': 'api_publica_trt8',
  '5.09': 'api_publica_trt9',  '5.10': 'api_publica_trt10',
  '5.11': 'api_publica_trt11', '5.12': 'api_publica_trt12',
  '5.13': 'api_publica_trt13', '5.14': 'api_publica_trt14',
  '5.15': 'api_publica_trt15', '5.16': 'api_publica_trt16',
  '5.17': 'api_publica_trt17', '5.18': 'api_publica_trt18',
  '5.19': 'api_publica_trt19', '5.20': 'api_publica_trt20',
  '5.21': 'api_publica_trt21', '5.22': 'api_publica_trt22',
  '5.23': 'api_publica_trt23', '5.24': 'api_publica_trt24',
  '6.00': 'api_publica_tse',
  '6.01': 'api_publica_tre-ac',  '6.02': 'api_publica_tre-al',
  '6.03': 'api_publica_tre-ap',  '6.04': 'api_publica_tre-am',
  '6.05': 'api_publica_tre-ba',  '6.06': 'api_publica_tre-ce',
  '6.07': 'api_publica_tre-dft', '6.08': 'api_publica_tre-es',
  '6.09': 'api_publica_tre-go',  '6.10': 'api_publica_tre-ma',
  '6.11': 'api_publica_tre-mt',  '6.12': 'api_publica_tre-ms',
  '6.13': 'api_publica_tre-mg',  '6.14': 'api_publica_tre-pa',
  '6.15': 'api_publica_tre-pb',  '6.16': 'api_publica_tre-pr',
  '6.17': 'api_publica_tre-pe',  '6.18': 'api_publica_tre-pi',
  '6.19': 'api_publica_tre-rj',  '6.20': 'api_publica_tre-rn',
  '6.21': 'api_publica_tre-rs',  '6.22': 'api_publica_tre-ro',
  '6.23': 'api_publica_tre-rr',  '6.24': 'api_publica_tre-sc',
  '6.25': 'api_publica_tre-se',  '6.26': 'api_publica_tre-sp',
  '6.27': 'api_publica_tre-to',
  '7.00': 'api_publica_stm',
  '8.01': 'api_publica_tjac',  '8.02': 'api_publica_tjal',
  '8.03': 'api_publica_tjap',  '8.04': 'api_publica_tjam',
  '8.05': 'api_publica_tjba',  '8.06': 'api_publica_tjce',
  '8.07': 'api_publica_tjdft', '8.08': 'api_publica_tjes',
  '8.09': 'api_publica_tjgo',  '8.10': 'api_publica_tjma',
  '8.11': 'api_publica_tjmt',  '8.12': 'api_publica_tjms',
  '8.13': 'api_publica_tjmg',  '8.14': 'api_publica_tjpa',
  '8.15': 'api_publica_tjpb',  '8.16': 'api_publica_tjpr',
  '8.17': 'api_publica_tjpe',  '8.18': 'api_publica_tjpi',
  '8.19': 'api_publica_tjrj',  '8.20': 'api_publica_tjrn',
  '8.21': 'api_publica_tjrs',  '8.22': 'api_publica_tjro',
  '8.23': 'api_publica_tjrr',  '8.24': 'api_publica_tjsc',
  '8.25': 'api_publica_tjse',  '8.26': 'api_publica_tjsp',
  '8.27': 'api_publica_tjto',
  '9.13': 'api_publica_tjmmg',
  '9.21': 'api_publica_tjmrs',
  '9.26': 'api_publica_tjmsp',
}

// ── Detecta endpoint pelo número CNJ ─────────────────────────────────────────
export function detectarEndpoint(numeroCNJ) {
  const digits = numeroCNJ.replace(/\D/g, '')
  if (digits.length !== 20) return null
  const j  = digits.slice(13, 14)
  const tr = digits.slice(14, 16)
  return TRIBUNAL_MAP[`${j}.${tr}`] || null
}

// ── Formata número CNJ com pontuação ─────────────────────────────────────────
export function formatarCNJ(digits) {
  if (digits.length !== 20) return digits
  return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`
}

// ── Consulta processo no DataJud ─────────────────────────────────────────────
export async function consultarProcesso(numeroCNJ, endpointTribunal) {
  const endpoint = endpointTribunal || detectarEndpoint(numeroCNJ)
  if (!endpoint) throw new Error(`Tribunal não identificado para: ${numeroCNJ}`)

  const url  = `${BASE_URL}/${endpoint}/_search`
  const body = {
    query: {
      match: { numeroProcesso: numeroCNJ.replace(/\D/g, '') }
    }
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `APIKey ${API_KEY}`
    },
    body: JSON.stringify(body),
    // timeout de 15 segundos por processo
    signal: AbortSignal.timeout(15_000)
  })

  if (res.status === 401) throw new Error('APIKey DataJud inválida ou expirada')
  if (!res.ok) throw new Error(`DataJud HTTP ${res.status} para ${numeroCNJ}`)

  const json = await res.json()
  const hits = json?.hits?.hits
  if (!hits || hits.length === 0) return null

  return hits[0]._source
}

// ── Extrai movimentações do retorno DataJud ───────────────────────────────────
export function extrairMovimentacoes(source) {
  if (!source?.movimentos) return []
  return source.movimentos
    .map(m => ({
      data_hora:   m.dataHora,
      codigo:      String(m.codigo || ''),
      descricao:   m.nome || m.complemento || 'Movimentação',
      complemento: m.complementosTabelados?.map(c => c.nome).join(', ') || null
    }))
    .sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora))
}

// ── Gera hash do estado atual do processo ─────────────────────────────────────
// Usado para detectar se houve mudança desde a última checagem
import { createHash } from 'crypto'

export function gerarHash(movimentacoes) {
  const str = movimentacoes
    .map(m => `${m.data_hora}:${m.codigo}:${m.descricao}`)
    .join('|')
  return createHash('md5').update(str).digest('hex')
}
