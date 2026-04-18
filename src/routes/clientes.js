// src/routes/clientes.js

export default async function clientes(fastify) {

  fastify.get('/clientes', async (req, reply) => {
    const advogadoId = req.user.id
    const { data, error } = await fastify.supabase
      .from('clientes')
      .select(`id, nome, cpf_cnpj, email, telefone, criado_em,
        processos (id, numero_cnj, tribunal, fase_atual, urgente, ultima_movimentacao)`)
      .eq('advogado_id', advogadoId)
      .order('nome', { ascending: true })
    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  fastify.post('/clientes', async (req, reply) => {
    const advogadoId = req.user.id
    const { nome, telefone, email, cpf_cnpj } = req.body
    if (!nome) return reply.status(400).send({ erro: 'Nome é obrigatório' })
    const { data, error } = await fastify.supabase
      .from('clientes')
      .insert({ advogado_id: advogadoId, nome, telefone, email, cpf_cnpj })
      .select().single()
    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send(data)
  })

  fastify.put('/clientes/:id', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id
    const { nome, telefone, email, cpf_cnpj } = req.body
    const { data, error } = await fastify.supabase
      .from('clientes')
      .update({ nome, telefone, email, cpf_cnpj })
      .eq('id', id).eq('advogado_id', advogadoId)
      .select().single()
    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  fastify.delete('/clientes/:id', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id
    const { error } = await fastify.supabase
      .from('clientes').delete()
      .eq('id', id).eq('advogado_id', advogadoId)
    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  fastify.get('/clientes/:id/processos', async (req, reply) => {
    const { id } = req.params
    const advogadoId = req.user.id
    const { data, error } = await fastify.supabase
      .from('processos')
      .select('id, numero_cnj, tribunal, assunto, fase_atual, urgente, ultima_movimentacao, arquivado')
      .eq('cliente_id', id).eq('advogado_id', advogadoId)
      .order('ultima_movimentacao', { ascending: false, nullsLast: true })
    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })
}