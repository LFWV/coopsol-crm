// ====================================================
// Coopsol CRM - Servidor Local
// Substitui o Vercel: serve os arquivos estáticos,
// proxy do Autentique, status de contratos e webhook
// ====================================================

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');

// Fila de eventos de webhook (em memória) — o frontend consome via polling
const webhookEvents = [];

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ---- Servir arquivos estáticos (frontend) ----
app.use(express.static(path.join(__dirname), {
    index: 'index.html'
}));

// ---- API: Proxy Autentique (Assinatura Digital) ----
app.post('/api/enviar-contrato', async (req, res) => {
    try {
        const { filename, pdfBase64, emailCliente } = req.body;

        if (!pdfBase64 || !emailCliente) {
            return res.status(400).json({ error: 'Dados incompletos (pdfBase64 ou emailCliente faltando)' });
        }

        const AUTENTIQUE_TOKEN = process.env.AUTENTIQUE_TOKEN;
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'vinicius.pereira@callieres.com';

        if (!AUTENTIQUE_TOKEN || AUTENTIQUE_TOKEN === 'seu_token_aqui') {
            return res.status(500).json({
                error: 'Token do Autentique não configurado no servidor (.env).'
            });
        }

        // Validação crucial: o Autentique proíbe e-mails duplicados na lista de signatários
        const signers = [{ email: emailCliente, action: 'SIGN' }];
        
        if (emailCliente.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
            signers.push({ email: ADMIN_EMAIL, action: 'SIGN' });
        } else {
            console.log('[Autentique] Aviso: E-mail do cliente é o mesmo do admin. Enviando apenas 1 signatário.');
        }

        const GRAPHQL_URL = 'https://api.autentique.com.br/v2/graphql';
        const buffer = Buffer.from(pdfBase64, 'base64');

        const operations = JSON.stringify({
            query: `
                mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
                    createDocument(sandbox: true, document: $document, signers: $signers, file: $file) {
                        id
                        name
                    }
                }
            `,
            variables: {
                document: { name: filename || 'Contrato Coopsol' },
                signers: signers,
                file: null
            }
        });

        const map = JSON.stringify({ '0': ['variables.file'] });

        const formData = new FormData();
        formData.append('operations', operations);
        formData.append('map', map);
        formData.append('0', buffer, {
            filename: filename || 'contrato.pdf',
            contentType: 'application/pdf'
        });

        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTENTIQUE_TOKEN}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        const result = await response.json();
        console.log('[Autentique] Resultado API:', JSON.stringify(result, null, 2));

        if (result.errors) {
            const errorMsg = result.errors.map(e => e.message).join(', ');
            return res.status(400).json({ ok: false, error: errorMsg });
        }

        return res.status(200).json({
            ok: true,
            document: result.data.createDocument
        });

    } catch (error) {
        console.error('[Autentique] Erro Crítico:', error);
        return res.status(500).json({ error: 'Erro interno no servidor: ' + error.message });
    }
});

// OPTIONS para CORS preflight
app.options('/api/enviar-contrato', (req, res) => res.status(200).end());

