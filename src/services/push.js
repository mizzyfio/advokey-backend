// src/services/push.js
// Envia push notifications para o app Flutter via Firebase FCM

import fetch from 'node-fetch'
import 'dotenv/config'

// Gera access token para FCM v1 API
async function getAccessToken() {
  // Para produção use a lib google-auth-library
  // Aqui usamos a abordagem direta com JWT
  const { createSign } = await import('crypto')

  const now = Math.floor(Date.now() / 1000)
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss:   process.env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  })).toString('base64url')

  const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const signature = sign.sign(privateKey, 'base64url')
  const jwt = `${header}.${payload}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
      assertion:  jwt
    })
  })

  const data = await res.json()
  return data.access_token
}

// ── Envia push para 1 dispositivo ─────────────────────────────────────────────
export async function enviarPush({ fcmToken, titulo, corpo, dados = {} }) {
  try {
    const accessToken = await getAccessToken()
    const projectId   = process.env.FIREBASE_PROJECT_ID

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title: titulo, body: corpo },
            data: dados,
            android: {
              priority: 'high',
              notification: { sound: 'default', channel_id: 'novidades' }
            },
            apns: {
              payload: { aps: { sound: 'default', badge: 1 } }
            }
          }
        })
      }
    )

    if (!res.ok) {
      const err = await res.json()
      console.error(`[PUSH] Erro ao enviar para ${fcmToken.slice(0,20)}...`, err)
      return false
    }

    return true
  } catch (err) {
    console.error('[PUSH] Falha:', err.message)
    return false
  }
}

// ── Envia push para todos os dispositivos de um advogado ──────────────────────
export async function notificarAdvogado({ supabase, advogadoId, titulo, corpo, dados = {} }) {
  const { data: dispositivos } = await supabase
    .from('dispositivos')
    .select('fcm_token')
    .eq('advogado_id', advogadoId)
    .eq('ativo', true)

  if (!dispositivos?.length) return

  await Promise.allSettled(
    dispositivos.map(d => enviarPush({ fcmToken: d.fcm_token, titulo, corpo, dados }))
  )
}
