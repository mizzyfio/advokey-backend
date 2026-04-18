# JusDigital Backend

Backend do sistema de monitoramento processual para advogados.  
Stack: Node.js + Fastify + Supabase (PostgreSQL) + DataJud CNJ

---

## Estrutura

```
jusdigital-backend/
├── sql/
│   └── schema.sql           ← Rode isso primeiro no Supabase
├── src/
│   ├── db/
│   │   └── supabase.js      ← Cliente do banco
│   ├── jobs/
│   │   └── monitoramento.js ← Job noturno (coração do sistema)
│   ├── services/
│   │   ├── datajud.js       ← Consulta API pública CNJ
│   │   └── push.js          ← Push notifications Firebase
│   ├── routes/
│   │   ├── novidades.js     ← /novidades (Flutter consome aqui)
│   │   └── processos.js     ← /processos (CRUD + ações)
│   └── server.js            ← Servidor + agendamento do job
├── .env.example
└── package.json
```

---

## Setup passo a passo

### 1. Supabase
1. Crie um projeto em supabase.com (gratuito)
2. Vá em SQL Editor e rode todo o conteúdo de `sql/schema.sql`
3. Copie a URL e a Service Key do projeto

### 2. Firebase (Push Notifications)
1. Crie um projeto em console.firebase.google.com
2. Adicione um app Android e um iOS
3. Vá em Configurações do Projeto → Contas de Serviço
4. Gere uma nova chave privada (JSON)
5. Copie project_id, client_email e private_key para o .env

### 3. DataJud
1. Acesse datajud-wiki.cnj.jus.br/api-publica/acesso/
2. Copie a APIKey pública vigente
3. Cole no .env

### 4. Instalar e rodar
```bash
cp .env.example .env
# Preencha o .env com suas credenciais

npm install
npm run dev        # desenvolvimento
npm start          # produção
```

### 5. Testar o job manualmente
```bash
npm run job
# Roda o monitoramento agora, sem esperar as 2h
```

---

## Endpoints da API

### Autenticação
```
POST /auth/login
Body: { email, senha }
Retorna: { token, advogado }
```

### Processos
```
GET    /processos                    Lista processos monitorados
POST   /processos                    Cadastra processo { numero_cnj, cliente_id? }
POST   /processos/importar           Importa em lote { numeros: [...] }
GET    /processos/:id                Detalhe + movimentações
PUT    /processos/:id/urgente        { urgente: true/false }
PUT    /processos/:id/retorno        { aguardando: true/false }
PUT    /processos/:id/arquivar       Remove do monitoramento
POST   /processos/:id/encaminhar     Registra envio ao cliente { canal, mensagem, cliente_id? }
```

### Novidades (o que o app abre de manhã)
```
GET  /novidades                      Lista tudo (não lidas primeiro)
GET  /novidades/pendentes            { total: N } para o badge
PUT  /novidades/:id/lida             Marca 1 como lida
PUT  /novidades/marcar-todas-lidas   Limpa o badge
```

### Dispositivos (Flutter)
```
POST /dispositivos/token             Registra token FCM { fcm_token, plataforma }
```

---

## Como integrar no Flutter

```dart
// 1. Login e salva token JWT
final res = await http.post('/auth/login', body: { email, senha });
final token = res['token'];

// 2. Registra token FCM para receber push
final fcmToken = await FirebaseMessaging.instance.getToken();
await http.post('/dispositivos/token',
  headers: { 'Authorization': 'Bearer $token' },
  body: { 'fcm_token': fcmToken, 'plataforma': 'android' }
);

// 3. Ao abrir o app, busca as novidades do dia
final novidades = await http.get('/novidades',
  headers: { 'Authorization': 'Bearer $token' }
);

// 4. Quando advogado encaminha pro cliente via WhatsApp
final msg = Uri.encodeComponent('Prezado cliente, houve novidade no seu processo...');
launchUrl('https://wa.me/55${cliente.telefone}?text=$msg');
// Registra no backend
await http.post('/processos/$id/encaminhar', body: {
  'canal': 'whatsapp',
  'mensagem': mensagem,
  'cliente_id': cliente.id
});
```

---

## Deploy gratuito (Railway)

1. Crie conta em railway.app
2. New Project → Deploy from GitHub
3. Adicione as variáveis do .env no painel do Railway
4. Deploy automático a cada push

Custo: ~R$ 0 nos primeiros meses (free tier), depois ~R$ 25-50/mês.

---

## Lógica de frequência inteligente

O job checa processos com intervalos diferentes dependendo da atividade:

| Última movimentação | Frequência |
|---|---|
| Menos de 7 dias | Todo dia |
| 7 a 30 dias | A cada 3 dias |
| 30 a 90 dias | Semanalmente |
| Mais de 90 dias | Mensalmente |

Um advogado com 5.000 processos gera ~800 chamadas/noite na prática.  
Custo do DataJud: **R$ 0** (API pública e gratuita do CNJ).
