// src/jobs/monitoramento.js
// ============================================================
// JOB NOTURNO DE MONITORAMENTO
// Roda às 2h da manhã todo dia (configurável via .env)
// Checa todos os processos que estão na fila de hoje
// e detecta novas movimentações
// ============================================================

import 'dotenv/config'
import { supabase }            from '../db/supabase.js'
import { consultarProcesso, extrairMovimentacoes, gerarHash } from '../services/datajud.js'
import { notificarAdvogado }   from '../services/push.js'

// ── Controle de concorrência ──────────────────────────────────────────────────
// Quantos processos checar em paralelo (não sobrecarregar o DataJud)
const CONCORRENCIA = 5

async function processarEmLote(itens, fn, concorrencia) {
  const resultados = []
  for (let i = 0; i < itens.length; i += concorrencia) {
    const lote = itens.slice(i, i + concorrencia)
    const res  = await Promise.allSettled(lote.map(fn))
    resultados.push(...res)
    // Pequena pausa entre lotes para não derrubar a API
    if (i + concorrencia < itens.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  return resultados
}

// ── Checar 1 processo ─────────────────────────────────────────────────────────
async function checarProcesso(processo) {
  const { id, numero_cnj, endpoint_datajud, hash_ultimo_estado, advogado_id } = processo

  // 1. Consulta DataJud
  const source = await consultarProcesso(numero_cnj, endpoint_datajud)
  if (!source) {
    console.log(`  [SKIP] ${numero_cnj} — não encontrado no DataJud`)
    await supabase.rpc('atualizar_frequencia_checagem', { p_id: id })
    return { novidade: false }
  }

  // 2. Extrai movimentações e gera hash
  const movimentacoes = extrairMovimentacoes(source)
  const hashAtual     = gerarHash(movimentacoes)

  // 3. Sem mudança → apenas atualiza frequência
  if (hashAtual === hash_ultimo_estado) {
    await supabase.rpc('atualizar_frequencia_checagem', { p_id: id })
    return { novidade: false }
  }

  // 4. MUDOU — descobre quais movimentações são novas
  const { data: movExistentes } = await supabase
    .from('movimentacoes')
    .select('data_hora, codigo')
    .eq('processo_id', id)

  const chaveExistentes = new Set(
    (movExistentes || []).map(m => `${m.data_hora}:${m.codigo}`)
  )

  const novas = movimentacoes.filter(
    m => !chaveExistentes.has(`${m.data_hora}:${m.codigo}`)
  )

  if (novas.length === 0) {
    // Hash diferente mas nada novo (raro) — atualiza hash e segue
    await supabase.from('processos').update({ hash_ultimo_estado: hashAtual }).eq('id', id)
    await supabase.rpc('atualizar_frequencia_checagem', { p_id: id })
    return { novidade: false }
  }

  // 5. Salva movimentações novas
  const { data: movsSalvas } = await supabase
    .from('movimentacoes')
    .insert(novas.map(m => ({
      processo_id: id,
      data_hora:   m.data_hora,
      codigo:      m.codigo,
      descricao:   m.descricao,
      complemento: m.complemento
    })))
    .select('id, descricao, data_hora')

  // 6. Cria novidades (para aparecer no app do advogado)
  if (movsSalvas?.length) {
    await supabase.from('novidades').insert(
      movsSalvas.map(m => ({
        advogado_id:    advogado_id,
        processo_id:    id,
        movimentacao_id: m.id
      }))
    )
  }

  // 7. Atualiza estado do processo
  const ultimaMov = movimentacoes[0] // já está ordenado desc
  await supabase.from('processos').update({
    hash_ultimo_estado:  hashAtual,
    ultima_movimentacao: ultimaMov?.data_hora,
    fase_atual:          source.fase || null,
    atualizado_em:       new Date().toISOString()
  }).eq('id', id)

  await supabase.rpc('atualizar_frequencia_checagem', { p_id: id })

  // 8. Push notification para o advogado
  const descricaoCurta = novas[0].descricao.slice(0, 80)
  await notificarAdvogado({
    supabase,
    advogadoId: advogado_id,
    titulo: `📋 Novidade no processo`,
    corpo:  `${numero_cnj.slice(0, 20)}... — ${descricaoCurta}`,
    dados:  {
      tipo:        'novidade_processo',
      processo_id: id,
      numero_cnj:  numero_cnj
    }
  })

  console.log(`  [✓] ${numero_cnj} — ${novas.length} nova(s) movimentação(ões)`)
  return { novidade: true, total_novas: novas.length }
}

// ── JOB PRINCIPAL ─────────────────────────────────────────────────────────────
export async function executarJob() {
  const inicio = Date.now()
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[JOB] Monitoramento iniciado: ${new Date().toLocaleString('pt-BR')}`)
  console.log('='.repeat(60))

  // Registra início no log
  const { data: logRow } = await supabase
    .from('job_logs')
    .insert({ iniciado_em: new Date().toISOString() })
    .select('id')
    .single()

  const logId = logRow?.id

  let checados     = 0
  let com_novidade = 0
  let erros        = 0
  const detalhes_erro = []

  try {
    // Busca processos que precisam ser checados HOJE
    // (proxima_checagem <= agora E não arquivados)
    const { data: processos, error } = await supabase
      .from('processos')
      .select('id, numero_cnj, endpoint_datajud, hash_ultimo_estado, advogado_id, ultima_movimentacao')
      .eq('arquivado', false)
      .lte('proxima_checagem', new Date().toISOString())
      .order('urgente', { ascending: false }) // urgentes primeiro
      .order('proxima_checagem', { ascending: true })

    if (error) throw error

    const total = processos?.length || 0
    console.log(`[JOB] ${total} processos na fila de hoje\n`)

    if (total === 0) {
      console.log('[JOB] Nada para checar. Encerrando.')
    } else {
      // Processa em lotes para não derrubar o DataJud
      const resultados = await processarEmLote(
        processos,
        async (p) => {
          try {
            checados++
            const res = await checarProcesso(p)
            if (res.novidade) com_novidade++
            return res
          } catch (err) {
            erros++
            detalhes_erro.push({ numero_cnj: p.numero_cnj, erro: err.message })
            console.error(`  [ERRO] ${p.numero_cnj}: ${err.message}`)
            return { novidade: false, erro: err.message }
          }
        },
        CONCORRENCIA
      )
    }

  } catch (err) {
    console.error('[JOB] Erro fatal:', err.message)
    erros++
    detalhes_erro.push({ erro: err.message })
  }

  // Finaliza log
  const duracao = Date.now() - inicio
  await supabase.from('job_logs').update({
    finalizado_em:   new Date().toISOString(),
    checados,
    com_novidade,
    erros,
    detalhes_erro:   detalhes_erro.length ? detalhes_erro : null,
    duracao_ms:      duracao
  }).eq('id', logId)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[JOB] Concluído em ${(duracao/1000).toFixed(1)}s`)
  console.log(`[JOB] Checados: ${checados} | Com novidade: ${com_novidade} | Erros: ${erros}`)
  console.log('─'.repeat(60) + '\n')
}

// ── Execução direta (node src/jobs/monitoramento.js) ──────────────────────────
// Usado para teste manual ou GitHub Actions
if (process.argv[1].includes('monitoramento')) {
  executarJob().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
