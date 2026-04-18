// src/routes/novidades.js
// Endpoints consumidos pelo app Flutter

export default async function novidades(fastify) {

  // ── GET /novidades ─────────────────────────────────────────────────────────
  // Retorna todas as novidades do advogado (não lidas primeiro)
  fastify.get('/novidades', async (req, reply) => {
    const advogadoId = req.user.id

    const { data, error } = await fastify.supabase
      .from('novidades')
      .select(`
        id,
        lida,
        criada_em,
        processo:processos (
          id, numero_cnj, tribunal, assunto, cliente_id, urgente,
          cliente:clientes ( id, nome, telefone )
        ),
        movimentacao:movimentacoes (
          id, data_hora, descricao, complemento
        )
      `)
      .eq('advogado_id', advogadoId)
      .order('lida', { ascending: true })         // não lidas primeiro
      .order('criada_em', { ascending: false })
      .limit(100)

    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  // ── GET /novidades/pendentes ───────────────────────────────────────────────
  // Só as não lidas (badge do app)
  fastify.get('/novidades/pendentes', async (req, reply) => {
    const advogadoId = req.user.id

    const { count } = await fastify.supabase
      .from('novidades')
      .select('id', { count: 'exact', head: true })
      .eq('advogado_id', advogadoId)
      .eq('lida', false)

    return { total: count || 0 }
  })

  // ── PUT /novidades/:id/lida ────────────────────────────────────────────────
  fastify.put('/novidades/:id/lida', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id

    const { error } = await fastify.supabase
      .from('novidades')
      .update({ lida: true, lida_em: new Date().toISOString() })
      .eq('id', id)
      .eq('advogado_id', advogadoId)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── PUT /novidades/marcar-todas-lidas ─────────────────────────────────────
  fastify.put('/novidades/marcar-todas-lidas', async (req, reply) => {
    const advogadoId = req.user.id

    const { error } = await fastify.supabase
      .from('novidades')
      .update({ lida: true, lida_em: new Date().toISOString() })
      .eq('advogado_id', advogadoId)
      .eq('lida', false)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })
}
