// src/routes/processos.js

import { detectarEndpoint } from '../services/datajud.js'
import { consultarProcesso, extrairMovimentacoes } from '../services/datajud.js'

export default async function processos(fastify) {

  // ── GET /processos ─────────────────────────────────────────────────────────
  fastify.get('/processos', async (req, reply) => {
    const advogadoId = req.user.id
    const { arquivado = false } = req.query

    const { data, error } = await fastify.supabase
      .from('processos')
      .select(`
        id, numero_cnj, tribunal, assunto, classe, fase_atual,
        urgente, aguardando_retorno, arquivado,
        ultima_movimentacao, ultima_checagem, proxima_checagem,
        cliente:clientes ( id, nome, telefone )
      `)
      .eq('advogado_id', advogadoId)
      .eq('arquivado', arquivado === 'true')
      .order('urgente', { ascending: false })
      .order('ultima_movimentacao', { ascending: false, nullsLast: true })

    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  // ── POST /processos ────────────────────────────────────────────────────────
  // Cadastra novo processo para monitorar
  fastify.post('/processos', async (req, reply) => {
    const advogadoId = req.user.id
    const { numero_cnj, cliente_id } = req.body

    if (!numero_cnj) return reply.status(400).send({ erro: 'numero_cnj é obrigatório' })

    const cnj_limpo = numero_cnj.replace(/\D/g, '')
    if (cnj_limpo.length !== 20) {
      return reply.status(400).send({ erro: 'Número CNJ inválido (deve ter 20 dígitos)' })
    }

    const endpoint = detectarEndpoint(numero_cnj)
    if (!endpoint) {
      return reply.status(400).send({ erro: 'Tribunal não identificado para este número CNJ' })
    }

    // Tenta buscar dados iniciais no DataJud
    let dadosIniciais = {}
    try {
      const source = await consultarProcesso(numero_cnj, endpoint)
      if (source) {
        dadosIniciais = {
          tribunal:          source.tribunal?.nome || null,
          assunto:           source.assuntos?.[0]?.nome || null,
          classe:            source.classe?.nome || null,
          valor_causa:       source.valorCausa || null,
          data_distribuicao: source.dataAjuizamento?.split('T')[0] || null,
        }
      }
    } catch (e) {
      // Não bloqueia o cadastro se o DataJud falhar
      console.warn(`[PROCESSO] Falha ao buscar dados iniciais: ${e.message}`)
    }

    const { data, error } = await fastify.supabase
      .from('processos')
      .insert({
        advogado_id:      advogadoId,
        cliente_id:       cliente_id || null,
        numero_cnj,
        endpoint_datajud: endpoint,
        proxima_checagem: new Date().toISOString(), // checa na próxima rodada do job
        ...dadosIniciais
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.status(409).send({ erro: 'Este processo já está sendo monitorado' })
      }
      return reply.status(500).send({ erro: error.message })
    }

    return reply.status(201).send(data)
  })

  // ── POST /processos/importar ───────────────────────────────────────────────
  // Importa lista de CNJs de uma vez (planilha/app)
  fastify.post('/processos/importar', async (req, reply) => {
    const advogadoId = req.user.id
    const { numeros } = req.body // array de strings CNJ

    if (!Array.isArray(numeros) || numeros.length === 0) {
      return reply.status(400).send({ erro: 'Envie um array "numeros" com os CNJs' })
    }

    const inserir = []
    const ignorados = []

    for (const numero_cnj of numeros) {
      const cnj_limpo = numero_cnj.replace(/\D/g, '')
      if (cnj_limpo.length !== 20) { ignorados.push({ numero_cnj, motivo: 'formato inválido' }); continue }
      const endpoint = detectarEndpoint(numero_cnj)
      if (!endpoint) { ignorados.push({ numero_cnj, motivo: 'tribunal não identificado' }); continue }

      inserir.push({
        advogado_id:      advogadoId,
        numero_cnj,
        endpoint_datajud: endpoint,
        proxima_checagem: new Date().toISOString()
      })
    }

    const { data, error } = await fastify.supabase
      .from('processos')
      .upsert(inserir, { onConflict: 'advogado_id,numero_cnj', ignoreDuplicates: true })
      .select('id, numero_cnj')

    if (error) return reply.status(500).send({ erro: error.message })

    return {
      importados: data?.length || 0,
      ignorados
    }
  })

  // ── GET /processos/:id ─────────────────────────────────────────────────────
  fastify.get('/processos/:id', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id

    const { data, error } = await fastify.supabase
      .from('processos')
      .select(`
        *,
        cliente:clientes ( id, nome, cpf_cnpj, telefone, email ),
        movimentacoes ( id, data_hora, descricao, complemento )
      `)
      .eq('id', id)
      .eq('advogado_id', advogadoId)
      .order('data_hora', { referencedTable: 'movimentacoes', ascending: false })
      .single()

    if (error) return reply.status(404).send({ erro: 'Processo não encontrado' })
    return data
  })

  // ── PUT /processos/:id/urgente ─────────────────────────────────────────────
  fastify.put('/processos/:id/urgente', async (req, reply) => {
    const { id } = req.params
    const { urgente } = req.body
    const advogadoId  = req.user.id

    const { error } = await fastify.supabase
      .from('processos')
      .update({ urgente: Boolean(urgente) })
      .eq('id', id)
      .eq('advogado_id', advogadoId)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── PUT /processos/:id/retorno ─────────────────────────────────────────────
  fastify.put('/processos/:id/retorno', async (req, reply) => {
    const { id } = req.params
    const { aguardando } = req.body
    const advogadoId = req.user.id

    const { error } = await fastify.supabase
      .from('processos')
      .update({ aguardando_retorno: Boolean(aguardando) })
      .eq('id', id)
      .eq('advogado_id', advogadoId)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── PUT /processos/:id/arquivar ────────────────────────────────────────────
  fastify.put('/processos/:id/arquivar', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id

    const { error } = await fastify.supabase
      .from('processos')
      .update({ arquivado: true })
      .eq('id', id)
      .eq('advogado_id', advogadoId)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── POST /processos/:id/encaminhar ─────────────────────────────────────────
  // Registra que o advogado encaminhou novidade pro cliente
  fastify.post('/processos/:id/encaminhar', async (req, reply) => {
    const { id }                           = req.params
    const { canal, mensagem, cliente_id }  = req.body
    const advogadoId                       = req.user.id

    const { data, error } = await fastify.supabase
      .from('comunicacoes')
      .insert({
        processo_id:       id,
        advogado_id:       advogadoId,
        cliente_id:        cliente_id || null,
        canal:             canal || 'whatsapp',
        mensagem,
        retorno_esperado:  true,
        lembrete_em:       new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // +3 dias
      })
      .select()
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send(data)
  })
}
