// src/server.js
import 'dotenv/config'
import Fastify        from 'fastify'
import cors           from '@fastify/cors'
import jwt            from '@fastify/jwt'
import cron           from 'node-cron'
import { supabase }   from './db/supabase.js'
import { executarJob } from './jobs/monitoramento.js'
import novidades      from './routes/novidades.js'
import processos      from './routes/processos.js'

const app = Fastify({ logger: process.env.NODE_ENV !== 'production' })

// ── Plugins ───────────────────────────────────────────────────────────────────
await app.register(cors, { origin: true })
await app.register(jwt,  { secret: process.env.JWT_SECRET })

// Disponibiliza supabase em todas as rotas
app.decorate('supabase', supabase)

// ── Autenticação via JWT ──────────────────────────────────────────────────────
app.addHook('onRequest', async (req, reply) => {
  const publicas = ['/health', '/auth/login', '/auth/registro']
  if (publicas.includes(req.url)) return

  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ erro: 'Token inválido ou ausente' })
  }
})

// ── Rotas públicas ────────────────────────────────────────────────────────────
app.get('/health', () => ({ status: 'ok', ts: new Date().toISOString() }))

// ── Auth simples ──────────────────────────────────────────────────────────────
app.post('/auth/login', async (req, reply) => {
  const { email, senha } = req.body
  
  const { data, error } = await supabase.auth.signInWithPassword({ 
    email, 
    password: senha 
  })
  
  if (error) {
    return reply.status(401).send({ erro: 'Email ou senha incorretos' })
  }

  const { data: adv } = await supabase
    .from('advogados')
    .select('id, nome, email, oab, plano')
    .eq('email', email)
    .single()

  if (!adv) {
    return reply.status(401).send({ erro: 'Advogado não encontrado' })
  }

  const token = app.jwt.sign({ id: adv.id, email: adv.email, plano: adv.plano })
  return { token, advogado: adv }
})

// ── Registrar token FCM (para push notifications Flutter) ─────────────────────
app.post('/dispositivos/token', async (req, reply) => {
  const { fcm_token, plataforma } = req.body
  const advogadoId = req.user.id

  await supabase.from('dispositivos').upsert(
    { advogado_id: advogadoId, fcm_token, plataforma, ativo: true },
    { onConflict: 'advogado_id,fcm_token' }
  )
  return { ok: true }
})

// ── Rotas principais ──────────────────────────────────────────────────────────
await app.register(novidades)
await app.register(processos)

// ── Job noturno agendado ──────────────────────────────────────────────────────
const cronExpressao = process.env.JOB_CRON || '0 2 * * *' // padrão: 2h da manhã
cron.schedule(cronExpressao, () => {
  console.log('[CRON] Disparando job de monitoramento...')
  executarJob().catch(err => console.error('[CRON] Erro no job:', err))
}, { timezone: 'America/Sao_Paulo' })

console.log(`[CRON] Job agendado: ${cronExpressao} (Horário de Brasília)`)

// ── Inicia servidor ───────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3000')
await app.listen({ port, host: '0.0.0.0' })
console.log(`[SERVER] JusDigital Backend rodando na porta ${port}`)