// ---- API: Verificar Status do Contrato no Autentique ----
app.get('/api/status-contrato/:documentId', async (req, res) => {
    const { documentId } = req.params;
    const AUTENTIQUE_TOKEN = process.env.AUTENTIQUE_TOKEN;

    if (!AUTENTIQUE_TOKEN) {
        return res.status(500).json({ error: 'AUTENTIQUE_TOKEN não configurado no .env' });
    }

    try {
        const query = `
            query {
                document(id: "${documentId}") {
                    id
                    name
                    created_at
                    signatures {
                        public_id
                        name
                        email
                        action { name }
                        signed { created_at }
                        rejected { created_at }
                        viewed { created_at }
                    }
                }
            }
        `;

        const response = await fetch('https://api.autentique.com.br/v2/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTENTIQUE_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });

        const result = await response.json();

        if (result.errors) {
            return res.status(400).json({ ok: false, errors: result.errors });
        }

        const doc = result.data.document;
        const signatures = doc.signatures || [];

        // Determina status consolidado
        const allSigned = signatures.length > 0 && signatures.every(s => s.signed);
        const anyRejected = signatures.some(s => s.rejected);

        let status = 'Aguardando assinatura';
        if (anyRejected) status = 'Recusado';
        else if (allSigned) status = 'Assinado';

        return res.status(200).json({
            ok: true,
            documentId: doc.id,
            status,
            signatures: signatures.map(s => ({
                name: s.name,
                email: s.email,
                signed: !!s.signed,
                signedAt: s.signed ? s.signed.created_at : null,
                viewed: !!s.viewed,
                rejected: !!s.rejected
            }))
        });

    } catch (error) {
        console.error('[Status Contrato] Erro:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ---- API: Webhook do Autentique (quando contrato é assinado) ----
// Para uso local: exponha o servidor com ngrok e configure a URL no Autentique
// Exemplo: ngrok http 3000 → https://xxxx.ngrok.io/api/webhook-autentique
app.post('/api/webhook-autentique', (req, res) => {
    try {
        const payload = req.body;
        console.log('[Webhook Autentique] Evento recebido:', JSON.stringify(payload, null, 2));

        // O Autentique envia: { event, document: { id, name }, signer: { ... } }
        const docId = payload?.document?.id;
        const event = payload?.event;

        if (docId && event) {
            // Salva na fila em memória para o frontend consumir
            webhookEvents.push({
                documentId: docId,
                event,
                payload,
                receivedAt: new Date().toISOString()
            });

            // Mantém no máximo 100 eventos em memória
            if (webhookEvents.length > 100) webhookEvents.shift();

            console.log(`[Webhook] Evento '${event}' para documento ${docId} salvo na fila.`);
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('[Webhook] Erro ao processar:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ---- API: Frontend consome eventos de webhook pendentes ----
app.get('/api/webhook-events', (req, res) => {
    // Retorna todos os eventos e limpa a fila
    const events = [...webhookEvents];
    webhookEvents.length = 0;
    return res.status(200).json({ ok: true, events });
});

// ---- ROTA DE DIAGNÓSTICO ----
app.get('/api/diagnostico', async (req, res) => {
    const AUTENTIQUE_TOKEN = process.env.AUTENTIQUE_TOKEN;
    const resultado = {
        servidor: 'OK',
        token_configurado: !!AUTENTIQUE_TOKEN && AUTENTIQUE_TOKEN !== 'seu_token_aqui',
        token_primeiros_chars: AUTENTIQUE_TOKEN ? AUTENTIQUE_TOKEN.substring(0, 8) + '...' : 'NÃO CONFIGURADO',
        autentique_api: null,
        erro: null
    };

    if (!AUTENTIQUE_TOKEN || AUTENTIQUE_TOKEN === 'seu_token_aqui') {
        resultado.erro = 'Token não configurado no .env';
        return res.json(resultado);
    }

    try {
        const response = await fetch('https://api.autentique.com.br/v2/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTENTIQUE_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: '{ me { name email } }' })
        });
        const data = await response.json();
        if (data.errors) {
            resultado.autentique_api = 'ERRO';
            resultado.erro = JSON.stringify(data.errors);
        } else {
            resultado.autentique_api = 'OK';
            resultado.usuario_autentique = data.data?.me;
        }
    } catch(e) {
        resultado.autentique_api = 'FALHA NA CONEXÃO';
        resultado.erro = e.message;
    }

    return res.json(resultado);
});

// ---- Fallback: todas as rotas servem o index.html (SPA) ----
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- Iniciar servidor ----
app.listen(PORT, () => {
    console.log('');
    console.log('====================================');
    console.log('  Coopsol CRM rodando com sucesso!');
    console.log(`  Acesse: http://localhost:${PORT}`);
    console.log('====================================');
    console.log('');
});
